from __future__ import annotations
from pydantic import BaseModel
from .generation_models import StrictModel

class StepRequest(StrictModel):
    """Payload containing compiled CSG tree to convert to STEP."""
    csg_tree: str

class DxfExportRequest(BaseModel):
    csg_tree: str
    dxf_mode: str
