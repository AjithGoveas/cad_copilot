# ⚙️ CADVEX AI Engine (FastAPI Clean Architecture Backend)

The Python FastAPI backend service that orchestrates the machine-intelligence layer of CADVEX. It converts natural language prompts, hand-drawn sketches, and blueprint drawings (PDF/images) into clean, parameterized OpenSCAD CAD scripts utilizing multiple LLM vendors (Google, OpenAI, Anthropic, DeepSeek, and local Ollama) via a vendor-agnostic Frontend-Driven Metadata configuration.

It is built adhering strictly to the **Clean Architecture (Layered Architecture)** principles and the **Repository/Gateway Patterns**, guaranteeing zero dependency on concrete SDK libraries or database pools inside the domain logic.

---

## 🏗️ Clean Layered Architecture Diagram

The service acts as a stateless, high-performance API endpoint divided into inward-pointing layers:

```text
       Presentation (v1/router.py) ➔ Application (use_cases/) ➔ Domain (models/ & interfaces/)
            │                                                      ▲
            ▼                                                      │
       Infrastructure (httpx_gateway.py & prisma_repository.py) ───┘
```

1. **Enterprise Domain Layer (`app/domain/`)**: Pure entity declarations (`ModelMetadata`, `Session`, `HistoryItem`) and technology-agnostic abstract contracts (`ISessionRepository`, `ILLMProviderGateway`, `ICADEngine`, `ICAMEngine`).
2. **Application Interactor Layer (`app/application/`)**: Encapsulates use-case orchestrators (`GenerateCadUseCase`, `EditCadUseCase`, `RepairCadUseCase`). Implements retry mechanisms, prompt budgeting, and normalization.
3. **Infrastructure Adapters Layer (`app/infrastructure/`)**: Concrete adapter bindings:
   - `UniversalHTTPXGateway`: Thread-safe HTTPX connection pool executing REST requests to LLM providers without vendor SDK packages.
   - `PrismaSessionRepository`: Simulates Prisma 7 connection manager, writing transactional logs directly to `backend/logs/prisma_repository.log`.
   - `cad/`: Geometry engines wrapping `build123d` and OpenCascade `OCP`.
4. **Presentation API Layer (`app/presentation/`)**: Controller router (`presentation/v1/router.py`) mapping requests to use-case executions. Completely decoupled from third-party CAD libraries.

---

## 📂 Directory Layout

```text
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                # FastAPI startup entry point & CORS configuration
│   ├── domain/                # 1. Pure Enterprise Domain Layer
│   │   ├── __init__.py
│   │   ├── models/            # Sub-modularized Domain Models
│   │   │   ├── __init__.py
│   │   │   ├── generation_models.py
│   │   │   ├── gcode_models.py
│   │   │   └── step_models.py
│   │   └── interfaces/        # Agnostic abstract contracts
│   │       ├── __init__.py
│   │       ├── repository_interfaces.py
│   │       ├── gateway_interfaces.py
│   │       └── cad_interfaces.py
│   ├── application/           # 2. Application Layer
│   │   ├── __init__.py
│   │   └── use_cases/         # Sub-modularized Use Cases package
│   │       ├── __init__.py
│   │       ├── base_use_case.py
│   │       ├── generate_cad_use_case.py
│   │       ├── edit_cad_use_case.py
│   │       └── repair_cad_use_case.py
│   ├── infrastructure/        # 3. Infrastructure Layer
│   │   ├── __init__.py
│   │   ├── httpx_gateway.py   # Raw HTTPX provider gateway
│   │   ├── prisma_repository.py # Simulated Prisma 7 connection manager repository
│   │   └── cad/               # Concrete CAD/CAM implementations
│   │       ├── __init__.py
│   │       ├── csg_parser.py
│   │       ├── export_utils.py
│   │       ├── gcode_generator.py
│   │       ├── materials_db.py
│   │       ├── cad_engine.py
│   │       └── cam_engine.py
│   └── presentation/          # 4. Presentation Layer
│       ├── __init__.py
│       └── v1/                # Versioned presentation package
│           ├── __init__.py
│           └── router.py      # FastAPI v1 routers (no build123d dependencies)
```

---

## 🔌 API Reference (Version v1)

All generation and editing routes support cascading fallback retries: if the primary reasoning model hits limits (e.g. status code 5xx, 429, or timeout), it automatically retries with the client's `fallback_metadata` block.

### 1. `POST /api/v1/generate`
Generates a parametric OpenSCAD script from blueprints (PDF/Image) or descriptions.
- **Content-Type**: `multipart/form-data`
- **Body Parameters**:
  - `prompt` (Form string, Required): Geometry/functional request.
  - `model_metadata` (Form JSON string, Required): Primary model configurations.
  - `fallback_metadata` (Form JSON string, Optional): Failover model configurations.
  - `image` (File, Optional): Blueprint drawing file (PNG/JPEG/PDF).
  - `session_id` (Form string, Optional): Unique active workspace identifier.

### 2. `POST /api/v1/edit`
Surgically edits active code based on text instructions and coordinate boundaries.
- **Content-Type**: `application/json`
- **Request Body** (`EditRequestSchema`):
  ```json
  {
    "prompt": "increase base plate depth",
    "current_code": "$fn = 32;\n...",
    "target_point": [10.5, 0.0, 15.0],
    "model_metadata": { "id": "gemini-2.5-flash", ... },
    "fallback_metadata": null,
    "session_id": "session-123"
  }
  ```

### 3. `POST /api/v1/repair`
Executes syntax healing and self-recovery passes on compilation errors.
- **Content-Type**: `application/json`

### 4. `POST /api/v1/export-step`
Transforms the provided CSG script to raw STEP file bytes and streams it.
- **Content-Type**: `application/json`

### 5. `POST /api/v1/export-stl`
Converts cached step shape references to raw STL bytes.

### 6. `POST /api/v1/export-dxf`
Projects cached shape references to blueprint views (silhouette, section, or blueprint) and exports as DXF.

### 7. `POST /api/v1/gcode`
Processes a CAMJobRequest to analyze features (holes, slots, profiles) and generates G-code lines along with toolpath coordinates.

### 8. `GET /api/v1/material-defaults`
Retrieves spindle speed, feed rate, plunge rate, and stepdown defaults for tool diameters in Delrin, Plywood, Acrylic, Mild Steel, and Aluminum.

---

## 🛠️ Installation & Setup

1. **Configure Environment**:
   ```bash
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   ```
2. **Local Environment Variables (`.env`)**:
   Create a `.env` file from the example:
   ```env
   GOOGLE_API_KEY=...
   DEEPSEEK_API_KEY=...
   ANTHROPIC_API_KEY=...
   OPENAI_API_KEY=...
   OLLAMA_HOST=...
   ```
3. **Run Development Server**:
   ```bash
   uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
   ```