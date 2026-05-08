'use client';

import Editor from '@monaco-editor/react';
import { ChevronLeft, ChevronRight, Wrench, Loader2, Code2, Sliders } from 'lucide-react';

type DrawerTab = 'parameters' | 'code';

type EditorDrawerProps = {
	isOpen: boolean;
	setIsOpen: (v: boolean) => void;
	activeTab: DrawerTab;
	setActiveTab: (v: DrawerTab) => void;
	pythonScript: string;
	onScriptChange: (v: string) => void;
	onRenderSync: () => void;
	isRecompiling: boolean;
	hasSession: boolean;
	children?: React.ReactNode; // For ParameterInputs
};

export function EditorDrawer({
	isOpen,
	setIsOpen,
	activeTab,
	setActiveTab,
	pythonScript,
	onScriptChange,
	onRenderSync,
	isRecompiling,
	hasSession,
	children
}: EditorDrawerProps) {
	return (
		<aside
			className={`relative shrink-0 overflow-hidden border-l border-zinc-800 bg-[#09090b] transition-all duration-500 ease-[cubic-bezier(0.2,1,0.2,1)] ${
				isOpen ? 'w-112.5' : 'w-16'
			}`}
		>
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="absolute left-4 top-5 flex size-8 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-amber-500 hover:text-amber-500 transition-all z-20"
			>
				{isOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
			</button>

			<div className={`flex h-full flex-col ${!isOpen ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}>
				<header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/50 px-6 pl-16">
					<div className="flex gap-1">
						<button
							onClick={() => setActiveTab('parameters')}
							className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
								activeTab === 'parameters'
									? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
									: 'text-zinc-500 hover:text-zinc-300'
							}`}
						>
							<Sliders className="size-3" />
							Params
						</button>
						<button
							onClick={() => setActiveTab('code')}
							className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all ${
								activeTab === 'code'
									? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
									: 'text-zinc-500 hover:text-zinc-300'
							}`}
						>
							<Code2 className="size-3" />
							Engine
						</button>
					</div>
				</header>

				<div className="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar">
					{activeTab === 'parameters' ? (
						<div className="space-y-6">
							<div className="flex items-center justify-between">
								<h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">Dynamic Props</h2>
								<div className="h-px flex-1 mx-4 bg-zinc-800/50" />
							</div>
							{children}
						</div>
					) : (
						<div className="h-full flex flex-col">
							<div className="mb-4 flex items-center justify-between">
								<h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-600">Core Script</h2>
								<span className="text-[10px] font-mono text-zinc-700">PYTHON 3.10 // BUILD123D</span>
							</div>
							<div className="flex-1 overflow-hidden rounded-xl border border-zinc-800 bg-black/50 shadow-inner">
								<Editor
									height="100%"
									language="python"
									theme="vs-dark"
									value={pythonScript}
									onChange={(v) => onScriptChange(v || '')}
									options={{
										minimap: { enabled: false },
										fontSize: 12,
										fontFamily: 'var(--font-mono)',
										lineNumbers: 'on',
										wordWrap: 'on',
										scrollBeyondLastLine: false,
										padding: { top: 16 },
									}}
								/>
							</div>
						</div>
					)}
				</div>

				<div className="border-t border-zinc-800 p-6 bg-zinc-950/50 backdrop-blur-md">
					<button
						onClick={onRenderSync}
						disabled={isRecompiling || !hasSession || !pythonScript}
						className="group relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-xl bg-emerald-500 py-3 text-xs font-bold uppercase tracking-widest text-black shadow-[0_0_20px_rgba(16,185,129,0.2)] hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-40 disabled:scale-100 disabled:shadow-none"
					>
						{isRecompiling ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Wrench className="size-4 group-hover:rotate-45 transition-transform" />
						)}
						{isRecompiling ? 'Engine Working...' : 'Sync to Engine'}
						<div className="absolute inset-0 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent group-hover:translate-x-full transition-transform duration-1000" />
					</button>
				</div>
			</div>

			{!isOpen && (
				<div className="flex h-full flex-col items-center gap-6 pt-20">
					<div className="rotate-90 whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.4em] text-zinc-700">
						Properties & Logic
					</div>
				</div>
			)}
		</aside>
	);
}
