"""Pydantic schemas for the CADVEX API."""
from __future__ import annotations
from typing import Any, Literal
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
    model: str = "gemini-2.5-flash-lite"




class StepRequest(StrictModel):
    """Payload containing compiled CSG tree to convert to STEP."""
    csg_tree: str


class StockConfiguration(StrictModel):
    stock_type: Literal["block", "cylinder"]
    length_x: float | None = None
    width_y: float | None = None
    height_z: float | None = None
    outer_diameter: float | None = None
    inner_diameter: float | None = 0.0
    length_z: float | None = None


class MachineConfigModel(StrictModel):
    controller: str = Field(default="fanuc", description="CNC Controller dialect")
    safe_z: float = Field(default=5.0, ge=0.0, description="Safe clearance height Z in mm")
    coolant_active: bool = Field(default=True, description="Enable flood coolant M8/M9 commands")
    resolution: float = Field(default=0.5, gt=0.0, description="Path interpolation resolution")


# Backwards compatibility alias
class MachineConfiguration(MachineConfigModel):
    pass


class ToolModel(StrictModel):
    number: int = Field(..., ge=1, description="Tool identification number")
    type: Literal["endmill", "ballnose", "drill", "face", "turning_rough", "turning_finish"] = Field(
        default="endmill", description="Tool type (endmill, ballnose, drill, face, turning_rough, turning_finish)"
    )
    diameter: float = Field(..., gt=0.0, description="Tool bit diameter in mm")
    spindle_speed: float = Field(..., gt=0.0, description="Spindle speed in RPM")
    feed_rate: float = Field(..., gt=0.0, description="Cutting feed rate in mm/min")
    plunge_rate: float = Field(..., gt=0.0, description="Plunge feed rate in mm/min")
    description: str = Field(default="Endmill", description="Tool description")
    flute_length: float | None = Field(default=25.0, description="Length of tool cutting flutes in mm")


class OperationModel(StrictModel):
    name: str = Field(..., description="Operation name")
    strategy: Literal["face", "spot", "drill", "pocket", "profile", "surface", "turn_rough", "turn_finish"] = Field(
        ..., description="Machining strategy (face, spot, drill, pocket, profile, surface, turn_rough, turn_finish)"
    )
    tool_number: int = Field(..., ge=1, description="Target tool number from tool library")
    cutting_depth: float = Field(..., gt=0.0, description="Total target depth of cut in mm")
    stepdown: float = Field(..., gt=0.0, description="Maximum depth per cutting pass in mm")
    units: Literal["metric", "imperial"] = Field(default="metric", description="Metric or imperial units")
    corner_slowdown: float = Field(default=0.5, ge=0.1, le=1.0, description="Feed slowdown factor at corners")
    corner_slowdown_factor: float | None = Field(default=None, description="Deprecated. Use corner_slowdown instead.")

    @model_validator(mode="before")
    @classmethod
    def populate_corner_slowdown(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "corner_slowdown_factor" in data and "corner_slowdown" not in data:
                data["corner_slowdown"] = data["corner_slowdown_factor"]
            elif "corner_slowdown" in data and "corner_slowdown_factor" not in data:
                data["corner_slowdown_factor"] = data["corner_slowdown"]
        return data


class CAMJobRequest(StrictModel):
    """CAM Job Request payload containing compiled CSG or STEP path and CAM configuration."""
    csg_tree: str | None = Field(default=None, description="Optional compiled CSG tree string")
    step_file_path: str | None = Field(default=None, description="Optional path to STEP file")
    machine_configuration: MachineConfigModel = Field(default_factory=MachineConfigModel)
    stock_configuration: StockConfiguration | None = Field(default=None, description="Optional raw stock configuration")
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
