'use client';

import Editor from '@monaco-editor/react';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useLoader } from '@react-three/fiber';
import JSON5 from 'json5';
import { ChevronLeft, ChevronRight, Loader2, SendHorizontal, Upload, Wrench } from 'lucide-react';
import { type FormEvent, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { Box3, BufferGeometry, Color, MeshStandardMaterial, Vector3 } from 'three';
import { STLLoader } from 'three-stdlib';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
	id: string;
	role: ChatRole;
	content: string;
};

type RenderPayload = {
	stl_url?: string;
	step_url?: string;
	status?: string;
	job_id?: string;
	artifacts?: {
		stl_url?: string;
		step_url?: string;
	};
};

type DrawerTab = 'parameters' | 'code';

const DEFAULT_PROMPT = 'generate a 3D model of the attached file.';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const MODEL_OPTIONS = [
	{ value: 'gemini-3.1-flash-lite-preview', label: 'gemini-3.1-flash-lite (Default / Recommended)' },
	{ value: 'gemini-3-flash-preview', label: 'gemini-3-flash' },
	{ value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
];
const SUPPORTED_UPLOAD_MIME_TYPES = new Set(['application/pdf']);

function isSupportedUpload(file: File): boolean {
	const fileType = file.type.toLowerCase();
	if (fileType.startsWith('image/')) {
		return true;
	}

	if (SUPPORTED_UPLOAD_MIME_TYPES.has(fileType)) {
		return true;
	}

	return file.name.toLowerCase().endsWith('.pdf');
}

function makeId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stripApiSuffix(url: string): string {
	return url.replace(/\/api\/v1\/?$/, '');
}

function resolveModelUrl(rawUrl: string, cacheBust?: string): string {
	let resolvedUrl = rawUrl;

	if (!(rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))) {
		const apiBase = process.env.NEXT_PUBLIC_FASTAPI_URL?.trim();
		if (apiBase && rawUrl.startsWith('/')) {
			resolvedUrl = `${stripApiSuffix(apiBase)}${rawUrl}`;
		}
	}

	if (!cacheBust) {
		return resolvedUrl;
	}

	const separator = resolvedUrl.includes('?') ? '&' : '?';
	return `${resolvedUrl}${separator}v=${encodeURIComponent(cacheBust)}`;
}

function findMatchingBrace(source: string, startIndex: number): number {
	let depth = 0;
	let inSingle = false;
	let inDouble = false;
	let escaping = false;

	for (let i = startIndex; i < source.length; i += 1) {
		const ch = source[i];

		if (escaping) {
			escaping = false;
			continue;
		}

		if (ch === '\\') {
			escaping = true;
			continue;
		}

		if (!inDouble && ch === "'") {
			inSingle = !inSingle;
			continue;
		}

		if (!inSingle && ch === '"') {
			inDouble = !inDouble;
			continue;
		}

		if (inSingle || inDouble) {
			continue;
		}

		if (ch === '{') {
			depth += 1;
			continue;
		}

		if (ch === '}') {
			depth -= 1;
			if (depth === 0) {
				return i;
			}
		}
	}

	return -1;
}

function extractParameters(script: string): Record<string, unknown> {
	const assignmentMatch = /\bPARAMETERS\s*(?::[^=\n]+)?=/.exec(script);
	if (!assignmentMatch) {
		return {};
	}

	const startSearch = assignmentMatch.index + assignmentMatch[0].length;
	const braceStart = script.indexOf('{', startSearch);
	if (braceStart < 0) {
		return {};
	}

	const braceEnd = findMatchingBrace(script, braceStart);
	if (braceEnd < 0) {
		return {};
	}

	const literal = script.slice(braceStart, braceEnd + 1);
	const normalized = literal
		.replace(/\bTrue\b/g, 'true')
		.replace(/\bFalse\b/g, 'false')
		.replace(/\bNone\b/g, 'null');

	try {
		const parsed = JSON5.parse(normalized);
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		return {};
	}

	return {};
}

function setParameterValue(params: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
	return {
		...params,
		[key]: value,
	};
}

function StlMesh({ url }: { url: string }) {
	const geometry = useLoader(STLLoader, url);

	const { centeredGeometry, scale } = useMemo(() => {
		const cloned = geometry.clone() as BufferGeometry;
		cloned.computeVertexNormals();
		cloned.computeBoundingBox();

		const box = cloned.boundingBox ?? new Box3();
		const size = new Vector3();
		box.getSize(size);
		const maxDim = Math.max(size.x || 0, size.y || 0, size.z || 0);
		const safeScale = maxDim > 0 ? 1.8 / maxDim : 1;

		cloned.center();
		return {
			centeredGeometry: cloned,
			scale: safeScale,
		};
	}, [geometry]);

	const material = useMemo(
		() =>
			new MeshStandardMaterial({
				color: new Color('#d4d4d8'),
				metalness: 0.12,
				roughness: 0.45,
			}),
		[]
	);

	return <mesh geometry={centeredGeometry} material={material} scale={scale} castShadow receiveShadow />;
}

function ParameterInput({ value, onChange }: { value: unknown; onChange: (newValue: unknown) => void }) {
	if (typeof value === 'number') {
		return (
			<input
				type="number"
				value={Number.isFinite(value) ? value : 0}
				onChange={(event) => onChange(Number(event.target.value))}
				className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
			/>
		);
	}

	if (typeof value === 'boolean') {
		return (
			<label className="flex items-center gap-2 text-sm text-zinc-100">
				<input
					type="checkbox"
					checked={value}
					onChange={(event) => onChange(event.target.checked)}
					className="size-4 rounded border-zinc-700 bg-black"
				/>
				Enabled
			</label>
		);
	}

	if (typeof value === 'string') {
		return (
			<input
				type="text"
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none"
			/>
		);
	}

	const serialized = JSON.stringify(value, null, 2);
	return (
		<textarea
			value={serialized}
			onChange={(event) => {
				try {
					onChange(JSON.parse(event.target.value));
				} catch {
					// Ignore incomplete JSON edits until valid JSON exists.
				}
			}}
			rows={4}
			className="w-full rounded-md border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
		/>
	);
}

export default function HitlWorkspace() {
	const [messages, setMessages] = useState<ChatMessage[]>([
		{
			id: 'system_welcome',
			role: 'system',
			content: 'Upload a reference image or PDF, choose a model, and generate a parameterized build123d script.',
		},
	]);
	const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
	const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL);
	const [selectedFile, setSelectedFile] = useState<File | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [isRecompiling, setIsRecompiling] = useState(false);
	const [isDrawerOpen, setIsDrawerOpen] = useState(true);
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [pythonScript, setPythonScript] = useState('');
	const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>('parameters');
	const [parameters, setParameters] = useState<Record<string, unknown>>({});
	const [stlUrl, setStlUrl] = useState<string | null>(null);
	const [stepUrl, setStepUrl] = useState<string | null>(null);
	const [isDownloadingStl, setIsDownloadingStl] = useState(false);
	const [isDownloadingStep, setIsDownloadingStep] = useState(false);
	const [statusText, setStatusText] = useState<string>('Ready');

	const messagesEndRef = useRef<HTMLDivElement | null>(null);
	const pythonScriptRef = useRef('');

	const updatePythonScript = (nextScript: string) => {
		pythonScriptRef.current = nextScript;
		setPythonScript(nextScript);
	};

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages]);

	async function handleGenerate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!prompt.trim()) {
			setStatusText('Type a prompt before generating.');
			return;
		}
		if (!selectedFile) {
			setStatusText('Attach an image or PDF before generating.');
			return;
		}
		if (!isSupportedUpload(selectedFile)) {
			setStatusText('Unsupported file type. Please upload an image or PDF.');
			return;
		}

		const userMessage: ChatMessage = {
			id: makeId('user'),
			role: 'user',
			content: `**Prompt**\n${prompt.trim()}\n\n**Model**\n${selectedModel}\n\nAttached file: ${selectedFile.name}`,
		};
		const assistantMessageId = makeId('assistant');

		setMessages((prev) => [
			...prev,
			userMessage,
			{
				id: assistantMessageId,
				role: 'assistant',
				content: '',
			},
		]);
		setIsGenerating(true);
		setStatusText('Generating build123d script...');

		const formData = new FormData();
		formData.append('prompt', prompt.trim());
		formData.append('image', selectedFile);
		formData.append('model_name', selectedModel);

		try {
			const response = await fetch('/api/generate', {
				method: 'POST',
				body: formData,
			});

			const nextSessionId = response.headers.get('x-session-id');
			if (nextSessionId) {
				setSessionId(nextSessionId);
			}

			if (!response.ok || !response.body) {
				const failureText = await response.text();
				throw new Error(failureText || `Generate failed with ${response.status}`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let assembledScript = '';
			let receivedDoneEvent = false;

			const processRawEvent = (rawEvent: string) => {
				const lines = rawEvent.split('\n');
				let eventType = 'message';
				const dataLines: string[] = [];

				for (const line of lines) {
					if (line.startsWith('event:')) {
						eventType = line.slice(6).trim();
					}
					if (line.startsWith('data:')) {
						dataLines.push(line.slice(5).trim());
					}
				}

				if (!dataLines.length) {
					return;
				}

				const payloadText = dataLines.join('\n');
				let payload: Record<string, unknown> = {};
				try {
					payload = JSON.parse(payloadText) as Record<string, unknown>;
				} catch {
					return;
				}

				if (eventType === 'status') {
					const message = typeof payload.message === 'string' ? payload.message : 'Working...';
					setStatusText(message);
					return;
				}

				if (eventType === 'token') {
					const chunk = typeof payload.chunk === 'string' ? payload.chunk : '';
					assembledScript += chunk;
					setMessages((prev) =>
						prev.map((item) =>
							item.id === assistantMessageId
								? {
										...item,
										content: assembledScript,
									}
								: item
						)
					);
					return;
				}

				if (eventType === 'done') {
					receivedDoneEvent = true;
					const scriptFromDone = typeof payload.script === 'string' ? payload.script : assembledScript;
					updatePythonScript(scriptFromDone);
					const payloadParameters = payload.parameters;
					const extracted =
						payloadParameters && typeof payloadParameters === 'object' && !Array.isArray(payloadParameters)
							? (payloadParameters as Record<string, unknown>)
							: extractParameters(scriptFromDone);
					setParameters(extracted);
					setStatusText('Script generated. Edit parameters and sync geometry.');

					setMessages((prev) =>
						prev.map((item) =>
							item.id === assistantMessageId
								? {
										...item,
										content: scriptFromDone || 'Generation completed.',
									}
								: item
						)
					);
					return;
				}

				if (eventType === 'error') {
					const message = typeof payload.message === 'string' ? payload.message : 'Generation error.';
					throw new Error(message);
				}
			};

			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const normalizedBuffer = buffer.replace(/\r\n/g, '\n');
				const events = normalizedBuffer.split('\n\n');
				buffer = events.pop() ?? '';

				for (const rawEvent of events) {
					if (!rawEvent.trim()) {
						continue;
					}
					processRawEvent(rawEvent);
				}
			}

			if (buffer.trim()) {
				processRawEvent(buffer.trim());
			}

			if (!receivedDoneEvent && assembledScript.trim()) {
				const fallbackScript = assembledScript.trim();
				updatePythonScript(fallbackScript);
				setParameters(extractParameters(fallbackScript));
				setStatusText('Script generated. Edit parameters and sync geometry.');
				setMessages((prev) =>
					prev.map((item) =>
						item.id === assistantMessageId
							? {
									...item,
									content: fallbackScript,
								}
							: item
					)
				);
			}
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText('Generation failed.');
			setMessages((prev) => [
				...prev,
				{
					id: makeId('system_error'),
					role: 'system',
					content: `Generation failed: ${errorText}`,
				},
			]);
		} finally {
			setIsGenerating(false);
		}
	}

	async function handleRenderSync() {
		const latestPythonScript = pythonScriptRef.current;

		if (!latestPythonScript || !sessionId) {
			setStatusText('Generate code first before syncing.');
			return;
		}

		setIsRecompiling(true);
		setStatusText('Recompiling Geometry...');
		setStlUrl(null);
		setStepUrl(null);

		try {
			const response = await fetch('/api/render', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
				},
				body: JSON.stringify({
					python_script: latestPythonScript,
					parameters,
					session_id: sessionId,
				}),
			});

			const payload = (await response.json()) as RenderPayload;
			if (!response.ok) {
				throw new Error(JSON.stringify(payload));
			}

			const stlPath = payload.stl_url ?? payload.artifacts?.stl_url;
			const stepPath = payload.step_url ?? payload.artifacts?.step_url;
			const artifactVersion = `${Date.now()}`;

			if (!stlPath && !stepPath) {
				throw new Error('Render completed but STL/STEP artifacts were missing in the response.');
			}

			if (stlPath) {
				setStlUrl(resolveModelUrl(stlPath, artifactVersion));
			}
			if (stepPath) {
				setStepUrl(resolveModelUrl(stepPath, artifactVersion));
			}

			if (stlPath && stepPath) {
				setStatusText('Geometry synced.');
				toast.success('STL and STEP are ready', {
					description: 'Viewer updated. Download buttons are now available.',
				});
			} else {
				setStatusText('Geometry synced. One artifact is still missing.');
				toast.warning('Partial artifacts generated', {
					description: 'Only one of STL/STEP is available right now.',
				});
			}
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			setStatusText(`Render failed: ${errorText}`);
			toast.error('Render failed', {
				description: errorText,
			});
		} finally {
			setIsRecompiling(false);
		}
	}

	async function handleDownloadArtifact(url: string | null, extension: 'stl' | 'step') {
		if (!url) {
			toast.error(`No ${extension.toUpperCase()} file available yet`);
			return;
		}

		const setBusy = extension === 'stl' ? setIsDownloadingStl : setIsDownloadingStep;
		const label = extension.toUpperCase();
		const filename = `${sessionId ?? 'cad_model'}.${extension}`;

		setBusy(true);
		try {
			const response = await fetch(url, { cache: 'no-store' });
			if (!response.ok) {
				throw new Error(`Download failed with status ${response.status}`);
			}

			const blob = await response.blob();
			const objectUrl = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = objectUrl;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			link.remove();
			URL.revokeObjectURL(objectUrl);

			toast.success(`${label} downloaded`, {
				description: filename,
			});
		} catch (error) {
			const errorText = error instanceof Error ? error.message : String(error);
			toast.error(`Failed to download ${label}`, {
				description: errorText,
			});
		} finally {
			setBusy(false);
		}
	}

	const parameterEntries = Object.entries(parameters);
	const hasStl = Boolean(stlUrl);
	const hasStep = Boolean(stepUrl);
	const hasAnyArtifacts = hasStl || hasStep;

	return (
		<div className="dark min-h-screen bg-black text-zinc-100">
			<main className="flex h-screen w-full gap-3 bg-[#09090b] p-3">
				<section className="flex w-85 shrink-0 flex-col border border-zinc-800 bg-zinc-950">
					<header className="border-b border-zinc-800 px-4 py-3">
						<p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">Chat</p>
						<h1 className="mt-1 text-lg font-semibold text-zinc-100">Docs to CAD Workspace</h1>
					</header>

					<div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
						{messages.map((message) => {
							const bubbleClass =
								message.role === 'user'
									? 'ml-6 bg-zinc-100 text-black'
									: message.role === 'assistant'
										? 'mr-6 bg-zinc-900 text-zinc-100'
										: 'mx-3 bg-zinc-900 text-zinc-100';

							return (
								<div
									key={message.id}
									className={`rounded-md border border-zinc-800 px-3 py-2 text-sm ${bubbleClass}`}
								>
									<ReactMarkdown>{message.content || '...'}</ReactMarkdown>
								</div>
							);
						})}
						<div ref={messagesEndRef} />
					</div>

					<form onSubmit={handleGenerate} className="space-y-2 border-t border-zinc-800 p-3">
						<div className="space-y-2 border border-zinc-800 bg-black p-2">
							<textarea
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
								rows={3}
								placeholder="Describe the CAD part, dimensions, and constraints..."
								className="w-full resize-none bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
							/>
							<select
								value={selectedModel}
								onChange={(event) => setSelectedModel(event.target.value)}
								className="w-full border border-zinc-800 bg-zinc-950 px-2 py-2 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none"
							>
								{MODEL_OPTIONS.map((modelOption) => (
									<option key={modelOption.value} value={modelOption.value}>
										{modelOption.label}
									</option>
								))}
							</select>
						</div>

						<label className="flex cursor-pointer items-center gap-2 border border-dashed border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 hover:border-amber-500">
							<Upload className="size-4" />
							<span className="truncate">{selectedFile ? selectedFile.name : 'Attach image or PDF'}</span>
							<input
								type="file"
								accept="image/*,.pdf,application/pdf"
								className="hidden"
								onChange={(event) => {
									const file = event.target.files?.[0] ?? null;
									if (!file) {
										setSelectedFile(null);
										return;
									}

									if (!isSupportedUpload(file)) {
										setStatusText('Unsupported file type. Please upload an image or PDF.');
										event.currentTarget.value = '';
										return;
									}

									setSelectedFile(file);
									setStatusText('File attached. Ready to generate.');
								}}
							/>
						</label>

						<button
							type="submit"
							disabled={isGenerating}
							className="flex w-full items-center justify-center gap-2 border border-amber-400 bg-amber-500 px-3 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{isGenerating ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								<SendHorizontal className="size-4" />
							)}
							{isGenerating ? 'Streaming...' : 'Generate CAD Script'}
						</button>
					</form>
				</section>

				<section className="relative flex min-w-0 flex-1 flex-col overflow-hidden border border-zinc-800 bg-zinc-950">
					<div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
						<div>
							<p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Viewport</p>
							<p className="text-sm text-zinc-100">{statusText}</p>
						</div>
						{hasAnyArtifacts ? (
							<div className="flex items-center gap-2">
								<button
									type="button"
									onClick={() => void handleDownloadArtifact(stlUrl, 'stl')}
									disabled={!hasStl || isDownloadingStl}
									className="flex items-center gap-1 border border-zinc-700 bg-black px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-100 hover:border-amber-500 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{isDownloadingStl ? <Loader2 className="size-3.5 animate-spin" /> : null}
									Download STL
								</button>
								<button
									type="button"
									onClick={() => void handleDownloadArtifact(stepUrl, 'step')}
									disabled={!hasStep || isDownloadingStep}
									className="flex items-center gap-1 border border-amber-500 bg-amber-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-black hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
								>
									{isDownloadingStep ? <Loader2 className="size-3.5 animate-spin" /> : null}
									Download STEP
								</button>
							</div>
						) : null}
					</div>

					<div className="relative flex-1">
						<Canvas camera={{ position: [2.8, 2.2, 2.5], fov: 46 }} shadows>
							<color attach="background" args={['#09090b']} />
							<fog attach="fog" args={['#09090b', 7, 18]} />
							<ambientLight intensity={0.35} />
							<hemisphereLight intensity={0.45} groundColor="#1f2937" />
							<directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />

							<gridHelper args={[8, 16, '#3f3f46', '#27272a']} position={[0, -1.2, 0]} />

							<Suspense fallback={null}>{stlUrl ? <StlMesh url={stlUrl} /> : null}</Suspense>
							<OrbitControls makeDefault enableDamping dampingFactor={0.08} />
						</Canvas>

						{!stlUrl && !isRecompiling ? (
							<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
								<div className="rounded-md border border-zinc-800 bg-black px-4 py-3 text-sm text-zinc-500">
									Generate a script, then sync parameters to render STL.
								</div>
							</div>
						) : null}

						{isRecompiling ? (
							<div className="absolute inset-0 flex items-center justify-center bg-black/70">
								<div className="flex items-center gap-2 border border-zinc-800 bg-zinc-950 px-4 py-3 text-sm text-zinc-100">
									<Loader2 className="size-4 animate-spin text-amber-400" />
									Recompiling Geometry...
								</div>
							</div>
						) : null}
					</div>
				</section>

				<aside
					className={`relative shrink-0 overflow-hidden border border-zinc-800 bg-zinc-950 transition-all duration-300 ${
						isDrawerOpen ? 'w-82.5' : 'w-12'
					}`}
				>
					<button
						type="button"
						className="absolute left-2 top-3 border border-zinc-700 bg-black p-1 text-zinc-100 hover:border-amber-500"
						onClick={() => setIsDrawerOpen((prev) => !prev)}
						aria-label={isDrawerOpen ? 'Collapse parameters' : 'Expand parameters'}
					>
						{isDrawerOpen ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
					</button>

					{isDrawerOpen ? (
						<div className="flex h-full flex-col">
							<header className="border-b border-zinc-800 bg-zinc-900/80 px-4 py-3 pl-12">
								<p className="text-xs uppercase tracking-[0.2em] text-zinc-500">Engine Drawer</p>
								<h2 className="text-sm font-semibold text-zinc-100">Live Parameter Drawer</h2>
								<div className="mt-3 flex border border-zinc-700 bg-black">
									<button
										type="button"
										onClick={() => setActiveDrawerTab('parameters')}
										className={`flex-1 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
											activeDrawerTab === 'parameters'
												? 'border-amber-500 bg-zinc-900 text-amber-300'
												: 'border-transparent bg-black text-zinc-400 hover:text-zinc-100'
										}`}
									>
										Parameters
									</button>
									<button
										type="button"
										onClick={() => setActiveDrawerTab('code')}
										className={`flex-1 border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${
											activeDrawerTab === 'code'
												? 'border-amber-500 bg-zinc-900 text-amber-300'
												: 'border-transparent bg-black text-zinc-400 hover:text-zinc-100'
										}`}
									>
										Code Engine
									</button>
								</div>
							</header>

							{activeDrawerTab === 'parameters' ? (
								<div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
									{parameterEntries.length ? (
										parameterEntries.map(([key, value]) => (
											<div key={key} className="border border-zinc-800 bg-black p-2">
												<label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
													{key}
												</label>
												<ParameterInput
													value={value}
													onChange={(nextValue) =>
														setParameters((prev) => setParameterValue(prev, key, nextValue))
													}
												/>
											</div>
										))
									) : (
										<div className="border border-dashed border-zinc-700 p-3 text-sm text-zinc-500">
											No PARAMETERS parsed yet. Generate code first.
										</div>
									)}
								</div>
							) : (
								<div className="flex-1 overflow-hidden p-3">
									<div className="h-full border border-zinc-800">
										<Editor
											height="100%"
											language="python"
											theme="vs-dark"
											value={pythonScript}
											onChange={(value) => updatePythonScript(value ?? '')}
											options={{
												minimap: { enabled: false },
												fontSize: 13,
												wordWrap: 'on',
												scrollBeyondLastLine: false,
												automaticLayout: true,
											}}
										/>
									</div>
								</div>
							)}

							<div className="border-t border-zinc-800 p-3">
								<button
									onClick={handleRenderSync}
									disabled={isRecompiling || !sessionId || !pythonScript}
									className="flex w-full items-center justify-center gap-2 border border-emerald-400 bg-emerald-500 px-3 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{isRecompiling ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Wrench className="size-4" />
									)}
									Sync to Engine
								</button>
							</div>
						</div>
					) : null}
				</aside>
			</main>
		</div>
	);
}
