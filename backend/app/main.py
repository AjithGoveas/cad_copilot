"""CADVEX V2 — FastAPI entry point."""
from pathlib import Path

# Load .env before importing anything that needs it
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
except Exception:
    pass

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.presentation.v1.router import router as v1_router

from fastapi.openapi.docs import get_swagger_ui_html

app = FastAPI(
    title="⚙️ CADVEX AI Engine API",
    description="""
    Simple CAD & CAM Generation Workstation.
    
    This API converts text descriptions, sketches, and engineering drawings into 3D CAD scripts (OpenSCAD) and CNC toolpaths (G-code). 
    
    Key Features:
    - 3D CAD Generation (automated conversion from drawings),
    - Surgical CAD Edits (modify geometries using viewport coordinate targets),
    - CNC G-code Processing (direct 3D shape feature analysis),
    - Cascading Retries (resilient fallbacks across multiple AI models).
    """,
    version="2.0.0",
    contact={
        "name": "Ajith Goveas",
        "email": "ajith.goveas@datavex.ai",
    },
    docs_url='/docs',
    redoc_url='/redoc',
    app_name="CADVEX V2" if False else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix="/api/v1")


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={"error": {"message": "Invalid request.", "detail": exc.errors()}},
    )


@app.exception_handler(HTTPException)
async def http_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.detail)


@app.get("/health", tags=["system"])
def health() -> dict:
    return {"status": "ok", "version": "2.0.0"}
