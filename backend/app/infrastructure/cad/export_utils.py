import tempfile
import pathlib
from build123d import export_step

def build123d_to_step_bytes(shape) -> bytes:
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
            temp_path = pathlib.Path(tf.name)
        export_step(shape, str(temp_path))
        with open(temp_path, 'rb') as f:
            return f.read()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)
