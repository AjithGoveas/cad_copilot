import json
import os
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict

# This is the pure Python harness that runs in the isolated subprocess.
# We use a template to avoid complex f-string escaping.
RENDER_HARNESS_TEMPLATE = r"""
import json
import os
import sys
import math
from pathlib import Path
from functools import reduce
import operator

# Pre-load CAD library
try:
    from build123d import *
except ImportError:
    print("CRITICAL: build123d not found.")
    sys.exit(1)

def run():
    # 1. Load Protocol Parameters
    raw_json = os.getenv("CAD_PARAMETERS_JSON", "{}")
    try:
        params = json.loads(raw_json)
    except:
        params = {}

    # 2. Setup isolated execution namespace
    # We pre-populate this with build123d symbols so the script is robust.
    ns = {
        "PARAMETERS": params,
        "__name__": "__main__",
        "math": math,
    }
    
    # Load symbols
    import build123d
    ns.update({k: getattr(build123d, k) for k in dir(build123d) if not k.startswith('_')})

    # 3. Execute
    try:
        exec(Path("user_script.py").read_text(encoding="utf-8"), ns)
    except Exception:
        import traceback, sys
        print("\n---TRACEBACK_START---", flush=True)
        traceback.print_exc(file=sys.stdout)
        print("---TRACEBACK_END---", flush=True)
        sys.exit(1)

    # 4. Result extraction
    shape = None
    if "build_model" in ns and callable(ns["build_model"]):
        try:
            res = ns["build_model"](params)
            shape = reduce(operator.add, res) if isinstance(res, (list, tuple)) else res
        except Exception:
            import traceback, sys
            print("\n---TRACEBACK_START---", flush=True)
            traceback.print_exc(file=sys.stdout)
            print("---TRACEBACK_END---", flush=True)
            sys.exit(1)
            
    if shape is None:
        for n in ("model", "part", "result", "assembly", "shape", "solid"):
            if n in ns: shape = ns[n]; break

    if shape is None:
        print("RENDER_ERROR: No exportable shape found.")
        sys.exit(1)

    # 5. Export
    out_dir = Path(os.getenv("OUTPUT_DIR", "."))
    basename = os.getenv("OUTPUT_BASENAME", "model")
    try:
        export_step(shape, str(out_dir / f"{basename}.step"))
        export_stl(shape, str(out_dir / f"{basename}.stl"))
    except Exception as e:
        print(f"EXPORT_ERROR: {e}")
        sys.exit(1)
    basename = os.getenv("OUTPUT_BASENAME", "model")
    
    try:
        export_step(shape, str(out_dir / f"{basename}.step"))
        export_stl(shape, str(out_dir / f"{basename}.stl"))
    except Exception as e:
        print(f"EXPORT_ERROR: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run()
"""

class ParameterRenderService:
    def __init__(self, outputs_dir: Path | None = None) -> None:
        project_root = Path(__file__).resolve().parents[2]
        self.outputs_dir = outputs_dir or (project_root / "outputs")
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def render_to_outputs(
        self,
        parameters: Dict[str, Any],
        script: str,
        output_basename: str,
    ) -> Dict[str, str]:
        self.clear_outputs()
        
        with tempfile.TemporaryDirectory(prefix="cad_v3_") as temp_dir:
            tmp = Path(temp_dir)
            
            # Write the raw AI script
            (tmp / "user_script.py").write_text(script, encoding="utf-8")
            # Write the harness
            (tmp / "harness.py").write_text(RENDER_HARNESS_TEMPLATE, encoding="utf-8")

            # Environment for the worker
            env = os.environ.copy()
            env["CAD_PARAMETERS_JSON"] = json.dumps(parameters)
            env["OUTPUT_DIR"] = str(self.outputs_dir)
            env["OUTPUT_BASENAME"] = output_basename

            try:
                proc = subprocess.run(
                    [sys.executable, "harness.py"],
                    capture_output=True,
                    text=True,
                    cwd=temp_dir,
                    env=env,
                    timeout=180
                )
            except subprocess.TimeoutExpired:
                raise RuntimeError("Render Engine timed out. Geometry might be too complex.")

            if proc.returncode != 0:
                full_log = (proc.stdout or "") + (proc.stderr or "")
                error_msg = self._parse_worker_error(full_log)
                self._log_fail(script, parameters, full_log)
                raise RuntimeError(error_msg)

        # Verification
        stl_path = self.outputs_dir / f"{output_basename}.stl"
        step_path = self.outputs_dir / f"{output_basename}.step"

        if not stl_path.exists():
            raise RuntimeError("Render finished but artifacts are missing.")

        return {
            "stl_path": str(stl_path),
            "step_path": str(step_path),
        }

    def _parse_worker_error(self, log: str) -> str:
        if "---TRACEBACK_START---" in log:
            try:
                parts = log.split("---TRACEBACK_START---")
                inner = parts[-1].split("---TRACEBACK_END---")[0].strip()
                # Get the last non-empty line of the traceback
                lines = [l.strip() for l in inner.splitlines() if l.strip()]
                if lines:
                    return f"Render failed: {lines[-1]}"
            except:
                pass
            
        if "RENDER_ERROR:" in log:
            return log.split("RENDER_ERROR:")[1].strip().splitlines()[0]
            
        if "EXPORT_ERROR:" in log:
            return log.split("EXPORT_ERROR:")[1].strip().splitlines()[0]
            
        return "Geometry engine failed. Review script logic."

    def clear_outputs(self) -> None:
        for item in self.outputs_dir.iterdir():
            try:
                if item.is_file(): item.unlink()
                elif item.is_dir(): shutil.rmtree(item)
            except: pass

    def _log_fail(self, script: str, params: dict, log: str):
        try:
            log_dir = Path(__file__).resolve().parents[2] / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / f"render_v3_fail_{uuid.uuid4().hex[:6]}.json"
            with open(log_file, "w") as f:
                json.dump({"script": script, "parameters": params, "log": log}, f, indent=2)
        except: pass

def extract_parameters_from_script(script: str) -> Dict[str, Any]:
    import re
    import ast
    # Find PARAMETERS = { ... }
    match = re.search(r"PARAMETERS\s*=\s*(\{.*?\})", script, re.DOTALL)
    if not match: return {}
    try:
        return ast.literal_eval(match.group(1))
    except:
        return {}
