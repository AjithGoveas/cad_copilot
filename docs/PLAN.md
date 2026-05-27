# CAD Copilot - Future Development Plan

This document outlines the successful implementation details of the CAD Copilot and maps out the future development phases.

---

## 1. Current System Milestones

We have successfully migrated the CAD Copilot to a highly stable, low-latency stack:
1. **Decoupled AI Pipelines**: Created `/generate` and `/edit` routes on the FastAPI backend to separate model creation from surgical code refinement, preventing prompt dilution.
2. **Local WASM Rendering**: Spawns a global singleton Web Worker compiling OpenSCAD locally inside the browser. This prevents RAM fragmentation, increases performance, and removes server render costs.
3. **Proximity Parameter Editing**: Raycasting in the Three.js viewport checks spatial coordinates against cylinder axes (diameter/chamfer) and planes (height/extrusion) to open auto-focusing parameter inputs.
4. **Spatial Target Selection**: Drops a visual target marker on empty regions of the mesh, injecting absolute coordinates as context in the next AI refinement call.
5. **DXF blueprint Projection**: Safety wrappers rotate model geometry and slice profiles to compile stable 4-view technical blueprints in the browser.

---

## 2. Future Development Phases

### Phase 1: Local Caliper Ruler Tool
* **Goal**: Enable users to click any two vertices on the 3D model and view exact measurements in world space.
* **Tasks**:
  - Implement snapping logic to vertex coordinates in `Viewport.tsx`.
  - Draw dynamic line guides and HTML dimensions overlays showing distance in mm.

### Phase 2: Native STEP Export Service
* **Goal**: Provide downloadable B-Rep models alongside STL meshes.
* **Tasks**:
  - Integrate a python-based OpenCASCADE / FreeCAD converter on the FastAPI backend.
  - Expose a STEP generation pipeline that maps OpenSCAD primitive variables to CSG features.

### Phase 3: G-Code & Toolpath Engine
* **Goal**: Direct integration with manufacturing equipment (3D printers / CNC routers).
* **Tasks**:
  - Create a client-side slicing worker that slices STL files to generate G-code paths.
  - Draw layers inside the R3F viewport to preview toolpaths before exporting.

### Phase 4: Offline LLM Core
* **Goal**: Run completely local, offline, and secure model setups.
* **Tasks**:
  - Add support for local codegen endpoints (using Qwen-Coder or Llama-3-Coder) running via Ollama.
