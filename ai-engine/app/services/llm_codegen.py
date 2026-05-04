import os
import re
import time
import json
import uuid
from datetime import datetime
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


CORE_INSTRUCTION = """
# CAD COPILOT V6: Professional Engineering Protocol
You are a Senior CAD Architect. Your mission is 100% feature-perfect `build123d` scripts.

## MANDATORY CONTRACT
1. **PARAMETERS**: Capture every dimension, tolerance, and quantity in `PARAMETERS = { ... }`.
2. **FUNCTION**: `def build_model(params: dict) -> Part:` is the only entry point.
3. **FEATURE PARITY**: If a feature is on the blueprint, it MUST be in the code. No omissions.
4. **COMPACTNESS**: Chain operations like `(Part - Pocket).fillet()`. No comments allowed.

## TOPOLOGICAL PRECISION
- **Face Selection**: Use `.faces().sort_by(Axis.Z)[-1]` for the top face or `[0]` for the bottom.
- **Edge Selection**: Use `.edges().filter_by(GeomType.CIRCLE)` for hole fillets/chamfers.
- **Sketching**: Use `with BuildSketch(my_part.faces().sort_by(Axis.Z)[-1]) as s:` for plane-perfect sketching.
- **Patterns**: For hole arrays, use `Circle(r) * PolarLocation(R, n)` or `GridLocation(dx, dy, nx, ny)`.

## GEOMETRY RULES
- **Primitives**: Standalone constructors are TitleCase: `Box()`, `Sphere()`, `Cylinder()`, `Rectangle()`, `Circle()`.
- **Operations**: Geometric operations MUST be lowercase: `extrude()`, `revolve()`, `loft()`, `sweep()`, `fillet()`, `chamfer()`.
- **Rotation**: `Location((x,y,z), (rx,ry,rz))` only. NEVER use `.rotate()`.
- **Robustness**: Mandatory `try: ... except: pass` for all `fillet()` and `chamfer()` operations.
""".strip()

SAFETY_INSTRUCTION = """
# TOPOLOGICAL SAFETY
- DIMS: Use `max(0.01, v)` for thin walls.
- BOOLEANS: Use (+, -, &). Avoid `BuildPart` context.
- TYPE: NEVER pass raw tuples where `Location` or `Vector` is expected.
""".strip()

SUMMARISATION_INSTRUCTION = """
## ARCHITECTURAL AUDIT (V6)
Analyze the blueprint as a Lead Mechanical Engineer. 

1. **Section-First Analysis**: Start with Section Views (A-A, B-B). These are the source of truth for internal ports, bores, and wall thicknesses.
2. **Envelope & Datum**: Identify the primary Bounding Box and the coordinate origin (Datum).
3. **Topology Mapping**: 
   - External: Main prismatic or cylindrical body features.
   - Internal: Every internal cavity, counterbore, and transition.
4. **Pattern Extraction**: Identify all circular (PCD) and rectangular hole patterns.
5. **Annotation Audit**: Capture every numeric value, thread spec (M/UNC), and fillet/chamfer radius.

RULE: Every number on the drawing must be mapped to a Parameter. 
Return ONLY the comprehensive feature summary. No code.
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
        self.model = model or os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")
        
        # Configuration & Budgets
        self.max_retries = max(1, int(os.getenv("GENAI_MAX_RETRIES", "5")))
        self.max_prompt_tokens = int(os.getenv("MAX_PROMPT_TOKENS", "12000"))
        self.max_output_tokens = int(os.getenv("MAX_OUTPUT_TOKENS", "2048"))
        self.include_safety = os.getenv("GENAI_SAFETY", "0") == "1"
        
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
        return "\n\n".join(instructions)

    def summarise_blueprint(
        self,
        image_bytes: bytes,
        image_mime_type: str,
    ) -> str:
        """
        Stage 1: Extract features and dimensions into a text summary.
        """
        parts = [
            types.Part.from_text(text=SUMMARISATION_INSTRUCTION),
            types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
        ]
        
        response = self.client.models.generate_content(
            model=self.model,
            contents=parts,
            config=types.GenerateContentConfig(
                temperature=0.0,
                max_output_tokens=1024,
            )
        )
        
        return response.text or ""

    def stream_build123d_script(
        self,
        prompt: str,
        image_bytes: bytes,
        image_mime_type: str,
        summary: str | None = None,
    ) -> Iterator[str]:
        full_system_instruction = self._prepare_full_instruction()
        
        context_block = ""
        if summary:
            context_block = f"\n\n### BLUEPRINT ANALYSIS SUMMARY\n{summary}\n"
            
        user_prompt = f"CAD request: {prompt.strip()}{context_block}"

        # 1. Budget Check
        try:
            token_count_response = self.client.models.count_tokens(
                model=self.model,
                contents=[
                    full_system_instruction,
                    user_prompt,
                    types.Part.from_bytes(data=image_bytes, mime_type=image_mime_type),
                ]
            )
            total_tokens = token_count_response.total_tokens
            if total_tokens > self.max_prompt_tokens:
                raise RuntimeError(f"Prompt is too large ({total_tokens} tokens). Max budget is {self.max_prompt_tokens}.")
        except Exception as e:
            if "too large" in str(e): raise
            # Silently continue if API count_tokens fails for other reasons

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
        last_exception: Exception | None = None
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

                is_last_attempt = attempt >= self.max_retries
                if is_last_attempt or not self._is_retryable_error(exc):
                    break

                backoff_delay = self.retry_base_delay_seconds * (2 ** (attempt - 1))
                delay = max(backoff_delay, retry_after_seconds or 0.0)
                delay = min(delay, self.max_retry_delay_seconds)
                time.sleep(delay)

        self._log_diagnostic(prompt, "".join(raw_output_chunks), str(last_exception) if last_exception else "Max retries exceeded")

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

        raise RuntimeError(
            "Unable to generate CAD script right now. Please retry."
        )

    def _log_diagnostic(self, prompt: str, raw_output: str, error: str | None) -> None:
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
                "error": error
            }
            
            with open(log_file, "w", encoding="utf-8") as f:
                json.dump(log_data, f, indent=2)
        except Exception as e:
            print(f"Failed to write diagnostic log: {e}")

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
