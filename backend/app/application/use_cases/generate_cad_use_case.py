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
Analyze the provided technical drawing. Output ONLY a valid JSON feature-map matching the exact schema below.

## COORDINATE SYSTEM CONSTRAINTS
- **Origin**: Place (0,0,0) at the bottom-center of the primary body.
- **Z-Axis**: Points UPWARD (+Z).

## STRICT JSON SCHEMA
```json
{
  "units": "mm",
  "origin_point": [0, 0, 0],
  "origin_rationale": "Symmetric center anchoring.",
  "envelope": { "x_total": 100.0, "y_total": 100.0, "z_total": 10.0 },
  "primary_datum": { "id": "body_main", "type": "base_prismoid" },
  "features": []
}
```
""".strip()

SYSTEM_INSTRUCTION = """
# ROLE: Elite Parametric OpenSCAD Engineer (BOSL2 Specialist)
Synthesize production-grade, mathematically flawless parametric OpenSCAD scripts utilizing the `BOSL2` architecture natively.

## 🎯 ENGINEERING & COMPILER STABILITY RULES

1. **Explicit Direction Vectors (CRITICAL FOR MANIFOLD COMPILER COMPLIANCE)**:
   * **NEVER** use the literal variables `X`, `Y`, or `Z` as values for the `orient` parameter in `cyl()`, `cuboid()`, or other BOSL2 modules.
   * **ALWAYS** pass explicit 3D directional vector arrays for orientation flags:
     * Use `orient=[1,0,0]` instead of `X` (Axis points along X).
     * Use `orient=[0,1,0]` instead of `Y` (Axis points along Y).
     * Use `orient=[0,0,1]` instead of `Z` (Axis points along Z).
   * ❌ BAD:  `cyl(h=10, d=5, orient=X)`
   * ✅ GOOD: `cyl(h=10, d=5, orient=[1,0,0])`

2. **The Epsilon Protocol (`eps = 0.02`)**:
   * For all through-holes or cutouts: Extend total length/depth by `2*eps` and offset the translation axis backwards by `eps` relative to the matching surface to guarantee a perfect mechanical pierce.

3. **WASM Constraints**:
    * Use relative resolution parameters `$fa = 12;` and `$fs = 2;` globally.
   * ❌ FORBIDDEN: `minkowski()`, `hull()`, unnamed arguments to BOSL2 modules.

4. **No Positional BOSL2 Arguments**:
   * ✅ REQUIRED: Always use named arguments for BOSL2 modules: `cyl(h=10, d=5)` NOT `cyl(10, 5)`.
""".strip()

class GenerateCadUseCase(UseCaseBase):
    """Interactor orchestrating two-stage generative blueprint audits and OpenSCAD script compilation."""
    
    def __init__(self, llm_gateway: ILLMProviderGateway, session_repo: ISessionRepository) -> None:
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
        feature_map = {}

        # Stage 1: Blueprint Audit (Vision parsing)
        if image_bytes and mime_type:
            file_hash = hashlib.md5(image_bytes).hexdigest()
            async with _BLUEPRINT_CACHE_LOCK:
                cached_data = _BLUEPRINT_CACHE.get(file_hash)
            
            if cached_data:
                print(f"[GenerateCadUseCase] Cache hit for blueprint hash '{file_hash}'")
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
                    print(f"[GenerateCadUseCase] Failed to parse audit json: {exc}")
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
                print(f"[GenerateCadUseCase] Invoking LLM Gateway for '{primary_metadata.id}' (attempt {attempt + 1})")
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
                    print(f"[GenerateCadUseCase] Non-transient gateway error: {exc}")
                    break

                delay = 1.5 * (2 ** (attempt + 1))
                print(f"[GenerateCadUseCase] LLM Request failed ({exc}). Retrying in {delay}s...")
                await asyncio.sleep(delay)
            except Exception as exc:
                last_exc = exc
                print(f"[GenerateCadUseCase] Unexpected gateway failure: {exc}")
                break

        # Primary failed permanently, execute cascading fallback
        if fallback_metadata:
            print(f"[GenerateCadUseCase] Cascading to fallback model configuration: '{fallback_metadata.id}'")
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
                print(f"[GenerateCadUseCase] Fallback gateway invocation failed: {exc}")
                raise RuntimeError(
                    f"Cascading fallback execution failed. Primary model error: {last_exc}. "
                    f"Fallback model error: {exc}"
                )

        raise RuntimeError(f"Primary model generation failed and no fallback model configured. Error: {last_exc}")
