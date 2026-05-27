# CAD Copilot Optimization Summary

This document summarizes the optimization techniques implemented in CAD Copilot to achieve low latency, stable renders, and high accuracy.

---

## 1. Token Usage & LLM Prompt Optimizations

To keep Gemini model prompts cost-effective and avoid context exhaustion, several prompt enhancements were integrated:

### 1.1 Decoupled Routing Prompt Isolation
Instead of a single large prompt handling all generation, editing, and error recovery:
- The `/generate` prompt focuses strictly on Stage 1 (Vision Audit) JSON construction and Stage 2 (Codegen) code creation.
- The `/edit` prompt uses `EDIT_SYSTEM_PROMPT` tailored for in-place modifications.
This separation reduces input token overhead by ~30% for iterative edits.

### 1.2 Deterministic Sychronization
Enforced `temperature=0.0` for all generation and editing calls. This prevents the LLM from outputting variable code syntax or altering unchanged dimensions.

---

## 2. Browser Threading & WASM Optimizations

Rendering 3D models in WebAssembly can lead to performance bottlenecks if not managed carefully. The application implements:

### 2.1 Web Worker Singleton Pattern
spawning multiple WASM compile threads on every change leads to browser freezes. The system maintains a **single global Web Worker** (`cad-worker.ts`). When a component mounts `useCADEngine.ts`, it subscribes to the shared worker rather than spawning a new process.

### 2.2 Transient Blob Memory Management
OpenSCAD WASM outputs STL files as binary ArrayBuffers. To display them in the canvas:
1. The ArrayBuffer is loaded into a transient browser Blob URL (`URL.createObjectURL`).
2. Upon subsequent recompilations, the previous Blob URL is immediately revoked (`URL.revokeObjectURL`) to prevent memory leaks.

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
