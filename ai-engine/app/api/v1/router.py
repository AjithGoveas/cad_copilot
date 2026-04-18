import json
import uuid
import asyncio
import os
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.models.schemas import RenderRequest, RenderResponse, RenderedCadArtifacts, GeneratedCadParameter
from app.services.llm_codegen import LLMCodegenService
from app.services.parameter_render import ParameterRenderService, extract_parameters_from_script

router = APIRouter(tags=["cad"])
render_service = ParameterRenderService()
DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")

def _as_sse(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"

@router.post("/generate")
async def generate(
    request: Request,
    prompt: str = Form(...),
    image: UploadFile = File(...),
    model_name: str = Form(DEFAULT_MODEL),
) -> StreamingResponse:

    content_type = (image.content_type or "").lower()
    is_image = content_type.startswith("image/")
    is_pdf = content_type == "application/pdf" or (
        bool(image.filename) and image.filename.lower().endswith(".pdf")
    )

    if content_type and not (is_image or is_pdf):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image or PDF.")

    image_bytes = await image.read()
    mime_type = content_type if content_type else ("application/pdf" if image.filename and image.filename.lower().endswith(".pdf") else "image/png")

    try:
        codegen_service = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    async def event_stream():
        try:
            yield _as_sse("status", {"message": "Generating build123d script."})

            script_chunks: list[str] = []

            for chunk in codegen_service.stream_build123d_script(
                prompt=prompt,
                image_bytes=image_bytes,
                image_mime_type=mime_type,
            ):
                if await request.is_disconnected():
                    return

                script_chunks.append(chunk)
                yield _as_sse("token", {"chunk": chunk})

            if not script_chunks:
                raise RuntimeError("Model returned no script output.")

            script = codegen_service.normalize_script("".join(script_chunks))
            parsed_parameters = extract_parameters_from_script(script)
            yield _as_sse(
                "done",
                {
                    "script": script,
                    "parameters": parsed_parameters,
                    "hint": "Call /api/v1/render with parameters + script to produce STL/STEP.",
                },
            )
        except asyncio.CancelledError:
            # Client disconnected gracefully
            return
        except Exception as exc:
            yield _as_sse("error", {"message": str(exc)})
            return

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/render", response_model=RenderResponse)
def render(request: RenderRequest) -> RenderResponse:
    # 1. Generate IDs
    job_id = request.session_id or uuid.uuid4().hex
    output_basename = f"cad_{job_id}"

    # 2. Block and execute the render synchronously (Zero 404 race conditions)
    try:
        paths = render_service.render_to_outputs(
            parameters=request.parameters,
            script=request.python_script,
            output_basename=output_basename,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Render Engine Failed: {str(exc)}")

    # 3. Format parameters back for the response UI
    reconstructed_params = [
        GeneratedCadParameter(
            name=k,
            value=str(v),
            kind="number" if isinstance(v, (int, float)) else "string"
        )
        for k, v in request.parameters.items()
    ]

    # 4. Return exact schema Next.js expects
    return RenderResponse(
        session_id=job_id,
        status="SUCCESS",
        artifacts=RenderedCadArtifacts(
            session_id=job_id,
            step_file_path=paths["step_path"],
            stl_file_path=paths["stl_path"],
            step_url=f"/outputs/{output_basename}.step",
            stl_url=f"/outputs/{output_basename}.stl",
            script_url="",
            python_script=request.python_script,
            parameters=reconstructed_params
        )
    )
