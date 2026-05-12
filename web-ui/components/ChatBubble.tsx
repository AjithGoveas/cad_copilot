'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { User, Cpu, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

type Role = 'user' | 'assistant' | 'system';

type Props = {
	id:      string;
	role:    Role;
	content: string;
};

export function ChatBubble({ role, content }: Props) {
	const [copied, setCopied] = useState(false);
	const isUser = role === 'user';

	const copyCode = (text: string) => {
		navigator.clipboard.writeText(text);
		setCopied(true);
		toast.success('Copied to clipboard');
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<div className={`group flex w-full flex-col gap-2 animate-message ${isUser ? 'items-end' : 'items-start'}`}>

			{/* Avatar + role label */}
			<div className={`flex items-center gap-2 px-1 ${isUser ? 'flex-row-reverse' : ''}`}>
				<div className={`flex size-5 items-center justify-center rounded-md ${isUser ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-amber-500'}`}>
					{isUser ? <User size={11} /> : <Cpu size={11} />}
				</div>
				<span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">{role}</span>
			</div>

			{/* Bubble */}
			<div
				className={`relative max-w-[90%] rounded-2xl px-5 py-4 text-[13px] leading-relaxed ${
					isUser
						? 'bg-amber-500 text-black rounded-tr-none'
						: 'glass text-zinc-200 rounded-tl-none'
				}`}
			>
				<div className="prose prose-invert prose-sm max-w-none">
					<ReactMarkdown
						components={{
							code({ className, children, ...props }) {
								const lang  = /language-(\w+)/.exec(className || '')?.[1];
								const codeStr = String(children).replace(/\n$/, '');

								if (lang) {
									return (
										<div className="relative my-3 overflow-hidden rounded-xl border border-white/5 bg-black/40">
											<div className="flex items-center justify-between border-b border-white/5 bg-white/[0.02] px-4 py-2">
												<div className="flex items-center gap-2">
													<span className="size-1.5 rounded-full bg-amber-500" />
													<span className="font-mono text-[10px] uppercase tracking-widest text-zinc-500">{lang}</span>
												</div>
												<button
													onClick={() => copyCode(codeStr)}
													className="flex items-center gap-1 font-mono text-[10px] text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 hover:text-amber-400"
												>
													{copied ? <Check size={11} /> : <Copy size={11} />}
													{copied ? 'Copied' : 'Copy'}
												</button>
											</div>
											<pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed">
												<code className={className} {...props}>{children}</code>
											</pre>
										</div>
									);
								}
								return (
									<code
										className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-300"
										{...props}
									>
										{children}
									</code>
								);
							},
							p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
							ul:     ({ children }) => <ul className="mb-2 list-disc pl-4 marker:text-amber-500/40">{children}</ul>,
							ol:     ({ children }) => <ol className="mb-2 list-decimal pl-4 marker:text-amber-500/40">{children}</ol>,
							strong: ({ children }) => <strong className="font-semibold text-amber-300">{children}</strong>,
						}}
					>
						{content || '…'}
					</ReactMarkdown>
				</div>
			</div>
		</div>
	);
}