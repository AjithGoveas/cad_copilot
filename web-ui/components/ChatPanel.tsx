'use client';

import { type FormEvent, useEffect, useRef } from 'react';
import { SendHorizontal, Upload, X, Loader2, Sparkles, Binary } from 'lucide-react';
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
	hasScript:      boolean;
	children?:      React.ReactNode;
};

export function ChatPanel({
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
		<section
			className="flex shrink-0 flex-col border-r border-white/5 bg-[#050505] transition-all duration-500 ease-[cubic-bezier(0.2,1,0.2,1)] dot-grid"
			style={{ width }}
		>
			{/* ── Header ─────────────────────────────────────────────────── */}
			<header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 px-5 bg-black/40 backdrop-blur-md">
				<div className="flex items-center gap-3">
					<div className="group relative flex size-9 items-center justify-center rounded-xl bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all hover:scale-105 active:scale-95">
						<div className="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
						<Sparkles size={16} className="text-black" fill="currentColor" />
					</div>
					<div>
						<p className="font-sans text-[11px] font-black uppercase tracking-[0.25em] text-zinc-100">
							CAD Copilot
						</p>
						<p className="font-mono text-[8px] uppercase tracking-widest text-amber-500/60">
							Engine v2.5 · Active
						</p>
					</div>
				</div>

				{/* Model selector */}
				<div className="group flex items-center gap-2 rounded-xl border border-white/[0.03] bg-zinc-900/40 px-3 py-1.5 hover:border-white/10 transition-all">
					<div className="relative flex size-2 items-center justify-center">
						<span className="absolute size-full rounded-full bg-emerald-500/40 animate-ping" />
						<span className="relative size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
					</div>
					<select
						value={selectedModel}
						onChange={(e) => setSelectedModel(e.target.value)}
						className="bg-transparent font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-500 focus:outline-none cursor-pointer group-hover:text-zinc-300 transition-colors"
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
			<div className="flex-1 space-y-8 overflow-y-auto px-6 py-8 custom-scrollbar">
				{messages.map((m) => (
					<ChatBubble key={m.id} {...m} />
				))}
				<div ref={bottomRef} />
			</div>

			{/* ── Bottom: context slot + input ────────────────────────────── */}
			<div className="shrink-0 border-t border-white/5 p-6 space-y-4 bg-black/20">
				{children}

				{/* File badge */}
				{selectedFile && (
					<div className="flex items-center gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-3.5 py-2.5 animate-in slide-in-from-bottom-2 duration-300">
						<div className="flex size-6 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20">
							<Binary size={12} className="text-amber-500" />
						</div>
						<div className="flex-1 min-w-0">
							<p className="truncate font-mono text-[10px] font-bold text-amber-400/90 uppercase tracking-tight">
								{selectedFile.name}
							</p>
							<p className="font-mono text-[8px] text-amber-700 uppercase">Context Active</p>
						</div>
						<button 
							onClick={() => onFileChange(null)} 
							className="rounded-lg p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-200 transition-all"
						>
							<X size={14} />
						</button>
					</div>
				)}

				{/* Compose form */}
				<form
					onSubmit={onSubmit}
					className="group relative rounded-2xl border border-white/[0.05] bg-zinc-900/30 transition-all duration-300 focus-within:border-amber-500/40 focus-within:bg-zinc-900/50"
				>
					<textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e as any); }}
						rows={3}
						placeholder="Describe geometry modifications or generate new parts…"
						className="w-full resize-none bg-transparent px-4 pt-4 pb-2 font-sans text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none"
					/>

					<div className="flex items-center justify-between border-t border-white/[0.03] px-4 py-3">
						<label className="group/upload relative flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1 transition-all hover:bg-white/5">
							<Upload size={14} className="text-zinc-600 group-hover/upload:text-amber-400 transition-colors" />
							<span className="font-mono text-[9px] font-bold uppercase tracking-wider text-zinc-700 group-hover/upload:text-zinc-400">Context</span>
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
							className="group/btn flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2 font-mono text-[10px] font-black uppercase tracking-[0.15em] text-black shadow-lg shadow-amber-500/10 transition-all hover:bg-amber-400 hover:shadow-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-700 disabled:shadow-none active:scale-95"
						>
							{isGenerating
								? <Loader2 size={13} className="animate-spin" />
								: <SendHorizontal size={13} className="transition-transform group-hover/btn:translate-x-0.5" />
							}
							{isGenerating ? 'Synthesising…' : 'Execute'}
						</button>
					</div>
				</form>
			</div>
		</section>
	);
}