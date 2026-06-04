import math
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union

from build123d import import_step, Face, Wire, Location
from app.models.schemas import CAMJobRequest, ToolModel, OperationModel

# ==============================================================================
# BACKWARDS COMPATIBILITY DATA STRUCTURES
# ==============================================================================

class Tool:
    def __init__(self, number: int, diameter: float, spindle_speed: float, feed_rate: float, plunge_rate: float, description: str = "Endmill"):
        self.number = number
        self.diameter = diameter
        self.spindle_speed = spindle_speed
        self.feed_rate = feed_rate
        self.plunge_rate = plunge_rate
        self.description = description

class Operation:
    def __init__(self, name: str, strategy: str, tool: Tool, cutting_depth: float, stepdown: float, units: str = "metric", corner_slowdown: float = 0.5):
        self.name = name
        self.strategy = strategy
        self.tool = tool
        self.cutting_depth = cutting_depth
        self.stepdown = stepdown
        self.units = units
        self.corner_slowdown = corner_slowdown

# ==============================================================================
# POST-PROCESSOR ARCHITECTURE
# ==============================================================================

class BasePostProcessor:
    """Base RS274 Post-Processor (Fanuc / Haas / Mitsubishi / Mazak EIA)"""
    
    def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
        g_unit = "G21" if units.lower() == "metric" else "G20"
        unit_label = "mm" if units.lower() == "metric" else "inches"
        return [
            "%",
            "O0001 (CAD COPILOT GENERATED CNC PROGRAM)",
            f"; Source File: {filename}",
            f"G17 {g_unit} G40 G49 G80 G90 G94 ; XY plane, {unit_label}, cancel comp/offsets, absolute, feed/min",
        ]

    def tool_change(self, tool: Union[Tool, ToolModel], safe_z: float, coolant: bool = True) -> List[str]:
        lines = [
            "G00 G91 G28 Z0 ; Retract tool to machine home Z",
            "G90 ; Absolute coordinates active",
            f"T{tool.number} M06 ; Select tool {tool.number}",
            "G54 ; WCS 1",
            f"M3 S{int(tool.spindle_speed)} ; Spindle ON CW",
        ]
        if coolant:
            lines.append("M08 ; Coolant ON")
        lines.append(f"G43 H{tool.number} Z{safe_z:.3f} ; Apply tool length offset, rapid to safe Z")
        return lines

    def rapid(self, x: float = None, y: float = None, z: float = None) -> str:
        cmd = "G0"
        if x is not None: cmd += f" X{x:.3f}"
        if y is not None: cmd += f" Y{y:.3f}"
        if z is not None: cmd += f" Z{z:.3f}"
        return cmd

    def linear(self, x: float = None, y: float = None, z: float = None, f: float = None) -> str:
        cmd = "G1"
        if x is not None: cmd += f" X{x:.3f}"
        if y is not None: cmd += f" Y{y:.3f}"
        if z is not None: cmd += f" Z{z:.3f}"
        if f is not None: cmd += f" F{f:.1f}"
        return cmd

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant:
            lines.append("M09 ; Coolant OFF")
        lines.extend([
            "M05 ; Spindle OFF",
            "G28 G91 Z0 ; Retract Z to home",
            "G90 ; Absolute coordinates",
            "M30 ; End program",
            "%",
        ])
        return lines

class SiemensPostProcessor(BasePostProcessor):
    """Siemens Sinumerik specifically uses D-words for tool cutting edges instead of G43 H-words."""
    
    def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
        g_unit = "G71" if units.lower() == "metric" else "G70"
        unit_label = "Metric" if units.lower() == "metric" else "Imperial"
        return [
            "; CAD COPILOT - SIEMENS SINUMERIK",
            f"; Source File: {filename}",
            f"G17 {g_unit} G40 G90 G94 ; XY plane, {unit_label}, cancel comp, absolute, feed/min",
        ]

    def tool_change(self, tool: Union[Tool, ToolModel], safe_z: float, coolant: bool = True) -> List[str]:
        lines = [
            "SUPA G00 Z0 D0 ; Safe retract Z to machine zero, cancel offset",
            f"T=\"{tool.number}\" M06 ; Select tool {tool.number}",
            "D1 ; Activate cutting edge offset 1", 
            "G54",
            f"S{int(tool.spindle_speed)} M3",
        ]
        if coolant:
            lines.append("M08")
        lines.append(f"G0 Z{safe_z:.3f} ; Rapid to safe Z")
        return lines

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant:
            lines.append("M09")
        lines.extend([
            "M05",
            "SUPA G0 Z0 D0 ; Safe retract Z to machine zero, cancel offset",
            "M30",
        ])
        return lines

class HeidenhainISOPostProcessor(BasePostProcessor):
    """Heidenhain ISO uses strict formatting, G71 for metric, and specific tool call syntax."""
    
    def __init__(self):
        super().__init__()
        self.line_counter = 10

    def next_line(self, cmd: str) -> str:
        res = f"N{self.line_counter} {cmd} *"
        self.line_counter += 10
        return res

    def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
        self.line_counter = 10
        g_unit = "G71" if units.lower() == "metric" else "G70"
        return [
            f"%0001 {g_unit} * ; Heidenhain ISO Start",
            f"; Source File: {filename} *",
            self.next_line("G30 G17 X+0 Y+0 Z-50"),
            self.next_line("G31 G90 X+100 Y+100 Z+0"),
        ]

    def tool_change(self, tool: Union[Tool, ToolModel], safe_z: float, coolant: bool = True) -> List[str]:
        lines = [
            self.next_line("G00 G91 Z+0 M91 ; Safe Z retract"),
            self.next_line("G90"),
            self.next_line(f"T{tool.number} G17 S{int(tool.spindle_speed)} ; Tool Call"),
        ]
        if coolant:
            lines.append(self.next_line("M08"))
        lines.append(self.next_line(f"G00 Z{safe_z:+.3f}"))
        return lines

    def rapid(self, x: float = None, y: float = None, z: float = None) -> str:
        cmd = "G00"
        if x is not None: cmd += f" X{x:+.3f}"
        if y is not None: cmd += f" Y{y:+.3f}"
        if z is not None: cmd += f" Z{z:+.3f}"
        return self.next_line(cmd)

    def linear(self, x: float = None, y: float = None, z: float = None, f: float = None) -> str:
        cmd = "G01"
        if x is not None: cmd += f" X{x:+.3f}"
        if y is not None: cmd += f" Y{y:+.3f}"
        if z is not None: cmd += f" Z{z:+.3f}"
        if f is not None: cmd += f" F{f:.1f}"
        return self.next_line(cmd)

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant:
            lines.append(self.next_line("M09"))
        lines.extend([
            self.next_line("M05"),
            self.next_line("G00 G91 Z+0 M91"),
            self.next_line("M30"),
            "%0001 G71 *",
        ])
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
# CAM ENGINE (STEP NATIVE)
# ==============================================================================

class GCodeGenerator:
    """
    Ingests a STEP file or shape, extracts planar topology, applies Tool Radius Compensation, 
    and routes toolpaths through the selected Machine Post-Processor.
    """

    def __init__(
        self,
        controller: str = "fanuc", 
        safe_z: float = 5.0,
        resolution: float = 0.5    
    ):
        self.controller = controller
        self.post = get_post_processor(controller)
        self.safe_z = safe_z
        self.resolution = resolution

    def _calculate_deviation_angle(
        self, 
        p1: Tuple[float, float], 
        p2: Tuple[float, float], 
        p3: Tuple[float, float]
    ) -> float:
        """Calculate the deviation angle (in radians) between vector p1->p2 and p2->p3."""
        v1 = (p2[0] - p1[0], p2[1] - p1[1])
        v2 = (p3[0] - p2[0], p3[1] - p2[1])
        
        len1 = math.hypot(*v1)
        len2 = math.hypot(*v2)
        
        if len1 < 1e-6 or len2 < 1e-6:
            return 0.0
            
        dot_product = v1[0] * v2[0] + v1[1] * v2[1]
        cos_theta = dot_product / (len1 * len2)
        cos_theta = max(-1.0, min(1.0, cos_theta))
        return math.acos(cos_theta)

    def generate(
        self, 
        input_data: Union[str, Path, Any, CAMJobRequest], 
        operations: List[Union[Operation, OperationModel]] = None, 
        step_path: Union[str, Path] = None
    ) -> Dict[str, Any]:
        """
        Main entry point. Supports two signatures:
        1. generate(request: CAMJobRequest, step_path: str = None)
        2. generate(input_data: Union[str, Path, Any], operations: List[Operation])
        """
        if isinstance(input_data, CAMJobRequest):
            request = input_data
            controller = request.machine_configuration.controller
            safe_z = request.machine_configuration.safe_z
            resolution = request.machine_configuration.resolution
            coolant = request.machine_configuration.coolant_active
            tools = request.tool_library
            ops = request.operations_pipeline
            target_path = step_path or request.step_file_path
        else:
            target_path = input_data
            ops = operations or []
            controller = getattr(self, "controller", "fanuc")
            safe_z = getattr(self, "safe_z", 5.0)
            resolution = getattr(self, "resolution", 0.5)
            coolant = getattr(self, "coolant", True)
            # Extract tools list from operations
            tools = []
            seen_tools = set()
            for op in ops:
                tool_obj = getattr(op, "tool", None)
                if tool_obj and tool_obj.number not in seen_tools:
                    tools.append(tool_obj)
                    seen_tools.add(tool_obj.number)

        # Align parameters
        self.post = get_post_processor(controller)
        self.safe_z = safe_z
        self.resolution = resolution

        filename = "Memory_Shape"
        
        # 1. Handle STEP File Ingestion
        if isinstance(target_path, (str, Path)):
            step_path_obj = Path(target_path)
            if not step_path_obj.exists():
                return {"gcode": f"; ERROR: STEP file not found -> {step_path_obj}", "toolpaths": []}
            
            filename = step_path_obj.name
            try:
                shape = import_step(str(step_path_obj))
            except Exception as e:
                return {"gcode": f"; ERROR: Failed to parse STEP file: {str(e)}", "toolpaths": []}
        else:
            shape = target_path

        if not shape:
            return {"gcode": "; ERROR: No geometry input provided", "toolpaths": []}

        toolpaths: List[List[Tuple[float, float, float]]] = []
        
        # 2. Write Program Header (read units from first operation if available)
        initial_units = "metric"
        if ops:
            initial_units = getattr(ops[0], "units", "metric")
        gcode_lines: List[str] = self.post.header(self.safe_z, filename, units=initial_units)

        # 3. Extract Top-Down XY Faces from the STEP geometry
        planar_faces = []
        try:
            f_list = shape.faces() if callable(shape.faces) else shape.faces
            for f in f_list:
                n = f.normal_at() if callable(f.normal_at) else f.normal_at
                # Isolate faces flat on the XY plane
                if abs(n.Z) > 0.99:
                    planar_faces.append(f)
        except Exception as e:
            gcode_lines.append(f"; ERROR: Face extraction failed: {str(e)}")

        if not planar_faces:
            gcode_lines.append("; WARNING: No valid XY planar faces found in STEP file.")
            gcode_lines.extend(self.post.footer(coolant=coolant))
            return {"gcode": "\n".join(gcode_lines), "toolpaths": []}

        # Keep track of active tool to minimize redundant tool changes
        current_tool_number = None

        # Build tools mapping dictionary
        tools_map = {t.number: t for t in tools}

        # 4. Process each operation sequentially
        for op_idx, op in enumerate(ops):
            # Resolve tool reference
            tool_num = getattr(op, "tool_number", None)
            if tool_num is None:
                tool_obj = getattr(op, "tool", None)
                tool_num = getattr(tool_obj, "number", None)
                
            tool = tools_map.get(tool_num)
            if not tool:
                gcode_lines.append(f"; ERROR: Tool {tool_num} not found in library for Operation: {op.name}")
                continue

            gcode_lines.append(f"\n; ===================================================")
            gcode_lines.append(f"; OPERATION {op_idx + 1}: {op.name} ({op.strategy.upper()})")
            gcode_lines.append(f"; Tool: T{tool.number} - Dia: {tool.diameter}mm - {tool.description}")
            gcode_lines.append(f"; ===================================================")

            # Tool change block - checks and suppresses redundant changes
            if tool.number != current_tool_number:
                gcode_lines.extend(self.post.tool_change(tool, self.safe_z, coolant=coolant))
                current_tool_number = tool.number

            # Apply tool radius offset based on strategy
            tool_radius = tool.diameter / 2.0
            offset_faces = []

            for face in planar_faces:
                try:
                    if op.strategy == "profile":
                        offset_faces.extend(face.offset_2d(tool_radius).faces())
                    elif op.strategy == "pocket":
                        stepover = tool_radius * 0.8
                        current_offset = -tool_radius
                        pocket_passes = []
                        while True:
                            try:
                                off = face.offset_2d(current_offset)
                                off_faces = off.faces() if hasattr(off, "faces") else [off]
                                if not off_faces:
                                    break
                                area = sum(f.area for f in off_faces)
                                if area < 1e-4:
                                    break
                                pocket_passes.extend(off_faces)
                                current_offset -= stepover
                                if len(pocket_passes) > 20:  # Safety guard
                                    break
                            except Exception:
                                break
                        if pocket_passes:
                            offset_faces.extend(pocket_passes)
                        else:
                            offset_faces.append(face)
                    elif op.strategy == "engrave":
                        offset_faces.append(face)
                    else:
                        offset_faces.append(face)
                except Exception:
                    offset_faces.append(face)

            # Extract wires
            wires = []
            for f in offset_faces:
                if hasattr(f, "outer_wire"):
                    wires.append(f.outer_wire())
                elif hasattr(f, "wires"):
                    wires.extend(f.wires() if callable(f.wires) else f.wires)
                elif hasattr(f, "wrapped") and f.wrapped.ShapeType() == 2:  # TopoDS_Wire
                    wires.append(f)

            # Generate toolpaths
            for wire_idx, wire in enumerate(wires):
                points_2d: List[Tuple[float, float]] = []
                
                # Dynamic edge-by-edge geometry evaluation
                edges = []
                if hasattr(wire, "edges"):
                    edges = wire.edges() if callable(wire.edges) else wire.edges

                if edges:
                    for edge in edges:
                        geom_type = "LINE"
                        try:
                            geom_type = str(edge.geom_type).upper()
                        except Exception:
                            pass
                        
                        try:
                            if "LINE" in geom_type:
                                # Pure straight line -> exactly 2 points (start/end)
                                p_start = edge.position_at(0.0)
                                p_end = edge.position_at(1.0)
                                if not points_2d or math.hypot(points_2d[-1][0] - p_start.X, points_2d[-1][1] - p_start.Y) > 1e-4:
                                    points_2d.append((p_start.X, p_start.Y))
                                points_2d.append((p_end.X, p_end.Y))
                            else:
                                # Curved shape -> sample dynamically based on resolution
                                edge_len = edge.length if not callable(edge.length) else edge.length()
                                steps = max(4, int(edge_len / self.resolution))
                                for s in range(steps + 1):
                                    t = s / float(steps)
                                    pt = edge.position_at(t)
                                    if not points_2d or math.hypot(points_2d[-1][0] - pt.X, points_2d[-1][1] - pt.Y) > 1e-4:
                                        points_2d.append((pt.X, pt.Y))
                        except Exception:
                            try:
                                v_start = edge.position_at(0.0)
                                v_end = edge.position_at(1.0)
                                points_2d.append((v_start.X, v_start.Y))
                                points_2d.append((v_end.X, v_end.Y))
                            except Exception:
                                pass
                
                # Fallback to standard wire sampling if edge-by-edge resulted in empty list
                if not points_2d:
                    try:
                        length = wire.length if not callable(wire.length) else wire.length()
                        steps = max(4, int(length / self.resolution))
                        for s in range(steps + 1):
                            t = s / float(steps)
                            pt = wire.position_at(t) if hasattr(wire, "position_at") else (wire @ t)
                            points_2d.append((pt.X, pt.Y))
                    except Exception:
                        try:
                            verts = wire.vertices() if callable(wire.vertices) else wire.vertices
                            points_2d = [(v.X, v.Y) for v in verts]
                            if points_2d:
                                points_2d.append(points_2d[0])
                        except Exception:
                            continue

                if not points_2d or len(points_2d) < 2:
                    continue

                gcode_lines.append(f"\n; --- Wire/Contour {wire_idx + 1} ---")
                num_passes = max(1, int(math.ceil(op.cutting_depth / op.stepdown)))

                # Determine operational slowdown factor
                slowdown_factor = getattr(op, "corner_slowdown_factor", None)
                if slowdown_factor is None:
                    slowdown_factor = getattr(op, "corner_slowdown", 0.5)

                for pass_idx in range(num_passes):
                    prev_z = 0.0 if pass_idx == 0 else -min(pass_idx * op.stepdown, op.cutting_depth)
                    current_z = -min((pass_idx + 1) * op.stepdown, op.cutting_depth)
                    gcode_lines.append(f"; Pass {pass_idx + 1} (Z={current_z:.3f})")

                    start_x, start_y = points_2d[0]
                    ramp_x, ramp_y = points_2d[1]

                    # Ramping Entry Plunge implementation
                    if pass_idx == 0:
                        # Rapid move to start XY coordinates
                        gcode_lines.append(self.post.rapid(x=start_x, y=start_y))
                        # Linear move down to Z=0.0 (prev_z)
                        gcode_lines.append(self.post.linear(z=prev_z, f=tool.plunge_rate))
                        # Ramp Z down simultaneously during first X-Y move segment
                        gcode_lines.append(self.post.linear(x=ramp_x, y=ramp_y, z=current_z, f=tool.plunge_rate))
                    else:
                        # Ramps down along the first segment from previous pass depth without retract
                        gcode_lines.append(self.post.linear(x=ramp_x, y=ramp_y, z=current_z, f=tool.plunge_rate))

                    current_pass_path: List[Tuple[float, float, float]] = [
                        (start_x, start_y, prev_z),
                        (ramp_x, ramp_y, current_z)
                    ]

                    # Complete the rest of the cut at full cutting feed rate
                    for i in range(2, len(points_2d)):
                        pt = points_2d[i]
                        feed = tool.feed_rate
                        
                        if i < len(points_2d) - 1:
                            p_prev = points_2d[i - 1]
                            p_curr = pt
                            p_next = points_2d[i + 1]
                            theta = self._calculate_deviation_angle(p_prev, p_curr, p_next)
                            
                            # 30 degrees threshold warning and slowdown trigger
                            if theta > (30.0 * math.pi / 180.0):
                                gcode_lines.append(f"; WARNING: Sharp corner detected ({math.degrees(theta):.1f} deg). Decelerating.")
                                feed = tool.feed_rate * slowdown_factor

                        gcode_lines.append(self.post.linear(x=pt[0], y=pt[1], f=feed))
                        current_pass_path.append((pt[0], pt[1], current_z))

                    toolpaths.append(current_pass_path)

                # Safe retract rapid Z-move only when the entire wire contour loop is complete
                gcode_lines.append(self.post.rapid(z=self.safe_z))

        # 5. Write Program Footer
        gcode_lines.extend([""])
        gcode_lines.extend(self.post.footer(coolant=coolant))

        return {
            "gcode": "\n".join(gcode_lines),
            "toolpaths": toolpaths,
        }