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

	const [stlUrl,      setStlUrl]      = useState<string | null>(null);
	const [status,      setStatus]      = useState<EngineStatus>('idle');
	const [engineError, setEngineError] = useState<EngineError | null>(null);

	// Refs
	const currentWorkerRef = useRef<Worker | null>(null);

	// ── Core: One-Shot Compilation ───────────────────────────────────────────
	const executeCompile = useCallback(async (code: string) => {
		// 1. Terminate any previous pending worker to avoid race conditions
		if (currentWorkerRef.current) {
			currentWorkerRef.current.terminate();
		}

		setStatus('compiling');
		setEngineError(null);

		const worker = new Worker(
			new URL('../workers/cad-worker.ts', import.meta.url),
			{ type: 'module' }
		);
		currentWorkerRef.current = worker;

		return new Promise<void>((resolve) => {
			worker.onmessage = (e: MessageEvent) => {
				const data = e.data;

				if (data.type === 'ready') {
					// In the one-shot pattern, we warmup then immediately compile
					worker.postMessage({ type: 'compile', script: code, id: Date.now() });
				}

				if (data.type === 'compiled') {
					setStlUrl(prev => {
						if (prev) URL.revokeObjectURL(prev);
						return URL.createObjectURL(new Blob([data.stl], { type: 'model/stl' }));
					});
					setStatus('ready');
					worker.terminate();
					currentWorkerRef.current = null;
					resolve();
				}

				if (data.type === 'error') {
					setEngineError({
						errorType: data.errorType ?? 'Unknown',
						message:   data.message   ?? 'Unknown engine error.',
						details:   data.details   ?? '',
					});
					setStatus('error');
					worker.terminate();
					currentWorkerRef.current = null;
					resolve();
				}
			};

			worker.onerror = (e) => {
				setEngineError({
					errorType: 'Unknown',
					message:   'WASM Worker crashed.',
					details:   e.message ?? '',
				});
				setStatus('error');
				worker.terminate();
				currentWorkerRef.current = null;
				resolve();
			};

			// Start the cycle
			worker.postMessage({ type: 'warmup' });
		});
	}, []);

	// ── External API ─────────────────────────────────────────────────────────
	const rebuild = useCallback(() => {
		if (!script) return;
		executeCompile(script);
	}, [script, executeCompile]);

	// ── Debounced Auto-Rebuild ────────────────────────────────────────────────
	useEffect(() => {
		if (!enabled || !script) return;
		const timer = setTimeout(() => {
			executeCompile(script);
		}, debounceMs);

		return () => {
			clearTimeout(timer);
		};
	}, [script, enabled, executeCompile, debounceMs]);

	// Unmount cleanup
	useEffect(() => {
		return () => {
			currentWorkerRef.current?.terminate();
		};
	}, []);

	// Respawn is now just a re-trigger of executeCompile
	const respawn = useCallback(() => {
		if (script) executeCompile(script);
	}, [script, executeCompile]);

	return {
		stlUrl,
		status,
		statusText:    STATUS_LABELS[status] || 'Initialising…',
		engineError,
		error:         engineError?.message ?? null,
		isRecompiling: status === 'compiling',
		rebuild,
		respawn,
	};
}
