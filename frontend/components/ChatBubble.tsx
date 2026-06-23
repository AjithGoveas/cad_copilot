'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Copy, Check, FileText, ChevronDown, Upload, Trash2, Plus, Binary, Image } from 'lucide-react';
import { toast } from 'sonner';
import styles from './ChatBubble.module.css';

type Props = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachment?: { name: string; file?: File };
    uploadedFiles?: File[];
    onUpdateFile?: (file: File | null) => void;
    isGenerating?: boolean;
};

export function ChatBubble({ role, content, attachment, uploadedFiles = [], onUpdateFile, isGenerating = false }: Props) {
    const [copied, setCopied] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const isUser = role === 'user';

    const copyCode = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
    };

    const triggerFilePicker = () => {
        fileInputRef.current?.click();
    };

    return (
        <div className={`flex w-full py-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`flex max-w-[85%] md:max-w-[80%] gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
                
                {/* Assistant Avatar */}
                {!isUser && (
                    <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full mt-1 transition-all duration-500 ${
                        isGenerating 
                            ? 'bg-gradient-to-tr from-blue-600 via-indigo-500 to-purple-600 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)]' 
                            : 'bg-blue-500/10 text-blue-400'
                    }`}>
                        <Sparkles size={14} className={isGenerating ? 'animate-pulse' : ''} />
                    </div>
                )}

                {/* Message Content Container */}
                <div className={`flex flex-col gap-2 w-full ${isUser ? 'items-end' : 'items-start'}`}>
                    
                    {/* User Attachment / Context Chip */}
                    {isUser && (
                        <div className="flex items-center gap-2 mb-1">
                            {attachment ? (
                                <div className="relative flex items-center gap-2 rounded-xl border border-zinc-700/60 bg-zinc-800/40 px-3 py-1.5 shadow-sm transition-hover hover:bg-zinc-800/80">
                                    {attachment.name.toLowerCase().endsWith('.pdf') ? (
                                        <FileText size={13} className="text-red-400" />
                                    ) : /\.(png|jpe?g|webp|heic|heif)$/i.test(attachment.name) ? (
                                        <Image size={13} className="text-blue-400" />
                                    ) : (
                                        <Binary size={13} className="text-zinc-400" />
                                    )}
                                    <span className="font-medium font-sans text-[12px] text-zinc-300 truncate max-w-[150px]" title={attachment.name}>
                                        {attachment.name}
                                    </span>
                                    
                                    <div className="relative ml-1 flex items-center">
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setIsMenuOpen(!isMenuOpen);
                                            }}
                                            className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                                        >
                                            <ChevronDown size={14} />
                                        </button>

                                        {isMenuOpen && (
                                            <>
                                                <div className="fixed inset-0 z-50" onClick={() => setIsMenuOpen(false)} />
                                                <div className="absolute right-0 top-6 mt-1 w-52 rounded-xl border border-zinc-700 bg-zinc-900 py-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95 duration-150">
                                                    <button
                                                        onClick={() => {
                                                            setIsMenuOpen(false);
                                                            triggerFilePicker();
                                                        }}
                                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-zinc-300 hover:bg-blue-600 hover:text-white transition-colors"
                                                    >
                                                        <Upload size={14} />
                                                        <span>Upload Different File</span>
                                                    </button>
                                                    <div className="my-1.5 mx-3 border-t border-zinc-800" />
                                                    <button
                                                        onClick={() => {
                                                            setIsMenuOpen(false);
                                                            onUpdateFile?.(null);
                                                        }}
                                                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-red-400 hover:bg-red-500/10 transition-colors"
                                                    >
                                                        <Trash2 size={14} />
                                                        <span>Remove Attachment</span>
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            ) : (
                                <div className="relative inline-block text-left">
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsMenuOpen(!isMenuOpen);
                                        }}
                                        className="flex items-center gap-1.5 rounded-full border border-dashed border-zinc-600 bg-transparent hover:border-blue-500/50 hover:bg-zinc-800/50 px-3 py-1 text-[11px] text-zinc-400 hover:text-zinc-300 transition-all cursor-pointer"
                                    >
                                        <Plus size={13} className="text-blue-400" />
                                        <span>Add Context</span>
                                    </button>
                                </div>
                            )}
                            <input type="file" ref={fileInputRef} accept="image/*,.pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) onUpdateFile?.(file); }} />
                        </div>
                    )}

                    {/* Main Message Bubble */}
                    {isGenerating ? (
                        <div className={`flex flex-col gap-2.5 w-full max-w-[240px] p-2 ${styles.geminiLoadingCard}`}>
                            <div className={`h-3 w-[90%] rounded-full opacity-85 ${styles.geminiShimmer}`} />
                            <div className={`h-3 w-[100%] rounded-full opacity-70 ${styles.geminiShimmer}`} />
                            <div className={`h-3 w-[65%] rounded-full opacity-50 ${styles.geminiShimmer}`} />
                        </div>
                    ) : (
                        <div className={`relative transition-all duration-300 ${
                            isUser 
                                ? 'bg-zinc-800 border border-zinc-700/50 text-zinc-100 rounded-3xl rounded-br-sm px-4 py-2.5 shadow-sm text-[14px]' 
                                : 'bg-transparent text-zinc-200 rounded-lg py-1 text-[14px]' // TIGHTER PADDING FOR AI
                        }`}>
                            <div className="prose prose-invert prose-sm max-w-none break-words leading-normal">
                                <ReactMarkdown
                                    components={{
                                        code({ className, children, ...props }) {
                                            const lang = /language-(\w+)/.exec(className || '')?.[1];
                                            const codeStr = String(children).replace(/\n$/, '');

                                            if (lang) {
                                                return (
                                                    <div className="relative my-3 overflow-hidden rounded-lg border border-zinc-700/50 bg-[#1e1e20] shadow-sm">
                                                        <div className="flex items-center justify-between bg-zinc-800/40 px-3 py-1.5">
                                                            <span className="font-mono text-[10px] font-medium text-zinc-400 uppercase tracking-wider">{lang}</span>
                                                            <button 
                                                                onClick={() => copyCode(codeStr)} 
                                                                className="flex items-center gap-1.5 font-sans font-medium text-[10px] text-zinc-400 hover:text-zinc-200 transition-colors rounded hover:bg-zinc-700/50 px-2 py-1"
                                                            >
                                                                {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                                                                {copied ? 'Copied' : 'Copy'}
                                                            </button>
                                                        </div>
                                                        <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed custom-scrollbar text-zinc-300">
                                                            <code className={className} {...props}>{children}</code>
                                                        </pre>
                                                    </div>
                                                );
                                            }
                                            return <code className="rounded text-[12px] bg-zinc-800/60 px-1.5 py-0.5 font-mono text-blue-300" {...props}>{children}</code>;
                                        },
                                        p: ({ children }) => <p className="mb-2.5 last:mb-0">{children}</p>,
                                        ul: ({ children }) => <ul className="mb-2.5 list-disc pl-4 marker:text-zinc-500 space-y-0.5">{children}</ul>,
                                        ol: ({ children }) => <ol className="mb-2.5 list-decimal pl-4 marker:text-zinc-500 space-y-0.5">{children}</ol>,
                                    }}
                                >
                                    {content || '…'}
                                </ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}