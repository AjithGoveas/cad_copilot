import sys
import os
from unittest.mock import MagicMock

# Force Windows/Qt into a strict headless mode
os.environ["QT_QPA_PLATFORM"] = "offscreen"

# === THE JEDI MIND TRICK ===
# We intercept the broken GUI import and replace it with a dummy object.
sys.modules['FreeCADGui'] = MagicMock()
sys.modules['Gui'] = MagicMock()
# ===========================

# --- CONDA PATH INJECTION (ACTIVE) ---
conda_prefix = sys.prefix
freecad_bin = os.path.join(conda_prefix, "Library", "bin")
freecad_ext = os.path.join(conda_prefix, "Library", "Ext")

if os.path.exists(freecad_bin) and freecad_bin not in sys.path:
    sys.path.append(freecad_bin)
if os.path.exists(freecad_ext) and freecad_ext not in sys.path:
    sys.path.append(freecad_ext)

if hasattr(os, 'add_dll_directory'):
    if os.path.exists(freecad_bin): os.add_dll_directory(freecad_bin)
    if os.path.exists(freecad_ext): os.add_dll_directory(freecad_ext)

os.environ["PATH"] = freecad_bin + os.pathsep + os.environ.get("PATH", "")
# -------------------------------------

# --- PIP / SYSTEM INSTALL PATH INJECTION (COMMENTED) ---
# Uncomment the lines below if you are using a standard PIP/System installation:
#
# freecad_path = r"C:\Program Files\FreeCAD 1.0\bin" 
# if os.path.exists(freecad_path):
#     if freecad_path not in sys.path: sys.path.append(freecad_path)
#     if hasattr(os, 'add_dll_directory'): os.add_dll_directory(freecad_path)
#     os.environ["PATH"] = freecad_path + os.pathsep + os.environ.get("PATH", "")
# -------------------------------------------------------

if len(sys.argv) < 3:
    print("Usage: python csg_to_step.py <input.csg> <output.step>")
    sys.exit(1)

input_csg = sys.argv[1]
output_step = sys.argv[2]

try:
    import FreeCAD
    import Part
    import importCSG

    doc = FreeCAD.newDocument("HeadlessExport")
    importCSG.insert(input_csg, doc.Name)
    top_group = doc.Objects[-1]
    
    Part.export([top_group], output_step)
    print("SUCCESS")
except Exception as e:
    print(f"ERROR: {str(e)}")
    sys.exit(1)