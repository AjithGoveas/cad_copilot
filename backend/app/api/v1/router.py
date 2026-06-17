"""CADVEX V2 - /api/v1 router."""
from __future__ import annotations

import asyncio
import json
import os
import re
from pathlib import Path
from typing import Any

import uuid
import io
import gc
import concurrent.futures
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse
from app.models.schemas import GenerateResponse, EditRequest, StepRequest, GCodeRequest, GCodeResponse, CAMJobRequest
from app.services.csg_parser import CSGParser, export_to_step
from app.services.llm_codegen import LLMCodegenService

router = APIRouter(tags=["cad"])

_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT   = {"application/pdf"}
_DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")


def _extract_parameters(script: str) -> dict[str, Any]:
    """Pull the PARAMETERS_JSON block out of the generated script."""
    m = re.search(r"/\*\s*PARAMETERS_JSON\s*(\{.*?\})\s*\*/", script, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return {}


def _resolve_mime(content_type: str, filename: str) -> str | None:
    """Return the canonical MIME type or None if unsupported."""
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct in _ALLOWED_MIME_EXACT:
        return ct
    if any(ct.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        return ct
    # Fallback: infer from extension
    if filename.lower().endswith(".pdf"):
        return "application/pdf"
    return None


def _sanitize_script(script: str) -> str:
    """
    Server-side safety net applied to every generated script before it is
    returned to the frontend. Applies three targeted regex fixes:

    Guard 1 - $fn cap
        Any `$fn = N` where N > 32 is rewritten to `$fn = 32`.

    Guard 2 - $fn injection
        If the script has no `$fn` at all, prepend `$fn = 32;`.

    Guard 3 - eps injection
        If the script has `difference()` but no `eps` variable, inject
        `eps = 0.02;` before the first module or difference() block.

    Guard 4 - Library Strip
        Hallucinated `include <BOSL2/std.scad>` or similar are removed
        to ensure the script remains vanilla and portable.
    """
    if not script:
        return script

    # -- Guard 4: Strip BOSL2 includes -----------------------------------------
    script = re.sub(r'include\s*<BOSL2/.*?>;?', '', script, flags=re.I)

    # -- Guard 1: cap every $fn value that exceeds 32 --------------------------
    FN_CAP = 32

    def _cap_fn(match: re.Match) -> str:
        val = int(match.group(1))
        capped = min(val, FN_CAP)
        return match.group(0).replace(match.group(1), str(capped))

    script = re.sub(r'\$fn\s*=\s*(\d+)', _cap_fn, script)

    # -- Guard 2: inject $fn = 32 if entirely absent ---------------------------
    if "$fn" not in script:
        script = "$fn = 32;\n\n" + script

    # -- Guard 3: inject eps = 0.02 if difference() exists but eps is absent --
    has_difference = "difference()" in script
    has_eps        = re.search(r'\beps\s*=', script) is not None

    if has_difference and not has_eps:
        if "// PARAMETERS_START" in script:
            script = script.replace(
                "// PARAMETERS_START",
                "// PARAMETERS_START\neps = 0.02;  // CGAL crash prevention",
                1,
            )
        else:
            # Fallback: inject before the first module or difference() block
            script = re.sub(
                r'(\bmodule\b|\bdifference\(\))',
                r'eps = 0.02;  // CGAL crash prevention\n\n\1',
                script,
                count=1,
            )

    return script

@router.post("/generate", response_model=GenerateResponse)
async def generate(
    prompt: str = Form(...),
    model_name: str = Form(_DEFAULT_MODEL, alias="model"),
    image: UploadFile = File(None),
    base_code: str | None = Form(None),
    selection_context: str | None = Form(None),
) -> GenerateResponse:
    """
    Two-stage CAD generation pipeline:
      1. Audit blueprint image/PDF  →  structured feature-map JSON
      2. Synthesise/refine OpenSCAD script via BOSL2 codegen
    `image` is optional for text-only refinement sessions.
    """
    # ── Validate & read uploaded file ────────────────────────────────────────
    image_bytes: bytes | None = None
    mime_type: str | None = None

    if image and image.filename:
        mime_type = _resolve_mime(image.content_type or "", image.filename)
        if mime_type is None:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": "File must be an image (PNG/JPEG/WEBP) or PDF."}},
            )
        image_bytes = await image.read()

    # ── Initialise service ────────────────────────────────────────────────────
    try:
        svc = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    # ── Stage 1: Blueprint Audit (skip if no image) ──────────────────────────
    feature_map: dict[str, Any] = {}
    if image_bytes and mime_type and image:
        try:
            feature_map = await asyncio.to_thread(
                svc.audit_blueprint, image_bytes, mime_type, image.filename
            )
        except Exception as exc:
            # Non-fatal: proceed with empty feature map
            print(f"[audit] failed — {exc}")

    # ── Stage 2: Script Generation / Refinement ───────────────────────────────
    try:
        script = await asyncio.to_thread(
            svc.generate_script,
            prompt=prompt,
            image_bytes=image_bytes,
            mime_type=mime_type,
            feature_map=feature_map,
            base_code=base_code,
            selection_context=selection_context,
            filename=image.filename if image else "blueprint.pdf",
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc), "hint": "Check API key and quota."}},
        )

    # ── Server-side safety net ────────────────────────────────────────────────
    # Ensures eps=0.02 and $fn=32 are always present even if the AI omitted them.
    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


@router.post("/edit", response_model=GenerateResponse)
async def edit(request: EditRequest) -> GenerateResponse:
    """
    Surgically edit an existing OpenSCAD script.
    """
    try:
        svc = LLMCodegenService(model=request.model)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    try:
        script = await asyncio.to_thread(
            svc.edit_script,
            prompt=request.prompt,
            current_code=request.current_code,
            target_point=request.target_point,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc), "hint": "Check API key and quota."}},
        )

    # Server-side safety net
    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


def _cleanup_file(path: Path):
    try:
        if path.exists():
            path.unlink()
    except Exception:
        pass


# @router.post("/step")
# async def export_step(request: StepRequest, background_tasks: BackgroundTasks) -> FileResponse:
#     """
#     Convert flat CSG tree into a parametric STEP model.
#     """
#     try:
#         shape = CSGParser.parse(request.csg_tree)
        
#         # Create unique file path in outputs directory
#         outputs_dir = Path(__file__).resolve().parents[3] / "outputs"
#         outputs_dir.mkdir(exist_ok=True)
        
#         step_filename = f"model_{uuid.uuid4().hex}.step"
#         step_path = outputs_dir / step_filename
        
#         export_to_step(shape, str(step_path))
        
#         background_tasks.add_task(_cleanup_file, step_path)
        
#         return FileResponse(
#             path=step_path,
#             media_type="application/octet-stream",
#             filename="generated_model.step"
#         )
#     except Exception as exc:
#         raise HTTPException(
#             status_code=500,
#             detail={"error": {"message": f"STEP conversion failed: {exc}"}}
#         )


def _process_export_step(csg_tree: str) -> bytes:
    from app.services.csg_parser import CSGParser
    from app.services.export_utils import build123d_to_step_bytes
    shape = CSGParser.parse(csg_tree)
    return build123d_to_step_bytes(shape)

@router.post("/export-step")
async def export_step_stream(request: StepRequest) -> StreamingResponse:
    """
    Convert flat CSG tree into a parametric STEP model and stream in-memory.
    """
    try:
        step_bytes = await asyncio.to_thread(_process_export_step, request.csg_tree)

        
        bio = io.BytesIO(step_bytes)
        return StreamingResponse(
            bio,
            media_type="application/step",
            headers={"Content-Disposition": "attachment; filename=model.step"}
        )
    except Exception as exc:
        import traceback
        log_path = Path(__file__).resolve().parents[3] / "error.log"
        try:
            with open(log_path, "w") as f:
                traceback.print_exc(file=f)
                f.write("\n\n--- CSG TREE ---\n")
                f.write(request.csg_tree)
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )
    finally:
        gc.collect()


def _process_gcode(cam_request_dict: dict, step_file_path: str | None, temp_path_str: str | None) -> dict:
    from app.models.schemas import CAMJobRequest
    from app.services.gcode_generator import GCodeGenerator
    from app.services.csg_parser import CSGParser, export_to_step
    
    cam_request = CAMJobRequest(**cam_request_dict)
    
    if not cam_request.csg_tree and step_file_path:
        generator = GCodeGenerator(
            controller=cam_request.machine_configuration.controller,
            safe_z=cam_request.machine_configuration.safe_z,
            resolution=cam_request.machine_configuration.resolution
        )
        return generator.generate(cam_request, step_path=step_file_path)
    
    if not cam_request.csg_tree:
        raise ValueError("Either 'csg_tree' or 'step_file_path' must be provided.")
        
    shape = CSGParser.parse(cam_request.csg_tree)
    if temp_path_str:
        export_to_step(shape, temp_path_str)
        
    generator = GCodeGenerator(
        controller=cam_request.machine_configuration.controller,
        safe_z=cam_request.machine_configuration.safe_z,
        resolution=cam_request.machine_configuration.resolution
    )
    return generator.generate(cam_request, step_path=temp_path_str)


@router.post("/gcode", response_model=GCodeResponse)
async def generate_gcode(
    request: Request,
    file: UploadFile | None = File(None),
    job_request: str | None = Form(None)
) -> GCodeResponse:
    """
    Generate dialect-specific G-code from a CSG tree or STEP file.
    Supports both JSON payloads and multipart/form-data uploads.
    """
    import tempfile
    import pathlib
    
    content_type = request.headers.get("content-type", "")
    temp_path = None
    
    if "multipart/form-data" in content_type:
        if not file or not job_request:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": "Form data must include 'file' and 'job_request'."}}
            )
        try:
            job_request_data = json.loads(job_request)
            cam_request = CAMJobRequest(**job_request_data)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": f"Invalid CAMJobRequest JSON payload: {exc}"}}
            )
        
        file_bytes = await file.read()
        filename = file.filename or ""
        
        # Check if uploaded file is a STEP file or CSG tree string
        is_step = False
        if filename.endswith((".step", ".stp")):
            is_step = True
        elif file_bytes.startswith(b"ISO-10303-21") or b"HEADER;" in file_bytes[:500]:
            is_step = True
            
        if is_step:
            with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
                tf.write(file_bytes)
                temp_path = pathlib.Path(tf.name)
            cam_request.step_file_path = str(temp_path)
        else:
            try:
                cam_request.csg_tree = file_bytes.decode("utf-8")
            except Exception:
                with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
                    tf.write(file_bytes)
                    temp_path = pathlib.Path(tf.name)
                cam_request.step_file_path = str(temp_path)
    else:
        # Fallback to application/json
        try:
            body_bytes = await request.body()
            body_json = json.loads(body_bytes)
            cam_request = CAMJobRequest(**body_json)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": f"Invalid JSON body: {exc}"}}
            )

    # Print clean debug log confirming the operations pipeline order
    print("\n=========================================")
    print("      CAM OPERATIONS PIPELINE ORDER")
    print("=========================================")
    for idx, op in enumerate(cam_request.operations_pipeline):
        print(f"[{idx + 1}] Operation: {op.name}")
        print(f"    Strategy: {op.strategy.upper()}")
        print(f"    Tool Ref: T{op.tool_number}")
        print(f"    Depth:    {op.cutting_depth} mm (Stepdown: {op.stepdown} mm)")
        print(f"    Slowdown: {op.corner_slowdown}")
    print("=========================================\n")
    
    try:
        # If tempfile wasn't created by multipart handler, create one for the CSG-to-STEP compile
        if not cam_request.csg_tree and cam_request.step_file_path:
            pass # We already have the step path
        else:
            if not cam_request.csg_tree:
                raise HTTPException(
                    status_code=400,
                    detail={"error": {"message": "Either 'csg_tree' or 'step_file_path' must be provided."}}
                )
            if not temp_path:
                with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as tf:
                    temp_path = pathlib.Path(tf.name)

        result = await asyncio.to_thread(
            _process_gcode,
            cam_request.model_dump(),
            cam_request.step_file_path,
            str(temp_path) if temp_path else None
        )
        
        # Check if the result has errors
        gcode_content = result.get("gcode", "")
        if gcode_content.startswith("; ERROR:"):
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": gcode_content[8:].strip()}}
            )
            
        return GCodeResponse(
            gcode=gcode_content,
            toolpaths=result.get("toolpaths", [])
        )
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"G-code generation failed: {exc}"}}
        )
    finally:
        # Ensure cleanup of the temporary file buffer
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass
        gc.collect()


@router.get("/material-defaults")
def get_material_defaults_endpoint(material: str, diameter: float) -> dict:
    """
    Retrieve default feeds and speeds for a given material name and tool diameter.
    """
    from app.services.materials_db import get_material_defaults
    try:
        return get_material_defaults(material, diameter)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": f"Failed to retrieve material defaults: {exc}"}}
        )
