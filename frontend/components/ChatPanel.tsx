'use client';

import { type FormEvent, useEffect, useRef } from 'react';
import { Upload, X, Sparkles, Binary, LogOut, ChevronLeft, ChevronRight, Box, ArrowUp, Paperclip, Target, FileText, Image } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
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
    uploadedFiles: File[];
    onUpdateMessageFile?: (messageId: string, file: File | null) => void;
    targetPoint?: [number, number, number] | null;
    onClearTargetPoint?: () => void;
    children?: React.ReactNode;
};

export function ChatPanel({
    isOpen, setIsOpen,
    messages, prompt, setPrompt,
    selectedModel, setSelectedModel, modelOptions,
    selectedFile, onFileChange,
    isGenerating, onSubmit, width, hasScript,
    uploadedFiles, onUpdateMessageFile,
    targetPoint, onClearTargetPoint,
    children,
}: Props) {
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const canSubmit = !isGenerating && prompt.trim().length > 0;

    return (
        <aside
            className={`relative flex shrink-0 flex-col border-r border-zinc-800 bg-[#09090b] transition-all duration-300 ${isOpen ? '' : 'w-14'}`}
            style={isOpen ? { width } : undefined}
        >
            {/* Expand/Collapse Toggle */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`group absolute -right-4 top-1/2 z-40 flex h-12 w-4 -translate-y-1/2 items-center justify-center rounded-r-md border-y border-r border-zinc-800 text-zinc-500 transition-all duration-200 hover:w-5 hover:bg-zinc-800 hover:text-zinc-300 cursor-pointer ${isOpen ? 'bg-[#09090b]' : 'bg-zinc-900'}`}
            >
                {isOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
            </button>

            <div className={`flex flex-1 flex-col overflow-hidden transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
                
                {/* Header */}
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-800/60 bg-[#09090b]/80 backdrop-blur-md px-5 z-10">
                    <div 
                        onClick={() => window.location.replace('/app')}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer"
                    >
                        <div className="flex size-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
                            <Box size={16} />
                        </div>
                        <span className="font-sans text-[14px] font-semibold tracking-wide text-zinc-100">
                            CADVΞX
                        </span>
                    </div>
                    <div className="flex items-center gap-3">
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 font-sans text-[12px] text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500/50 cursor-pointer shadow-sm hover:bg-zinc-800 transition-colors"
                        >
                            {modelOptions.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                        </select>
                        <button onClick={() => signOut({ callbackUrl: '/app/login' })} className="flex size-10 items-center justify-center rounded-xl text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-all">
                            <LogOut size={18} />
                        </button>
                    </div>
                </header>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto px-4 py-6 custom-scrollbar scroll-smooth">
                    <div className="max-w-3xl mx-auto space-y-4">
                        {messages.map((m) => (
                            <ChatBubble 
                                key={m.id} 
                                {...m} 
                                uploadedFiles={uploadedFiles}
                                onUpdateFile={(file) => onUpdateMessageFile?.(m.id, file)}
                            />
                        ))}
                        <div ref={bottomRef} className="h-4" />
                    </div>
                </div>

                {/* The "Proper" Composer Area */}
                <div className="shrink-0 px-4 pb-6 pt-2 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent">
                    <div className="max-w-3xl mx-auto flex flex-col gap-3">
                        
                        {children}

                        <form
                            onSubmit={onSubmit}
                            className="flex flex-col rounded-2xl border border-zinc-700/60 bg-zinc-900/50 shadow-sm focus-within:bg-zinc-800/60 focus-within:border-zinc-600 focus-within:ring-1 focus-within:ring-zinc-600 transition-all duration-200 overflow-hidden"
                        >
                            {/* File and Target Attachment Pills inside Composer */}
                            {(selectedFile || targetPoint) && (
                                <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1">
                                    {selectedFile && (
                                        <div className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-1.5 shadow-sm">
                                            {selectedFile.name.toLowerCase().endsWith('.pdf') ? (
                                                <FileText size={12} className="text-red-400" />
                                            ) : selectedFile.type.startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(selectedFile.name) ? (
                                                <Image size={12} className="text-blue-400" />
                                            ) : (
                                                <Binary size={12} className="text-zinc-400" />
                                            )}
                                            <span className="max-w-[200px] truncate font-sans text-[12px] font-medium text-zinc-200">
                                                {selectedFile.name}
                                            </span>
                                            <button 
                                                type="button"
                                                onClick={() => onFileChange(null)} 
                                                className="ml-1 rounded-full p-0.5 text-zinc-400 hover:bg-zinc-600 hover:text-zinc-100 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}
                                    {targetPoint && (
                                        <div className="inline-flex items-center gap-2 rounded-xl border border-blue-500/30 bg-blue-950/30 px-3 py-1.5 shadow-sm">
                                            <Target size={12} className="text-blue-400" />
                                            <span className="font-sans text-[12px] font-medium text-blue-200">
                                                Target: [{targetPoint[0].toFixed(2)}, {targetPoint[1].toFixed(2)}, {targetPoint[2].toFixed(2)}]
                                            </span>
                                            <button 
                                                type="button"
                                                onClick={onClearTargetPoint} 
                                                className="ml-1 rounded-full p-0.5 text-blue-400 hover:bg-blue-900/50 hover:text-blue-200 transition-colors"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Text Input */}
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e as any); }}
                                rows={Math.min(Math.max(prompt.split('\n').length, 1), 8)}
                                placeholder="Message CADVEX..."
                                className="w-full resize-none bg-transparent px-4 py-3 font-sans text-[14px] leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:outline-none custom-scrollbar"
                                style={{ minHeight: '52px', maxHeight: '200px' }}
                            />
                            
                            {/* Toolbar row under text */}
                            <div className="flex items-center justify-between px-2 pb-2 pt-1">
                                <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200 transition-colors" title="Attach file">
                                    <Paperclip size={16} />
                                    <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
                                </label>

                                <button
                                    type="submit"
                                    disabled={!canSubmit}
                                    className={`flex h-8 w-8 items-center justify-center rounded-full transition-all duration-200 ${
                                        canSubmit 
                                            ? 'bg-zinc-100 text-black hover:bg-white active:scale-95 shadow-md' 
                                            : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                                    }`}
                                >
                                    {isGenerating ? (
                                        <Spinner className="text-zinc-400" />
                                    ) : (
                                        <ArrowUp size={16} strokeWidth={2.5} />
                                    )}
                                </button>
                            </div>
                        </form>
                        
                        <div className="text-center px-4">
                            <span className="text-[11px] text-zinc-500 font-sans tracking-wide">
                                CADVEX can make mistakes. Verify critical dimensions.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Collapsed State Sidebar */}
            {!isOpen && (
                <div className="absolute inset-0 flex flex-col items-center py-4 bg-[#09090b] border-r border-zinc-800 z-20">
                    <button onClick={() => setIsOpen(true)} className="flex size-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-all mb-6 shadow-sm">
                        <Box size={20} />
                    </button>
                    <div className="flex-1 flex flex-col items-center gap-4">
                        <button onClick={() => setIsOpen(true)} className="flex size-10 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-all">
                            <Sparkles size={20} />
                        </button>
                    </div>
                    <div className="flex flex-col items-center gap-4">
                        <button onClick={() => signOut({ callbackUrl: '/app/login' })} className="flex size-10 items-center justify-center rounded-xl text-zinc-500 hover:bg-red-500/10 hover:text-red-400 transition-all">
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            )}
        </aside>
    );
}