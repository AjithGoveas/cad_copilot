from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "outputs"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def _load_env_file() -> None:
    # Import lazily so the app can still start if dependency sync is pending.
    try:
        import importlib

        dotenv = importlib.import_module("dotenv")
        dotenv.load_dotenv(PROJECT_ROOT / ".env")
    except Exception:
        return


# Load ai-engine/.env so runtime secrets like GOOGLE_API_KEY are available.
_load_env_file()

from app.api.v1.router import router as v1_router

app = FastAPI(title="Docs-to-CAD API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")
app.include_router(v1_router, prefix="/api/v1")


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
