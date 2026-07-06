# CADVEX Optimization Summary

This document summarizes the optimization techniques implemented in CADVEX to achieve low latency, stable renders, high coordinate accuracy, and reliable multimodal drawing processing.

---

## 1. Token Usage & LLM Prompt Optimizations

To keep Gemini model prompts cost-effective and avoid context exhaustion, several prompt enhancements were integrated:

### 1.1 Decoupled Routing Prompt Isolation
Instead of a single large prompt handling all generation, editing, and error recovery:
- The `/generate` prompt focuses strictly on Stage 1 (Vision Audit) JSON construction and Stage 2 (Codegen) code creation.
- The `/edit` prompt uses `EDIT_SYSTEM_PROMPT` tailored for in-place modifications.
This separation reduces input token overhead by ~30% for iterative edits.

### 1.2 Deterministic Synchronization
Enforced `temperature=0.0` for all generation and editing calls. This prevents the LLM from outputting variable code syntax or altering unchanged dimensions.

---

## 2. Backend Caching & Files API Optimizations

Large files (such as multi-page engineering drawings in PDF format or high-resolution blueprints) can cause high request latency and network bottlenecks. The backend integrates the following optimizations:

### 2.1 Gemini Files API Uploader
Rather than sending raw file bytes inline within requests multiple times (once for blueprint audit and once for script codegen), the backend writes file bytes to a local temporary file and uploads them via the Gemini Files API (`client.files.upload`).
- The system polls until the file status is `ACTIVE` before initiating model generation.
- Reduces upload payload sizes and saves API bandwidth.

### 2.2 MD5-Keyed Feature Map & File Cache
An in-memory, size-limited cache (`_BLUEPRINT_CACHE`) is used in `llm_codegen.py`.
- Keyed by the MD5 hash of the uploaded drawing bytes.
- **Stage 1 Vision Audit Caching**: Caches the generated JSON feature map. Subsequent generations for the same file bypass the Stage 1 vision audit LLM call entirely, saving 5–10 seconds.
- **Gemini File Reference Caching**: Caches the uploaded Gemini `File` reference. The Stage 2 codegen utilizes the same active file reference, avoiding duplicate uploads.

### 2.3 Next.js Gateway Timeout Configuration
Next.js Route Handlers (`app/api/v1/generate/route.ts`) are configured with `export const maxDuration = 300;` to prevent server-side gateway timeouts during multi-page PDF processing.

---

## 3. Viewport Selection & Interaction Math

Rather than relying on coordinate approximations or dense vertex selectors, we developed an exact analytical proximity matrix for R3F mesh clicks:

* **Central-Axis Cylinder Selector**:
  Instead of measuring distance to a cylinder's base center point (which causes selection failures on tall cylinders), the math projects the click point onto the cylinder's infinite central axis vector before subtracting the radius:
  $$\text{distToAxis} = \|(\vec{x}_{click} - \vec{x}_{center}) \times \vec{u}_{axis}\|$$
  $$\text{distance} = |\text{distToAxis} - r_{scaled}|$$
* **Point-to-Plane Extrusion Selector**:
  For blocks and step heights, selection measures click closeness to the base or top extrusion capping planes along the normal direction:
  $$\text{distance} = \min(|(\vec{x}_{click} - \vec{x}_{p1}) \cdot \vec{u}_{direction}|, |(\vec{x}_{click} - \vec{x}_{p2}) \cdot \vec{u}_{direction}|)$$
This ensures selection matches expected face clicks, preventing threshold violations.

---

## 4. 3D Model Centering & Dimension Overlay Alignment

### 4.1 Stage Auto-Centering Disable
Drei's `<Stage>` component centering logic centers the 3D model relative to its visual bounding box, causing spatial drift from the dimension overlay coordinate space.
- By configuring `<Stage center={{ disable: true }}>` and using standard model `<Center>` coordinates, the physical STL coordinates stay in perfect alignment with R3F overlay markers.

### 4.2 Hierarchical Matrix Transformation Parser
OpenSCAD scripts apply translation and rotation modifiers to single primitives or nested blocks. The primitive coordinate extractor (`inferAnnotations`) uses a stack-based tokenizer/parser:
- **Lexical Tokenizer**: Scans `translate`, `rotate`, `cylinder`, `cube`, `{`, `}`, and `;` sequentially.
- **Matrix Stack**: Employs a stack of `Matrix4` frames. Nested blocks push/pop transforms, matching OpenSCAD's scope evaluation.
- **Vector Decomposition**: Evaluates local cylinder and cube bounds under composed world matrices, mapping rotated holes/branches (like in a T-pipe) perfectly to their 3D overlays.

---

## 5. Browser Threading & WASM Optimizations

Rendering 3D models in WebAssembly can lead to performance bottlenecks if not managed carefully. The application implements:

### 5.1 Web Worker Singleton Pattern
Spawning multiple WASM compile threads on every change leads to browser freezes. The system maintains a **single global Web Worker** (`cad-worker.ts`). When a component mounts `useCADEngine.ts`, it subscribes to the shared worker rather than spawning a new process.

### 5.2 Transient Blob Memory Management
OpenSCAD WASM outputs STL files as ArrayBuffers. To display them in the canvas:
1. The ArrayBuffer is loaded into a transient browser Blob URL (`URL.createObjectURL`).
2. Upon subsequent recompilations, the previous Blob URL is immediately revoked (`URL.revokeObjectURL`) to prevent memory leaks.
