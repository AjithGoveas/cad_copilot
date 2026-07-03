from abc import ABC, abstractmethod
from typing import Any, Dict

class ICADEngine(ABC):
    """Agnostic interface for CAD parsing, reconstruction, and exports."""
    
    @abstractmethod
    def parse_csg(self, csg_string: str) -> Any:
        """Parses OpenSCAD CSG code to a build123d Shape/Compound."""
        pass

    @abstractmethod
    def export_step(self, shape: Any, filename: str) -> None:
        """Exports a shape to a STEP file."""
        pass

    @abstractmethod
    def shape_to_step_bytes(self, shape: Any) -> bytes:
        """Converts a shape to raw STEP bytes."""
        pass

    @abstractmethod
    def shape_to_stl_bytes(self, shape: Any) -> bytes:
        """Converts a shape to raw STL bytes."""
        pass

    @abstractmethod
    def shape_to_dxf_bytes(self, shape: Any, dxf_mode: str) -> bytes:
        """Converts a shape to raw DXF bytes based on projection mode."""
        pass

    @abstractmethod
    def import_step_to_stl(self, step_bytes: bytes) -> tuple[bytes, Any]:
        """Converts raw STEP file bytes to STL bytes and returns the imported shape."""
        pass

    @abstractmethod
    def import_stl_to_stl(self, stl_bytes: bytes) -> tuple[bytes, Any]:
        """Imports raw STL file bytes and returns the imported shape/mesh."""
        pass

    @abstractmethod
    def ensure_brep_shape(self, shape: Any) -> Any:
        """Converts a triangulated mesh shape to a B-Rep shape if needed."""
        pass


class ICAMEngine(ABC):
    """Agnostic interface for Computer-Aided Manufacturing (CAM) operations."""

    @abstractmethod
    def generate_gcode(self, cam_job: Any, step_path: Any) -> Dict[str, Any]:
        """Generates G-code from a STEP file or shape object."""
        pass

    @abstractmethod
    def get_material_defaults(self, material_name: str, tool_diameter: float) -> Dict[str, Any]:
        """Queries database defaults for speeds and feeds of a tool in a material."""
        pass
