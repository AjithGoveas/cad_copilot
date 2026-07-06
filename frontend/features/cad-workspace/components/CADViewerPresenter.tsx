'use client';

import { useState, useCallback, useMemo, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import { Viewport } from './Viewport';
import { CamConfigModal, CamConfig } from '@/features/cam';
import { Share2, Download, ChevronDown, Layers, Box, Cpu } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
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
} from '@/components/ui/dropdown-menu';
import { extractStructuredAnnotations, OpenScadAnnotations } from '@/lib/openscadParameters';
import type { EngineError } from '../types';
import { camApi } from '../../cam/api/camApi';

/**
 * Coerce the result of `compileCsgTree` into a string suitable for the backend
 * export endpoints. Normally this is the OpenSCAD CSG tree text. If the worker
 * fell back to STL export (because CGAL crashed on the CSG compilation), this
 * is an ArrayBuffer of STL bytes — we upload it as a temporary asset and
 * return a `step_reference` JSON string the backend already understands.
 */
async function resolveCsgTreeForBackend(payload: string | ArrayBuffer, isDemoMode: boolean): Promise<string> {
    if (typeof payload === 'string') {
        return payload;
    }
    toast.warning('CSG compilation failed — exporting from mesh. Quality may be reduced.');
    const assetId = await camApi.importStlFromBuffer(payload, isDemoMode);
    return JSON.stringify({ type: 'step_reference', asset_id: assetId });
}

export type CADViewerRef = {
    rebuild: () => void;
    exportModel: (format: 'stl' | 'dxf' | 'step', dxfMode?: 'silhouette' | 'section' | 'blueprint') => Promise<void>;
    respawn: () => void;
};

type CADViewerPresenterProps = {
    code: string;
    activeFeatureId?: string | null;
    selection?: { id: string; point: [number, number, number] } | null;
    onMeshClick?: (id: string | null, point: [number, number, number] | null) => void;
    onSelectParameter?: (key: string | null) => void;
    onHoverParameter?: (key: string | null) => void;
    isGenerating?: boolean;
    showExport?: boolean;
    onShare?: () => void;
    onParameterUpdate?: (key: string, value: number) => void;
    targetPoint?: [number, number, number] | null;
    isDemoMode?: boolean;
    onSelectPrompt?: (prompt: string) => void;

    // Decoupled CAD Worker state:
    stlUrls: Map<string, { url: string; color?: string }>;
    statusText: string;
    engineError: EngineError | null;
    isRecompiling: boolean;
    isExporting: boolean;
    rebuild: () => void;
    respawn: () => void;
    exportModel: (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint', customScript?: string) => Promise<ArrayBuffer>;
    compileCsgTree: (customScript?: string) => Promise<string | ArrayBuffer>;

    // Decoupled STEP import state and handlers:
    importedStlUrl: string | null;
    isImported: boolean;
    geometrySource: 'openscad' | 'step' | 'stl';
    sourceAssetId: string | null;
    handleImportStep: (file: File) => Promise<void>;
    handleClearImport: () => void;
    handleGenerateGCode: (config: CamConfig) => Promise<void>;
    isGeneratingGCode: boolean;
    isReadOnly?: boolean;
};


export const CADViewerPresenter = forwardRef<CADViewerRef, CADViewerPresenterProps>(function CADViewerPresenter(
    {
        code,
        activeFeatureId = null,
        selection = null,
        onMeshClick,
        onSelectParameter,
        onHoverParameter,
        isGenerating = false,
        showExport = true,
        onShare,
        onParameterUpdate,
        targetPoint = null,
        isDemoMode = false,
        onSelectPrompt,

        stlUrls,
        statusText,
        engineError,
        isRecompiling,
        isExporting,
        rebuild,
        respawn,
        exportModel,
        compileCsgTree,

        importedStlUrl,
        isImported,
        geometrySource,
        sourceAssetId,
        handleImportStep,
        handleClearImport,
        handleGenerateGCode,
        isGeneratingGCode,
        isReadOnly = false,
    },
    ref
) {
    const [isCamModalOpen, setIsCamModalOpen] = useState(false);
    const [selectedController, setSelectedController] = useState<string>('fanuc');
    const [localExportLoading, setLocalExportLoading] = useState(false);

    const displayStlUrls = useMemo(() => {
        if (importedStlUrl) {
            const m = new Map<string, { url: string; color?: string }>();
            m.set('imported_part', { url: importedStlUrl });
            return m;
        }
        return stlUrls;
    }, [stlUrls, importedStlUrl]);

    const handleExport = useCallback(
        async (format: 'stl' | 'dxf' | 'step', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
            if (format === 'step' && isDemoMode) {
                toast.error('Exporting STEP is disabled in demo mode.');
                return;
            }

            setLocalExportLoading(true);

            const run = async () => {
                let buffer: ArrayBuffer;

                const isImportedFlow = geometrySource === 'step' || geometrySource === 'stl';

                if (isImportedFlow) {
                    // RULES 2 & 3: Import STEP/STL -> All exports are processed on the backend using the cached shape reference
                    if (!sourceAssetId) {
                        throw new Error(`No active ${geometrySource.toUpperCase()} file found in cache.`);
                    }

                    const csgReference = JSON.stringify({ type: 'step_reference', asset_id: sourceAssetId });

                    if (format === 'stl') {
                        buffer = await camApi.exportStl(csgReference, isDemoMode);
                    } else if (format === 'dxf') {
                        buffer = await camApi.exportDxf(csgReference, dxfMode ?? 'silhouette', isDemoMode);
                    } else {
                        buffer = await camApi.exportStep(csgReference, isDemoMode);
                    }
                } else {
                    // RULE 1: Normal generation (OpenSCAD script)
                    if (format === 'stl') {
                        // STL goes to the browser-side OpenSCAD compiler
                        buffer = await exportModel(format, dxfMode, code);
                    } else if (format === 'dxf') {
                        // DXF goes to the backend parser/compiler.
                        // `compileCsgTree` may fall back to STL upload if CGAL crashes;
                        // in that case the returned value is an ArrayBuffer of STL bytes
                        // and we route through `/import/stl` -> asset_id -> existing DXF path.
                        const csgTreeOrStl = await compileCsgTree(code);
                        const csgTree = await resolveCsgTreeForBackend(csgTreeOrStl, isDemoMode);
                        buffer = await camApi.exportDxf(csgTree, dxfMode ?? 'silhouette', isDemoMode);
                    } else {
                        // STEP goes to the backend parser/compiler (with CGAL → STL fallback).
                        const csgTreeOrStl = await compileCsgTree(code);
                        const csgTree = await resolveCsgTreeForBackend(csgTreeOrStl, isDemoMode);
                        buffer = await camApi.exportStep(csgTree, isDemoMode);
                    }
                }

                if (!buffer || buffer.byteLength === 0) {
                    throw new Error('Export returned empty data');
                }

                // Determine MIME type and filename
                let mime = 'application/octet-stream';
                let filename = `exported_model.${format}`;

                if (format === 'step') {
                    mime = 'application/step';
                    filename = 'model.step';
                } else if (format === 'dxf') {
                    mime = 'image/vnd.dxf';
                    filename = dxfMode ? `model_${dxfMode}.dxf` : 'model.dxf';
                }

                const blob = new Blob([buffer], { type: mime });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            };

            try {
                const label = format.toUpperCase() + (dxfMode ? ` (${dxfMode})` : '');
                await toast.promise(run(), {
                    loading: `Exporting ${label} model…`,
                    success: `${label} Exported Successfully`,
                    error: (err) => `Export Failed: ${err.message || err}`,
                });
            } finally {
                setLocalExportLoading(false);
            }
        },
        [code, geometrySource, sourceAssetId, isDemoMode, exportModel, compileCsgTree]
    );

    useImperativeHandle(ref, () => ({
        rebuild,
        exportModel: handleExport,
        respawn,
    }), [rebuild, handleExport, respawn]);

    const clearImportRef = useRef(handleClearImport);
    clearImportRef.current = handleClearImport;
    const lastCodeRef = useRef(code);
    useEffect(() => {
        if (code !== lastCodeRef.current && code) {
            clearImportRef.current();
        }
        lastCodeRef.current = code;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [code]); // handleClearImport intentionally excluded — accessed via ref

    const [annotations, setAnnotations] = useState<OpenScadAnnotations>({});
    useEffect(() => {
        const timer = setTimeout(() => {
            setAnnotations(extractStructuredAnnotations(code));
        }, 500);
        return () => clearTimeout(timer);
    }, [code]);

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
    }, [code]);

    const handleOpenCamModal = useCallback((controller: string) => {
        setSelectedController(controller);
        setIsCamModalOpen(true);
    }, []);

    return (
        <div className="relative flex flex-1 h-full w-full overflow-hidden bg-transparent">
            <Viewport
                stlUrls={displayStlUrls}
                statusText={isImported ? (geometrySource === 'stl' ? 'Viewing STL Import' : 'Viewing STEP Import') : statusText}
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
                onSelectPrompt={onSelectPrompt}
                isReadOnly={isReadOnly}
                isImported={isImported}
            />

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
                                disabled={isExporting || localExportLoading} 
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252526]/80 hover:bg-[#3C3C3C] border border-[#3C3C3C] shadow-lg backdrop-blur-md text-[11px] font-medium text-[#D4D4D4] transition-colors disabled:opacity-50"
                            >
                                {isExporting || localExportLoading ? <Spinner className="size-3.5 text-[#007ACC]" /> : <Download size={13} className="text-[#007ACC]" />}
                                Export
                                <ChevronDown size={11} className="text-[#A6A6A6] ml-0.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 border-[#3C3C3C] bg-[#252526] p-1 shadow-2xl rounded-md">
                            {geometrySource !== 'step' && geometrySource !== 'stl' && (
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
                            {geometrySource !== 'stl' && (
                                <>
                                    <DropdownMenuItem onClick={() => handleExport('step')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
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
                                </>
                            )}
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
