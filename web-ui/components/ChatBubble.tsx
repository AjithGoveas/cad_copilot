'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { User, Cpu, Copy, Check, FileText } from 'lucide-react';
import { toast } from 'sonner';

type Props = {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachment?: { name: string };
};

export function ChatBubble({ role, content, attachment }: Props) {
    const [copied, setCopied] = useState(false);
    const isUser = role === 'user';

    const copyCode = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success('Copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
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
                
                {/* Embedded File Attachment */}
                {attachment && (
                    <div className="flex items-center gap-2.5 p-2 bg-[#252526] rounded-md border border-[#3C3C3C] mb-3 shadow-sm transition-colors hover:border-[#007ACC]/50">
                        <FileText size={14} className="text-[#007ACC]" />
                        <span className="font-mono text-[11px] text-[#D4D4D4] truncate max-w-[150px]">{attachment.name}</span>
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