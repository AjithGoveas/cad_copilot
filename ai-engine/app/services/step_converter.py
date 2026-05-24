import sys
import os
import subprocess
import tempfile
import asyncio
from unittest.mock import MagicMock

# Force Windows/Qt into a strict headless mode
os.environ["QT_QPA_PLATFORM"] = "offscreen"

# === PATH INJECTION FOR FREECAD (VENV VERSION) ===
def inject_freecad_paths():
    """Locate and inject FreeCAD paths for python venv or system installations."""
    venv_prefix = sys.prefix
    
    # Potential FreeCAD paths inside venv or standard system install locations
    possible_paths = [
        # Standard venv Library directories if user installed/built FreeCAD there
        os.path.join(venv_prefix, "Library", "bin"),
        os.path.join(venv_prefix, "Library", "Ext"),
        os.path.join(venv_prefix, "Lib", "site-packages"),
        os.path.join(venv_prefix, "Scripts"),
        # Standard system install paths for FreeCAD
        r"C:\Program Files\FreeCAD 1.0\bin",
        r"C:\Program Files\FreeCAD 1.0\Ext",
        r"C:\Program Files\FreeCAD 0.22\bin",
        r"C:\Program Files\FreeCAD 0.22\Ext",
        r"C:\Program Files\FreeCAD 0.21\bin",
        r"C:\Program Files\FreeCAD 0.21\Ext",
        r"C:\Program Files\FreeCAD\bin",
        r"C:\Program Files\FreeCAD\Ext",
    ]
    
    injected_any = False
    for path in possible_paths:
        if os.path.exists(path):
            if path not in sys.path:
                sys.path.append(path)
            if hasattr(os, 'add_dll_directory'):
                try:
                    os.add_dll_directory(path)
                except Exception:
                    pass
            os.environ["PATH"] = path + os.pathsep + os.environ.get("PATH", "")
            injected_any = True
            
    return injected_any

# Run injection if importing or running
inject_freecad_paths()


class StepConverterService:
    """Service to handle converting CSG representation to STEP file format via FreeCAD."""

    @staticmethod
    async def convert_csg_to_step(csg_content: bytes) -> bytes:
        """
        Takes raw CSG bytes, runs the converter script in an isolated subprocess,
        and returns the converted STEP file bytes.
        """
        if not csg_content:
            raise ValueError("Empty CSG payload")

        # Create secure temporary files for the conversion
        with tempfile.NamedTemporaryFile(delete=False, suffix=".csg") as csg_file:
            csg_file.write(csg_content)
            csg_path = csg_file.name

        step_path = csg_path.replace(".csg", ".step")

        try:
            # Path to this script itself
            script_path = os.path.abspath(__file__)
            
            # Run in an isolated python subprocess to prevent FreeCAD Qt/GUI issues from crashing FastAPI
            cmd = [sys.executable, script_path, csg_path, step_path]
            
            # Execute subprocess asynchronously in a threadpool to not block the FastAPI event loop
            process = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, text=True
            )

            if process.returncode != 0 or not os.path.exists(step_path):
                error_msg = process.stderr or process.stdout or "Unknown FreeCAD error"
                raise RuntimeError(f"FreeCAD Kernel Error: {error_msg}")

            # Read the converted STEP file into memory
            with open(step_path, "rb") as f:
                step_data = f.read()

            return step_data

        finally:
            # Purge the temporary files immediately to meet the Zero-disk footprint constraint
            if os.path.exists(csg_path):
                os.remove(csg_path)
            if os.path.exists(step_path):
                os.remove(step_path)


# --- WORKER SCRIPT ENTRYPOINT ---
if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python step_converter.py <input.csg> <output.step>")
        sys.argv = [sys.argv[0], "dummy.csg", "dummy.step"]
        sys.exit(1)

    input_csg = sys.argv[1]
    output_step = sys.argv[2]

    # Intercept GUI imports to enable headless FreeCAD operation
    sys.modules['FreeCADGui'] = MagicMock()
    sys.modules['Gui'] = MagicMock()

    try:
        import FreeCAD
        import Part
        import importCSG

        doc = FreeCAD.newDocument("HeadlessExport")
        importCSG.insert(input_csg, doc.Name)
        top_group = doc.Objects[-1]
        
        Part.export([top_group], output_step)
        print("SUCCESS")
        sys.exit(0)
    except Exception as e:
        print(f"ERROR: {str(e)}")
        sys.exit(1)
