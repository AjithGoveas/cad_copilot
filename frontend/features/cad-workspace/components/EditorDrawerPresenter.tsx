'use client';

import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, Code2, Sliders, Play, Copy, Check, Download, History, AlertTriangle } from 'lucide-react';
import { type ReactNode, useState, memo } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { Session } from '../types';

const Editor = dynamic(() => import('@monaco-editor/react'), {
    ssr: false,
    loading: () => <div className="flex h-full items-center justify-center bg-[#1E1E1E]"><Spinner className="text-[#A6A6A6]" /></div>
});

type Tab = 'parameters' | 'code' | 'history';

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
    onLoadSession?: (sessionId: string) => void;
    onLoadHistoryItem?: (code: string, params: any) => void;
    onExport?: (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => void;
    onDownloadScad?: () => void; 
    onShare?: () => void;
    children?: ReactNode; 
    isDemoMode?: boolean;
    isImported?: boolean;
    sessionId?: string;

    // Decoupled SWR items
    historySessions: Session[];
    activeSessionData?: Session;
    isLoadingHistory: boolean;
    isLoadingActiveSession: boolean;
    prefetchSession: (id: string) => void;
};

export const EditorDrawerPresenter = memo(function EditorDrawerPresenter({
    isOpen, setIsOpen, activeTab, setActiveTab, cadScript, onScriptChange,
    onRebuild, isCompiling, isExporting, hasScript, onLoadSession, onLoadHistoryItem, onExport, onDownloadScad, onShare,
    children, isDemoMode, isImported = false, sessionId,
    historySessions, activeSessionData, isLoadingHistory, isLoadingActiveSession, prefetchSession,
}: Props) {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopyCode = async () => {
        if (!cadScript) return;
        await navigator.clipboard.writeText(cadScript);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    return (
        <aside className={`relative flex shrink-0 flex-col border-l border-[#3C3C3C] bg-[#252526] transition-all duration-300 ${isOpen ? 'w-[380px]' : 'w-12'}`}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`group absolute -left-5 top-1/2 z-40 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-l-md border-y border-l border-[#3C3C3C] text-[#A6A6A6] transition-all duration-200 hover:-translate-x-0.5 hover:bg-[#3C3C3C] hover:text-[#D4D4D4] active:scale-y-95 cursor-pointer ${isOpen ? 'bg-[#252526]' : 'bg-[#1E1E1E]'}`}
            >
                {isOpen ? (
                    <ChevronRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                ) : (
                    <ChevronLeft size={12} className="transition-transform duration-200 group-hover:-translate-x-0.5" />
                )}
            </button>

            <div className={`flex flex-1 flex-col overflow-hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                {/* Tabs Header */}
                <header className="flex h-12 shrink-0 border-b border-[#3C3C3C] bg-[#252526] shadow-sm">
                    <button onClick={() => setActiveTab('parameters')} className={`flex items-center gap-2.5 px-5 text-[11.5px] font-medium transition-all duration-300 ${activeTab === 'parameters' ? 'border-b-2 border-[#007ACC] text-[#D4D4D4] bg-[#3C3C3C]/30' : 'text-[#A6A6A6] hover:text-[#D4D4D4] hover:bg-[#3C3C3C]/20 border-b-2 border-transparent'}`}>
                        <Sliders size={13} /> Parameters
                    </button>
                    {!isDemoMode && (
                        <>
                            <button onClick={() => setActiveTab('code')} className={`flex items-center gap-2.5 px-5 text-[11.5px] font-medium transition-all duration-300 ${activeTab === 'code' ? 'border-b-2 border-[#007ACC] text-[#D4D4D4] bg-[#3C3C3C]/30' : 'text-[#A6A6A6] hover:text-[#D4D4D4] hover:bg-[#3C3C3C]/20 border-b-2 border-transparent'}`}>
                                <Code2 size={13} /> Code
                            </button>
                            <button onClick={() => setActiveTab('history')} className={`flex items-center gap-2.5 px-5 text-[11.5px] font-medium transition-all duration-300 ${activeTab === 'history' ? 'border-b-2 border-[#007ACC] text-[#D4D4D4] bg-[#3C3C3C]/30' : 'text-[#A6A6A6] hover:text-[#D4D4D4] hover:bg-[#3C3C3C]/20 border-b-2 border-transparent'}`}>
                                <History size={13} /> History
                            </button>
                        </>
                    )}
                </header>

                {/* Scrollable Body Area */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar bg-[#252526]">
                    {activeTab === 'parameters' && (
                        <div className="p-3">{children}</div>
                    )}

                    {activeTab === 'code' && (
                        <div className="relative h-full bg-[#1E1E1E]">
                            <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5 rounded-md border border-[#3C3C3C] bg-[#252526] p-1.5 shadow-lg">
                                <button onClick={handleCopyCode} className="flex size-6 items-center justify-center rounded-md text-[#A6A6A6] hover:bg-[#3C3C3C] hover:text-[#D4D4D4] transition-colors">
                                    {isCopied ? <Check size={12} className="text-[#007ACC]" /> : <Copy size={12} />}
                                </button>
                                <div className="h-4 w-px bg-[#3C3C3C]" />
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <button disabled={isExporting} className="flex size-6 items-center justify-center rounded-md text-[#A6A6A6] hover:bg-[#3C3C3C] hover:text-[#D4D4D4] disabled:opacity-50 transition-colors">
                                            {isExporting ? <Spinner className="size-3 text-[#A6A6A6]" /> : <Download size={12} />}
                                        </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-40 border-[#3C3C3C] bg-[#252526] p-1 shadow-xl rounded-md">
                                        {!isImported && (
                                            <DropdownMenuItem onClick={onDownloadScad} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                                <div className="size-2 rounded-full bg-[#007ACC] mr-2.5 shadow-sm" /> .SCAD
                                            </DropdownMenuItem>
                                        )}
                                        <DropdownMenuItem onClick={() => onExport?.('stl')} className="text-[11px] text-[#D4D4D4] focus:bg-[#007ACC] rounded-md py-1.5 cursor-pointer">
                                            <div className="size-2 rounded-full bg-amber-500 mr-2.5 shadow-sm" /> .STL
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <Editor
                                height="100%" language="cpp" theme="vs-dark" value={cadScript}
                                onChange={(v: string | undefined) => onScriptChange(v ?? '')}
                                options={{ readOnly: isImported, minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', wordWrap: 'on', padding: { top: 16 }, scrollBeyondLastLine: false, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", renderLineHighlight: 'all' }}
                            />
                        </div>
                    )}

                    {activeTab === 'history' && (
                        <div className="p-4 flex flex-col gap-3">
                            {sessionId ? (
                                <>
                                    <button 
                                        onClick={() => onLoadSession?.('')} 
                                        className="flex items-center gap-1.5 self-start text-[11px] font-semibold text-[#A6A6A6] hover:text-[#D4D4D4] bg-[#3C3C3C]/40 hover:bg-[#3C3C3C]/80 px-2.5 py-1.5 rounded transition-all mb-2 cursor-pointer border-none"
                                    >
                                        <ChevronLeft size={12} /> Back to Sessions
                                    </button>
                                    <h4 className="text-[11px] font-bold tracking-wider text-[#A6A6A6] uppercase mb-1">Session Timeline</h4>
                                    {isLoadingActiveSession ? (
                                        <Spinner className="text-[#A6A6A6] mx-auto mt-6" />
                                    ) : activeSessionData?.historyItems?.map((item: any, idx: number) => {
                                        const isActive = item.openscadCode === cadScript;
                                        return (
                                            <button 
                                                key={item.id} 
                                                onClick={() => onLoadHistoryItem?.(item.openscadCode, item.parametersJson)}
                                                className={`group flex items-start gap-3 rounded-md border p-3.5 text-left transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 cursor-pointer w-full ${
                                                    isActive 
                                                        ? 'border-[#007ACC] bg-[#007ACC]/10 text-white shadow-[0_0_12px_rgba(0,122,204,0.15)]' 
                                                        : 'border-[#3C3C3C] bg-[#1E1E1E] hover:border-[#007ACC]/50 hover:bg-[#252526] text-[#D4D4D4]'
                                                }`}
                                            >
                                                <div className={`mt-1.5 size-2 rounded-full ${isActive ? 'bg-[#007ACC]' : 'bg-[#A6A6A6] group-hover:bg-[#007ACC]'} transition-colors`} />
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between gap-2 mb-1">
                                                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#A6A6A6]">
                                                            Step {idx + 1}: {item.actionType}
                                                        </span>
                                                        <span className="text-[9px] text-[#858585] font-mono">
                                                            {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs line-clamp-2 leading-relaxed break-words">{item.prompt || 'Generated part'}</p>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </>
                            ) : (
                                <>
                                    <h4 className="text-[11px] font-bold tracking-wider text-[#A6A6A6] uppercase mb-1">Recent Sessions</h4>
                                    {isLoadingHistory ? (
                                        <Spinner className="text-[#A6A6A6] mx-auto mt-6" />
                                    ) : historySessions?.map((session) => (
                                        <button 
                                            key={session.id} 
                                            onClick={() => onLoadSession?.(session.id)} 
                                            onMouseEnter={() => prefetchSession(session.id)}
                                            className="group flex items-start gap-3 rounded-md border border-[#3C3C3C] bg-[#1E1E1E] p-3.5 text-left hover:border-[#007ACC]/50 hover:bg-[#252526] transition-all duration-300 hover:shadow-md hover:-translate-y-0.5 cursor-pointer w-full"
                                        >
                                            <div className="mt-1 size-1.5 rounded-full bg-[#A6A6A6] group-hover:bg-[#007ACC] transition-colors" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[10px] text-[#A6A6A6] font-mono mb-1.5">
                                                    {new Date(session.createdAt).toLocaleString()}
                                                </div>
                                                <div className="text-xs text-[#D4D4D4] line-clamp-2 leading-relaxed font-medium break-words">
                                                    {session.title}
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                    {!isLoadingHistory && (!historySessions || historySessions.length === 0) && (
                                        <div className="text-[11px] text-[#A6A6A6] text-center mt-6">
                                            No active history sessions found.
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Sticky Footer (Safety & Rebuild) */}
                <div className="shrink-0 flex flex-col p-4 border-t border-[#3C3C3C] bg-[#252526] gap-3 shadow-[0_-4px_12px_rgba(0,0,0,0.1)]">
                    <div className="flex items-start gap-2">
                        <AlertTriangle size={14} className="text-[#A6A6A6] shrink-0 mt-0.5" />
                        <p className="text-[11px] text-[#A6A6A6] leading-relaxed">Safety Note: Verify AI-generated dimensions before additive manufacturing or CNC export.</p>
                    </div>
                    <button
                        onClick={onRebuild}
                        disabled={isCompiling || !hasScript || isImported}
                        className="flex w-full items-center justify-center gap-2 rounded-md bg-[#007ACC] py-2.5 text-[12px] font-semibold text-white transition-all duration-300 hover:bg-[#007ACC]/90 hover:shadow-[0_0_12px_rgba(0,122,204,0.4)] active:scale-[0.98] disabled:bg-[#3C3C3C] disabled:text-[#A6A6A6] disabled:shadow-none"
                    >
                        {isCompiling ? <Spinner className="size-3.5 text-white" /> : <Play size={14} className="fill-current" />}
                        {isCompiling ? 'Compiling...' : 'Rebuild Model'}
                    </button>
                </div>
            </div>

            {!isOpen && (
                <div className="absolute inset-0 flex flex-col items-center py-4 bg-[#1E1E1E] text-[#A6A6A6] z-20">
                    <div className="flex-1 flex flex-col items-center gap-4 w-full">
                        <button
                            onClick={() => { setActiveTab('parameters'); setIsOpen(true); }}
                            className={`group relative flex size-8 items-center justify-center rounded-md hover:scale-105 active:scale-95 transition-all cursor-pointer ${activeTab === 'parameters' ? 'bg-[#007ACC]/10 text-[#007ACC] border border-[#007ACC]/30' : 'hover:bg-[#3C3C3C] hover:text-[#D4D4D4]'}`}
                        >
                            <Sliders size={16} />
                            <span className="absolute right-11 scale-0 group-hover:scale-100 translate-x-2 group-hover:translate-x-0 transition-all duration-150 origin-right bg-[#1E1E1E] border border-[#3C3C3C] text-[#D4D4D4] text-[10px] rounded px-2 py-1 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                Parameters
                            </span>
                        </button>

                        {!isDemoMode && (
                            <button
                                onClick={() => { setActiveTab('code'); setIsOpen(true); }}
                                className={`group relative flex size-8 items-center justify-center rounded-md hover:scale-105 active:scale-95 transition-all cursor-pointer ${activeTab === 'code' ? 'bg-[#007ACC]/10 text-[#007ACC] border border-[#007ACC]/30' : 'hover:bg-[#3C3C3C] hover:text-[#D4D4D4]'}`}
                            >
                                <Code2 size={16} />
                                <span className="absolute right-11 scale-0 group-hover:scale-100 translate-x-2 group-hover:translate-x-0 transition-all duration-150 origin-right bg-[#1E1E1E] border border-[#3C3C3C] text-[#D4D4D4] text-[10px] rounded px-2 py-1 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                    Source Code
                                </span>
                            </button>
                        )}

                        {!isDemoMode && (
                            <button
                                onClick={() => { setActiveTab('history'); setIsOpen(true); }}
                                className={`group relative flex size-8 items-center justify-center rounded-md hover:scale-105 active:scale-95 transition-all cursor-pointer ${activeTab === 'history' ? 'bg-[#007ACC]/10 text-[#007ACC] border border-[#007ACC]/30' : 'hover:bg-[#3C3C3C] hover:text-[#D4D4D4]'}`}
                            >
                                <History size={16} />
                                <span className="absolute right-11 scale-0 group-hover:scale-100 translate-x-2 group-hover:translate-x-0 transition-all duration-150 origin-right bg-[#1E1E1E] border border-[#3C3C3C] text-[#D4D4D4] text-[10px] rounded px-2 py-1 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                    History
                                </span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </aside>
    );
});
