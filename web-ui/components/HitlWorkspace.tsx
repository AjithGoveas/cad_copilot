'use client';

import { useState, useCallback, useMemo } from 'react';
import { Viewport } from './Viewport';
import { ChatPanel } from './ChatPanel';
import { EditorDrawer } from './EditorDrawer';
import { ParameterInput } from './ParameterInput';
import { useCADEngine } from '@/hooks/useCADEngine';
import { toast } from 'sonner';
import { Target, AlertCircle } from 'lucide-react';
import { extractOpenScadParameters, injectOpenScadParameters } from '@/lib/openscadParameters';

type Message = {
	id:      string;
	role:    'user' | 'assistant';
	content: string;
};

type Selection = {
	id:    string;
	point: [number, number, number];
};

const MODEL_OPTIONS = [
	{ id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview',   icon: 'sparkles' },
	{ id: 'gemini-2.5-flash',   name: 'Gemini 2.5 Flash', icon: 'zap' },
];

export default function HitlWorkspace() {
	// ── State ────────────────────────────────────────────────────────────────
	const [prompt,        setPrompt]        = useState('');
	const [messages,      setMessages]      = useState<Message[]>([]);
	const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].id);
	const [selectedFile,  setSelectedFile]  = useState<File | null>(null);

	const [cadScript,   setCadScript]   = useState<string>('');
	const [parameters,  setParameters]  = useState<Record<string, any>>({});
	const [isGenerating, setIsGenerating] = useState(false);

	const modelValueOptions = useMemo(() => 
		MODEL_OPTIONS.map(m => ({ value: m.id, label: m.name })), 
	[]);

	const [isDrawerOpen, setIsDrawerOpen] = useState(true);
	const [activeTab,    setActiveTab]    = useState<'parameters' | 'code' | 'history'>('parameters');
	const [chatWidth,    setChatWidth]    = useState(450);
	const [selection,   setSelection]   = useState<Selection | null>(null);

	// WASM engine
	const { stlUrl, statusText, engineError, isRecompiling, rebuild, respawn, exportFile } = useCADEngine({
		script:    cadScript,
		enabled:   !!cadScript,
	});

	// ── Generation ────────────────────────────────────────────────────────────
	const handleGenerate = async (e?: React.FormEvent) => {
		if (e) e.preventDefault();
		if (!prompt.trim()) return;

		const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt };
		setMessages((prev) => [...prev, userMsg]);
		setPrompt('');
		setIsGenerating(true);

		try {
			const formData = new FormData();
			formData.append('prompt', prompt);
			formData.append('model',  selectedModel);
			if (selectedFile) formData.append('image', selectedFile);

			const res = await fetch('/api/v1/generate', {
				method: 'POST',
				body:   formData,
			});

			if (!res.ok) throw new Error('Generation failed');

			const data = await res.json();
			setCadScript(data.code);
			
			// Parse parameters from code
			const parsedParams = extractOpenScadParameters(data.code);
			setParameters(parsedParams);

			const assistantMsg: Message = {
				id:      (Date.now() + 1).toString(),
				role:    'assistant',
				content: `I've generated the OpenSCAD code for your request. You can now tweak the parameters in the drawer or edit the code directly.`,
			};
			setMessages((prev) => [...prev, assistantMsg]);
			setActiveTab('parameters');
		} catch (err) {
			toast.error('Failed to generate CAD model');
			console.error(err);
		} finally {
			setIsGenerating(false);
		}
	};

	// ── Handler: Parameter Change ─────────────────────────────────────────────
	const handleParamChange = useCallback((key: string, value: unknown) => {
		setParameters((prev) => {
			const next = { ...prev, [key]: value };
			setCadScript((script) => injectOpenScadParameters(script, next));
			return next;
		});
	}, []);

	// ── Handlers ─────────────────────────────────────────────────────────────
	const handleMeshClick = useCallback((point: [number, number, number] | null) => {
		if (point) {
			setSelection({ id: 'selected_feature', point });
			setActiveTab('parameters');
		} else {
			setSelection(null);
		}
	}, []);

	const handleDownload = useCallback(() => {
		if (!stlUrl) return;
		const a = document.createElement('a');
		a.href     = stlUrl;
		a.download = 'cad-copilot-output.stl';
		a.click();
		toast.success('STL Exported');
	}, [stlUrl]);

	const handleLoadSession = useCallback((script: string, params: any) => {
		setCadScript(script);
		setParameters(params);
		setActiveTab('parameters');
		toast.success('Session loaded from history');
	}, []);

	const handleDownloadDxf = useCallback(async () => {
		if (!cadScript) return;
		toast.info('Generating DXF…', { description: 'Running 2D projection kernel…' });
		try {
			const url = await exportFile('dxf');
			if (url) {
				const a = document.createElement('a');
				a.href = url;
				a.download = 'cad-copilot-blueprint.dxf';
				a.click();
				URL.revokeObjectURL(url);
				toast.success('DXF Exported');
			}
		} catch (err) {
			toast.error('DXF Export failed', { description: String(err) });
		}
	}, [cadScript, exportFile]);

	const memoizedParams = useMemo(() => {
		return Object.entries(parameters);
	}, [parameters]);

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
				modelOptions={modelValueOptions}
				selectedFile={selectedFile}
				onFileChange={setSelectedFile}
				isGenerating={isGenerating}
				onSubmit={handleGenerate}
				width={chatWidth}
				hasScript={!!cadScript}
			>
				{/* Selection badge */}
				{selection && (
					<div className="group flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/[0.03] px-3.5 py-2.5 animate-in fade-in zoom-in-95 duration-300">
						<div className="flex items-center gap-2.5">
							<div className="flex size-6 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 group-hover:scale-110 transition-transform">
								<Target size={12} className="text-amber-400" />
							</div>
							<div>
								<p className="font-mono text-[10px] font-black uppercase tracking-widest text-amber-400">
									Target Focused
								</p>
								<p className="font-mono text-[8px] text-amber-700 uppercase">Interactive Context Active</p>
							</div>
						</div>
						<button
							onClick={() => setSelection(null)}
							className="text-zinc-600 hover:text-amber-500 transition-colors"
						>
							<AlertCircle size={14} />
						</button>
					</div>
				)}
			</ChatPanel>

			{/* ── Resize Handle ───────────────────────────────────────────── */}
			<div
				className="w-1 cursor-col-resize bg-zinc-900 transition-colors hover:bg-amber-500/20"
				onMouseDown={(e) => {
					const startX = e.clientX;
					const startWidth = chatWidth;
					const move = (moveEvent: MouseEvent) => {
						const nextWidth = startWidth + (moveEvent.clientX - startX);
						if (nextWidth > 300 && nextWidth < 800) setChatWidth(nextWidth);
					};
					const up = () => {
						document.removeEventListener('mousemove', move);
						document.removeEventListener('mouseup', up);
					};
					document.addEventListener('mousemove', move);
					document.addEventListener('mouseup', up);
				}}
			/>

			{/* ── Main Viewport Area ───────────────────────────────────────── */}
			<main className="relative flex flex-1 flex-col overflow-hidden">
				<Viewport
					stlUrl={stlUrl}
					statusText={statusText}
					isCompiling={isRecompiling || isGenerating}
					onMeshClick={handleMeshClick}
					onDownloadStl={handleDownload}
					onDownloadDxf={handleDownloadDxf}
				/>

				{/* WASM Error Banner */}
				{engineError && (
					<div className="absolute bottom-6 left-6 right-6 z-30">
						<div className="glass flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-4 duration-500">
							<div className="flex items-center gap-4">
								<div className="flex size-10 items-center justify-center rounded-xl bg-red-500/20 border border-red-500/40">
									<AlertCircle size={20} className="text-red-500" />
								</div>
								<div>
									<h4 className="text-xs font-bold uppercase tracking-widest text-red-500">Geometry Engine Error</h4>
									<p className="mt-1 text-xs text-red-200/60 font-medium">{engineError.message}</p>
								</div>
							</div>
							<button
								onClick={respawn}
								className="rounded-lg bg-red-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-red-400 active:scale-95"
							>
								Respawn Kernel
							</button>
						</div>
					</div>
				)}
			</main>

			{/* ── Right: Editor Drawer ─────────────────────────────────────── */}
			<EditorDrawer
				isOpen={isDrawerOpen}
				setIsOpen={setIsDrawerOpen}
				activeTab={activeTab}
				setActiveTab={setActiveTab}
				cadScript={cadScript}
				onScriptChange={setCadScript}
				onRebuild={rebuild}
				isCompiling={isRecompiling}
				hasScript={!!cadScript}
				selection={selection}
				onClearSelection={() => setSelection(null)}
				onLoadSession={handleLoadSession}
				onDownloadDxf={handleDownloadDxf}
			>
				{memoizedParams.length > 0 ? (
					<div className="space-y-6">
						{memoizedParams.map(([key, val]) => (
							<ParameterInput
								key={key}
								label={key}
								value={val}
								onChange={(newVal) => handleParamChange(key, newVal)}
							/>
						))}
					</div>
				) : null}
			</EditorDrawer>

		</div>
	);
}