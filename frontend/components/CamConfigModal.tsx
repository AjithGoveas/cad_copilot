'use client';

import { useState, useEffect } from 'react';
import { 
    X, Plus, Trash2, Settings, Hammer, Layers, AlertCircle, Play, Loader2, 
    Sparkles, ChevronRight, ChevronLeft, ShieldCheck, Gauge, Zap, 
    ChevronUp, ChevronDown, Cpu, Check, Info, Box, HelpCircle
} from 'lucide-react';
import { toast } from 'sonner';

export interface ToolConfig {
    number: number;
    type: 'endmill' | 'ballnose' | 'drill' | 'face' | 'turning_rough' | 'turning_finish';
    diameter: number;
    spindle_speed: number;
    feed_rate: number;
    plunge_rate: number;
    description: string;
    flute_length?: number;
}

export interface OperationConfig {
    name: string;
    strategy: 'surface' | 'profile' | 'pocket' | 'engrave' | 'drill' | 'face' | 'turn_rough' | 'turn_finish';
    tool_number: number;
    cutting_depth: number;
    stepdown: number;
    units: 'metric' | 'imperial';
    corner_slowdown: number;
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

interface CamConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGenerate: (config: CamConfig) => Promise<void>;
    isGenerating: boolean;
    initialController: string;
}

type StepType = 'machine' | 'stock' | 'tools' | 'operations';

const CONTROLLER_DIALECTS = [
    { id: 'fanuc', name: 'Fanuc Dialect', desc: 'Standard ISO G-code compatible with most CNC machinery.', ext: '.nc' },
    { id: 'haas', name: 'Haas CNC', desc: 'Optimized for Haas VF mills with native canned cycle syntax.', ext: '.nc' },
    { id: 'siemens', name: 'Siemens Sinumerik', desc: 'Formatted for Siemens 840D/828D controls with SHOPMILL.', ext: '.mpf' },
    { id: 'heidenhain', name: 'Heidenhain ISO', desc: 'ISO format compatible with Heidenhain TNC controls.', ext: '.i' },
    { id: 'mazak', name: 'Mazak EIA', desc: 'EIA/ISO G-code standard formatted for Mazatrol processors.', ext: '.eia' },
    { id: 'mitsubishi', name: 'Mitsubishi CNC', desc: 'Optimized G-code dialect syntax for Mitsubishi systems.', ext: '.gcode' },
];

const STRATEGY_DESCRIPTIONS = {
    surface: '3D Surfacing: Scans the entire 3D surface using grid/drop-cutter toolpaths.',
    profile: '2.5D Profiling: Cuts along the outer/inner contours of flat boundary walls.',
    pocket: '2.5D Pocketing: Clears bulk inner material within closed boundaries.',
    engrave: 'Engraving: Traces nominal wireframe lines directly without offsets.',
    drill: 'Drilling: Automatically recognizes circular holes and executes canned cycles.',
    face: 'Facing: Raster-mills the topmost stock surface to establish a flat Z reference.',
    turn_rough: 'Turning Rough: Axisymmetric material-peeling passes along length to reduce diameter.',
    turn_finish: 'Turning Finish: Axisymmetric profile finishing passes along target contour.'
};

const MATERIAL_CHIPS = [
    { name: 'Aluminum 6061', label: 'Al 6061', type: 'Metal' },
    { name: 'Plywood', label: 'Plywood', type: 'Wood' },
    { name: 'Acrylic', label: 'Acrylic', type: 'Plastic' },
    { name: 'Delrin', label: 'Delrin', type: 'Polymer' },
    { name: 'Mild Steel', label: 'Steel', type: 'Ferrous' }
];

export default function CamConfigModal({
    isOpen,
    onClose,
    onGenerate,
    isGenerating,
    initialController
}: CamConfigModalProps) {
    const [currentStep, setCurrentStep] = useState<StepType>('machine');
    const [controller, setController] = useState<string>(initialController || 'fanuc');
    const [safeZ, setSafeZ] = useState<number>(5.0);
    const [coolant, setCoolant] = useState<boolean>(true);
    const [resolution, setResolution] = useState<number>(0.5);

    const [stockType, setStockType] = useState<'block' | 'cylinder'>('block');
    const [stockLengthX, setStockLengthX] = useState<number | null>(null);
    const [stockWidthY, setStockWidthY] = useState<number | null>(null);
    const [stockHeightZ, setStockHeightZ] = useState<number | null>(null);
    const [stockOuterDiameter, setStockOuterDiameter] = useState<number | null>(null);
    const [stockInnerDiameter, setStockInnerDiameter] = useState<number>(0.0);
    const [stockLengthZ, setStockLengthZ] = useState<number | null>(null);

    const [tools, setTools] = useState<ToolConfig[]>([
        {
            number: 1,
            type: 'endmill',
            diameter: 3.175,
            spindle_speed: 10000,
            feed_rate: 400,
            plunge_rate: 150,
            description: '1/8in Flat Endmill',
            flute_length: 25.0
        }
    ]);

    const [operations, setOperations] = useState<OperationConfig[]>([
        {
            name: 'Rough Pocketing',
            strategy: 'pocket',
            tool_number: 1,
            cutting_depth: 5.0,
            stepdown: 0.5,
            units: 'metric',
            corner_slowdown: 0.5
        }
    ]);

    const [validationError, setValidationError] = useState<string | null>(null);

    useEffect(() => {
        if (initialController) {
            setController(initialController);
        }
    }, [initialController]);

    if (!isOpen) return null;

    // --- Helper to count passes ---
    const getPassCount = (depth: number, stepdown: number) => {
        if (depth <= 0 || stepdown <= 0) return 0;
        return Math.ceil(depth / stepdown);
    };

    // --- Live Validation Checks ---
    const getValidationIssues = () => {
        const issues: string[] = [];
        if (tools.length === 0) {
            issues.push('Tool library requires at least 1 tool.');
        }
        if (operations.length === 0) {
            issues.push('Operations sequence requires at least 1 operation.');
        }
        const numSet = new Set(tools.map(t => t.number));
        if (numSet.size !== tools.length) {
            issues.push('Tool numbers must be unique.');
        }
        const invalidOpRef = operations.some(op => !numSet.has(op.tool_number));
        if (invalidOpRef) {
            issues.push('An operation references a missing tool.');
        }
        const invalidDepth = operations.some(op => op.cutting_depth < op.stepdown);
        if (invalidDepth) {
            issues.push('Depth cannot be shallower than pass stepdown.');
        }
        return issues;
    };

    const validationIssues = getValidationIssues();
    const isValid = validationIssues.length === 0;

    // --- Material Preset Lookup ---
    const handleApplyMaterialPreset = async (index: number, material: string) => {
        const tool = tools[index];
        try {
            const res = await fetch(`/api/v1/material-defaults?material=${encodeURIComponent(material)}&diameter=${tool.diameter}`);
            if (!res.ok) throw new Error('Failed to fetch defaults');
            const data = await res.json();
            
            const updatedTools = [...tools];
            updatedTools[index] = {
                ...tool,
                spindle_speed: data.spindle_speed,
                feed_rate: data.feed_rate,
                plunge_rate: data.plunge_rate,
                description: `${material} Preset`
            };
            setTools(updatedTools);

            const toolNum = tool.number;
            const updatedOps = operations.map(op => {
                if (op.tool_number === toolNum) {
                    return {
                        ...op,
                        stepdown: data.stepdown
                    };
                }
                return op;
            });
            setOperations(updatedOps);
            setValidationError(null);
            
            toast.success(`Applied ${material} speed presets for Tool T${tool.number}!`);
        } catch (err: any) {
            console.error(err);
            setValidationError(`Failed to load preset for ${material}: ${err.message}`);
        }
    };

    // --- Tool Handlers ---
    const handleAddTool = () => {
        const nextNum = tools.length > 0 ? Math.max(...tools.map(t => t.number)) + 1 : 1;
        setTools([
            ...tools,
            {
                number: nextNum,
                type: 'endmill',
                diameter: 3.175,
                spindle_speed: 12000,
                feed_rate: 800,
                plunge_rate: 200,
                description: `Tool T${nextNum}`,
                flute_length: 25.0
            }
        ]);
        setValidationError(null);
    };

    const handleRemoveTool = (index: number) => {
        if (tools.length === 1) {
            setValidationError('Tool Library must have at least one tool.');
            return;
        }
        const removedToolNum = tools[index].number;
        const newTools = tools.filter((_, i) => i !== index);
        setTools(newTools);

        const remainingToolNum = newTools[0]?.number || 1;
        setOperations(
            operations.map(op =>
                op.tool_number === removedToolNum ? { ...op, tool_number: remainingToolNum } : op
            )
        );
        setValidationError(null);
    };

    const handleToolChange = (index: number, field: keyof ToolConfig, value: any) => {
        const updated = [...tools];
        if (field === 'number') {
            const numVal = parseInt(value) || 0;
            const exists = tools.some((t, i) => i !== index && t.number === numVal);
            if (exists) {
                setValidationError(`Tool number ${numVal} is already defined.`);
            } else {
                setValidationError(null);
            }
            const oldNum = updated[index].number;
            setOperations(operations.map(op => op.tool_number === oldNum ? { ...op, tool_number: numVal } : op));
            updated[index].number = numVal;
        } else if (field === 'description' || field === 'type') {
            updated[index][field] = value as any;
        } else {
            updated[index][field] = parseFloat(value) || 0;
        }
        setTools(updated);
    };

    // --- Operation Handlers ---
    const handleAddOperation = () => {
        const defaultToolNum = tools[0]?.number || 1;
        const nextIdx = operations.length + 1;
        setOperations([
            ...operations,
            {
                name: `Op ${nextIdx}`,
                strategy: 'profile',
                tool_number: defaultToolNum,
                cutting_depth: 5.0,
                stepdown: 1.0,
                units: 'metric',
                corner_slowdown: 0.5
            }
        ]);
        setValidationError(null);
    };

    const handleRemoveOperation = (index: number) => {
        if (operations.length === 1) {
            setValidationError('Operations list must have at least one machining operation.');
            return;
        }
        setOperations(operations.filter((_, i) => i !== index));
        setValidationError(null);
    };

    const handleOperationChange = (index: number, field: keyof OperationConfig, value: any) => {
        const updated = [...operations];
        if (field === 'name' || field === 'strategy' || field === 'units') {
            updated[index][field] = value as never;
        } else if (field === 'tool_number') {
            updated[index].tool_number = parseInt(value) || 0;
        } else {
            updated[index][field] = parseFloat(value) || 0;
        }
        setOperations(updated);
    };

    // --- Move Operations up/down ---
    const handleMoveOpUp = (index: number) => {
        if (index === 0) return;
        const updated = [...operations];
        const temp = updated[index];
        updated[index] = updated[index - 1];
        updated[index - 1] = temp;
        setOperations(updated);
    };

    const handleMoveOpDown = (index: number) => {
        if (index === operations.length - 1) return;
        const updated = [...operations];
        const temp = updated[index];
        updated[index] = updated[index + 1];
        updated[index + 1] = temp;
        setOperations(updated);
    };

    const handleNextStep = () => {
        if (currentStep === 'machine') {
            setCurrentStep('stock');
        } else if (currentStep === 'stock') {
            setCurrentStep('tools');
        } else if (currentStep === 'tools') {
            const numSet = new Set(tools.map(t => t.number));
            if (numSet.size !== tools.length) {
                setValidationError('Tool numbers in the Tool Library must be unique.');
                return;
            }
            setValidationError(null);
            setCurrentStep('operations');
        }
    };

    const handleBackStep = () => {
        if (currentStep === 'operations') {
            setCurrentStep('tools');
        } else if (currentStep === 'tools') {
            setCurrentStep('stock');
        } else if (currentStep === 'stock') {
            setCurrentStep('machine');
        }
    };

    const handleFormSubmit = async () => {
        if (validationIssues.length > 0) {
            setValidationError(validationIssues[0]);
            return;
        }
        setValidationError(null);
        await onGenerate({
            controller,
            safe_z: safeZ,
            coolant,
            resolution,
            stock_configuration: {
                stock_type: stockType,
                length_x: stockType === 'block' ? stockLengthX : null,
                width_y: stockType === 'block' ? stockWidthY : null,
                height_z: stockType === 'block' ? stockHeightZ : null,
                outer_diameter: stockType === 'cylinder' ? stockOuterDiameter : null,
                inner_diameter: stockType === 'cylinder' ? stockInnerDiameter : 0.0,
                length_z: stockType === 'cylinder' ? stockLengthZ : null
            },
            tools,
            operations
        });
    };

    // --- SVGs & Render Helpers ---
    const renderToolSvg = (diameter: number) => {
        const displayWidth = Math.max(8, Math.min(40, diameter * 3.5));
        return (
            <div className="relative flex flex-col items-center justify-center border border-zinc-800 bg-zinc-950 p-3 h-36 w-24 shrink-0 overflow-hidden rounded-lg">
                <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
                    backgroundImage: 'radial-gradient(circle, #3b82f6 1px, transparent 1px)',
                    backgroundSize: '8px 8px'
                }} />
                <svg width="48" height="72" viewBox="0 0 48 72" className="text-blue-500 z-10">
                    <rect x="18" y="2" width="12" height="28" fill="currentColor" opacity="0.2" rx="0" />
                    <polygon points={`18,30 30,30 ${24 + displayWidth/2},34 ${24 - displayWidth/2},34`} fill="currentColor" opacity="0.4" />
                    <rect x={24 - displayWidth/2} y="34" width={displayWidth} height="28" fill="currentColor" rx="0" opacity="0.8" />
                    <path d={`M ${24 - displayWidth/2} 40 Q 24 43 ${24 + displayWidth/2} 45`} stroke="#09090b" strokeWidth="1.5" fill="none" opacity="0.8"/>
                    <path d={`M ${24 - displayWidth/2} 50 Q 24 53 ${24 + displayWidth/2} 55`} stroke="#09090b" strokeWidth="1.5" fill="none" opacity="0.8"/>
                    <polygon points={`${24 - displayWidth/2},62 ${24 + displayWidth/2},62 24,66`} fill="currentColor" />
                </svg>
                <span className="text-[10px] font-mono font-medium text-blue-400 mt-2 z-10">{diameter.toFixed(3)}mm</span>
            </div>
        );
    };

    const renderPassVisualizer = (depth: number, stepdown: number) => {
        const passes = getPassCount(depth, stepdown);
        if (passes === 0) return null;
        const maxDisplayLines = 8;
        const displayLines = Math.min(passes, maxDisplayLines);
        return (
            <div className="flex flex-col gap-2 p-3.5 bg-zinc-900/40 border border-zinc-800/80 rounded-xl">
                <div className="flex justify-between items-center text-[10px] uppercase font-semibold tracking-wider text-zinc-400">
                    <span>Pass Profile</span>
                    <span className="text-blue-400 font-mono border border-blue-500/20 bg-blue-500/5 px-1.5 py-0.5 rounded">{passes}P</span>
                </div>
                <div className="relative h-20 w-full bg-zinc-950 border border-zinc-900 rounded-lg overflow-hidden flex flex-col justify-end">
                    <div className="relative h-16 w-full flex flex-col justify-between px-3 pb-2">
                        {Array.from({ length: displayLines }).map((_, lineIdx) => {
                            const currentDepthVal = ((lineIdx + 1) / passes) * depth;
                            return (
                                <div key={lineIdx} className="w-full relative h-[1px]">
                                    <div className="absolute left-3 right-0 h-[1px] border-t border-dashed border-blue-500/20" />
                                    <span className="absolute right-0 -top-2.5 text-[8px] text-blue-400/80 font-mono">
                                        -{currentDepthVal.toFixed(2)}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
                {passes > maxDisplayLines && (
                    <span className="text-[9px] text-zinc-500 text-center font-sans">+{passes - maxDisplayLines} more passes</span>
                )}
            </div>
        );
    };

    const STEPS: { key: StepType; label: string; num: number }[] = [
        { key: 'machine', label: 'Machine', num: 1 },
        { key: 'stock',   label: 'Stock',   num: 2 },
        { key: 'tools',   label: 'Tools',   num: 3 },
        { key: 'operations', label: 'Operations', num: 4 },
    ];

    const getStepIndex = (key: StepType) => {
        return STEPS.findIndex(s => s.key === key);
    };

    const currentStepIdx = getStepIndex(currentStep);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="relative flex flex-col w-full max-w-5xl h-[85vh] border border-zinc-800 bg-[#09090b] shadow-2xl rounded-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-950 px-6 py-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-500/10 text-blue-400 p-2 rounded-lg">
                            <Hammer size={18} />
                        </div>
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-100 tracking-wide font-sans">CAM Studio</h3>
                            <p className="text-xs text-zinc-500 font-sans tracking-wide">Configure toolpaths, select tooling, and compile G-code</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border text-[10px] font-medium font-sans border-zinc-800 bg-zinc-900 text-zinc-300`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${isValid ? 'bg-emerald-400' : 'bg-red-400'}`} />
                            <span className="uppercase">{isValid ? 'Ready to Compile' : 'Validation Error'}</span>
                        </div>
                        <button onClick={onClose} className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Stepper Dot Navigation with Animated Paths */}
                <div className="flex items-center justify-center gap-2 border-b border-zinc-800/80 bg-zinc-950 px-6 py-4 shrink-0 overflow-x-auto">
                    {STEPS.map((step, idx) => {
                        const isCompleted = currentStepIdx > idx;
                        const isActive = currentStepIdx === idx;
                        const isNextConnected = idx < STEPS.length - 1;
                        const isPathActive = currentStepIdx > idx;

                        return (
                            <div key={step.key} className="flex items-center">
                                {/* Dot & Label Button */}
                                <button
                                    onClick={() => setCurrentStep(step.key)}
                                    className="flex items-center gap-2.5 focus:outline-none group"
                                >
                                    <div className={`flex size-6 items-center justify-center rounded-full border text-[11px] font-bold transition-all duration-300 ${
                                        isActive 
                                            ? 'border-blue-500 bg-blue-500 text-white shadow-sm shadow-blue-500/20 scale-105' 
                                            : isCompleted 
                                                ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                                                : 'border-zinc-800 bg-zinc-900 text-zinc-500 group-hover:border-zinc-700 group-hover:text-zinc-300'
                                    }`}>
                                        {isCompleted ? <Check size={12} strokeWidth={3} /> : step.num}
                                    </div>
                                    <span className={`text-xs font-medium tracking-wide transition-colors duration-300 ${
                                        isActive 
                                            ? 'text-blue-400 font-semibold' 
                                            : isCompleted 
                                                ? 'text-zinc-300' 
                                                : 'text-zinc-500 group-hover:text-zinc-300'
                                    }`}>
                                        {step.label}
                                    </span>
                                </button>

                                {/* Animated path connector */}
                                {isNextConnected && (
                                    <div className="w-12 h-[2px] bg-zinc-800 mx-3 rounded-full overflow-hidden relative">
                                        <div 
                                            className={`absolute left-0 top-0 h-full bg-blue-500 transition-all duration-700 ease-in-out ${
                                                isPathActive ? 'w-full' : 'w-0'
                                            }`} 
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* Main Layout */}
                <div className="flex flex-1 overflow-hidden">

                    {/* Left: Form Area */}
                    <div className="flex-1 flex flex-col overflow-hidden">

                        {/* Validation Error Banner */}
                        {validationError && (
                            <div className="shrink-0 flex items-center gap-3 border-b border-red-500/20 bg-red-500/5 px-6 py-3 text-xs text-red-400 font-sans">
                                <AlertCircle size={14} className="shrink-0" />
                                <span>{validationError}</span>
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto p-6 bg-zinc-950/20">

                            {/* STEP 1: Machine Setup */}
                            {currentStep === 'machine' && (
                                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">

                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
                                            <Cpu size={14} className="text-blue-400" />
                                            <span className="text-xs font-semibold text-zinc-300 tracking-wide uppercase font-sans">Controller Dialect</span>
                                        </div>
                                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                                            {CONTROLLER_DIALECTS.map((dial) => {
                                                const isSel = controller === dial.id;
                                                return (
                                                    <button
                                                        key={dial.id}
                                                        onClick={() => setController(dial.id)}
                                                        className={`flex items-start gap-3 p-4 rounded-xl border text-left transition-all ${
                                                            isSel
                                                                ? 'border-blue-500 bg-blue-500/5 shadow-sm'
                                                                : 'border-zinc-800 bg-zinc-900/20 hover:border-zinc-700 hover:bg-zinc-900/40'
                                                        }`}
                                                    >
                                                        <div className={`w-4 h-4 shrink-0 rounded-full border mt-0.5 flex items-center justify-center transition-colors ${isSel ? 'border-blue-500 bg-blue-500 text-white' : 'border-zinc-700'}`}>
                                                            {isSel && <Check size={10} strokeWidth={3} />}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex items-center justify-between gap-1">
                                                                <span className={`text-xs font-semibold ${isSel ? 'text-blue-400' : 'text-zinc-200'}`}>{dial.name}</span>
                                                                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${isSel ? 'border-blue-500/30 text-blue-400 bg-blue-500/5' : 'border-zinc-800 text-zinc-500 bg-zinc-900'}`}>{dial.ext.replace('.','')}</span>
                                                            </div>
                                                            <p className="text-[11px] text-zinc-500 mt-1.5 leading-normal">{dial.desc}</p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="border border-zinc-800/80 bg-zinc-900/30 rounded-xl p-5 space-y-5">
                                        <div className="flex items-center gap-2 border-b border-zinc-800 pb-2.5">
                                            <Settings size={14} className="text-zinc-400" />
                                            <span className="text-xs font-semibold text-zinc-300 tracking-wide uppercase font-sans">Environment Variables</span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center text-xs">
                                                    <div className="flex items-center gap-1.5 text-zinc-400">
                                                        <label className="font-medium">Safe Clearance Z</label>
                                                        <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                            <HelpCircle size={13} />
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2.5 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                The height above the stock Z-zero at which the tool can retract and move rapidly between cuts safely.
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <span className="font-semibold text-blue-400 font-mono">{safeZ.toFixed(1)} mm</span>
                                                </div>
                                                <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                                                    <input type="range" min="1.0" max="15.0" step="0.5" value={safeZ}
                                                        onChange={(e) => setSafeZ(parseFloat(e.target.value) || 5.0)}
                                                        className="flex-1 h-1 appearance-none bg-zinc-800 accent-blue-500 rounded-lg cursor-pointer" />
                                                    <input type="number" min="1.0" max="15.0" step="0.5" value={safeZ}
                                                        onChange={(e) => setSafeZ(Math.max(1, Math.min(15, parseFloat(e.target.value) || 5)))}
                                                        className="w-12 bg-transparent text-right text-xs font-mono text-zinc-200 focus:outline-none" />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <div className="flex justify-between items-center text-xs">
                                                    <div className="flex items-center gap-1.5 text-zinc-400">
                                                        <label className="font-medium">Step Resolution</label>
                                                        <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                            <HelpCircle size={13} />
                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2.5 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                Determines path resolution. Lower values produce a smoother surface finish but increase generation time.
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <span className="font-semibold text-blue-400 font-mono">{resolution.toFixed(2)} mm</span>
                                                </div>
                                                <div className="flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg p-2.5">
                                                    <input type="range" min="0.05" max="2.00" step="0.05" value={resolution}
                                                        onChange={(e) => setResolution(parseFloat(e.target.value) || 0.5)}
                                                        className="flex-1 h-1 appearance-none bg-zinc-800 accent-blue-500 rounded-lg cursor-pointer" />
                                                    <input type="number" min="0.05" max="2.00" step="0.05" value={resolution}
                                                        onChange={(e) => setResolution(Math.max(0.05, Math.min(2, parseFloat(e.target.value) || 0.5)))}
                                                        className="w-12 bg-transparent text-right text-xs font-mono text-zinc-200 focus:outline-none" />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center justify-between border-t border-zinc-800 pt-4">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-semibold text-zinc-200 font-sans">Flood Coolant</span>
                                                    <span className={`text-[10px] font-semibold font-mono px-1.5 py-0.5 rounded border ${coolant ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400' : 'border-zinc-800 bg-zinc-900 text-zinc-500'}`}>
                                                        {coolant ? 'M08 ON' : 'M09 OFF'}
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-zinc-500 mt-1 font-sans">Inject flood coolant commands at tool changes</p>
                                            </div>
                                            <button onClick={() => setCoolant(!coolant)}
                                                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-all duration-200 ${coolant ? 'bg-blue-600' : 'bg-zinc-800'}`}>
                                                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-all ${coolant ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 2: Stock Setup */}
                            {currentStep === 'stock' && (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    <div className="border border-zinc-800/80 bg-zinc-900/30 rounded-xl p-5 space-y-5">
                                        <div className="flex items-center gap-2 border-b border-zinc-800 pb-2.5">
                                            <Box size={14} className="text-zinc-400" />
                                            <span className="text-xs font-semibold text-zinc-300 tracking-wide uppercase font-sans">Stock Envelope</span>
                                        </div>

                                        <div className="flex p-1 bg-zinc-950 border border-zinc-800 rounded-lg">
                                            {(['block', 'cylinder'] as const).map(t => (
                                                <button key={t} onClick={() => setStockType(t)}
                                                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                                                        stockType === t ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                                                    }`}>
                                                    {t === 'block' ? 'Prismatic Block' : 'Cylindrical'}
                                                </button>
                                            ))}
                                        </div>

                                        {stockType === 'block' ? (
                                            <div className="grid grid-cols-3 gap-3">
                                                {[
                                                    { label: 'Length X', val: stockLengthX, set: setStockLengthX, tip: 'Prismatic width of raw workpiece along X axis' },
                                                    { label: 'Width Y', val: stockWidthY, set: setStockWidthY, tip: 'Prismatic depth of raw workpiece along Y axis' },
                                                    { label: 'Height Z', val: stockHeightZ, set: setStockHeightZ, tip: 'Thickness height of raw workpiece along Z axis' },
                                                ].map(f => (
                                                    <div key={f.label} className="space-y-1">
                                                        <div className="flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                                                            <span>{f.label}</span>
                                                            <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                                <HelpCircle size={10} />
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-36 p-2 bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                    {f.tip}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center border border-zinc-800 bg-zinc-950 rounded-lg px-2">
                                                            <input type="number" placeholder="Auto"
                                                                value={f.val || ''}
                                                                onChange={(e) => f.set(parseFloat(e.target.value) || null)}
                                                                className="flex-1 bg-transparent py-2 text-xs font-mono text-zinc-200 focus:outline-none w-0" />
                                                            <span className="text-[10px] text-zinc-600 font-medium ml-1">mm</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-3 gap-3">
                                                {[
                                                    { label: 'Outer Dia', val: stockOuterDiameter, set: setStockOuterDiameter, placeholder: 'Auto', tip: 'Total outer diameter of round/bar stock' },
                                                    { label: 'Inner Dia', val: stockInnerDiameter, set: (v: any) => setStockInnerDiameter(v || 0), placeholder: '0', tip: 'Inner hollow diameter for tube stock' },
                                                    { label: 'Length Z', val: stockLengthZ, set: setStockLengthZ, placeholder: 'Auto', tip: 'Workpiece cylinder length along longitudinal axis' },
                                                ].map(f => (
                                                    <div key={f.label} className="space-y-1">
                                                        <div className="flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                                                            <span>{f.label}</span>
                                                            <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                                <HelpCircle size={10} />
                                                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-36 p-2 bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                    {f.tip}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center border border-zinc-800 bg-zinc-950 rounded-lg px-2">
                                                            <input type="number" placeholder={f.placeholder}
                                                                value={f.val || ''}
                                                                onChange={(e) => f.set(parseFloat(e.target.value) || null)}
                                                                className="flex-1 bg-transparent py-2 text-xs font-mono text-zinc-200 focus:outline-none w-0" />
                                                            <span className="text-[10px] text-zinc-600 font-medium ml-1">mm</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex items-start gap-2.5 bg-blue-500/5 border border-blue-500/10 rounded-lg p-3.5">
                                            <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
                                            <span className="text-[11px] text-zinc-400 font-sans leading-relaxed">Leave fields blank to auto-compute boundary dimensions directly from the CAD bounding box.</span>
                                        </div>
                                    </div>

                                    {/* Blueprint Preview with Elegant High-Contrast Labels */}
                                    <div className="border border-zinc-800/80 bg-zinc-900/30 rounded-xl flex flex-col items-center justify-center gap-4 relative overflow-hidden p-6" style={{
                                        backgroundImage: 'radial-gradient(#27272a 1px, transparent 1px)',
                                        backgroundSize: '20px 20px',
                                        backgroundAttachment: 'local'
                                    }}>
                                        <div className="absolute inset-0 bg-zinc-950/20" />
                                        <div className="relative z-10 flex flex-col items-center gap-4 w-full">
                                            {stockType === 'block' ? (
                                                <div className="border border-zinc-800 rounded-2xl flex flex-col items-center justify-center bg-zinc-950 shadow-md p-6 w-full max-w-[290px]">
                                                    <svg width="200" height="160" viewBox="0 0 120 100" fill="none" strokeWidth="1.5" className="overflow-visible">
                                                        <defs>
                                                            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#3b82f6" />
                                                            </marker>
                                                        </defs>

                                                        {/* Isometric Coordinate Axis Triad */}
                                                        <g transform="translate(115, 10)">
                                                            <line x1="0" y1="0" x2="12" y2="6" stroke="#ef4444" strokeWidth="0.75" />
                                                            <line x1="0" y1="0" x2="-12" y2="6" stroke="#22c55e" strokeWidth="0.75" />
                                                            <line x1="0" y1="0" x2="0" y2="-12" stroke="#3b82f6" strokeWidth="0.75" />
                                                            <text x="14" y="9" fill="#ef4444" fontSize="6" fontFamily="sans-serif">X</text>
                                                            <text x="-17" y="9" fill="#22c55e" fontSize="6" fontFamily="sans-serif">Y</text>
                                                            <text x="-2" y="-14" fill="#3b82f6" fontSize="6" fontFamily="sans-serif">Z</text>
                                                        </g>

                                                        {/* 3D Box projections */}
                                                        <path d="M 25 70 L 25 35 L 60 20 L 95 35 L 95 70 L 60 85 Z" stroke='#3b82f6' />
                                                        <path d="M 25 35 L 60 50 L 95 35" stroke='#3b82f6' />
                                                        <path d="M 60 50 L 60 85" stroke='#3b82f6' />
                                                        <path d="M 25 70 L 60 85 L 95 70" strokeDasharray="2,2" stroke='#3b82f6' />
                                                        
                                                        {/* X Dimension extension lines */}
                                                        <line x1="25" y1="71" x2="20" y2="79" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        <line x1="60" y1="86" x2="55" y2="94" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        {/* X Dimension Line (Bottom Left Edge) with arrows */}
                                                        <path d="M 22 76 L 53 89" stroke="#ffffff" strokeWidth="0.75" markerStart="url(#arrow)" markerEnd="url(#arrow)" />

                                                        {/* Y Dimension extension lines */}
                                                        <line x1="95" y1="71" x2="100" y2="79" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        <line x1="60" y1="86" x2="65" y2="94" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        {/* Y Dimension Line (Bottom Right Edge) with arrows */}
                                                        <path d="M 67 89 L 98 76" stroke="#ffffff" strokeWidth="0.75" markerStart="url(#arrow)" markerEnd="url(#arrow)" />

                                                        {/* Z Dimension extension lines */}
                                                        <line x1="24" y1="35" x2="10" y2="35" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        <line x1="24" y1="70" x2="10" y2="70" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        {/* Z Dimension Line (Left Side) with arrows */}
                                                        <path d="M 12 37 L 12 68" stroke="#ffffff" strokeWidth="0.75" markerStart="url(#arrow)" markerEnd="url(#arrow)" />

                                                        {/* Thin Clean White Labels with custom letter spacing */}
                                                        <text x="32" y="96" fill="#ffffff" fontSize="9" fontFamily="sans-serif" style={{ fontWeight: 300, letterSpacing: '0.06em' }} textAnchor="middle">
                                                            X: {stockLengthX ? `${stockLengthX}mm` : 'Auto'}
                                                        </text>
                                                        <text x="88" y="96" fill="#ffffff" fontSize="9" fontFamily="sans-serif" style={{ fontWeight: 300, letterSpacing: '0.06em' }} textAnchor="middle">
                                                            Y: {stockWidthY ? `${stockWidthY}mm` : 'Auto'}
                                                        </text>
                                                        <text x="2" y="53" fill="#ffffff" fontSize="9" fontFamily="sans-serif" style={{ fontWeight: 300, letterSpacing: '0.06em' }} textAnchor="end">
                                                            Z: {stockHeightZ ? `${stockHeightZ}mm` : 'Auto'}
                                                        </text>
                                                    </svg>
                                                    
                                                    <div className="w-full flex items-center justify-between border-t border-zinc-850 pt-3 mt-1.5 text-[9px] text-zinc-500 font-mono tracking-wider">
                                                        <span>SCALE: 1:1</span>
                                                        <span>UNITS: MM</span>
                                                        <span>BLOCK STOCK</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="border border-zinc-800 rounded-2xl flex flex-col items-center justify-center bg-zinc-950 shadow-md p-6 w-full max-w-[290px]">
                                                    <svg width="200" height="160" viewBox="0 0 120 100" fill="none" strokeWidth="1.5" className="overflow-visible">
                                                        <defs>
                                                            <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#3b82f6" />
                                                            </marker>
                                                            <marker id="arrow-amber" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                                                <path d="M 0 1.5 L 10 5 L 0 8.5 z" fill="#f59e0b" />
                                                            </marker>
                                                        </defs>

                                                        {/* Isometric Coordinate Axis Triad */}
                                                        <g transform="translate(115, 10)">
                                                            <line x1="0" y1="0" x2="12" y2="6" stroke="#ef4444" strokeWidth="0.75" />
                                                            <line x1="0" y1="0" x2="-12" y2="6" stroke="#22c55e" strokeWidth="0.75" />
                                                            <line x1="0" y1="0" x2="0" y2="-12" stroke="#3b82f6" strokeWidth="0.75" />
                                                            <text x="14" y="9" fill="#ef4444" fontSize="6" fontFamily="sans-serif">X</text>
                                                            <text x="-17" y="9" fill="#22c55e" fontSize="6" fontFamily="sans-serif">Y</text>
                                                            <text x="-2" y="-14" fill="#3b82f6" fontSize="6" fontFamily="sans-serif">Z</text>
                                                        </g>

                                                        {/* Top Ellipse */}
                                                        <ellipse cx="60" cy="25" rx="30" ry="10" stroke='#3b82f6'/>
                                                        {/* Cylindrical Sides */}
                                                        <path d="M 30 25 L 30 75 A 30 10 0 0 0 90 75 L 90 25" stroke='#3b82f6' />
                                                        
                                                        {/* Inner hollow cylinder ellipse if ID > 0 */}
                                                        {stockInnerDiameter !== null && stockInnerDiameter > 0 && (
                                                            <ellipse cx="60" cy="25" rx="12" ry="4" strokeDasharray="2,2" stroke="#64748b" />
                                                        )}

                                                        {/* OD Extension lines */}
                                                        <line x1="30" y1="24" x2="30" y2="10" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        <line x1="90" y1="24" x2="90" y2="10" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        {/* OD Dimension line with arrows */}
                                                        <path d="M 32 12 L 88 12" stroke="#ffffff" strokeWidth="0.75" markerStart="url(#arrow)" markerEnd="url(#arrow)" />

                                                        {/* ID Dimension line if ID > 0 with arrows */}
                                                        {stockInnerDiameter !== null && stockInnerDiameter > 0 && (
                                                            <>
                                                                <line x1="48" y1="25" x2="48" y2="38" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                                <line x1="72" y1="25" x2="72" y2="38" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                                <path d="M 50 35 L 70 35" stroke="#f59e0b" strokeWidth="0.75" markerStart="url(#arrow-amber)" markerEnd="url(#arrow-amber)" />
                                                            </>
                                                        )}

                                                        {/* Height/Length extension lines */}
                                                        <line x1="28" y1="25" x2="14" y2="25" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        <line x1="28" y1="75" x2="14" y2="75" stroke="#64748b" strokeWidth="0.5" strokeDasharray="1,1" />
                                                        {/* Height/Length Dimension line with arrows */}
                                                        <path d="M 16 27 L 16 73" stroke="#ffffff" strokeWidth="0.75" markerStart="url(#arrow)" markerEnd="url(#arrow)" />

                                                        {/* Thin Clean White Labels with custom letter spacing */}
                                                        <text x="60" y="6" fill="#ffffff" fontSize="9" fontFamily="sans-serif" style={{ fontWeight: 300, letterSpacing: '0.06em' }} textAnchor="middle">
                                                            OD: {stockOuterDiameter ? `${stockOuterDiameter}mm` : 'Auto'}
                                                        </text>
                                                        {stockInnerDiameter !== null && stockInnerDiameter > 0 && (
                                                            <text x="60" y="44" fill="#f59e0b" fontSize="8" fontFamily="sans-serif" style={{ fontWeight: 300, letterSpacing: '0.06em' }} textAnchor="middle">
                                                                ID: {stockInnerDiameter}mm
                                                            </text>
                                                        )}
                                                        <text x="6" y="53" fill="#ffffff" fontSize="9" fontFamily="sans-serif" style={{ fontWeight: 300, letterSpacing: '0.06em' }} textAnchor="end">
                                                            L: {stockLengthZ ? `${stockLengthZ}mm` : 'Auto'}
                                                        </text>
                                                    </svg>
                                                    
                                                    <div className="w-full flex items-center justify-between border-t border-zinc-850 pt-3 mt-1.5 text-[9px] text-zinc-500 font-mono tracking-wider">
                                                        <span>SCALE: 1:1</span>
                                                        <span>UNITS: MM</span>
                                                        <span>CYLINDER STOCK</span>
                                                    </div>
                                                </div>
                                            )}
                                            <div className="text-center">
                                                <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wide font-sans">{stockType === 'block' ? 'Prismatic Envelope' : 'Axisymmetric Cylinder'}</p>
                                                <p className="text-[11px] text-zinc-500 font-sans mt-1">{stockType === 'block' ? '3/5-Axis Milling · Layer-by-layer Z descent' : 'Lathe / Turning · Diametral programming'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 3: Tool Library */}
                            {currentStep === 'tools' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    <div className="flex justify-between items-center border border-zinc-800/80 bg-zinc-900/30 rounded-xl px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <Gauge size={14} className="text-blue-400" />
                                            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide font-sans">Tool Library</span>
                                            <span className="bg-zinc-800 border border-zinc-700/60 text-zinc-300 text-[10px] font-mono px-2 py-0.5 rounded-full">{tools.length}</span>
                                        </div>
                                        <button onClick={handleAddTool}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors">
                                            <Plus size={14} /> Add Tool
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {tools.map((tool, idx) => (
                                            <div key={idx} className="border border-zinc-800/80 bg-zinc-900/20 rounded-xl p-5">
                                                <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className="bg-blue-500/15 text-blue-400 border border-blue-500/20 text-xs font-semibold px-2 py-0.5 rounded-md font-mono">T{tool.number}</span>
                                                        <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-800 border border-zinc-700/60 rounded px-2 py-0.5 uppercase tracking-wider">{tool.type.replace('_',' ')}</span>
                                                        <span className="text-xs font-semibold text-zinc-200">{tool.description || `Tool T${tool.number}`}</span>
                                                    </div>
                                                    <button onClick={() => handleRemoveTool(idx)}
                                                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 border border-zinc-800 hover:border-red-500/20 rounded-lg transition-all">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                <div className="flex flex-col md:flex-row gap-5">
                                                    {renderToolSvg(tool.diameter)}
                                                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-4">
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Slot #</label>
                                                            <input type="number" min="1" value={tool.number}
                                                                onChange={(e) => handleToolChange(idx, 'number', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Type</label>
                                                            <div className="relative">
                                                                <select value={tool.type} onChange={(e) => handleToolChange(idx, 'type', e.target.value)}
                                                                    className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none appearance-none cursor-pointer">
                                                                    {['endmill','ballnose','drill','face','turning_rough','turning_finish'].map(t => (
                                                                        <option key={t} value={t} className="bg-zinc-950">{t.replace('_',' ')}</option>
                                                                    ))}
                                                                </select>
                                                                <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-zinc-500 pointer-events-none" />
                                                            </div>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Dia (mm)</label>
                                                            <input type="number" step="0.001" value={tool.diameter}
                                                                onChange={(e) => handleToolChange(idx, 'diameter', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Flute L (mm)</label>
                                                            <input type="number" step="1" value={tool.flute_length ?? 25}
                                                                onChange={(e) => handleToolChange(idx, 'flute_length', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Spindle (RPM)</label>
                                                            <input type="number" value={tool.spindle_speed}
                                                                onChange={(e) => handleToolChange(idx, 'spindle_speed', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Feed (mm/m)</label>
                                                            <input type="number" value={tool.feed_rate}
                                                                onChange={(e) => handleToolChange(idx, 'feed_rate', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Plunge (mm/m)</label>
                                                            <input type="number" value={tool.plunge_rate}
                                                                onChange={(e) => handleToolChange(idx, 'plunge_rate', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-mono text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                        <div className="space-y-1 col-span-2 sm:col-span-1">
                                                            <label className="text-[10px] font-medium text-zinc-400">Description</label>
                                                            <input type="text" value={tool.description}
                                                                onChange={(e) => handleToolChange(idx, 'description', e.target.value)}
                                                                className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none transition-colors" />
                                                        </div>
                                                    </div>
                                                    <div className="w-full md:w-40 shrink-0 space-y-2 border-t md:border-t-0 md:border-l border-zinc-800/80 pt-3 md:pt-0 md:pl-4">
                                                        <div className="flex items-center gap-1.5 pb-1.5 border-b border-zinc-800/80">
                                                            <Sparkles size={12} className="text-amber-500" />
                                                            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">Presets</span>
                                                        </div>
                                                        <div className="space-y-1">
                                                            {MATERIAL_CHIPS.map((mat) => (
                                                                <button key={mat.name} onClick={() => handleApplyMaterialPreset(idx, mat.name)}
                                                                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/30 hover:border-blue-500/50 hover:bg-blue-500/5 text-left transition-all">
                                                                    <span className="text-xs font-medium text-zinc-300">{mat.label}</span>
                                                                    <span className="text-[9px] font-sans text-zinc-500">{mat.type}</span>
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* STEP 4: Operations */}
                            {currentStep === 'operations' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    <div className="flex justify-between items-center border border-zinc-800/80 bg-zinc-900/30 rounded-xl px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <Layers size={14} className="text-blue-400" />
                                            <span className="text-xs font-semibold text-zinc-300 uppercase tracking-wide font-sans">Pipeline Sequence</span>
                                            <span className="bg-zinc-800 border border-zinc-700/60 text-zinc-300 text-[10px] font-mono px-2 py-0.5 rounded-full">{operations.length}</span>
                                        </div>
                                        <button onClick={handleAddOperation}
                                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors">
                                            <Plus size={14} /> Add Op
                                        </button>
                                    </div>

                                    <div className="space-y-4">
                                        {operations.map((op, idx) => {
                                            const passes = getPassCount(op.cutting_depth, op.stepdown);
                                            const isWarn = op.cutting_depth < op.stepdown;
                                            return (
                                                <div key={idx} className={`border rounded-xl bg-zinc-900/20 p-5 ${isWarn ? 'border-red-500/30 bg-red-500/5' : 'border-zinc-800/80'}`}>
                                                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3 mb-4">
                                                        <div className="flex items-center gap-2.5">
                                                            <span className="bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-bold font-mono px-2 py-0.5 rounded">{String(idx+1).padStart(2,'0')}</span>
                                                            <input type="text" value={op.name}
                                                                onChange={(e) => handleOperationChange(idx, 'name', e.target.value)}
                                                                className="bg-transparent border-b border-transparent hover:border-zinc-800 focus:border-blue-500 focus:outline-none text-xs font-semibold text-zinc-200 w-44 px-1 py-0.5 rounded" />
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <button onClick={() => handleMoveOpUp(idx)} disabled={idx===0}
                                                                className="p-1 border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 rounded-lg transition-all">
                                                                <ChevronUp size={14} />
                                                            </button>
                                                            <button onClick={() => handleMoveOpDown(idx)} disabled={idx===operations.length-1}
                                                                className="p-1 border border-zinc-800 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 rounded-lg transition-all">
                                                                <ChevronDown size={14} />
                                                            </button>
                                                            <button onClick={() => handleRemoveOperation(idx)}
                                                                className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 border border-zinc-800 hover:border-red-500/20 rounded-lg transition-all">
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-col lg:flex-row gap-5">
                                                        <div className="w-full lg:w-44 shrink-0 space-y-2">
                                                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-400">
                                                                <span>Strategy</span>
                                                                <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                                    <HelpCircle size={12} />
                                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2.5 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                        Hover individual strategy options to view details on tool paths and operation types.
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="grid grid-cols-4 lg:grid-cols-3 gap-1">
                                                                {(['surface','profile','pocket','engrave','drill','face','turn_rough','turn_finish'] as const).map(strat => {
                                                                    const isS = op.strategy === strat;
                                                                    const short = strat === 'turn_rough' ? 'T.Rough' : strat === 'turn_finish' ? 'T.Fin' : strat.charAt(0).toUpperCase()+strat.slice(1);
                                                                    return (
                                                                        <div key={strat} className="relative group">
                                                                            <button onClick={() => handleOperationChange(idx, 'strategy', strat)}
                                                                                className={`w-full py-1 text-[10px] font-medium rounded transition-all border ${
                                                                                    isS 
                                                                                        ? 'bg-blue-600 text-white border-blue-500' 
                                                                                        : 'border-zinc-800 text-zinc-400 bg-zinc-900/30 hover:border-zinc-700 hover:text-zinc-200'
                                                                                }`}>
                                                                                {short}
                                                                            </button>
                                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-300 rounded shadow-md z-30 leading-normal">
                                                                                {STRATEGY_DESCRIPTIONS[strat]}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                            <p className="text-[11px] text-zinc-500 leading-snug">{STRATEGY_DESCRIPTIONS[op.strategy].split(':')[0]}</p>
                                                        </div>

                                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
                                                            <div className="space-y-1">
                                                                <label className="text-[10px] font-medium text-zinc-400">Active Tool</label>
                                                                <div className="relative">
                                                                    <select value={op.tool_number} onChange={(e) => handleOperationChange(idx, 'tool_number', e.target.value)}
                                                                        className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none appearance-none cursor-pointer">
                                                                        {tools.map(t => <option key={t.number} value={t.number} className="bg-zinc-950">T{t.number} ({t.diameter}mm)</option>)}
                                                                    </select>
                                                                    <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-zinc-500 pointer-events-none" />
                                                                </div>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <label className="text-[10px] font-medium text-zinc-400">Units</label>
                                                                <div className="relative">
                                                                    <select value={op.units} onChange={(e) => handleOperationChange(idx, 'units', e.target.value)}
                                                                        className="w-full h-9 border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-200 rounded-lg focus:border-blue-500 focus:outline-none appearance-none cursor-pointer">
                                                                        <option value="metric" className="bg-zinc-950">Metric (mm)</option>
                                                                        <option value="imperial" className="bg-zinc-950">Imperial (in)</option>
                                                                    </select>
                                                                    <ChevronDown size={14} className="absolute right-2.5 top-2.5 text-zinc-500 pointer-events-none" />
                                                                </div>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                                                                    <span>Cut Depth</span>
                                                                    <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                                        <HelpCircle size={10} />
                                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-36 p-2 bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                            Total depth to be cut into the raw stock workpiece.
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <input type="number" step="0.5" value={op.cutting_depth}
                                                                    onChange={(e) => handleOperationChange(idx, 'cutting_depth', e.target.value)}
                                                                    className={`w-full h-9 border bg-zinc-950 px-3 py-1.5 text-xs font-mono rounded-lg focus:outline-none transition-colors ${isWarn ? 'border-red-500 text-red-400 focus:border-red-500' : 'border-zinc-800 text-zinc-200 focus:border-blue-500'}`} />
                                                            </div>
                                                            <div className="space-y-1">
                                                                <div className="flex items-center gap-1 text-[10px] font-medium text-zinc-400">
                                                                    <span>Stepdown</span>
                                                                    <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                                        <HelpCircle size={10} />
                                                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-36 p-2 bg-zinc-950 border border-zinc-800 text-[10px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                            Maximum depth of material removed per pass in the Z axis.
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <input type="number" step="0.25" value={op.stepdown}
                                                                    onChange={(e) => handleOperationChange(idx, 'stepdown', e.target.value)}
                                                                    className={`w-full h-9 border bg-zinc-950 px-3 py-1.5 text-xs font-mono rounded-lg focus:outline-none transition-colors ${isWarn ? 'border-red-500 text-red-400 focus:border-red-500' : 'border-zinc-800 text-zinc-200 focus:border-blue-500'}`} />
                                                            </div>
                                                            <div className="col-span-2 md:col-span-4 space-y-2">
                                                                <div className="flex justify-between text-[10px] font-medium text-zinc-400">
                                                                    <div className="flex items-center gap-1">
                                                                        <span>Corner Slowdown</span>
                                                                        <div className="group relative cursor-pointer text-zinc-500 hover:text-zinc-300">
                                                                            <HelpCircle size={10} />
                                                                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2.5 bg-zinc-950 border border-zinc-800 text-[11px] text-zinc-400 rounded-lg shadow-lg z-30 leading-normal">
                                                                                Reduces feed rate along corners and small arcs to avoid tool chatter and deflection.
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <span className="text-blue-400 font-semibold">{(op.corner_slowdown*100).toFixed(0)}%</span>
                                                                </div>
                                                                <input type="range" min="0.10" max="1.00" step="0.05" value={op.corner_slowdown}
                                                                    onChange={(e) => handleOperationChange(idx, 'corner_slowdown', e.target.value)}
                                                                    className="w-full h-1 appearance-none bg-zinc-800 accent-blue-500 rounded-lg cursor-pointer" />
                                                            </div>
                                                        </div>

                                                        <div className="w-full lg:w-40 shrink-0">
                                                            {renderPassVisualizer(op.cutting_depth, op.stepdown)}
                                                        </div>
                                                    </div>

                                                    {isWarn && (
                                                        <div className="flex items-center gap-2 mt-3.5 border border-red-500/20 bg-red-500/5 px-3.5 py-2.5 rounded-lg text-xs text-red-400 font-sans">
                                                            <AlertCircle size={14} className="shrink-0" />
                                                            <span>Stepdown exceeds total cutting depth — invalid pass configuration.</span>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right: Telemetry Sidebar */}
                    <div className="w-64 border-l border-zinc-800 bg-zinc-950 flex flex-col shrink-0">
                        <div className="flex items-center gap-2 border-b border-zinc-800/80 px-4 py-4 shrink-0">
                            <Cpu size={14} className="text-blue-400" />
                            <span className="text-xs font-semibold text-zinc-200 uppercase tracking-wide font-sans">CAM Telemetry</span>
                        </div>

                        <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-xl p-3.5 space-y-2 text-[11px] font-sans">
                                <div className="flex justify-between items-center border-b border-zinc-800/80 pb-2">
                                    <span className="font-semibold text-blue-400 uppercase text-[10px]">Controller</span>
                                    <span className="text-zinc-500 font-mono">v1.2</span>
                                </div>
                                <div className="flex justify-between"><span className="text-zinc-400">Dialect</span><span className="text-zinc-200 font-semibold uppercase">{controller}</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Extension</span><span className="text-blue-400 font-mono font-semibold">{CONTROLLER_DIALECTS.find(d => d.id === controller)?.ext || '.nc'}</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Safe Z</span><span className="text-zinc-200 font-semibold font-mono">{safeZ.toFixed(1)} mm</span></div>
                                <div className="flex justify-between"><span className="text-zinc-400">Coolant</span><span className={`font-semibold font-mono ${coolant ? 'text-emerald-400' : 'text-zinc-500'}`}>{coolant ? 'M08' : 'OFF'}</span></div>
                            </div>

                            <div className="bg-zinc-900/30 border border-zinc-800/80 rounded-xl p-3.5 space-y-2 text-[11px] font-sans">
                                <div className="flex justify-between items-center border-b border-zinc-800/80 pb-2">
                                    <span className="font-semibold text-zinc-300 uppercase text-[10px]">Stock Envelope</span>
                                    <span className="text-zinc-400 font-medium capitalize">{stockType}</span>
                                </div>
                                {stockType === 'block' ? (
                                    <>
                                        <div className="flex justify-between"><span className="text-zinc-400">Length X</span><span className="text-zinc-200 font-semibold">{stockLengthX ? `${stockLengthX}mm` : 'AUTO'}</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Width Y</span><span className="text-zinc-200 font-semibold">{stockWidthY ? `${stockWidthY}mm` : 'AUTO'}</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Height Z</span><span className="text-zinc-200 font-semibold">{stockHeightZ ? `${stockHeightZ}mm` : 'AUTO'}</span></div>
                                    </>
                                ) : (
                                    <>
                                        <div className="flex justify-between"><span className="text-zinc-400">Outer Dia</span><span className="text-zinc-200 font-semibold">{stockOuterDiameter ? `${stockOuterDiameter}mm` : 'AUTO'}</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Inner Dia</span><span className="text-zinc-200 font-semibold">{stockInnerDiameter}mm</span></div>
                                        <div className="flex justify-between"><span className="text-zinc-400">Length Z</span><span className="text-zinc-200 font-semibold">{stockLengthZ ? `${stockLengthZ}mm` : 'AUTO'}</span></div>
                                    </>
                                )}
                            </div>

                            <div className="space-y-2">
                                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Tool Register</span>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {tools.map(t => (
                                        <div key={t.number} className="flex items-center justify-between px-2.5 py-1.5 border border-zinc-800 rounded-lg bg-zinc-900/20 text-xs">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1.5 py-0.5 rounded font-mono">T{t.number}</span>
                                                <span className="text-zinc-300 truncate font-medium">{t.description || 'Endmill'}</span>
                                            </div>
                                            <span className="text-blue-400 font-semibold font-mono shrink-0 ml-1">{t.diameter.toFixed(2)}mm</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wide">Operation Flow</span>
                                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                    {operations.map((op, i) => (
                                        <div key={i} className="pl-2.5 border-l border-zinc-800 py-0.5">
                                            <div className="bg-zinc-900/20 border border-zinc-800/80 rounded-lg p-2.5 text-xs space-y-1">
                                                <div className="flex justify-between gap-1.5">
                                                    <span className="font-semibold text-zinc-200 truncate uppercase text-[10px]">{op.name}</span>
                                                    <span className="text-blue-400 text-[10px] font-mono capitalize">{op.strategy}</span>
                                                </div>
                                                <div className="flex justify-between text-[10px] text-zinc-500">
                                                    <span>Tool T{op.tool_number}</span>
                                                    <span className="font-mono text-zinc-400">{getPassCount(op.cutting_depth, op.stepdown)} Passes</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="p-4 border-t border-zinc-800 shrink-0">
                            {validationIssues.length > 0 ? (
                                <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-3.5 space-y-1.5 font-sans">
                                    <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
                                        <AlertCircle size={14} /> Compilation Blocked
                                    </div>
                                    <ul className="text-zinc-400 text-[11px] space-y-0.5 list-disc list-inside">
                                        {validationIssues.map((iss, i) => <li key={i} className="truncate">{iss}</li>)}
                                    </ul>
                                </div>
                            ) : (
                                <div className="border border-emerald-500/20 bg-emerald-500/5 rounded-xl p-3.5 font-sans">
                                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                                        <ShieldCheck size={14} /> System Verified
                                    </div>
                                    <p className="text-zinc-400 text-[11px] mt-1">Ready to compile clean CNC code.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex justify-between items-center border-t border-zinc-800/80 bg-zinc-950 px-6 py-4 shrink-0">
                    <div>
                        {currentStep !== 'machine' && (
                            <button onClick={handleBackStep}
                                className="flex items-center gap-1.5 px-3.5 py-2 border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:text-zinc-100 text-zinc-300 text-xs font-medium rounded-lg transition-colors">
                                <ChevronLeft size={14} /> Back
                            </button>
                        )}
                    </div>
                    <div className="flex gap-3">
                        <button onClick={onClose}
                            className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs font-medium transition-colors">
                            Cancel
                        </button>
                        {currentStep !== 'operations' ? (
                            <button onClick={handleNextStep}
                                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg shadow-sm transition-colors">
                                Continue <ChevronRight size={14} />
                            </button>
                        ) : (
                            <button onClick={handleFormSubmit} disabled={isGenerating || !isValid}
                                className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-850 disabled:text-zinc-650 text-black text-xs font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50">
                                {isGenerating ? (
                                    <><Loader2 size={14} className="animate-spin" /> Compiling...</>
                                ) : (
                                    <><Play size={12} fill="currentColor" /> Compile G-code</>
                                )}
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}