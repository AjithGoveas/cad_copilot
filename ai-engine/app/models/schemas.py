"""Pydantic schemas for the CAD Copilot API."""
from __future__ import annotations
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateResponse(StrictModel):
    """Payload returned after a successful two-stage generation run."""
    openscad_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)
