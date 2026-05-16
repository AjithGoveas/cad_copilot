import { useCallback, useEffect, useRef, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EngineErrorType = 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown';

export type EngineError = {
	errorType: EngineErrorType;
	message:   string;
	details:   string;
};

type CADEngineConfig = {
	script:     string;
	enabled?:   boolean;
	/** Debounce delay in ms before dispatching a compile to the worker (default: 600ms). */
	debounceMs?: number;
};

type EngineStatus =
	| 'idle'
	| 'compiling'
	| 'ready'
	| 'error';

// ── Status labels ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<EngineStatus, string> = {
	idle:               'Awaiting Input…',
	compiling:          'Compiling Geometry…',
	ready:              'Engine Ready',
	error:              'Kernel Exception',
};

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCADEngine({
	script,
	enabled      = true,
	debounceMs   = 600,
}: CADEngineConfig) {

	const [stlUrls,     setStlUrls]     = useState<Map<string, string>>(new Map());
	const [status,      setStatus]      = useState<EngineStatus>('idle');
	const [engineError, setEngineError] = useState<EngineError | null>(null);
	const [isExporting, setIsExporting] = useState(false);

	// Refs for persistence and coordination
	const workerRef = useRef<Worker | null>(null);
	const lastRequestIdRef = useRef<number>(0);
	const pendingRequestsRef = useRef<Map<number, (data: any) => void>>(new Map());

	// ── Worker Management ───────────────────────────────────────────────────

	const terminateWorker = useCallback(() => {
		if (workerRef.current) {
			workerRef.current.terminate();
			workerRef.current = null;
		}
		pendingRequestsRef.current.clear();
	}, []);

	const getWorker = useCallback(() => {
		if (workerRef.current) return workerRef.current;

		console.log('[useCADEngine] Spawning persistent worker...');
		const worker = new Worker(
			new URL('../workers/cad-worker.ts', import.meta.url),
			{ type: 'module' }
		);

		worker.onmessage = (e: MessageEvent) => {
			const data = e.data;
			
			// Handle structured messages
			if (data.type === 'ready') {
				// Worker is ready to receive commands
				return;
			}

			if (data.type === 'error') {
				setEngineError({
					errorType: data.errorType ?? 'Unknown',
					message:   data.message   ?? 'Unknown engine error.',
					details:   data.details   ?? '',
				});
				setStatus('error');
			}

			// If this message has an ID, check if we have a pending promise for it
			if (data.id && pendingRequestsRef.current.has(data.id)) {
				const resolve = pendingRequestsRef.current.get(data.id);
				if (resolve) {
					resolve(data);
					pendingRequestsRef.current.delete(data.id);
				}
			}

			// Specific handlers for background updates (compilation)
			if (data.type === 'compiled' && data.id === lastRequestIdRef.current) {
				setStlUrls(prev => {
					// Revoke old URLs
					prev.forEach(url => URL.revokeObjectURL(url));
					
					const next = new Map<string, string>();
					data.parts.forEach((p: { id: string; buffer: ArrayBuffer }) => {
						next.set(p.id, URL.createObjectURL(new Blob([p.buffer], { type: 'model/stl' })));
					});
					return next;
				});
				setStatus('ready');
			}
		};

		worker.onerror = (e) => {
			console.error('[useCADEngine] Worker error:', e);
			setEngineError({
				errorType: 'Unknown',
				message:   'WASM Worker crashed.',
				details:   e.message ?? '',
			});
			setStatus('error');
			terminateWorker(); // Force respawn on next request
		};

		worker.postMessage({ type: 'warmup' });
		workerRef.current = worker;
		return worker;
	}, [terminateWorker]);

	// ── Actions ────────────────────────────────────────────────────────────

	const executeCompile = useCallback(async (code: string) => {
		const worker = getWorker();
		const requestId = Date.now();
		lastRequestIdRef.current = requestId;

		setStatus('compiling');
		setEngineError(null);

		worker.postMessage({ type: 'compile', script: code, id: requestId });
	}, [getWorker]);

	const exportModel = useCallback(async (
		format: 'stl' | 'dxf', 
		dxfMode?: 'silhouette' | 'section' | 'blueprint'
	): Promise<ArrayBuffer> => {
		if (!script) throw new Error('No script to export');

		const worker = getWorker();
		const requestId = Date.now();
		
		setIsExporting(true);
		
		return new Promise<ArrayBuffer>((resolve, reject) => {
			pendingRequestsRef.current.set(requestId, (data) => {
				if (data.type === 'exported') {
					resolve(data.data);
				} else if (data.type === 'error') {
					reject(new Error(data.message));
				}
			});

			worker.postMessage({ type: 'export', script, format, dxfMode, id: requestId });
		}).finally(() => {
			setIsExporting(false);
		});
	}, [script, getWorker]);

	const rebuild = useCallback(() => {
		if (!script) return;
		executeCompile(script);
	}, [script, executeCompile]);

	// ── Lifecycle ──────────────────────────────────────────────────────────

	useEffect(() => {
		if (!enabled || !script) return;
		const timer = setTimeout(() => {
			executeCompile(script);
		}, debounceMs);

		return () => clearTimeout(timer);
	}, [script, enabled, executeCompile, debounceMs]);

	useEffect(() => {
		return () => terminateWorker();
	}, [terminateWorker]);

	const respawn = useCallback(() => {
		terminateWorker();
		if (script) executeCompile(script);
	}, [script, executeCompile, terminateWorker]);

	return {
		stlUrls,
		status,
		statusText:    STATUS_LABELS[status] || 'Initialising…',
		engineError,
		error:         engineError?.message ?? null,
		isRecompiling: status === 'compiling',
		isExporting,
		rebuild,
		respawn,
		exportModel,
	};
}
