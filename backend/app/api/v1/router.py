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
from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from app.models.schemas import GenerateResponse, EditRequest, StepRequest, GCodeResponse, CAMJobRequest
from app.services.csg_parser import CSGParser, export_to_step
from app.services.llm_codegen import LLMCodegenService
import time

router = APIRouter(tags=["cad"])

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


def export_to_stl_bytes(shape) -> bytes:
    import tempfile
    from pathlib import Path
    from build123d import export_stl
    
    bb = shape.bounding_box()
    max_dim = max(
        bb.max.X - bb.min.X,
        bb.max.Y - bb.min.Y,
        bb.max.Z - bb.min.Z
    )
    tolerance = max(0.001, min(0.5, max_dim * 0.002))
    
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tf:
            temp_path = Path(tf.name)
            
        export_stl(shape, str(temp_path), tolerance=tolerance, angular_tolerance=0.15)
        
        with open(temp_path, "rb") as f:
            return f.read()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


def export_to_dxf_bytes(shape, dxf_mode: str) -> bytes:
    import tempfile
    from pathlib import Path
    from build123d import Plane, BuildSketch, project, ExportDXF, Location, Rotation, Compound, Mode, Face
    
    dxf_shape = None
    if dxf_mode == "silhouette":
        with BuildSketch(Plane.XY):
            dxf_shape = project(shape.edges(), mode=Mode.PRIVATE)
    elif dxf_mode == "section":
        section_plane = Plane.XY.offset(0.01)
        section_profile = shape.intersect(Face.make_rect(10000, 10000, section_plane))
        with BuildSketch(Plane.XY):
            dxf_shape = project(section_profile.edges(), mode=Mode.PRIVATE)
    elif dxf_mode == "blueprint":
        offset_dist = 120.0
        with BuildSketch(Plane.XY):
            top_view = project(shape.edges(), mode=Mode.PRIVATE)
            iso_shape = Location((offset_dist, 0, 0)) * Rotation(0, 0, 45) * Rotation(54.7356, 0, 0) * shape
            iso_view = project(iso_shape.edges(), mode=Mode.PRIVATE)
            front_shape = Location((0, -offset_dist, 0)) * Rotation(90, 0, 0) * shape
            front_view = project(front_shape.edges(), mode=Mode.PRIVATE)
            right_shape = Location((offset_dist, -offset_dist, 0)) * Rotation(0, 0, 90) * Rotation(90, 0, 0) * shape
            right_view = project(right_shape.edges(), mode=Mode.PRIVATE)
            dxf_shape = Compound([top_view, iso_view, front_view, right_view])
    else:
        with BuildSketch(Plane.XY):
            dxf_shape = project(shape.edges(), mode=Mode.PRIVATE)

    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False) as tf:
            temp_path = Path(tf.name)
        
        exporter = ExportDXF()
        exporter.add_shape(dxf_shape)
        exporter.write(str(temp_path))
        
        with open(temp_path, "rb") as f:
            return f.read()
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink(missing_ok=True)


_ALLOWED_MIME_PREFIXES = ("image/",)
_ALLOWED_MIME_EXACT   = {"application/pdf"}
_DEFAULT_MODEL = os.getenv("GENAI_MODEL", "gemini-3.1-flash-lite")


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
    if ct in _ALLOWED_MIME_EXACT:
        return ct
    if any(ct.startswith(p) for p in _ALLOWED_MIME_PREFIXES):
        return ct
    if filename.lower().endswith(".pdf"):
        return "application/pdf"
    return None


def _sanitize_script(script: str) -> str:
    if not script:
        return script

    script = re.sub(r'include\s*<BOSL2/.*?>;?', '', script, flags=re.I)

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

@router.post("/generate", response_model=GenerateResponse)
async def generate(
    prompt: str = Form(...),
    model_name: str = Form(_DEFAULT_MODEL, alias="model"),
    image: UploadFile = File(None),
    base_code: str | None = Form(None),
    selection_context: str | None = Form(None),
) -> GenerateResponse:
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
        svc = LLMCodegenService(model=model_name)
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail={"error": {"message": str(exc)}})

    feature_map = {}
    if image_bytes and mime_type and image:
        try:
            feature_map = await asyncio.to_thread(
                svc.audit_blueprint, image_bytes, mime_type, image.filename
            )
        except Exception:
            pass

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

    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


@router.post("/edit", response_model=GenerateResponse)
async def edit(request: EditRequest) -> GenerateResponse:
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

    script = _sanitize_script(script)

    return GenerateResponse(
        openscad_script=script,
        parameters=_extract_parameters(script),
    )


def _process_export_step(csg_tree: str) -> bytes:
    from app.services.csg_parser import CSGParser
    from app.services.export_utils import build123d_to_step_bytes
    
    is_ref, asset_id = is_step_reference(csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
    else:
        shape = CSGParser.parse(csg_tree)
        
    return build123d_to_step_bytes(shape)

@router.post("/export-step")
async def export_step_stream(request: StepRequest) -> StreamingResponse:
    try:
        step_bytes = await asyncio.to_thread(_process_export_step, request.csg_tree)
        bio = io.BytesIO(step_bytes)
        return StreamingResponse(
            bio,
            media_type="application/step",
            headers={"Content-Disposition": "attachment; filename=model.step"}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )


def _process_gcode(cam_request_dict: dict, step_file_path: str | None, temp_path_str: str | None) -> dict:
    from app.models.schemas import CAMJobRequest
    from app.services.gcode_generator import GCodeGenerator
    from app.services.csg_parser import CSGParser, export_to_step

    cam_request = CAMJobRequest(**cam_request_dict)

    is_ref, asset_id = is_step_reference(cam_request.csg_tree)
    if is_ref and asset_id:
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise ValueError(f"STEP asset ID {asset_id} not found in cache or has expired.")
        generator = GCodeGenerator(
            controller=cam_request.machine_configuration.controller,
            safe_z=cam_request.machine_configuration.safe_z,
            resolution=cam_request.machine_configuration.resolution
        )
        return generator.generate(cam_request, step_path=shape)

    if not cam_request.csg_tree and step_file_path:
        shape = ShapeCache.get(step_file_path)
        if shape is not None:
            generator = GCodeGenerator(
                controller=cam_request.machine_configuration.controller,
                safe_z=cam_request.machine_configuration.safe_z,
                resolution=cam_request.machine_configuration.resolution
            )
            return generator.generate(cam_request, step_path=shape)

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


@router.post("/gcode", response_model=GCodeResponse)
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


@router.get("/material-defaults")
def get_material_defaults_endpoint(material: str, diameter: float) -> dict:
    from app.services.materials_db import get_material_defaults
    try:
        return get_material_defaults(material, diameter)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": f"Failed to retrieve material defaults: {exc}"}}
        )


def _process_import_step(file_bytes: bytes) -> tuple[bytes, Any]:
    import tempfile
    from pathlib import Path
    from build123d import import_step, export_stl

    with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as temp_step:
        temp_step.write(file_bytes)
        temp_step_path = Path(temp_step.name)

    temp_stl_path = temp_step_path.with_suffix(".stl")

    try:
        imported_shape = import_step(str(temp_step_path))

        bb = imported_shape.bounding_box()
        max_dim = max(
            bb.max.X - bb.min.X,
            bb.max.Y - bb.min.Y,
            bb.max.Z - bb.min.Z
        )
        tolerance = max(0.001, min(0.5, max_dim * 0.002))

        export_stl(imported_shape, str(temp_stl_path), tolerance=tolerance, angular_tolerance=0.15)

        with open(temp_stl_path, "rb") as f:
            stl_bytes = f.read()

        return stl_bytes, imported_shape
    finally:
        for path in (temp_step_path, temp_stl_path):
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass


@router.post("/import/step")
async def import_step_endpoint(file: UploadFile = File(...)) -> StreamingResponse:
    if not file.filename.lower().endswith((".step", ".stp")):
        raise HTTPException(
            status_code=400,
            detail={"error": {"message": "Invalid file format. Only .step or .stp files are accepted."}}
        )

    try:
        file_bytes = await file.read()
        stl_bytes, shape = await asyncio.to_thread(_process_import_step, file_bytes)
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


@router.post("/import/teardown/{asset_id}")
async def import_teardown_endpoint(asset_id: str):
    ShapeCache.evict(asset_id)
    return {"status": "evicted"}


@router.post("/export-stl")
async def export_stl_endpoint(request: StepRequest) -> StreamingResponse:
    try:
        is_ref, asset_id = is_step_reference(request.csg_tree)
        if not is_ref or not asset_id:
            raise HTTPException(status_code=400, detail="Invalid step reference for STL export.")
            
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise HTTPException(status_code=404, detail="STEP asset ID not found in cache.")

        stl_bytes = await asyncio.to_thread(export_to_stl_bytes, shape)
        return StreamingResponse(
            io.BytesIO(stl_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=model.stl"}
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"STL export failed: {exc}")


class DxfExportRequest(BaseModel):
    csg_tree: str
    dxf_mode: str

@router.post("/export-dxf")
async def export_dxf_endpoint(request: DxfExportRequest) -> StreamingResponse:
    try:
        is_ref, asset_id = is_step_reference(request.csg_tree)
        if not is_ref or not asset_id:
            raise HTTPException(status_code=400, detail="Invalid step reference for DXF export.")
            
        shape = ShapeCache.get(asset_id)
        if shape is None:
            raise HTTPException(status_code=404, detail="STEP asset ID not found in cache.")

        dxf_bytes = await asyncio.to_thread(export_to_dxf_bytes, shape, request.dxf_mode)
        return StreamingResponse(
            io.BytesIO(dxf_bytes),
            media_type="application/octet-stream",
            headers={"Content-Disposition": "attachment; filename=model.dxf"}
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"DXF export failed: {exc}")