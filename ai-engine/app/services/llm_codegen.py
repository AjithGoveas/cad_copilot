import json
import logging
import os
import re
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Iterator, Optional

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    types = None
    GENAI_AVAILABLE = False


logger = logging.getLogger(__name__)

# ============================================================================
# SYSTEM PROMPTS & ENGINEERING CONTRACTS
# ============================================================================

CORE_INSTRUCTION = """
# CAD COPILOT V7: Principal Engineering Protocol
You are a Principal CAD Software Engineer. Your mission is 100% feature-perfect, mathematically robust `build123d` scripts.

## MANDATORY CONTRACT
1. **PARAMETERS**: Extract EVERY dimension, tolerance, and quantity into `PARAMETERS = { ... }`.
2. **FUNCTION**: `def build_model(params: dict) -> Part:` is the ONLY entry point.
3. **FEATURE PARITY**: Every dimension extracted from the blueprint MUST map to a feature.
4. **NO YAP**: Output ONLY the python code block. No explanations or notes.

## DATA RULES (NO HALLUCINATIONS)
- Units are **millimeters**. Use floats for all dimensional parameters.
- Never invent dimensions. If a value is not shown, keep the feature simple and avoid guessing.
- Merge parameters at the top of `build_model`: `params = {**PARAMETERS, **params}`.
- Keep parameters as **diameters**; use `d / 2` only at the point of use.

## GEOMETRY RULES (ROBUSTNESS)
- Identify axisymmetry (centerline + circular view). If axisymmetric, create a full closed profile on `Plane.XZ` and `revolve(axis=Axis.Z)`.
- For milled parts, sketch on planar faces using `BuildSketch` and `extrude()`.
- Use arcs/lines; avoid splines unless explicitly dimensioned.
- For counterbores, subtract the **largest diameter first**, then inner bores on the same axis.
- For tapped holes, use **minor drill diameter**; do not model helical threads unless the profile is explicitly defined.
- For hex or flats, use `RegularPolygon` or a 6-sided `Polygon` aligned to the axes.
- Always set `mode=Mode.SUBTRACT` for cut features and use `both=True` for through cuts.

## CRITICAL OCP ERROR PREVENTION (ZERO-FAIL GEOMETRY)
- **Face Creation**: `Polyline(*pts, close=True)` MUST be indented inside a `with BuildLine():` context. Call `make_face()` immediately after.
- **Non-Intersection Rule**: Trace coordinates in a single continuous path (CW or CCW). NEVER cross or re-trace an existing segment.
- **Hollow Axisymmetry**: For tubes, sleeves, and core drills, draw the full closed wall thickness profile and revolve.
- **Topological Filtering**: Wrap chamfers/fillets in `try...except: pass`. Filter by geometry and check non-empty selections.
  ```python
  try:
      edges = part.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[0]
      chamfer(edges.sort_by(SortBy.RADIUS)[-1], length=1.0)
  except Exception:
      pass
  ```

## PHASE-BASED CONSTRUCTION (STRICT ORDER)
1. `# Main Body`: Primary envelope (revolve/extrude).
2. `# Internal Cavities`: Counterbores, stepped bores, central pockets.
3. `# Hole Patterns`: PCDs, grids, slots, keyways (Mode.SUBTRACT).
4. `# Finishing`: Fillets and chamfers inside a `try...except` block.
""".strip()


SAFETY_INSTRUCTION = """
# TOPOLOGICAL SAFETY
- DIMS: Use `max(0.01, v)` for thin walls.
- BOOLEANS: Use (+, -, &) operators. Avoid `BuildPart` context unless required.
- TYPE: NEVER pass raw tuples where `Location` or `Vector` is expected.
""".strip()


SUMMARISATION_INSTRUCTION = """
## ARCHITECTURAL AUDIT - INDUSTRIAL PRECISION PARTS
Analyze the blueprint as a Lead Mechanical Engineer for precision manufacturing.

1. **Section-First Synthesis**: Use section views as ground truth for internal cavities and wall thickness.
2. **Axisymmetry Check**: Determine if the part is revolved or prismatic/milled.
3. **Datum & Origin**: Identify stable datums and a consistent origin.
4. **Internal Topology Mapping**: Map nested bores, stepped diameters, counterbores, and shoulders.
5. **Hole Patterns**: Extract PCDs/grids, hole counts, and minor diameters for tapped holes.
6. **Feature Geometry**: Extract slots, relief grooves, fillets, chamfers, and angles.
7. **Annotation Audit**: Capture EVERY numeric dimension and tolerance.

RULE: Every single number and feature annotation must map to a Parameter.
RULE: Do not invent values. If a value is ambiguous, flag it as "ambiguous" in the summary.
Return ONLY the comprehensive feature summary with clear parameter names and values. No code.
""".strip()


FEW_SHOT_EXAMPLE = """
### REFERENCE EXAMPLE (DO NOT COPY VALUES)
```python
from build123d import *

PARAMETERS = {
    "OUTER_DIA": 83.820,
    "TOTAL_LENGTH": 160.0,
    "SLOT_WIDTH": 6.35,
    "SLOT_DEPTH": 8.2,
    "CUP_HEIGHT": 80.0,
    "WALL_THICKNESS": 4.0,
    "SHANK_DIA": 24.60,
    "BASE_THICKNESS": 12.0,
    "SIDE_SLOT_LENGTH": 45.0,
    "SIDE_SLOT_WIDTH": 8.0,
}

def build_model(params: dict) -> Part:
    p = {**PARAMETERS, **params}

    with BuildPart() as part:
        # Main Body: Revolve closed profile
        with BuildSketch(Plane.XZ):
            with BuildLine():
                pts = [
                    (p["OUTER_DIA"] / 2 - p["WALL_THICKNESS"], 0),
                    (p["OUTER_DIA"] / 2, 0),
                    (p["OUTER_DIA"] / 2, p["CUP_HEIGHT"]),
                    (p["SHANK_DIA"] / 2, p["CUP_HEIGHT"] + 15),
                    (p["SHANK_DIA"] / 2, p["TOTAL_LENGTH"]),
                    (0, p["TOTAL_LENGTH"]),
                    (0, p["CUP_HEIGHT"] - p["BASE_THICKNESS"]),
                    (p["OUTER_DIA"] / 2 - p["WALL_THICKNESS"], p["CUP_HEIGHT"] - p["BASE_THICKNESS"]),
                ]
                Polyline(*pts, close=True)
            make_face()
        revolve(axis=Axis.Z)

        # Slots: subtract sketches
        with BuildSketch(Plane.XY):
            with PolarLocations(radius=p["OUTER_DIA"] / 2, count=4):
                Rectangle(width=p["SLOT_DEPTH"] * 2, height=p["SLOT_WIDTH"])
        extrude(amount=p["SLOT_DEPTH"], mode=Mode.SUBTRACT)

        with BuildSketch(Plane.XZ):
            with Locations((0, p["CUP_HEIGHT"] / 2 - 5)):
                SlotOverall(width=p["SIDE_SLOT_LENGTH"], height=p["SIDE_SLOT_WIDTH"], rotation=90)
        extrude(amount=p["OUTER_DIA"], both=True, mode=Mode.SUBTRACT)

        with BuildSketch(Plane.YZ):
            with Locations((0, p["CUP_HEIGHT"] / 2 - 5)):
                SlotOverall(width=p["SIDE_SLOT_LENGTH"], height=p["SIDE_SLOT_WIDTH"], rotation=90)
        extrude(amount=p["OUTER_DIA"], both=True, mode=Mode.SUBTRACT)

        # Finishing
        try:
            bottom_edges = part.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[0]
            chamfer(bottom_edges.sort_by(SortBy.RADIUS)[-1], length=1.0)
        except Exception:
            pass

    return part.part
```
""".strip()


# ============================================================================
# REGULAR EXPRESSION PATTERNS
# ============================================================================

CODE_BLOCK_RE = re.compile(r"```(?:python|py)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)
LIKELY_CODE_START_RE = re.compile(
    r"(?m)^(?:from\s+\w+\s+import\s+|import\s+\w+|PARAMETERS\s*=|def\s+build_model\s*\(|def\s+\w+\s*\(|class\s+\w+\s*\(|@|\w+\s*=)"
)


# ============================================================================
# LLM CODEGEN SERVICE
# ============================================================================

class LLMCodegenService:
    """AI-powered CAD script generation service."""

    def __init__(self, model: Optional[str] = None) -> None:
        if not GENAI_AVAILABLE or genai is None or types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        self._load_env_file()
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set.")

        self.client = genai.Client(api_key=api_key)
        self.model = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")
        self.summary_model = os.getenv("GENAI_SUMMARY_MODEL", self.model)

        self.max_retries = max(1, int(os.getenv("GENAI_MAX_RETRIES", "5")))
        self.max_prompt_tokens = int(os.getenv("MAX_PROMPT_TOKENS", "12000"))
        self.max_output_tokens = int(os.getenv("MAX_OUTPUT_TOKENS", "2048"))
        self.include_safety = os.getenv("GENAI_SAFETY", "0") == "1"
        self.include_example = os.getenv("GENAI_INCLUDE_EXAMPLE", "1") == "1"

        self.summary_max_retries = max(1, int(os.getenv("GENAI_SUMMARY_MAX_RETRIES", "3")))
        self.summary_retry_base_delay_seconds = float(
            os.getenv("GENAI_SUMMARY_RETRY_BASE_DELAY", "1.5")
        )
        self.retry_base_delay_seconds = float(os.getenv("GENAI_RETRY_BASE_DELAY", "1.5"))
        self.max_retry_delay_seconds = float(os.getenv("GENAI_MAX_RETRY_DELAY", "60"))

    @staticmethod
    def _load_env_file() -> None:
        try:
            import importlib

            dotenv = importlib.import_module("dotenv")
            project_root = Path(__file__).resolve().parents[2]
            dotenv.load_dotenv(project_root / ".env")
        except Exception:
            return

    def _prepare_full_instruction(self) -> str:
        instructions = [CORE_INSTRUCTION]
        if self.include_safety:
            instructions.append(SAFETY_INSTRUCTION)
        if self.include_example:
            instructions.append(FEW_SHOT_EXAMPLE)
        return "\n\n".join(instructions)

    def summarise_blueprint(self, image_bytes: bytes, image_mime_type: str) -> str:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        parts = [
            types.Part.from_text(text=SUMMARISATION_INSTRUCTION),
            types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
        ]

        last_exception: Optional[Exception] = None
        for attempt in range(1, self.summary_max_retries + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.summary_model,
                    contents=parts,
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        max_output_tokens=1024,
                    ),
                )
                return response.text or ""
            except Exception as exc:
                last_exception = exc
                if attempt >= self.summary_max_retries or not self._is_retryable_error(exc):
                    break
                backoff_delay = self.summary_retry_base_delay_seconds * (2 ** (attempt - 1))
                delay = min(backoff_delay, self.max_retry_delay_seconds)
                logger.info(f"Retrying summary call in {delay}s due to: {exc}")
                time.sleep(delay)

        logger.warning(
            f"Summarisation stage failed, proceeding without summary: {last_exception}"
        )
        return ""

    def stream_build123d_script(
        self,
        prompt: str,
        image_bytes: bytes,
        image_mime_type: str,
        summary: Optional[str] = None,
    ) -> Iterator[str]:
        if types is None:
            raise RuntimeError("google-genai is not installed. Check dependencies.")

        full_system_instruction = self._prepare_full_instruction()
        context_block = f"\n\n### BLUEPRINT ANALYSIS SUMMARY\n{summary}\n" if summary else ""
        user_prompt = f"CAD request: {prompt.strip()}{context_block}"

        try:
            token_count_response = self.client.models.count_tokens(
                model=self.model,
                contents=[
                    full_system_instruction,
                    user_prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
                ],
            )
            total_tokens = token_count_response.total_tokens
            if total_tokens is None:
                total_tokens = 0
            if total_tokens > self.max_prompt_tokens:
                raise RuntimeError(
                    f"Prompt is too large ({total_tokens} tokens). Max budget is {self.max_prompt_tokens}."
                )
        except Exception as exc:
            if "Prompt is too large" in str(exc):
                raise

        content = types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=full_system_instruction),
                types.Part.from_text(text=user_prompt),
                types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
            ],
        )

        config = types.GenerateContentConfig(
            candidate_count=1,
            max_output_tokens=self.max_output_tokens,
            temperature=0.0,
            stop_sequences=["```"] if self.max_output_tokens < 1000 else None,
        )

        seen_errors: list[str] = []
        last_exception: Optional[Exception] = None
        raw_output_chunks: list[str] = []

        for attempt in range(1, self.max_retries + 1):
            try:
                yielded_any = False
                stream = self.client.models.generate_content_stream(
                    model=self.model,
                    contents=[content],
                    config=config,
                )

                for chunk in stream:
                    text = getattr(chunk, "text", "")
                    if text:
                        yielded_any = True
                        raw_output_chunks.append(text)
                        yield text

                if not yielded_any:
                    raise RuntimeError("Empty response from generate_content_stream")

                self._log_diagnostic(prompt, "".join(raw_output_chunks), None)
                return
            except Exception as exc:
                last_exception = exc
                error_text = str(exc)
                retry_after_seconds = self._extract_retry_delay_seconds(error_text)
                seen_errors.append(error_text)

                if attempt >= self.max_retries or not self._is_retryable_error(exc):
                    break

                backoff_delay = self.retry_base_delay_seconds * (2 ** (attempt - 1))
                delay = max(backoff_delay, retry_after_seconds or 0.0)
                delay = min(delay, self.max_retry_delay_seconds)
                time.sleep(delay)

        self._log_diagnostic(
            prompt,
            "".join(raw_output_chunks),
            str(last_exception) if last_exception else "Max retries exceeded",
        )

        joined_errors = "\n".join(seen_errors)
        if self._is_daily_quota_error(joined_errors):
            raise RuntimeError(
                "Model daily quota reached. Try again after quota reset or switch models."
            )

        if last_exception and self._is_quota_error(last_exception):
            raise RuntimeError(
                "Model quota is temporarily exhausted. Please retry in a few minutes."
            )

        if last_exception and self._is_transient_error(last_exception):
            raise RuntimeError(
                "Model is temporarily unavailable. Please retry shortly."
            )

        raise RuntimeError("Unable to generate CAD script right now. Please retry.")

    def _log_diagnostic(self, prompt: str, raw_output: str, error: Optional[str]) -> None:
        try:
            log_dir = Path(__file__).resolve().parents[2] / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            log_id = uuid.uuid4().hex[:8]
            log_file = log_dir / f"cad_gen_{timestamp}_{log_id}.json"

            log_data = {
                "timestamp": datetime.now().isoformat(),
                "model": self.model,
                "prompt": prompt,
                "raw_output": raw_output,
                "cleaned_output": self.normalize_script(raw_output) if raw_output else "",
                "error": error,
            }

            with open(log_file, "w", encoding="utf-8") as f:
                json.dump(log_data, f, indent=2)
        except Exception as exc:
            logger.error(f"Failed to write diagnostic log: {exc}")

    @staticmethod
    def _is_retryable_error(exc: Exception) -> bool:
        return LLMCodegenService._is_transient_error(exc) or LLMCodegenService._is_quota_error(exc)

    @staticmethod
    def _is_transient_error(exc: Exception) -> bool:
        message = str(exc).lower()
        transient_markers = (
            "503",
            "unavailable",
            "high demand",
            "deadline_exceeded",
            "timed out",
            "temporar",
            "try again later",
        )

        if any(marker in message for marker in transient_markers):
            return True

        status_code = getattr(exc, "status_code", None)
        if status_code in {408, 429, 500, 502, 503, 504}:
            return True

        return False

    @staticmethod
    def _is_quota_error(exc: Exception) -> bool:
        message = str(exc).lower()
        quota_markers = (
            "429",
            "resource_exhausted",
            "quota exceeded",
            "rate limit",
            "free_tier_requests",
        )
        return any(marker in message for marker in quota_markers)

    @staticmethod
    def _is_daily_quota_error(message: str) -> bool:
        normalized = message.lower()
        daily_markers = (
            "generaterequestsperday",
            "perday",
            "per day",
            "requests per day",
        )
        return any(marker in normalized for marker in daily_markers)

    @staticmethod
    def _extract_retry_delay_seconds(message: str) -> Optional[float]:
        patterns = (
            r"retry in\s+([0-9]+(?:\.[0-9]+)?)s",
            r"'retryDelay'\s*:\s*'([0-9]+(?:\.[0-9]+)?)s'",
            r'"retryDelay"\s*:\s*"([0-9]+(?:\.[0-9]+)?)s"',
        )

        for pattern in patterns:
            match = re.search(pattern, message, re.IGNORECASE)
            if match:
                try:
                    return float(match.group(1))
                except ValueError:
                    return None

        return None

    @staticmethod
    def normalize_script(script: str) -> str:
        if not script:
            return ""

        block_matches = CODE_BLOCK_RE.findall(script)
        if block_matches:
            candidates = [candidate.strip() for candidate in block_matches if candidate.strip()]
            if candidates:
                contract_match = [
                    candidate
                    for candidate in candidates
                    if "PARAMETERS" in candidate and "build_model" in candidate
                ]
                if contract_match:
                    return contract_match[0]
                return max(candidates, key=len)

        cleaned = script.strip().strip("`").strip()
        cleaned = cleaned.replace("```python", "").replace("```py", "").replace("```", "").strip()

        start_match = LIKELY_CODE_START_RE.search(cleaned)
        if start_match:
            cleaned = cleaned[start_match.start():].lstrip()

        return cleaned
