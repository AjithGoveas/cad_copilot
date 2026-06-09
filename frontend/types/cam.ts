export type ToolType = "endmill" | "ballnose" | "drill" | "face";
export type MachiningStrategy = "surface" | "profile" | "pocket" | "engrave" | "drill" | "face";

export interface Tool {
  number: number;
  type: ToolType;
  diameter: number;
  spindle_speed: number;
  feed_rate: number;
  plunge_rate: number;
  description: string;
}

export interface Operation {
  name: string;
  strategy: MachiningStrategy;
  tool_number: number;
  cutting_depth: number;
  stepdown: number;
  units?: 'metric' | 'imperial';
  corner_slowdown: number;
}

export interface CAMJobRequest {
  machine_configuration: {
    controller: "fanuc" | "haas" | "siemens" | "heidenhain";
    safe_z: number;
    resolution: number;
    coolant_active: boolean;
  };
  tool_library: Tool[];
  operations_pipeline: Operation[];
}
