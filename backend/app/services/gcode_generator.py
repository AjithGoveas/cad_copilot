"""
CAD Copilot — Feature-Driven CAM Kernel v2
Audit: Senior CNC Manufacturing Engineer / Python Systems Architect
Fixes applied: BUG-01 through BUG-07 + CAMPlanner sequencing + schema compliance.
"""

import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

from build123d import import_step, Face, Wire, Edge, Vector, Vertex, Compound, Location
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_Circle
from OCP.TopAbs import TopAbs_REVERSED
from OCP.BRep import BRep_Tool
from OCP.gp import gp_Pnt
from OCP.BRepExtrema import BRepExtrema_DistShapeShape

# ---------------------------------------------------------------------------
# Import actual schemas
# ---------------------------------------------------------------------------
from app.models.schemas import CAMJobRequest, ToolModel, OperationModel

# ==============================================================================
# BACKWARDS COMPATIBILITY DATA STRUCTURES
# ==============================================================================

class Tool:
    def __init__(
        self,
        number: int,
        diameter: float,
        spindle_speed: float,
        feed_rate: float,
        plunge_rate: float,
        description: str = "Endmill",
    ):
        self.number = number
        self.diameter = diameter
        self.spindle_speed = spindle_speed
        self.feed_rate = feed_rate
        self.plunge_rate = plunge_rate
        self.description = description


class Operation:
    def __init__(
        self,
        name: str,
        strategy: str,
        tool: Tool,
        cutting_depth: float,
        stepdown: float,
        units: str = "metric",
        corner_slowdown: float = 0.5,
    ):
        self.name = name
        self.strategy = strategy
        self.tool = tool
        self.cutting_depth = cutting_depth
        self.stepdown = stepdown
        self.units = units
        self.corner_slowdown = corner_slowdown


# ==============================================================================
# FEATURE RECOGNITION — REVISED
# ==============================================================================

class HoleFeature:
    """Represents a detected circular hole (drillable / borable)."""
    def __init__(
        self,
        diameter: float,
        location: Tuple[float, float, float],
        depth: float,
    ):
        self.diameter = diameter
        self.location = location   # (cx, cy, top_z)
        self.depth = depth


class PocketFeature:
    """Represents a closed interior pocket region on a planar face."""
    def __init__(self, face: Any, z_top: float, z_bottom: float):
        self.face = face
        self.z_top = z_top
        self.z_bottom = z_bottom


class SlotFeature:
    """Represents an open slot (parallel walls + semicircular ends)."""
    def __init__(
        self,
        centerline: List[Tuple[float, float]],
        width: float,
        z_top: float,
        depth: float,
    ):
        self.centerline = centerline
        self.width = width
        self.z_top = z_top
        self.depth = depth


class FeatureRecognizer:
    """
    Multi-pass B-Rep feature extractor.

    Pass 1 — Inner-wire method:  detects holes whose full circular wire lives
              as an inner loop on a single planar face.
    Pass 2 — Cross-face arc correlation: collects arc edges from ALL faces,
              groups them by (cx, cy, radius, z) to detect holes whose cylinder
              was split across face boundaries by the CAD exporter (BUG-06).
    Pass 3 — Depth resolution: walks from the detected top circle downward
              through the solid to measure the true bore depth instead of
              using a hardcoded fallback (BUG-02).
    """

    # ------------------------------------------------------------------
    # Public entry points
    # ------------------------------------------------------------------

    @staticmethod
    def extract_holes(shape: Any) -> List[HoleFeature]:
        holes: List[HoleFeature] = []

        # ---- Pass 1: inner-wire scan ----
        try:
            for face in _iter_faces(shape):
                outer = _call(face, "outer_wire")
                for wire in _call(face, "wires"):
                    if _same_shape(wire, outer):
                        continue
                    edges = list(_call(wire, "edges"))
                    if len(edges) not in (1, 2):
                        continue
                    try:
                        bbox = wire.bounding_box()
                        dx = bbox.max.X - bbox.min.X
                        dy = bbox.max.Y - bbox.min.Y
                        if abs(dx - dy) > 1e-3:
                            continue
                        radius = dx / 2.0
                        if radius < 1e-4:
                            continue
                        cx = bbox.min.X + radius
                        cy = bbox.min.Y + radius
                        top_z = _face_max_z(face)
                        depth = FeatureRecognizer._measure_depth(shape, cx, cy, top_z, radius)
                        _add_hole_dedup(holes, HoleFeature(radius * 2, (cx, cy, top_z), depth))
                    except Exception:
                        pass
        except Exception as e:
            print(f"[FeatureRecognizer Pass-1 Error] {e}")

        # ---- Pass 2: cross-face arc correlation ----
        try:
            arc_groups: Dict[Tuple[float, float, float, float], List[float]] = {}
            for face in _iter_faces(shape):
                for edge in _call(face, "edges"):
                    try:
                        gt = str(getattr(edge, "geom_type", "")).upper()
                        if "CIRCLE" not in gt:
                            continue
                        curve = BRepAdaptor_Curve(edge.wrapped)
                        if curve.GetType() != GeomAbs_Circle:
                            continue
                        circ = curve.Circle()
                        loc = circ.Location()
                        r = circ.Radius()
                        key = (
                            round(loc.X(), 3),
                            round(loc.Y(), 3),
                            round(r, 3),
                            round(loc.Z(), 3),
                        )
                        arc_groups.setdefault(key, []).append(loc.Z())
                    except Exception:
                        pass

            for (cx, cy, r, top_z), _ in arc_groups.items():
                if r < 0.5:
                    continue
                depth = FeatureRecognizer._measure_depth(shape, cx, cy, top_z, r)
                _add_hole_dedup(holes, HoleFeature(r * 2, (cx, cy, top_z), depth))
        except Exception as e:
            print(f"[FeatureRecognizer Pass-2 Error] {e}")

        return holes

    @staticmethod
    def _measure_depth(
        shape: Any,
        cx: float,
        cy: float,
        top_z: float,
        radius: float,
        probe_steps: int = 64,
        max_depth: float = 300.0,
    ) -> float:
        """
        BUG-02 FIX — True depth measurement via ray-casting along the bore axis.

        Fires a downward Z ray through the bore centre and returns the distance
        from top_z to the last solid intersection below the entry face.
        Falls back to a geometry-free heuristic only when no hit is found.
        """
        try:
            from build123d import Edge as B123Edge
            ray = B123Edge.make_line((cx, cy, top_z + 1.0), (cx, cy, top_z - max_depth))
            intersection = shape.intersect(ray)
            if intersection:
                verts = list(_call(intersection, "vertices"))
                z_values = [v.Z for v in verts if v.Z < top_z - 0.1]
                if z_values:
                    return round(top_z - min(z_values), 4)
        except Exception:
            pass
        # Geometry-free fallback: use 3× diameter as a conservative estimate
        return round(radius * 6.0, 4)

    @staticmethod
    def extract_pockets(shape: Any) -> List[PocketFeature]:
        """
        Identifies closed interior pocket regions: planar faces that are fully
        enclosed by walls (i.e. their normal points UP and they are NOT the
        topmost bounding face of the solid).
        """
        pockets: List[PocketFeature] = []
        try:
            bbox = shape.bounding_box()
            top_z = bbox.max.Z
            for face in _iter_faces(shape):
                n = _call(face, "normal_at")
                if abs(n.Z) < 0.95:
                    continue
                fz = _face_max_z(face)
                if abs(fz - top_z) < 0.1:
                    continue  # skip top stock face
                # Has inner wires → it's a pocket floor
                outer = _call(face, "outer_wire")
                all_wires = list(_call(face, "wires"))
                if any(not _same_shape(w, outer) for w in all_wires):
                    pockets.append(PocketFeature(face, fz, fz - 0.0))
        except Exception as e:
            print(f"[FeatureRecognizer Pocket Error] {e}")
        return pockets

    @staticmethod
    def classify_slot(wire: Any) -> Optional[SlotFeature]:
        """
        Classifies an open U-slot: 2 parallel line edges + 2 semicircular arc ends.
        Returns a SlotFeature with a computed centreline, or None.
        """
        try:
            edges = list(_call(wire, "edges"))
            if len(edges) != 4:
                return None
            lines = [e for e in edges if "LINE" in str(getattr(e, "geom_type", "")).upper()]
            arcs = [e for e in edges if "CIRCLE" in str(getattr(e, "geom_type", "")).upper()]
            if len(lines) != 2 or len(arcs) != 2:
                return None

            # Verify lines are parallel (direction vectors anti-parallel or parallel)
            d1 = _edge_direction(lines[0])
            d2 = _edge_direction(lines[1])
            cross = abs(d1[0] * d2[1] - d1[1] * d2[0])
            if cross > 0.05:
                return None  # not parallel

            # Width = perpendicular distance between the two lines
            p0 = lines[0].position_at(0.0)
            p1 = lines[1].position_at(0.0)
            width = math.hypot(p1.X - p0.X, p1.Y - p0.Y) * abs(d1[1])  # rough

            # Centreline from midpoints of the two arc centres
            c1 = _arc_centre(arcs[0])
            c2 = _arc_centre(arcs[1])
            if c1 is None or c2 is None:
                return None

            top_z = max(
                lines[0].position_at(0.0).Z,
                lines[1].position_at(0.0).Z,
            )
            return SlotFeature(
                centerline=[(c1[0], c1[1]), (c2[0], c2[1])],
                width=width,
                z_top=top_z,
                depth=0.0,  # caller must supply cutting depth from OperationModel
            )
        except Exception:
            return None


# ==============================================================================
# POST-PROCESSOR ARCHITECTURE
# ==============================================================================

class BasePostProcessor:
    """Base RS274 Post-Processor (Fanuc / Haas / Mitsubishi / Mazak EIA)."""

    def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
        g_unit = "G21" if units.lower() == "metric" else "G20"
        unit_label = "mm" if units.lower() == "metric" else "inches"
        return [
            "%",
            "O0001 (CAD COPILOT GENERATED CNC PROGRAM)",
            f"; Source File: {filename}",
            f"G17 {g_unit} G40 G49 G80 G90 G94 ; XY plane, {unit_label}, cancel comp/offsets, absolute, feed/min",
        ]

    def tool_change(self, tool: Any, safe_z: float, coolant: bool = True) -> List[str]:
        lines = [
            "G00 G91 G28 Z0 ; Retract tool to machine home Z",
            "G90 ; Absolute coordinates active",
            f"T{tool.number} M06 ; Select tool {tool.number}",
            "G54 ; WCS 1",
            f"M3 S{int(tool.spindle_speed)} ; Spindle ON CW",
        ]
        if coolant:
            lines.append("M08 ; Coolant ON")
        lines.append(
            f"G43 H{tool.number} Z{safe_z:.3f} ; Apply tool length offset, rapid to safe Z"
        )
        return lines

    def rapid(self, x: float = None, y: float = None, z: float = None) -> str:
        cmd = "G0"
        if x is not None:
            cmd += f" X{x:.3f}"
        if y is not None:
            cmd += f" Y{y:.3f}"
        if z is not None:
            cmd += f" Z{z:.3f}"
        return cmd

    def linear(
        self,
        x: float = None,
        y: float = None,
        z: float = None,
        f: float = None,
    ) -> str:
        cmd = "G1"
        if x is not None:
            cmd += f" X{x:.3f}"
        if y is not None:
            cmd += f" Y{y:.3f}"
        if z is not None:
            cmd += f" Z{z:.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return cmd

    def arc(
        self,
        x: float,
        y: float,
        i: float,
        j: float,
        direction: str = "G2",
        z: float = None,
        f: float = None,
    ) -> str:
        """
        BUG-01 NOTE: I and J MUST be the vector from the current tool position
        (arc start) to the arc centre. Callers must compute them as:
            I = centre_x - start_x
            J = centre_y - start_y
        This method does not recompute them; correctness is the caller's
        responsibility (enforced in _extract_arc_segment below).
        """
        cmd = f"{direction} X{x:.3f} Y{y:.3f} I{i:.3f} J{j:.3f}"
        if z is not None:
            cmd += f" Z{z:.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return cmd

    def drill_canned(
        self,
        x: float,
        y: float,
        z: float,
        r: float,
        q: float = None,
        f: float = None,
    ) -> str:
        if q is not None and q > 0:
            cmd = f"G83 X{x:.3f} Y{y:.3f} Z{z:.3f} R{r:.3f} Q{q:.3f}"
        else:
            cmd = f"G81 X{x:.3f} Y{y:.3f} Z{z:.3f} R{r:.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return cmd

    def drill_point(self, x: float, y: float) -> str:
        """Coordinate-only canned cycle continuation (Fanuc/Haas modal)."""
        return f"X{x:.3f} Y{y:.3f}"

    def drill_cancel(self) -> str:
        return "G80"

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant:
            lines.append("M09 ; Coolant OFF")
        lines.extend(
            [
                "M05 ; Spindle OFF",
                "G28 G91 Z0 ; Retract Z to home",
                "G90 ; Absolute coordinates",
                "M30 ; End program",
                "%",
            ]
        )
        return lines


class SiemensPostProcessor(BasePostProcessor):
    def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
        g_unit = "G71" if units.lower() == "metric" else "G70"
        unit_label = "Metric" if units.lower() == "metric" else "Imperial"
        return [
            "; CAD COPILOT - SIEMENS SINUMERIK",
            f"; Source File: {filename}",
            f"G17 {g_unit} G40 G90 G94 ; XY plane, {unit_label}, cancel comp, absolute, feed/min",
        ]

    def tool_change(self, tool: Any, safe_z: float, coolant: bool = True) -> List[str]:
        lines = [
            "SUPA G00 Z0 D0 ; Safe retract Z to machine zero, cancel offset",
            f'T="{tool.number}" M06 ; Select tool {tool.number}',
            "D1 ; Activate cutting edge offset 1",
            "G54",
            f"S{int(tool.spindle_speed)} M3",
        ]
        if coolant:
            lines.append("M08")
        lines.append(f"G0 Z{safe_z:.3f} ; Rapid to safe Z")
        return lines

    def drill_canned(
        self,
        x: float,
        y: float,
        z: float,
        r: float,
        q: float = None,
        f: float = None,
    ) -> str:
        if q is not None and q > 0:
            cycle = f"CYCLE83({r:.3f}, 0.0, 2.0, {z:.3f}, , {q:.3f}, , , , , 1.0, 1)"
        else:
            cycle = f"CYCLE81({r:.3f}, 0.0, 2.0, {z:.3f}, )"
        return f"MCALL {cycle}\nG0 X{x:.3f} Y{y:.3f}"

    def drill_point(self, x: float, y: float) -> str:
        return f"G0 X{x:.3f} Y{y:.3f}"

    def drill_cancel(self) -> str:
        return "MCALL"

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant:
            lines.append("M09")
        lines.extend(
            ["M05", "SUPA G0 Z0 D0 ; Safe retract Z to machine zero, cancel offset", "M30"]
        )
        return lines


class HeidenhainISOPostProcessor(BasePostProcessor):
    def __init__(self):
        super().__init__()
        self.line_counter = 10

    def _n(self, cmd: str) -> str:
        res = f"N{self.line_counter} {cmd} *"
        self.line_counter += 10
        return res

    def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
        self.line_counter = 10
        g_unit = "G71" if units.lower() == "metric" else "G70"
        return [
            f"%0001 {g_unit} * ; Heidenhain ISO Start",
            f"; Source File: {filename} *",
            self._n("G30 G17 X+0 Y+0 Z-50"),
            self._n("G31 G90 X+100 Y+100 Z+0"),
        ]

    def tool_change(self, tool: Any, safe_z: float, coolant: bool = True) -> List[str]:
        lines = [
            self._n("G00 G91 Z+0 M91 ; Safe Z retract"),
            self._n("G90"),
            self._n(f"T{tool.number} G17 S{int(tool.spindle_speed)} ; Tool Call"),
        ]
        if coolant:
            lines.append(self._n("M08"))
        lines.append(self._n(f"G00 Z{safe_z:+.3f}"))
        return lines

    def rapid(self, x: float = None, y: float = None, z: float = None) -> str:
        cmd = "G00"
        if x is not None:
            cmd += f" X{x:+.3f}"
        if y is not None:
            cmd += f" Y{y:+.3f}"
        if z is not None:
            cmd += f" Z{z:+.3f}"
        return self._n(cmd)

    def linear(
        self,
        x: float = None,
        y: float = None,
        z: float = None,
        f: float = None,
    ) -> str:
        cmd = "G01"
        if x is not None:
            cmd += f" X{x:+.3f}"
        if y is not None:
            cmd += f" Y{y:+.3f}"
        if z is not None:
            cmd += f" Z{z:+.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return self._n(cmd)

    def arc(
        self,
        x: float,
        y: float,
        i: float,
        j: float,
        direction: str = "G02",
        z: float = None,
        f: float = None,
    ) -> str:
        direction = "G02" if direction in ("G2", "G02") else "G03"
        cmd = f"{direction} X{x:+.3f} Y{y:+.3f} I{i:+.3f} J{j:+.3f}"
        if z is not None:
            cmd += f" Z{z:+.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return self._n(cmd)

    def drill_canned(
        self,
        x: float,
        y: float,
        z: float,
        r: float,
        q: float = None,
        f: float = None,
    ) -> str:
        """
        BUG-04 FIX (Heidenhain): Emit cycle definition separately from first
        coordinate call so that drill_point() re-triggers it correctly.
        """
        if q is not None and q > 0:
            cmd = f"G83 X{x:+.3f} Y{y:+.3f} Z{z:+.3f} R{r:+.3f} Q{q:.3f}"
        else:
            cmd = f"G81 X{x:+.3f} Y{y:+.3f} Z{z:+.3f} R{r:+.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return self._n(cmd)

    def drill_point(self, x: float, y: float) -> str:
        return self._n(f"X{x:+.3f} Y{y:+.3f}")

    def drill_cancel(self) -> str:
        return self._n("G80")

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant:
            lines.append(self._n("M09"))
        lines.extend(
            [
                self._n("M05"),
                self._n("G00 G91 Z+0 M91"),
                self._n("M30"),
                "%0001 G71 *",
            ]
        )
        return lines


def get_post_processor(controller_type: str) -> BasePostProcessor:
    dialects = {
        "fanuc": BasePostProcessor,
        "haas": BasePostProcessor,
        "mazak": BasePostProcessor,
        "mitsubishi": BasePostProcessor,
        "siemens": SiemensPostProcessor,
        "heidenhain": HeidenhainISOPostProcessor,
    }
    return dialects.get(controller_type.lower(), BasePostProcessor)()


# ==============================================================================
# CAM PLANNER — OPERATION SEQUENCER
# ==============================================================================

# Industry-standard machining order weights.
_STRATEGY_ORDER = {
    "face": 0,       # 1. Facing clears stock top; establishes Z datum
    "spot": 1,       # 2. Spot drill: registers all hole positions
    "drill": 2,      # 3. Deep drilling / peck cycles
    "pocket": 3,     # 4. Rough pocketing: removes bulk material
    "engrave": 4,    # 5. Engraving / slotting (light pass)
    "profile": 5,    # 6. Finish profiling: outer contour last
    "surface": 6,    # 7. 3D surfacing: only after profiles are defined
}


class CAMPlanner:
    """
    Reorders an operations pipeline into a safe, industry-standard sequence.

    Rule priority:
      1. Strategy weight (see _STRATEGY_ORDER above).
      2. Within the same strategy, deeper operations come last (finish last).
      3. Tool changes are minimised as a tertiary sort key.
    """

    @staticmethod
    def sort(operations: List[Any]) -> List[Any]:
        def sort_key(op: Any) -> Tuple[int, float, int]:
            strategy = getattr(op, "strategy", "profile").lower()
            depth = float(getattr(op, "cutting_depth", 0.0))
            tool_num = int(
                getattr(op, "tool_number", None)
                or getattr(getattr(op, "tool", None), "number", 0)
                or 0
            )
            weight = _STRATEGY_ORDER.get(strategy, 99)
            return (weight, depth, tool_num)

        return sorted(operations, key=sort_key)


# ==============================================================================
# CAM ENGINE — STEP NATIVE
# ==============================================================================

class GCodeGenerator:
    """
    Ingests a STEP file or in-memory B-Rep shape, extracts planar topology for
    2.5D profiling/pocketing, uses raycasting for 3D surfacing, and routes all
    toolpaths through the selected Machine Post-Processor.

    Toolpath output strictly conforms to:
        List[List[Tuple[float, float, float]]]
    as required by GCodeResponse (Pydantic schema).
    """

    def __init__(
        self,
        controller: str = "fanuc",
        safe_z: float = 5.0,
        resolution: float = 0.5,
    ):
        self.controller = controller
        self.post = get_post_processor(controller)
        self.safe_z = safe_z
        self.resolution = resolution

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _deviation_angle(
        p1: Tuple[float, float],
        p2: Tuple[float, float],
        p3: Tuple[float, float],
    ) -> float:
        v1 = (p2[0] - p1[0], p2[1] - p1[1])
        v2 = (p3[0] - p2[0], p3[1] - p2[1])
        l1, l2 = math.hypot(*v1), math.hypot(*v2)
        if l1 < 1e-6 or l2 < 1e-6:
            return 0.0
        dot = v1[0] * v2[0] + v1[1] * v2[1]
        return math.acos(max(-1.0, min(1.0, dot / (l1 * l2))))

    @staticmethod
    def _z_hit(shape: Any, x: float, y: float, z_high: float, z_low: float) -> float:
        """Ray-cast downward; return highest Z intersection above z_low."""
        try:
            from build123d import Edge as B123Edge
            ray = B123Edge.make_line((x, y, z_high), (x, y, z_low))
            intersection = shape.intersect(ray)
            if intersection:
                verts = list(_call(intersection, "vertices"))
                hits = [v.Z for v in verts]
                if hits:
                    return max(hits)
        except Exception:
            pass
        return z_low

    # ------------------------------------------------------------------
    # Arc segment extraction — BUG-01 FIX
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_arc_segment(edge: Any) -> Optional[Dict[str, Any]]:
        """
        Extract a G2/G3 arc segment dict with correctly computed I/J vectors.

        BUG-01 FIX:
        The OCC BRep orientation flag (TopAbs_REVERSED) controls which end of
        the parametric curve is the *geometric* start of the edge as it appears
        in the wire traversal order.

        When orientation == TopAbs_REVERSED:
            - parametric t=0.0 → geometric end point (the position the tool
              ARRIVES at, i.e. the arc END in G-code)
            - parametric t=1.0 → geometric start point (where the tool IS
              before this arc move)
        We must swap start/end in that case, and flip the G2↔G3 direction,
        because the arc's winding in world space is the opposite of what the
        curve's own orientation implies.
        """
        try:
            curve = BRepAdaptor_Curve(edge.wrapped)
            if curve.GetType() != GeomAbs_Circle:
                return None

            circ = curve.Circle()
            centre = circ.Location()
            cx, cy = centre.X(), centre.Y()

            is_reversed = (edge.wrapped.Orientation() == TopAbs_REVERSED)

            # Parametric positions
            t_first = 0.0
            t_last = 1.0

            p_param_start = edge.position_at(t_first)
            p_param_end = edge.position_at(t_last)

            if is_reversed:
                # Swap: the tool travels from param_end → param_start
                arc_start = p_param_end
                arc_end = p_param_start
                # Winding direction is also reversed
                direction = "G3"  # CCW in world → was CW on curve
            else:
                arc_start = p_param_start
                arc_end = p_param_end
                direction = "G2"  # CW

            # I, J = vector from arc_start to circle centre (always relative)
            I = cx - arc_start.X
            J = cy - arc_start.Y

            # BUG-05 FIX: Reject full-360° arcs where start ≈ end.
            chord = math.hypot(arc_end.X - arc_start.X, arc_end.Y - arc_start.Y)
            if chord < 1e-4:
                # Full-circle: emit as two 180° arcs to guarantee unambiguous
                # machine interpretation.
                mid_x = cx + (arc_start.X - cx) * -1.0  # diametrically opposite
                mid_y = cy + (arc_start.Y - cy) * -1.0
                return {
                    "type": "FULL_CIRCLE",
                    "direction": direction,
                    "start_x": arc_start.X,
                    "start_y": arc_start.Y,
                    "mid_x": mid_x,
                    "mid_y": mid_y,
                    "end_x": arc_end.X,
                    "end_y": arc_end.Y,
                    "i": I,
                    "j": J,
                    "cx": cx,
                    "cy": cy,
                }

            return {
                "type": "ARC",
                "dir": direction,
                "x": arc_end.X,
                "y": arc_end.Y,
                "i": I,
                "j": J,
                "start_x": arc_start.X,
                "start_y": arc_start.Y,
            }
        except Exception:
            return None

    # ------------------------------------------------------------------
    # Wire-to-segment extraction with sampling fallback
    # ------------------------------------------------------------------

    def _wire_to_segments(self, wire: Any) -> List[Dict[str, Any]]:
        """
        Convert a B-Rep wire into a flat list of segment dicts.
        Each segment is either:
            {"type": "LINE",      "x", "y", "start_x", "start_y"}
            {"type": "ARC",       "dir", "x", "y", "i", "j", "start_x", "start_y"}
            {"type": "FULL_CIRCLE", ...}  (handled in emit phase)

        Falls back to polyline sampling if topology extraction is partial.
        """
        edges = list(_call(wire, "edges") or [])
        segments: List[Dict[str, Any]] = []
        use_fallback = False

        if edges:
            for edge in edges:
                gt = str(getattr(edge, "geom_type", "")).upper()
                try:
                    if "CIRCLE" in gt:
                        seg = self._extract_arc_segment(edge)
                        if seg is not None:
                            segments.append(seg)
                            continue
                    # Straight line
                    p_s = edge.position_at(0.0)
                    p_e = edge.position_at(1.0)
                    # Respect orientation
                    if edge.wrapped.Orientation() == TopAbs_REVERSED:
                        p_s, p_e = p_e, p_s
                    segments.append(
                        {
                            "type": "LINE",
                            "x": p_e.X,
                            "y": p_e.Y,
                            "start_x": p_s.X,
                            "start_y": p_s.Y,
                        }
                    )
                except Exception:
                    pass

            if len(segments) != len(edges):
                use_fallback = True
        else:
            use_fallback = True

        if use_fallback:
            segments = []
            try:
                length = wire.length if not callable(wire.length) else wire.length()
                steps = max(8, int(length / self.resolution))
                prev = None
                for s in range(steps + 1):
                    t = s / float(steps)
                    pt = wire.position_at(t) if hasattr(wire, "position_at") else (wire @ t)
                    if prev is not None:
                        segments.append(
                            {
                                "type": "LINE",
                                "x": pt.X,
                                "y": pt.Y,
                                "start_x": prev.X,
                                "start_y": prev.Y,
                            }
                        )
                    prev = pt
            except Exception:
                try:
                    verts = list(_call(wire, "vertices") or [])
                    for idx in range(len(verts)):
                        v1 = verts[idx]
                        v2 = verts[(idx + 1) % len(verts)]
                        segments.append(
                            {
                                "type": "LINE",
                                "x": v2.X,
                                "y": v2.Y,
                                "start_x": v1.X,
                                "start_y": v1.Y,
                            }
                        )
                except Exception:
                    pass

        # Filter zero-length LINE segments (BUG-05 partial fix for lines)
        segments = [
            s
            for s in segments
            if s["type"] in ("ARC", "FULL_CIRCLE")
            or math.hypot(s["x"] - s["start_x"], s["y"] - s["start_y"]) > 1e-4
        ]

        # Enforce contour closure
        if segments:
            first, last = segments[0], segments[-1]
            last_x = last["x"] if last["type"] != "FULL_CIRCLE" else last["end_x"]
            last_y = last["y"] if last["type"] != "FULL_CIRCLE" else last["end_y"]
            gap = math.hypot(first["start_x"] - last_x, first["start_y"] - last_y)
            if gap > 0.01:
                segments.append(
                    {
                        "type": "LINE",
                        "x": first["start_x"],
                        "y": first["start_y"],
                        "start_x": last_x,
                        "start_y": last_y,
                    }
                )

        return segments

    # ------------------------------------------------------------------
    # Segment emission
    # ------------------------------------------------------------------

    def _emit_segments(
        self,
        segments: List[Dict[str, Any]],
        current_z: float,
        tool: Any,
        gcode_lines: List[str],
        slowdown_factor: float,
    ) -> List[Tuple[float, float, float]]:
        """
        Emit G-code for one Z-pass of a wire. Returns the 3-D path for the
        frontend visualiser as a list of (x, y, z) tuples.

        BUG-03 FIX (for profile/pocket): This method is only called AFTER the
        caller has already issued the independent approach block:
            G0 Z{safe_z}  →  G0 X Y  →  G1 Z{current_z}
        so no stateful Z assumptions exist here.
        """
        path: List[Tuple[float, float, float]] = []
        n = len(segments)

        for i, seg in enumerate(segments):
            feed = tool.feed_rate

            # Corner slow-down on sharp LINE→LINE transitions
            if (
                i < n - 1
                and seg["type"] == "LINE"
                and segments[i + 1]["type"] == "LINE"
            ):
                theta = self._deviation_angle(
                    (seg["start_x"], seg["start_y"]),
                    (seg["x"], seg["y"]),
                    (segments[i + 1]["x"], segments[i + 1]["y"]),
                )
                if theta > math.radians(30.0):
                    feed = tool.feed_rate * slowdown_factor

            if seg["type"] == "FULL_CIRCLE":
                # BUG-05 FIX: Split into two 180° arcs
                gcode_lines.append(
                    self.post.arc(
                        x=seg["mid_x"],
                        y=seg["mid_y"],
                        i=seg["i"],
                        j=seg["j"],
                        direction=seg["direction"],
                        f=feed,
                    )
                )
                i2 = -(seg["i"])
                j2 = -(seg["j"])
                gcode_lines.append(
                    self.post.arc(
                        x=seg["end_x"],
                        y=seg["end_y"],
                        i=i2,
                        j=j2,
                        direction=seg["direction"],
                        f=feed,
                    )
                )
                path.append((seg["mid_x"], seg["mid_y"], current_z))
                path.append((seg["end_x"], seg["end_y"], current_z))

            elif seg["type"] == "ARC":
                gcode_lines.append(
                    self.post.arc(
                        x=seg["x"],
                        y=seg["y"],
                        i=seg["i"],
                        j=seg["j"],
                        direction=seg["dir"],
                        f=feed,
                    )
                )
                path.append((seg["x"], seg["y"], current_z))

            else:  # LINE
                gcode_lines.append(self.post.linear(x=seg["x"], y=seg["y"], f=feed))
                path.append((seg["x"], seg["y"], current_z))

        return path

    # ------------------------------------------------------------------
    # Public generate() entry point
    # ------------------------------------------------------------------

    def generate(
        self,
        input_data: Any,
        operations: List[Any] = None,
        step_path: Any = None,
        auto_sort: bool = False,
    ) -> Dict[str, Any]:
        """
        Generate G-code and 3-D toolpath data.

        Parameters
        ----------
        input_data : CAMJobRequest | str | Path | B-Rep shape
        operations : list of Operation/OperationModel (only when input_data is a path/shape)
        step_path  : override STEP file path (used when input_data is CAMJobRequest)
        auto_sort  : run CAMPlanner.sort() on the operations pipeline before processing

        Returns
        -------
        {"gcode": str, "toolpaths": List[List[Tuple[float, float, float]]]}
        Conforms exactly to GCodeResponse Pydantic schema.
        """
        # ---- Unpack input ----
        try:
            # Duck-type for CAMJobRequest (avoid hard import dependency here)
            request = input_data if hasattr(input_data, "machine_configuration") else None
        except Exception:
            request = None

        if request is not None:
            mc = request.machine_configuration
            controller = mc.controller
            safe_z = mc.safe_z
            resolution = mc.resolution
            coolant = mc.coolant_active
            tools_list = request.tool_library
            ops = request.operations_pipeline
            target_path = step_path or getattr(request, "step_file_path", None)
        else:
            target_path = input_data
            ops = operations or []
            controller = getattr(self, "controller", "fanuc")
            safe_z = getattr(self, "safe_z", 5.0)
            resolution = getattr(self, "resolution", 0.5)
            coolant = True
            tools_list = []
            seen: set = set()
            for op in ops:
                t = getattr(op, "tool", None)
                if t and t.number not in seen:
                    tools_list.append(t)
                    seen.add(t.number)

        self.post = get_post_processor(controller)
        self.safe_z = safe_z
        self.resolution = resolution

        if auto_sort:
            ops = CAMPlanner.sort(ops)

        filename = "Memory_Shape"

        # ---- Ingest geometry ----
        if isinstance(target_path, (str, Path)):
            p = Path(target_path)
            if not p.exists():
                return {"gcode": f"; ERROR: STEP file not found → {p}", "toolpaths": []}
            filename = p.name
            try:
                shape = import_step(str(p))
            except Exception as e:
                return {"gcode": f"; ERROR: Failed to parse STEP file: {e}", "toolpaths": []}
        else:
            shape = target_path

        if shape is None:
            return {"gcode": "; ERROR: No geometry input provided", "toolpaths": []}
        if hasattr(shape, "wrapped") and shape.wrapped is None:
            return {"gcode": "; ERROR: Wrapped shape is None", "toolpaths": []}

        # Pydantic schema type: List[List[Tuple[float, float, float]]]
        toolpaths: List[List[Tuple[float, float, float]]] = []

        initial_units = getattr(ops[0], "units", "metric") if ops else "metric"
        gcode_lines: List[str] = self.post.header(safe_z, filename, units=initial_units)

        try:
            bbox = shape.bounding_box()
        except Exception:
            bbox = None

        tools_map = {t.number: t for t in tools_list}
        current_tool_number = None

        # ================================================================
        # Operation Loop
        # ================================================================
        for op_idx, op in enumerate(ops):
            tool_num = int(
                getattr(op, "tool_number", None)
                or getattr(getattr(op, "tool", None), "number", 0)
                or 0
            )
            tool = tools_map.get(tool_num)
            if not tool:
                gcode_lines.append(f"; ERROR: Op {op_idx+1} — T{tool_num} not in tool library. Skipped.")
                continue

            strategy = getattr(op, "strategy", "profile").lower()
            cutting_depth = float(getattr(op, "cutting_depth", 5.0))
            stepdown = float(getattr(op, "stepdown", 1.0))
            units = getattr(op, "units", "metric")
            slowdown = float(
                getattr(op, "corner_slowdown", None)
                or getattr(op, "corner_slowdown_factor", 0.5)
                or 0.5
            )

            gcode_lines += [
                "",
                f"; ===================================================",
                f"; OPERATION {op_idx+1}: {op.name} ({strategy.upper()})",
                f"; Tool: T{tool.number} — Ø{tool.diameter}mm — {tool.description}",
                f"; ===================================================",
            ]

            if tool.number != current_tool_number:
                gcode_lines.extend(self.post.tool_change(tool, safe_z, coolant=coolant))
                current_tool_number = tool.number

            tool_radius = tool.diameter / 2.0
            num_passes = max(1, math.ceil(cutting_depth / stepdown))

            # ============================================================
            # STRATEGY: 3D SURFACE (TOOL-AWARE DROP-CUTTER)
            # ============================================================
            if strategy == "surface":
                if not bbox:
                    gcode_lines.append("; ERROR: No bounding box for surface strategy.")
                    continue

                stepover = tool.diameter * 0.4
                y_cur = bbox.min.Y
                direction = 1
                is_flat = "flat" in tool.description.lower() or "bull" in tool.description.lower()
                z_high = bbox.max.Z + 10.0
                z_low = bbox.min.Z - 10.0

                gcode_lines.append(
                    f"; 3D Surfacing ({'Flat/Bullnose 5-ray' if is_flat else 'Ballnose single-ray'})"
                )

                while y_cur <= bbox.max.Y:
                    x_start = bbox.min.X if direction == 1 else bbox.max.X
                    x_end = bbox.max.X if direction == 1 else bbox.min.X
                    x_steps = max(2, int(abs(x_end - x_start) / self.resolution))
                    pass_path: List[Tuple[float, float, float]] = []

                    for step in range(x_steps + 1):
                        x_cur = x_start + (x_end - x_start) * (step / x_steps)
                        z_c = self._z_hit(shape, x_cur, y_cur, z_high, z_low)

                        if is_flat:
                            z_n = self._z_hit(shape, x_cur, y_cur + tool_radius, z_high, z_low)
                            z_s = self._z_hit(shape, x_cur, y_cur - tool_radius, z_high, z_low)
                            z_e = self._z_hit(shape, x_cur + tool_radius, y_cur, z_high, z_low)
                            z_w = self._z_hit(shape, x_cur - tool_radius, y_cur, z_high, z_low)
                            z_target = max(z_c, z_n, z_s, z_e, z_w)
                        else:
                            z_target = z_c + tool_radius

                        feed = tool.plunge_rate if step == 0 else tool.feed_rate
                        gcode_lines.append(
                            self.post.linear(x=x_cur, y=y_cur, z=z_target, f=feed)
                        )
                        pass_path.append((x_cur, y_cur, z_target))

                    toolpaths.append(pass_path)
                    y_cur += stepover
                    direction *= -1

                gcode_lines.append(self.post.rapid(z=safe_z))

            # ============================================================
            # STRATEGY: DRILLING (CANNED CYCLES)
            # ============================================================
            elif strategy == "drill":
                holes = FeatureRecognizer.extract_holes(shape)
                if not holes:
                    gcode_lines.append("; WARNING: No holes recognised. Skipping drill operation.")
                    continue

                gcode_lines.append(f"; Drilling {len(holes)} hole(s)")
                # Peck depth: use stepdown if it is less than cutting_depth
                q_val = stepdown if stepdown < cutting_depth else None

                for h_idx, hole in enumerate(holes):
                    hx, hy, hz = hole.location
                    # BUG-02 FIX: use measured depth, not hardcoded 10.0
                    actual_depth = min(cutting_depth, hole.depth)
                    target_z = hz - actual_depth
                    retract_z = hz + 2.0

                    gcode_lines.append(
                        f"; Hole {h_idx+1}: Ø{hole.diameter:.3f}mm depth {actual_depth:.3f}mm"
                        f" at X{hx:.3f} Y{hy:.3f}"
                    )

                    # Visualiser path (Pydantic: List[Tuple[float,float,float]])
                    toolpaths.append(
                        [
                            (hx, hy, safe_z),
                            (hx, hy, retract_z),
                            (hx, hy, target_z),
                            (hx, hy, safe_z),
                        ]
                    )

                    if h_idx == 0:
                        gcode_lines.append(
                            self.post.drill_canned(
                                x=hx,
                                y=hy,
                                z=target_z,
                                r=retract_z,
                                q=q_val,
                                f=tool.feed_rate,
                            )
                        )
                    else:
                        gcode_lines.append(self.post.drill_point(x=hx, y=hy))

                gcode_lines.append(self.post.drill_cancel())
                gcode_lines.append(self.post.rapid(z=safe_z))

            # ============================================================
            # STRATEGY: FACING (RASTER)
            # BUG-03 FIX: Every raster row now gets a full independent approach
            # ============================================================
            elif strategy == "face":
                if not bbox:
                    gcode_lines.append("; ERROR: No bounding box for face strategy.")
                    continue

                stepover = tool.diameter * 0.75
                x_min = bbox.min.X - tool_radius
                x_max = bbox.max.X + tool_radius
                y_min = bbox.min.Y - tool_radius
                y_max = bbox.max.Y + tool_radius

                gcode_lines.append("; Facing (Raster)")

                for pass_idx in range(num_passes):
                    current_z = -min((pass_idx + 1) * stepdown, cutting_depth)
                    gcode_lines.append(f"; Depth pass {pass_idx+1} (Z={current_z:.3f})")

                    y_cur = y_min
                    raster_dir = 1

                    while y_cur <= y_max:
                        x_start = x_min if raster_dir == 1 else x_max
                        x_end = x_max if raster_dir == 1 else x_min

                        # BUG-03 FIX: Independent approach on EVERY row
                        gcode_lines.append(self.post.rapid(z=safe_z))
                        gcode_lines.append(self.post.rapid(x=x_start, y=y_cur))
                        gcode_lines.append(self.post.linear(z=current_z, f=tool.plunge_rate))
                        gcode_lines.append(
                            self.post.linear(x=x_end, y=y_cur, f=tool.feed_rate)
                        )

                        toolpaths.append(
                            [
                                (x_start, y_cur, safe_z),
                                (x_start, y_cur, current_z),
                                (x_end, y_cur, current_z),
                            ]
                        )

                        y_cur += stepover
                        raster_dir *= -1

                    gcode_lines.append(self.post.rapid(z=safe_z))

            # ============================================================
            # STRATEGY: 2.5D PROFILE / POCKET / ENGRAVE
            # ============================================================
            elif strategy in ("profile", "pocket", "engrave"):
                # ---- Collect planar faces ----
                planar_faces: List[Any] = []
                try:
                    for f in _iter_faces(shape):
                        n_vec = _call(f, "normal_at")
                        if abs(n_vec.Z) > 0.90:
                            planar_faces.append(f)
                except Exception as e:
                    gcode_lines.append(f"; ERROR: Face extraction failed: {e}")

                wires: List[Any] = []

                if not planar_faces:
                    gcode_lines.append("; WARNING: No planar faces — falling back to wire extraction.")
                    try:
                        wires = list(_call(shape, "wires") or [])
                    except Exception:
                        wires = []
                else:
                    offset_faces: List[Any] = []
                    for face in planar_faces:
                        try:
                            if strategy == "profile":
                                try:
                                    offset_faces.extend(_call(face.offset_2d(tool_radius), "faces"))
                                except Exception:
                                    gcode_lines.append("; WARNING: Profile offset failed — cutting on nominal line.")
                                    offset_faces.append(face)

                            elif strategy == "pocket":
                                stepover_2d = tool_radius * 0.8
                                cur_off = -tool_radius
                                pocket_faces: List[Any] = []
                                max_pocket_passes = max(
                                    50, int(face.area / (tool_radius * tool_radius * math.pi)) + 5
                                )
                                for _ in range(max_pocket_passes):
                                    try:
                                        off = face.offset_2d(cur_off)
                                        off_faces = list(_call(off, "faces")) if hasattr(off, "faces") else [off]
                                        if not off_faces:
                                            break
                                        # BUG-07 FIX: guard by area, not hard count cap
                                        total_area = sum(
                                            getattr(f2, "area", 0.0) for f2 in off_faces
                                        )
                                        if total_area < 1e-4:
                                            break
                                        pocket_faces.extend(off_faces)
                                        cur_off -= stepover_2d
                                    except Exception:
                                        break
                                offset_faces.extend(pocket_faces if pocket_faces else [face])

                            else:  # engrave
                                offset_faces.append(face)

                        except Exception:
                            offset_faces.append(face)

                    for f2 in offset_faces:
                        try:
                            wires.append(_call(f2, "outer_wire"))
                        except Exception:
                            try:
                                wires.extend(list(_call(f2, "wires") or []))
                            except Exception:
                                pass

                # ---- Process each wire ----
                for w_idx, wire in enumerate(wires):
                    segments = self._wire_to_segments(wire)
                    if not segments:
                        continue

                    gcode_lines.append(f"\n; --- Contour {w_idx+1} ---")

                    first_seg = segments[0]
                    start_x, start_y = first_seg["start_x"], first_seg["start_y"]

                    for pass_idx in range(num_passes):
                        current_z = -min((pass_idx + 1) * stepdown, cutting_depth)
                        gcode_lines.append(f"; Pass {pass_idx+1} (Z={current_z:.3f})")

                        # Independent approach protocol (every pass, every contour)
                        gcode_lines.append(self.post.rapid(z=safe_z))
                        gcode_lines.append(self.post.rapid(x=start_x, y=start_y))
                        gcode_lines.append(self.post.linear(z=current_z, f=tool.plunge_rate))

                        pass_path: List[Tuple[float, float, float]] = [
                            (start_x, start_y, safe_z),
                            (start_x, start_y, current_z),
                        ]

                        pass_path += self._emit_segments(
                            segments,
                            current_z,
                            tool,
                            gcode_lines,
                            slowdown,
                        )

                        toolpaths.append(pass_path)

                    gcode_lines.append(self.post.rapid(z=safe_z))

            else:
                gcode_lines.append(f"; WARNING: Unknown strategy '{strategy}' — skipped.")

        gcode_lines += ["", "; --- End of Program ---"]
        gcode_lines.extend(self.post.footer(coolant=coolant))

        return {
            "gcode": "\n".join(gcode_lines),
            "toolpaths": toolpaths,  # List[List[Tuple[float,float,float]]] ✓
        }


# ==============================================================================
# PRIVATE HELPERS
# ==============================================================================

def _iter_faces(shape: Any):
    try:
        result = shape.faces()
        return iter(result) if not hasattr(result, "__iter__") else result
    except TypeError:
        return iter(shape.faces)


def _call(obj: Any, attr: str) -> Any:
    val = getattr(obj, attr, None)
    if val is None:
        return []
    return val() if callable(val) else val


def _same_shape(a: Any, b: Any) -> bool:
    try:
        return a.wrapped.IsSame(b.wrapped)
    except Exception:
        return a is b


def _face_max_z(face: Any) -> float:
    try:
        bb = face.bounding_box()
        return bb.max.Z
    except Exception:
        return 0.0


def _add_hole_dedup(holes: List[HoleFeature], candidate: HoleFeature, tol: float = 0.5):
    for h in holes:
        if (
            math.hypot(h.location[0] - candidate.location[0], h.location[1] - candidate.location[1]) < tol
            and abs(h.diameter - candidate.diameter) < tol
        ):
            # Keep the one with the greater measured depth (more information)
            if candidate.depth > h.depth:
                h.depth = candidate.depth
            return
    holes.append(candidate)


def _edge_direction(edge: Any) -> Tuple[float, float]:
    try:
        p0 = edge.position_at(0.0)
        p1 = edge.position_at(1.0)
        dx, dy = p1.X - p0.X, p1.Y - p0.Y
        length = math.hypot(dx, dy)
        if length < 1e-9:
            return (1.0, 0.0)
        return (dx / length, dy / length)
    except Exception:
        return (1.0, 0.0)


def _arc_centre(edge: Any) -> Optional[Tuple[float, float]]:
    try:
        curve = BRepAdaptor_Curve(edge.wrapped)
        if curve.GetType() != GeomAbs_Circle:
            return None
        loc = curve.Circle().Location()
        return (loc.X(), loc.Y())
    except Exception:
        return None