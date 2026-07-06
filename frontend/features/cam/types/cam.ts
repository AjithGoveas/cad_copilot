export type ToolType = "endmill" | "ballnose" | "drill" | "face" | "turning_rough" | "turning_finish";
export type MachiningStrategy = "surface" | "profile" | "pocket" | "engrave" | "drill" | "face" | "turn_rough" | "turn_finish";

export interface Tool {
  number: number;
  type: ToolType;
  diameter: number;
  spindle_speed: number;
  feed_rate: number;
  plunge_rate: number;
  description: string;
  flute_length?: number;
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

export interface ToolConfig extends Tool {}

export interface OperationConfig extends Operation {
  units: 'metric' | 'imperial';
}

export interface StockConfig {
  stock_type: 'block' | 'cylinder';
  length_x?: number | null;
  width_y?: number | null;
  height_z?: number | null;
  outer_diameter?: number | null;
  inner_diameter?: number | null;
  length_z?: number | null;
}

export interface CamConfig {
  controller: string;
  safe_z: number;
  coolant: boolean;
  resolution: number;
  stock_configuration: StockConfig;
  tools: ToolConfig[];
  operations: OperationConfig[];
}
