from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
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


def _error_payload(message: str, hint: str | None = None) -> dict[str, dict[str, str]]:
    payload: dict[str, str] = {"message": message}
    if hint:
        payload["hint"] = hint
    return {"error": payload}


@app.exception_handler(RequestValidationError)
async def request_validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    field_names: list[str] = []
    for err in exc.errors():
        loc = [str(item) for item in err.get("loc", []) if item not in {"body", "query", "path"}]
        if loc:
            field_name = ".".join(loc)
            if field_name not in field_names:
                field_names.append(field_name)

    hint = None
    if field_names:
        hint = f"Check fields: {', '.join(field_names[:3])}."

    return JSONResponse(
        status_code=422,
        content=_error_payload("Invalid request input.", hint),
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail

    if isinstance(detail, dict) and isinstance(detail.get("error"), dict):
        return JSONResponse(status_code=exc.status_code, content=detail)

    if isinstance(detail, str):
        return JSONResponse(status_code=exc.status_code, content=_error_payload(detail))

    return JSONResponse(
        status_code=exc.status_code,
        content=_error_payload("Request failed.", "Please review your input and try again."),
    )


@app.get("/health", tags=["system"])
def health_check() -> dict[str, str]:
    return {"status": "ok"}
