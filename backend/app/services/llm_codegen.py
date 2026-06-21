"""
CADVEX V2 - LLM Code Generation Service.

Two-stage pipeline:
  Stage 1 (Audit)   - Extract a feature-map JSON from the blueprint image/PDF.
  Stage 2 (Codegen) - Synthesize a BOSL2 OpenSCAD script from the feature-map.
"""
from __future__ import annotations

import json
import os
import re
import time
import hashlib
import threading
from pathlib import Path
from typing import Any, Callable

# Thread lock to serialize LRU cache access across async routes
_CACHE_LOCK = threading.Lock()

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None  # type: ignore
    types = None  # type: ignore

# -- System Instructions -------------------------------------------------------

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




2. **BOSL2 Attachment Architecture over Raw Math**:
* Do not compute global spatial offsets manually for secondary features. Use `attach()` blocks and named anchors (`CENTER`, `TOP`, `BOTTOM`, `LEFT`, `RIGHT`) to chain geometry elements together reliably.
* Use `prismoid()` for tapered outer boundaries, `cuboid()` for boxes, and `cyl()` for round boss holes. Set `anchor` properties explicitly (e.g., `anchor=BOTTOM+CENTER`).


3. **The Epsilon Protocol (`eps = 0.02`)**:
* High-fidelity WASM executions require clear splitting boundaries during `difference()` computations to prevent zero-thickness faces.
* For all through-holes or cutouts: Extend total length/depth by `2*eps` and offset the translation axis backwards by `eps` relative to the matching surface to guarantee a perfect mechanical pierce.


4. **WASM Constraints**:
* Set `$fn = 32;` globally to maintain high client rendering frame rates. Do not use `minkowski()`, `hull()`, or recursive custom functions.



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
  "enclosure_width": { "type": "width", "value": 78.61, "unit": "mm" },
  "total_height": { "type": "height", "value": 14.00, "unit": "mm" },
  "wall_thickness": { "type": "thickness", "value": 2.50, "unit": "mm" }
}
*/

// PARAMETERS_START
enclosure_length = 116.50;
enclosure_width = 78.61;
total_height = 14.00;
wall_thickness = 2.50;
eps = 0.02;
// PARAMETERS_END

include <BOSL2/std.scad>
include <BOSL2/transforms.scad>

// @id: main_housing
// @type: additive
module main_housing() {
    prismoid(size1=[enclosure_length, enclosure_width], size2=[enclosure_length-2, enclosure_width-2], h=total_height, r=4.50, anchor=BOTTOM+CENTER);
}

// @id: interior_milling
// @type: subtractive
module interior_milling() {
    translate([0, 0, wall_thickness])
        cuboid([enclosure_length - (2*wall_thickness), enclosure_width - (2*wall_thickness), total_height - wall_thickness + eps], r=2.50, anchor=BOTTOM+CENTER);
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

EDIT_SYSTEM_PROMPT = """

# ROLE: Expert CAD Revision Engineer & Code Refinement Agent

You are performing surgical geometric updates on an existing BOSL2-based OpenSCAD model.

## ⚠️ IMMUTABILITY & ENGINE RULES

1. **Never generate a completely new part from scratch**. Retain the foundational modules, structural identifiers, and base assets.
2. **Variable Protection**: You are strictly FORBIDDEN from altering the string spelling of any variable keys inside the `// PARAMETERS_START` envelope. You may append new parameter keys or adjust their default right-hand numbers, but changing key names will break the user's React slider system completely.
3. **Orientation Syntax Constraint**: Ensure all rotational adjustments use explicit direction vector arrays (e.g., `orient=[1,0,0]` or `orient=[0,1,0]`). Never pass unassigned alphabetic tokens like `X` or `Y` to orientation nodes.

Output the ENTIRE updated OpenSCAD file text block containing the fixes. Partial code snippets are completely unacceptable.
""".strip()



# -- Regex ---------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r"```(?:scad|openscad|text)?\s*(.*?)```", re.I | re.S)
_CODE_START_RE = re.compile(
    r"(?m)^(?:include\s*<|/\*\s*PARAMETERS_JSON|//\s*PARAMETERS_START|module\s+\w+\s*\(|\$fn\s*=)"
)


# Global cache to speed up blueprint uploads and analysis
# Keys are the MD5 hash of the uploaded file bytes
# Value: {
#     "feature_map": dict[str, Any],
#     "gemini_file": Any,
#     "mime_type": str
# }
_BLUEPRINT_CACHE: dict[str, dict[str, Any]] = {}
_BLUEPRINT_CACHE_KEYS: list[str] = []
_MAX_CACHE_SIZE = 50

def _cache_blueprint(file_hash: str, data: dict[str, Any]) -> None:
    with _CACHE_LOCK:
        if file_hash in _BLUEPRINT_CACHE:
            _BLUEPRINT_CACHE[file_hash].update(data)
            return
            
        if len(_BLUEPRINT_CACHE_KEYS) >= _MAX_CACHE_SIZE:
            oldest_key = _BLUEPRINT_CACHE_KEYS.pop(0)
            _BLUEPRINT_CACHE.pop(oldest_key, None)
            
        _BLUEPRINT_CACHE[file_hash] = data
        _BLUEPRINT_CACHE_KEYS.append(file_hash)


# -- Service -------------------------------------------------------------------

class LLMCodegenService:
    """Stateless AI orchestration service wrapping the Gemini API."""

    MAX_RETRIES = 1

    def __init__(self, model: str | None = None) -> None:
        if genai is None:
            raise RuntimeError("google-genai SDK not installed.")

        self._load_env()
        api_key = os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY environment variable not set.")

        self.MAX_RETRIES = int(os.getenv("GENAI_MAX_RETRIES", "1"))
        self.client = genai.Client(api_key=api_key)
        self.model  = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite-preview")

    # -- Private helpers -------------------------------------------------------

    @staticmethod
    def _load_env() -> None:
        try:
            from dotenv import load_dotenv
            load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        except Exception:
            pass

    def _call_with_retry(self, fn: Callable[[], Any], label: str) -> str:
        """Execute `fn()` up to MAX_RETRIES times with exponential back-off."""
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                response = fn()
                return response.text or ""
            except Exception as exc:
                last_exc = exc
                time.sleep(2 ** attempt)
        raise RuntimeError(
            f"[{label}] failed after {self.MAX_RETRIES} attempts: {last_exc}"
        )

    @staticmethod
    def _normalize_script(raw: str) -> str:
        """Strip markdown fences and leading prose from a raw LLM response."""
        if not raw:
            return ""

        # Extract the largest code fence block if present
        cleaned = raw.strip()
        fences = _CODE_FENCE_RE.findall(cleaned)
        if fences:
            cleaned = max(fences, key=len).strip()
        else:
            # Fallback: strip code blocks manually
            cleaned = re.sub(r"^```(?:scad|openscad|text)?\s*", "", cleaned, flags=re.I)
            cleaned = re.sub(r"```$", "", cleaned)
            cleaned = cleaned.strip()

        # Fast-forward to the first recognizable OpenSCAD token
        m = _CODE_START_RE.search(cleaned)
        if m:
            cleaned = cleaned[m.start():].strip()

        return cleaned

    # -- Public API ------------------------------------------------------------

    def audit_blueprint(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict[str, Any]:
        """
        Stage 1 - Analyse a blueprint image bytes inline and return a structured
        feature-map dictionary.
        """
        file_hash = hashlib.md5(image_bytes).hexdigest()
        
        with _CACHE_LOCK:
            if file_hash in _BLUEPRINT_CACHE:
                if "feature_map" in _BLUEPRINT_CACHE[file_hash]:
                    print(f"[audit] Cache hit for image hash {file_hash}")
                    return _BLUEPRINT_CACHE[file_hash]["feature_map"]

        # Create inline media part directly from bytes
        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            
        def _call() -> Any:
            is_thinking = "3.5" in self.model
            config_params = {
                "temperature": 0.0,
                "response_mime_type": "application/json",
            }
            if is_thinking:
                config_params["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.HIGH)

            return self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_text(text=AUDIT_INSTRUCTION),
                    image_part,
                ],
                config=types.GenerateContentConfig(**config_params),
            )

        raw = self._call_with_retry(_call, "audit")

        try:
            cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            feature_map = json.loads(cleaned)
            _cache_blueprint(file_hash, {"feature_map": feature_map})
            return feature_map
        except Exception:
            return {}

    def generate_script(
        self,
        prompt: str,
        image_bytes: bytes | None = None,
        mime_type: str | None = None,
        feature_map: dict[str, Any] | None = None,
        base_code: str | None = None,
        selection_context: str | None = None,
    ) -> str:
        """
        Stage 2 - Synthesise or refine an OpenSCAD script.

        If `base_code` is provided, Gemini will refine the existing script
        rather than generating from scratch. `selection_context` attaches
        spatial raycasting data so edits are geometrically targeted.
        """
        # Build context string
        parts: list[str] = [f"REQUEST: {prompt}"]

        if feature_map:
            parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")

        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")

        if selection_context:
            parts.append(f"USER_SELECTION_CONTEXT:\n{selection_context}")

        user_text = "\n\n".join(parts)

        # Assemble multimodal contents using inline bytes instead of uploaded file reference
        contents: list[Any] = [types.Part.from_text(text=SYSTEM_INSTRUCTION)]
        if image_bytes and mime_type:
            contents.append(
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
            )
        contents.append(types.Part.from_text(text=user_text))

        def _call() -> Any:
            is_thinking = "3.5" in self.model
            config_params = {
                "temperature": 0.0,
            }
            if is_thinking:
                config_params["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.MEDIUM)

            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(**config_params),
            )

        raw = self._call_with_retry(_call, "codegen")
        return self._normalize_script(raw)

    def edit_script(
        self,
        prompt: str,
        current_code: str,
        target_point: list[float] | None = None,
    ) -> str:
        """
        Surgically edit an existing OpenSCAD script based on a user prompt.
        """
        user_prompt = prompt
        if target_point and len(target_point) == 3:
            x, y, z = target_point
            user_prompt += f"\n\n[System Context: The user clicked on the 3D mesh at absolute coordinates X: {x}, Y: {y}, Z: {z}. Use this exact spatial location as the origin/target for the requested modification.]"

        user_text = f"CURRENT_CODE:\n{current_code}\n\nUSER_REQUEST:\n{user_prompt}"

        contents = [
            types.Part.from_text(text=EDIT_SYSTEM_PROMPT),
            types.Part.from_text(text=user_text),
        ]

        def _call() -> Any:
            is_thinking = "3.5" in self.model
            config_params = {
                "temperature": 0.0,
            }
            if is_thinking:
                config_params["thinking_config"] = types.ThinkingConfig(thinking_level=types.ThinkingLevel.MEDIUM)

            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(**config_params),
            )

        raw = self._call_with_retry(_call, "edit")
        return self._normalize_script(raw)
