'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSessionHistory } from '../hooks/useSessionHistory';
import { useCadWorker } from '../hooks/useCadWorker';
import { useWorkspaceEditor } from '../hooks/useWorkspaceEditor';
import { useStepCAM } from '@/features/cam';
import { ChatPanelPresenter } from '../components/ChatPanelPresenter';
import { EditorDrawerPresenter } from '../components/EditorDrawerPresenter';
import { CADViewerPresenter } from '../components/CADViewerPresenter';
import { WorkspaceStatusBar } from '../components/WorkspaceStatusBar';
import { FatalErrorModal } from '../components/FatalErrorModal';
import { ParameterDrawer } from '../components/ParameterDrawer';
import { DemoLimitModal } from '../components/DemoLimitModal';
import { toast } from 'sonner';
import { Target, AlertCircle } from 'lucide-react';
import { MODEL_REGISTRY } from '@/lib/models-registry';
import { Spinner } from '@/components/ui/spinner';
import type { Message, Selection } from '../types';

type Props = {
    isDemoMode?: boolean;
    sessionId?: string;
};

export default function WorkspaceContainer({ isDemoMode = false, sessionId }: Props) {
    const router = useRouter();

    // ── Local UI Layout States ───────────────────────────────────────────────
    const [activeSessionId, setActiveSessionId] = useState<string | undefined>(sessionId);
    const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
    const [isDrawerOpen, setIsDrawerOpen] = useState(true);
    const [isChatOpen, setIsChatOpen] = useState(true);
    const [activeTab, setActiveTab] = useState<'parameters' | 'code' | 'history'>('parameters');
    const [chatWidth, setChatWidth] = useState(380);

    // Demo Timer State
    const [timeLeft, setTimeLeft] = useState<number | null>(null);

    const modelValueOptions = useMemo(() =>
        MODEL_REGISTRY.map(m => ({ value: m.id, label: m.name, badge: m.badge })),
    []);

    const viewerRef = useRef<any>(null);

    // ── Hooks Integration ───────────────────────────────────────────────────
    // SWR session history query
    const {
        historySessions,
        activeSessionData,
        isLoadingHistory,
        isLoadingActiveSession,
        prefetchSession,
        mutateActiveSession,
        mutateList
    } = useSessionHistory(activeSessionId);

    // CAM / STEP CAD operations
    const {
        importedStlUrl,
        isImported,
        geometrySource,
        sourceAssetId,
        isGeneratingGCode,
        handleClearImport,
        handleImport,
        handleGenerateGCode: runGenerateGCode,
    } = useStepCAM({ isDemoMode });

    // AI Parametric CAD Editor workspace manager
    const {
        prompt,
        setPrompt,
        messages,
        selectedModel,
        setSelectedModel,
        selectedFile,
        uploadedFiles,
        cadScript,
        setCadScript,
        parameters,
        isGenerating,
        shareToken,
        targetPoint,
        setTargetPoint,
        selection,
        setSelection,
        isAutoRepairing,
        demoLimitReason,
        setDemoLimitReason,
        handleRepair,
        handleGenerate,
        handleFileChange,
        handleUpdateMessageFile,
        handleParamChange,
        handleMeshClick,
        handleLoadSession,
        handleLoadHistoryItem,
        handleShare,
        handleFixWithAI,
    } = useWorkspaceEditor({
        isDemoMode,
        sessionId,
        activeSessionId,
        setActiveSessionId,
        mutateActiveSession,
        mutateList,
        handleClearImport,
        activeSessionData,
    });

    // Web Worker compilation manager
    const {
        stlUrls,
        status: engineStatus,
        statusText,
        engineError,
        warnings,
        isRecompiling,
        isExporting,
        rebuild,
        respawn,
        exportModel,
        compileCsgTree,
    } = useCadWorker({
        script: cadScript,
        enabled: !isImported && !!cadScript,
    });

    // Demo Timer Effect
    const demoStartTimeRef = useRef<number | null>(null);
    useEffect(() => {
        if (!isDemoMode || demoLimitReason === 'entry-limit') return;
        if (demoStartTimeRef.current === null) {
            demoStartTimeRef.current = Date.now();
        }
        const startTime = demoStartTimeRef.current;
        const totalTime = 2 * 60 * 1000;
        
        const interval = setInterval(() => {
            if (demoLimitReason) return;
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, totalTime - elapsed);
            setTimeLeft(remaining);
            if (remaining <= 0) {
                setDemoLimitReason('time');
                clearInterval(interval);
            }
        }, 1000);
        return () => clearInterval(interval);
    }, [isDemoMode, demoLimitReason, setDemoLimitReason]);

    const handleExport = useCallback(async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
        if (isDemoMode) {
            setDemoLimitReason('export');
            return;
        }
        try {
            const buffer = await viewerRef.current?.exportModel(format, dxfMode);
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
            toast.success(`${format.toUpperCase()} Exported Successfully`);
        } catch (err: any) {
            toast.error(`Export failed: ${err.message || err}`);
        }
    }, [isDemoMode, setDemoLimitReason]);

    const handleDownloadScad = useCallback(() => {
        if (isDemoMode) {
            setDemoLimitReason('export');
            return;
        }
        if (!cadScript) return;
        const blob = new Blob([cadScript], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'generated_part.scad';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success('SCAD File Downloaded');
    }, [cadScript, isDemoMode, setDemoLimitReason]);


    const handleGenerateGCode = useCallback(async (config: any) => {
        await runGenerateGCode(config, compileCsgTree);
    }, [runGenerateGCode, compileCsgTree]);

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    const isFatal = engineError !== null && (engineError.errorType === 'CompileFailure' || engineError.errorType === 'OutOfBounds');

    if (sessionId && isLoadingActiveSession) {
        return (
            <div className="flex h-screen w-full flex-col items-center justify-center bg-[#181818] text-[#D4D4D4]">
                <div className="flex flex-col items-center gap-3">
                    <Spinner className="text-[#007ACC] size-7" />
                    <p className="font-sans text-xs font-semibold tracking-wider text-[#A6A6A6] uppercase animate-pulse">Restoring geometric workstation state...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-full overflow-hidden bg-[#181818] text-[#D4D4D4] font-sans selection:bg-[#007ACC]/30">
            {isDemoMode && timeLeft !== null && (
                <div className="fixed top-6 right-6 z-40 bg-[#252526]/90 backdrop-blur-md border border-[#3C3C3C] text-amber-500 px-4 py-2 rounded-md font-mono text-xs flex items-center gap-2 shadow-xl">
                    <div className="size-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                    Demo Session: {formatTime(timeLeft)}
                </div>
            )}

            {/* Left: Chat Panel */}
            <ChatPanelPresenter
                isOpen={isChatOpen}
                setIsOpen={setIsChatOpen}
                messages={messages}
                prompt={prompt}
                setPrompt={setPrompt}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                modelOptions={modelValueOptions}
                selectedFile={selectedFile}
                onFileChange={handleFileChange}
                isGenerating={isGenerating}
                onSubmit={handleGenerate}
                width={chatWidth}
                hasScript={!!cadScript}
                uploadedFiles={uploadedFiles}
                onUpdateMessageFile={handleUpdateMessageFile}
                targetPoint={targetPoint}
                onClearTargetPoint={() => setTargetPoint(null)}
            >
                {selection && (
                    <div className="flex items-center justify-between rounded-md border border-[#007ACC]/50 bg-[#252526] px-3 py-2 animate-in fade-in duration-300 shadow-[0_4px_12px_rgba(0,122,204,0.15)]">
                        <div className="flex items-center gap-2">
                            <div className="flex size-6 items-center justify-center rounded bg-[#007ACC]/10">
                                <Target size={14} className="text-[#007ACC]" />
                            </div>
                            <div>
                                <p className="font-sans text-[11px] font-semibold text-[#D4D4D4]">Target Focused</p>
                                <p className="font-sans text-[10px] text-[#A6A6A6]">Interactive Context Active</p>
                            </div>
                        </div>
                        <button onClick={() => setSelection(null)} className="text-[#A6A6A6] hover:text-[#D4D4D4] transition-colors hover:bg-[#3C3C3C] p-1 rounded">
                            <AlertCircle size={14} />
                        </button>
                    </div>
                )}
            </ChatPanelPresenter>

            {isChatOpen && (
                <div
                    className="w-0.5 cursor-col-resize bg-[#252526] transition-colors hover:bg-[#007ACC] relative z-10 hover:shadow-[0_0_8px_rgba(0,122,204,0.5)]"
                    onMouseDown={(e) => {
                        const startX = e.clientX;
                        const startWidth = chatWidth;
                        const move = (moveEvent: MouseEvent) => {
                            const nextWidth = startWidth + (moveEvent.clientX - startX);
                            if (nextWidth > 250 && nextWidth < 600) setChatWidth(nextWidth);
                        };
                        const up = () => {
                            document.removeEventListener('mousemove', move);
                            document.removeEventListener('mouseup', up);
                        };
                        document.addEventListener('mousemove', move);
                        document.addEventListener('mouseup', up);
                    }}
                />
            )}

            {/* Main Viewport Area */}
            <main className="relative flex flex-1 flex-col overflow-hidden">

                <CADViewerPresenter
                    ref={viewerRef}
                    code={cadScript}
                    activeFeatureId={activeFeatureId || selection?.id}
                    selection={selection}
                    onMeshClick={handleMeshClick}
                    onSelectParameter={(key) => {
                        if (key) {
                            setSelection({ id: key, point: [0, 0, 0] });
                            setActiveTab('parameters');
                            setTargetPoint(null);
                        } else {
                            setSelection(null);
                        }
                    }}
                    onHoverParameter={setActiveFeatureId}
                    isGenerating={isGenerating}
                    showExport={true}
                    onShare={shareToken ? handleShare : undefined}
                    onParameterUpdate={handleParamChange}
                    targetPoint={targetPoint}
                    isDemoMode={isDemoMode}
                    onSelectPrompt={(p) => handleGenerate(undefined, p)}

                    stlUrls={stlUrls}
                    statusText={statusText}
                    engineError={engineError}
                    isRecompiling={isRecompiling}
                    isExporting={isExporting}
                    rebuild={rebuild}
                    respawn={respawn}
                    exportModel={exportModel}
                    compileCsgTree={compileCsgTree}

                    importedStlUrl={importedStlUrl}
                    isImported={isImported}
                    geometrySource={geometrySource}
                    sourceAssetId={sourceAssetId}
                    handleImportStep={isDemoMode ? async () => {} : handleImport}
                    handleClearImport={handleClearImport}
                    handleGenerateGCode={handleGenerateGCode}
                    isGeneratingGCode={isGeneratingGCode}
                />

                {/* Warnings telemetry banner */}
                <WorkspaceStatusBar
                    status={engineStatus}
                    statusText={statusText}
                    warnings={warnings}
                    onFixWithAI={handleFixWithAI}
                    isGenerating={isGenerating}
                />

                {/* Fatal Compiler Halts Modal Interceptor */}
                <FatalErrorModal
                    isOpen={isFatal}
                    errorMessage={engineError?.message || ''}
                    errorDetails={engineError?.details || ''}
                    onRepair={() => handleRepair(engineError)}
                    onRespawn={respawn}
                    isAutoRepairing={isAutoRepairing}
                />
            </main>

            {/* Right: Editor Drawer */}
            <EditorDrawerPresenter
                isOpen={isDrawerOpen}
                setIsOpen={setIsDrawerOpen}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isDemoMode={isDemoMode}
                cadScript={cadScript}
                onScriptChange={setCadScript}
                onRebuild={rebuild}
                isCompiling={isRecompiling}
                isExporting={isExporting}
                hasScript={!!cadScript}
                isImported={isImported}
                selection={selection}
                onClearSelection={() => setSelection(null)}
                onLoadSession={handleLoadSession}
                onLoadHistoryItem={handleLoadHistoryItem}
                onExport={handleExport}
                onDownloadScad={handleDownloadScad}
                onShare={shareToken ? handleShare : undefined}
                sessionId={activeSessionId && !activeSessionId.startsWith('temp-') ? activeSessionId : undefined}

                historySessions={historySessions}
                activeSessionData={activeSessionData}
                isLoadingHistory={isLoadingHistory}
                isLoadingActiveSession={isLoadingActiveSession}
                prefetchSession={prefetchSession}
            >
                <ParameterDrawer
                    parameters={parameters}
                    selection={selection}
                    activeFeatureId={activeFeatureId}
                    onClearSelection={() => setSelection(null)}
                    onChangeParameter={handleParamChange}
                    onHoverParameter={setActiveFeatureId}
                />
            </EditorDrawerPresenter>

            {demoLimitReason && <DemoLimitModal reason={demoLimitReason} />}
        </div>
    );
}
