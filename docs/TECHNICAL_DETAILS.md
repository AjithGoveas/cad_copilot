# Technical Specifications & Data Contracts

Detailed technical specifications, request flows, and internal mechanisms of CADVEX.

---

## 1. System Boundaries & Communication

### 1.1 `frontend` (Next.js Application)
* **Client Workspace**: Renders the Monaco editor, property inputs, chat dialogue, and Three.js canvas.
* **OpenSCAD Web Worker**: Evaluates OpenSCAD scripts inside a background thread singleton, returning STL models as ArrayBuffers.
* **BFF (Backend-For-Frontend)**: Provides proxy endpoints mapping client JSON requests to python FastAPI schemas and handles prisma database persistence.

### 1.2 `backend` (FastAPI Application)
* **HTTPX Client Gateway**: Manages raw HTTP REST connection pool calls to Google, OpenAI, DeepSeek, Anthropic, and Ollama.
* **Orchestration Use Cases**: Interactors (`GenerateCadUseCase`, `EditCadUseCase`, `RepairCadUseCase`) executing the multi-stage visual audits, code synthesis, spatial injection edits, and compile recovery.
* **CAD/CAM Concrete Engines**: Low-level parsing (`csg_parser.py`, `gcode_generator.py`) and file formatting adapters (`cad_engine.py`, `cam_engine.py`) wrapped in Clean Architecture interfaces.

---

## 2. API Endpoints & Proxies

### 2.1 Generation Flow (`POST /api/v1/generate`)
1. User uploads a file (PDF/Image) and description in the UI.
2. Next.js proxy route `/api/v1/generate` logs a `Project` entry in PostgreSQL via Prisma.
3. Next.js forwards the `FormData` to the FastAPI backend's `/api/v1/generate` endpoint, along with the `model_metadata` and optional `fallback_metadata` JSON configurations.
4. FastAPI validates the payload and invokes `GenerateCadUseCase`.
5. The use case checks the MD5-keyed global `_BLUEPRINT_CACHE`:
   - **Cache Hit**: Returns the pre-audited Stage 1 feature map instantly.
   - **Cache Miss**: Uploads the drawing to visual LLM endpoints, waits for active processing, runs the Stage 1 vision analysis, and caches the feature map.
6. The use case calls the `UniversalHTTPXGateway` to synthesize OpenSCAD code. If the request encounters rate limits or errors, it falls back to compile the prompt via `fallback_metadata`.
7. FastAPI returns the generated OpenSCAD script and parsed top-level parameters to Next.js.
7. Next.js updates the database record with the generated script and returns the payload to the browser.
8. The browser registers the script and compiles the geometry locally using the Web Worker.

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

## 4. Hierarchical Matrix Transformation Stack Parser

Extracting annotations from nested OpenSCAD scripts is handled by [inferAnnotations](../frontend/lib/openscadParameters.ts#L339) using a stack-based matrix transformation parser:

1. **Tokenizer**: Tokenizes the module body to parse structure `translate(...)`, `rotate(...)`, `cylinder(...)`, `cube(...)`, `{`, `}`, and `;` in strict sequential order.
2. **Current and Pending Frames**:
   - `currentTransform`: Holds the current scope matrix.
   - `pendingTransform`: Composes upcoming inline modifiers.
3. **Control Actions**:
   - On `{`: Pushes the current scope to a `Matrix4` stack. Compiles pending modifiers into the new scope frame: `currentTransform = currentTransform * pendingTransform`, and resets `pendingTransform` to identity.
   - On `}`: Pops the state from the stack, restoring scope.
   - On `;`: Resets inline modifiers (`pendingTransform = identity`).
   - On `translate(...)` / `rotate(...)`: Multiplies the translation/rotation matrix directly into `pendingTransform`.
4. **Coordinate Mapping**:
   - On primitives (`cylinder`/`cube`), the final world matrix is compiled: `totalTransform = currentTransform * pendingTransform`.
   - The matrix is decomposed (`totalTransform.decompose(position, quaternion, scale)`) to retrieve exact translations and orientations.
   - Cylinder centers and height bounds are projected along the world-space axis, resolving rotated branches perfectly.

---

## 5. WASM Engine Web Worker Singleton

The background compilation system is managed in [useCadWorker.ts](../frontend/features/cad-workspace/hooks/useCadWorker.ts) and [cad-worker.ts](../frontend/workers/cad-worker.ts):

* **Singleton Thread**: Spawns a single `Worker` instance globally. Mounting/unmounting hooks subscribe and unsubscribe listeners to a shared message hub rather than starting new worker processes, preventing RAM leakage.
* **Transient Blobs**: The compiled STL ArrayBuffer is converted to a browser Blob:
  ```typescript
  const blob = new Blob([buffer], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  ```
  Whenever a compile finishes, the previous Blob URL is explicitly revoked (`URL.revokeObjectURL(oldUrl)`) to free up memory immediately.
* **Debounced Compile**: Variable inputs compile with a default 600ms debounce to prevent thread blocking while users are dragging sliders or typing.
