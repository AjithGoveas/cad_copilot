import os
import re
import time
from pathlib import Path
from typing import Any, Iterator

genai: Any
types: Any

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None


SYSTEM_INSTRUCTION = """
You are a strict Python code generator for build123d.

ABSOLUTE OUTPUT RULES:
- Output ONLY raw Python source code.
- Do NOT output markdown fences (no ``` blocks).
- Do NOT output explanations, greetings, notes, or any conversational text.
- Do NOT include prefixes like "Here is your code:".
- Do NOT include trailing commentary.

CRITICAL DIMENSION & MATH RULES (PREVENT KERNEL CRASHES):
1) Pay extreme attention to decimal points in drawings. Do not scale values up or down (e.g., 04.51 is 4.51mm, not 45.1mm).
2) NEVER allow a calculated height or thickness to be zero or negative. Wrap subtractions in `abs()` or `max(0.1, ...)` (e.g., `height=abs(params['total_h'] - params['flange_h'])`).
3) IGNORE TEXTUAL NOTES & TITLE BLOCKS: Ignore all manufacturing notes (e.g., 'Burrs and scratches not allowed', material specifications) and title block text. Only extract explicit mathematical dimensions, radii (R), and chamfers (C). Do NOT hallucinate structural features based on text descriptions.

REQUIRED CODE CONTRACT:
1) Import from build123d.
2) YOU MUST DECLARE A TOP-LEVEL DICTIONARY NAMED EXACTLY 'PARAMETERS' (ALL CAPS). IF YOU DO NOT DO THIS, THE SYSTEM WILL CRASH.
3) If the image lacks clear dimensions, INVENT reasonable placeholder variables (e.g., "width": 10.0) and put them in the PARAMETERS dictionary anyway. NEVER hardcode dimensions inside the functions.
4) Define build_model(params: dict) -> Part that returns the final build123d shape.

STRICT STYLE RULES (NON-NEGOTIABLE):
1) Use the Direct API (Algebra API) only.
2) Do NOT use context managers (no "with BuildPart()", "with BuildSketch()", etc.).
3) Do NOT use Builder pattern operations or builder-only helpers.
4) Base primitive shapes are Capitalized constructors (Box, Cylinder, Sphere, Cone, etc.).
5) GROUNDING: When creating base cylinders or boxes, ALWAYS anchor them to rest on the Z=0 plane using: `align=(Align.CENTER, Align.CENTER, Align.MIN)`.
6) Modification operations are strictly lowercase functions (fillet(), chamfer(), offset(), etc.).
7) EDGE SELECTION: Edge selection for circular rims MUST use `.edges().filter_by(GeomType.CIRCLE)`. NEVER use `filter_by(Axis.Z)` for circular edges.
8) Boolean composition must use algebra operators (+, -, &) on Part/Solid objects.
9) DEFENSIVE PROGRAMMING: You MUST wrap ALL edge selection logic AND fillet()/chamfer() operations inside a single `try...except Exception:` block. Catch all exceptions, `pass`, and return the unmodified body to prevent physics kernel crashes.
10) Axis and vector components must be uppercase (Axis.X/Axis.Y/Axis.Z and .X/.Y/.Z, never .x/.y/.z).
11) For translation/placement, use `.locate(Location(Vector(...)))` and NEVER call `.offset(...)` on Box/Cylinder/Sphere objects.

GOLDEN EXAMPLE (COPY THIS PATTERN):
```python
from build123d import *
PARAMETERS = {
    "outer_dia": 10.0,
    "inner_dia": 5.0,
    "total_height": 10.0,
    "flange_height": 2.0,
    "fillet_rad": 1.0
}
def build_model(params: dict) -> Part:
    # 1. Safe height math
    flange_h = params["flange_height"]
    top_h = max(0.1, params["total_height"] - flange_h)

    # 2. Base shapes (Capitalized, Grounded to Z=0)
    base = Cylinder(radius=params["outer_dia"]/2, height=flange_h, align=(Align.CENTER, Align.CENTER, Align.MIN))
    top = Cylinder(radius=params["inner_dia"]/2, height=top_h, align=(Align.CENTER, Align.CENTER, Align.MIN))

    # 3. Translation and Boolean Algebra
    top = top.locate(Location(Vector(0, 0, flange_h)))
    body = base + top

    # 4. Operations (Strictly lowercase, Circular Edge Selection, DEFENSIVE)
    try:
        circular_edges = body.edges().filter_by(GeomType.CIRCLE)
        target_edges = [e for e in circular_edges if abs(e.center().Z - flange_h) < 1e-4]
        if target_edges:
            body = fillet(target_edges, radius=params["fillet_rad"])
    except Exception:
        pass # Prevent crashes from IndexError or impossible geometry
    return body
```

If you cannot comply, output a minimal valid Python script that still follows this contract.
""".strip()


CODE_BLOCK_RE = re.compile(r"```(?:python|py)?\s*(.*?)```", re.IGNORECASE | re.DOTALL)
LIKELY_CODE_START_RE = re.compile(
    r"(?m)^(?:from\s+\w+\s+import\s+|import\s+\w+|PARAMETERS\s*=|def\s+build_model\s*\(|def\s+\w+\s*\(|class\s+\w+\s*\(|@|\w+\s*=)"
)


class LLMCodegenService:
    def __init__(self, model: str | None = None) -> None:
        if genai is None or types is None:
            raise RuntimeError(
                "google-genai is not installed. Install dependencies from requirements.txt first."
            )

        self._load_env_file()

        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise RuntimeError("GOOGLE_API_KEY is not set.")

        self.client = genai.Client(api_key=api_key)
        # Use one primary model from env/config to keep generation predictable.
        self.model = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")
        self.max_retries = max(1, int(os.getenv("GENAI_MAX_RETRIES", "5")))
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

    def stream_build123d_script(
        self,
        prompt: str,
        image_bytes: bytes,
        image_mime_type: str,
    ) -> Iterator[str]:
        user_prompt = (
            "Generate a build123d script for this CAD request.\n"
            "User request:\n"
            f"{prompt}\n\n"
            "Follow the system requirements exactly."
        )

        content = types.Content(
            role="user",
            parts=[
                types.Part.from_text(text=SYSTEM_INSTRUCTION),
                types.Part.from_text(text=user_prompt),
                types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
            ],
        )

        config = types.GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=4096,
        )

        errors: list[str] = []
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
                        yield text

                if not yielded_any:
                    raise RuntimeError("Empty response from generate_content_stream")

                return
            except Exception as exc:
                error_text = str(exc)
                retry_after_seconds = self._extract_retry_delay_seconds(error_text)
                errors.append(f"model={self.model} attempt={attempt} error={error_text}")

                is_last_attempt = attempt >= self.max_retries
                if is_last_attempt or not self._is_retryable_error(exc):
                    break

                backoff_delay = self.retry_base_delay_seconds * (2 ** (attempt - 1))
                delay = max(backoff_delay, retry_after_seconds or 0.0)
                delay = min(delay, self.max_retry_delay_seconds)
                time.sleep(delay)

        error_summary = " | ".join(errors[-4:]) if errors else "Unknown generation error"
        if self._contains_daily_quota_error(errors):
            raise RuntimeError(
                "Gemini daily free-tier quota appears exhausted for the configured model. "
                "Try again after quota reset, switch to a billed key, or update GENAI_MODEL in ai-engine/.env. "
                f"Details: {error_summary}"
            )

        raise RuntimeError(
            "Model generation is temporarily unavailable. "
            "Please retry in a moment, or update GENAI_MODEL in ai-engine/.env. "
            f"Details: {error_summary}"
        )

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
    def _contains_daily_quota_error(errors: list[str]) -> bool:
        return any(LLMCodegenService._is_daily_quota_error(entry) for entry in errors)

    @staticmethod
    def _extract_retry_delay_seconds(message: str) -> float | None:
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

        # 1) Primary path: extract fenced python blocks if present.
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

        # 2) Fallback path: treat response as raw code and trim stray backticks/whitespace.
        cleaned = script.strip().strip("`").strip()
        cleaned = cleaned.replace("```python", "").replace("```py", "").replace("```", "").strip()

        # 3) Heuristic: drop leading conversational text before first likely code line.
        start_match = LIKELY_CODE_START_RE.search(cleaned)
        if start_match:
            cleaned = cleaned[start_match.start() :].lstrip()

        return cleaned
