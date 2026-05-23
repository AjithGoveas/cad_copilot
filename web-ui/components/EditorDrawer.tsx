'use client';

import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, Code2, Loader2, Sliders, Target, X, Play, Copy, Check, Download, History, AlertTriangle, Clock, ArrowRight, Share2 } from 'lucide-react';
import { type ReactNode, useState, memo } from 'react';
import useSWR from 'swr';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSeparator, DropdownMenuPortal, DropdownMenuSubTrigger } from './ui/dropdown-menu';

// Dynamic import for Monaco to prevent blocking initial load
const Editor = dynamic(() => import('@monaco-editor/react'), {
    ssr: false,
    loading: () => (
        <div className="flex h-full w-full items-center justify-center bg-[#18181b]">
            <Loader2 size={24} className="animate-spin text-zinc-700" />
        </div>
    )
});

const fetcher = (url: string) => fetch(url).then(res => res.json());

type Tab = 'parameters' | 'code' | 'history';

type Project = {
    id: string;
    prompt: string;
    scadCode: string;
    parametersJson: any;
    shareToken?: string;
    createdAt: string;
};

type Props = {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    activeTab: Tab;
    setActiveTab: (v: Tab) => void;
    cadScript: string;
    onScriptChange: (v: string) => void;
    onRebuild: () => void;
    isCompiling: boolean;
    isExporting?: boolean;
    hasScript: boolean;
    selection?: { id: string; point: [number, number, number] } | null;
    onClearSelection?: () => void;
    onLoadSession?: (script: string, params: any, shareToken?: string) => void;
    onExport?: (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => void;
    onDownloadScad?: () => void;
    onShare?: () => void;
    children?: ReactNode;
    isDemoMode?: boolean;
};

export const EditorDrawer = memo(function EditorDrawer({
    isOpen, setIsOpen,
    activeTab, setActiveTab,
    cadScript, onScriptChange,
    onRebuild, isCompiling, isExporting, hasScript,
    selection, onClearSelection,
    onLoadSession, onExport, onDownloadScad, onShare,
    children, isDemoMode,
}: Props) {
    const [isCopied, setIsCopied] = useState(false);
    const [] = useState(false);

    // Optimized API fetching with SWR
    const { data: historySessions, isLoading: isLoadingHistory } = useSWR<Project[]>(
        activeTab === 'history' ? '/api/history' : null,
        fetcher,
        { revalidateOnFocus: false, dedupingInterval: 60000 }
    );

    const handleCopyCode = async () => {
        if (!cadScript) return;
        await navigator.clipboard.writeText(cadScript);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    return (
        <aside
            className={`relative flex shrink-0 flex-col border-l border-zinc-800 bg-[#0c0c0e] shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isOpen ? 'w-[420px]' : 'w-14'
            }`}
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="absolute -left-4 top-1/2 z-30 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded-l-xl border-y border-l border-zinc-800 bg-[#0c0c0e] text-zinc-400 shadow-sm transition-all hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none"
            >
                {isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>

            <div className={`flex flex-1 flex-col overflow-hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                
                <header className="flex flex-col gap-4 border-b border-zinc-800/80 bg-[#0c0c0e] p-4 pt-6">
                    <div className="flex items-center rounded-lg bg-zinc-950/80 p-1 ring-1 ring-inset ring-zinc-800/80">
                        <button
                            onClick={() => setActiveTab('parameters')}
                            className={`flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-all ${
                                activeTab === 'parameters' 
                                    ? 'bg-zinc-800/80 text-amber-400 shadow-sm ring-1 ring-zinc-700/50' 
                                    : 'text-zinc-500 hover:text-zinc-300'
                            }`}
                        >
                            <Sliders size={14} />
                            Params
                        </button>
                        {!isDemoMode && (
                            <>
                                <button
                                    onClick={() => setActiveTab('code')}
                                    className={`flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-all ${
                                        activeTab === 'code' 
                                            ? 'bg-zinc-800/80 text-amber-400 shadow-sm ring-1 ring-zinc-700/50' 
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <Code2 size={14} />
                                    Code
                                </button>
                                <button
                                    onClick={() => setActiveTab('history')}
                                    className={`flex flex-1 items-center justify-center gap-2 rounded-md py-1.5 text-xs font-medium transition-all ${
                                        activeTab === 'history' 
                                            ? 'bg-zinc-800/80 text-amber-400 shadow-sm ring-1 ring-zinc-700/50' 
                                            : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <History size={14} />
                                    History
                                </button>
                            </>
                        )}
                    </div>
                </header>

                <div className="custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden relative">
                    {activeTab === 'parameters' && (
                        <div className="flex flex-col p-4 pb-32">
                            {children}
                        </div>
                    )}

                    {activeTab === 'code' && (
                        <div className="relative flex h-full flex-col p-4 pb-32 group/editor">
                            <div className="absolute right-6 top-6 z-10 flex items-center gap-1.5">
                                <div className="flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/90 p-1 shadow-lg backdrop-blur-sm transition-opacity group-hover/editor:opacity-100 opacity-0">
                                    <button 
                                        onClick={handleCopyCode} 
                                        title="Copy Code" 
                                        className="flex size-7 items-center justify-center rounded transition-colors hover:bg-zinc-700 hover:text-white text-zinc-300"
                                    >
                                        {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                    </button>
                                    
                                    <div className="h-3 w-px bg-zinc-600" />
                                    
                                    <div className="relative">
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <button 
                                                    disabled={isExporting}
                                                    title="Export" 
                                                    className="flex size-7 items-center justify-center rounded transition-colors hover:bg-zinc-700 hover:text-white text-zinc-300 disabled:opacity-50 data-[state=open]:bg-zinc-700 data-[state=open]:text-white"
                                                >
                                                    {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                                </button>
                                            </DropdownMenuTrigger>

                                            <DropdownMenuContent align="end" className="w-40 border-zinc-700 bg-zinc-800 p-1 shadow-xl rounded-lg">
                                                <DropdownMenuItem 
                                                    onClick={onDownloadScad}
                                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:bg-zinc-700 focus:text-white"
                                                >
                                                    <div className="size-1.5 rounded-full bg-blue-500" />
                                                    .SCAD
                                                </DropdownMenuItem>
                                                <DropdownMenuItem 
                                                    onClick={() => onExport?.('stl')}
                                                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:bg-zinc-700 focus:text-white"
                                                >
                                                    <div className="size-1.5 rounded-full bg-amber-500" />
                                                    .STL
                                                </DropdownMenuItem>

                                                <DropdownMenuSub>
                                                    <DropdownMenuSubTrigger 
                                                        className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:bg-zinc-700 focus:text-white data-[state=open]:bg-zinc-700 data-[state=open]:text-white"
                                                    >
                                                        <div className="flex items-center gap-2">
                                                            <div className="size-1.5 rounded-full bg-emerald-500" />
                                                            .DXF (2D)
                                                        </div>
                                                    </DropdownMenuSubTrigger>
                                                    <DropdownMenuPortal>
                                                        <DropdownMenuSubContent className="w-44 border-zinc-700 bg-zinc-800 p-1 shadow-xl rounded-lg ml-1">
                                                            <DropdownMenuItem 
                                                                onClick={() => onExport?.('dxf', 'silhouette')}
                                                                className="rounded-md px-2 py-1.5 text-[10px] text-zinc-400 focus:bg-zinc-700 focus:text-white uppercase tracking-wider"
                                                            >
                                                                Silhouette Outline
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem 
                                                                onClick={() => onExport?.('dxf', 'section')}
                                                                className="rounded-md px-2 py-1.5 text-[10px] text-zinc-400 focus:bg-zinc-700 focus:text-white uppercase tracking-wider"
                                                            >
                                                                Cross-Section Slice
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator className="bg-zinc-700" />
                                                            <DropdownMenuItem 
                                                                onClick={() => onExport?.('dxf', 'blueprint')}
                                                                className="rounded-md px-2 py-1.5 text-[10px] font-bold text-emerald-400 focus:bg-zinc-700 focus:text-emerald-300 uppercase tracking-wider"
                                                            >
                                                                Orthographic Sheet
                                                            </DropdownMenuItem>
                                                        </DropdownMenuSubContent>
                                                    </DropdownMenuPortal>
                                                </DropdownMenuSub>

                                                {onShare && (
                                                    <>
                                                        <DropdownMenuSeparator className="bg-zinc-700" />
                                                        <DropdownMenuItem 
                                                            onClick={onShare}
                                                            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-zinc-300 focus:bg-zinc-700 focus:text-white"
                                                        >
                                                            <Share2 size={14} className="text-indigo-400" />
                                                            Share Link
                                                        </DropdownMenuItem>
                                                    </>
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>
                            </div>
                            <div className="flex-1 overflow-hidden rounded-lg border border-zinc-800/80 bg-[#18181b] shadow-inner">
                                <Editor
                                    height="100%"
                                    language="cpp"
                                    theme="vs-dark"
                                    value={cadScript}
                                    onChange={(v: string | undefined) => onScriptChange(v ?? '')}
                                    options={{
                                        minimap: { enabled: false },
                                        fontSize: 13,
                                        lineNumbers: 'on',
                                        wordWrap: 'on',
                                        scrollBeyondLastLine: false,
                                        fontFamily: "'IBM Plex Mono', Consolas, monospace",
                                        renderLineHighlight: 'all',
                                        padding: { top: 20, bottom: 20 },
                                        smoothScrolling: true,
                                    }}
                                />
                            </div>
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="flex flex-col p-4 pb-32 gap-4">
                            <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Recent Sessions</h3>
                            {isLoadingHistory ? (
                                <div className="flex flex-col items-center justify-center gap-3 py-12">
                                    <Loader2 size={24} className="animate-spin text-amber-500" />
                                    <p className="text-xs text-zinc-500 font-mono tracking-widest uppercase">Fetching History...</p>
                                </div>
                            ) : historySessions && historySessions.length > 0 ? (
                                <div className="flex flex-col gap-3">
                                    {historySessions.map((session) => (
                                        <button
                                            key={session.id}
                                            onClick={() => onLoadSession?.(session.scadCode || '', session.parametersJson, session.shareToken)}
                                            className="flex flex-col items-start gap-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 transition-all hover:bg-zinc-800 hover:ring-1 hover:ring-amber-500/20 text-left group"
                                        >
                                            <div className="flex w-full items-center justify-between">
                                                <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-mono">
                                                    <Clock size={12} className="text-zinc-600" />
                                                    {new Date(session.createdAt).toLocaleString()}
                                                </div>
                                                <ArrowRight size={14} className="text-zinc-700 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                                            </div>
                                            <p className="line-clamp-2 text-xs font-medium text-zinc-300 leading-relaxed">
                                                {session.prompt}
                                            </p>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center opacity-40">
                                    <History size={24} className="text-zinc-600" />
                                    <p className="text-xs">No previous sessions found</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col justify-end bg-gradient-to-t from-[#0c0c0e] via-[#0c0c0e]/95 to-transparent pt-12 pb-4 px-4 gap-4">
                    <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 ring-1 ring-inset ring-amber-500/10">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                        <p className="text-[10px] leading-relaxed text-amber-200/70">
                            <span className="font-bold text-amber-500 uppercase tracking-tighter mr-1">Safety Note:</span>
                            Always verify AI-generated dimensions against original blueprints before manufacturing.
                        </p>
                    </div>

                    <button
                        onClick={onRebuild}
                        disabled={isCompiling || !hasScript}
                        className="group flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-sm font-bold text-amber-950 shadow-[0_4px_14px_rgba(245,158,11,0.25)] transition-all hover:bg-amber-400 hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)] active:scale-[0.98] disabled:pointer-events-none disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
                    >
                        {isCompiling ? (
                            <Loader2 size={16} className="animate-spin text-zinc-500" />
                        ) : (
                            <Play size={14} className="fill-amber-950 transition-transform group-hover:scale-110" />
                        )}
                        {isCompiling ? 'Compiling...' : 'Rebuild Geometry'}
                    </button>
                </div>
            </div>

            {!isOpen && (
                <div className="flex flex-1 flex-col items-center gap-8 pt-8 opacity-40">
                    <Sliders size={18} className="text-zinc-400" />
                    <Code2 size={18} className="text-zinc-400" />
                    <History size={18} className="text-zinc-400" />
                </div>
            )}
        </aside>
    );
});
