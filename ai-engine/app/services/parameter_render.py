import ast
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def _to_ast_literal(value: Any) -> ast.expr:
    if isinstance(value, dict):
        keys = []
        values = []
        for key, item in value.items():
            keys.append(_to_ast_literal(str(key)))
            values.append(_to_ast_literal(item))
        return ast.Dict(keys=keys, values=values)
    if isinstance(value, list):
        return ast.List(elts=[_to_ast_literal(item) for item in value], ctx=ast.Load())
    if isinstance(value, tuple):
        return ast.Tuple(elts=[_to_ast_literal(item) for item in value], ctx=ast.Load())
    if isinstance(value, (str, int, float, bool)) or value is None:
        return ast.Constant(value=value)

    raise TypeError(f"Unsupported parameter type: {type(value)!r}")


RENDER_HARNESS = """
import os
from pathlib import Path

from build123d import export_step, export_stl

_output_dir = Path(os.getenv("OUTPUT_DIR", "."))
_output_dir.mkdir(parents=True, exist_ok=True)
_basename = os.getenv("OUTPUT_BASENAME", "model")

_shape = None
if "build_model" in globals() and callable(build_model):
    _shape = build_model(PARAMETERS)

if _shape is None:
    for _name in ("result", "model", "part", "assembly", "shape", "solid"):
        if _name in globals():
            _shape = globals()[_name]
            break

if _shape is None:
    raise RuntimeError("No exportable model found. Define build_model(params) or set model variable.")

export_step(_shape, str(_output_dir / f"{_basename}.step"))
export_stl(_shape, str(_output_dir / f"{_basename}.stl"))
""".strip()


def _extract_parameter_defaults_from_node(node: ast.expr | None) -> dict[str, Any]:
    if node is None:
        return {}

    try:
        literal = ast.literal_eval(node)
    except Exception:
        return {}

    if not isinstance(literal, dict):
        return {}

    return {str(key): value for key, value in literal.items()}


def extract_parameters_from_script(script: str) -> dict[str, Any]:
    try:
        tree = ast.parse(script)
    except Exception:
        return {}

    for node in tree.body:
        if isinstance(node, ast.Assign):
            is_parameters = any(
                isinstance(target, ast.Name) and target.id == "PARAMETERS"
                for target in node.targets
            )
            if is_parameters:
                return _extract_parameter_defaults_from_node(node.value)

        if isinstance(node, ast.AnnAssign):
            is_parameters = isinstance(node.target, ast.Name) and node.target.id == "PARAMETERS"
            if is_parameters:
                return _extract_parameter_defaults_from_node(node.value)

    return {}


class ParameterRenderService:
    def __init__(self, outputs_dir: Path | None = None) -> None:
        project_root = Path(__file__).resolve().parents[2]
        self.outputs_dir = outputs_dir or (project_root / "outputs")
        self.outputs_dir.mkdir(parents=True, exist_ok=True)

    def overwrite_parameters(self, script: str, parameters: dict[str, Any]) -> str:
        tree = ast.parse(script)
        replaced = False

        for node in tree.body:
            if isinstance(node, ast.Assign):
                is_parameters = any(
                    isinstance(target, ast.Name) and target.id == "PARAMETERS"
                    for target in node.targets
                )
                if is_parameters:
                    existing = self._extract_parameter_defaults(node.value)
                    merged = {**existing, **parameters}
                    node.value = _to_ast_literal(merged)
                    replaced = True
                    break

            if isinstance(node, ast.AnnAssign):
                is_parameters = (
                    isinstance(node.target, ast.Name) and node.target.id == "PARAMETERS"
                )
                if is_parameters:
                    existing = self._extract_parameter_defaults(node.value)
                    merged = {**existing, **parameters}
                    node.value = _to_ast_literal(merged)
                    replaced = True
                    break

        ast.fix_missing_locations(tree)

        if not replaced:
            raise ValueError("Script must declare a top-level PARAMETERS dictionary.")

        return ast.unparse(tree)

    @staticmethod
    def _extract_parameter_defaults(node: ast.expr | None) -> dict[str, Any]:
        return _extract_parameter_defaults_from_node(node)

    def render_to_outputs(
        self,
        parameters: dict[str, Any],
        script: str,
        output_basename: str,
    ) -> dict[str, str]:
        patched_script = self.overwrite_parameters(script=script, parameters=parameters)
        composed_script = f"{patched_script}\n\n{RENDER_HARNESS}\n"

        with tempfile.TemporaryDirectory(prefix="cad_render_") as temp_dir:
            script_path = Path(temp_dir) / "render_script.py"
            script_path.write_text(composed_script, encoding="utf-8")

            env = os.environ.copy()
            env["OUTPUT_DIR"] = str(self.outputs_dir)
            env["OUTPUT_BASENAME"] = output_basename

            completed = subprocess.run(
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                cwd=temp_dir,
                env=env,
                timeout=180,
                check=False,
            )

        if completed.returncode != 0:
            stderr = completed.stderr.strip()
            stdout = completed.stdout.strip()
            raise RuntimeError(
                "Rendering failed. "
                f"stdout={stdout!r} stderr={stderr!r}"
            )

        stl_path = self.outputs_dir / f"{output_basename}.stl"
        step_path = self.outputs_dir / f"{output_basename}.step"

        if not stl_path.exists() or not step_path.exists():
            raise RuntimeError("Render completed but STL/STEP files were not created.")

        return {
            "stl_path": str(stl_path),
            "step_path": str(step_path),
        }
