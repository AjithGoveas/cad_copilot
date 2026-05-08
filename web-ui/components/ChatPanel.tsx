'use client';

import { FormEvent, useRef, useEffect } from 'react';
import { SendHorizontal, Upload, Loader2 } from 'lucide-react';
import { ChatBubble } from './ChatBubble';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
};

type ChatPanelProps = {
	messages: ChatMessage[];
	prompt: string;
	setPrompt: (v: string) => void;
	selectedModel: string;
	setSelectedModel: (v: string) => void;
	modelOptions: { value: string; label: string }[];
	selectedFile: File | null;
	handleFileChange: (file: File | null) => void;
	isGenerating: boolean;
	onSubmit: (e: FormEvent<HTMLFormElement>) => void;
	width: number;
};

export function ChatPanel({
	messages,
	prompt,
	setPrompt,
	selectedModel,
	setSelectedModel,
	modelOptions,
	selectedFile,
	handleFileChange,
	isGenerating,
	onSubmit,
	width
}: ChatPanelProps) {
	const scrollRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	return (
		<section
			className="flex shrink-0 flex-col border-r border-zinc-800 bg-[#09090b] relative z-20"
			style={{ width: `${width}px` }}
		>
			{/* High-Fidelity Header */}
			<header className="flex h-16 items-center justify-between border-b border-zinc-800/50 bg-[#09090b]/50 px-6 backdrop-blur-md">
				<div className="flex items-center gap-3">
					<div className="flex size-7 items-center justify-center rounded-lg bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.4)]">
						<span className="text-sm font-black text-black">C</span>
					</div>
					<h1 className="text-xs font-bold tracking-widest text-zinc-100 font-sans uppercase">Cad Copilot</h1>
				</div>

				{/* Model Switcher - Hardware Module Style */}
				<div className="relative group">
					<div className="flex items-center gap-3 rounded-full border border-amber-500/20 bg-amber-500/5 px-4 py-1.5 transition-all hover:border-amber-500/50 hover:bg-amber-500/10 shadow-[0_0_15px_rgba(245,158,11,0.05)] cursor-pointer">
						<div className="size-1.5 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
						<div className="flex items-center gap-2">
							<span className="text-[9px] font-mono font-bold text-amber-500/60 uppercase tracking-[0.2em]">Core:</span>
							<select
								value={selectedModel}
								onChange={(e) => setSelectedModel(e.target.value)}
								className="bg-transparent text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-100 focus:outline-none cursor-pointer appearance-none pr-4"
							>
								{modelOptions.map((opt) => (
									<option key={opt.value} value={opt.value} className="bg-[#09090b] text-zinc-100 uppercase">
										{opt.label.split(' ')[0].replace('gemini-', '')}
									</option>
								))}
							</select>
							<div className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2">
								<svg className="size-3 text-amber-500/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
								</svg>
							</div>
						</div>
					</div>
				</div>
			</header>

			{/* Message Stream */}
			<div className="flex-1 space-y-8 overflow-y-auto px-6 py-8 custom-scrollbar scroll-smooth">
				{messages.map((msg) => (
					<ChatBubble key={msg.id} {...msg} />
				))}
				<div ref={scrollRef} />
			</div>

			{/* Action Card & Input */}
			<div className="p-6">
				<div className="relative">
					{/* Floating File Context */}
					{selectedFile && (
						<div className="absolute -top-14 left-0 right-0 z-10 animate-message">
							<div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-1.5 pl-3 pr-2 backdrop-blur-xl shadow-2xl">
								<div className="flex size-7 items-center justify-center rounded-lg bg-amber-500 text-black shadow-lg">
									<Upload className="size-3.5" />
								</div>
								<div className="flex-1 min-w-0">
									<p className="truncate text-[10px] font-mono font-bold text-amber-500/80 uppercase tracking-tighter">
										{selectedFile.name}
									</p>
								</div>
								<button
									onClick={() => handleFileChange(null)}
									className="p-1 text-zinc-500 hover:text-zinc-100 transition-colors"
								>
									<svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
									</svg>
								</button>
							</div>
						</div>
					)}

					<form onSubmit={onSubmit} className="relative group/form">
						<div className="relative overflow-hidden rounded-2xl border border-zinc-800/50 bg-[#111113] shadow-[0_20px_50px_rgba(0,0,0,0.5)] transition-all duration-300 focus-within:border-amber-500/40 focus-within:shadow-[0_0_30px_rgba(245,158,11,0.05)]">
							<textarea
								value={prompt}
								onChange={(e) => setPrompt(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter' && e.shiftKey) {
										e.preventDefault();
										onSubmit(e as any);
									}
								}}
								rows={3}
								placeholder="Describe your design intent..."
								className="w-full resize-none bg-transparent p-5 text-sm text-zinc-100 placeholder:text-zinc-700 focus:outline-none font-sans leading-relaxed"
							/>

							<div className="flex items-center justify-between border-t border-zinc-800/30 bg-white/2 px-4 py-3">
								<div className="flex items-center gap-2">
									<label className="group/btn relative flex cursor-pointer items-center justify-center rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-amber-500 transition-all">
										<Upload className="size-4" />
										<input
											type="file"
											accept="image/*,.pdf"
											className="hidden"
											onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
										/>
									</label>
									<div className="h-4 w-px bg-zinc-800/50" />
									<span className="text-[9px] font-mono font-bold uppercase tracking-[0.2em] text-zinc-600">
										{isGenerating ? 'Engine Processing' : 'Ready'}
									</span>
								</div>

								<button
									type="submit"
									disabled={isGenerating || !prompt.trim() || !selectedFile}
									className="flex h-9 items-center gap-2.5 rounded-lg bg-amber-500 px-4 text-[10px] font-black uppercase tracking-[0.2em] text-black shadow-lg hover:bg-amber-400 hover:scale-[1.02] active:scale-[0.98] disabled:bg-zinc-800 disabled:text-zinc-600 disabled:shadow-none disabled:scale-100 transition-all"
								>
									{isGenerating ? (
										<>
											<Loader2 className="size-3.5 animate-spin" />
											<span>Processing</span>
										</>
									) : (
										<>
											<SendHorizontal className="size-3.5" />
											<span>Generate</span>
										</>
									)}
								</button>
							</div>
						</div>
					</form>
				</div>
			</div>
		</section>
	);
}
