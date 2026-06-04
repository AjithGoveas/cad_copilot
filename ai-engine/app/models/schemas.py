"""Pydantic schemas for the CAD Copilot API."""
from __future__ import annotations
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GenerateResponse(StrictModel):
    """Payload returned after a successful two-stage generation run."""
    openscad_script: str
    parameters: dict[str, Any] = Field(default_factory=dict)


class EditRequest(StrictModel):
    """Payload sent to request surgical editing of existing code."""
    prompt: str
    current_code: str
    target_point: list[float] | None = None
    model: str = "gemini-3.1-flash-lite"


class StepRequest(StrictModel):
    """Payload containing compiled CSG tree to convert to STEP."""
    csg_tree: str


class MachineConfiguration(StrictModel):
    controller: str = Field(default="fanuc", description="CNC Controller dialect")
    safe_z: float = Field(default=5.0, ge=0.0, description="Safe clearance height Z in mm")
    coolant_active: bool = Field(default=True, description="Enable flood coolant M8/M9 commands")
    resolution: float = Field(default=0.5, gt=0.0, description="Path interpolation resolution")


class ToolModel(StrictModel):
    number: int = Field(..., ge=1, description="Tool identification number")
    diameter: float = Field(..., gt=0.0, description="Tool bit diameter in mm")
    spindle_speed: float = Field(..., gt=0.0, description="Spindle speed in RPM")
    feed_rate: float = Field(..., gt=0.0, description="Cutting feed rate in mm/min")
    plunge_rate: float = Field(..., gt=0.0, description="Plunge feed rate in mm/min")
    description: str | None = Field(default="Endmill", description="Optional tool description")


class OperationModel(StrictModel):
    name: str = Field(..., description="Operation name")
    strategy: str = Field(..., description="Machining strategy (profile, pocket, engrave)")
    tool_number: int = Field(..., ge=1, description="Target tool number from tool library")
    cutting_depth: float = Field(..., gt=0.0, description="Total target depth of cut in mm")
    stepdown: float = Field(..., gt=0.0, description="Maximum depth per cutting pass in mm")
    units: str = Field(default="metric", description="Metric or imperial units")
    corner_slowdown_factor: float = Field(default=0.5, ge=0.1, le=1.0, description="Feed slowdown factor at corners")


class CAMJobRequest(StrictModel):
    """CAM Job Request payload containing compiled CSG or STEP path and CAM configuration."""
    csg_tree: str | None = Field(default=None, description="Optional compiled CSG tree string")
    step_file_path: str | None = Field(default=None, description="Optional path to STEP file")
    machine_configuration: MachineConfiguration = Field(default_factory=MachineConfiguration)
    tool_library: list[ToolModel] = Field(..., description="List of available tools")
    operations_pipeline: list[OperationModel] = Field(..., description="List of machining operations")

    @model_validator(mode="after")
    def validate_tool_references(self) -> CAMJobRequest:
        tool_numbers = {t.number for t in self.tool_library}
        for op in self.operations_pipeline:
            if op.tool_number not in tool_numbers:
                raise ValueError(
                    f"Operation '{op.name}' references tool number {op.tool_number} "
                    f"which does not exist in the Tool Library (available: {sorted(list(tool_numbers))})."
                )
        return self


# Backwards compatibility layer
class ToolSchema(ToolModel):
    pass

class OperationSchema(OperationModel):
    pass

class GCodeRequest(CAMJobRequest):
    pass

class GCodeResponse(StrictModel):
    """Payload containing generated G-code program and 3D toolpath lines."""
    gcode: str
    toolpaths: list[list[tuple[float, float, float]]]
