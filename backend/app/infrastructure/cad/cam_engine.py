from typing import Any, Dict
from app.domain.interfaces.cad_interfaces import ICAMEngine
from app.infrastructure.cad.gcode_generator import GCodeGenerator
from app.infrastructure.cad.materials_db import get_material_defaults

class ConcreteCAMEngine(ICAMEngine):
    """Concrete CAM engine implementing G-code generation and fuzzy feeds/speeds lookup."""

    def generate_gcode(self, cam_job: Any, step_path: Any) -> Dict[str, Any]:
        generator = GCodeGenerator(
            controller=cam_job.machine_configuration.controller,
            safe_z=cam_job.machine_configuration.safe_z,
            resolution=cam_job.machine_configuration.resolution
        )
        return generator.generate(cam_job, step_path=step_path)

    def get_material_defaults(self, material_name: str, tool_diameter: float) -> Dict[str, Any]:
        return get_material_defaults(material_name, tool_diameter)
