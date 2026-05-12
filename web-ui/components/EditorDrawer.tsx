'use client';

import Editor from '@monaco-editor/react';
import { ChevronLeft, ChevronRight, Code2, Loader2, Sliders, Target, X, Play, Copy, Check, Download } from 'lucide-react';
import { type ReactNode, useState } from 'react';

type Tab = 'parameters' | 'code';

type Props = {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    activeTab: Tab;
    setActiveTab: (v: Tab) => void;
    cadScript: string;
    onScriptChange: (v: string) => void;
    onRebuild: () => void;
    isCompiling: boolean;
    hasScript: boolean;
    selection?: { id: string; point: [number, number, number] } | null;
    onClearSelection?: () => void;
    children?: ReactNode;
};

export function EditorDrawer({
    isOpen, setIsOpen,
    activeTab, setActiveTab,
    cadScript, onScriptChange,
    onRebuild, isCompiling, hasScript,
    selection, onClearSelection,
    children,
}: Props) {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopyCode = async () => {
        if (!cadScript) return;
        await navigator.clipboard.writeText(cadScript);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleDownload = () => {
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
    };

    return (
        <aside
            className={`relative flex shrink-0 flex-col border-l border-zinc-800 bg-[#0c0c0e] shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isOpen ? 'w-[420px]' : 'w-14'
            }`}
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="absolute -left-4 top-1/2 z-30 flex h-10 w-8 -translate-y-1/2 items-center justify-center rounded-l-xl border-y border-l border-zinc-800 bg-[#0c0c0e] text-zinc-400 shadow-sm transition-all hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                aria-label={isOpen ? "Collapse panel" : "Expand panel"}
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
                            Parameters
                        </button>
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
                    </div>
                </header>

                <div className="custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden relative">
                    {activeTab === 'parameters' ? (
                        <div className="flex flex-col p-4 pb-28">
                            {selection && (
                                <div className="mb-6 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2.5 ring-1 ring-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
                                    <div className="flex items-center gap-2 text-xs font-medium text-amber-500">
                                        <Target size={14} />
                                        <span className="max-w-[200px] truncate">Selected: {selection.id}</span>
                                    </div>
                                    <button 
                                        onClick={onClearSelection} 
                                        className="rounded-full p-1 text-amber-600/60 transition-colors hover:bg-amber-500/20 hover:text-amber-400"
                                        aria-label="Clear selection"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            )}

                            <div className="flex flex-col">
                                <h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                                    Properties
                                </h3>
                                
                                {/* Parameter List Container */}
                                <div className="flex flex-col rounded-lg border border-zinc-800/60 bg-[#121214] p-4 shadow-sm">
                                    {children ?? (
                                        <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                                            <div className="rounded-full bg-zinc-900/50 p-3 ring-1 ring-zinc-800">
                                                <Sliders size={18} className="text-zinc-600" />
                                            </div>
                                            <p className="text-xs text-zinc-500">
                                                Generate a script to edit parameters
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="relative flex h-full flex-col p-4 pb-28 group/editor">
                            {/* Floating Actions overlay */}
                            <div className="absolute right-6 top-6 z-10 flex items-center gap-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/90 p-1 opacity-0 shadow-lg backdrop-blur-sm transition-opacity group-hover/editor:opacity-100">
                                <button
                                    onClick={handleCopyCode}
                                    title="Copy Code"
                                    className="flex size-7 items-center justify-center rounded transition-colors hover:bg-zinc-700 hover:text-white text-zinc-300"
                                >
                                    {isCopied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                </button>
                                <div className="h-3 w-px bg-zinc-600" />
                                <button
                                    onClick={handleDownload}
                                    title="Download .scad"
                                    className="flex size-7 items-center justify-center rounded transition-colors hover:bg-zinc-700 hover:text-white text-zinc-300"
                                >
                                    <Download size={14} />
                                </button>
                            </div>

                            <div className="flex-1 overflow-hidden rounded-lg border border-zinc-800/80 bg-[#18181b] shadow-inner">
                                <Editor
                                    height="100%"
                                    language="cpp" // fallback for SCAD highlighting
                                    theme="vs-dark"
                                    value={cadScript}
                                    onChange={(v) => onScriptChange(v ?? '')}
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
                                        cursorBlinking: 'smooth',
                                        cursorSmoothCaretAnimation: 'on',
                                        formatOnPaste: true,
                                    }}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer with Gradient Mask */}
                <div className="absolute bottom-0 left-0 right-0 z-20 flex flex-col justify-end bg-gradient-to-t from-[#0c0c0e] via-[#0c0c0e]/95 to-transparent pt-12 pb-4 px-4">
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
                <div className="flex flex-1 flex-col items-center gap-6 pt-8 opacity-40">
                    <Sliders size={18} className="text-zinc-400" />
                    <Code2 size={18} className="text-zinc-400" />
                </div>
            )}
        </aside>
    );
}