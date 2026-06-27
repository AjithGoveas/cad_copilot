from __future__ import annotations
from typing import Literal
from pydantic import BaseModel
from .generation_models import StrictModel

class StepRequest(StrictModel):
    """Payload containing compiled CSG tree to convert to STEP."""
    csg_tree: str
    demoMode: bool = False


class DxfExportRequest(BaseModel):
    csg_tree: str
    dxf_mode: Literal["silhouette", "section", "blueprint"]
    demoMode: bool = False