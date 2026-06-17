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
from pathlib import Path
from typing import Any, Callable

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None  # type: ignore
    types = None  # type: ignore


# -- System Instructions -------------------------------------------------------

AUDIT_INSTRUCTION = """
# ROLE: Precision Mechanical Engineer & CAD Auditor
Analyze the provided technical drawing with tolerance-aware rigor. Output ONLY a valid JSON feature-map matching the exact schema below.

## 1. COORDINATE SYSTEM CONSTRAINTS
- **Origin**: Place (0,0,0) at the absolute leftmost-bottommost-foremost point of the entire part.
- **Z-Axis**: Points UPWARD. All features stack along the +Z axis.
- **Rationale**: State the exact placement logic in `origin_rationale`.

## 2. FEATURE TAXONOMY (Choose ONE per feature)
- **ADDITIVE**: `base_block`, `base_cylinder`, `secondary_block`, `secondary_cylinder`
- **SUBTRACTIVE**: `hole_blind`, `hole_through`, `slot_rectangular`, `slot_curved`, `pocket_shallow`, `pocket_deep`
- **EDGE**: `chamfer`, `fillet`, `thread`

## 3. DIMENSIONAL EXTRACTION RULES
- **Confidence**: `verified` (in 2+ views), `inferred` (1 view, implied by geometry), `uncertain` (ambiguous/missing, explain in notes).
- **Angles**: Decompose non-aligned features into explicit X, Y, Z translation/rotation offsets.
- **Z-Reference**: Every subtractive feature must specify `z_reference` as: `"top_of_feature"`, `"bottom_of_feature"`, or `"center_of_feature"`.

## 4. STRICT JSON SCHEMA
```json
{
  "units": "mm",
  "origin_point": [0, 0, 0],
  "origin_rationale": "Origin placed at bottom-center of base cylinder for symmetry.",
  "envelope": { "x_min": 0, "x_max": 0, "y_min": 0, "y_max": 0, "z_min": 0, "z_max": 0 },
  "primary_datum": { "id": "base_001", "type": "base_cylinder", "description": "" },
  "features": [
    {
      "id": "base_001",
      "type": "base_cylinder",
      "description": "",
      "dims": { "diameter": 50.0, "height": 100.0 },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": false,
      "parent_id": null,
      "confidence": "verified",
      "notes": ""
    },
    {
      "id": "hole_001",
      "type": "hole_through",
      "description": "",
      "dims": { "diameter": 10.0 },
      "location": { "x": 0.0, "y": 0.0, "z": 0.0, "z_reference": "bottom_of_feature" },
      "is_subtractive": true,
      "parent_id": "base_001",
      "confidence": "verified",
      "notes": ""
    }
  ],
  "patterns": [
    {
      "type": "radial",
      "feature_ids": ["hole_001"],
      "count": 1,
      "spacing_degrees": 360.0,
      "center": [0.0, 0.0, 0.0],
      "rotation_axis": "Z"
    }
  ],
  "ambiguities": []
}


## 5. VALIDATION RULES
- Every subtractive feature MUST reference a valid parent_id.
- All locations must reside within envelope bounds.
- No duplicate `id` keys.
- Do not output any markdown code fences or explanatory text. Return JSON only.
""".strip()


SYSTEM_INSTRUCTION = """
# ROLE: Expert OpenSCAD Parametric CAD Engineer
Generate production-grade, mathematically robust, parametric OpenSCAD code.

## 🎯 GOLDEN RULES
1. **Manifold Stability**: Every boolean operation must resolve cleanly without generating zero-thickness walls or self-intersections. Use `$fn = 32;` (strictly ≤ 32).
2. **Parametric Stacking**: No hardcoded values. Derive downstream Z-coordinates explicitly from base heights (e.g., `body_z = shank_height;`).
3. **Epsilon Protocol (`eps = 0.01`)**: 
   - Apply `eps` to avoid Z-fighting on coplanar surfaces.
   - For blind holes/cuts: Shift start point back by `eps/2` and extend depth by `eps`.
   - For through-holes/cuts: Extend length by `2*eps` and offset starting plane by `eps` to pierce completely.
4. **No Forbidden Operations**: Never use `minkowski()`, `hull()`, external libraries, or recursive custom functions.

## 📦 COMPACT STRUCTURE
Your output script must follow this exact structure:

```scad
/* PLANNING:
1. Base feature Z-range: Z ∈ [0, shank_height]
2. Stacked feature Z-range: Z ∈ [shank_height, shank_height + body_height]
3. Cuts/Epsilon offsets calculated relative to stack heights
*/

$fn = 32;

/* PARAMETERS_JSON
{
  "shank_diameter": { "type": "diameter", "center": [0,0,10], "axis": [0,0,1], "value": 20.0, "unit": "mm" },
  "shank_height": { "type": "height", "p1": [0,0,0], "p2": [0,0,20], "value": 20.0, "unit": "mm", "direction": "+Z" }
}
*/

// PARAMETERS_START
shank_diameter = 20.0;
shank_height = 20.0;
body_diameter = 40.0;
body_height = 30.0;
eps = 0.01;
// PARAMETERS_END

// @id: shank
// @type: additive
module shank() {
    cylinder(d=shank_diameter, h=shank_height);
}

// @id: body
// @type: additive
// @deps: [shank]
module body() {
    translate([0, 0, shank_height])
        cylinder(d=body_diameter, h=body_height);
}

// @id: through_hole
// @type: subtractive
// @deps: [shank, body]
module through_hole() {
    total_h = shank_height + body_height;
    translate([0, 0, -eps])
        cylinder(d=10, h=total_h + 2*eps);
}

// @id: part_root
// @type: assembly
module part_root() {
    difference() {
        union() {
            shank();
            body();
        }
        through_hole()
    }
}

part_root()
```

**YOU ARE NOW READY TO GENERATE PRODUCTION-GRADE OPENSCAD CODE FOR WASM RENDERING.**
""".strip()


EDIT_SYSTEM_PROMPT = """
# ROLE: Expert CAD Engineer & OpenSCAD Refinement Specialist
You are an expert CAD engineer editing an existing OpenSCAD script.
You must read the provided CURRENT CODE and modify it to fulfill the user's request.
DO NOT generate a completely new model from scratch. Retain the existing structure, modules, and variable definitions (PARAMETERS_START/END block) unless specifically asked to remove them.
Output the ENTIRE updated OpenSCAD script. Do not output partial snippets.

Your script must follow the exact syntax, manifold stability rules, and $fn cap parameters. Use the existing modules as the assembly base inside part_root().
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

    MAX_RETRIES = 3

    def __init__(self, model: str | None = None) -> None:
        if genai is None:
            raise RuntimeError("google-genai SDK not installed.")

        self._load_env()
        api_key = os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY environment variable not set.")

        self.client = genai.Client(api_key=api_key)
        self.model  = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite-preview")

    def upload_file_to_gemini(self, file_bytes: bytes, mime_type: str, filename: str) -> Any:
        """Upload file bytes to Gemini Files API using a temporary file and return the file object."""
        import tempfile
        from pathlib import Path
        
        suffix = Path(filename).suffix or ".pdf"
        if not suffix.startswith("."):
            suffix = "." + suffix
            
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name
            
        try:
            uploaded_file = self.client.files.upload(
                file=tmp_path,
                config=types.UploadFileConfig(
                    mime_type=mime_type
                )
            )
            
            # Poll if state is PROCESSING
            import time
            state = getattr(uploaded_file, "state", None)
            if state and state.name == "PROCESSING":
                for _ in range(30):
                    time.sleep(1)
                    uploaded_file = self.client.files.get(name=uploaded_file.name)
                    if uploaded_file.state.name != "PROCESSING":
                        break
                        
            if uploaded_file.state.name == "FAILED":
                raise RuntimeError("Gemini file processing failed")
                
            return uploaded_file
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

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
        fences = _CODE_FENCE_RE.findall(raw)
        text   = max(fences, key=len) if fences else raw

        cleaned = text.strip().strip("`").strip()

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
        filename: str = "blueprint.pdf",
    ) -> dict[str, Any]:
        """
        Stage 1 - Analyse a blueprint image/PDF and return a structured
        feature-map dictionary.
        """
        file_hash = hashlib.md5(image_bytes).hexdigest()
        
        if file_hash in _BLUEPRINT_CACHE and "feature_map" in _BLUEPRINT_CACHE[file_hash]:
            print(f"[audit] Cache hit for file hash {file_hash}")
            return _BLUEPRINT_CACHE[file_hash]["feature_map"]
            
        uploaded_file = None
        if file_hash in _BLUEPRINT_CACHE and "gemini_file" in _BLUEPRINT_CACHE[file_hash]:
            uploaded_file = _BLUEPRINT_CACHE[file_hash]["gemini_file"]
        else:
            print(f"[audit] Cache miss. Uploading {filename} to Gemini Files API...")
            uploaded_file = self.upload_file_to_gemini(image_bytes, mime_type, filename)
            _cache_blueprint(file_hash, {
                "gemini_file": uploaded_file,
                "mime_type": mime_type,
            })
            
        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_text(text=AUDIT_INSTRUCTION),
                    uploaded_file,
                ],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                ),
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
        filename: str = "blueprint.pdf",
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

        # Retrieve or upload file reference
        uploaded_file = None
        if image_bytes and mime_type:
            file_hash = hashlib.md5(image_bytes).hexdigest()
            if file_hash in _BLUEPRINT_CACHE and "gemini_file" in _BLUEPRINT_CACHE[file_hash]:
                uploaded_file = _BLUEPRINT_CACHE[file_hash]["gemini_file"]
            else:
                print(f"[codegen] Cache miss. Uploading {filename} to Gemini Files API...")
                uploaded_file = self.upload_file_to_gemini(image_bytes, mime_type, filename)
                _cache_blueprint(file_hash, {
                    "gemini_file": uploaded_file,
                    "mime_type": mime_type,
                })

        # Assemble multimodal contents
        contents: list[Any] = [types.Part.from_text(text=SYSTEM_INSTRUCTION)]
        if uploaded_file:
            contents.append(uploaded_file)
        contents.append(types.Part.from_text(text=user_text))

        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(temperature=0.0),
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
            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(temperature=0.0),
            )

        raw = self._call_with_retry(_call, "edit")
        return self._normalize_script(raw)
