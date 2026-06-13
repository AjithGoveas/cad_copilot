# 💻 CADVΞX Web UI

The frontend for CADVEX is a browser-based, high-performance parametric CAD workstation built using **Next.js 15 (React 19)**, **React Three Fiber (Three.js)**, and a **client-side WebAssembly OpenSCAD compilation engine**.

It provides an interactive IDE-like workspace featuring a real-time 3D canvas viewport, a parameter inspector drawer, a Monaco code editor, and an integrated AI chat panel.

---

## 🏗️ Core Frontend Architecture

The frontend is designed to run heavy 3D CAD rendering locally in the browser, bypassing server processing limits and enabling real-time feedback loops.

```text
                                       ┌────────────────────────┐
                                       │    HitlWorkspace       │ (Main State Controller)
                                       └───────────┬────────────┘
                      ┌────────────────────────────┼───────────────────────────┐
                      ▼                            ▼                           ▼
            ┌──────────────────┐         ┌──────────────────┐        ┌──────────────────┐
            │    ChatPanel     │         │     Viewport     │        │   EditorDrawer   │
            └──────────────────┘         └─────────┬────────┘        └─────────┬────────┘
                                                   │                           │
                                                   ▼                           ▼
                                         ┌──────────────────┐        ┌──────────────────┐
                                         │  DimensionOverlay│        │  ParameterDrawer │
                                         │  QuickEditOverlay│        │  CodeEditor      │
                                         └──────────────────┘        └──────────────────┘
```

### 1. Browser-Local WASM Rendering Loop

To ensure sub-second compilation times, the application implements a background thread rendering system:

- **Global Worker Singleton (`useCADEngine.ts`)**: To prevent massive memory spikes and garbage collection locks caused by spawning multiple WebAssembly threads, a single Web Worker is maintained globally.
- **OpenSCAD WASM Compilation**: When parameters change or the editor script is modified, the script is debounced (default 600ms) and dispatched to the worker thread (`cad-worker.ts`). The worker compiles the geometry using standard OpenSCAD binaries compiled to WASM, returning an ArrayBuffer of STL mesh data.
- **Blob Object Management**: The returned ArrayBuffers are converted to transient browser Blob URLs, loaded via Three.js `STLLoader`, and rendered in the 3D canvas. Old Blob URLs are garbage-collected instantly to prevent memory leaks.

### 2. Proximity Click-to-Edit Matrix

When a user clicks on the 3D mesh, the viewport performs standard raycasting. Instead of simple coordinate selections, it feeds the intersection coordinate into a **3D Proximity Matrix** comparing the click with current parameters:

- **Diameter / Chamfer**: Shortest distance is measured from the click to the infinite central axis of the cylinder (`center` and `axis` vector projections), minus the scaled radius. This allows selecting a cylindrical feature by clicking its wall.
- **Height / Extrusion**: Evaluates the point-to-plane distance relative to the base and top capping planes (`p1` and `p2` coordinates dot-multiplied with the extrusion normal).
  If the click is within a `5.0` units threshold of any parameter, the viewport halts standard mesh selection and opens an interactive `<QuickEditOverlay />` containing an auto-focusing numeric input projected directly over the 3D coordinate via Drei's `<Html />`. Hitting Enter triggers a state update, injecting the new parameter value back into the OpenSCAD code and executing a local recompilation.

---

## 🎨 Feature Highlights & Viewport Components

### 👁️ 3D Viewport (`Viewport.tsx` & `StlMesh.tsx`)

- **Flat Shading & Physical Materials**: The geometry is rendered with flat-shading physical properties, presenting realistic brushed stainless steel finishes (`metalness: 1.0`, `roughness: 0.42`).
- **Interactive Edge Outlines**: High-performance outlines (`<Edges />` from Drei) render on hover or selection, using a slight scale offset (`1.001`) to eliminate standard Z-fighting on co-planar faces.
- **Radial Lighting Stage**: Built with City environments and contact shadows (`ContactShadows`) to elevate the premium workstation feel.

### 📐 Dimension Overlay (`DimensionOverlay.tsx`)

- **Type-Aware Visual Markers**:
  - _Heights_: Generates custom lines with cone tips indicating dimension bounds.
  - _Diameters_: Renders concentric circular rings and thin crosshair guides overlayed on top of the geometry face.
  - _Chamfers_: Renders custom emerald-green toruses highlighting edge modifications.
- **Glassmorphic Billboards**: Custom 3D labels use Drei's `<Html />` billboards which pivot to face the camera, rendering text values clearly.

### 📍 Visual Target Selection

- Clicking empty regions of the model drops a glowing target locator (represented by concentric solid and transparent blue spheres).
- This target acts as a spatial constraint. It appends the clicked coordinates to the chat composer as an attachment chip and injects the absolute coordinate payload directly into the AI prompt so the AI can construct new components relative to that position.

### ✍️ Monaco Editor Integration

- Replaces standard textareas with a Monaco code editor container.
- Employs regex parsers to track and highlight `// PARAMETERS_START` and `// PARAMETERS_END` blocks.

---

## 📂 Directory Layout

```text
web-ui/
├── app/
│   ├── actions/                # Server Actions
│   ├── api/                    # BFF Route Handlers
│   │   ├── auth/               # NextAuth authentication endpoints
│   │   ├── history/            # CAD design history fetching
│   │   └── v1/
│   │       ├── generate/       # Multipart form new model generation
│   │       └── edit/           # JSON-based surgical model modification
│   ├── app/                    # Sub-route configurations
│   │   ├── demo/               # Demo-restricted sandbox workstation
│   │   ├── login/              # JetBrains-themed workstation auth login
│   │   ├── signup/             # Account creation interface
│   │   └── view/[token]/       # Read-only model sharing and viewing
│   ├── globals.css             # Tailwind base and workstation grid glows
│   ├── layout.tsx              # Root HTML wrapper and SWR/NextAuth provider
│   └── page.tsx                # Core workstation UI layout (Orchestrates main views)
├── components/
│   ├── ui/                     # Shared custom widgets (dropdowns, dialogs, buttons)
│   ├── Viewport.tsx            # R3F Canvas context, lighting stage & controls
│   ├── StlMesh.tsx             # Physical STL mesh loader, outlines & edge highlighting
│   ├── DimensionOverlay.tsx    # Custom height/diameter visual measurement overlays
│   ├── QuickEditOverlay.tsx    # Floating in-viewport auto-focusing parameter input
│   ├── ChatPanel.tsx           # AI chat logs, prompt input, and target coordinate attachments
│   ├── ChatBubble.tsx          # Dynamic message item with file/diff render options
│   ├── CameraRig.tsx           # Auto-focus camera movements when active parameter changes
│   ├── EditorDrawer.tsx        # Collapsible terminal console, history logs, and Monaco script code tab
│   ├── ParameterDrawer.tsx     # Interactive properties list editor sidebar
│   ├── ParameterInput.tsx      # Standardized form input matching OpenSCAD schema bounds
│   └── HitlWorkspace.tsx       # Core React context state machine & event handlers
├── hooks/
│   └── useCADEngine.ts         # Singleton compiler hook managing the Web Worker lifecycle
├── workers/
│   └── cad-worker.ts           # Background Web Worker executing openscad-wasm scripts
├── lib/
│   ├── auth.ts                 # NextAuth configurations (credentials provider)
│   ├── prisma.ts               # Global PostgreSQL database connection singleton
│   ├── openscadParameters.ts   # Regex-based OpenSCAD parser, parameter injector & math matrices
│   └── utils.ts                # Class merger tailwind helper utilities
├── prisma/
│   └── schema.prisma           # Prisma DB schema mapping tables
├── public/                     # Static icons, vector shapes, and workstation models
└── next.config.ts
```

---

## 🛠️ Getting Started & Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment variables

Create a `.env` file in the root of the `web-ui` directory:

```env
# fastapi endpoint
FASTAPI_URL=http://127.0.0.1:8000/api/v1

# Postgres DB URL
DATABASE_URL=postgresql://cad_user:cad_pass@localhost:5432/cad_db?schema=public

# NextAuth configuration
NEXTAUTH_SECRET=your_jwt_secret_here
NEXTAUTH_URL=http://localhost:3000
```

### 3. Build Prisma Schema

Sync the project schema definitions and build database models:

```bash
npm run prisma:generate
npm run prisma:push
```

### 4. Launch Next.js Dev Server

```bash
npm run dev
```

Open `http://localhost:3000` to start using the workspace.

---

## 🔮 Frontend Roadmap

Planned UI capabilities targeting developer experience and workstation features:

- **[ ] Live G-code Path Visualizer**: A specialized R3F renderer displaying slicing toolpaths (generated locally) as animated 3D lines, letting users inspect layers before export.
- **[ ] Interactive Parameter Range Graphs**: Graphical timeline sliders in the Parameter Drawer showing dependencies and bounds constraints.
- **[ ] Drag-and-Drop Assembly Constraints**: An interactive handles UI allowing users to click and drag parts together to configure assemblies.
- **[ ] Offline Web Worker Status Dashboard**: A workspace panel to monitor Web Worker CPU usage, compilation times, memory consumption, and WASM memory allocations.
- **[ ] Viewport Measure Tool**: A digital caliper tool letting users click any two vertices on the mesh to measure distances.
- **[ ] Workstation Theme Customizer**: Support for swapping styling environments (JetBrains Dark, Solidworks Light, CNC Console Orange).
