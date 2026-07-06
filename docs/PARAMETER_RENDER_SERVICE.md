# Client-Side WASM Engine & Web Worker

The python-based subprocess renderer was replaced by a **browser-local WebAssembly rendering loop** to compile OpenSCAD code instantly on the client thread.

---

## 1. Web Worker Singleton Model

Spawning multiple WebAssembly threads simultaneously can lead to browser memory fragmentation and lockups. The application implements a global singleton worker:

* **Location**: [cad-worker.ts](../frontend/workers/cad-worker.ts).
* **Singleton Lifecycle**:
  ```typescript
  let globalWorker: Worker | null = null;
  const globalListeners = new Set<(e: MessageEvent) => void>();
  ```
  Calling `useCADEngine` hooks onto this global worker instance. Listeners are registered inside a global subscriber set.

---

## 2. Compilation Flow

```text
Monaco Editor / Parameter Drawer
              │
              ▼ (debounce 600ms)
       [ postMessage ]
              │ (type: 'compile')
              ▼
    [ Web Worker Thread ] ──► (Loads openscad.js WASM)
              │
              ▼ (compiles)
     [ ArrayBuffer (STL) ]
              │
              ▼ (postMessage)
       [ useCADEngine ]
              │
              ▼ (Blob URL)
       [ Viewport Mesh ]
```

1. **Debounce**: Parameter changes or script inputs are debounced (default 600ms) inside `useCADEngine.ts`.
2. **Worker Post**: PostMessage dispatches the script: `worker.postMessage({ type: 'compile', script, id })`.
3. **Compilation**: The worker receives the script and compiles the geometry using standard OpenSCAD binaries compiled to WASM. It returns an array of part buffers.
4. **Blob Conversion**: `useCADEngine.ts` catches the buffers and converts them to object URLs:
   ```typescript
   const blob = new Blob([part.buffer], { type: 'model/stl' });
   const url = URL.createObjectURL(blob);
   ```
5. **Memory Cleanup**: Whenever a compilation finishes, the hook revokes the previous URL to prevent memory leaks:
   ```typescript
   prev.forEach(url => URL.revokeObjectURL(url));
   ```

---

## 3. Export Operations

Exporting STL and DXF formats is also delegated to the worker thread using the active script state:

* **DXF 4-View Engineering blueprints**: The client wraps the active script with a projection utility (`generateDxfWrapper`), which forces projection layers (`projection(cut = false)`) rotated to Top, Front, Right, and Isometric locations.
* **Execution**:
  ```typescript
  worker.postMessage({ 
      type: 'export', 
      script: wrappedScript, 
      format: 'dxf', 
      dxfMode: 'blueprint', 
      id 
  });
  ```
* **Return**: The worker processes the projection and returns the binary DXF data as an ArrayBuffer, which is saved locally as `.dxf`.
