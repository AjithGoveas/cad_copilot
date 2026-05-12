'use client';

import Editor from '@monaco-editor/react';
import { ChevronLeft, ChevronRight, Code2, Loader2, Sliders, Wrench } from 'lucide-react';

type Tab = 'parameters' | 'code';

type Props = {
	isOpen:         boolean;
	setIsOpen:      (v: boolean) => void;
	activeTab:      Tab;
	setActiveTab:   (v: Tab) => void;
	cadScript:      string;
	onScriptChange: (v: string) => void;
	onRebuild:      () => void;
	isCompiling:    boolean;
	hasScript:      boolean;
	children?:      React.ReactNode;  // parameter inputs slot
};

const TABS: { id: Tab; icon: typeof Sliders; label: string }[] = [
	{ id: 'parameters', icon: Sliders, label: 'Params'  },
	{ id: 'code',       icon: Code2,   label: 'Source'  },
];

export function EditorDrawer({
	isOpen, setIsOpen,
	activeTab, setActiveTab,
	cadScript, onScriptChange,
	onRebuild, isCompiling, hasScript,
	children,
}: Props) {
	return (
		<aside
			className={`relative flex shrink-0 flex-col border-l border-white/5 bg-[#050505] transition-all duration-500 ease-[cubic-bezier(0.2,1,0.2,1)] dot-grid ${
				isOpen ? 'w-[440px]' : 'w-14'
			}`}
		>
			{/* Collapse toggle */}
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="absolute left-3 top-[18px] z-20 flex size-8 items-center justify-center rounded-xl border border-white/8 bg-zinc-900/60 text-zinc-500 transition-all hover:border-amber-500/50 hover:text-amber-400 backdrop-blur-sm"
			>
				{isOpen ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
			</button>

			{/* Content (hidden when collapsed) */}
			<div className={`flex flex-1 flex-col overflow-hidden transition-all duration-500 ${
				isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
			}`}>

				{/* Header tabs */}
				<header className="flex h-16 shrink-0 items-center gap-1.5 border-b border-white/5 glass pl-14 pr-5">
					{TABS.map(({ id, icon: Icon, label }) => (
						<button
							key={id}
							onClick={() => setActiveTab(id)}
							className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[9px] font-bold uppercase tracking-[0.15em] transition-all ${
								activeTab === id
									? 'bg-amber-500 text-black shadow-[0_0_12px_rgba(245,158,11,0.25)]'
									: 'text-zinc-600 hover:text-zinc-300 hover:bg-white/5'
							}`}
						>
							<Icon size={11} />
							{label}
						</button>
					))}
				</header>

				{/* Tab content */}
				<div className="flex-1 overflow-y-auto">
					{activeTab === 'parameters' ? (
						<div className="space-y-1 p-5 animate-in fade-in slide-in-from-right-3 duration-200">
							<div className="mb-4 flex items-center gap-3">
								<h2 className="font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-700">Properties</h2>
								<div className="h-px flex-1 bg-zinc-900" />
							</div>
							{children ?? (
								<p className="font-mono text-[10px] text-zinc-700">
									No parameters — generate a script first.
								</p>
							)}
						</div>
					) : (
						<div className="flex h-full flex-col p-5 animate-in fade-in slide-in-from-right-3 duration-200">
							<div className="mb-3 flex items-center justify-between">
								<h2 className="font-mono text-[9px] font-bold uppercase tracking-[0.25em] text-zinc-700">OpenSCAD Source</h2>
								<span className="font-mono text-[8px] uppercase tracking-tighter text-zinc-800">WASM / BOSL2</span>
							</div>
							<div className="flex-1 overflow-hidden rounded-xl border border-zinc-900 bg-black shadow-2xl">
								<Editor
									height="100%"
									language="cpp"
									theme="vs-dark"
									value={cadScript}
									onChange={(v) => onScriptChange(v ?? '')}
									options={{
										minimap:     { enabled: false },
										fontSize:    12,
										lineNumbers: 'on',
										wordWrap:    'on',
										padding:     { top: 16 },
										scrollBeyondLastLine: false,
									}}
								/>
							</div>
						</div>
					)}
				</div>

				{/* Rebuild button */}
				<div className="shrink-0 border-t border-white/5 p-4">
					<button
						onClick={onRebuild}
						disabled={isCompiling || !hasScript}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-mono text-[10px] font-bold uppercase tracking-widest text-black shadow-lg shadow-emerald-500/15 transition-all hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-900 disabled:text-zinc-700 active:scale-[0.98]"
					>
						{isCompiling
							? <><Loader2 size={13} className="animate-spin" /> Compiling…</>
							: <><Wrench  size={13} /> Rebuild Geometry</>
						}
					</button>
				</div>
			</div>

			{/* Collapsed label */}
			{!isOpen && (
				<div className="absolute inset-y-0 inset-x-0 flex items-center justify-center pointer-events-none pt-16">
					<span className="rotate-90 whitespace-nowrap font-mono text-[8px] font-bold uppercase tracking-[0.5em] text-zinc-800">
						Config &amp; Source
					</span>
				</div>
			)}
		</aside>
	);
}
