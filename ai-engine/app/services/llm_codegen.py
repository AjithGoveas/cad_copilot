"""
CAD Copilot V2 - LLM Code Generation Service.

Two-stage pipeline:
  Stage 1 (Audit)   - Extract a feature-map JSON from the blueprint image/PDF.
  Stage 2 (Codegen) - Synthesize a BOSL2 OpenSCAD script from the feature-map.
"""
from __future__ import annotations

import json
import os
import re
import time
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
# ROLE: Senior CAD Auditor & Geometric Topologist
Analyze the provided technical drawing and extract a structured feature-map.

## OBJECTIVES:
1. Identify all primary and secondary features.
2. Extract exact dimensions and spatial relationships (offsets, patterns).
3. Determine topological connectivity (which holes belong to which face).
4. Define exact 3D start and end coordinates (p1 and p2) for every key dimension to construct annotation overlays.

## OUTPUT: JSON only - no prose, no markdown
{
    "units": "mm|in",
    "envelope": {"x": 0, "y": 0, "z": 0},
    "topology_hints": ["e.g. cylindrical body with radial holes"],
    "features": [
        {
            "id": "unique_snake_case_id",
            "type": "block|cylinder|hole|slot|pocket|thread|chamfer|fillet",
            "dims": {"key": value},
            "location": {"x": 0, "y": 0, "z": 0},
            "is_subtractive": true,
            "parent_id": "optional_id_of_containing_feature"
        }
    ],
    "patterns": [
        {"type": "radial|linear", "feature_ids": [], "count": 0, "spacing": 0}
    ],
    "notes": []
}
""".strip()


SYSTEM_INSTRUCTION = """
# ROLE: Expert OpenSCAD & Computational Geometry Engineer
Transform a JSON feature-map into a modular, parametric OpenSCAD script for high-performance WASM rendering.

# ==============================================================================
# RULE #1 - THE EPSILON PROTOCOL (CRITICAL FOR MANIFOLD STABILITY)
# ==============================================================================
To prevent CGAL kernel crashes caused by zero-thickness coplanar faces:
Every subtractive volume (hole, slot, cutout) inside a `difference()` block MUST:
  1. Be extended by `eps` in height/depth → `h = dimension + eps`
  2. Be shifted by `eps/2` against the cut direction → `translate([0, 0, -eps/2])`

# ==============================================================================
# RULE #2 - THE PART_ROOT PROTOCOL (CRITICAL FOR DXF EXPORT PARSING)
# ==============================================================================
**MANDATORY**: ALL final assembly geometry and boolean operations (`difference()`, `union()`) MUST be contained inside a single top-level module named `part_root()`.
The absolute last line of your script MUST be the single execution call: `part_root();`
Do NOT leave raw boolean operations floating outside a module at the bottom of the script.

# ==============================================================================
# RULE #3 - PARAMETERS_JSON ANNOTATION PROTOCOL
# ==============================================================================
The `/* PARAMETERS_JSON ... */` comment block MUST be a JSON object mapping each editable parameter name (as declared in the flat parameters block) to its 3D dimension annotation metadata. The LLM must explicitly provide semantic type tags and bounding anchors for all structural geometries.
Enforce the following structures:
  - Diameters/Radii: Provide type `"diameter"`, absolute center position `center: [x, y, z]`, a flat normal/axis vector `axis: [nx, ny, nz]`, and the numerical value.
    Example: `"shank_dia": {"type": "diameter", "center": [0, 0, 17.5], "axis": [0, 0, 1], "value": 19.05}`
  - Heights/Thicknesses: Provide type `"height"`, starting anchor position `p1: [x, y, z]`, and terminating end position `p2: [x, y, z]`.
    Example: `"shank_length": {"type": "height", "p1": [0, 0, 0], "p2": [0, 0, 35.0]}`
  - Chamfers/Fillets: Provide type `"chamfer"`, target edge center location `center: [x, y, z]`, and specific offset size.
    Example: `"flange_chamfer": {"type": "chamfer", "center": [0, 0, 35.0], "offset": 1.5, "radius": 40.0}`

These coordinates must represent the actual dimension endpoints in the OpenSCAD design space (relative to the part origin).

## ENGINEERING GUIDELINES
- **Stateless Vanilla**: Use standard `cube()`, `cylinder()`, `sphere()`. NO LIBRARIES.
- **Parametric Consistency**: Declare all dimensions in the PARAMETERS block. Never use magic numbers in modules.
- **Manifold Enforcement**: Ensure all `union()` and `difference()` operations result in closed manifolds.
- **Positioning**: Use `translate()` and `rotate()`. Prefer `center=true` for alignment.
- **Resolution**: Global `$fn = 32;` is the hard limit for WASM stability.

## MANDATORY FILE STRUCTURE
1. `$fn = 32;`
2. `/* PARAMETERS_JSON { ... } */` mapping each flat parameter to its 3D annotation metadata using the semantic types above.
3. `// PARAMETERS_START` ... `// PARAMETERS_END` (Include `eps = 0.02;`)
4. One `module` per logical feature with `// @id: name` tags.
5. `module part_root() { ... }` containing the final assembly logic.
6. `part_root();` as the exact, final line of the script.

## PERFORMANCE CONSTRAINTS
- No `minkowski()` - causes heap overflow.
- Max 8 children per `difference()`.
- Output ONLY valid OpenSCAD code.
"""

CANONICAL_EXAMPLE = """
$fn = 32;

/* PARAMETERS_JSON
{
  "shank_dia": {
    "type": "diameter",
    "center": [0, 0, 17.5],
    "axis": [0, 0, 1],
    "value": 19.05
  },
  "shank_length": {
    "type": "height",
    "p1": [0, 0, 0],
    "p2": [0, 0, 35.0]
  },
  "body_dia": {
    "type": "diameter",
    "center": [0, 0, 60.0],
    "axis": [0, 0, 1],
    "value": 80.0
  },
  "body_length": {
    "type": "height",
    "p1": [0, 0, 35.0],
    "p2": [0, 0, 85.0]
  },
  "wall_thickness": {
    "type": "height",
    "p1": [37.0, 0, 60.0],
    "p2": [40.0, 0, 60.0]
  },
  "num_slots": {
    "type": "height",
    "p1": [0, 0, 60.0],
    "p2": [40.0, 0, 60.0]
  },
  "lip_chamfer": {
    "type": "chamfer",
    "center": [0, 0, 85.0],
    "offset": 2.0,
    "radius": 40.0
  }
}
*/

// PARAMETERS_START
shank_dia = 19.05;
shank_length = 35.0;
body_dia = 80.0;
body_length = 50.0;
wall_thickness = 3.0;
num_slots = 3;
lip_chamfer = 2.0;
eps = 0.02;  // CGAL crash prevention
// PARAMETERS_END

// @id: main_body
module main_body() {
    union() {
        cylinder(d=shank_dia, h=shank_length);
        translate([0, 0, shank_length])
            cylinder(d=body_dia, h=body_length);
    }
}

// @id: inner_hollow
module inner_hollow() {
    // Epsilon Applied (+eps height, -eps/2 shift)
    translate([0, 0, shank_length + wall_thickness - eps/2])
        cylinder(d=body_dia - 2*wall_thickness, h=body_length + eps);
}

// @id: lip_chamfer_cut
module lip_chamfer_cut() {
    // Chamfer at the top lip of the body
    translate([0, 0, shank_length + body_length - lip_chamfer])
        difference() {
            cylinder(d=body_dia + eps, h=lip_chamfer + eps);
            cylinder(d1=body_dia - 2*lip_chamfer, d2=body_dia, h=lip_chamfer + eps);
        }
}

// @id: chip_slots
module chip_slots() {
    for (a = [0 : 360/num_slots : 359]) {
        rotate([0, 0, a])
        translate([body_dia/2, 0, shank_length + body_length/2])
        cube([20, 10, body_length + eps], center=true);
    }
}

// @id: part_root
module part_root() {
    difference() {
        main_body();
        inner_hollow();
        lip_chamfer_cut();
        chip_slots();
    }
}

part_root();
""".strip()


# -- Regex ---------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r"```(?:scad|openscad|text)?\s*(.*?)```", re.I | re.S)
_CODE_START_RE = re.compile(
    r"(?m)^(?:include\s*<|/\*\s*PARAMETERS_JSON|//\s*PARAMETERS_START|module\s+\w+\s*\(|\$fn\s*=)"
)


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
    ) -> dict[str, Any]:
        """
        Stage 1 - Analyse a blueprint image/PDF and return a structured
        feature-map dictionary.
        """
        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=[
                    types.Part.from_text(text=AUDIT_INSTRUCTION),
                    types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                ],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    response_mime_type="application/json",
                ),
            )

        raw = self._call_with_retry(_call, "audit")

        try:
            cleaned = raw.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
            return json.loads(cleaned)
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

        # Assemble multimodal contents
        contents: list[Any] = [types.Part.from_text(text=SYSTEM_INSTRUCTION)]
        if image_bytes and mime_type:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
        contents.append(types.Part.from_text(text=user_text))

        def _call() -> Any:
            return self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(temperature=0.0),
            )

        raw = self._call_with_retry(_call, "codegen")
        return self._normalize_script(raw)