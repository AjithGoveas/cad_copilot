import tempfile
from pathlib import Path
from typing import Any

from build123d import Plane, BuildSketch, project, ExportDXF, Location, Rotation, Compound, Mode, Face, export_stl

from app.domain.interfaces.cad_interfaces import ICADEngine
from app.infrastructure.cad.csg_parser import CSGParser, export_to_step
from app.infrastructure.cad.export_utils import build123d_to_step_bytes

class ConcreteCADEngine(ICADEngine):
    """Concrete CAD engine leveraging build123d for shape parsing, manipulation, and format export."""

    def parse_csg(self, csg_string: str) -> Any:
        return CSGParser.parse(csg_string)

    def export_step(self, shape: Any, filename: str) -> None:
        export_to_step(shape, filename)

    def shape_to_step_bytes(self, shape: Any) -> bytes:
        return build123d_to_step_bytes(shape)

    def shape_to_stl_bytes(self, shape: Any) -> bytes:
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

    def shape_to_dxf_bytes(self, shape: Any, dxf_mode: str) -> bytes:
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

    def import_step_to_stl(self, step_bytes: bytes) -> tuple[bytes, Any]:
        from build123d import import_step
        
        with tempfile.NamedTemporaryFile(suffix=".step", delete=False) as temp_step:
            temp_step.write(step_bytes)
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

