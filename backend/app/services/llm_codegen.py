"""
CADVEX V2 - LLM Code Generation Service.

Two-stage pipeline:
  Stage 1 (Audit)   - Extract a feature-map JSON from the blueprint image/PDF.
  Stage 2 (Codegen) - Synthesize a BOSL2 OpenSCAD script from the feature-map.

Model strategy:
  - Primary / thinking-capable:  gemini-2.5-* or gemini-3.5-* (via _THINKING_MODELS registry)
  - Fallback / simple tasks:     gemini-3.1-flash-lite (or GENAI_FALLBACK_MODEL env var)
    The fallback receives NO thinking_config — it is used for lightweight, non-reasoning
    calls or as an error-recovery fallback when the primary model is unavailable.
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


# ---------------------------------------------------------------------------
# Model Capability Registry
# ---------------------------------------------------------------------------

# Explicit set of model-name substrings that support ThinkingConfig.
# Matches any Gemini 2.5-* and 3.5-* variants the API exposes.
# DO NOT add 3.1-flash-lite here — it is the no-thinking fallback.
_THINKING_MODELS: frozenset[str] = frozenset({
    # Gemini 2.5 family (stable)
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.5-flash-lite",
    # Any preview/experimental 2.5 variants
    "gemini-2.5-flash-preview",
    "gemini-2.5-pro-preview",
    # Gemini 3.5 family (when available)
    "gemini-3.5-flash",
    "gemini-3.5-pro",
    "gemini-3.5-flash-lite",
    # Legacy thinking experiment
    "gemini-2.0-flash-thinking",
})


def _supports_thinking(model: str) -> bool:
    """Return True if `model` is known to support ThinkingConfig."""
    model_lower = model.lower()
    return any(marker in model_lower for marker in _THINKING_MODELS)


# ---------------------------------------------------------------------------
# System Instructions
# ---------------------------------------------------------------------------

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

EDIT_SYSTEM_PROMPT = """
# ROLE: Expert CAD Revision Engineer & Code Refinement Agent

You are performing surgical geometric updates on an existing BOSL2-based OpenSCAD model.

## ⚠️ IMMUTABILITY & ENGINE RULES

1. **Never generate a completely new part from scratch**. Retain the foundational modules, structural identifiers, and base assets.
2. **Variable Protection**: You are strictly FORBIDDEN from altering the string spelling of any variable keys inside the `// PARAMETERS_START` envelope. You may append new parameter keys or adjust their default right-hand numbers, but changing key names will break the user's React slider system completely.
3. **Orientation Syntax Constraint**: Ensure all rotational adjustments use explicit direction vector arrays (e.g., `orient=[1,0,0]` or `orient=[0,1,0]`). Never pass unassigned alphabetic tokens like `X` or `Y` to orientation nodes.
   * ❌ BAD:  `cyl(h=10, d=5, orient=Y)`
   * ✅ GOOD: `cyl(h=10, d=5, orient=[0,1,0])`
4. **Named Arguments Only**: Always use named BOSL2 arguments — never positional.

Output the ENTIRE updated OpenSCAD file text block containing the fixes. Partial code snippets are completely unacceptable.
""".strip()


# ---------------------------------------------------------------------------
# Regex helpers
# ---------------------------------------------------------------------------

_CODE_FENCE_RE = re.compile(r"```(?:scad|openscad|text)?\s*(.*?)```", re.I | re.S)
_CODE_START_RE = re.compile(
    r"(?m)^(?:include\s*<|/\*\s*PARAMETERS_JSON|//\s*PARAMETERS_START|module\s+\w+\s*\(|\$fn\s*=)"
)

# Hallucination patterns we auto-repair post-generation
_ORIENT_X_RE  = re.compile(r'\borient\s*=\s*X\b')
_ORIENT_Y_RE  = re.compile(r'\borient\s*=\s*Y\b')
_ORIENT_Z_RE  = re.compile(r'\borient\s*=\s*Z\b')
_BOSL2_MODULES = re.compile(r'\b(?:cuboid|cyl|xcyl|ycyl|zcyl|prismoid|sphere|torus)\s*\(')

# ---------------------------------------------------------------------------
# Blueprint cache (LRU by insertion order, capped at _MAX_CACHE_SIZE)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class LLMCodegenService:
    """Stateless AI orchestration service wrapping the Gemini API.

    Model hierarchy
    ---------------
    self.model          — primary model (should be a 2.5-* or 3.5-* thinking model)
    self.fallback_model — non-thinking model for simple / lightweight calls
                          (defaults to gemini-3.1-flash-lite)
    """

    MAX_RETRIES: int = 2
    _retry_base_delay: float = 1.5
    _retry_max_delay: float  = 75.0

    def __init__(self, model: str | None = None) -> None:
        if genai is None:
            raise RuntimeError("google-genai SDK not installed.")

        self._load_env()
        api_key = os.getenv("GOOGLE_API_KEY", "")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY environment variable not set.")

        self.MAX_RETRIES       = int(os.getenv("GENAI_MAX_RETRIES", "2"))
        self._retry_base_delay = float(os.getenv("GENAI_RETRY_BASE_DELAY", "1.5"))
        self._retry_max_delay  = float(os.getenv("GENAI_MAX_RETRY_DELAY", "75.0"))

        self.client         = genai.Client(api_key=api_key)
        self.model          = model or os.getenv("GENAI_MODEL", "gemini-2.5-flash-lite-preview-06-17")
        self.fallback_model = os.getenv("GENAI_FALLBACK_MODEL", "gemini-3.1-flash-lite")

        print(
            f"[llm_codegen] primary={self.model!r}  "
            f"thinking={_supports_thinking(self.model)}  "
            f"fallback={self.fallback_model!r}"
        )

    # ------------------------------------------------------------------ helpers

    @staticmethod
    def _load_env() -> None:
        try:
            from dotenv import load_dotenv
            load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        except Exception:
            pass

    def _call_with_retry(
        self,
        fn: Callable[[], Any],
        label: str,
        *,
        use_fallback_on_error: bool = False,
        fallback_fn: Callable[[], Any] | None = None,
    ) -> str:
        """Execute `fn()` up to MAX_RETRIES times with capped exponential back-off.

        If `use_fallback_on_error` is True and `fallback_fn` is provided, the
        fallback callable is attempted once after all primary retries are exhausted.
        """
        last_exc: Exception | None = None
        for attempt in range(self.MAX_RETRIES):
            try:
                response = fn()
                return response.text or ""
            except Exception as exc:
                last_exc = exc
                delay = min(
                    self._retry_base_delay * (2 ** attempt),
                    self._retry_max_delay,
                )
                print(f"[{label}] attempt {attempt + 1} failed ({exc}); retrying in {delay:.1f}s")
                time.sleep(delay)

        # Attempt fallback if configured
        if use_fallback_on_error and fallback_fn is not None:
            try:
                print(f"[{label}] primary exhausted — trying fallback model")
                response = fallback_fn()
                return response.text or ""
            except Exception as exc:
                last_exc = exc

        raise RuntimeError(
            f"[{label}] failed after {self.MAX_RETRIES} attempts: {last_exc}"
        )

    @staticmethod
    def _normalize_script(raw: str) -> str:
        """Strip markdown fences and leading prose from a raw LLM response."""
        if not raw:
            return ""

        cleaned = raw.strip()
        fences = _CODE_FENCE_RE.findall(cleaned)
        if fences:
            cleaned = max(fences, key=len).strip()
        else:
            cleaned = re.sub(r"^```(?:scad|openscad|text)?\s*", "", cleaned, flags=re.I)
            cleaned = re.sub(r"```$", "", cleaned)
            cleaned = cleaned.strip()

        # Fast-forward to the first recognizable OpenSCAD token
        m = _CODE_START_RE.search(cleaned)
        if m:
            cleaned = cleaned[m.start():].strip()

        return cleaned

    @staticmethod
    def _validate_and_repair(script: str) -> str:
        """Post-generation hallucination repair pass.

        Fixes known WASM crash patterns that slip through the prompt:
          - orient=X/Y/Z bare identifiers  → explicit vector literals
          - Missing BOSL2 include when BOSL2 modules are used
          - $fn > 32 cap enforcement
        """
        if not script:
            return script

        # 1. Fix orient=X/Y/Z bare identifiers
        script = _ORIENT_X_RE.sub('orient=[1,0,0]', script)
        script = _ORIENT_Y_RE.sub('orient=[0,1,0]', script)
        script = _ORIENT_Z_RE.sub('orient=[0,0,1]', script)

        # 2. Ensure BOSL2 include is present when BOSL2 modules are detected
        if _BOSL2_MODULES.search(script) and 'BOSL2' not in script:
            script = 'include <BOSL2/std.scad>\n\n' + script

        # 3. Cap $fn: replace any $fn = <number> > 32 with $fn = 32
        def _cap_fn(m: re.Match) -> str:
            val = int(m.group(1))
            return f"$fn = {min(val, 32)};"
        script = re.sub(r'\$fn\s*=\s*(\d+)\s*;', _cap_fn, script)

        return script

    def _build_thinking_config(self, level: str) -> "types.ThinkingConfig":
        """Map a plain level string to the SDK ThinkingLevel enum."""
        level_map = {
            "HIGH":   types.ThinkingLevel.HIGH,
            "MEDIUM": types.ThinkingLevel.MEDIUM,
            "LOW":    types.ThinkingLevel.LOW,
        }
        return types.ThinkingConfig(thinking_level=level_map.get(level.upper(), types.ThinkingLevel.MEDIUM))

    def _make_config(
        self,
        *,
        system_instruction: str,
        thinking_level: str | None,
        response_mime_type: str | None = None,
    ) -> "types.GenerateContentConfig":
        """Build a GenerateContentConfig with optional ThinkingConfig.

        - If the active model does NOT support thinking, `thinking_level` is ignored.
        - Non-thinking fallback model gets a bare config (temperature=0, no thinking).
        """
        params: dict[str, Any] = {
            "system_instruction": system_instruction,
            "temperature": 0.0,
        }
        if response_mime_type:
            params["response_mime_type"] = response_mime_type

        if thinking_level and _supports_thinking(self.model):
            params["thinking_config"] = self._build_thinking_config(thinking_level)

        return types.GenerateContentConfig(**params)

    def _safe_generate_content(
        self,
        model: str,
        contents: Any,
        config: "types.GenerateContentConfig",
    ) -> Any:
        """Call generate_content, automatically retrying without thinking_config if unsupported."""
        try:
            return self.client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
        except Exception as exc:
            exc_str = str(exc)
            if "Thinking level is not supported" in exc_str or "INVALID_ARGUMENT" in exc_str:
                if hasattr(config, "thinking_config") and config.thinking_config is not None:
                    print(f"[llm_codegen] Model {model} does not support thinking_config. Retrying without thinking.")
                    config.thinking_config = None
                    return self.client.models.generate_content(
                        model=model,
                        contents=contents,
                        config=config,
                    )
            raise exc

    # ------------------------------------------------------------------ public API

    def audit_blueprint(
        self,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict[str, Any]:
        """Stage 1 — Analyse a blueprint image inline and return a feature-map dict.

        Thinking level: HIGH (vision + spatial reasoning demand maximum depth).
        """
        file_hash = hashlib.md5(image_bytes).hexdigest()

        with _CACHE_LOCK:
            if file_hash in _BLUEPRINT_CACHE:
                if "feature_map" in _BLUEPRINT_CACHE[file_hash]:
                    print(f"[audit] Cache hit for image hash {file_hash}")
                    return _BLUEPRINT_CACHE[file_hash]["feature_map"]

        image_part = types.Part.from_bytes(data=image_bytes, mime_type=mime_type)
        config     = self._make_config(
            system_instruction=AUDIT_INSTRUCTION,
            thinking_level="HIGH",
            response_mime_type="application/json",
        )

        def _primary_call() -> Any:
            return self._safe_generate_content(
                model=self.model,
                contents=[image_part],
                config=config,
            )

        def _fallback_call() -> Any:
            fallback_cfg = types.GenerateContentConfig(
                system_instruction=AUDIT_INSTRUCTION,
                temperature=0.0,
                response_mime_type="application/json",
            )
            return self._safe_generate_content(
                model=self.fallback_model,
                contents=[image_part],
                config=fallback_cfg,
            )

        raw = self._call_with_retry(
            _primary_call, "audit",
            use_fallback_on_error=True,
            fallback_fn=_fallback_call,
        )

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
        """Stage 2 — Synthesise or refine an OpenSCAD script.

        Thinking level:
          HIGH   — when an image or feature_map is provided (full blueprint reasoning)
          MEDIUM — text-only new generation
          LOW    — when base_code is provided AND no image (refinement pass)

        If `base_code` is provided, Gemini will refine the existing script rather
        than generating from scratch.
        """
        # Determine thinking level based on available context
        has_vision   = bool(image_bytes and mime_type)
        has_features = bool(feature_map)
        has_base     = bool(base_code)

        if has_vision or has_features:
            thinking_level = "HIGH"
        elif has_base:
            thinking_level = "LOW"
        else:
            thinking_level = "MEDIUM"

        # Build user content string
        parts: list[str] = [f"REQUEST: {prompt}"]
        if feature_map:
            parts.append(f"FEATURE_MAP:\n{json.dumps(feature_map, indent=2)}")
        if base_code:
            parts.append(f"EXISTING_CODE_TO_REFINE:\n{base_code}")
        if selection_context:
            parts.append(f"USER_SELECTION_CONTEXT:\n{selection_context}")

        user_text = "\n\n".join(parts)

        # Assemble multimodal content list (system_instruction goes into config now)
        contents: list[Any] = []
        if has_vision:
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))  # type: ignore[arg-type]
        contents.append(types.Part.from_text(text=user_text))

        config = self._make_config(
            system_instruction=SYSTEM_INSTRUCTION,
            thinking_level=thinking_level,
        )

        def _primary_call() -> Any:
            return self._safe_generate_content(
                model=self.model,
                contents=contents,
                config=config,
            )

        def _fallback_call() -> Any:
            fallback_cfg = types.GenerateContentConfig(
                system_instruction=SYSTEM_INSTRUCTION,
                temperature=0.0,
            )
            return self._safe_generate_content(
                model=self.fallback_model,
                contents=contents,
                config=fallback_cfg,
            )

        raw = self._call_with_retry(
            _primary_call, "codegen",
            use_fallback_on_error=True,
            fallback_fn=_fallback_call,
        )
        script = self._normalize_script(raw)
        return self._validate_and_repair(script)

    def edit_script(
        self,
        prompt: str,
        current_code: str,
        target_point: list[float] | None = None,
    ) -> str:
        """Surgically edit an existing OpenSCAD script based on a user prompt.

        Thinking level:
          MEDIUM — structural edits (default)
          LOW    — detected as a simple parameter value change
        """
        user_prompt = prompt

        if target_point and len(target_point) == 3:
            x, y, z = target_point
            user_prompt += (
                f"\n\n[System Context: The user clicked on the 3D mesh at absolute "
                f"coordinates X: {x}, Y: {y}, Z: {z}. Use this exact spatial location "
                f"as the origin/target for the requested modification.]"
            )

        # Heuristic: if the prompt looks like a simple number change, use LOW thinking
        _simple_edit_re = re.compile(
            r'\b(?:set|change|make|update|increase|decrease|resize)\b.*\b\d+(?:\.\d+)?\b',
            re.I,
        )
        thinking_level = "LOW" if _simple_edit_re.search(prompt) else "MEDIUM"

        user_text = f"CURRENT_CODE:\n{current_code}\n\nUSER_REQUEST:\n{user_prompt}"
        contents  = [types.Part.from_text(text=user_text)]

        config = self._make_config(
            system_instruction=EDIT_SYSTEM_PROMPT,
            thinking_level=thinking_level,
        )

        def _primary_call() -> Any:
            return self._safe_generate_content(
                model=self.model,
                contents=contents,
                config=config,
            )

        def _fallback_call() -> Any:
            # Simple edits run directly on the fallback model (fast, no thinking needed)
            fallback_cfg = types.GenerateContentConfig(
                system_instruction=EDIT_SYSTEM_PROMPT,
                temperature=0.0,
            )
            return self._safe_generate_content(
                model=self.fallback_model,
                contents=contents,
                config=fallback_cfg,
            )

        raw = self._call_with_retry(
            _primary_call, "edit",
            use_fallback_on_error=True,
            fallback_fn=_fallback_call,
        )
        script = self._normalize_script(raw)
        return self._validate_and_repair(script)
