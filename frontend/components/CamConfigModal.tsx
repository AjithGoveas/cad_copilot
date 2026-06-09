'use client';

import { useState, useEffect } from 'react';
import { 
    X, Plus, Trash2, Settings, Hammer, Layers, AlertCircle, Play, Loader2, 
    Sparkles, ChevronRight, ChevronLeft, ShieldCheck, Gauge, Zap, 
    ChevronUp, ChevronDown, Cpu, Check, Info
} from 'lucide-react';
import { toast } from 'sonner';

export interface ToolConfig {
    number: number;
    type: 'endmill' | 'ballnose' | 'drill' | 'face';
    diameter: number;
    spindle_speed: number;
    feed_rate: number;
    plunge_rate: number;
    description: string;
}

export interface OperationConfig {
    name: string;
    strategy: 'surface' | 'profile' | 'pocket' | 'engrave' | 'drill' | 'face';
    tool_number: number;
    cutting_depth: number;
    stepdown: number;
    units: 'metric' | 'imperial';
    corner_slowdown: number;
}

export interface CamConfig {
    controller: string;
    safe_z: number;
    coolant: boolean;
    resolution: number;
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

type StepType = 'machine' | 'tools' | 'operations';

const CONTROLLER_DIALECTS = [
    { id: 'fanuc', name: 'Fanuc Dialect', desc: 'Standard ISO G-code compatible with most CNC machinery.', ext: '.nc' },
    { id: 'haas', name: 'Haas CNC', desc: 'Optimized for Haas VF mills with native canned cycle syntax.', ext: '.nc' },
    { id: 'siemens', name: 'Siemens Sinumerik', desc: 'Formatted for Siemens 840D/828D controls with SHOPMILL.', ext: '.mpf' },
    { id: 'heidenhain', name: 'Heidenhain ISO', desc: 'ISO format compatible with Heidenhain TNC controls.', ext: '.i' },
    { id: 'mazak', name: 'Mazak EIA', desc: 'EIA/ISO G-code standard formatted for Mazatrol processors.', ext: '.eia' },
    { id: 'mitsubishi', name: 'Mitsubishi CNC', desc: 'Optimized G-code dialect syntax for Mitsubishi systems.', ext: '.gcode' },
];

const MATERIAL_CHIPS = [
    { name: 'Aluminum 6061', label: 'Al 6061', type: 'Metal', style: 'border-[#3C3C3C] text-slate-300 hover:border-blue-500/50 hover:bg-blue-500/5' },
    { name: 'Plywood', label: 'Plywood', type: 'Wood', style: 'border-amber-900/40 text-amber-300 hover:border-blue-500/50 hover:bg-blue-500/5' },
    { name: 'Acrylic', label: 'Acrylic', type: 'Plastic', style: 'border-sky-900/40 text-sky-300 hover:border-blue-500/50 hover:bg-blue-500/5' },
    { name: 'Delrin', label: 'Delrin', type: 'Engineering', style: 'border-emerald-900/40 text-emerald-300 hover:border-blue-500/50 hover:bg-blue-500/5' },
    { name: 'Mild Steel', label: 'Steel', type: 'Ferrous', style: 'border-red-950/80 text-red-300 hover:border-blue-500/50 hover:bg-blue-500/5' }
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

    const [tools, setTools] = useState<ToolConfig[]>([
        {
            number: 1,
            type: 'endmill',
            diameter: 3.175,
            spindle_speed: 10000,
            feed_rate: 400,
            plunge_rate: 150,
            description: '1/8in Flat Endmill'
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
                description: `Tool T${nextNum}`
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
            tools,
            operations
        });
    };

    // --- SVGs & Render Helpers ---
    const renderToolSvg = (diameter: number) => {
        const displayWidth = Math.max(8, Math.min(40, diameter * 3.5));
        return (
            <div className="flex flex-col items-center justify-center bg-[#1E1E1E] border border-[#3C3C3C] rounded-lg p-3 h-32 w-24 shrink-0">
                <svg width="48" height="72" viewBox="0 0 48 72" className="text-blue-500/70 drop-shadow-[0_0_8px_rgba(59,130,246,0.25)]">
                    {/* Shank */}
                    <rect x="18" y="2" width="12" height="28" fill="currentColor" opacity="0.25" rx="1" />
                    {/* Taper transition */}
                    <polygon points={`18,30 30,30 ${24 + displayWidth/2},34 ${24 - displayWidth/2},34`} fill="currentColor" opacity="0.4" />
                    {/* Flutes */}
                    <rect x={24 - displayWidth/2} y="34" width={displayWidth} height="28" fill="currentColor" rx="1" />
                    {/* Flute Spiral patterns */}
                    <path d={`M ${24 - displayWidth/2} 40 Q 24 43 ${24 + displayWidth/2} 45`} stroke="#1e1e1e" strokeWidth="1.5" fill="none" opacity="0.7"/>
                    <path d={`M ${24 - displayWidth/2} 50 Q 24 53 ${24 + displayWidth/2} 55`} stroke="#1e1e1e" strokeWidth="1.5" fill="none" opacity="0.7"/>
                    {/* Tip */}
                    <polygon points={`${24 - displayWidth/2},62 ${24 + displayWidth/2},62 24,66`} fill="currentColor" />
                </svg>
                <span className="text-[9px] font-mono font-bold text-zinc-500 mt-1">{diameter.toFixed(3)}mm</span>
            </div>
        );
    };

    const renderPassVisualizer = (depth: number, stepdown: number) => {
        const passes = getPassCount(depth, stepdown);
        if (passes === 0) return null;
        
        const maxDisplayLines = 8;
        const displayLines = Math.min(passes, maxDisplayLines);

        return (
            <div className="flex flex-col gap-2 p-3 bg-[#1E1E1E] border border-[#3C3C3C] rounded-lg">
                <div className="flex justify-between items-center text-[10px] uppercase font-bold text-zinc-400">
                    <span className="flex items-center gap-1.5"><Info size={11} className="text-zinc-500"/> Pass Profile</span>
                    <span className="text-blue-400 font-mono text-[10px]">{passes} Cuts</span>
                </div>
                
                <div className="relative h-20 w-full bg-[#252526] border border-[#3C3C3C] rounded-lg overflow-hidden flex flex-col justify-end">
                    <div className="absolute inset-0 bg-gradient-to-b from-zinc-950/10 to-zinc-950/40" />
                    
                    {/* Ramping Indicator */}
                    <div className="absolute top-1 left-2 flex items-center gap-1 opacity-40">
                        <svg width="24" height="12" viewBox="0 0 24 12" className="text-blue-500 fill-none" stroke="currentColor" strokeWidth="1">
                            <path d="M 1,1 L 12,9 L 23,9" strokeDasharray="2,2" />
                            <polygon points="12,9 8,6 8,11" fill="currentColor"/>
                        </svg>
                        <span className="text-[7px] font-bold tracking-wider text-zinc-500 uppercase">Ramp Entry</span>
                    </div>

                    {/* Cut lines */}
                    <div className="relative h-14 w-full flex flex-col justify-between px-2 pb-1.5">
                        {Array.from({ length: displayLines }).map((_, lineIdx) => {
                            const currentDepthVal = ((lineIdx + 1) / passes) * depth;
                            return (
                                <div key={lineIdx} className="w-full relative h-[1px] bg-zinc-800/80">
                                    <div className="absolute left-0 right-0 h-[1px] border-t border-dashed border-blue-500/20" />
                                    <span className="absolute right-0 -top-2 text-[7px] text-zinc-500 font-mono">
                                        -{currentDepthVal.toFixed(2)}mm
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>
                {passes > maxDisplayLines && (
                    <span className="text-[7px] text-zinc-500 text-center font-medium italic">Showing first {maxDisplayLines} of {passes} total stepdowns.</span>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#09090b]/80 backdrop-blur-sm p-4 transition-all duration-300">
            <div className="flex flex-col w-full max-w-6xl h-[85vh] rounded-xl border border-[#3C3C3C] bg-[#252526] shadow-[0_0_80px_-10px_rgba(0,122,204,0.15)] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                
                {/* Custom Studio Header */}
                <div className="flex items-center justify-between border-b border-[#3C3C3C] bg-[#252526] px-6 py-4 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                            <Hammer size={18} />
                        </div>
                        <div>
                            <h3 className="text-[13px] font-semibold text-zinc-100 tracking-wide">CAM Operations Studio</h3>
                            <p className="text-[10px] text-[#A6A6A6]">Formulate and sequence toolpath presets for target controller units.</p>
                        </div>
                    </div>
                    <button 
                        onClick={onClose} 
                        className="rounded-lg p-1.5 text-zinc-500 hover:bg-[#3C3C3C] hover:text-zinc-200 transition-all focus:outline-none"
                    >
                        <X size={15} />
                    </button>
                </div>

                {/* Main Split-Pane Workspace */}
                <div className="flex flex-1 overflow-hidden">
                    
                    {/* Left Pane: Config Tabs & Forms */}
                    <div className="flex-1 flex flex-col min-w-0 bg-[#252526]">
                        
                        {/* Tab wizard timeline */}
                        <div className="flex items-center gap-6 border-b border-[#3C3C3C] bg-[#252526] px-8 py-3 shrink-0">
                            <button
                                onClick={() => setCurrentStep('machine')}
                                className={`flex items-center gap-2 transition-all duration-150 ${
                                    currentStep === 'machine' ? 'text-blue-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                            >
                                <div className={`flex size-5 items-center justify-center rounded-full text-[9px] font-bold border transition-all duration-200 ${
                                    currentStep === 'machine' 
                                        ? 'bg-blue-500/10 border-[#007ACC] text-blue-400 shadow-[0_0_8px_rgba(0,122,204,0.2)]' 
                                        : 'bg-[#1E1E1E] border-[#3C3C3C] text-zinc-500'
                                }`}>
                                    1
                                </div>
                                <span className="text-[11px] font-medium tracking-wide">Machine Configuration</span>
                            </button>

                            <div className="w-8 h-[1px] bg-[#3C3C3C]" />

                            <button
                                onClick={() => setCurrentStep('tools')}
                                className={`flex items-center gap-2 transition-all duration-150 ${
                                    currentStep === 'tools' ? 'text-blue-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                            >
                                <div className={`flex size-5 items-center justify-center rounded-full text-[9px] font-bold border transition-all duration-200 ${
                                    currentStep === 'tools' 
                                        ? 'bg-blue-500/10 border-[#007ACC] text-blue-400 shadow-[0_0_8px_rgba(0,122,204,0.2)]' 
                                        : 'bg-[#1E1E1E] border-[#3C3C3C] text-zinc-500'
                                }`}>
                                    2
                                </div>
                                <span className="text-[11px] font-medium tracking-wide">Tool Library ({tools.length})</span>
                            </button>

                            <div className="w-8 h-[1px] bg-[#3C3C3C]" />

                            <button
                                onClick={() => setCurrentStep('operations')}
                                className={`flex items-center gap-2 transition-all duration-150 ${
                                    currentStep === 'operations' ? 'text-blue-400 font-semibold' : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                            >
                                <div className={`flex size-5 items-center justify-center rounded-full text-[9px] font-bold border transition-all duration-200 ${
                                    currentStep === 'operations' 
                                        ? 'bg-blue-500/10 border-[#007ACC] text-blue-400 shadow-[0_0_8px_rgba(0,122,204,0.2)]' 
                                        : 'bg-[#1E1E1E] border-[#3C3C3C] text-zinc-500'
                                }`}>
                                    3
                                </div>
                                <span className="text-[11px] font-medium tracking-wide">Operations Pipeline ({operations.length})</span>
                            </button>
                        </div>

                        {/* Configuration Form Body */}
                        <div className="flex-1 overflow-y-auto p-6 bg-[#1E1E1E]">
                            
                            {validationError && (
                                <div className="mb-4 flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-xs text-red-200 animate-in fade-in duration-200">
                                    <AlertCircle size={14} className="text-red-400 shrink-0" />
                                    <span className="font-semibold">{validationError}</span>
                                </div>
                            )}

                            {/* STEP 1: Machine Setup */}
                            {currentStep === 'machine' && (
                                <div className="max-w-3xl mx-auto py-2 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    
                                    <div className="space-y-3">
                                        <label className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">Select CNC Controller Dialect</label>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {CONTROLLER_DIALECTS.map((dial) => {
                                                const isSel = controller === dial.id;
                                                return (
                                                    <button
                                                        key={dial.id}
                                                        onClick={() => setController(dial.id)}
                                                        className={`flex items-start gap-3 p-4 rounded-lg border text-left transition-all duration-200 ${
                                                            isSel 
                                                                ? 'border-[#007ACC]/50 bg-[#007ACC]/5 ring-1 ring-[#007ACC]/20' 
                                                                : 'border-[#3C3C3C] bg-[#252526]/50 hover:border-zinc-700 hover:bg-[#252526]'
                                                        }`}
                                                    >
                                                        <div className={`flex size-5 shrink-0 items-center justify-center rounded-full border transition-all mt-0.5 ${
                                                            isSel ? 'border-[#007ACC] bg-[#007ACC] text-white' : 'border-zinc-700 bg-zinc-950 text-transparent'
                                                        }`}>
                                                            <Check size={11} strokeWidth={3} />
                                                        </div>
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5">
                                                                <span className={`text-xs font-semibold ${isSel ? 'text-blue-400' : 'text-zinc-200'}`}>{dial.name}</span>
                                                                <span className="text-[8px] font-mono bg-[#1E1E1E] border border-[#3C3C3C] text-zinc-500 px-1 rounded">{dial.ext}</span>
                                                            </div>
                                                            <p className="text-[9.5px] text-[#A6A6A6] mt-1 leading-normal">{dial.desc}</p>
                                                        </div>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                                        <div className="flex flex-col gap-2 p-5 rounded-lg border border-[#3C3C3C] bg-[#252526]/30">
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">Safe Clearance Z</label>
                                                <span className="text-xs font-bold text-blue-400 font-mono">{safeZ.toFixed(1)} mm</span>
                                            </div>
                                            <input 
                                                type="range"
                                                min="1.0"
                                                max="15.0"
                                                step="0.5"
                                                value={safeZ}
                                                onChange={(e) => setSafeZ(parseFloat(e.target.value) || 5.0)}
                                                className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#007ACC] my-2"
                                            />
                                            <p className="text-[9.5px] text-[#A6A6A6] leading-normal">Safety height in millimeters above the stock top surface for rapid linear G0 travel relocations.</p>
                                        </div>

                                        <div className="flex items-center justify-between p-5 rounded-lg border border-[#3C3C3C] bg-[#252526]/30">
                                            <div className="flex flex-col gap-1 pr-4">
                                                <div className="flex items-center gap-2">
                                                    <Zap size={14} className="text-blue-400" />
                                                    <span className="text-[10px] font-bold text-zinc-200 tracking-wider uppercase">Coolant Control (M08)</span>
                                                </div>
                                                <p className="text-[9.5px] text-[#A6A6A6] leading-normal">Injects flood coolant start M08 and stop M09 blocks around tooling changes.</p>
                                            </div>
                                            <button
                                                onClick={() => setCoolant(!coolant)}
                                                className={`relative inline-flex h-5 w-10 shrink-0 items-center rounded-full transition-all duration-200 ${
                                                    coolant ? 'bg-[#007ACC] shadow-[0_0_12px_rgba(0,122,204,0.25)]' : 'bg-[#3C3C3C]'
                                                }`}
                                            >
                                                <span
                                                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-all duration-200 ${
                                                        coolant ? 'translate-x-5.5' : 'translate-x-1'
                                                    }`}
                                                />
                                            </button>
                                        </div>
                                    </div>
                                    
                                    {/* Path interpolation resolution */}
                                    <div className="p-5 rounded-lg border border-[#3C3C3C] bg-[#252526]/30">
                                        <div className="flex items-center justify-between">
                                            <label className="text-[10px] font-bold text-zinc-400 tracking-wider uppercase">Path Interpolation Resolution</label>
                                            <span className="text-xs font-bold text-blue-400 font-mono">{resolution.toFixed(2)} mm</span>
                                        </div>
                                        <input 
                                            type="range"
                                            min="0.1"
                                            max="2.0"
                                            step="0.05"
                                            value={resolution}
                                            onChange={(e) => setResolution(parseFloat(e.target.value) || 0.5)}
                                            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#007ACC] my-2"
                                        />
                                        <p className="text-[9.5px] text-[#A6A6A6] leading-normal">Defines the maximum chordal deviation/step size used when interpolating curves into linear segments.</p>
                                    </div>
                                </div>
                            )}

                            {/* STEP 2: Tool Library */}
                            {currentStep === 'tools' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    <div className="flex justify-between items-center bg-[#252526]/40 p-3.5 rounded-lg border border-[#3C3C3C]">
                                        <div className="flex items-center gap-2">
                                            <Gauge size={14} className="text-blue-400" />
                                            <span className="text-[10px] font-bold text-zinc-300 tracking-wider uppercase">Configured Tools ({tools.length})</span>
                                        </div>
                                        <button
                                            onClick={handleAddTool}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#007ACC] hover:bg-[#007ACC]/90 text-[10.5px] font-semibold text-white shadow-lg transition-all duration-150 active:scale-97"
                                        >
                                            <Plus size={12} />
                                            Add Tool
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 gap-4">
                                        {tools.map((tool, idx) => (
                                            <div 
                                                key={idx} 
                                                className="flex flex-col gap-4 rounded-lg border border-[#3C3C3C] bg-[#252526]/20 p-4 hover:border-zinc-700 transition-all duration-250"
                                            >
                                                {/* Header */}
                                                <div className="flex items-center justify-between border-b border-[#3C3C3C]/60 pb-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="flex h-5 px-2 items-center justify-center rounded bg-blue-500/10 text-blue-400 border border-blue-500/10 text-[9px] font-bold font-mono">
                                                            T{tool.number} ({tool.type.toUpperCase()})
                                                        </span>
                                                        <span className="text-xs font-bold text-zinc-300">{tool.description || `Tool T${tool.number}`}</span>
                                                    </div>
                                                    <button
                                                        onClick={() => handleRemoveTool(idx)}
                                                        className="p-1 rounded text-zinc-500 hover:bg-red-500/5 hover:text-red-400 border border-transparent hover:border-red-950/20 transition-all shrink-0"
                                                        title="Delete tool"
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>

                                                <div className="flex flex-col md:flex-row gap-4 items-stretch">
                                                    {/* Left: 2D Visualizer */}
                                                    {renderToolSvg(tool.diameter)}

                                                    {/* Center: Specs Grid */}
                                                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-6 gap-3">
                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Slot ID</label>
                                                            <input
                                                                type="number"
                                                                min="1"
                                                                value={tool.number}
                                                                onChange={(e) => handleToolChange(idx, 'number', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            />
                                                        </div>

                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Type</label>
                                                            <select
                                                                value={tool.type}
                                                                onChange={(e) => handleToolChange(idx, 'type', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            >
                                                                <option value="endmill">Endmill</option>
                                                                <option value="ballnose">Ballnose</option>
                                                                <option value="drill">Drill</option>
                                                                <option value="face">Face Mill</option>
                                                            </select>
                                                        </div>

                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Dia (mm)</label>
                                                            <input
                                                                type="number"
                                                                step="0.001"
                                                                value={tool.diameter}
                                                                onChange={(e) => handleToolChange(idx, 'diameter', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            />
                                                        </div>

                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Spindle (RPM)</label>
                                                            <input
                                                                type="number"
                                                                value={tool.spindle_speed}
                                                                onChange={(e) => handleToolChange(idx, 'spindle_speed', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            />
                                                        </div>

                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Feed (mm/m)</label>
                                                            <input
                                                                type="number"
                                                                value={tool.feed_rate}
                                                                onChange={(e) => handleToolChange(idx, 'feed_rate', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            />
                                                        </div>

                                                        <div className="flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Plunge (mm/m)</label>
                                                            <input
                                                                type="number"
                                                                value={tool.plunge_rate}
                                                                onChange={(e) => handleToolChange(idx, 'plunge_rate', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            />
                                                        </div>

                                                        <div className="col-span-2 sm:col-span-6 flex flex-col gap-1">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Description</label>
                                                            <input
                                                                type="text"
                                                                value={tool.description}
                                                                onChange={(e) => handleToolChange(idx, 'description', e.target.value)}
                                                                className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2.5 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Right: Presets */}
                                                    <div className="w-full md:w-44 shrink-0 flex flex-col gap-1.5 md:border-l md:border-[#3C3C3C]/60 md:pl-4">
                                                        <div className="flex items-center gap-1">
                                                            <Sparkles size={11} className="text-blue-400" />
                                                            <label className="text-[9px] uppercase font-bold text-zinc-400">Material Speeds</label>
                                                        </div>
                                                        <div className="grid grid-cols-2 md:grid-cols-1 gap-1.5 pt-0.5">
                                                            {MATERIAL_CHIPS.map((mat) => (
                                                                <button
                                                                    key={mat.name}
                                                                    onClick={() => handleApplyMaterialPreset(idx, mat.name)}
                                                                    className={`flex items-center justify-between px-2.5 py-1 rounded-lg border text-left transition-all duration-150 active:scale-97 ${mat.style}`}
                                                                >
                                                                    <span className="text-[10px] font-semibold">{mat.label}</span>
                                                                    <span className="text-[7.5px] text-zinc-500 opacity-80">{mat.type}</span>
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

                            {/* STEP 3: Operations Setup */}
                            {currentStep === 'operations' && (
                                <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-200">
                                    <div className="flex justify-between items-center bg-[#252526]/40 p-3.5 rounded-lg border border-[#3C3C3C]">
                                        <div className="flex items-center gap-2">
                                            <Layers size={14} className="text-blue-400" />
                                            <span className="text-[10px] font-bold text-zinc-300 tracking-wider uppercase">Pipeline Sequence ({operations.length})</span>
                                        </div>
                                        <button
                                            onClick={handleAddOperation}
                                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#007ACC] hover:bg-[#007ACC]/90 text-[10.5px] font-semibold text-white shadow-lg transition-all duration-150 active:scale-97"
                                        >
                                            <Plus size={12} />
                                            Add Op
                                        </button>
                                    </div>

                                    <div className="space-y-3.5">
                                        {operations.map((op, idx) => {
                                            const passes = getPassCount(op.cutting_depth, op.stepdown);
                                            const isDepthWarning = op.cutting_depth < op.stepdown;
                                            return (
                                                <div 
                                                    key={idx} 
                                                    className={`flex flex-col gap-4 rounded-lg border p-4 transition-all duration-200 ${
                                                        isDepthWarning 
                                                            ? 'border-red-500/25 bg-red-950/5 shadow-[0_0_15px_rgba(239,68,68,0.03)]' 
                                                            : 'border-[#3C3C3C] bg-[#252526]/10 hover:border-zinc-700'
                                                    }`}
                                                >
                                                    {/* Header */}
                                                    <div className="flex items-center justify-between border-b border-[#3C3C3C]/60 pb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1E1E1E] border border-[#3C3C3C] text-[9px] font-bold text-zinc-400">
                                                                {idx + 1}
                                                            </span>
                                                            <input
                                                                type="text"
                                                                value={op.name}
                                                                onChange={(e) => handleOperationChange(idx, 'name', e.target.value)}
                                                                className="h-7 w-44 bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-[#007ACC] focus:outline-none text-xs font-bold text-zinc-300 transition-all px-1"
                                                            />
                                                        </div>
                                                        <div className="flex items-center gap-1.5">
                                                            <button
                                                                onClick={() => handleMoveOpUp(idx)}
                                                                disabled={idx === 0}
                                                                className="p-1 rounded text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:hover:text-zinc-500 transition-all"
                                                                title="Move Operation Up"
                                                            >
                                                                <ChevronUp size={13} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleMoveOpDown(idx)}
                                                                disabled={idx === operations.length - 1}
                                                                className="p-1 rounded text-zinc-500 hover:text-zinc-300 disabled:opacity-30 disabled:hover:text-zinc-500 transition-all"
                                                                title="Move Operation Down"
                                                            >
                                                                <ChevronDown size={13} />
                                                            </button>
                                                            <div className="w-[1px] h-3.5 bg-[#3C3C3C] mx-1" />
                                                            <button
                                                                onClick={() => handleRemoveOperation(idx)}
                                                                className="p-1 rounded text-zinc-500 hover:bg-red-500/5 hover:text-red-400 border border-transparent hover:border-red-950/20 transition-all shrink-0"
                                                                title="Delete Operation"
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    <div className="flex flex-col lg:flex-row gap-4 items-stretch">
                                                        {/* Strategy Selection */}
                                                        <div className="w-full lg:w-44 shrink-0 flex flex-col gap-1.5">
                                                            <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Milling Strategy</label>
                                                            <div className="grid grid-cols-3 gap-1">
                                                                {(['surface', 'profile', 'pocket', 'engrave', 'drill', 'face'] as const).map((strat) => (
                                                                    <button
                                                                        key={strat}
                                                                        onClick={() => handleOperationChange(idx, 'strategy', strat)}
                                                                        className={`flex flex-col items-center justify-center py-2.5 rounded-lg border text-[8px] font-bold uppercase transition-all duration-150 ${
                                                                            op.strategy === strat
                                                                                ? 'border-[#007ACC]/40 bg-[#007ACC]/5 text-blue-400'
                                                                                : 'border-[#3C3C3C] bg-[#1E1E1E]/40 text-zinc-500 hover:text-[#D4D4D4] hover:border-zinc-700'
                                                                        }`}
                                                                    >
                                                                        {strat === 'profile' && <Layers size={11} className="mb-1" />}
                                                                        {strat === 'pocket' && <Hammer size={11} className="mb-1" />}
                                                                        {strat === 'surface' && <Cpu size={11} className="mb-1" />}
                                                                        {strat === 'engrave' && <Sparkles size={11} className="mb-1" />}
                                                                        {strat === 'drill' && <Info size={11} className="mb-1" />}
                                                                        {strat === 'face' && <Settings size={11} className="mb-1" />}
                                                                        {strat}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        {/* Parameters inputs */}
                                                        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3.5">
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Active Tool</label>
                                                                <select
                                                                    value={op.tool_number}
                                                                    onChange={(e) => handleOperationChange(idx, 'tool_number', e.target.value)}
                                                                    className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                                >
                                                                    {tools.map(t => (
                                                                        <option key={t.number} value={t.number}>
                                                                            T{t.number} ({t.diameter}mm)
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Units</label>
                                                                <select
                                                                    value={op.units}
                                                                    onChange={(e) => handleOperationChange(idx, 'units', e.target.value)}
                                                                    className="w-full h-8 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] px-2 text-xs text-zinc-200 focus:border-[#007ACC] focus:outline-none transition-all"
                                                                >
                                                                    <option value="metric">Metric (mm)</option>
                                                                    <option value="imperial">Imperial (in)</option>
                                                                </select>
                                                            </div>

                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Cutting Depth</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.5"
                                                                    value={op.cutting_depth}
                                                                    onChange={(e) => handleOperationChange(idx, 'cutting_depth', e.target.value)}
                                                                    className={`w-full h-8 rounded-lg border bg-[#1E1E1E] px-2.5 text-xs text-zinc-200 focus:outline-none transition-all ${
                                                                        isDepthWarning 
                                                                            ? 'border-red-500/60 text-red-200' 
                                                                            : 'border-[#3C3C3C] focus:border-[#007ACC]'
                                                                    }`}
                                                                />
                                                            </div>

                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Pass Stepdown</label>
                                                                <input
                                                                    type="number"
                                                                    step="0.25"
                                                                    value={op.stepdown}
                                                                    onChange={(e) => handleOperationChange(idx, 'stepdown', e.target.value)}
                                                                    className={`w-full h-8 rounded-lg border bg-[#1E1E1E] px-2.5 text-xs text-zinc-200 focus:outline-none transition-all ${
                                                                        isDepthWarning 
                                                                            ? 'border-red-500/60 text-red-200' 
                                                                            : 'border-[#3C3C3C] focus:border-[#007ACC]'
                                                                    }`}
                                                                />
                                                            </div>

                                                            <div className="col-span-2 md:col-span-4 flex flex-col gap-1.5 mt-1">
                                                                <div className="flex justify-between items-center text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                                                                    <span>Corner Slowdown Factor</span>
                                                                    <span className="text-blue-400 font-mono">{(op.corner_slowdown * 100).toFixed(0)}%</span>
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <input
                                                                        type="range"
                                                                        min="0.10"
                                                                        max="1.00"
                                                                        step="0.05"
                                                                        value={op.corner_slowdown}
                                                                        onChange={(e) => handleOperationChange(idx, 'corner_slowdown', e.target.value)}
                                                                        className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#007ACC]"
                                                                    />
                                                                    <span className="text-[8px] text-zinc-600 font-medium shrink-0">Decelerates over 30° bends.</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Right: Pass Visualizer */}
                                                        <div className="w-full lg:w-44 shrink-0">
                                                            {renderPassVisualizer(op.cutting_depth, op.stepdown)}
                                                        </div>
                                                    </div>

                                                    {isDepthWarning && (
                                                        <div className="flex items-center gap-2 text-[9px] text-red-400 font-semibold bg-red-950/20 border border-red-900/10 p-2 rounded-lg animate-in fade-in duration-200">
                                                            <AlertCircle size={12} className="shrink-0" />
                                                            <span>Warning: Stepdown cannot exceed total target cutting depth.</span>
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

                    {/* Right Pane: Live CAM Program Inspector Sidebar */}
                    <div className="w-80 border-l border-[#3C3C3C] bg-[#252526] p-5 flex flex-col justify-between shrink-0 overflow-y-auto">
                        <div className="space-y-5">
                            
                            {/* Header */}
                            <div className="flex items-center justify-between border-b border-[#3C3C3C] pb-3">
                                <div className="flex items-center gap-2">
                                    <Cpu size={14} className="text-blue-400" />
                                    <span className="text-[11px] font-semibold text-zinc-200 tracking-wide">CAM Live Inspector</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className={`h-1.5 w-1.5 rounded-full ${isValid ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                                    <span className={`text-[8.5px] font-bold uppercase ${isValid ? 'text-emerald-500' : 'text-red-500'}`}>
                                        {isValid ? 'Ready' : 'Error'}
                                    </span>
                                </div>
                            </div>

                            {/* Section 1: Controller Dialect */}
                            <div className="space-y-1.5 p-3 rounded-lg border border-[#3C3C3C] bg-[#1E1E1E]/50">
                                <span className="text-[8.5px] uppercase font-bold text-zinc-500 tracking-wider">Controller Unit</span>
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-zinc-300 capitalize text-[11px]">
                                        {CONTROLLER_DIALECTS.find(d => d.id === controller)?.name || controller}
                                    </span>
                                    <span className="text-[9px] font-mono text-zinc-500">
                                        {CONTROLLER_DIALECTS.find(d => d.id === controller)?.ext || '.nc'}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between text-[9.5px] text-[#A6A6A6] pt-1 border-t border-[#3C3C3C]/40 mt-1">
                                    <span>Safe Z: <strong className="text-zinc-400 font-mono">{safeZ.toFixed(1)}mm</strong></span>
                                    <span>Coolant: <strong className="text-zinc-400">{coolant ? 'Active' : 'M09'}</strong></span>
                                </div>
                            </div>

                            {/* Section 2: Loaded Tool Slots */}
                            <div className="space-y-1.5">
                                <span className="text-[8.5px] uppercase font-bold text-zinc-500 tracking-wider">Registered Tool Library</span>
                                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                                    {tools.map((t) => (
                                        <div key={t.number} className="flex items-center justify-between p-2 rounded border border-[#3C3C3C]/50 bg-[#1E1E1E]/30 text-xs">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="text-[8.5px] font-mono font-bold bg-blue-500/10 border border-blue-500/10 text-blue-400 px-1 rounded">T{t.number}</span>
                                                <span className="text-[10px] text-zinc-400 truncate max-w-28">{t.description || 'Flat Endmill'}</span>
                                            </div>
                                            <span className="text-[9.5px] font-mono text-zinc-500 font-semibold">{t.diameter.toFixed(3)}mm</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Section 3: Operations Timeline sequence */}
                            <div className="space-y-2">
                                <span className="text-[8.5px] uppercase font-bold text-zinc-500 tracking-wider">Milling Timeline</span>
                                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                    {operations.map((op, oIdx) => {
                                        const passes = getPassCount(op.cutting_depth, op.stepdown);
                                        return (
                                            <div key={oIdx} className="relative pl-4 border-l border-[#3C3C3C] py-0.5">
                                                {/* Timeline bullet */}
                                                <div className="absolute -left-1 top-2.5 size-2 rounded-full border border-[#252526] bg-[#007ACC] shadow-[0_0_6px_rgba(0,122,204,0.3)]" />
                                                
                                                <div className="p-2 rounded border border-[#3C3C3C] bg-[#1E1E1E]/30 space-y-1">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-semibold text-zinc-300 truncate max-w-32">{op.name}</span>
                                                        <span className="text-[8.5px] uppercase font-bold text-zinc-500 tracking-wider">{op.strategy}</span>
                                                    </div>
                                                    <div className="flex items-center justify-between text-[9.5px] text-[#A6A6A6]">
                                                        <span>Slot: <strong className="text-zinc-400 font-mono">T{op.tool_number}</strong></span>
                                                        <span>Depth: <strong className="text-zinc-400 font-mono">{op.cutting_depth}mm</strong></span>
                                                        <span>Passes: <strong className="text-blue-400 font-mono">{passes}</strong></span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                        </div>

                        {/* Validation Error list or Success Box */}
                        <div className="pt-4 border-t border-[#3C3C3C] mt-4">
                            {validationIssues.length > 0 ? (
                                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 space-y-1.5">
                                    <div className="flex items-center gap-1.5 text-red-400 text-[10px] font-bold uppercase">
                                        <AlertCircle size={12} />
                                        <span>Compilation Blocked</span>
                                    </div>
                                    <ul className="list-disc list-inside text-[9.5px] text-red-300/80 leading-normal space-y-1">
                                        {validationIssues.map((iss, i) => <li key={i}>{iss}</li>)}
                                    </ul>
                                </div>
                            ) : (
                                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1">
                                    <div className="flex items-center gap-1.5 text-emerald-400 text-[10px] font-bold uppercase">
                                        <ShieldCheck size={12} />
                                        <span>Parameters Verified</span>
                                    </div>
                                    <p className="text-[9.5px] text-zinc-500 leading-normal">Operational sequence and tool slots match constraints. Safe to output dialect script.</p>
                                </div>
                            )}
                        </div>

                    </div>
                </div>

                {/* Footer Controls */}
                <div className="flex justify-between items-center border-t border-[#3C3C3C] bg-[#252526] px-6 py-4.5 shrink-0">
                    <div>
                        {currentStep !== 'machine' && (
                            <button
                                onClick={handleBackStep}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#3C3C3C] text-[11px] font-medium text-[#A6A6A6] hover:bg-[#3C3C3C] hover:text-[#D4D4D4] hover:border-zinc-700 transition-all duration-150 active:scale-97"
                            >
                                <ChevronLeft size={12} />
                                Back
                            </button>
                        )}
                    </div>

                    <div className="flex gap-2.5">
                        <button
                            onClick={onClose}
                            className="px-3.5 py-1.5 rounded-lg border border-[#3C3C3C] text-[11px] font-medium text-[#A6A6A6] hover:bg-[#3C3C3C] hover:text-[#D4D4D4] hover:border-zinc-700 transition-all duration-150 active:scale-97"
                        >
                            Cancel
                        </button>
                        
                        {currentStep !== 'operations' ? (
                            <button
                                onClick={handleNextStep}
                                className="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-[#007ACC] hover:bg-[#007ACC]/90 text-[11px] font-medium text-white shadow-lg transition-all duration-150 active:scale-97"
                            >
                                Continue
                                <ChevronRight size={12} />
                            </button>
                        ) : (
                            <button
                                onClick={handleFormSubmit}
                                disabled={isGenerating || !isValid}
                                className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-[#007ACC] hover:bg-[#007ACC]/90 disabled:bg-[#3C3C3C] disabled:text-[#A6A6A6] text-[11px] font-semibold text-white shadow-lg transition-all duration-200 active:scale-97"
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 size={12} className="animate-spin shrink-0 text-white" />
                                        Compiling Pipeline...
                                    </>
                                ) : (
                                    <>
                                        <Play size={10} fill="currentColor" />
                                        Compile G-code
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                </div>

            </div>
        </div>
    );
}
