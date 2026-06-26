from __future__ import annotations
import re
import logging
from pathlib import Path

# Setup logs directory
LOG_DIR = Path(__file__).resolve().parents[3] / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

app_logger = logging.getLogger("app")
app_logger.setLevel(logging.INFO)

if not app_logger.handlers:
    file_handler = logging.FileHandler(LOG_DIR / "app.log", encoding="utf-8")
    formatter = logging.Formatter("[%(asctime)s] %(levelname)s [%(name)s]: %(message)s")
    file_handler.setFormatter(formatter)
    app_logger.addHandler(file_handler)

# Regular expressions for post-gen repairs
_CODE_FENCE_RE = re.compile(r"```(?:scad|openscad|text)?\s*(.*?)```", re.I | re.S)
_CODE_START_RE = re.compile(
    r"(?m)^(?:include\s*<|/\*\s*PARAMETERS_JSON|//\s*PARAMETERS_START|module\s+\w+\s*\(|\$fn\s*=)"
)
_ORIENT_X_RE = re.compile(r'\borient\s*=\s*X\b')
_ORIENT_Y_RE = re.compile(r'\borient\s*=\s*Y\b')
_ORIENT_Z_RE = re.compile(r'\borient\s*=\s*Z\b')
_BOSL2_MODULES = re.compile(r'\b(?:cuboid|cyl|xcyl|ycyl|zcyl|prismoid|sphere|torus)\s*\(')

class UseCaseBase:
    """Base class providing standard normalization and script repair utilities."""
    
    def __init__(self) -> None:
        self.logger = app_logger
    
    @staticmethod
    def _normalize_script(raw: str) -> str:
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

        m = _CODE_START_RE.search(cleaned)
        if m:
            cleaned = cleaned[m.start():].strip()
        return cleaned

    @staticmethod
    def _validate_and_repair(script: str) -> str:
        if not script:
            return script
        # 1. Enforce explicit direction vectors (orient=[1,0,0] etc.)
        script = _ORIENT_X_RE.sub('orient=[1,0,0]', script)
        script = _ORIENT_Y_RE.sub('orient=[0,1,0]', script)
        script = _ORIENT_Z_RE.sub('orient=[0,0,1]', script)

        # 2. Add standard BOSL2 include if modules are used
        if _BOSL2_MODULES.search(script) and 'BOSL2' not in script:
            script = 'include <BOSL2/std.scad>\n\n' + script

        # 3. Cap $fn values at 32 for WASM performance stability
        def _cap_fn(m: re.Match) -> str:
            val = int(m.group(1))
            return f"$fn = {min(val, 32)};"
        script = re.sub(r'\$fn\s*=\s*(\d+)\s*;', _cap_fn, script)
        return script
