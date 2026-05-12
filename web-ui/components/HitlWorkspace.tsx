'use client';

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Focus, Trash2, Zap } from 'lucide-react';

import { useCADEngine, type EngineError } from '@/hooks/useCADEngine';
import { extractOpenScadParameters, injectOpenScadParameters } from '@/lib/openscadParameters';

import { ChatPanel }      from './ChatPanel';
import { EditorDrawer }   from './EditorDrawer';
import { ParameterInput } from './ParameterInput';
import { Viewport }       from './Viewport';

// ── Types ─────────────────────────────────────────────────────────────────────

type Message = { id: string; role: 'user' | 'assistant' | 'system'; content: string };

type Selection = { id: string; point: [number, number, number] };

// ── Constants ─────────────────────────────────────────────────────────────────

const MODEL_OPTIONS = [
	{ value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite Preview'  },
	{ value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash'  },
];

const SYSTEM_MSG: Message = {
	id:      'sys-0',
	role:    'system',
	content: 'Neural CAD Engine online. Upload a technical blueprint (PNG, JPEG, or PDF) to begin geometry generation.',
};

const WASM_REPAIR_PROMPTS: Record<EngineError['errorType'], (err: EngineError, script: string) => string> = {
	OutOfBounds: (err, script) =>
		`WASM KERNEL PANIC - Memory Access Out of Bounds.\n\nThe OpenSCAD WASM engine exhausted its heap while compiling the script below. The root cause is likely: a high-$fn cylinder/sphere, a Minkowski sum, or deeply chained boolean operations.\n\nFIX REQUIRED:\n1. Set $fn = 32 globally.\n2. Avoid minkowski() or recursion.\n3. Simplify complex boolean operations.\n4. Preserve all PARAMETERS block values and // @id: tags.\n\nWASM STDERR:\n${err.details || 'none'}\n\nSCRIPT TO FIX:\n${script}`,

	CompileFailure: (err, script) =>
		`WASM COMPILE ERROR - Syntax or semantic failure.\n\nFix all errors. Apply the 'Epsilon Rule' if a CGAL pointer crash occurred. Do NOT change the PARAMETERS block or // @id: tags.\n\nCOMPILER OUTPUT:\n${err.details || err.message}\n\nSCRIPT TO FIX:\n${script}`,

	Timeout: (err, script) =>
		`WASM TIMEOUT - Script exceeded render time budget.\n\nReduce $fn (target 32), simplify hull, avoid recursion.\n\nSCRIPT TO FIX:\n${script}`,

	Unknown: (err, script) =>
		`WASM ENGINE ERROR: ${err.message}\n\nFix the script so it compiles cleanly.\n\nSCRIPT TO FIX:\n${script}`,
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function HitlWorkspace() {

	// Layout
	const [chatWidth,    setChatWidth]    = useState(420);
	const [drawerOpen,   setDrawerOpen]   = useState(true);
	const [activeTab,    setActiveTab]    = useState<'parameters' | 'code'>('parameters');

	// AI workflow
	const [messages,      setMessages]      = useState<Message[]>([SYSTEM_MSG]);
	const [prompt,        setPrompt]        = useState('Generate a parametric mechanical part from this blueprint.');
	const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].value);
	const [selectedFile,  setSelectedFile]  = useState<File | null>(null);
	const [isGenerating,  setIsGenerating]  = useState(false);

	// CAD state
	const [cadScript,   setCadScript]   = useState('');
	const [parameters,  setParameters]  = useState<Record<string, unknown>>({});
	const [selection,   setSelection]   = useState<Selection | null>(null);

	// WASM engine
	const { stlUrl, statusText, engineError, isRecompiling, rebuild, respawn } = useCADEngine({
		script:    cadScript,
		enabled:   !!cadScript,
	});

	// ── Resizer ───────────────────────────────────────────────────────────────
	const resizing = useRef(false);
	useEffect(() => {
		const move = (e: MouseEvent) => {
			if (!resizing.current) return;
			setChatWidth(Math.max(320, Math.min(680, e.clientX)));
		};
		const up = () => { resizing.current = false; };
		window.addEventListener('mousemove', move);
		window.addEventListener('mouseup', up);
		return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
	}, []);

	// ── Parameter sync ────────────────────────────────────────────────────────
	useEffect(() => {
		if (!cadScript) return;
		const next = extractOpenScadParameters(cadScript);
		if (Object.keys(next).length > 0) {
			setParameters((prev) =>
				JSON.stringify(prev) === JSON.stringify(next) ? prev : next
			);
		}
	}, [cadScript]);

	// ── Helpers ───────────────────────────────────────────────────────────────

	const pushMessage = (role: Message['role'], content: string) =>
		setMessages((prev) => [...prev, { id: `${Date.now()}-${Math.random()}`, role, content }]);

	const callAPI = useCallback(async (formData: FormData): Promise<string | null> => {
		const res = await fetch('/api/v1/generate', { method: 'POST', body: formData });
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
		}
		const data = await res.json();
		return data.openscad_script ?? null;
	}, []);

	// ── Handler: Generate ─────────────────────────────────────────────────────
	const handleGenerate = async (e?: FormEvent) => {
		e?.preventDefault();
		if (!selectedFile && !cadScript) {
			toast.error('Upload a blueprint first.');
			return;
		}

		const userMsg = prompt.trim() || 'Refine the geometry.';
		pushMessage('user', userMsg);
		setIsGenerating(true);

		const form = new FormData();
		form.append('prompt',     userMsg);
		form.append('model_name', selectedModel);
		if (selectedFile) form.append('image', selectedFile);
		if (cadScript)    form.append('base_code', cadScript);
		if (selection)    form.append('selection_context', JSON.stringify(selection));

		try {
			const script = await callAPI(form);
			if (script) {
				setCadScript(script);
				setActiveTab('code');
				pushMessage('assistant', 'Geometry synthesised. Handing off to WASM engine for compilation…');
				toast.success('Script generated', { description: 'WASM is now compiling the mesh.' });
			}
		} catch (err) {
			toast.error('Generation failed', { description: String(err) });
		} finally {
			setIsGenerating(false);
			setPrompt('');
		}
	};

	// ── Handler: Self-Healing Repair ─────────────────────────────────────────
	const handleSelfFix = async (err: EngineError) => {
		if (!cadScript) return;

		// Respawn the worker first to guarantee a clean 0-byte WASM heap
		// before the repaired script is dispatched.
		respawn();

		const repairPrompt = WASM_REPAIR_PROMPTS[err.errorType]?.(err, cadScript)
			?? WASM_REPAIR_PROMPTS.Unknown(err, cadScript);

		pushMessage('user', `[Auto-Repair] ${err.errorType} — requesting AI fix…`);
		toast.info('Sending error context to AI…');
		setIsGenerating(true);

		const form = new FormData();
		form.append('prompt',     repairPrompt);
		form.append('model_name', selectedModel);
		form.append('base_code',  cadScript);

		try {
			const script = await callAPI(form);
			if (script) {
				setCadScript(script);
				pushMessage('assistant', 'Script repaired. Recompiling with WASM engine…');
				toast.success('Repair successful');
			}
		} catch (err) {
			toast.error('Repair failed', { description: String(err) });
		} finally {
			setIsGenerating(false);
		}
	};

	// ── Handler: Parameter Change ─────────────────────────────────────────────
	const handleParamChange = (key: string, value: unknown) => {
		const next = { ...parameters, [key]: value };
		setParameters(next);
		setCadScript(injectOpenScadParameters(cadScript, next));
	};

	// ── Mesh click ────────────────────────────────────────────────────────────
	const handleMeshClick = (point: [number, number, number] | null) => {
		if (point) {
			setSelection({ id: 'selected_feature', point });
			setActiveTab('parameters');
		} else {
			setSelection(null);
		}
	};

	// ── Download STL ─────────────────────────────────────────────────────────
	const handleDownload = () => {
		if (!stlUrl) return;
		const a = document.createElement('a');
		a.href     = stlUrl;
		a.download = 'cad-copilot-output.stl';
		a.click();
	};

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<div className="flex h-screen w-full overflow-hidden bg-[#050505] text-zinc-100 selection:bg-amber-500/20">

			{/* ── Left: Chat Panel ─────────────────────────────────────────── */}
			<ChatPanel
				messages={messages}
				prompt={prompt}
				setPrompt={setPrompt}
				selectedModel={selectedModel}
				setSelectedModel={setSelectedModel}
				modelOptions={MODEL_OPTIONS}
				selectedFile={selectedFile}
				onFileChange={setSelectedFile}
				isGenerating={isGenerating}
				onSubmit={handleGenerate}
				width={chatWidth}
			>
				{/* Selection badge */}
				{selection && (
					<div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 animate-in fade-in zoom-in-95 duration-150">
						<div className="flex items-center gap-2">
							<Focus size={12} className="text-amber-400" />
							<span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-amber-400">
								Focused: {selection.id}
							</span>
						</div>
						<button
							onClick={() => setSelection(null)}
							className="text-zinc-700 hover:text-red-400 transition-colors"
						>
							<Trash2 size={11} />
						</button>
					</div>
				)}
			</ChatPanel>

			{/* ── Resizer ───────────────────────────────────────────────────── */}
			<div
				className="w-[2px] shrink-0 cursor-col-resize bg-zinc-900 hover:bg-amber-500/40 transition-colors"
				onMouseDown={() => { resizing.current = true; }}
			/>

			{/* ── Centre: Viewport ──────────────────────────────────────────── */}
			<main className="relative flex flex-1 overflow-hidden">
				<Viewport
					stlUrl={stlUrl}
					statusText={isGenerating ? 'AI Synthesising…' : statusText}
					isCompiling={isRecompiling || isGenerating}
					onMeshClick={handleMeshClick}
					onDownloadStl={handleDownload}
				/>

				{/* WASM Error Banner */}
				{engineError && (
					<div className="absolute inset-x-6 bottom-6 z-30 flex items-start gap-4 rounded-2xl border border-red-500/25 bg-zinc-950/95 p-4 shadow-[0_0_40px_rgba(239,68,68,0.1)] backdrop-blur-xl animate-in slide-in-from-bottom-4 duration-300">
						<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20">
							<AlertTriangle size={16} className="text-red-400" />
						</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2 mb-1">
								<span className="font-mono text-[9px] font-black uppercase tracking-[0.2em] text-red-400">
									Kernel Exception
								</span>
								<span className="rounded-full bg-red-500/10 px-2 py-0.5 font-mono text-[8px] uppercase tracking-widest text-red-500/70">
									{engineError.errorType}
								</span>
							</div>
							<p className="font-mono text-[11px] text-zinc-400 truncate">{engineError.message}</p>
							{engineError.details && (
								<p className="mt-1 font-mono text-[9px] text-zinc-700 line-clamp-2">{engineError.details}</p>
							)}
						</div>
						<button
							onClick={() => handleSelfFix(engineError)}
							className="shrink-0 flex items-center gap-2 rounded-xl bg-red-500 px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-red-400 active:scale-95"
						>
							<Zap size={12} fill="currentColor" />
							Auto-Fix
						</button>
					</div>
				)}
			</main>

			{/* ── Right: Editor Drawer ──────────────────────────────────────── */}
			<EditorDrawer
				isOpen={drawerOpen}
				setIsOpen={setDrawerOpen}
				activeTab={activeTab}
				setActiveTab={setActiveTab}
				cadScript={cadScript}
				onScriptChange={setCadScript}
				onRebuild={rebuild}
				isCompiling={isRecompiling}
				hasScript={!!cadScript}
			>
				{Object.keys(parameters).length > 0 ? (
					<div className="space-y-5">
						{Object.entries(parameters).map(([key, val]) => (
							<ParameterInput
								key={key}
								label={key}
								value={val}
								isFocused={!!selection?.id.includes(key)}
								onChange={(v) => handleParamChange(key, v)}
							/>
						))}
					</div>
				) : null}
			</EditorDrawer>
		</div>
	);
}