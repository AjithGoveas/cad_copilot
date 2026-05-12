'use client';

import { type FormEvent, useEffect, useRef } from 'react';
import { SendHorizontal, Upload, X, Loader2 } from 'lucide-react';
import { ChatBubble } from './ChatBubble';

type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string };

type Props = {
	messages:       Message[];
	prompt:         string;
	setPrompt:      (v: string) => void;
	selectedModel:  string;
	setSelectedModel: (v: string) => void;
	modelOptions:   { value: string; label: string }[];
	selectedFile:   File | null;
	onFileChange:   (f: File | null) => void;
	isGenerating:   boolean;
	onSubmit:       (e: FormEvent) => void;
	width:          number;
	children?:      React.ReactNode;
};

export function ChatPanel({
	messages, prompt, setPrompt,
	selectedModel, setSelectedModel, modelOptions,
	selectedFile, onFileChange,
	isGenerating, onSubmit, width, children,
}: Props) {
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	const canSubmit = !isGenerating && prompt.trim().length > 0 && !!selectedFile;

	return (
		<section
			className="flex shrink-0 flex-col border-r border-white/5 bg-[#050505] dot-grid"
			style={{ width }}
		>
			{/* ── Header ─────────────────────────────────────────────────── */}
			<header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 px-5 glass">
				<div className="flex items-center gap-3">
					<div className="flex size-8 items-center justify-center rounded-xl bg-amber-500 shadow-[0_0_16px_rgba(245,158,11,0.3)]">
						<span className="font-mono text-sm font-black text-black">C</span>
					</div>
					<div>
						<p className="font-sans text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-100">
							CAD Copilot
						</p>
						<p className="font-mono text-[8px] uppercase tracking-widest text-amber-500/50">
							v2 · neural pipeline
						</p>
					</div>
				</div>

				{/* Model selector */}
				<div className="flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.03] px-3 py-1.5">
					<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
					<select
						value={selectedModel}
						onChange={(e) => setSelectedModel(e.target.value)}
						className="bg-transparent font-mono text-[9px] uppercase tracking-wider text-zinc-400 focus:outline-none cursor-pointer"
					>
						{modelOptions.map((o) => (
							<option key={o.value} value={o.value} className="bg-zinc-900">
								{o.label}
							</option>
						))}
					</select>
				</div>
			</header>

			{/* ── Messages ────────────────────────────────────────────────── */}
			<div className="flex-1 space-y-6 overflow-y-auto px-5 py-6">
				{messages.map((m) => (
					<ChatBubble key={m.id} {...m} />
				))}
				<div ref={bottomRef} />
			</div>

			{/* ── Bottom: context slot + input ────────────────────────────── */}
			<div className="shrink-0 border-t border-white/5 p-4 space-y-3">
				{children}

				{/* File badge */}
				{selectedFile && (
					<div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
						<Upload size={11} className="shrink-0 text-amber-500" />
						<span className="flex-1 truncate font-mono text-[10px] text-amber-400">{selectedFile.name}</span>
						<button onClick={() => onFileChange(null)} className="text-zinc-600 hover:text-zinc-200 transition-colors">
							<X size={12} />
						</button>
					</div>
				)}

				{/* Compose form */}
				<form
					onSubmit={onSubmit}
					className="rounded-2xl border border-white/5 bg-zinc-900/50 focus-within:border-amber-500/30 transition-colors overflow-hidden"
				>
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e as any); }}
						rows={3}
						placeholder="Describe the part you want to generate…"
						className="w-full resize-none bg-transparent px-4 pt-4 pb-2 font-sans text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none"
					/>

					<div className="flex items-center justify-between border-t border-white/5 bg-white/[0.02] px-4 py-2.5">
						<label className="cursor-pointer text-zinc-600 hover:text-amber-400 transition-colors">
							<Upload size={15} />
							<input
								type="file"
								accept="image/*,.pdf"
								className="hidden"
								onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
							/>
						</label>

						<button
							type="submit"
							disabled={!canSubmit}
							className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-black transition-all hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 active:scale-95"
						>
							{isGenerating
								? <Loader2 size={12} className="animate-spin" />
								: <SendHorizontal size={12} />
							}
							{isGenerating ? 'Processing…' : 'Generate'}
						</button>
					</div>
				</form>
			</div>
		</section>
	);
}