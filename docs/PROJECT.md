# CADVΞX - Project Overview

CADVEX is an AI-assisted parametric CAD workstation that translates prompt requests, sketches, and 2D engineering drawings into human-editable 3D CAD files. 

By pairing **Google's Gemini multimodal AI backend** for layout reasoning with a **client-side WebAssembly kernel** for instant geometry compiles, the workstation combines the accessibility of AI generation with the precision of traditional CAD software.

---

## 1. The Technology Stack

* **Frontend Framework**: Next.js 15 (React 19) + TypeScript + TailwindCSS.
* **3D Viewport Rendering**: Three.js + React Three Fiber (R3F) + `@react-three/drei`. Handles loaded STL mesh geometries, custom lighting stages, and edge outlines.
* **Database & Persistence**: PostgreSQL + Prisma ORM for storing user accounts, project parameters, and sharing tokens.
* **AI Workstation Backend**: Python 3.11+ + FastAPI + Uvicorn ASGI server.
* **Generative Models**: Google Gemini 3.1 & 3.5 models (interfaced via `google-genai` SDK).
* **CAD Kernel**: Browser-local **OpenSCAD WebAssembly (WASM)**. Geometry is compiled directly on the user's thread inside a Web Worker.

---

## 2. Directory Structure

```text
cadvex/
├── docker-compose.yml           # Runs PostgreSQL database instance
├── backend/                     # 🐍 Python FastAPI Backend (AI Logic)
│   ├── app/
│   │   ├── main.py              # Server configuration and CORS setup
│   │   ├── api/v1/router.py     # Endpoints: POST /generate and POST /edit
│   │   ├── models/schemas.py    # Request schemas (EditRequest, GenerateResponse)
│   │   └── services/
│   │       └── llm_codegen.py   # Gemini API client, prompts, and normalization
│   ├── requirements.txt
│   └── .env
└── frontend/                    # ⚛️ Next.js Web Workspace
    ├── app/
    │   ├── api/                 # BFF Gateway proxy routes
    │   │   ├── auth/            # NextAuth endpoints
    │   │   └── v1/
    │   │       ├── generate/    # Proxies new blueprint generations
    │   │       ├── edit/        # Proxies surgical code modifications
    │   │       ├── import/      # STEP & STL backend converters proxy
    │   │       └── export/      # STEP, STL, DXF, G-code exporters proxy
    │   ├── app/
    │   │   ├── demo/            # Demo-restricted sandbox workstation
    │   │   ├── login/           # Workstation login route
    │   │   ├── signup/          # Signup interface
    │   │   └── view/            # Shared model views
    │   ├── globals.css
    │   ├── layout.tsx
    │   └── page.tsx             # Main Workstation workspace page
    ├── features/                # 🧱 Modular Domain-Driven Feature Packages
    │   ├── cad-workspace/       # CAD Workstation package
    │   │   ├── components/      # Viewport, ParameterDrawer, StlMesh, etc.
    │   │   ├── containers/      # WorkspaceContainer (Main Coordinator)
    │   │   ├── hooks/           # useCadWorker, useWorkspaceEditor, useSessionHistory
    │   │   └── api/             # workspaceApi (generate, edit, repair CAD calls)
    │   └── cam/                 # CAM & Toolpath Configuration package
    │       ├── components/      # CamConfigModal
    │       ├── hooks/           # useStepCAM (handles STEP/STL imports & exports)
    │       ├── api/             # camApi (exposes import, export, and GCODE endpoints)
    │       └── types/           # cam.ts (centralized tool and CAM request definitions)
    ├── components/              # Shared generic UI components (Button, Dialog, etc.)
    ├── workers/
    │   └── cad-worker.ts        # Client-side Web Worker running OpenSCAD WASM
    ├── lib/
    │   ├── auth.ts              # NextAuth configuration credentials provider
    │   ├── prisma.ts            # Prisma connection client
    │   └── openscadParameters.ts# Script parameter parser & injector
    ├── prisma/
    │   └── schema.prisma        # Database schema models
    └── package.json
```

---

## 3. High-Level Workspace Workflow

```text
 User Description / Drawing
             │
             ▼
[ POST /api/v1/generate ] ──► (FastAPI AI engine parses details and returns OpenSCAD code)
             │
             ├─────────────────────────────────────────────────┐
             ▼ (recompile)                                     ▼
[ OpenSCAD WASM Web Worker ]                          [ Interactive Workspace ]
             │                                                 │
             ▼ (generates)                                     ├─► Parameters Drawer
   [ STL Mesh ArrayBuffer ]                                    ├─► Monaco Code Editor
             │                                                 └─► Chat Panel
             ▼ (renders)
    [ R3F 3D Viewport ] ──► (Proximity Click Matrix / Spatial Target Markers)
```

1. **CAD Synthesis**: The user uploads a blueprint drawing or writes a text description. The frontend proxies the request to the Python backend's `/generate` route. The AI analyzes the files and returns a fully parameterized OpenSCAD script.
2. **Local Compilation**: The script is compiled locally in the browser by the Web Worker. The resulting STL meshes are rendered in the Three.js viewport.
3. **Refinement & Proximity Clicks**: The user can modify variables in the side parameters drawer, write raw code in the Monaco Editor, or click directly on the 3D model to edit features (diameter/height) via proximity detection.
4. **Surgical Modification**: The user can also click blank areas to drop a target marker and send a prompt (e.g. *"add a boss here"*). This triggers the `/edit` proxy, surgically modifying the existing code rather than rewriting it from scratch.
