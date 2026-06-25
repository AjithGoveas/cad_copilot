# CADVEX AI Engine - Clean Architecture Document

## Overview

The CADVEX backend is designed using Clean Architecture (Layered Architecture) and Domain-Driven Design (DDD) principles. It separates the core business rules (Domain and Use Cases) from external frameworks, libraries (FastAPI, HTTPX, build123d, OpenCascade OCP), and data stores.

---

## 1. Target Architecture & Layer Matrix

Inward-pointing dependencies ensure that core logic remains entirely unaware of technical implementation details (gateways, frameworks, databases, or third-party CAD toolsets).

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                      Presentation Layer                     │
 │                     app/presentation/v1/                    │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Calls Interact
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                      Application Layer                      │
 │                    app/application/use_cases/               │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Uses Abstractions
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                         Domain Layer                        │
 │           app/domain/models/  &  app/domain/interfaces/     │
 └──────────────────────────────▲──────────────────────────────┘
                                │ Implements Contracts
                                │
 ┌──────────────────────────────┴──────────────────────────────┐
 │                     Infrastructure Layer                    │
 │                     app/infrastructure/                     │
 └─────────────────────────────────────────────────────────────┘
```

### 1. Pure Enterprise Domain Layer (`app/domain/`)
The inward core. It holds pure Python entities and business validation rules.
- **Models (`app/domain/models/`)**: Grouped sub-modularly:
  - `generation_models.py`: Contracts for model metadata, history logs, and codegen payloads.
  - `gcode_models.py`: Data schemas for machine feeds, tools, and CAM configuration limits.
  - `step_models.py`: Definitions for file imports and exports.
- **Interfaces (`app/domain/interfaces/`)**: Technology-agnostic abstract contracts (ABCs) that declare the boundaries for data persistence and external adapters:
  - `repository_interfaces.py` (`ISessionRepository`)
  - `gateway_interfaces.py` (`ILLMProviderGateway`)
  - `cad_interfaces.py` (`ICADEngine`, `ICAMEngine`)

### 2. Application Layer (`app/application/`)
Orchestrates request interactors. Depends purely on the domain contracts.
- **Use Cases (`app/application/use_cases/`)**:
  - `base_use_case.py` (`UseCaseBase`): Implements universal geometry normalizations, OpenSCAD script sanitizations, and bounding-box safety clamps.
  - `generate_cad_use_case.py`: Manages the visual blueprint audit (using an MD5 hash visual caching structure) and codegen prompts synthesis. Implements cascading retries across `fallback_metadata` blocks.
  - `edit_cad_use_case.py`: Surgical editing engine incorporating spatial click-coordinate injection.
  - `repair_cad_use_case.py`: Syntax error healing pass.

### 3. Infrastructure Layer (`app/infrastructure/`)
Contains technology-specific concrete implementations of the domain contracts.
- **Gateways (`httpx_gateway.py`)**: Uses a thread-safe `httpx.AsyncClient` pool with explicit limits (`max_connections=100`, `max_keepalive_connections=20`) to invoke vendor REST endpoints directly, removing heavy provider SDK packages from the service.
- **Persistence (`prisma_repository.py`)**: Simulates a Prisma 7 client pool manager, logging connection checkouts and returns directly to `backend/logs/prisma_repository.log`.
- **CAD/CAM Engine (`cad/`)**: Sub-modularized adapter libraries that wrap native CAD kernels (`build123d` and OpenCascade `OCP` binaries):
  - `csg_parser.py` & `gcode_generator.py`: Low-level geometric parsers and toolpath slicers.
  - `cad_engine.py` & `cam_engine.py`: Concrete implementations of the `ICADEngine` and `ICAMEngine` interfaces.

### 4. Presentation Layer (`app/presentation/`)
The entry point. Receives HTTP connections, parses Form/JSON boundaries, and triggers the interactors.
- **Versioned API Ingress (`presentation/v1/router.py`)**: Mounts versioned FastAPI controllers under `/api/v1`. Completely decoupled from `build123d` and geometric libraries.

---

## 2. Thread-Safety & Pool Configurations

1. **HTTP Connection Pool**:
   Managed globally in `httpx_gateway.py`:
   ```python
   _http_client = httpx.AsyncClient(
       timeout=httpx.Timeout(90.0, connect=10.0),
       limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
   )
   ```
2. **CPU-Bound Subprocess Offloading**:
   Since CAD compilation (`build123d`, `OCP`) and G-code generation are heavily CPU-bound, all parsing and file compilation workloads inside `router.py` are offloaded to asynchronous worker threads to prevent blocking the event loop:
   ```python
   result = await asyncio.to_thread(cad_engine.import_step_to_stl, file_bytes)
   ```

---

## 3. Persistent Storage and Named Volumes

1. **Database/Session Logging**:
   The backend writes structured log records to a dedicated file:
   - File Path: `/app/logs/prisma_repository.log` (mapped to Named Volume `cadvex_backend_logs` in development, `cadvex_backend_logs_prod` in production).
2. **Byte Streaming**:
   All files generated (STEP, STL, DXF) are compiled in isolated memory streams (`io.BytesIO`) and piped directly to the client as transient payloads, eliminating the need to mount writable local file stores for output assets.
