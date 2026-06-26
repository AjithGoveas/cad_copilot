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

export type CADViewerRef = {
    rebuild: () => void;
    exportModel: (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint', customScript?: string) => Promise<ArrayBuffer>;
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
    compileCsgTree: (customScript?: string) => Promise<string>;

    // Decoupled STEP import state and handlers:
    importedStlUrl: string | null;
    isImported: boolean;
    geometrySource: 'openscad' | 'step' | 'stl';
    sourceAssetId: string | null;
    handleImportStep: (file: File) => Promise<void>;
    handleClearImport: () => void;
    handleExportStep: (compileCsgTree: () => Promise<string>) => Promise<void>;
    handleGenerateGCode: (config: CamConfig) => Promise<void>;
    isGeneratingGCode: boolean;
    isReadOnly?: boolean;
};

const generateDxfWrapper = (originalCode: string, mode: 'silhouette' | 'section' | 'blueprint') => {
    const cleanCode = `
module target_blueprint() {
    ${originalCode}
}
`;

    const safeHeader = `\n/* --- DXF EXPORT INJECTION --- */\n$fn = 32;\n\n`;

    let projectionWrapper = '';
    
    if (mode === 'silhouette') {
        projectionWrapper = `
projection(cut = false) {
    render() { target_blueprint(); }
}`;
    } else if (mode === 'section') {
        projectionWrapper = `
projection(cut = true) {
    translate([0, 0, -0.01]) {
        render() { target_blueprint(); }
    }
}`;
    } else if (mode === 'blueprint') {
        projectionWrapper = `
offset_dist = 120;

union() {
    projection(cut = false) {
        render() { target_blueprint(); }
    }
    
    translate([offset_dist, 0, 0]) {
        projection(cut = false) {
            rotate([54.7356, 0, 45]) {
                render() { target_blueprint(); }
            }
        }
    }
    
    translate([0, -offset_dist, 0]) {
        projection(cut = false) {
            rotate([90, 0, 0]) {
                render() { target_blueprint(); }
            }
        }
    }
    
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
        handleExportStep,
        handleGenerateGCode,
        isGeneratingGCode,
        isReadOnly = false,
    },
    ref
) {
    const [isCamModalOpen, setIsCamModalOpen] = useState(false);
    const [selectedController, setSelectedController] = useState<string>('fanuc');

    const displayStlUrls = useMemo(() => {
        if (importedStlUrl) {
            const m = new Map<string, { url: string; color?: string }>();
            m.set('imported_part', { url: importedStlUrl });
            return m;
        }
        return stlUrls;
    }, [stlUrls, importedStlUrl]);

    const doExportModel = useCallback(async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint', customScript?: string) => {
        if (geometrySource === 'step' || geometrySource === 'stl') {
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
    }, [geometrySource, sourceAssetId, isDemoMode, exportModel]);

    useImperativeHandle(ref, () => ({
        rebuild,
        exportModel: doExportModel,
        respawn,
    }), [rebuild, doExportModel, respawn]);

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

    const handleExport = useCallback(
        async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
            let exportScript = code;
            if (format === 'dxf' && dxfMode) {
                exportScript = generateDxfWrapper(code, dxfMode);
            }
            try {
                const buffer = await doExportModel(format, dxfMode, exportScript);
                if (!buffer) return;

                const mime = format === 'stl' ? 'application/octet-stream' : 'image/vnd.dxf';
                const blob = new Blob([buffer], { type: mime });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `exported_model.${format}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (err: any) {
                toast.error(`Export failed: ${err.message || err}`);
            }
        },
        [code, doExportModel]
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
                                disabled={isExporting} 
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#252526]/80 hover:bg-[#3C3C3C] border border-[#3C3C3C] shadow-lg backdrop-blur-md text-[11px] font-medium text-[#D4D4D4] transition-colors disabled:opacity-50"
                            >
                                {isExporting ? <Spinner className="size-3.5 text-[#007ACC]" /> : <Download size={13} className="text-[#007ACC]" />}
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
                            <DropdownMenuItem onClick={() => handleExportStep(compileCsgTree)} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
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
