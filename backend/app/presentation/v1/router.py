"""CADVEX V2 - Clean Architecture Presentation Router Layer (Version v1)."""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import uuid
from typing import Any
import time
import logging

logger = logging.getLogger("app")


from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError

# Domain, Use Case, and Infrastructure layer imports
from app.domain.models import ModelMetadata, GenerateResponse, StepRequest, GCodeResponse, CAMJobRequest, DxfExportRequest
from app.domain.interfaces import ICADEngine, ICAMEngine
from app.infrastructure.httpx_gateway import UniversalHTTPXGateway
from app.infrastructure.prisma_repository import PrismaSessionRepository
from app.infrastructure.cad import ConcreteCADEngine, ConcreteCAMEngine
from app.application.use_cases import GenerateCadUseCase, EditCadUseCase, RepairCadUseCase

router = APIRouter(tags=["cad"])

# Instantiate and wire Clean Architecture components
gateway = UniversalHTTPXGateway()
repository = PrismaSessionRepository()
cad_engine: ICADEngine = ConcreteCADEngine()
cam_engine: ICAMEngine = ConcreteCAMEngine()

generate_use_case = GenerateCadUseCase(gateway, repository)
edit_use_case = EditCadUseCase(gateway, repository)
repair_use_case = RepairCadUseCase(gateway, repository)


# ---------------------------------------------------------------------------
# Presentation request body validation schemas
# ---------------------------------------------------------------------------
class EditRequestSchema(BaseModel):
    prompt: str
    current_code: str
    target_point: list[float] | None = None
    model_metadata: ModelMetadata
    fallback_metadata: ModelMetadata | None = None
    session_id: str | None = None


class RepairRequestSchema(BaseModel):
    code: str
    error: str
    model_metadata: ModelMetadata
    fallback_metadata: ModelMetadata | None = None
    session_id: str | None = None


# ---------------------------------------------------------------------------
# Shape Cache and helper routines
# ---------------------------------------------------------------------------
class ShapeCache:
    _cache: dict[str, dict[str, Any]] = {}

    @classmethod
    def get(cls, asset_id: str) -> Any:
        entry = cls._cache.get(asset_id)
        if entry:
            entry["last_accessed"] = time.time()
            return entry["shape"]
        return None

    @classmethod
    def set(cls, asset_id: str, shape: Any):
        cls.evict(asset_id)
        cls._cache[asset_id] = {
            "shape": shape,
            "last_accessed": time.time(),
        }

    @classmethod
    def evict(cls, asset_id: str):
        if asset_id in cls._cache:
            entry = cls._cache.pop(asset_id)
            shape = entry.get("shape")
            if shape:
                try:
                    if hasattr(shape, "wrapped"):
                        shape.wrapped = None
                except Exception:
                    pass
                del shape

    @classmethod
    def clear(cls):
        for asset_id in list(cls._cache.keys()):
            cls.evict(asset_id)


def is_step_reference(csg_tree: Any) -> tuple[bool, str | None]:
    if not csg_tree:
        return False, None
    if isinstance(csg_tree, dict):
        if csg_tree.get("type") == "step_reference":
            return True, csg_tree.get("asset_id")
    elif isinstance(csg_tree, str):
        trimmed = csg_tree.strip()
        if trimmed.startswith("{") and trimmed.endswith("}"):
            try:
                data = json.loads(trimmed)
                if data.get("type") == "step_reference":
                    return True, data.get("asset_id")
            except Exception:
                pass
    return False, None

def _extract_parameters(script: str) -> dict[str, Any]:
    m = re.search(r"/\*\s*PARAMETERS_JSON\s*(\{.*?\})\s*\*/", script, re.S)
    if m:
        try:
            return json.loads(m.group(1))
        except Exception:
            pass
    return {}


def _resolve_mime(content_type: str, filename: str) -> str | None:
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct == "application/pdf":
        return ct
    if ct.startswith("image/"):
        return ct
    if filename.lower().endswith(".pdf"):
        return "application/pdf"
    return None


def _sanitize_script(script: str) -> str:
    if not script:
        return script

    FN_CAP = 32

    def _cap_fn(match: re.Match) -> str:
        val = int(match.group(1))
        capped = min(val, FN_CAP)
        return match.group(0).replace(match.group(1), str(capped))

    script = re.sub(r'\$fn\s*=\s*(\d+)', _cap_fn, script)

    if "$fn" not in script:
        script = "$fn = 32;\n\n" + script

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
            script = re.sub(
                r'(\bmodule\b|\bdifference\(\))',
                r'eps = 0.02;  // CGAL crash prevention\n\n\1',
                script,
                count=1,
            )
    return script


# ---------------------------------------------------------------------------
# FastAPI Route Handlers
# ---------------------------------------------------------------------------
@router.post("/generate", response_model=GenerateResponse, summary="Generate Parametric CAD Script", description="Generates a complete, stabilized OpenSCAD script from a natural language description and an optional blueprint drawing (PDF/Image) using vision audits and multi-vendor fallbacks.")
async def generate(
    prompt: str = Form(...),
    model_metadata: str = Form(...),
    fallback_metadata: str | None = Form(None),
    image: UploadFile = File(None),
    base_code: str | None = Form(None),
    selection_context: str | None = Form(None),
    session_id: str | None = Form(None),
) -> GenerateResponse:
    try:
        model_metadata_parsed = ModelMetadata.model_validate_json(model_metadata)
        fallback_metadata_parsed = None
        if fallback_metadata:
            fallback_metadata_parsed = ModelMetadata.model_validate_json(fallback_metadata)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": f"Invalid model_metadata or fallback_metadata payload: {exc}"}}
        )

    image_bytes = None
    mime_type = None

    if image and image.filename:
        mime_type = _resolve_mime(image.content_type or "", image.filename)
        if mime_type is None:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": "File must be an image (PNG/JPEG/WEBP) or PDF."}},
            )
        image_bytes = await image.read()

    try:
        script = await generate_use_case.execute(
            prompt=prompt,
            primary_metadata=model_metadata_parsed,
            fallback_metadata=fallback_metadata_parsed,
            image_bytes=image_bytes,
            mime_type=mime_type,
            base_code=base_code,
            selection_context=selection_context,
            session_id=session_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc), "hint": "Check API keys and quotas."}},
        )

    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


@router.post("/edit", response_model=GenerateResponse, summary="Surgically Edit Active CAD Code", description="Applies surgical coordinate-injected changes to existing OpenSCAD code variables and geometries in-place based on chat prompts and target coordinates.")
async def edit(request: EditRequestSchema) -> GenerateResponse:
    try:
        script = await edit_use_case.execute(
            prompt=request.prompt,
            current_code=request.current_code,
            primary_metadata=request.model_metadata,
            fallback_metadata=request.fallback_metadata,
            target_point=request.target_point,
            session_id=request.session_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc), "hint": "Check API keys and quotas."}},
        )

    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


@router.post("/repair", response_model=GenerateResponse, summary="Auto-Heal Syntax/Compile Errors", description="Executes a self-healing recovery pass on a failing OpenSCAD script using compiler traceback error logs.")
async def repair(request: RepairRequestSchema) -> GenerateResponse:
    try:
        script = await repair_use_case.execute(
            code=request.code,
            error_message=request.error,
            primary_metadata=request.model_metadata,
            fallback_metadata=request.fallback_metadata,
            session_id=request.session_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": str(exc)}},
        )

    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


# ---------------------------------------------------------------------------
# Backward Compatibility Utility Routes
# ---------------------------------------------------------------------------
def _process_export_step(csg_tree: str) -> bytes:
    is_ref, asset_id = is_step_reference(csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
    else:
        shape = cad_engine.parse_csg(csg_tree)
    return cad_engine.shape_to_step_bytes(shape)


@router.post("/export-step", summary="Export CAD CSG to STEP bytes", description="Pipes compiled shape geometries directly into raw STEP file binary streams.")
async def export_step_stream(request: StepRequest) -> StreamingResponse:
    try:
        step_bytes = await asyncio.to_thread(_process_export_step, request.csg_tree)
        bio = io.BytesIO(step_bytes)
        return StreamingResponse(
            bio,
            media_type="application/step",
            headers={"Content-Disposition": "attachment; filename=model.step"}
        )
    except HTTPException:
        raise
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[export-step] Exception occurred: {exc}")
        logger.error(f"[export-step] CSG tree payload:\n{request.csg_tree}")
        raise HTTPException(status_code=500, detail=f"STEP export failed: {exc}")


def _process_gcode(cam_request_dict: dict, step_file_path: str | None, temp_path_str: str | None) -> dict:
    cam_request = CAMJobRequest(**cam_request_dict)

    is_ref, asset_id = is_step_reference(cam_request.csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
        shape = cad_engine._ensure_brep_shape(shape)
        return cam_engine.generate_gcode(cam_request, step_path=shape)

    if not cam_request.csg_tree and step_file_path:
        shape = ShapeCache.get(step_file_path)
        if shape is not None:
            return cam_engine.generate_gcode(cam_request, step_path=shape)

        return cam_engine.generate_gcode(cam_request, step_path=step_file_path)

    if not cam_request.csg_tree:
        raise ValueError("Either 'csg_tree' or 'step_file_path' must be provided.")

    shape = cad_engine.parse_csg(cam_request.csg_tree)
    if temp_path_str:
        cad_engine.export_step(shape, temp_path_str)

    return cam_engine.generate_gcode(cam_request, step_path=temp_path_str)


@router.post("/gcode", response_model=GCodeResponse, summary="Generate CAM G-code Pathways", description="Performs 3D feature recognition (holes, slots, profiles) on raw shapes to construct optimized tool paths and output industrial G-code blocks.")
async def generate_gcode(
    request: Request,
    file: UploadFile | None = File(None),
    job_request: str | None = Form(None)
) -> GCodeResponse:
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
        try:
            body_bytes = await request.body()
            body_json = json.loads(body_bytes)
            cam_request = CAMJobRequest(**body_json)
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail={"error": {"message": f"Invalid JSON body: {exc}"}}
            )
    try:
        if not cam_request.csg_tree and cam_request.step_file_path:
            pass
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
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"G-code generation failed: {exc}"}}
        )
    finally:
        if temp_path and temp_path.exists():
            try:
                temp_path.unlink()
            except Exception:
                pass


@router.get("/material-defaults", summary="Get Speeds & Feeds Defaults", description="Queries spindle speed, feed rate, plunge rate, and stepdown default limits for Delrin, Plywood, Acrylic, Steel, and Aluminum.")
def get_material_defaults_endpoint(material: str, diameter: float) -> dict:
    try:
        return cam_engine.get_material_defaults(material, diameter)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": f"Failed to retrieve material defaults: {exc}"}}
        )


@router.post("/import/step", summary="Import and Settle STEP Assets", description="Uploads raw STEP geometries, generates STL binary blocks for browser rendering, and caches shape objects in session memory.")
async def import_step_endpoint(file: UploadFile = File(...)) -> StreamingResponse:
    if not file.filename.lower().endswith((".step", ".stp")):
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": "Invalid file format. Only .step or .stp files are accepted."}}
        )

    try:
        file_bytes = await file.read()
        stl_bytes, shape = await asyncio.to_thread(cad_engine.import_step_to_stl, file_bytes)
        asset_id = str(uuid.uuid4())
        ShapeCache.set(asset_id, shape)
        return StreamingResponse(
            io.BytesIO(stl_bytes),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=imported_{file.filename}.stl",
                "x-asset-id": asset_id
            }
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"STEP Import failed: {str(exc)}"}}
        )


@router.post("/import/stl", summary="Import and Settle STL Assets", description="Uploads raw STL geometries, registers them, and caches shape objects in session memory.")
async def import_stl_endpoint(file: UploadFile = File(...)) -> StreamingResponse:
    if not file.filename.lower().endswith(".stl"):
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": "Invalid file format. Only .stl files are accepted."}}
        )

    try:
        file_bytes = await file.read()
        stl_bytes, shape = await asyncio.to_thread(cad_engine.import_stl_to_stl, file_bytes)
        asset_id = str(uuid.uuid4())
        ShapeCache.set(asset_id, shape)
        return StreamingResponse(
            io.BytesIO(stl_bytes),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename=imported_{file.filename}",
                "x-asset-id": asset_id
            }
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail={"error": {"message": f"STL Import failed: {str(exc)}"}}
        )


@router.post("/import/teardown/{asset_id}", summary="Evict STEP Cache", description="Evicts and cleans up registered shape references from workspace memory.")
async def import_teardown_endpoint(asset_id: str):
    ShapeCache.evict(asset_id)
    return {"status": "evicted"}


def _process_export_dxf(csg_tree: str, dxf_mode: str) -> bytes:
    is_ref, asset_id = is_step_reference(csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
    else:
        shape = cad_engine.parse_csg(csg_tree)
    return cad_engine.shape_to_dxf_bytes(shape, dxf_mode)


def _process_export_stl(csg_tree: str) -> bytes:
    is_ref, asset_id = is_step_reference(csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
    else:
        shape = cad_engine.parse_csg(csg_tree)
    return cad_engine.shape_to_stl_bytes(shape)


@router.post("/export-stl", summary="Export Cached Shape to STL", description="Retrieves registered shape assets from cache and generates raw STL files.")
async def export_stl_endpoint(request: StepRequest) -> StreamingResponse:
    try:
        stl_bytes = await asyncio.to_thread(_process_export_stl, request.csg_tree)
        return StreamingResponse(
            io.BytesIO(stl_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=model.stl"}
        )
    except HTTPException:
        raise
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[export-stl] Exception occurred: {exc}")
        logger.error(f"[export-stl] CSG tree payload:\n{request.csg_tree}")
        raise HTTPException(status_code=500, detail=f"STL export failed: {exc}")


@router.post("/export-dxf", summary="Export Cached Shape to DXF", description="Projects registered shape assets to 2D sections or blueprints, exporting DXF files.")
async def export_dxf_endpoint(request: DxfExportRequest) -> StreamingResponse:
    try:
        dxf_bytes = await asyncio.to_thread(_process_export_dxf, request.csg_tree, request.dxf_mode)
        return StreamingResponse(
            io.BytesIO(dxf_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=model.dxf"}
        )
    except HTTPException:
        raise
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception(f"[export-dxf] Exception occurred: {exc}")
        logger.error(f"[export-dxf] CSG tree payload:\n{request.csg_tree}")
        raise HTTPException(status_code=500, detail=f"DXF export failed: {exc}")