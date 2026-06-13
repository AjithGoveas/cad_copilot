# 🐳 CADVEX Docker Setup & Orchestration Guide

This document provides complete instructions for configuring, developing, and deploying CADVEX using Docker. It covers the multi-stage targeted Dockerfiles, folder-isolated environment files, hostname overrides, named caching volumes, and service startup orchestration.

---

## 🏗️ Docker Architecture Overview

CADVEX employs a highly modular, secure, and optimized container orchestration structure:
* **Targeted Builds**: Single Dockerfiles per service contain separate `development` stages (with live hot-reloading) and optimized `production` stages (minimal assets footprint).
* **Isolated Configuration**: Environment variables are stored in folder-specific files (`/backend/.env` and `/frontend/.env`) to keep service boundaries clean and ready for VM scaling.
* **Network DNS Hostname Overrides**: Host connection parameters default to `localhost` (for native host running) and are dynamically mapped to container DNS names (`postgres`, `backend`) only inside the Docker network.
* **Persistent Named Caching**: Anonymous volumes are replaced with named volumes to avoid file leaks, save disk space, and cache build resources.
* **Healthcheck Dependency Chain**: Services boot in a strict sequential order: Database ➔ Backend ➔ Frontend.

---

## 🚦 Prerequisites
* **Docker Engine** (or Docker Desktop) installed and running.
* **Docker Compose V2** (cli command: `docker compose`).

---

## 🛠️ 1. Development Mode Setup

Development mode mounts local source folders directly into the containers, enabling uvicorn's reload and Next.js hot module replacement (HMR).

### Step 1: Configure Folder-Level Environment Files

#### 🐍 Backend Config (`/backend/.env`)
Create `/backend/.env` with your Gemini API details:
```env
GOOGLE_API_KEY=your_gemini_api_key_here
GENAI_MODEL=gemini-3.1-flash-lite
GENAI_MAX_RETRIES=5
GENAI_RETRY_BASE_DELAY=1.5
GENAI_MAX_RETRY_DELAY=75
```

#### ⚛️ Frontend Config (`/frontend/.env`)
Create `/frontend/.env` with your database credentials and auth details:
```env
# Database Credentials (will be automatically loaded by Postgres container)
POSTGRES_DB=cad_db_2
POSTGRES_USER=postgres
POSTGRES_PASSWORD=root

# Local Native Connection URL (for running outside Docker on host PC)
DATABASE_URL=postgresql://postgres:root@localhost:5432/cad_db_2?schema=public
DIRECT_URL=postgresql://postgres:root@localhost:5432/cad_db_2?schema=public

# Local Native Backend Connection (for running outside Docker on host PC)
FASTAPI_URL=http://127.0.0.1:8000/api/v1

# Authentication
NEXTAUTH_SECRET=7a660d3d52697b095995e808e06822ba
NEXTAUTH_URL=http://localhost:3000
```

### Step 2: Spin Up the Stack
From the project root directory, run:
```bash
docker compose up --build -d
```
*Docker Compose will automatically load the dev environment file (`docker-compose.yml`), start the services, build target stages, and link network volumes.*

### Step 3: Access the Workstation
* **Frontend Web Application**: `http://localhost:3000`
* **FastAPI Swagger API Documentation**: `http://localhost:8000/docs`
* **Database Connection (Local Tooling)**: Connect your client (DBeaver, pgAdmin) to `localhost:5432` using username `postgres` and password `root`.

### Step 4: Terminate Dev Mode
To stop the containers and clear networks:
```bash
docker compose down
```
*(Your data inside the PostgreSQL volume remains completely safe).*

---

## 🚀 2. Production Mode Setup (VM Ready)

Production mode compiles standalone Next.js server builds, strips dev dependencies, and runs services under non-root users (`appuser` / `nextjs`) for high security.

### Step 1: Configure Env Files
Set up your production credentials in `/backend/.env` and `/frontend/.env` on the host machine. (e.g. Set `DATABASE_URL` to your production Supabase database).

### Step 2: Launch Production Orchestration
From the project root directory, run:
```bash
docker compose -f docker-compose.prod.yml up --build -d
```

### How the Production Pipeline works:
1. **`postgres`**: Boots and runs initialization health checks.
2. **`db-migrate`**: Spawns an ephemeral container built from the `builder` stage, loads schema files, executes `npx prisma db push` to verify database consistency, and exits.
3. **`backend`**: Starts the optimized Python service and verifies health.
4. **`frontend`**: Launches the Next.js standalone runner only after `db-migrate` has successfully completed.

---

## 💾 3. Volume and Storage Management

To prevent anonymous volume leakage and disk bloat, development caching uses named Docker volumes.

### Persistent Named Volumes List:
* `cadvex_postgres_data`: Stores database tables and structures.
* `cadvex_backend_venv`: Caches python virtual environments inside the container.
* `cadvex_backend_pycache`: Caches compiled python bytecode.
* `cadvex_frontend_node_modules`: Caches node library dependencies.
* `cadvex_frontend_next`: Caches Next.js build chunks.

### How to Clean/Reset Storage
If you make major dependency changes or want to reset the database and cache completely, run:
```bash
# Stops container stack and deletes all persistent database and cache volumes
docker compose down -v

# Alternatively, delete unused volumes manually
docker volume prune
```

---

## 🔍 4. Troubleshooting & Diagnostics

* **Port Conflict (`Port 5432 already allocated`)**: 
  Ensure your local host computer's Postgres database service is stopped before starting Docker. On Windows, stop the service via Task Manager ➔ Services ➔ PostgreSQL.
* **Inspecting Container Logs**:
  ```bash
  # View live logs for the backend container
  docker compose logs -f backend
  
  # View logs for the frontend container
  docker compose logs -f frontend
  ```
* **Verify Health Status**:
  ```bash
  docker compose ps
  ```
