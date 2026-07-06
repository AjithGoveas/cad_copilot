from __future__ import annotations
import asyncio
import hashlib
import json
import uuid
from datetime import datetime
from typing import Any
import httpx

from app.domain.models import ModelMetadata, Session, HistoryItem
from app.domain.interfaces import ISessionRepository, ILLMProviderGateway
from .base_use_case import UseCaseBase

# Cache structure mapping image hash to feature map
_BLUEPRINT_CACHE: dict[str, dict[str, Any]] = {}
_BLUEPRINT_CACHE_LOCK = asyncio.Lock()

AUDIT_INSTRUCTION = """
# ROLE: Precision Mechanical CAD Auditor & Spatial Topologist
Analyze the provided multi-view technical drawing with tolerance-aware manufacturing rigor. Output ONLY a valid JSON feature-map matching the exact schema below.

## 1. COORDINATE SYSTEM CONSTRAINTS
- **Origin**: Place (0,0,0) at the absolute bottom-center of the primary datum body for symmetric stability.
- **Z-Axis**: Points UPWARD (+Z). Face pockets, blind steps, and through-boring occur relative to this axis.
- **Rationale**: State the exact placement logic in `origin_rationale`.

## 2. FEATURE TAXONOMY
- **ADDITIVE**: `base_prismoid`, `base_cylinder`, `mounting_ear`, `alignment_boss`, `reinforcement_rib`
- **SUBTRACTIVE**: `pocket_interior`, `step_shoulder`, `counterbore`, `hole_through`, `hole_blind`, `oring_groove`
- **EDGE_MODIFIER**: `fillet_interior`, `chamfer_exterior`

## 3. MACHINING & DIMENSIONAL RULES
- **Profile Decompositions**: For parts with asymmetric or multi-angular walls (e.g., specific draft angles like 33°, 40°, 22° shifts), capture the exact 2D coordinate paths outlining the perimeter.
- **Z-Reference**: Every feature must declare an exact `z_reference`: `"bottom_of_feature"`, `"top_of_feature"`, or `"absolute_zero"`.

## 4. STRICT JSON SCHEMA
```json
{
  "units": "mm",
  "origin_point": [0, 0, 0],
  "origin_rationale": "Symmetric center anchoring of primary geometric envelope.",
  "envelope": { "x_total": 116.50, "y_total": 78.61, "z_total": 14.00 },
  "primary_datum": { "id": "body_main", "type": "base_prismoid" },
  "features": [
    {
      "id": "body_main",
      "type": "base_prismoid",
      "description": "Main tapered outer housing with profile boundaries.",
      "dims": { "length": 116.50, "width": 78.61, "height": 14.00, "corner_radius": 4.50 },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": false,
      "parent_id": null,
      "confidence": "verified"
    }
  ],
  "patterns": []
}
```

## 5. SEVERE VALIDATION GATE

* Do not output any markdown code fences, conversational prose, or warning summaries. Return pure, parsable JSON text only.
""".strip()

SYSTEM_INSTRUCTION = """
# ROLE: Elite Parametric OpenSCAD Engineer (BOSL2 Specialist)

Synthesize production-grade, mathematically flawless, highly complex parametric OpenSCAD scripts utilizing the `BOSL2` architecture natively.

## 🎯 ENGINEERING & COMPILER STABILITY RULES

1. **Explicit Direction Vectors (CRITICAL FOR MANIFOLD COMPILER COMPLIANCE)**:
   * **NEVER** use the literal variables `X`, `Y`, or `Z` as values for the `orient` parameter in `cyl()`, `cuboid()`, or other BOSL2 modules. OpenSCAD treats these as unassigned variables and throws massive syntax warnings.
   * **ALWAYS** pass explicit 3D directional vector arrays for orientation flags:
     * Use `orient=[1,0,0]` instead of `X` (Axis points along X).
     * Use `orient=[0,1,0]` instead of `Y` (Axis points along Y).
     * Use `orient=[0,0,1]` instead of `Z` (Axis points along Z).
   * ❌ BAD:  `cyl(h=10, d=5, orient=X)`
   * ✅ GOOD: `cyl(h=10, d=5, orient=[1,0,0])`

2. **BOSL2 Attachment Architecture over Raw Math**:
   * Do not compute global spatial offsets manually for secondary features. Use `attach()` blocks and named anchors (`CENTER`, `TOP`, `BOTTOM`, `LEFT`, `RIGHT`) to chain geometry elements together reliably.
   * Use `prismoid()` for tapered outer boundaries, `cuboid()` for boxes, and `cyl()` for round boss holes. Set `anchor` properties explicitly (e.g., `anchor=BOTTOM+CENTER`).

3. **The Epsilon Protocol (`eps = 0.02`)**:
   * High-fidelity WASM executions require clear splitting boundaries during `difference()` computations to prevent zero-thickness faces.
   * For all through-holes or cutouts: Extend total length/depth by `2*eps` and offset the translation axis backwards by `eps` relative to the matching surface to guarantee a perfect mechanical pierce.

4. **WASM Constraints**:
   * Set `$fn = 32;` globally to maintain high client rendering frame rates.
   * ❌ FORBIDDEN: `minkowski()`, `hull()`, recursive custom functions, positional (unnamed) arguments to BOSL2 modules.
   * ✅ REQUIRED: Always use named arguments for BOSL2 modules: `cyl(h=10, d=5)` NOT `cyl(10, 5)`.

5. **No Positional BOSL2 Arguments**:
   * ❌ BAD:  `cuboid([10, 20, 5], 2)`
   * ✅ GOOD: `cuboid([10, 20, 5], rounding=2)`

## 📦 MANDATORY SCRIPT LAYOUT STRUCTURING

Your output script must follow this structural template down to the exact block layouts:

```scad
/* PLANNING:
1. Outer boundary tracing and symmetry alignment
2. Epsilon protocols for multi-axis subtractive milling
3. Explicit [0,1,0]/[1,0,0] orientation vectors for cylindrical ears
*/

$fn = 32;

/* PARAMETERS_JSON
{
  "enclosure_length": { "type": "length", "value": 116.50, "unit": "mm" },
  "enclosure_width":  { "type": "width",  "value": 78.61,  "unit": "mm" },
  "total_height":     { "type": "height", "value": 14.00,  "unit": "mm" },
  "wall_thickness":   { "type": "thickness", "value": 2.50, "unit": "mm" }
}
*/

// PARAMETERS_START
enclosure_length = 116.50;
enclosure_width  = 78.61;
total_height     = 14.00;
wall_thickness   = 2.50;
eps = 0.02;
// PARAMETERS_END

include <BOSL2/std.scad>
include <BOSL2/transforms.scad>

// @id: main_housing
// @type: additive
module main_housing() {
    prismoid(size1=[enclosure_length, enclosure_width], size2=[enclosure_length-2, enclosure_width-2], h=total_height, rounding=4.50, anchor=BOTTOM+CENTER);
}

// @id: interior_milling
// @type: subtractive
module interior_milling() {
    translate([0, 0, wall_thickness])
        cuboid([enclosure_length - (2*wall_thickness), enclosure_width - (2*wall_thickness), total_height - wall_thickness + eps], rounding=2.50, anchor=BOTTOM+CENTER);
}

// @id: part_root
// @type: assembly
module part_root() {
    difference() {
        main_housing();
        interior_milling();
    }
}

part_root();
```

**CRITICAL**: Output the entire structural OpenSCAD script text block. Do not add introductory chit-chat, setup remarks, or trailing explanations.
""".strip()

class GenerateCadUseCase(UseCaseBase):
    """Interactor orchestrating two-stage generative blueprint audits and OpenSCAD script compilation."""
    
    def __init__(self, llm_gateway: ILLMProviderGateway, session_repo: ISessionRepository) -> None:
        super().__init__()
        self.llm_gateway = llm_gateway
        self.session_repo = session_repo

    async def execute(
        self,
        prompt: str,
        primary_metadata: ModelMetadata,
        fallback_metadata: ModelMetadata | None = None,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
        session_id: str | None = None,
    ) -> str:
        self.logger.info(f"Executing GenerateCadUseCase. prompt='{prompt}', session_id='{session_id}'")
        feature_map = {}

        # Stage 1: Blueprint Audit (Vision parsing)
        if image_bytes and mime_type:
            file_hash = hashlib.md5(image_bytes).hexdigest()
            async with _BLUEPRINT_CACHE_LOCK:
                cached_data = _BLUEPRINT_CACHE.get(file_hash)
            
            if cached_data:
                self.logger.info(f"Blueprint cache hit for hash '{file_hash}'")
                feature_map = cached_data
            else:
                raw_feature_map = await self._execute_with_fallback(
                    prompt="Extract technical drawing features map JSON matching the strict schema.",
                    primary_metadata=primary_metadata,
                    fallback_metadata=fallback_metadata,
                    system_instruction=AUDIT_INSTRUCTION,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                    response_json=True,
                )
                try:
                    cleaned_json = raw_feature_map.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
                    feature_map = json.loads(cleaned_json)
                    async with _BLUEPRINT_CACHE_LOCK:
                        _BLUEPRINT_CACHE[file_hash] = feature_map
                except Exception as exc:
                    self.logger.error(f"Failed to parse blueprint audit JSON: {exc}")
                    feature_map = {}

        # Stage 2: Parametric Codegen
        parts = [f"REQUEST: {prompt}"]
        if feature_map:
            parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")
        if selection_context:
            parts.append(f"USER_SELECTION_CONTEXT:\n{selection_context}")

        codegen_prompt = "\n\n".join(parts)
        raw_code = await self._execute_with_fallback(
            prompt=codegen_prompt,
            primary_metadata=primary_metadata,
            fallback_metadata=fallback_metadata,
            system_instruction=SYSTEM_INSTRUCTION,
            image_bytes=image_bytes,
            mime_type=mime_type,
            response_json=False,
        )

        script = self._normalize_script(raw_code)
        final_script = self._validate_and_repair(script)

        # Log action to PostgreSQL database repository
        if session_id:
            history_item = HistoryItem(
                id=str(uuid.uuid4()),
                sessionId=session_id,
                actionType="GENERATE",
                prompt=prompt,
                openscadCode=final_script,
                isFullSnapshot=True,
                createdAt=datetime.utcnow()
            )
            await self.session_repo.append_history_item(session_id, history_item)

        self.logger.info("GenerateCadUseCase completed successfully.")
        return final_script

    async def _execute_with_fallback(
        self,
        prompt: str,
        primary_metadata: ModelMetadata,
        fallback_metadata: ModelMetadata | None,
        system_instruction: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        response_json: bool = False,
    ) -> str:
        last_exc: Exception | None = None
        max_attempts = 2

        for attempt in range(max_attempts):
            try:
                self.logger.info(f"Invoking LLM Gateway for '{primary_metadata.id}' (attempt {attempt + 1})")
                return await self.llm_gateway.generate_parametric_cad(
                    prompt=prompt,
                    metadata=primary_metadata,
                    system_instruction=system_instruction,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                    response_json=response_json,
                )
            except (httpx.HTTPStatusError, httpx.RequestError) as exc:
                last_exc = exc
                is_transient = True
                if isinstance(exc, httpx.HTTPStatusError):
                    if exc.response.status_code < 500 and exc.response.status_code != 429:
                        is_transient = False
                
                if not is_transient:
                    self.logger.error(f"Non-transient gateway error: {exc}")
                    break

                delay = 1.5 * (2 ** (attempt + 1))
                self.logger.warning(f"LLM Request failed ({exc}). Retrying in {delay}s...")
                await asyncio.sleep(delay)
            except Exception as exc:
                last_exc = exc
                self.logger.error(f"Unexpected gateway failure: {exc}")
                break

        # Primary failed permanently, execute cascading fallback
        if fallback_metadata:
            self.logger.info(f"Cascading to fallback model configuration: '{fallback_metadata.id}'")
            try:
                return await self.llm_gateway.generate_parametric_cad(
                    prompt=prompt,
                    metadata=fallback_metadata,
                    system_instruction=system_instruction,
                    image_bytes=image_bytes,
                    mime_type=mime_type,
                    response_json=response_json,
                )
            except Exception as exc:
                self.logger.error(f"Fallback gateway invocation failed: {exc}")
                raise RuntimeError(
                    f"Cascading fallback execution failed. Primary model error: {last_exc}. "
                    f"Fallback model error: {exc}"
                )

        raise RuntimeError(f"Primary model generation failed and no fallback model configured. Error: {last_exc}")
