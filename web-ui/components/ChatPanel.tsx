'use client';

import { type FormEvent, useEffect, useRef } from 'react';
import { SendHorizontal, Upload, X, Loader2, Sparkles, Binary, LogOut, ChevronLeft, ChevronRight, Box } from 'lucide-react';
import { ChatBubble } from './ChatBubble';
import { signOut } from 'next-auth/react';
import type { Message } from './HitlWorkspace';

type Props = {
    isOpen: boolean;
    setIsOpen: (v: boolean) => void;
    messages: Message[];
    prompt: string;
    setPrompt: (v: string) => void;
    selectedModel: string;
    setSelectedModel: (v: string) => void;
    modelOptions: { value: string; label: string }[];
    selectedFile: File | null;
    onFileChange: (f: File | null) => void;
    isGenerating: boolean;
    onSubmit: (e: FormEvent) => void;
    width: number;
    hasScript: boolean;
    children?: React.ReactNode;
};

export function ChatPanel({
    isOpen, setIsOpen,
    messages, prompt, setPrompt,
    selectedModel, setSelectedModel, modelOptions,
    selectedFile, onFileChange,
    isGenerating, onSubmit, width, hasScript, children,
}: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const canSubmit = !isGenerating && prompt.trim().length > 0 && (!!selectedFile || hasScript);

    return (
        <aside
            className={`relative flex shrink-0 flex-col border-r border-[#3C3C3C] bg-[#252526] transition-all duration-300 ${isOpen ? '' : 'w-12'}`}
            style={isOpen ? { width } : undefined}
        >
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`group absolute -right-5 top-1/2 z-40 flex h-16 w-5 -translate-y-1/2 items-center justify-center rounded-r-md border-y border-r border-[#3C3C3C] text-[#A6A6A6] transition-all duration-200 hover:translate-x-0.5 hover:bg-[#3C3C3C] hover:text-[#D4D4D4] active:scale-y-95 cursor-pointer ${isOpen ? 'bg-[#252526]' : 'bg-[#1E1E1E]'}`}
            >
                {isOpen ? (
                    <ChevronLeft size={12} className="transition-transform duration-200 group-hover:-translate-x-0.5" />
                ) : (
                    <ChevronRight size={12} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                )}
            </button>

            <div className={`flex flex-1 flex-col overflow-hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#3C3C3C] px-4 bg-[#252526] shadow-sm">
                    <div className="flex items-center gap-2.5">
                        <div className="flex size-5 items-center justify-center rounded bg-[#007ACC]/10 border border-[#007ACC]/30 text-[#007ACC]">
						<Box size={12} />
					</div>
					<span className="font-mono text-[10px] font-black uppercase tracking-[0.25em] text-[#007ACC]">
						CAD Copilot
					</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="bg-[#1E1E1E] border border-[#3C3C3C] rounded-md px-2 py-1 font-sans text-[11px] text-[#D4D4D4] focus:outline-none focus:ring-1 focus:ring-[#007ACC]/50 focus:border-[#007ACC] cursor-pointer shadow-sm transition-all"
                        >
                            {modelOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <button
                            onClick={() => signOut({ callbackUrl: '/app/login' })}
                            title="Sign Out"
                            className="flex size-6 items-center justify-center rounded-md text-[#A6A6A6] hover:text-[#D4D4D4] hover:bg-[#3C3C3C] transition-all cursor-pointer"
                        >
                            <LogOut size={14} />
                        </button>
                    </div>
                </header>

                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 custom-scrollbar">
                    {messages.map((m) => (
                        <ChatBubble key={m.id} {...m} />
                    ))}
                    <div ref={bottomRef} />
                </div>

                <div className="shrink-0 border-t border-[#3C3C3C] p-4 space-y-3 bg-[#252526]">
                    {children}

                    {/* JetBrains style attachment pill */}
                    {selectedFile && (
                        <div className="flex items-center gap-2.5 rounded-md border border-[#3C3C3C] bg-[#1E1E1E] px-3 py-2 animate-in fade-in duration-200 shadow-sm">
                            <Binary size={14} className="text-[#007ACC]" />
                            <div className="flex-1 min-w-0">
                                <p className="truncate font-mono text-[11px] text-[#D4D4D4]">{selectedFile.name}</p>
                            </div>
                            <button onClick={() => onFileChange(null)} className="text-[#A6A6A6] hover:text-[#D4D4D4] p-1 hover:bg-[#3C3C3C] rounded-md transition-colors">
                                <X size={14} />
                            </button>
                        </div>
                    )}

                    {/* Flat IDE Input Area */}
                    <form
                        onSubmit={onSubmit}
                        className="flex flex-col rounded-md border border-[#3C3C3C] bg-[#1E1E1E] transition-all duration-300 focus-within:border-[#007ACC] focus-within:ring-1 focus-within:ring-[#007ACC]/30 shadow-sm"
                    >
                        <textarea
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e as any); }}
                            rows={3}
                            placeholder="Describe geometry modifications... (Cmd/Ctrl + Enter)"
                            className="w-full resize-none bg-transparent px-3 py-2.5 font-sans text-[13px] text-[#D4D4D4] placeholder:text-[#A6A6A6] focus:outline-none custom-scrollbar"
                        />
                        <div className="flex items-center justify-between px-2 py-2 border-t border-[#3C3C3C]/50 bg-[#252526]/50 rounded-b-md">
                            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[#3C3C3C] transition-colors text-[#A6A6A6] hover:text-[#D4D4D4]">
                                <Upload size={14} />
                                <span className="font-sans text-[11px] font-medium">Attach Context</span>
                                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
                            </label>

                            <button
                                type="submit"
                                disabled={!canSubmit}
                                className="flex items-center gap-1.5 rounded-md bg-[#007ACC] px-4 py-1.5 font-sans text-[11px] font-semibold text-white transition-all hover:bg-[#007ACC]/90 hover:shadow-md disabled:bg-[#3C3C3C] disabled:text-[#A6A6A6] disabled:shadow-none active:scale-[0.98]"
                            >
                                {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <SendHorizontal size={12} />}
                                {isGenerating ? 'Synthesising' : 'Execute'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            {!isOpen && (
                <div className="absolute inset-0 flex flex-col items-center py-4 bg-[#1E1E1E] text-[#A6A6A6] z-20">
                    {/* Top Section: Brand Icon */}
                    <button
                        onClick={() => setIsOpen(true)}
                        className="flex size-8 items-center justify-center rounded-md bg-[#007ACC]/10 border border-[#007ACC]/30 text-[#007ACC] hover:bg-[#007ACC]/20 hover:scale-105 active:scale-95 transition-all mb-6 cursor-pointer"
                        title="Expand CAD Copilot"
                    >
                        <Box size={16} />
                    </button>

                    {/* Middle Section: Chat Icon */}
                    <div className="flex-1 flex flex-col items-center gap-4">
                        <button
                            onClick={() => setIsOpen(true)}
                            className="group relative flex size-8 items-center justify-center rounded-md hover:bg-[#3C3C3C] hover:text-[#D4D4D4] hover:scale-105 active:scale-95 transition-all cursor-pointer"
                        >
                            <Sparkles size={16} />
                            {/* Modern Tooltip */}
                            <span className="absolute left-11 scale-0 group-hover:scale-100 transition-all duration-150 origin-left bg-[#1E1E1E] border border-[#3C3C3C] text-[#D4D4D4] text-[10px] rounded px-2 py-1 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                Open Chat
                            </span>
                        </button>
                    </div>

                    {/* Bottom Section: Log Out */}
                    <div className="flex flex-col items-center gap-4">
                        <button
                            onClick={() => signOut({ callbackUrl: '/app/login' })}
                            className="group relative flex size-8 items-center justify-center rounded-md hover:bg-red-500/20 hover:text-red-400 hover:scale-105 active:scale-95 transition-all cursor-pointer"
                        >
                            <LogOut size={16} />
                            <span className="absolute left-11 scale-0 group-hover:scale-100 transition-all duration-150 origin-left bg-[#1E1E1E] border border-[#3C3C3C] text-[#D4D4D4] text-[10px] rounded px-2 py-1 shadow-xl whitespace-nowrap z-50 pointer-events-none">
                                Sign Out
                            </span>
                        </button>
                    </div>
                </div>
            )}
        </aside>
    );
}