'use client';

import { useState, useCallback, useMemo, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import { Viewport } from './Viewport';
import { useCADEngine } from '@/hooks/useCADEngine';
import { toast } from 'sonner';
import { AlertCircle, Share2, Download, ChevronDown, Layers, Box, Loader2 } from 'lucide-react';
import { extractStructuredAnnotations } from '@/lib/openscadParameters';
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
    onStatusChange?: (status: { isCompiling: boolean; isExporting: boolean }) => void;
    onShare?: () => void;
};

// --- DXF Safety Wrapper Logic ---
// This safely converts a 3D script into a 2D projection script
const generateDxfWrapper = (originalCode: string, mode: 'silhouette' | 'section' | 'blueprint') => {
    // 1. Comment out the original execution call so it doesn't render the 3D part alongside the 2D projection
    const cleanCode = originalCode.replace(/part_root\(\)\s*;/g, '// part_root(); // Disabled for DXF projection');

    // 2. Force a lower resolution to prevent CGAL mesh flattening crashes
    const safeHeader = `\n/* --- DXF EXPORT INJECTION --- */\n$fn = 32; // Overridden for DXF stability\n\n`;

    // 3. Inject the specific projection mode
    let projectionWrapper = '';
    
    if (mode === 'silhouette') {
        projectionWrapper = `
// SILHOUETTE: Full top-down shadow
projection(cut = false) {
    render() { part_root(); }
}`;
    } else if (mode === 'section') {
        // SECTION: Cut slightly below Z=0.01 to avoid perfectly coplanar math crashes
        projectionWrapper = `
// SECTION: Cross-section slice with epsilon offset
projection(cut = true) {
    translate([0, 0, -0.01]) {
        render() { part_root(); }
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
        render() { part_root(); }
    }
    
    // 2. Isometric View (Top Right)
    translate([offset_dist, 0, 0]) {
        projection(cut = false) {
            // Magic isometric rotation math
            rotate([54.7356, 0, 45]) {
                render() { part_root(); }
            }
        }
    }
    
    // 3. Front View (Bottom Left)
    translate([0, -offset_dist, 0]) {
        projection(cut = false) {
            rotate([90, 0, 0]) {
                render() { part_root(); }
            }
        }
    }
    
    // 4. Right View (Bottom Right)
    translate([offset_dist, -offset_dist, 0]) {
        projection(cut = false) {
            rotate([90, 0, 90]) {
                render() { part_root(); }
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
    } = useCADEngine({
        script: code,
        enabled: !!code,
    });

    // Expose methods to parent ref
    useImperativeHandle(ref, () => ({
        rebuild,
        exportModel,
        respawn,
    }));

    // Extract annotations from scad code
    const annotations = useMemo(() => {
        return extractStructuredAnnotations(code);
    }, [code]);

    const statusCallbackRef = useRef(onStatusChange);
    useEffect(() => {
        statusCallbackRef.current = onStatusChange;
    }, [onStatusChange]);

    useEffect(() => {
        statusCallbackRef.current?.({
            isCompiling: isRecompiling,
            isExporting,
        });
    }, [isRecompiling, isExporting]);

    // Export handlers
    const handleExport = useCallback(
        async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
            if (!code) return;
            const label = format.toUpperCase();
            const modeLabel = dxfMode ? ` (${dxfMode})` : '';
            toast.info(`Exporting ${label}${modeLabel}…`, { description: `Preparing ${label} geometry kernel…` });

            try {
                let exportScript = code;

                // If requesting a DXF, apply the safety wrapper
                if (format === 'dxf' && dxfMode) {
                    exportScript = generateDxfWrapper(code, dxfMode);
                }

                // Pass the overridden script to the engine
                // Make sure your useCADEngine's exportModel function uses this third parameter!
                const buffer = await exportModel(format, dxfMode, exportScript);
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
                URL.revokeObjectURL(url);

                toast.success(`${label} Exported Successfully`);
            } catch (err) {
                toast.error(`${label} Export Failed`, { description: String(err) });
            }
        },
        [code, exportModel]
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
        URL.revokeObjectURL(url);
        toast.success('SCAD File Downloaded');
    }, [code]);

    return (
        <div className="relative flex flex-1 h-full w-full overflow-hidden bg-transparent">
            <Viewport
                stlUrls={stlUrls}
                statusText={statusText}
                isCompiling={isRecompiling || isGenerating}
                selection={selection}
                onMeshClick={onMeshClick}
                annotations={annotations}
                activeFeatureId={activeFeatureId || selection?.id}
                onSelectParameter={onSelectParameter}
                onHoverParameter={onHoverParameter}
            />

            {/* ── Top Bar (Share & Export) ── */}
            {showExport && stlUrls.size > 0 && (
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
                                        <DropdownMenuItem onClick={() => handleExport('dxf', 'blueprint')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer font-bold text-emerald-400">
                                            Multi-View Sheet
                                        </DropdownMenuItem>
                                    </DropdownMenuSubContent>
                                </DropdownMenuPortal>
                            </DropdownMenuSub>
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
        </div>
    );
});