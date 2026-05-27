# Technical Specifications & Data Contracts

Detailed technical specifications, request flows, and internal mechanisms of CAD Copilot.

---

## 1. System Boundaries & Communication

### 1.1 `web-ui` (Next.js Application)
* **Client Workspace**: Renders the Monaco editor, property inputs, chat dialogue, and Three.js canvas.
* **OpenSCAD Web Worker**: Evaluates OpenSCAD scripts inside a background thread singleton, returning STL models as ArrayBuffers.
* **BFF (Backend-For-Frontend)**: Provides proxy endpoints mapping client JSON requests to python FastAPI schemas and handles prisma database persistence.

### 1.2 `ai-engine` (FastAPI Application)
* **LLM Service**: Connects to the Google GenAI SDK.
* **Blueprint Auditor**: Stage 1 Vision parser compiling dimensions into feature-maps.
* **Codegen Engine**: Stage 2 Script creator compiling structured code.
* **Refinement Engine**: Stage 3 isolated script editor managing surgical edits.

---

## 2. API Endpoints & Proxies

### 2.1 Generation Flow (`POST /api/v1/generate`)
1. User uploads a file and description in the UI.
2. Next.js proxy route `/api/v1/generate` logs a `Project` entry in PostgreSQL via Prisma.
3. Next.js forwards the `FormData` to the FastAPI backend's `/api/v1/generate` endpoint.
4. FastAPI calls the Gemini Vision + Gemini Text pipeline, parsing the blueprint and generating OpenSCAD code.
5. FastAPI returns the OpenSCAD script and parsed top-level parameters to Next.js.
6. Next.js updates the database record with the generated script and returns the payload to the browser.
7. The browser registers the script and compiles the geometry locally using the Web Worker.

### 2.2 Refinement Flow (`POST /api/v1/edit`)
1. The user types a modification prompt in the workspace chat (e.g. *"drill a slot on this face"*).
2. If the user clicked a blank area on the mesh previously, a `targetPoint` is active in the state.
3. Next.js proxies a JSON request body to FastAPI's `/api/v1/edit` endpoint:
   ```json
   {
     "prompt": "drill a slot on this face",
     "current_code": "$fn = 32;\n...",
     "target_point": [10.5, -4.2, 15.0],
     "model": "gemini-3.1-flash-lite"
   }
   ```
4. FastAPI appends the spatial target coordinate message context to the prompt and instructs Gemini to surgically modify the code.
5. The updated script is sanitized (capping `$fn = 32`, checking `eps = 0.02`), and returned back to the Next.js BFF proxy.
6. The browser receives the updated code, updates the Monaco editor, clears the target marker, and re-renders the viewport.

---

## 3. Viewport Proximity Click Calculations

When the user clicks the 3D STL mesh, raycasting identifies the click position `clickPoint = [x, y, z]`. The application iterates over the parsed parameters (`annotations`) using these proximity rules:

### 3.1 Cylinder & Hole Selection (Diameters)
For features annotated with `type: 'diameter'` (circular holes, pins, tubes):
1. Locate the feature's world center (`center`) and axis vector (`axis`).
2. Calculate the distance from `clickPoint` to the central axis line:
   $$\vec{v} = \text{clickPoint} - \text{center}$$
   $$\text{proj} = \vec{v} \cdot \text{axis}$$
   $$\text{pointOnAxis} = \text{center} + \text{proj} \times \text{axis}$$
   $$\text{distToAxis} = \text{distanceTo}(\text{clickPoint}, \text{pointOnAxis})$$
3. Subtract the scaled radius to check distance to the cylinder outer wall:
   $$\text{distance} = |\text{distToAxis} - \text{radius}|$$

### 3.2 Extrusion Selection (Heights)
For features annotated with `type: 'height'` (prismatic blocks, step shoulders):
1. Locate boundary coordinates `p1` and `p2`.
2. Extract the extrusion axis direction:
   $$\text{axisDir} = \text{normalize}(\text{p2} - \text{p1})$$
3. Calculate point-to-plane distance for the base and top capping planes:
   $$\text{distPlane1} = |(\text{clickPoint} - \text{p1}) \cdot \text{axisDir}|$$
   $$\text{distPlane2} = |(\text{clickPoint} - \text{p2}) \cdot \text{axisDir}|$$
4. Set distance to the closest cap:
   $$\text{distance} = \min(\text{distPlane1}, \text{distPlane2})$$

If the resulting `distance` is within the `5.0` threshold, the parameter is selected for editing.

---

## 4. WASM Engine Web Worker Singleton

The background compilation system is managed in [useCADEngine.ts](file:///c:/Users/ajith/Videos/nano_test/cad_project/cad_copilot/web-ui/hooks/useCADEngine.ts) and [cad-worker.ts](file:///c:/Users/ajith/Videos/nano_test/cad_project/cad_copilot/web-ui/workers/cad-worker.ts):

* **Singleton Thread**: Spawns a single `Worker` instances globally. Mounting/unmounting hooks subscribe and unsubscribe listeners to a shared message hub rather than starting new worker processes, preventing RAM leakage.
* **Transient Blobs**: The compiled STL ArrayBuffer is converted to a browser Blob:
  ```typescript
  const blob = new Blob([buffer], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  ```
  Whenever a compile finishes, the previous Blob URL is explicitly revoked (`URL.revokeObjectURL(oldUrl)`) to free up memory immediately.
* **Debounced Compile**: Variable inputs compile with a default 600ms debounce to prevent thread blocking while users are dragging sliders or typing.
