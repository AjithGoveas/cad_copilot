'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ChatPanel } from './ChatPanel';
import { EditorDrawer } from './EditorDrawer';
import { CADViewer, type CADViewerRef } from './CADViewer';
import { ParameterDrawer } from './ParameterDrawer';
import { DemoLimitModal } from './DemoLimitModal';
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
	{ id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite Preview',   icon: 'sparkles' }
];

export default function HitlWorkspace({ isDemoMode = false }: { isDemoMode?: boolean }) {
	// ── State ────────────────────────────────────────────────────────────────
	const [prompt,        setPrompt]        = useState('');
	const [messages,      setMessages]      = useState<Message[]>([]);
	const [selectedModel, setSelectedModel] = useState(MODEL_OPTIONS[0].id);
	const [selectedFile,  setSelectedFile]  = useState<File | null>(null);

	const [cadScript,   setCadScript]   = useState<string>('');
	const [parameters,  setParameters]  = useState<Record<string, any>>({});
	const [isGenerating, setIsGenerating] = useState(false);

	const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);

	const modelValueOptions = useMemo(() => 
		MODEL_OPTIONS.map(m => ({ value: m.id, label: m.name })), 
	[]);

	// ── Demo Limits State ─────────────────────────────────────────────────────
	const [promptCount, setPromptCount] = useState(0);
	const [demoLimitReason, setDemoLimitReason] = useState<'time' | 'prompt' | 'export' | null>(null);
	const [timeLeft, setTimeLeft] = useState<number | null>(null);

	// Demo Timer Effect
	useEffect(() => {
		if (!isDemoMode) return;
		
		const storedStartTime = sessionStorage.getItem('demoStartTime');
		let startTime = storedStartTime ? parseInt(storedStartTime, 10) : Date.now();
		
		if (!storedStartTime) {
			sessionStorage.setItem('demoStartTime', startTime.toString());
		}

		const totalTime = 5 * 60 * 1000; // 5 minutes
		
		const interval = setInterval(() => {
			if (demoLimitReason) return; // Stop timer if modal is up

			const elapsed = Date.now() - startTime;
			const remaining = Math.max(0, totalTime - elapsed);
			
			setTimeLeft(remaining);
			
			if (remaining <= 0) {
				setDemoLimitReason('time');
				clearInterval(interval);
			}
		}, 1000);

		return () => clearInterval(interval);
	}, [isDemoMode, demoLimitReason]);

	const [isDrawerOpen, setIsDrawerOpen] = useState(true);
	const [activeTab,    setActiveTab]    = useState<'parameters' | 'code' | 'history'>('parameters');
	const [chatWidth,    setChatWidth]    = useState(450);
	const [selection,   setSelection]   = useState<Selection | null>(null);

	// CAD Viewer references and compilation status
	const viewerRef = useRef<CADViewerRef>(null);
	const [engineStatus, setEngineStatus] = useState({ isCompiling: false, isExporting: false });

	// ── Generation ────────────────────────────────────────────────────────────
	const handleGenerate = async (e?: React.FormEvent) => {
		if (e) e.preventDefault();
		if (!prompt.trim()) return;

		// Demo Limit Check
		if (isDemoMode && promptCount >= 1) {
			setDemoLimitReason('prompt');
			return;
		}

		const userMsg: Message = { id: Date.now().toString(), role: 'user', content: prompt };
		setMessages((prev) => [...prev, userMsg]);
		setPrompt('');
		setIsGenerating(true);

		try {
			const formData = new FormData();
			formData.append('prompt', prompt);
			formData.append('model',  selectedModel);
			if (selectedFile) formData.append('image', selectedFile);
			if (isDemoMode) formData.append('demoMode', 'true');

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
			
			if (isDemoMode) {
				setPromptCount(prev => prev + 1);
			}
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
	const handleMeshClick = useCallback((id: string | null, point: [number, number, number] | null) => {
		if (point && id) {
			setSelection({ id, point });
			setActiveTab('parameters');
		} else {
			setSelection(null);
		}
	}, []);

	const handleExport = useCallback(async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
		if (isDemoMode) {
			setDemoLimitReason('export');
			return;
		}

		if (!cadScript) return;
		const label = format.toUpperCase();
		const modeLabel = dxfMode ? ` (${dxfMode})` : '';
		toast.info(`Exporting ${label}${modeLabel}…`, { description: `Preparing ${label} geometry kernel…` });
		
		try {
			const buffer = await viewerRef.current?.exportModel(format, dxfMode);
			if (!buffer) throw new Error('No export buffer generated');
			const blob = new Blob([buffer], { type: 'application/octet-stream' });
			const url = URL.createObjectURL(blob);
			
			const filename = dxfMode === 'blueprint' 
				? `technical_blueprint.dxf` 
				: `generated_model.${format}`;

			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
			
			toast.success(`${label} Exported Successfully`);
		} catch (err) {
			toast.error(`${label} Export Failed`, { description: String(err) });
		}
	}, [cadScript]);

	const handleDownloadScad = useCallback(() => {
		if (isDemoMode) {
			setDemoLimitReason('export');
			return;
		}
		if (!cadScript) return;
		const blob = new Blob([cadScript], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'generated_part.scad';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		toast.success('SCAD File Downloaded');
	}, [cadScript]);

	const handleLoadSession = useCallback((script: string, params: any) => {
		setCadScript(script);
		setParameters(params);
		setActiveTab('parameters');
		toast.success('Session loaded from history');
	}, []);



	// ── Render ────────────────────────────────────────────────────────────────

	const formatTime = (ms: number) => {
		const totalSeconds = Math.floor(ms / 1000);
		const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
		const s = (totalSeconds % 60).toString().padStart(2, '0');
		return `${m}:${s}`;
	};

	return (
		<div className="flex h-screen w-full overflow-hidden bg-[#050505] text-zinc-100 selection:bg-amber-500/20">

			{/* Demo Timer Overlay */}
			{isDemoMode && timeLeft !== null && (
				<div className="fixed top-6 right-6 z-40 bg-black/50 backdrop-blur-md border border-amber-500/30 text-amber-500 px-4 py-2 rounded-full font-mono text-xs flex items-center gap-2 shadow-[0_0_15px_rgba(245,158,11,0.1)]">
					<div className="size-2 bg-amber-500 rounded-full animate-pulse" />
					Demo Session: {formatTime(timeLeft)}
				</div>
			)}

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
				<CADViewer
					ref={viewerRef}
					code={cadScript}
					activeFeatureId={activeFeatureId || selection?.id}
					selection={selection}
					onMeshClick={handleMeshClick}
					onSelectParameter={(key) => {
						if (key) {
							setSelection({ id: key, point: [0, 0, 0] });
							setActiveTab('parameters');
						} else {
							setSelection(null);
						}
					}}
					onHoverParameter={setActiveFeatureId}
					isGenerating={isGenerating}
					showExport={true}
					onStatusChange={(status) => setEngineStatus(status)}
				/>
			</main>

			{/* ── Right: Editor Drawer ─────────────────────────────────────── */}
			<EditorDrawer
				isOpen={isDrawerOpen}
				setIsOpen={setIsDrawerOpen}
				activeTab={activeTab}
				setActiveTab={setActiveTab}
				isDemoMode={isDemoMode}
				cadScript={cadScript}
				onScriptChange={setCadScript}
				onRebuild={() => viewerRef.current?.rebuild()}
				isCompiling={engineStatus.isCompiling}
				isExporting={engineStatus.isExporting}
				hasScript={!!cadScript}
				selection={selection}
				onClearSelection={() => setSelection(null)}
				onLoadSession={handleLoadSession}
				onExport={handleExport}
				onDownloadScad={handleDownloadScad}
			>
				<ParameterDrawer
					parameters={parameters}
					selection={selection}
					activeFeatureId={activeFeatureId}
					onClearSelection={() => setSelection(null)}
					onChangeParameter={handleParamChange}
					onHoverParameter={setActiveFeatureId}
				/>
			</EditorDrawer>

			{/* ── Demo Modal ──────────────────────────────────────────────── */}
			{demoLimitReason && <DemoLimitModal reason={demoLimitReason} />}

		</div>
	);
}