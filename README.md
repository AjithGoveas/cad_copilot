# 📐 CAD Copilot

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.136.0-009688.svg?style=flat&logo=FastAPI)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-15.0-black.svg?style=flat&logo=next.js)](https://nextjs.org)
[![Three.js](https://img.shields.io/badge/Three.js-0.184-black.svg?style=flat&logo=three.js)](https://threejs.org)
[![Gemini](https://img.shields.io/badge/Gemini_API-3.5_Flash-4F5B93.svg?style=flat&logo=google)](https://ai.google.dev)

CAD Copilot is a state-of-the-art, AI-assisted CAD workstation designed to bridge the gap between natural language/drawings and parameterized 3D design models. By pairing **Google's Gemini multimodal LLM engine** with a **client-side WebAssembly OpenSCAD compilation kernel**, CAD Copilot allows engineers to generate, visualize, and surgically edit CAD code in real time without heavy server dependencies.

![CAD Workstation Landing Mockup](https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1200&q=80) *(For visualization purposes only)*

---

## ⚡ Core Philosophy & Capabilities

Traditional CAD workflows require intensive manual drafting, while standard text-to-3D generators output un-editable, dense triangle meshes. CAD Copilot approaches 3D modeling as **Parametric Code Synthesis**. It generates human-readable, mathematically exact, and easily adjustable code.

### 🔍 1. Multimodal Blueprint Audit
Upload an engineering drawing, blueprint (PDF/PNG/JPEG), or a hand-drawn sketch. The AI Engine performs a multi-view visual analysis, extracting exact dimensions, coordinate alignments, feature hierarchies, and stacking references into a structured design matrix.

### 🌐 2. Browser-Local WASM Kernel
All 3D rendering happens directly on the client. Enforcing a global singleton WebAssembly worker instance (compiled from OpenSCAD), CAD Copilot processes changes and returns 3D STL geometry instantly in the browser. This setup eliminates rendering roundtrips, scales without server cost, and operates sandboxed.

### 📐 3. Proximity-Based "Quick Edit"
Click directly on cylindrical walls, circular holes, or planar faces of the 3D mesh. The viewport runs a spatial proximity algorithm matching the click coordinate to parameter ranges:
* **Diameters / Cylinders**: Shorts distance from selection to the infinite central axis line minus the feature's radius.
* **Heights / Extrusions**: Point-to-plane distance along the extrusion direction to the top or bottom flat faces.
Matches spawn an in-canvas, auto-focusing interactive overlay, letting you instantly change numeric parameters.

### 📍 4. Spatial Target Context Injection
Drop a glowing visual crosshair marker anywhere on the empty 3D model surface. The coordinate coordinates are added as a spatial target attachment chip in the chat composer. When you send a message (e.g. *"add a screw boss here"*), these absolute `[x, y, z]` coordinates are silently sent as system context, positioning the AI's edit right at the clicked spot.

### 🗺️ 5. Automated 4-View technical Drawings
Convert 3D assemblies into 2D vector drawings (DXF). The app implements safety projection wrappers that automatically generate standard engineering views (Top, Front, Right, and Isometric) in a single sheet.

---

## 🏗️ System Architecture

CAD Copilot split roles cleanly between backend AI intelligence and client-side execution:

```mermaid
graph TD
    User([User Prompt / Drawing]) -->|POST /generate| BFF[Next.js API Gateway]
    BFF -->|Multipart Form| Python[FastAPI AI Backend]
    Python -->|Stage 1: Vision Audit| GeminiVision[Gemini API - Vision]
    GeminiVision -->|JSON Feature Map| GeminiText[Gemini API - Codegen]
    GeminiText -->|OpenSCAD Code| Python
    Python -->|Sanitize & Format| BFF
    BFF -->|Code + Parameters| Client[Web Workspace]
    Client -->|WASM Worker Singleton| Viewport[3D R3F Viewport]
    
    Viewport -->|Mesh Click Proximity| QuickEdit[Floating Overlay]
    Viewport -->|Mesh Empty Click| TargetMarker[Target Marker]
    TargetMarker -->|Coordinate injection| BFFEdit
    
    UserPromptEdit([Edit Instruction]) -->|POST /edit| BFFEdit[Next.js Edit Proxy]
    BFFEdit -->|JSON Request| PythonEdit[FastAPI Edit Endpoint]
    PythonEdit -->|Refinement Prompt| GeminiEdit[Gemini API - Isolated Edit]
    GeminiEdit -->|Updated Code| PythonEdit
    PythonEdit -->|Sanitized Script| BFFEdit
    BFFEdit -->|Refreshed Model| Client
```

---

## 🚦 Getting Started

### 1) Prerequisites
- **Node.js 20+**
- **Python 3.11+**
- **Docker Desktop** (For local PostgreSQL persistence)

### 2) Database Setup
Start the PostgreSQL container from the root directory:
```bash
docker compose up -d
```

### 3) FastAPI AI Engine Setup
Configure your Google Gemini API key and dependencies:
```bash
cd ai-engine
cp .env.example .env  # Add GOOGLE_API_KEY=your_key
python -m venv .venv
# Activate venv:
# Windows (PowerShell): .venv\Scripts\Activate.ps1
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

### 4) Web UI Setup
Initialize database schemas and run Next.js:
```bash
cd ../web-ui
cp .env.example .env
npm install
npm run prisma:generate
npm run prisma:push
npm run dev
```
Navigate to `http://localhost:3000` to start editing.

---

## 🚀 Future Roadmap

We are expanding CAD Copilot into a comprehensive, production-grade engineering platform. The following features are currently planned:

* **[ ] Native STEP Export**: Integrate python-based OpenCASCADE / FreeCAD rendering pipelines on the backend to allow downloading exact B-Rep STEP models alongside standard STL meshes.
* **[ ] Slicing & G-Code Integration**: Direct client-side integration of lightweight slicing algorithms to allow generating 3D printing paths (G-code) directly from the parametric canvas.
* **[ ] CNC Toolpath Previews**: Output post-processed G-code optimized for 3-axis CNC milling operations directly from the subtractive metadata.
* **[ ] Offline LLM Support**: Support running local code models (e.g. Qwen-Coder or Llama-3-Coder) via Ollama, enabling offline CAD generation and secure parameter processing.
* **[ ] Hierarchical Assembly Constraints**: Bind multiple generated parts together using rigid joints, cylindrical constraints, and mechanical mates inside the 3D viewport.
* **[ ] Automated Tolerance Auditing**: AI checks matching parts for tolerances, interference fits, and mechanical clearances.

---

## 📄 License
This project is licensed under the MIT License - see the LICENSE file for details.
