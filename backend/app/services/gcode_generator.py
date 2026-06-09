# import math
# from pathlib import Path
# from typing import Any, Dict, List, Tuple, Union

# from build123d import import_step, Face, Wire, Location, Edge, Vector, Vertex
# from app.models.schemas import CAMJobRequest, ToolModel, OperationModel

# # ==============================================================================
# # BACKWARDS COMPATIBILITY DATA STRUCTURES
# # ==============================================================================

# class Tool:
#     def __init__(self, number: int, diameter: float, spindle_speed: float, feed_rate: float, plunge_rate: float, description: str = "Endmill"):
#         self.number = number
#         self.diameter = diameter
#         self.spindle_speed = spindle_speed
#         self.feed_rate = feed_rate
#         self.plunge_rate = plunge_rate
#         self.description = description

# class Operation:
#     def __init__(self, name: str, strategy: str, tool: Tool, cutting_depth: float, stepdown: float, units: str = "metric", corner_slowdown: float = 0.5):
#         self.name = name
#         self.strategy = strategy
#         self.tool = tool
#         self.cutting_depth = cutting_depth
#         self.stepdown = stepdown
#         self.units = units
#         self.corner_slowdown = corner_slowdown

# # ==============================================================================
# # POST-PROCESSOR ARCHITECTURE
# # ==============================================================================

# class BasePostProcessor:
#     """Base RS274 Post-Processor (Fanuc / Haas / Mitsubishi / Mazak EIA)"""
    
#     def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
#         g_unit = "G21" if units.lower() == "metric" else "G20"
#         unit_label = "mm" if units.lower() == "metric" else "inches"
#         return [
#             "%",
#             "O0001 (CAD COPILOT GENERATED CNC PROGRAM)",
#             f"; Source File: {filename}",
#             f"G17 {g_unit} G40 G49 G80 G90 G94 ; XY plane, {unit_label}, cancel comp/offsets, absolute, feed/min",
#         ]

#     def tool_change(self, tool: Union[Tool, ToolModel], safe_z: float, coolant: bool = True) -> List[str]:
#         lines = [
#             "G00 G91 G28 Z0 ; Retract tool to machine home Z",
#             "G90 ; Absolute coordinates active",
#             f"T{tool.number} M06 ; Select tool {tool.number}",
#             "G54 ; WCS 1",
#             f"M3 S{int(tool.spindle_speed)} ; Spindle ON CW",
#         ]
#         if coolant:
#             lines.append("M08 ; Coolant ON")
#         lines.append(f"G43 H{tool.number} Z{safe_z:.3f} ; Apply tool length offset, rapid to safe Z")
#         return lines

#     def rapid(self, x: float = None, y: float = None, z: float = None) -> str:
#         cmd = "G0"
#         if x is not None: cmd += f" X{x:.3f}"
#         if y is not None: cmd += f" Y{y:.3f}"
#         if z is not None: cmd += f" Z{z:.3f}"
#         return cmd

#     def linear(self, x: float = None, y: float = None, z: float = None, f: float = None) -> str:
#         cmd = "G1"
#         if x is not None: cmd += f" X{x:.3f}"
#         if y is not None: cmd += f" Y{y:.3f}"
#         if z is not None: cmd += f" Z{z:.3f}"
#         if f is not None: cmd += f" F{f:.1f}"
#         return cmd

#     def footer(self, coolant: bool = True) -> List[str]:
#         lines = []
#         if coolant:
#             lines.append("M09 ; Coolant OFF")
#         lines.extend([
#             "M05 ; Spindle OFF",
#             "G28 G91 Z0 ; Retract Z to home",
#             "G90 ; Absolute coordinates",
#             "M30 ; End program",
#             "%",
#         ])
#         return lines

# class SiemensPostProcessor(BasePostProcessor):
#     """Siemens Sinumerik specifically uses D-words for tool cutting edges instead of G43 H-words."""
    
#     def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
#         g_unit = "G71" if units.lower() == "metric" else "G70"
#         unit_label = "Metric" if units.lower() == "metric" else "Imperial"
#         return [
#             "; CAD COPILOT - SIEMENS SINUMERIK",
#             f"; Source File: {filename}",
#             f"G17 {g_unit} G40 G90 G94 ; XY plane, {unit_label}, cancel comp, absolute, feed/min",
#         ]

#     def tool_change(self, tool: Union[Tool, ToolModel], safe_z: float, coolant: bool = True) -> List[str]:
#         lines = [
#             "SUPA G00 Z0 D0 ; Safe retract Z to machine zero, cancel offset",
#             f"T=\"{tool.number}\" M06 ; Select tool {tool.number}",
#             "D1 ; Activate cutting edge offset 1", 
#             "G54",
#             f"S{int(tool.spindle_speed)} M3",
#         ]
#         if coolant:
#             lines.append("M08")
#         lines.append(f"G0 Z{safe_z:.3f} ; Rapid to safe Z")
#         return lines

#     def footer(self, coolant: bool = True) -> List[str]:
#         lines = []
#         if coolant:
#             lines.append("M09")
#         lines.extend([
#             "M05",
#             "SUPA G0 Z0 D0 ; Safe retract Z to machine zero, cancel offset",
#             "M30",
#         ])
#         return lines

# class HeidenhainISOPostProcessor(BasePostProcessor):
#     """Heidenhain ISO uses strict formatting, G71 for metric, and specific tool call syntax."""
    
#     def __init__(self):
#         super().__init__()
#         self.line_counter = 10

#     def next_line(self, cmd: str) -> str:
#         res = f"N{self.line_counter} {cmd} *"
#         self.line_counter += 10
#         return res

#     def header(self, safe_z: float, filename: str, units: str = "metric") -> List[str]:
#         self.line_counter = 10
#         g_unit = "G71" if units.lower() == "metric" else "G70"
#         return [
#             f"%0001 {g_unit} * ; Heidenhain ISO Start",
#             f"; Source File: {filename} *",
#             self.next_line("G30 G17 X+0 Y+0 Z-50"),
#             self.next_line("G31 G90 X+100 Y+100 Z+0"),
#         ]

#     def tool_change(self, tool: Union[Tool, ToolModel], safe_z: float, coolant: bool = True) -> List[str]:
#         lines = [
#             self.next_line("G00 G91 Z+0 M91 ; Safe Z retract"),
#             self.next_line("G90"),
#             self.next_line(f"T{tool.number} G17 S{int(tool.spindle_speed)} ; Tool Call"),
#         ]
#         if coolant:
#             lines.append(self.next_line("M08"))
#         lines.append(self.next_line(f"G00 Z{safe_z:+.3f}"))
#         return lines

#     def rapid(self, x: float = None, y: float = None, z: float = None) -> str:
#         cmd = "G00"
#         if x is not None: cmd += f" X{x:+.3f}"
#         if y is not None: cmd += f" Y{y:+.3f}"
#         if z is not None: cmd += f" Z{z:+.3f}"
#         return self.next_line(cmd)

#     def linear(self, x: float = None, y: float = None, z: float = None, f: float = None) -> str:
#         cmd = "G01"
#         if x is not None: cmd += f" X{x:+.3f}"
#         if y is not None: cmd += f" Y{y:+.3f}"
#         if z is not None: cmd += f" Z{z:+.3f}"
#         if f is not None: cmd += f" F{f:.1f}"
#         return self.next_line(cmd)

#     def footer(self, coolant: bool = True) -> List[str]:
#         lines = []
#         if coolant:
#             lines.append(self.next_line("M09"))
#         lines.extend([
#             self.next_line("M05"),
#             self.next_line("G00 G91 Z+0 M91"),
#             self.next_line("M30"),
#             "%0001 G71 *",
#         ])
#         return lines

# def get_post_processor(controller_type: str) -> BasePostProcessor:
#     dialects = {
#         "fanuc": BasePostProcessor,
#         "haas": BasePostProcessor,
#         "mazak": BasePostProcessor,
#         "mitsubishi": BasePostProcessor,
#         "siemens": SiemensPostProcessor,
#         "heidenhain": HeidenhainISOPostProcessor,
#     }
#     return dialects.get(controller_type.lower(), BasePostProcessor)()

# # ==============================================================================
# # CAM ENGINE (STEP NATIVE)
# # ==============================================================================

# # class GCodeGenerator:
# #     """
# #     Ingests a STEP file or shape, extracts planar topology, applies Tool Radius Compensation, 
# #     and routes toolpaths through the selected Machine Post-Processor.
# #     """

# #     def __init__(
# #         self,
# #         controller: str = "fanuc", 
# #         safe_z: float = 5.0,
# #         resolution: float = 0.5    
# #     ):
# #         self.controller = controller
# #         self.post = get_post_processor(controller)
# #         self.safe_z = safe_z
# #         self.resolution = resolution

# #     def _calculate_deviation_angle(
# #         self, 
# #         p1: Tuple[float, float], 
# #         p2: Tuple[float, float], 
# #         p3: Tuple[float, float]
# #     ) -> float:
# #         """Calculate the deviation angle (in radians) between vector p1->p2 and p2->p3."""
# #         v1 = (p2[0] - p1[0], p2[1] - p1[1])
# #         v2 = (p3[0] - p2[0], p3[1] - p2[1])
        
# #         len1 = math.hypot(*v1)
# #         len2 = math.hypot(*v2)
        
# #         if len1 < 1e-6 or len2 < 1e-6:
# #             return 0.0
            
# #         dot_product = v1[0] * v2[0] + v1[1] * v2[1]
# #         cos_theta = dot_product / (len1 * len2)
# #         cos_theta = max(-1.0, min(1.0, cos_theta))
# #         return math.acos(cos_theta)

# #     def generate(
# #         self, 
# #         input_data: Union[str, Path, Any, CAMJobRequest], 
# #         operations: List[Union[Operation, OperationModel]] = None, 
# #         step_path: Union[str, Path] = None
# #     ) -> Dict[str, Any]:
# #         """
# #         Main entry point. Supports two signatures:
# #         1. generate(request: CAMJobRequest, step_path: str = None)
# #         2. generate(input_data: Union[str, Path, Any], operations: List[Operation])
# #         """
# #         if isinstance(input_data, CAMJobRequest):
# #             request = input_data
# #             controller = request.machine_configuration.controller
# #             safe_z = request.machine_configuration.safe_z
# #             resolution = request.machine_configuration.resolution
# #             coolant = request.machine_configuration.coolant_active
# #             tools = request.tool_library
# #             ops = request.operations_pipeline
# #             target_path = step_path or request.step_file_path
# #         else:
# #             target_path = input_data
# #             ops = operations or []
# #             controller = getattr(self, "controller", "fanuc")
# #             safe_z = getattr(self, "safe_z", 5.0)
# #             resolution = getattr(self, "resolution", 0.5)
# #             coolant = getattr(self, "coolant", True)
# #             # Extract tools list from operations
# #             tools = []
# #             seen_tools = set()
# #             for op in ops:
# #                 tool_obj = getattr(op, "tool", None)
# #                 if tool_obj and tool_obj.number not in seen_tools:
# #                     tools.append(tool_obj)
# #                     seen_tools.add(tool_obj.number)

# #         # Align parameters
# #         self.post = get_post_processor(controller)
# #         self.safe_z = safe_z
# #         self.resolution = resolution

# #         filename = "Memory_Shape"
        
# #         # 1. Handle STEP File Ingestion
# #         if isinstance(target_path, (str, Path)):
# #             step_path_obj = Path(target_path)
# #             if not step_path_obj.exists():
# #                 return {"gcode": f"; ERROR: STEP file not found -> {step_path_obj}", "toolpaths": []}
            
# #             filename = step_path_obj.name
# #             try:
# #                 shape = import_step(str(step_path_obj))
# #             except Exception as e:
# #                 return {"gcode": f"; ERROR: Failed to parse STEP file: {str(e)}", "toolpaths": []}
# #         else:
# #             shape = target_path

# #         if not shape:
# #             return {"gcode": "; ERROR: No geometry input provided", "toolpaths": []}

# #         toolpaths: List[List[Tuple[float, float, float]]] = []
        
# #         # 2. Write Program Header (read units from first operation if available)
# #         initial_units = "metric"
# #         if ops:
# #             initial_units = getattr(ops[0], "units", "metric")
# #         gcode_lines: List[str] = self.post.header(self.safe_z, filename, units=initial_units)

# #         # 3. Extract Top-Down XY Faces from the STEP geometry
# #         planar_faces = []
# #         try:
# #             f_list = shape.faces() if callable(shape.faces) else shape.faces
# #             for f in f_list:
# #                 n = f.normal_at() if callable(f.normal_at) else f.normal_at
# #                 # Isolate faces flat on the XY plane
# #                 if abs(n.Z) > 0.99:
# #                     planar_faces.append(f)
# #         except Exception as e:
# #             gcode_lines.append(f"; ERROR: Face extraction failed: {str(e)}")

# #         if not planar_faces:
# #             gcode_lines.append("; WARNING: No valid XY planar faces found in STEP file.")
# #             gcode_lines.extend(self.post.footer(coolant=coolant))
# #             return {"gcode": "\n".join(gcode_lines), "toolpaths": []}

# #         # Keep track of active tool to minimize redundant tool changes
# #         current_tool_number = None

# #         # Build tools mapping dictionary
# #         tools_map = {t.number: t for t in tools}

# #         # 4. Process each operation sequentially
# #         for op_idx, op in enumerate(ops):
# #             # Resolve tool reference
# #             tool_num = getattr(op, "tool_number", None)
# #             if tool_num is None:
# #                 tool_obj = getattr(op, "tool", None)
# #                 tool_num = getattr(tool_obj, "number", None)
                
# #             tool = tools_map.get(tool_num)
# #             if not tool:
# #                 gcode_lines.append(f"; ERROR: Tool {tool_num} not found in library for Operation: {op.name}")
# #                 continue

# #             gcode_lines.append(f"\n; ===================================================")
# #             gcode_lines.append(f"; OPERATION {op_idx + 1}: {op.name} ({op.strategy.upper()})")
# #             gcode_lines.append(f"; Tool: T{tool.number} - Dia: {tool.diameter}mm - {tool.description}")
# #             gcode_lines.append(f"; ===================================================")

# #             # Tool change block - checks and suppresses redundant changes
# #             if tool.number != current_tool_number:
# #                 gcode_lines.extend(self.post.tool_change(tool, self.safe_z, coolant=coolant))
# #                 current_tool_number = tool.number

# #             # Apply tool radius offset based on strategy
# #             tool_radius = tool.diameter / 2.0
# #             offset_faces = []

# #             for face in planar_faces:
# #                 try:
# #                     if op.strategy == "profile":
# #                         offset_faces.extend(face.offset_2d(tool_radius).faces())
# #                     elif op.strategy == "pocket":
# #                         stepover = tool_radius * 0.8
# #                         current_offset = -tool_radius
# #                         pocket_passes = []
# #                         while True:
# #                             try:
# #                                 off = face.offset_2d(current_offset)
# #                                 off_faces = off.faces() if hasattr(off, "faces") else [off]
# #                                 if not off_faces:
# #                                     break
# #                                 area = sum(f.area for f in off_faces)
# #                                 if area < 1e-4:
# #                                     break
# #                                 pocket_passes.extend(off_faces)
# #                                 current_offset -= stepover
# #                                 if len(pocket_passes) > 20:  # Safety guard
# #                                     break
# #                             except Exception:
# #                                 break
# #                         if pocket_passes:
# #                             offset_faces.extend(pocket_passes)
# #                         else:
# #                             offset_faces.append(face)
# #                     elif op.strategy == "engrave":
# #                         offset_faces.append(face)
# #                     else:
# #                         offset_faces.append(face)
# #                 except Exception:
# #                     offset_faces.append(face)

# #             # Extract wires
# #             wires = []
# #             for f in offset_faces:
# #                 if hasattr(f, "outer_wire"):
# #                     wires.append(f.outer_wire())
# #                 elif hasattr(f, "wires"):
# #                     wires.extend(f.wires() if callable(f.wires) else f.wires)
# #                 elif hasattr(f, "wrapped") and f.wrapped.ShapeType() == 2:  # TopoDS_Wire
# #                     wires.append(f)

# #             # Generate toolpaths
# #             for wire_idx, wire in enumerate(wires):
# #                 points_2d: List[Tuple[float, float]] = []
                
# #                 # Dynamic edge-by-edge geometry evaluation
# #                 edges = []
# #                 if hasattr(wire, "edges"):
# #                     edges = wire.edges() if callable(wire.edges) else wire.edges

# #                 if edges:
# #                     for edge in edges:
# #                         geom_type = "LINE"
# #                         try:
# #                             geom_type = str(edge.geom_type).upper()
# #                         except Exception:
# #                             pass
                        
# #                         try:
# #                             if "LINE" in geom_type:
# #                                 # Pure straight line -> exactly 2 points (start/end)
# #                                 p_start = edge.position_at(0.0)
# #                                 p_end = edge.position_at(1.0)
# #                                 if not points_2d or math.hypot(points_2d[-1][0] - p_start.X, points_2d[-1][1] - p_start.Y) > 1e-4:
# #                                     points_2d.append((p_start.X, p_start.Y))
# #                                 points_2d.append((p_end.X, p_end.Y))
# #                             else:
# #                                 # Curved shape -> sample dynamically based on resolution
# #                                 edge_len = edge.length if not callable(edge.length) else edge.length()
# #                                 steps = max(4, int(edge_len / self.resolution))
# #                                 for s in range(steps + 1):
# #                                     t = s / float(steps)
# #                                     pt = edge.position_at(t)
# #                                     if not points_2d or math.hypot(points_2d[-1][0] - pt.X, points_2d[-1][1] - pt.Y) > 1e-4:
# #                                         points_2d.append((pt.X, pt.Y))
# #                         except Exception:
# #                             try:
# #                                 v_start = edge.position_at(0.0)
# #                                 v_end = edge.position_at(1.0)
# #                                 points_2d.append((v_start.X, v_start.Y))
# #                                 points_2d.append((v_end.X, v_end.Y))
# #                             except Exception:
# #                                 pass
                
# #                 # Fallback to standard wire sampling if edge-by-edge resulted in empty list
# #                 if not points_2d:
# #                     try:
# #                         length = wire.length if not callable(wire.length) else wire.length()
# #                         steps = max(4, int(length / self.resolution))
# #                         for s in range(steps + 1):
# #                             t = s / float(steps)
# #                             pt = wire.position_at(t) if hasattr(wire, "position_at") else (wire @ t)
# #                             points_2d.append((pt.X, pt.Y))
# #                     except Exception:
# #                         try:
# #                             verts = wire.vertices() if callable(wire.vertices) else wire.vertices
# #                             points_2d = [(v.X, v.Y) for v in verts]
# #                             if points_2d:
# #                                 points_2d.append(points_2d[0])
# #                         except Exception:
# #                             continue

# #                 if not points_2d or len(points_2d) < 2:
# #                     continue

# #                 gcode_lines.append(f"\n; --- Wire/Contour {wire_idx + 1} ---")
# #                 num_passes = max(1, int(math.ceil(op.cutting_depth / op.stepdown)))

# #                 # Determine operational slowdown factor
# #                 slowdown_factor = getattr(op, "corner_slowdown_factor", None)
# #                 if slowdown_factor is None:
# #                     slowdown_factor = getattr(op, "corner_slowdown", 0.5)

# #                 for pass_idx in range(num_passes):
# #                     prev_z = 0.0 if pass_idx == 0 else -min(pass_idx * op.stepdown, op.cutting_depth)
# #                     current_z = -min((pass_idx + 1) * op.stepdown, op.cutting_depth)
# #                     gcode_lines.append(f"; Pass {pass_idx + 1} (Z={current_z:.3f})")

# #                     start_x, start_y = points_2d[0]
# #                     ramp_x, ramp_y = points_2d[1]

# #                     # Ramping Entry Plunge implementation
# #                     if pass_idx == 0:
# #                         # Rapid move to start XY coordinates
# #                         gcode_lines.append(self.post.rapid(x=start_x, y=start_y))
# #                         # Linear move down to Z=0.0 (prev_z)
# #                         gcode_lines.append(self.post.linear(z=prev_z, f=tool.plunge_rate))
# #                         # Ramp Z down simultaneously during first X-Y move segment
# #                         gcode_lines.append(self.post.linear(x=ramp_x, y=ramp_y, z=current_z, f=tool.plunge_rate))
# #                     else:
# #                         # Ramps down along the first segment from previous pass depth without retract
# #                         gcode_lines.append(self.post.linear(x=ramp_x, y=ramp_y, z=current_z, f=tool.plunge_rate))

# #                     current_pass_path: List[Tuple[float, float, float]] = [
# #                         (start_x, start_y, prev_z),
# #                         (ramp_x, ramp_y, current_z)
# #                     ]

# #                     # Complete the rest of the cut at full cutting feed rate
# #                     for i in range(2, len(points_2d)):
# #                         pt = points_2d[i]
# #                         feed = tool.feed_rate
                        
# #                         if i < len(points_2d) - 1:
# #                             p_prev = points_2d[i - 1]
# #                             p_curr = pt
# #                             p_next = points_2d[i + 1]
# #                             theta = self._calculate_deviation_angle(p_prev, p_curr, p_next)
                            
# #                             # 30 degrees threshold warning and slowdown trigger
# #                             if theta > (30.0 * math.pi / 180.0):
# #                                 gcode_lines.append(f"; WARNING: Sharp corner detected ({math.degrees(theta):.1f} deg). Decelerating.")
# #                                 feed = tool.feed_rate * slowdown_factor

# #                         gcode_lines.append(self.post.linear(x=pt[0], y=pt[1], f=feed))
# #                         current_pass_path.append((pt[0], pt[1], current_z))

# #                     toolpaths.append(current_pass_path)

# #                 # Safe retract rapid Z-move only when the entire wire contour loop is complete
# #                 gcode_lines.append(self.post.rapid(z=self.safe_z))

# #         # 5. Write Program Footer
# #         gcode_lines.extend([""])
# #         gcode_lines.extend(self.post.footer(coolant=coolant))

# #         return {
# #             "gcode": "\n".join(gcode_lines),
# #             "toolpaths": toolpaths,
# #         }

# class GCodeGenerator:
#     """
#     Ingests a STEP file or shape, extracts planar topology for 2.5D, 
#     or utilizes raycasting (Drop Cutter) for true 3D surfacing, 
#     and routes toolpaths through the selected Machine Post-Processor.
#     """

#     def __init__(
#         self,
#         controller: str = "fanuc", 
#         safe_z: float = 5.0,
#         resolution: float = 0.5    
#     ):
#         self.controller = controller
#         self.post = get_post_processor(controller)
#         self.safe_z = safe_z
#         self.resolution = resolution

#     def _calculate_deviation_angle(
#         self, 
#         p1: Tuple[float, float], 
#         p2: Tuple[float, float], 
#         p3: Tuple[float, float]
#     ) -> float:
#         """Calculate the deviation angle (in radians) between vector p1->p2 and p2->p3."""
#         v1 = (p2[0] - p1[0], p2[1] - p1[1])
#         v2 = (p3[0] - p2[0], p3[1] - p2[1])
        
#         len1 = math.hypot(*v1)
#         len2 = math.hypot(*v2)
        
#         if len1 < 1e-6 or len2 < 1e-6:
#             return 0.0
            
#         dot_product = v1[0] * v2[0] + v1[1] * v2[1]
#         cos_theta = dot_product / (len1 * len2)
#         cos_theta = max(-1.0, min(1.0, cos_theta))
#         return math.acos(cos_theta)

#     def generate(
#         self, 
#         input_data: Union[str, Path, Any, CAMJobRequest], 
#         operations: List[Union[Operation, OperationModel]] = None, 
#         step_path: Union[str, Path] = None
#     ) -> Dict[str, Any]:
        
#         if isinstance(input_data, CAMJobRequest):
#             request = input_data
#             controller = request.machine_configuration.controller
#             safe_z = request.machine_configuration.safe_z
#             resolution = request.machine_configuration.resolution
#             coolant = request.machine_configuration.coolant_active
#             tools = request.tool_library
#             ops = request.operations_pipeline
#             target_path = step_path or request.step_file_path
#         else:
#             target_path = input_data
#             ops = operations or []
#             controller = getattr(self, "controller", "fanuc")
#             safe_z = getattr(self, "safe_z", 5.0)
#             resolution = getattr(self, "resolution", 0.5)
#             coolant = getattr(self, "coolant", True)
            
#             tools = []
#             seen_tools = set()
#             for op in ops:
#                 tool_obj = getattr(op, "tool", None)
#                 if tool_obj and tool_obj.number not in seen_tools:
#                     tools.append(tool_obj)
#                     seen_tools.add(tool_obj.number)

#         self.post = get_post_processor(controller)
#         self.safe_z = safe_z
#         self.resolution = resolution
#         filename = "Memory_Shape"
        
#         if isinstance(target_path, (str, Path)):
#             step_path_obj = Path(target_path)
#             if not step_path_obj.exists():
#                 return {"gcode": f"; ERROR: STEP file not found -> {step_path_obj}", "toolpaths": []}
            
#             filename = step_path_obj.name
#             try:
#                 shape = import_step(str(step_path_obj))
#             except Exception as e:
#                 return {"gcode": f"; ERROR: Failed to parse STEP file: {str(e)}", "toolpaths": []}
#         else:
#             shape = target_path

#         if not shape:
#             return {"gcode": "; ERROR: No geometry input provided", "toolpaths": []}

#         toolpaths: List[List[Tuple[float, float, float]]] = []
        
#         initial_units = "metric"
#         if ops:
#             initial_units = getattr(ops[0], "units", "metric")
#         gcode_lines: List[str] = self.post.header(self.safe_z, filename, units=initial_units)

#         # Retrieve bounding box for 3D surfacing calculations
#         bbox = shape.bounding_box()

#         current_tool_number = None
#         tools_map = {t.number: t for t in tools}

#         for op_idx, op in enumerate(ops):
#             tool_num = getattr(op, "tool_number", None)
#             if tool_num is None:
#                 tool_obj = getattr(op, "tool", None)
#                 tool_num = getattr(tool_obj, "number", None)
                
#             tool = tools_map.get(tool_num)
#             if not tool:
#                 gcode_lines.append(f"; ERROR: Tool {tool_num} not found in library for Operation: {op.name}")
#                 continue

#             gcode_lines.append(f"\n; ===================================================")
#             gcode_lines.append(f"; OPERATION {op_idx + 1}: {op.name} ({op.strategy.upper()})")
#             gcode_lines.append(f"; Tool: T{tool.number} - Dia: {tool.diameter}mm - {tool.description}")
#             gcode_lines.append(f"; ===================================================")

#             if tool.number != current_tool_number:
#                 gcode_lines.extend(self.post.tool_change(tool, self.safe_z, coolant=coolant))
#                 current_tool_number = tool.number

#             tool_radius = tool.diameter / 2.0

#             # ------------------------------------------------------------------
#             # STRATEGY: 3D SURFACING (DROP CUTTER)
#             # ------------------------------------------------------------------
#             if op.strategy == "surface":
#                 stepover = tool.diameter * 0.4  # 40% stepover for 3D surfacing
                
#                 # Setup raster grid based on bounding box
#                 y_current = bbox.min.Y
#                 direction = 1 # 1 for positive X, -1 for negative X (Zig-Zag)
                
#                 gcode_lines.append("; Beginning 3D Parallel Surfacing")
                
#                 # Generate Raycasting grid
#                 while y_current <= bbox.max.Y:
#                     x_start = bbox.min.X if direction == 1 else bbox.max.X
#                     x_end = bbox.max.X if direction == 1 else bbox.min.X
                    
#                     # Calculate number of steps across X
#                     x_dist = abs(x_end - x_start)
#                     x_steps = max(2, int(x_dist / self.resolution))
                    
#                     current_pass_path = []
                    
#                     for step in range(x_steps + 1):
#                         fraction = step / float(x_steps)
#                         x_current = x_start + (x_end - x_start) * fraction
                        
#                         # Shoot Ray from above the safe Z straight down through the part
#                         ray = Edge.make_line(
#                             (x_current, y_current, bbox.max.Z + 10.0), 
#                             (x_current, y_current, bbox.min.Z - 10.0)
#                         )
                        
#                         # Find intersection
#                         try:
#                             intersection = shape.intersect(ray)
#                             if intersection:
#                                 # Get highest Z point from intersection vertices
#                                 vertices = intersection.vertices() if callable(intersection.vertices) else intersection.vertices
#                                 z_hit = max(v.Z for v in vertices)
                                
#                                 # Offset tool radius assuming Ball-Nose endmill for surfacing
#                                 z_target = z_hit + tool_radius
#                             else:
#                                 # Tool drops to cutting depth if off the edge of the part
#                                 z_target = bbox.min.Z
#                         except Exception:
#                             z_target = bbox.min.Z

#                         # Write G-code
#                         feed = tool.feed_rate if step > 0 else tool.plunge_rate
#                         gcode_lines.append(self.post.linear(x=x_current, y=y_current, z=z_target, f=feed))
#                         current_pass_path.append((x_current, y_current, z_target))
                        
#                     toolpaths.append(current_pass_path)
                    
#                     y_current += stepover
#                     direction *= -1 # Flip direction for zig-zag
                    
#                 gcode_lines.append(self.post.rapid(z=self.safe_z))

#             # ------------------------------------------------------------------
#             # STRATEGY: 2.5D PROFILING / POCKETING
#             # ------------------------------------------------------------------
#             elif op.strategy in ["profile", "pocket", "engrave"]:
#                 planar_faces = []
#                 try:
#                     f_list = shape.faces() if callable(shape.faces) else shape.faces
#                     for f in f_list:
#                         n = f.normal_at() if callable(f.normal_at) else f.normal_at
#                         if abs(n.Z) > 0.99:
#                             planar_faces.append(f)
#                 except Exception as e:
#                     gcode_lines.append(f"; ERROR: Face extraction failed: {str(e)}")

#                 offset_faces = []
#                 for face in planar_faces:
#                     try:
#                         if op.strategy == "profile":
#                             offset_faces.extend(face.offset_2d(tool_radius).faces())
#                         elif op.strategy == "pocket":
#                             stepover = tool_radius * 0.8
#                             current_offset = -tool_radius
#                             pocket_passes = []
#                             while True:
#                                 try:
#                                     off = face.offset_2d(current_offset)
#                                     off_faces = off.faces() if hasattr(off, "faces") else [off]
#                                     if not off_faces: break
#                                     area = sum(f.area for f in off_faces)
#                                     if area < 1e-4: break
#                                     pocket_passes.extend(off_faces)
#                                     current_offset -= stepover
#                                     if len(pocket_passes) > 20: break
#                                 except Exception:
#                                     break
#                             if pocket_passes:
#                                 offset_faces.extend(pocket_passes)
#                             else:
#                                 offset_faces.append(face)
#                         else:
#                             offset_faces.append(face)
#                     except Exception:
#                         offset_faces.append(face)

#                 wires = []
#                 for f in offset_faces:
#                     if hasattr(f, "outer_wire"):
#                         wires.append(f.outer_wire())
#                     elif hasattr(f, "wires"):
#                         wires.extend(f.wires() if callable(f.wires) else f.wires)
#                     elif hasattr(f, "wrapped") and f.wrapped.ShapeType() == 2:  
#                         wires.append(f)

#                 for wire_idx, wire in enumerate(wires):
#                     points_2d: List[Tuple[float, float]] = []
                    
#                     edges = []
#                     if hasattr(wire, "edges"):
#                         edges = wire.edges() if callable(wire.edges) else wire.edges

#                     if edges:
#                         for edge in edges:
#                             geom_type = "LINE"
#                             try:
#                                 geom_type = str(edge.geom_type).upper()
#                             except Exception: pass
                            
#                             try:
#                                 if "LINE" in geom_type:
#                                     p_start = edge.position_at(0.0)
#                                     p_end = edge.position_at(1.0)
#                                     if not points_2d or math.hypot(points_2d[-1][0] - p_start.X, points_2d[-1][1] - p_start.Y) > 1e-4:
#                                         points_2d.append((p_start.X, p_start.Y))
#                                     points_2d.append((p_end.X, p_end.Y))
#                                 else:
#                                     edge_len = edge.length if not callable(edge.length) else edge.length()
#                                     steps = max(4, int(edge_len / self.resolution))
#                                     for s in range(steps + 1):
#                                         t = s / float(steps)
#                                         pt = edge.position_at(t)
#                                         if not points_2d or math.hypot(points_2d[-1][0] - pt.X, points_2d[-1][1] - pt.Y) > 1e-4:
#                                             points_2d.append((pt.X, pt.Y))
#                             except Exception:
#                                 try:
#                                     v_start = edge.position_at(0.0)
#                                     v_end = edge.position_at(1.0)
#                                     points_2d.append((v_start.X, v_start.Y))
#                                     points_2d.append((v_end.X, v_end.Y))
#                                 except Exception: pass
                    
#                     if not points_2d:
#                         try:
#                             length = wire.length if not callable(wire.length) else wire.length()
#                             steps = max(4, int(length / self.resolution))
#                             for s in range(steps + 1):
#                                 t = s / float(steps)
#                                 pt = wire.position_at(t) if hasattr(wire, "position_at") else (wire @ t)
#                                 points_2d.append((pt.X, pt.Y))
#                         except Exception:
#                             try:
#                                 verts = wire.vertices() if callable(wire.vertices) else wire.vertices
#                                 points_2d = [(v.X, v.Y) for v in verts]
#                                 if points_2d: points_2d.append(points_2d[0])
#                             except Exception: continue

#                     if not points_2d or len(points_2d) < 2: continue

#                     gcode_lines.append(f"\n; --- Wire/Contour {wire_idx + 1} ---")
#                     num_passes = max(1, int(math.ceil(op.cutting_depth / op.stepdown)))
#                     slowdown_factor = getattr(op, "corner_slowdown_factor", getattr(op, "corner_slowdown", 0.5))

#                     for pass_idx in range(num_passes):
#                         prev_z = 0.0 if pass_idx == 0 else -min(pass_idx * op.stepdown, op.cutting_depth)
#                         current_z = -min((pass_idx + 1) * op.stepdown, op.cutting_depth)
#                         gcode_lines.append(f"; Pass {pass_idx + 1} (Z={current_z:.3f})")

#                         start_x, start_y = points_2d[0]
#                         ramp_x, ramp_y = points_2d[1]

#                         if pass_idx == 0:
#                             gcode_lines.append(self.post.rapid(x=start_x, y=start_y))
#                             gcode_lines.append(self.post.linear(z=prev_z, f=tool.plunge_rate))
#                             gcode_lines.append(self.post.linear(x=ramp_x, y=ramp_y, z=current_z, f=tool.plunge_rate))
#                         else:
#                             gcode_lines.append(self.post.linear(x=ramp_x, y=ramp_y, z=current_z, f=tool.plunge_rate))

#                         current_pass_path = [(start_x, start_y, prev_z), (ramp_x, ramp_y, current_z)]

#                         for i in range(2, len(points_2d)):
#                             pt = points_2d[i]
#                             feed = tool.feed_rate
                            
#                             if i < len(points_2d) - 1:
#                                 theta = self._calculate_deviation_angle(points_2d[i - 1], pt, points_2d[i + 1])
#                                 if theta > (30.0 * math.pi / 180.0):
#                                     gcode_lines.append(f"; WARNING: Sharp corner detected ({math.degrees(theta):.1f} deg). Decelerating.")
#                                     feed = tool.feed_rate * slowdown_factor

#                             gcode_lines.append(self.post.linear(x=pt[0], y=pt[1], f=feed))
#                             current_pass_path.append((pt[0], pt[1], current_z))

#                         toolpaths.append(current_pass_path)

#                     gcode_lines.append(self.post.rapid(z=self.safe_z))

#         gcode_lines.extend(["", "; --- End of Program ---"])
#         gcode_lines.extend(self.post.footer(coolant=coolant))

#         return {
#             "gcode": "\n".join(gcode_lines),
#             "toolpaths": toolpaths,
#         }

import math
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union

from build123d import import_step, Face, Wire, Location, Edge, Vector, Vertex, Compound
from OCP.BRepAdaptor import BRepAdaptor_Curve
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
# FEATURE RECOGNITION (HOLES & SHAPES)
# ==============================================================================

class HoleFeature:
    def __init__(self, diameter: float, location: Tuple[float, float, float], depth: float):
        self.diameter = diameter
        self.location = location
        self.depth = depth

class FeatureRecognizer:
    @staticmethod
    def extract_holes(shape: Any) -> List[HoleFeature]:
        holes = []
        try:
            faces = shape.faces() if callable(shape.faces) else shape.faces
            for face in faces:
                try:
                    # Look for perfectly circular, closed internal wires
                    outer_wire = face.outer_wire() if callable(face.outer_wire) else face.outer_wire
                    wires_list = face.wires() if callable(face.wires) else face.wires
                    inner_wires = [w for w in wires_list if w != outer_wire]
                    for wire in inner_wires:
                        edges = wire.edges() if callable(wire.edges) else wire.edges
                        if len(edges) in [1, 2]: # CAD uses 1 or 2 edges for full circles
                            try:
                                bbox = wire.bounding_box()
                                dx = bbox.max.X - bbox.min.X
                                dy = bbox.max.Y - bbox.min.Y
                                if abs(dx - dy) < 1e-3: # It's a perfect circle
                                    radius = dx / 2.0
                                    center_x = bbox.min.X + radius
                                    center_y = bbox.min.Y + radius
                                    z_val = bbox.min.Z
                                    
                                    # Deduplicate shared center-points
                                    duplicate = False
                                    for h in holes:
                                        if math.hypot(h.location[0] - center_x, h.location[1] - center_y) < 1e-3 and abs(h.diameter - (radius*2)) < 1e-3:
                                            duplicate = True
                                            break
                                    
                                    if not duplicate:
                                        # Fallback depth if actual cylinder depth isn't easily reachable
                                        holes.append(HoleFeature(radius * 2, (center_x, center_y, z_val), 10.0))
                            except Exception:
                                pass
                except Exception:
                    pass
        except Exception as e:
            print(f"Hole Recognition Error: {e}")
        return holes

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

    def arc(self, x: float, y: float, i: float, j: float, direction: str = "G2", z: float = None, f: float = None) -> str:
        """Generates G2 (CW) or G3 (CCW) Circular Interpolation."""
        cmd = f"{direction} X{x:.3f} Y{y:.3f} I{i:.3f} J{j:.3f}"
        if z is not None: cmd += f" Z{z:.3f}"
        if f is not None: cmd += f" F{f:.1f}"
        return cmd

    def drill_canned(self, x: float, y: float, z: float, r: float, q: float = None, f: float = None) -> str:
        """Generates G81 or G83 deep-hole canned cycle."""
        if q is not None and q > 0:
            cmd = f"G83 X{x:.3f} Y{y:.3f} Z{z:.3f} R{r:.3f} Q{q:.3f}"
        else:
            cmd = f"G81 X{x:.3f} Y{y:.3f} Z{z:.3f} R{r:.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return cmd

    def drill_point(self, x: float, y: float) -> str:
        """Generates coordinate-only canned cycle call for subsequent holes."""
        return f"X{x:.3f} Y{y:.3f}"

    def drill_cancel(self) -> str:
        """Cancels the canned cycle (G80)."""
        return "G80"

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
        if coolant: lines.append("M08")
        lines.append(f"G0 Z{safe_z:.3f} ; Rapid to safe Z")
        return lines

    def drill_canned(self, x: float, y: float, z: float, r: float, q: float = None, f: float = None) -> str:
        """Siemens uses MCALL CYCLE81/83 followed by the coordinate positioning."""
        if q is not None and q > 0:
            cycle = f"CYCLE83({r:.3f}, 0.0, 2.0, {z:.3f}, , {q:.3f}, , , , , 1.0, 1)"
        else:
            cycle = f"CYCLE81({r:.3f}, 0.0, 2.0, {z:.3f}, )"
        return f"MCALL {cycle}\nG0 X{x:.3f} Y{y:.3f}"

    def drill_point(self, x: float, y: float) -> str:
        """Trigger cycle at a new point."""
        return f"G0 X{x:.3f} Y{y:.3f}"

    def drill_cancel(self) -> str:
        """Cancel Siemens modal cycle."""
        return "MCALL"

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant: lines.append("M09")
        lines.extend(["M05", "SUPA G0 Z0 D0 ; Safe retract Z to machine zero, cancel offset", "M30"])
        return lines

class HeidenhainISOPostProcessor(BasePostProcessor):
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
        if coolant: lines.append(self.next_line("M08"))
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

    def arc(self, x: float, y: float, i: float, j: float, direction: str = "G02", z: float = None, f: float = None) -> str:
        direction = "G02" if direction in ["G2", "G02"] else "G03"
        cmd = f"{direction} X{x:+.3f} Y{y:+.3f} I{i:+.3f} J{j:+.3f}"
        if z is not None: cmd += f" Z{z:+.3f}"
        if f is not None: cmd += f" F{f:.1f}"
        return self.next_line(cmd)

    def drill_canned(self, x: float, y: float, z: float, r: float, q: float = None, f: float = None) -> str:
        if q is not None and q > 0:
            cmd = f"G83 X{x:+.3f} Y{y:+.3f} Z{z:+.3f} R{r:+.3f} Q{q:.3f}"
        else:
            cmd = f"G81 X{x:+.3f} Y{y:+.3f} Z{z:+.3f} R{r:+.3f}"
        if f is not None:
            cmd += f" F{f:.1f}"
        return self.next_line(cmd)

    def drill_point(self, x: float, y: float) -> str:
        return self.next_line(f"X{x:+.3f} Y{y:+.3f}")

    def drill_cancel(self) -> str:
        return self.next_line("G80")

    def footer(self, coolant: bool = True) -> List[str]:
        lines = []
        if coolant: lines.append(self.next_line("M09"))
        lines.extend([self.next_line("M05"), self.next_line("G00 G91 Z+0 M91"), self.next_line("M30"), "%0001 G71 *"])
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
    Ingests a STEP file or shape, extracts planar topology for 2.5D, 
    or utilizes raycasting for true 3D surfacing, 
    and routes toolpaths through the selected Machine Post-Processor.
    """

    def __init__(self, controller: str = "fanuc", safe_z: float = 5.0, resolution: float = 0.5):
        self.controller = controller
        self.post = get_post_processor(controller)
        self.safe_z = safe_z
        self.resolution = resolution

    def _calculate_deviation_angle(self, p1: Tuple[float, float], p2: Tuple[float, float], p3: Tuple[float, float]) -> float:
        v1 = (p2[0] - p1[0], p2[1] - p1[1])
        v2 = (p3[0] - p2[0], p3[1] - p2[1])
        len1, len2 = math.hypot(*v1), math.hypot(*v2)
        if len1 < 1e-6 or len2 < 1e-6: return 0.0
        dot_product = v1[0] * v2[0] + v1[1] * v2[1]
        return math.acos(max(-1.0, min(1.0, dot_product / (len1 * len2))))
        
    def _get_z_hit(self, shape, x, y, z_high, z_low):
        """Shoots a ray down the Z axis and returns the highest intersection point."""
        ray = Edge.make_line((x, y, z_high), (x, y, z_low))
        try:
            intersection = shape.intersect(ray)
            if intersection:
                vertices = intersection.vertices() if callable(intersection.vertices) else intersection.vertices
                return max(v.Z for v in vertices)
        except Exception:
            pass
        return z_low

    def generate(self, input_data: Union[str, Path, Any, CAMJobRequest], operations: List[Union[Operation, OperationModel]] = None, step_path: Union[str, Path] = None) -> Dict[str, Any]:
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
            
            tools = []
            seen_tools = set()
            for op in ops:
                tool_obj = getattr(op, "tool", None)
                if tool_obj and tool_obj.number not in seen_tools:
                    tools.append(tool_obj)
                    seen_tools.add(tool_obj.number)

        self.post = get_post_processor(controller)
        self.safe_z = safe_z
        self.resolution = resolution
        filename = "Memory_Shape"
        
        # 1. Handle STEP File Ingestion
        if isinstance(target_path, (str, Path)):
            step_path_obj = Path(target_path)
            if not step_path_obj.exists(): return {"gcode": f"; ERROR: STEP file not found -> {step_path_obj}", "toolpaths": []}
            filename = step_path_obj.name
            try: shape = import_step(str(step_path_obj))
            except Exception as e: return {"gcode": f"; ERROR: Failed to parse STEP file: {str(e)}", "toolpaths": []}
        else:
            shape = target_path

        if shape is None:
            return {"gcode": "; ERROR: No geometry input provided", "toolpaths": []}
        if hasattr(shape, "wrapped") and shape.wrapped is None:
            return {"gcode": "; ERROR: No geometry input provided (wrapped shape is None)", "toolpaths": []}
        try:
            if not shape:
                return {"gcode": "; ERROR: No geometry input provided", "toolpaths": []}
        except Exception as e:
            return {"gcode": f"; ERROR: Invalid geometry input: {str(e)}", "toolpaths": []}

        # toolpaths strictly mapped to List[List[Tuple[float, float, float]]] for Pydantic Schema UI
        toolpaths: List[List[Tuple[float, float, float]]] = []
        
        initial_units = getattr(ops[0], "units", "metric") if ops else "metric"
        gcode_lines: List[str] = self.post.header(self.safe_z, filename, units=initial_units)

        try: bbox = shape.bounding_box()
        except Exception: bbox = None

        current_tool_number = None
        tools_map = {t.number: t for t in tools}

        # 2. Process each operation sequentially
        for op_idx, op in enumerate(ops):
            tool_num = getattr(op, "tool_number", None) or getattr(getattr(op, "tool", None), "number", None)
            tool = tools_map.get(tool_num)
            if not tool: continue

            gcode_lines.extend([
                f"\n; ===================================================",
                f"; OPERATION {op_idx + 1}: {op.name} ({op.strategy.upper()})",
                f"; Tool: T{tool.number} - Dia: {tool.diameter}mm - {tool.description}",
                f"; ==================================================="
            ])

            if tool.number != current_tool_number:
                gcode_lines.extend(self.post.tool_change(tool, self.safe_z, coolant=coolant))
                current_tool_number = tool.number

            tool_radius = tool.diameter / 2.0

            # ------------------------------------------------------------------
            # STRATEGY: 3D SURFACING (DROP CUTTER) - TOOL AWARE
            # ------------------------------------------------------------------
            if op.strategy == "surface":
                if not bbox:
                    gcode_lines.append("; ERROR: Bounding box calculation failed. Cannot execute surface strategy.")
                    continue
                    
                stepover = tool.diameter * 0.4 
                y_current = bbox.min.Y
                direction = 1 
                is_flat_endmill = "flat" in tool.description.lower() or "bull" in tool.description.lower()
                
                gcode_lines.append(f"; Beginning 3D Surfacing ({'Flat/Bullnose' if is_flat_endmill else 'Ballnose'} calculation)")
                
                while y_current <= bbox.max.Y:
                    x_start = bbox.min.X if direction == 1 else bbox.max.X
                    x_end = bbox.max.X if direction == 1 else bbox.min.X
                    
                    x_dist = abs(x_end - x_start)
                    x_steps = max(2, int(x_dist / self.resolution))
                    current_pass_path = []
                    
                    for step in range(x_steps + 1):
                        x_current = x_start + (x_end - x_start) * (step / float(x_steps))
                        
                        z_high = bbox.max.Z + 10.0
                        z_low = bbox.min.Z - 10.0
                        z_hit = self._get_z_hit(shape, x_current, y_current, z_high, z_low)

                        # FIX 7: Tool Type Surfacing Logic
                        if is_flat_endmill:
                            # 5-Ray burst to prevent flat tool corner gouging
                            z_n = self._get_z_hit(shape, x_current, y_current + tool_radius, z_high, z_low)
                            z_s = self._get_z_hit(shape, x_current, y_current - tool_radius, z_high, z_low)
                            z_e = self._get_z_hit(shape, x_current + tool_radius, y_current, z_high, z_low)
                            z_w = self._get_z_hit(shape, x_current - tool_radius, y_current, z_high, z_low)
                            z_target = max(z_hit, z_n, z_s, z_e, z_w) 
                        else:
                            # Standard Ballnose calculation
                            z_target = z_hit + tool_radius

                        feed = tool.feed_rate if step > 0 else tool.plunge_rate
                        gcode_lines.append(self.post.linear(x=x_current, y=y_current, z=z_target, f=feed))
                        current_pass_path.append((x_current, y_current, z_target))
                        
                    toolpaths.append(current_pass_path)
                    y_current += stepover
                    direction *= -1
                    
                gcode_lines.append(self.post.rapid(z=self.safe_z))

            # ------------------------------------------------------------------
            # STRATEGY: DRILLING (CANNED CYCLES)
            # ------------------------------------------------------------------
            elif op.strategy == "drill":
                holes = FeatureRecognizer.extract_holes(shape)
                if not holes:
                    gcode_lines.append("; WARNING: No holes recognized for drilling operation.")
                    continue
                
                gcode_lines.append(f"; Found {len(holes)} holes for drilling")
                
                for hole_idx, hole in enumerate(holes):
                    hx, hy, hz = hole.location
                    target_z = hz - op.cutting_depth
                    retract_z = hz + 2.0  # R plane is 2mm above the hole top
                    q_val = op.stepdown if op.stepdown < op.cutting_depth else None
                    
                    gcode_lines.append(f"; Hole {hole_idx + 1}: Dia {hole.diameter:.3f}mm at X{hx:.3f} Y{hy:.3f} Z{hz:.3f}")
                    
                    # Tool path simulation coordinates for frontend preview
                    path = [
                        (hx, hy, self.safe_z),
                        (hx, hy, retract_z),
                        (hx, hy, target_z),
                        (hx, hy, self.safe_z)
                    ]
                    toolpaths.append(path)
                    
                    if hole_idx == 0:
                        gcode_lines.append(self.post.drill_canned(x=hx, y=hy, z=target_z, r=retract_z, q=q_val, f=tool.feed_rate))
                    else:
                        gcode_lines.append(self.post.drill_point(x=hx, y=hy))
                
                gcode_lines.append(self.post.drill_cancel())
                gcode_lines.append(self.post.rapid(z=self.safe_z))

            # ------------------------------------------------------------------
            # STRATEGY: FACING (RASTER MILLING)
            # ------------------------------------------------------------------
            elif op.strategy == "face":
                if not bbox:
                    gcode_lines.append("; ERROR: Bounding box calculation failed. Cannot execute face strategy.")
                    continue
                
                stepover = tool.diameter * 0.75
                x_min = bbox.min.X - tool_radius
                x_max = bbox.max.X + tool_radius
                y_min = bbox.min.Y - tool_radius
                y_max = bbox.max.Y + tool_radius
                
                gcode_lines.append("; Beginning Face Milling (Raster)")
                
                num_passes = max(1, int(math.ceil(op.cutting_depth / op.stepdown)))
                
                for pass_idx in range(num_passes):
                    current_z = -min((pass_idx + 1) * op.stepdown, op.cutting_depth)
                    gcode_lines.append(f"; Pass {pass_idx + 1} (Z={current_z:.3f})")
                    
                    y_current = y_min
                    direction = 1
                    
                    while y_current <= y_max:
                        x_start = x_min if direction == 1 else x_max
                        x_end = x_max if direction == 1 else x_min
                        
                        pass_path = []
                        if y_current == y_min:
                            gcode_lines.append(self.post.rapid(z=self.safe_z))
                            gcode_lines.append(self.post.rapid(x=x_start, y=y_current))
                            gcode_lines.append(self.post.linear(z=current_z, f=tool.plunge_rate))
                            pass_path.append((x_start, y_current, self.safe_z))
                            pass_path.append((x_start, y_current, current_z))
                        else:
                            gcode_lines.append(self.post.linear(x=x_start, y=y_current, f=tool.feed_rate))
                            pass_path.append((x_start, y_current, current_z))
                        
                        gcode_lines.append(self.post.linear(x=x_end, y=y_current, f=tool.feed_rate))
                        pass_path.append((x_end, y_current, current_z))
                        toolpaths.append(pass_path)
                        
                        y_current += stepover
                        direction *= -1
                        
                    gcode_lines.append(self.post.rapid(z=self.safe_z))

            # ------------------------------------------------------------------
            # STRATEGY: 2.5D PROFILING / POCKETING 
            # ------------------------------------------------------------------
            elif op.strategy in ["profile", "pocket", "engrave"]:
                planar_faces = []
                try:
                    f_list = shape.faces() if callable(shape.faces) else shape.faces
                    for f in f_list:
                        n = f.normal_at() if callable(f.normal_at) else f.normal_at
                        # FIX 2: Relaxed tolerance for generic CAD exports
                        if abs(n.Z) > 0.90:
                            planar_faces.append(f)
                except Exception as e:
                    gcode_lines.append(f"; ERROR: Face extraction failed: {str(e)}")

                wires = []
                # FIX 5: Fallback to direct wire extraction for Compounds/Assemblies
                if not planar_faces:
                    gcode_lines.append("; WARNING: No planar faces found, falling back to direct wire extraction.")
                    try:
                        raw_wires = shape.wires() if callable(shape.wires) else shape.wires
                        wires = list(raw_wires)
                    except Exception:
                        wires = []
                else:
                    offset_faces = []
                    for face in planar_faces:
                        try:
                            if op.strategy == "profile":
                                try:
                                    offset_faces.extend(face.offset_2d(tool_radius).faces())
                                except Exception:
                                    # FIX 6: Never lose the contour if math engine crashes
                                    gcode_lines.append("; WARNING: Profile offset failed, cutting on original line.")
                                    offset_faces.append(face)
                            elif op.strategy == "pocket":
                                stepover = tool_radius * 0.8
                                current_offset = -tool_radius
                                pocket_passes = []
                                while True:
                                    try:
                                        off = face.offset_2d(current_offset)
                                        off_faces = off.faces() if hasattr(off, "faces") else [off]
                                        if not off_faces: break
                                        if sum(f.area for f in off_faces) < 1e-4: break
                                        pocket_passes.extend(off_faces)
                                        current_offset -= stepover
                                        if len(pocket_passes) > 20: break
                                    except Exception:
                                        break
                                if pocket_passes: offset_faces.extend(pocket_passes)
                                else: offset_faces.append(face)
                            else:
                                offset_faces.append(face)
                        except Exception:
                            offset_faces.append(face)

                    for f in offset_faces:
                        if hasattr(f, "outer_wire"): wires.append(f.outer_wire())
                        elif hasattr(f, "wires"): wires.extend(f.wires() if callable(f.wires) else f.wires)
                        elif hasattr(f, "wrapped") and f.wrapped.ShapeType() == 2: wires.append(f)

                # Process Wires
                for wire_idx, wire in enumerate(wires):
                    segments: List[Dict[str, Any]] = []
                    edges = wire.edges() if hasattr(wire, "edges") and callable(wire.edges) else getattr(wire, "edges", [])
                    use_sampling_fallback = False

                    if edges:
                        for edge in edges:
                            geom_type = "LINE"
                            try: geom_type = str(getattr(edge, 'geom_type', 'LINE')).upper()
                            except: pass
                            
                            try:
                                p_start = edge.position_at(0.0)
                                p_end = edge.position_at(1.0)

                                if "CIRCLE" in geom_type:
                                    try:
                                        curve = BRepAdaptor_Curve(edge.wrapped)
                                        circ = curve.Circle()
                                        center = circ.Location()
                                        I, J = center.X() - p_start.X, center.Y() - p_start.Y
                                        direction = "G2" if edge.wrapped.Orientation() == 1 else "G3"
                                        segments.append({"type": "ARC", "dir": direction, "x": p_end.X, "y": p_end.Y, "i": I, "j": J, "start_x": p_start.X, "start_y": p_start.Y})
                                    except Exception:
                                        segments.append({"type": "LINE", "x": p_end.X, "y": p_end.Y, "start_x": p_start.X, "start_y": p_start.Y})
                                else:
                                    segments.append({"type": "LINE", "x": p_end.X, "y": p_end.Y, "start_x": p_start.X, "start_y": p_start.Y})
                            except Exception:
                                pass
                        
                        # FIX 1: Topology vs Sampling Fallback Checker
                        if len(segments) != len(edges):
                            use_sampling_fallback = True
                    else:
                        use_sampling_fallback = True
                    
                    if use_sampling_fallback:
                        segments = []
                        try:
                            length = wire.length if not callable(wire.length) else wire.length()
                            steps = max(4, int(length / self.resolution))
                            prev_pt = None
                            for s in range(steps + 1):
                                t = s / float(steps)
                                pt = wire.position_at(t) if hasattr(wire, "position_at") else (wire @ t)
                                if prev_pt: segments.append({"type": "LINE", "x": pt.X, "y": pt.Y, "start_x": prev_pt.X, "start_y": prev_pt.Y})
                                prev_pt = pt
                        except Exception:
                            try:
                                verts = wire.vertices() if callable(wire.vertices) else wire.vertices
                                for i in range(len(verts)):
                                    v1, v2 = verts[i], verts[(i + 1) % len(verts)]
                                    segments.append({"type": "LINE", "x": v2.X, "y": v2.Y, "start_x": v1.X, "start_y": v1.Y})
                            except Exception: continue

                    if not segments: continue

                    # FIX: Prevent zero-length segments from causing issues
                    segments = [s for s in segments if s["type"] == "ARC" or math.hypot(s["x"] - s["start_x"], s["y"] - s["start_y"]) > 1e-4]
                    if not segments: continue

                    # FIX 3: Enforce Contour Closure for Machining Logic
                    first, last = segments[0], segments[-1]
                    if math.hypot(first["start_x"] - last["x"], first["start_y"] - last["y"]) > 0.01:
                        segments.append({"type": "LINE", "x": first["start_x"], "y": first["start_y"], "start_x": last["x"], "start_y": last["y"]})

                    gcode_lines.append(f"\n; --- Wire/Contour {wire_idx + 1} ---")
                    num_passes = max(1, int(math.ceil(op.cutting_depth / op.stepdown)))
                    slowdown_factor = getattr(op, "corner_slowdown_factor", getattr(op, "corner_slowdown", 0.5))

                    for pass_idx in range(num_passes):
                        current_z = -min((pass_idx + 1) * op.stepdown, op.cutting_depth)
                        gcode_lines.append(f"; Pass {pass_idx + 1} (Z={current_z:.3f})")

                        first_seg = segments[0]
                        
                        # FIX 4: Independent Pass Approach Protocol (Safe Z -> XY Start -> Plunge Z)
                        gcode_lines.append(self.post.rapid(z=self.safe_z))
                        gcode_lines.append(self.post.rapid(x=first_seg["start_x"], y=first_seg["start_y"]))
                        gcode_lines.append(self.post.linear(z=current_z, f=tool.plunge_rate))
                        
                        gcode_lines.append(self.post.linear(x=first_seg["x"], y=first_seg["y"], f=tool.feed_rate))

                        # Tuple extraction for Pydantic Schema UI visualizer
                        current_pass_path = [
                            (first_seg["start_x"], first_seg["start_y"], self.safe_z),
                            (first_seg["start_x"], first_seg["start_y"], current_z),
                            (first_seg["x"], first_seg["y"], current_z)
                        ]

                        for i in range(1, len(segments)):
                            seg = segments[i]
                            feed = tool.feed_rate
                            
                            if i < len(segments) - 1 and seg["type"] == "LINE" and segments[i+1]["type"] == "LINE":
                                theta = self._calculate_deviation_angle(
                                    (seg["start_x"], seg["start_y"]), (seg["x"], seg["y"]), (segments[i+1]["x"], segments[i+1]["y"])
                                )
                                if theta > (30.0 * math.pi / 180.0):
                                    gcode_lines.append(f"; WARNING: Sharp corner detected ({math.degrees(theta):.1f} deg). Decelerating.")
                                    feed = tool.feed_rate * slowdown_factor

                            if seg["type"] == "ARC":
                                gcode_lines.append(self.post.arc(
                                    x=seg["x"], y=seg["y"], i=seg["i"], j=seg["j"], direction=seg["dir"], f=feed
                                ))
                            else:
                                # FIX: Prevent zero-length ghost cuts
                                if math.hypot(seg["x"] - seg["start_x"], seg["y"] - seg["start_y"]) > 1e-4:
                                    gcode_lines.append(self.post.linear(x=seg["x"], y=seg["y"], f=feed))
                                
                            current_pass_path.append((seg["x"], seg["y"], current_z))

                        toolpaths.append(current_pass_path)

                    gcode_lines.append(self.post.rapid(z=self.safe_z))

        gcode_lines.extend(["", "; --- End of Program ---"])
        gcode_lines.extend(self.post.footer(coolant=coolant))

        return {
            "gcode": "\n".join(gcode_lines),
            "toolpaths": toolpaths,
        }