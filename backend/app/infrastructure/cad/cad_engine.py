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
        shape = self._ensure_brep_shape(shape)
        return build123d_to_step_bytes(shape)

    def shape_to_stl_bytes(self, shape: Any) -> bytes:
        shape = self._ensure_brep_shape(shape)
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
        shape = self._ensure_brep_shape(shape)
        dxf_shape = None
        if dxf_mode == "silhouette":
            with BuildSketch(Plane.XY):
                dxf_shape = project(shape.edges(), mode=Mode.PRIVATE)
        elif dxf_mode == "section":
            bb = shape.bounding_box()
            z_center = (bb.min.Z + bb.max.Z) / 2.0
            if abs(z_center) < 1e-5:
                z_center = 0.01
            section_plane = Plane.XY.offset(z_center)
            section_profile = shape.intersect(Face.make_rect(10000, 10000, section_plane))
            with BuildSketch(Plane.XY):
                dxf_shape = project(section_profile.edges(), mode=Mode.PRIVATE)
        elif dxf_mode == "blueprint":
            bb = shape.bounding_box()
            max_dim = max(
                bb.max.X - bb.min.X,
                bb.max.Y - bb.min.Y,
                bb.max.Z - bb.min.Z
            )
            offset_dist = max(120.0, max_dim * 2.5)
            
            with BuildSketch(Plane.XY):
                top_view = project(shape.edges(), mode=Mode.PRIVATE)
                
                iso_rotated = Rotation(0, 0, 45) * Rotation(54.7356, 0, 0) * shape
                iso_view = Location((offset_dist, 0, 0)) * project(iso_rotated.edges(), mode=Mode.PRIVATE)
                
                front_rotated = Rotation(90, 0, 0) * shape
                front_view = Location((0, -offset_dist, 0)) * project(front_rotated.edges(), mode=Mode.PRIVATE)
                
                right_rotated = Rotation(0, 0, 90) * Rotation(90, 0, 0) * shape
                right_view = Location((offset_dist, -offset_dist, 0)) * project(right_rotated.edges(), mode=Mode.PRIVATE)
                
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

    def import_stl_to_stl(self, stl_bytes: bytes) -> tuple[bytes, Any]:
        from build123d import import_stl
        
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as temp_stl:
            temp_stl.write(stl_bytes)
            temp_stl_path = Path(temp_stl.name)

        try:
            imported_shape = import_stl(str(temp_stl_path))
            imported_shape = self._ensure_brep_shape(imported_shape)
            return stl_bytes, imported_shape
        finally:
            try:
                if temp_stl_path.exists():
                    temp_stl_path.unlink()
            except Exception:
                pass

    def _ensure_brep_shape(self, shape: Any) -> Any:
        from build123d import Compound
        
        # If shape is a list or ShapeList, wrap it in a Compound first
        if isinstance(shape, list) or (hasattr(shape, "__class__") and shape.__class__.__name__ == "ShapeList"):
            shape = Compound(shape)

        from OCP.BRep import BRep_Tool
        from OCP.TopLoc import TopLoc_Location
        from OCP.gp import gp_Pnt
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
        from OCP.TopoDS import TopoDS_Compound
        from OCP.BRep import BRep_Builder
        
        # Extract all faces
        faces = shape.faces() if hasattr(shape, "faces") else [shape]
        
        # Check if the shape contains any triangulated faces (e.g. STL imported mesh)
        is_triangulated = False
        loc = TopLoc_Location()
        for f in faces:
            if hasattr(f, "wrapped") and BRep_Tool.Triangulation_s(f.wrapped, loc) is not None:
                is_triangulated = True
                break
                
        if is_triangulated:
            builder = BRep_Builder()
            comp = TopoDS_Compound()
            builder.MakeCompound(comp)
            
            for f in faces:
                if not hasattr(f, "wrapped"):
                    continue
                triangulation = BRep_Tool.Triangulation_s(f.wrapped, loc)
                if triangulation is not None:
                    nodes = [triangulation.Node(i) for i in range(1, triangulation.NbNodes() + 1)]
                    points = [gp_Pnt(n.X(), n.Y(), n.Z()) for n in nodes]
                    
                    for i in range(1, triangulation.NbTriangles() + 1):
                        tri = triangulation.Triangle(i)
                        n1, n2, n3 = tri.Get()
                        poly = BRepBuilderAPI_MakePolygon(points[n1-1], points[n2-1], points[n3-1], True)
                        builder.Add(comp, BRepBuilderAPI_MakeFace(poly.Wire()).Face())
            
            return Compound(comp)
            
        return shape

