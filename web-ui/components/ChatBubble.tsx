'use client';

import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { User, Cpu, Copy, Check, FileText, ChevronDown, Upload, Trash2, Plus, Binary } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachment?: { name: string; file?: File };
    uploadedFiles?: File[];
    onUpdateFile?: (file: File | null) => void;
};

export function ChatBubble({ role, content, attachment, uploadedFiles = [], onUpdateFile }: Props) {
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
        <div className={`flex w-full flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
            <div className={`flex items-center gap-1.5 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
                <div className="font-sans text-[11px] font-medium text-[#A6A6A6]">
                    {isUser ? 'You' : 'CAD Copilot'}
                </div>
            </div>

            {/* Bubble Container */}
            <div className={`relative max-w-[90%] rounded-md px-4 py-3 text-[13px] leading-relaxed shadow-sm transition-all duration-300 ${
                isUser ? 'bg-[#2D2D30] border border-[#3C3C3C] text-[#D4D4D4]' : 'bg-[#1E1E1E] border border-[#3C3C3C] text-[#D4D4D4]'
            }`}>
                
                {/* User Attachment / File Actions */}
                {isUser && (
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        {attachment ? (
                            <div className="relative flex items-center gap-2 rounded-md border border-[#3C3C3C] bg-[#252526] px-2.5 py-1.5 shadow-sm">
                                <FileText size={13} className="text-[#007ACC]" />
                                <span className="font-mono text-[11px] text-[#D4D4D4] truncate max-w-[120px]" title={attachment.name}>
                                    {attachment.name}
                                </span>
                                
                                <div className="relative inline-block text-left ml-1">
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsMenuOpen(!isMenuOpen);
                                        }}
                                        className="flex h-5 w-5 items-center justify-center rounded hover:bg-[#3C3C3C] text-[#A6A6A6] hover:text-[#D4D4D4] transition-colors cursor-pointer"
                                        title="Change file attachment"
                                    >
                                        <ChevronDown size={12} />
                                    </button>

                                    {isMenuOpen && (
                                        <>
                                            <div className="fixed inset-0 z-50" onClick={() => setIsMenuOpen(false)} />
                                            <div className="absolute right-0 mt-1.5 w-48 rounded-md border border-[#3C3C3C] bg-[#1E1E1E] py-1 shadow-xl z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                                                <button
                                                    onClick={() => {
                                                        setIsMenuOpen(false);
                                                        triggerFilePicker();
                                                    }}
                                                    className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[11px] text-[#D4D4D4] hover:bg-[#007ACC] hover:text-white transition-colors cursor-pointer"
                                                >
                                                    <Upload size={12} />
                                                    <span>Upload Different File</span>
                                                </button>
                                                
                                                {uploadedFiles.length > 1 && (
                                                    <>
                                                        <div className="my-1 border-t border-[#3C3C3C]" />
                                                        <div className="px-3 py-1 font-sans text-[9px] font-bold text-[#808080] uppercase tracking-wider">
                                                            Reuse Uploaded File
                                                        </div>
                                                        <div className="max-h-32 overflow-y-auto custom-scrollbar">
                                                            {uploadedFiles
                                                                .filter(f => f.name !== attachment.name)
                                                                .map((f, idx) => (
                                                                    <button
                                                                        key={idx}
                                                                        onClick={() => {
                                                                            setIsMenuOpen(false);
                                                                            onUpdateFile?.(f);
                                                                        }}
                                                                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[10px] text-[#A6A6A6] hover:bg-[#007ACC] hover:text-white truncate transition-colors cursor-pointer"
                                                                        title={f.name}
                                                                    >
                                                                        <Binary size={10} className="shrink-0" />
                                                                        <span className="truncate">{f.name}</span>
                                                                    </button>
                                                                ))
                                                            }
                                                        </div>
                                                    </>
                                                )}
                                                
                                                <div className="my-1 border-t border-[#3C3C3C]" />
                                                <button
                                                    onClick={() => {
                                                        setIsMenuOpen(false);
                                                        onUpdateFile?.(null);
                                                    }}
                                                    className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[11px] text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                                                >
                                                    <Trash2 size={12} />
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
                                    className="flex items-center gap-1.5 rounded-md border border-[#3C3C3C]/60 bg-transparent hover:border-[#007ACC]/50 hover:bg-[#252526] px-2.5 py-1.5 font-sans text-[10px] text-[#A6A6A6] hover:text-[#D4D4D4] transition-all cursor-pointer"
                                >
                                    <Plus size={12} className="text-[#007ACC]" />
                                    <span>Attach Context</span>
                                </button>

                                {isMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-50" onClick={() => setIsMenuOpen(false)} />
                                        <div className="absolute left-0 mt-1.5 w-48 rounded-md border border-[#3C3C3C] bg-[#1E1E1E] py-1 shadow-xl z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                                            <button
                                                onClick={() => {
                                                    setIsMenuOpen(false);
                                                    triggerFilePicker();
                                                }}
                                                className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[11px] text-[#D4D4D4] hover:bg-[#007ACC] hover:text-white transition-colors cursor-pointer"
                                            >
                                                <Upload size={12} />
                                                <span>Upload Different File</span>
                                            </button>

                                            {uploadedFiles.length > 0 && (
                                                <>
                                                    <div className="my-1 border-t border-[#3C3C3C]" />
                                                    <div className="px-3 py-1 font-sans text-[9px] font-bold text-[#808080] uppercase tracking-wider">
                                                        Reuse Uploaded File
                                                    </div>
                                                    <div className="max-h-32 overflow-y-auto custom-scrollbar">
                                                        {uploadedFiles.map((f, idx) => (
                                                            <button
                                                                key={idx}
                                                                onClick={() => {
                                                                    setIsMenuOpen(false);
                                                                    onUpdateFile?.(f);
                                                                }}
                                                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[10px] text-[#A6A6A6] hover:bg-[#007ACC] hover:text-white truncate transition-colors cursor-pointer"
                                                                title={f.name}
                                                            >
                                                                <Binary size={10} className="shrink-0" />
                                                                <span className="truncate">{f.name}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*,.pdf"
                            className="hidden"
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                    onUpdateFile?.(file);
                                }
                            }}
                        />
                    </div>
                )}

                <div className="prose prose-invert prose-sm max-w-none">
                    <ReactMarkdown
                        components={{
                            code({ className, children, ...props }) {
                                const lang = /language-(\w+)/.exec(className || '')?.[1];
                                const codeStr = String(children).replace(/\n$/, '');

                                if (lang) {
                                    return (
                                        <div className="relative my-3 overflow-hidden rounded-md border border-[#3C3C3C] bg-[#1E1E1E] shadow-sm">
                                            <div className="flex items-center justify-between border-b border-[#3C3C3C] bg-[#252526] px-3 py-1.5">
                                                <span className="font-mono text-[10px] text-[#A6A6A6]">{lang}</span>
                                                <button onClick={() => copyCode(codeStr)} className="flex items-center gap-1.5 font-sans font-medium text-[10px] text-[#A6A6A6] hover:text-[#D4D4D4] transition-colors">
                                                    {copied ? <Check size={12} className="text-[#007ACC]" /> : <Copy size={12} />}
                                                    {copied ? 'Copied' : 'Copy'}
                                                </button>
                                            </div>
                                            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed custom-scrollbar">
                                                <code className={className} {...props}>{children}</code>
                                            </pre>
                                        </div>
                                    );
                                }
                                return <code className="rounded-md bg-[#252526] px-1.5 py-0.5 border border-[#3C3C3C]/50 font-mono text-[11px] text-[#007ACC]" {...props}>{children}</code>;
                            },
                            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                            ul: ({ children }) => <ul className="mb-2 list-disc pl-4 marker:text-[#A6A6A6]">{children}</ul>,
                            ol: ({ children }) => <ol className="mb-2 list-decimal pl-4 marker:text-[#A6A6A6]">{children}</ol>,
                        }}
                    >
                        {content || '…'}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
}