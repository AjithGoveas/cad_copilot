'use client';

import { useState, useCallback, useMemo, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import { Viewport } from './Viewport';
import { useCADEngine } from '@/hooks/useCADEngine';
import CamConfigModal, { CamConfig } from './CamConfigModal';
import { toast } from 'sonner';
import { AlertCircle, Share2, Download, ChevronDown, Layers, Box, Loader2, Cpu } from 'lucide-react';
import { extractStructuredAnnotations, OpenScadAnnotations } from '@/lib/openscadParameters';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
    DropdownMenuSeparator,
    DropdownMenuPortal
} from './ui/dropdown-menu';

export type CADViewerRef = {
    rebuild: () => void;
    exportModel: (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint', customScript?: string) => Promise<ArrayBuffer>;
    respawn: () => void;
};

type CADViewerProps = {
    code: string;
    activeFeatureId?: string | null;
    selection?: { id: string; point: [number, number, number] } | null;
    onMeshClick?: (id: string | null, point: [number, number, number] | null) => void;
    onSelectParameter?: (key: string | null) => void;
    onHoverParameter?: (key: string | null) => void;
    isGenerating?: boolean;
    showExport?: boolean;
    onStatusChange?: (status: { isCompiling: boolean; isExporting: boolean; isImported: boolean }) => void;
    onShare?: () => void;
    onParameterUpdate?: (key: string, value: number) => void;
    targetPoint?: [number, number, number] | null;
    isDemoMode?: boolean;
};

// --- DXF Safety Wrapper Logic ---
// This safely converts a 3D script into a 2D projection script
const generateDxfWrapper = (originalCode: string, mode: 'silhouette' | 'section' | 'blueprint') => {
    // 1. Wrap the entire input script within a controlled module namespace
    const cleanCode = `
module target_blueprint() {
    ${originalCode}
}
`;

    // 2. Force a lower resolution to prevent CGAL mesh flattening crashes
    const safeHeader = `\n/* --- DXF EXPORT INJECTION --- */\n$fn = 32; // Overridden for DXF stability\n\n`;

    // 3. Inject the specific projection mode
    let projectionWrapper = '';
    
    if (mode === 'silhouette') {
        projectionWrapper = `
// SILHOUETTE: Full top-down shadow
projection(cut = false) {
    render() { target_blueprint(); }
}`;
    } else if (mode === 'section') {
        // SECTION: Cross-section slice with epsilon offset
        projectionWrapper = `
// SECTION: Cross-section slice with epsilon offset
projection(cut = true) {
    translate([0, 0, -0.01]) {
        render() { target_blueprint(); }
    }
}`;
    } else if (mode === 'blueprint') {
        // BLUEPRINT: Multi-view orthographic + Isometric layout
        projectionWrapper = `
// BLUEPRINT: 4-View Engineering Layout
offset_dist = 120; // Distance between views

union() {
    // 1. Top View (Top Left)
    projection(cut = false) {
        render() { target_blueprint(); }
    }
    
    // 2. Isometric View (Top Right)
    translate([offset_dist, 0, 0]) {
        projection(cut = false) {
            // Magic isometric rotation math
            rotate([54.7356, 0, 45]) {
                render() { target_blueprint(); }
            }
        }
    }
    
    // 3. Front View (Bottom Left)
    translate([0, -offset_dist, 0]) {
        projection(cut = false) {
            rotate([90, 0, 0]) {
                render() { target_blueprint(); }
            }
        }
    }
    
    // 4. Right View (Bottom Right)
    translate([offset_dist, -offset_dist, 0]) {
        projection(cut = false) {
            rotate([90, 0, 90]) {
                render() { target_blueprint(); }
            }
        }
    }
}`;
    }

    return cleanCode + safeHeader + projectionWrapper;
};

export const CADViewer = forwardRef<CADViewerRef, CADViewerProps>(function CADViewer(
    {
        code,
        activeFeatureId = null,
        selection = null,
        onMeshClick,
        onSelectParameter,
        onHoverParameter,
        isGenerating = false,
        showExport = true,
        onStatusChange,
        onShare,
        onParameterUpdate,
        targetPoint = null,
        isDemoMode = false,
    },
    ref
) {
    // WASM engine
    const {
        stlUrls,
        statusText,
        engineError,
        isRecompiling,
        isExporting,
        rebuild,
        respawn,
        exportModel,
        compileCsgTree,
    } = useCADEngine({
        script: code,
        enabled: !!code,
    });

    const [isCamModalOpen, setIsCamModalOpen] = useState(false);
    const [selectedController, setSelectedController] = useState<string>('fanuc');
    const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);

    const [importedStlUrl, setImportedStlUrl] = useState<string | null>(null);
    const [isImported, setIsImported] = useState(false);
    const [geometrySource, setGeometrySource] = useState<'openscad' | 'step'>('openscad');
    const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);

    const displayStlUrls = useMemo(() => {
        if (importedStlUrl) {
            const m = new Map<string, string>();
            m.set('imported_part', importedStlUrl);
            return m;
        }
        return stlUrls;
    }, [stlUrls, importedStlUrl]);

    const sourceAssetIdRef = useRef<string | null>(null);
    const importedStlUrlRef = useRef<string | null>(null);

    useEffect(() => {
        sourceAssetIdRef.current = sourceAssetId;
    }, [sourceAssetId]);

    useEffect(() => {
        importedStlUrlRef.current = importedStlUrl;
    }, [importedStlUrl]);

    // Cleanup imported URL and backend shape on unmount
    useEffect(() => {
        return () => {
            if (importedStlUrlRef.current) {
                URL.revokeObjectURL(importedStlUrlRef.current);
            }
            if (sourceAssetIdRef.current) {
                fetch(`/api/v1/import/teardown/${sourceAssetIdRef.current}`, { method: 'POST' }).catch(() => {});
            }
        };
    }, []);

    const handleClearImport = useCallback(() => {
        if (sourceAssetId) {
            fetch(`/api/v1/import/teardown/${sourceAssetId}`, { method: 'POST' }).catch(() => {});
        }
        if (importedStlUrl) {
            URL.revokeObjectURL(importedStlUrl);
        }
        setImportedStlUrl(null);
        setIsImported(false);
        setGeometrySource('openscad');
        setSourceAssetId(null);
    }, [importedStlUrl, sourceAssetId]);

    const handleImportStep = useCallback(async (file: File) => {
        const formData = new FormData();
        formData.append('file', file);
        if (isDemoMode) {
            formData.append('demoMode', 'true');
        }

        const importPromise = (async () => {
            // Evict previous asset ID if exists
            if (sourceAssetId) {
                fetch(`/api/v1/import/teardown/${sourceAssetId}`, { method: 'POST' }).catch(() => {});
            }

            const res = await fetch('/api/v1/import/step', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || 'Import service failed');
            }

            console.log('[CADViewer] import response status:', res.status);
            console.log('[CADViewer] import response headers:', Array.from(res.headers.entries()));

            const assetId = res.headers.get('x-asset-id');
            console.log('[CADViewer] import assetId:', assetId);
            if (assetId) {
                setSourceAssetId(assetId);
                setGeometrySource('step');
            } else {
                console.warn('[CADViewer] import response did not contain x-asset-id header!');
            }

            const buffer = await res.arrayBuffer();
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            
            setImportedStlUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
            setIsImported(true);
        })();

        toast.promise(importPromise, {
            loading: 'Uploading and parsing STEP model...',
            success: 'STEP model imported successfully!',
            error: (err) => `STEP Import Failed: ${err.message || err}`,
        });
    }, [isDemoMode, sourceAssetId]);

    // Expose methods to parent ref
    useImperativeHandle(ref, () => ({
        rebuild,
        exportModel: async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint', customScript?: string) => {
            if (geometrySource === 'step') {
                const csgReference = JSON.stringify({ type: 'step_reference', asset_id: sourceAssetId });
                const url = format === 'stl' ? '/api/v1/export/stl' : '/api/v1/export/dxf';
                const bodyObj: any = { csgTree: csgReference, demoMode: isDemoMode };
                if (format === 'dxf') {
                    bodyObj.dxfMode = dxfMode;
                }
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(bodyObj),
                });
                if (!res.ok) {
                    const errText = await res.text();
                    let errorMsg = errText;
                    try {
                        const parsed = JSON.parse(errText);
                        errorMsg = parsed.error || parsed.detail || parsed.message || errText;
                    } catch (e) {}
                    throw new Error(errorMsg || `Backend export of ${format.toUpperCase()} failed`);
                }
                return await res.arrayBuffer();
            } else {
                return await exportModel(format, dxfMode, customScript);
            }
        },
        respawn,
    }), [geometrySource, sourceAssetId, isDemoMode, exportModel, rebuild, respawn]);

    const lastCodeRef = useRef(code);
    useEffect(() => {
        if (code !== lastCodeRef.current && code) {
            handleClearImport();
        }
        lastCodeRef.current = code;
    }, [code, handleClearImport]);

    // Extract annotations from scad code (debounced to avoid main-thread freeze)
    const [annotations, setAnnotations] = useState<OpenScadAnnotations>({});
    useEffect(() => {
        const timer = setTimeout(() => {
            setAnnotations(extractStructuredAnnotations(code));
        }, 500);
        return () => clearTimeout(timer);
    }, [code]);

    const statusCallbackRef = useRef(onStatusChange);
    useEffect(() => {
        statusCallbackRef.current = onStatusChange;
    }, [onStatusChange]);

    useEffect(() => {
        statusCallbackRef.current?.({
            isCompiling: isRecompiling,
            isExporting,
            isImported,
        });
    }, [isRecompiling, isExporting, isImported]);

    // Export handlers
    const handleExport = useCallback(
        async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
            console.log("[CADViewer] handleExport called", { format, dxfMode, hasCode: !!code, geometrySource, sourceAssetId });
            if (!code && geometrySource !== 'step') {
                console.log("[CADViewer] handleExport returned early: no code and not STEP source.");
                return;
            }
            const label = format.toUpperCase();
            const modeLabel = dxfMode ? ` (${dxfMode})` : '';

            const run = async () => {
                let buffer: ArrayBuffer;

                if (geometrySource === 'step') {
                    const csgReference = JSON.stringify({ type: 'step_reference', asset_id: sourceAssetId });
                    const url = format === 'stl' ? '/api/v1/export/stl' : '/api/v1/export/dxf';
                    const bodyObj: any = { csgTree: csgReference, demoMode: isDemoMode };
                    if (format === 'dxf') {
                        bodyObj.dxfMode = dxfMode;
                    }

                    const res = await fetch(url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(bodyObj),
                    });

                    if (!res.ok) {
                        const errText = await res.text();
                        let errorMsg = errText;
                        try {
                            const parsed = JSON.parse(errText);
                            errorMsg = parsed.error || parsed.detail || parsed.message || errText;
                        } catch (e) {}
                        throw new Error(errorMsg || `Backend export of ${label} failed`);
                    }

                    buffer = await res.arrayBuffer();
                } else {
                    let exportScript = code;

                    // If requesting a DXF, apply the safety wrapper
                    if (format === 'dxf' && dxfMode) {
                        exportScript = generateDxfWrapper(code, dxfMode);
                    }

                    // Pass the overridden script to the engine
                    buffer = await exportModel(format, dxfMode, exportScript);
                }

                const blob = new Blob([buffer], { type: 'application/octet-stream' });
                const url = URL.createObjectURL(blob);

                const filename = dxfMode === 'blueprint'
                    ? `technical_blueprint.dxf`
                    : `generated_model.${format}`;

                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            };

            await toast.promise(run(), {
                loading: `Exporting ${label}${modeLabel}…`,
                success: `${label} Exported Successfully`,
                error: (err) => `${label} Export Failed: ${err.message || err}`,
            });
        },
        [code, exportModel, geometrySource, sourceAssetId, isDemoMode]
    );

    const handleDownloadScad = useCallback(() => {
        if (!code) return;
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'generated_part.scad';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success('SCAD File Downloaded');
    }, [code]);

    const handleExportStep = useCallback(async () => {
        console.log("[CADViewer] handleExportStep called", { hasCode: !!code, geometrySource, sourceAssetId });
        if (!code && geometrySource !== 'step') {
            console.log("[CADViewer] handleExportStep returned early: no code and not STEP source.");
            return;
        }

        const run = async () => {
            let res: Response;

            if (geometrySource === 'step') {
                const csgTree = JSON.stringify({ type: 'step_reference', asset_id: sourceAssetId });
                res = await fetch('/api/v1/export/step', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        csgTree,
                        demoMode: isDemoMode,
                    }),
                });
            } else {
                const csgTree = await compileCsgTree();
                res = await fetch('/api/v1/export/step', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        csgTree,
                        demoMode: isDemoMode,
                    }),
                });
            }

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(errText || 'STEP service failed');
            }

            const buffer = await res.arrayBuffer();
            const blob = new Blob([buffer], { type: 'application/step' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `generated_model.step`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        await toast.promise(run(), {
            loading: 'Exporting STEP model…',
            success: 'STEP Exported Successfully',
            error: (err) => `STEP Export Failed: ${err.message || err}`,
        });
    }, [code, compileCsgTree, isDemoMode, geometrySource, sourceAssetId]);

    const handleOpenCamModal = useCallback((controller: string) => {
        setSelectedController(controller);
        setIsCamModalOpen(true);
    }, []);

    const handleGenerateGCode = useCallback(async (config: CamConfig) => {
        console.log("[CADViewer] handleGenerateGCode called", { config, hasCode: !!code, geometrySource, sourceAssetId });
        if (!code && geometrySource !== 'step') {
            console.log("[CADViewer] handleGenerateGCode returned early: no code and not STEP source.");
            return;
        }
        setIsGeneratingGCode(true);
        const controllerLabel = config.controller.toUpperCase();

        const run = async () => {
            const bodyObj: any = {
                controller: config.controller,
                safe_z: config.safe_z,
                coolant: config.coolant,
                resolution: config.resolution,
                stock_configuration: config.stock_configuration,
                tools: config.tools,
                operations: config.operations,
                demoMode: isDemoMode,
            };

            if (geometrySource === 'step') {
                bodyObj.assetId = sourceAssetId;
            } else {
                bodyObj.csgTree = await compileCsgTree();
            }

            const res = await fetch('/api/v1/export/gcode', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(bodyObj),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error?.message || errData.error || `G-code service failed`);
            }

            const data = await res.json();
            const gcodeText = data.gcode;

            if (!gcodeText) {
                throw new Error("No G-code content returned from server.");
            }

            const blob = new Blob([gcodeText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `generated_model_${config.controller}.gcode`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        try {
            await toast.promise(run(), {
                loading: `Generating ${controllerLabel} G-code…`,
                success: `${controllerLabel} G-code Generated Successfully`,
                error: (err) => `G-code Export Failed: ${err.message || err}`,
            });
            setIsCamModalOpen(false);
        } catch (err) {
            // Already handled by toast.promise
        } finally {
            setIsGeneratingGCode(false);
        }
    }, [code, compileCsgTree, isDemoMode, geometrySource, sourceAssetId]);

    return (
        <div className="relative flex flex-1 h-full w-full overflow-hidden bg-transparent">
            <Viewport
                stlUrls={displayStlUrls}
                statusText={isImported ? "Viewing STEP Import" : statusText}
                isCompiling={isImported ? false : (isRecompiling || isGenerating)}
                selection={selection}
                onMeshClick={onMeshClick}
                annotations={isImported ? {} : annotations}
                activeFeatureId={activeFeatureId || selection?.id}
                onSelectParameter={onSelectParameter}
                onHoverParameter={onHoverParameter}
                onParameterUpdate={onParameterUpdate}
                targetPoint={targetPoint}
                onImportStep={isDemoMode ? undefined : handleImportStep}
            />



            {/* ── Top Bar (Share & Export) ── */}
            {showExport && displayStlUrls.size > 0 && (
                <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
                    {onShare && (
                        <button 
                            onClick={onShare} 
                            className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252526]/80 hover:bg-[#3C3C3C] border border-[#3C3C3C] shadow-lg backdrop-blur-md text-[11px] font-medium text-[#D4D4D4] transition-colors"
                        >
                            <Share2 size={13} className="text-[#007ACC]" />
                            Share Link
                        </button>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button 
                                disabled={isExporting} 
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252526]/80 hover:bg-[#3C3C3C] border border-[#3C3C3C] shadow-lg backdrop-blur-md text-[11px] font-medium text-[#D4D4D4] transition-colors disabled:opacity-50"
                            >
                                {isExporting ? <Loader2 size={13} className="animate-spin text-[#007ACC]" /> : <Download size={13} className="text-[#007ACC]" />}
                                Export
                                <ChevronDown size={11} className="text-[#A6A6A6] ml-0.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 border-[#3C3C3C] bg-[#252526] p-1 shadow-2xl rounded-md">
                            {geometrySource !== 'step' && (
                                <>
                                    <DropdownMenuItem onClick={handleDownloadScad} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                        <div className="flex items-center gap-2.5">
                                            <div className="flex size-5 items-center justify-center rounded bg-white/10">
                                                <Layers size={11} className="text-white" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span>OpenSCAD Script</span>
                                                <span className="text-[9px] text-white/60">.SCAD Text File</span>
                                            </div>
                                        </div>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-[#3C3C3C]" />
                                </>
                            )}
                            <DropdownMenuItem onClick={() => handleExport('stl')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                <div className="flex items-center gap-2.5">
                                    <div className="flex size-5 items-center justify-center rounded bg-amber-500/20">
                                        <Box size={11} className="text-amber-500" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span>3D Printable Mesh</span>
                                        <span className="text-[9px] text-white/60">.STL Binary</span>
                                    </div>
                                </div>
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleExportStep} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                <div className="flex items-center gap-2.5">
                                    <div className="flex size-5 items-center justify-center rounded bg-blue-500/20">
                                        <Box size={11} className="text-blue-500" />
                                    </div>
                                    <div className="flex flex-col">
                                        <span>Parametric CAD Sheet</span>
                                        <span className="text-[9px] text-white/60">.STEP Model</span>
                                    </div>
                                </div>
                            </DropdownMenuItem>
                            <DropdownMenuSub>
                                <DropdownMenuSubTrigger className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                    <div className="flex items-center gap-2.5">
                                        <div className="flex size-5 items-center justify-center rounded bg-emerald-500/20">
                                            <Layers size={11} className="text-emerald-500" />
                                        </div>
                                        <div className="flex flex-col text-left">
                                            <span>2D Vector Drawing</span>
                                            <span className="text-[9px] text-white/60">.DXF Outline</span>
                                        </div>
                                    </div>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuPortal>
                                    <DropdownMenuSubContent alignOffset={-5} className="min-w-32 border-[#3C3C3C] bg-[#252526] p-1 shadow-2xl rounded-md">
                                        <DropdownMenuItem onClick={() => handleExport('dxf', 'silhouette')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                            Top-Down Silhouette
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handleExport('dxf', 'section')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                            Cross-Section Slice
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator className="bg-[#3C3C3C]" />
                                        <DropdownMenuItem onClick={() => handleExport('dxf', 'blueprint')} className="text-[11px] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer font-bold text-emerald-400">
                                            Multi-View Sheet
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
                            <DropdownMenuItem onClick={() => handleOpenCamModal('fanuc')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                <div className="flex items-center gap-2.5">
                                    <div className="flex size-5 items-center justify-center rounded bg-orange-500/20">
                                        <Cpu size={11} className="text-orange-500" />
                                    </div>
                                    <div className="flex flex-col text-left">
                                        <span>CNC Toolpath</span>
                                        <span className="text-[9px] text-white/60">.GCODE File</span>
                                    </div>
                                </div>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}

            {/* WASM Error Banner */}
            {engineError && (
                <div className="absolute bottom-6 left-6 right-6 z-30">
                    <div className="glass flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-4 duration-500">
                        <div className="flex items-center gap-4">
                            <div className="flex size-10 items-center justify-center rounded-xl bg-red-500/20 border border-red-500/40">
                                <AlertCircle size={20} className="text-red-500" />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold uppercase tracking-widest text-red-500">Geometry Engine Error</h4>
                                <p className="mt-1 text-xs text-red-200/60 font-medium">{engineError.message}</p>
                            </div>
                        </div>
                        <button
                            onClick={respawn}
                            className="rounded-lg bg-red-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-red-400 active:scale-95"
                        >
                            Respawn Kernel
                        </button>
                    </div>
                </div>
            )}

            <CamConfigModal
                isOpen={isCamModalOpen}
                onClose={() => setIsCamModalOpen(false)}
                onGenerate={handleGenerateGCode}
                isGenerating={isGeneratingGCode}
                initialController={selectedController}
            />
        </div>
    );
});