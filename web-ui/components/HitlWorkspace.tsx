'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { EditorDrawer } from './EditorDrawer';
import { CADViewer, type CADViewerRef } from './CADViewer';
import { ParameterDrawer } from './ParameterDrawer';
import { DemoLimitModal } from './DemoLimitModal';
import { toast } from 'sonner';
import { Target, AlertCircle } from 'lucide-react';
import { extractOpenScadParameters, injectOpenScadParameters } from '@/lib/openscadParameters';

export type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachment?: { name: string };
};

type Selection = {
    id: string;
    point: [number, number, number];
};

const MODEL_OPTIONS = [
    { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview', icon: 'sparkles' }
];

export default function HitlWorkspace({ isDemoMode = false }: { isDemoMode?: boolean }) {
    // ── State ────────────────────────────────────────────────────────────────
    const [prompt, setPrompt] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].id);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    const [cadScript, setCadScript] = useState<string>('');
    const [parameters, setParameters] = useState<Record<string, any>>({});
    const [isGenerating, setIsGenerating] = useState(false);

    const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
    const [shareToken, setShareToken] = useState<string | null>(null);

    const modelValueOptions = useMemo(() => 
        MODEL_OPTIONS.map(m => ({ value: m.id, label: m.name })), 
    []);

    // ── Demo Limits State ─────────────────────────────────────────────────────
    const [promptCount, setPromptCount] = useState(0);
    const [demoLimitReason, setDemoLimitReason] = useState<'time' | 'prompt' | 'export' | 'entry-limit' | null>(null);
    const [timeLeft, setTimeLeft] = useState<number | null>(null);

    // Demo Entry Count Tracking
    useEffect(() => {
        if (!isDemoMode) return;
        const currentCount = parseInt(localStorage.getItem('demoEntryCount') || '0', 10);
        if (currentCount >= 3) {
            setDemoLimitReason('entry-limit');
        } else {
            localStorage.setItem('demoEntryCount', (currentCount + 1).toString());
        }
    }, [isDemoMode]);

    // Demo Timer Effect
    const demoStartTimeRef = useRef<number | null>(null);
    useEffect(() => {
        if (!isDemoMode || demoLimitReason === 'entry-limit') return;
        if (demoStartTimeRef.current === null) {
            demoStartTimeRef.current = Date.now();
        }
        const startTime = demoStartTimeRef.current;
        const totalTime = 2 * 60 * 1000; // 2 minutes
        
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
    }, [isDemoMode, demoLimitReason]);

    const [isDrawerOpen, setIsDrawerOpen] = useState(true);
    const [isChatOpen, setIsChatOpen] = useState(true);
    const [activeTab, setActiveTab] = useState<'parameters' | 'code' | 'history'>('parameters');
    const [chatWidth, setChatWidth] = useState(380); // IDE default
    const [selection, setSelection] = useState<Selection | null>(null);

    const viewerRef = useRef<CADViewerRef>(null);
    const [engineStatus, setEngineStatus] = useState({ isCompiling: false, isExporting: false });

    // ── Generation ────────────────────────────────────────────────────────────
    const handleGenerate = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!prompt.trim()) return;

        if (isDemoMode && promptCount >= 1) {
            setDemoLimitReason('prompt');
            return;
        }

        const userMsg: Message = { 
            id: Date.now().toString(), 
            role: 'user', 
            content: prompt,
            attachment: selectedFile ? { name: selectedFile.name } : undefined
        };
        
        setMessages((prev) => [...prev, userMsg]);
        setPrompt('');
        setSelectedFile(null); // Clear file after send
        setIsGenerating(true);

        try {
            const formData = new FormData();
            formData.append('prompt', prompt);
            formData.append('model', selectedModel);
            if (selectedFile) formData.append('image', selectedFile);
            if (isDemoMode) formData.append('demoMode', 'true');

            const res = await fetch('/api/v1/generate', {
                method: 'POST',
                body: formData,
            });

            if (!res.ok) throw new Error('Generation failed');

            const data = await res.json();
            setCadScript(data.code);
            
            if (data.shareToken && data.shareToken !== 'demo-token') {
                setShareToken(data.shareToken);
            }
            
            const parsedParams = extractOpenScadParameters(data.code);
            setParameters(parsedParams);

            const assistantMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `I've generated the OpenSCAD code for your request. You can now tweak the parameters in the drawer or edit the code directly.`,
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setActiveTab('parameters');
            
            if (isDemoMode) setPromptCount(prev => prev + 1);
        } catch (err) {
            toast.error('Failed to generate CAD model');
            console.error(err);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleParamChange = useCallback((key: string, value: unknown) => {
        setParameters((prev) => {
            const next = { ...prev, [key]: value };
            setCadScript((script) => injectOpenScadParameters(script, next));
            return next;
        });
    }, []);

    const handleMeshClick = useCallback((id: string | null, point: [number, number, number] | null) => {
        if (point && id) {
            setSelection({ id, point });
            setActiveTab('parameters');
        } else {
            setSelection(null);
        }
    }, []);

    const handleExport = useCallback(async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
        if (isDemoMode) {
            setDemoLimitReason('export');
            return;
        }
        if (!cadScript) return;
        const label = format.toUpperCase();
        toast.info(`Exporting ${label}…`, { description: `Preparing ${label} geometry kernel…` });
        
        try {
            const buffer = await viewerRef.current?.exportModel(format, dxfMode);
            if (!buffer) throw new Error('No export buffer generated');
            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            
            const filename = dxfMode === 'blueprint' ? `technical_blueprint.dxf` : `generated_model.${format}`;
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
    }, [cadScript, isDemoMode]);

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
    }, [cadScript, isDemoMode]);

    const handleLoadSession = useCallback((script: string, params: any, token?: string) => {
        setCadScript(script);
        setParameters(params);
        setShareToken(token || null);
        setActiveTab('parameters');
        toast.success('Session loaded from history');
    }, []);

    const handleShare = async () => {
        if (!shareToken) return;
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const shareUrl = `${origin}/app/view/${shareToken}`;
            await navigator.clipboard.writeText(shareUrl);
            toast.success('Link copied to clipboard!');
        } catch (err) {
            toast.error('Failed to copy link');
        }
    };

    const formatTime = (ms: number) => {
        const totalSeconds = Math.floor(ms / 1000);
        const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    };

    return (
        // VS Code Dark Modern Theme Base
        <div className="flex h-screen w-full overflow-hidden bg-[#181818] text-[#D4D4D4] font-sans selection:bg-[#007ACC]/30">
            {isDemoMode && timeLeft !== null && (
                <div className="fixed top-6 right-6 z-40 bg-[#252526]/90 backdrop-blur-md border border-[#3C3C3C] text-amber-500 px-4 py-2 rounded-md font-mono text-xs flex items-center gap-2 shadow-xl">
                    <div className="size-2 bg-amber-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                    Demo Session: {formatTime(timeLeft)}
                </div>
            )}

            {/* ── Left: Chat Panel ─────────────────────────────────────────── */}
            <ChatPanel
                isOpen={isChatOpen}
                setIsOpen={setIsChatOpen}
                messages={messages}
                prompt={prompt}
                setPrompt={setPrompt}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                modelOptions={modelValueOptions}
                selectedFile={selectedFile}
                onFileChange={setSelectedFile}
                isGenerating={isGenerating}
                onSubmit={handleGenerate}
                width={chatWidth}
                hasScript={!!cadScript}
            >
                {selection && (
                    <div className="flex items-center justify-between rounded-md border border-[#007ACC]/50 bg-[#252526] px-3 py-2 animate-in fade-in duration-300 shadow-[0_4px_12px_rgba(0,122,204,0.1)]">
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
            </ChatPanel>

            {isChatOpen && (
                <div
                    className="w-[2px] cursor-col-resize bg-[#252526] transition-colors hover:bg-[#007ACC] relative z-10 hover:shadow-[0_0_8px_rgba(0,122,204,0.5)]"
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

            {/* ── Main Viewport Area ───────────────────────────────────────── */}
            <main className="relative flex flex-1 flex-col overflow-hidden">
                <CADViewer
                    ref={viewerRef}
                    code={cadScript}
                    activeFeatureId={activeFeatureId || selection?.id}
                    selection={selection}
                    onMeshClick={handleMeshClick}
                    onSelectParameter={(key) => {
                        if (key) {
                            setSelection({ id: key, point: [0, 0, 0] });
                            setActiveTab('parameters');
                        } else {
                            setSelection(null);
                        }
                    }}
                    onHoverParameter={setActiveFeatureId}
                    isGenerating={isGenerating}
                    showExport={true}
                    onStatusChange={(status) => setEngineStatus(status)}
                    onShare={shareToken ? handleShare : undefined}
                />
            </main>

            {/* ── Right: Editor Drawer ─────────────────────────────────────── */}
            <EditorDrawer
                isOpen={isDrawerOpen}
                setIsOpen={setIsDrawerOpen}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                isDemoMode={isDemoMode}
                cadScript={cadScript}
                onScriptChange={setCadScript}
                onRebuild={() => viewerRef.current?.rebuild()}
                isCompiling={engineStatus.isCompiling}
                isExporting={engineStatus.isExporting}
                hasScript={!!cadScript}
                selection={selection}
                onClearSelection={() => setSelection(null)}
                onLoadSession={handleLoadSession}
                onExport={handleExport}
                onDownloadScad={handleDownloadScad}
                onShare={shareToken ? handleShare : undefined}
            >
                <ParameterDrawer
                    parameters={parameters}
                    selection={selection}
                    activeFeatureId={activeFeatureId}
                    onClearSelection={() => setSelection(null)}
                    onChangeParameter={handleParamChange}
                    onHoverParameter={setActiveFeatureId}
                />
            </EditorDrawer>

            {demoLimitReason && <DemoLimitModal reason={demoLimitReason} />}
        </div>
    );
}