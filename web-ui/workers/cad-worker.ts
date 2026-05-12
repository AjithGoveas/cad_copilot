/// <reference lib="webworker" />

// ─── Message Protocol ────────────────────────────────────────────────────────

type WarmupRequest      = { type: 'warmup' };
type CompileRequest     = { type: 'compile'; id: number; script: string };
type WorkerRequest      = WarmupRequest | CompileRequest;

type ReadyMessage           = { type: 'ready' };
type CompiledMessage        = { type: 'compiled'; id: number; stl: ArrayBuffer; durationMs: number };

// Structured error with type classification for the self-healing UI
type ErrorMessage = {
	type: 'error';
	id?: number;
	errorType: 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown';
	message: string;
	details: string;  // Full stack trace / WASM stderr
};

type WorkerMessage = ReadyMessage | CompiledMessage | ErrorMessage;

// ─── Engine Interface ────────────────────────────────────────────────────────

interface FS {
	mkdir(path: string): void;
	writeFile(path: string, data: string | Uint8Array): void;
	readFile(path: string, opts?: { encoding?: string }): Uint8Array | string;
	analyzePath(path: string): { exists: boolean };
	unlink(path: string): void;  // delete a file from the virtual FS
}

interface OpenSCAD {
	FS: FS;
	callMain(args: string[]): number;
}

type OpenScadInstance = {
	renderToStl: (code: string) => Promise<string>;
	getInstance: () => OpenSCAD;
};

type OpenScadModule = {
	createOpenSCAD: (options?: Record<string, unknown>) => Promise<OpenScadInstance>;
};

// ─── Engine Lifecycle ────────────────────────────────────────────────────────

const workerScope = self as DedicatedWorkerGlobalScope;
let enginePromise: Promise<OpenScadInstance> | null = null;
const stderrCapture: string[] = [];

async function ensureEngine(): Promise<OpenScadInstance> {
	if (!enginePromise) {
		enginePromise = (async () => {
			console.log('[CAD-Worker] Initializing OpenSCAD WASM instance...');
			const mod = (await import('openscad-wasm')) as unknown as OpenScadModule;

			if (!mod.createOpenSCAD) {
				throw new Error('openscad-wasm: createOpenSCAD function not found.');
			}

			return mod.createOpenSCAD({
				print: (text: string) => console.log('[OpenSCAD]', text),
				printErr: (text: string) => {
					console.warn('[OpenSCAD Error]', text);
					stderrCapture.push(text);
				},

				// Memory limits optimized for one-shot execution of complex CSG
				INITIAL_MEMORY: 512 * 1024 * 1024,   // 512 MB
				MAXIMUM_MEMORY: 1024 * 1024 * 1024,  // 1 GB
				ALLOW_MEMORY_GROWTH: 1,
			});
		})();
	}
	return enginePromise;
}

// -- Compilation Core ---------------------------------------------------------

function classifyError(message: string, details: string): ErrorMessage['errorType'] {
	const combined = `${message} ${details}`.toLowerCase();

	if (
		combined.includes('cgal') ||
		combined.includes('non-manifold') ||
		combined.includes('z-fighting') ||
		combined.includes('assertion') ||
		combined.includes('degenerate')
	) {
		return 'CompileFailure';
	}

	if (
		combined.includes('out of bounds') ||
		combined.includes('memory access') ||
		combined.includes('unreachable') ||
		combined.includes('heap')
	) {
		return 'OutOfBounds';
	}

	if (combined.includes('compile') || combined.includes('syntax') || combined.includes('parse')) {
		return 'CompileFailure';
	}
	if (combined.includes('timeout') || combined.includes('timed out')) {
		return 'Timeout';
	}
	return 'Unknown';
}

function normaliseThrown(err: unknown): Error & { details?: string; classified?: ErrorMessage['errorType'] } {
	if (typeof err === 'number') {
		const msg = `CGAL Geometry Engine Crash (pointer: ${err}). Likely cause: z-fighting or non-manifold geometry. Apply the Epsilon Rule - extend all subtractive volumes by \`eps = 0.02\` and shift down by \`translate([0,0,-eps/2])\`.`;
		const e   = new Error(msg) as Error & { details: string; classified: ErrorMessage['errorType'] };
		e.details    = stderrCapture.join('\n');
		e.classified = 'CompileFailure';
		return e;
	}

	if (err instanceof Error) {
		return Object.assign(err, {
			details:    stderrCapture.join('\n'),
			classified: classifyError(err.message, stderrCapture.join('\n')),
		});
	}

	const msg = String(err);
	const e   = new Error(msg) as Error & { details: string; classified: ErrorMessage['errorType'] };
	e.details    = stderrCapture.join('\n');
	e.classified = classifyError(msg, e.details);
	return e;
}

const INPUT_PATH  = '/input.scad';
const OUTPUT_PATH = '/output.stl';

async function compileToStl(
	script: string
): Promise<{ buffer: ArrayBuffer; durationMs: number }> {
	const engine   = await ensureEngine();
	const instance = engine.getInstance();
	const fs       = instance.FS;

	stderrCapture.length = 0; 
	const started = performance.now();

	fs.writeFile(INPUT_PATH, script);

	let stlText: string | null = null;
	try {
		stlText = await engine.renderToStl(script);

		if (!stlText || stlText.trim().length === 0) {
			const details = stderrCapture.join('\n');
			throw Object.assign(
				new Error('OpenSCAD returned empty STL output.'),
				{ details, classified: classifyError('compile', details) }
			);
		}
	} catch (err: unknown) {
		throw normaliseThrown(err);
	} finally {
		try { if (fs.analyzePath(INPUT_PATH).exists) fs.unlink(INPUT_PATH); } catch (e) {}
		try { if (fs.analyzePath(OUTPUT_PATH).exists) fs.unlink(OUTPUT_PATH); } catch (e) {}
	}

	const durationMs = Math.round(performance.now() - started);
	const encoded    = new TextEncoder().encode(stlText);
	stlText = null; // GC pressure relief
	
	const buffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);

	console.log(`[CAD-Worker] Compiled in ${durationMs}ms - ${Math.round(buffer.byteLength / 1024)} KB`);
	return { buffer, durationMs };
}

// -- Message Handler ----------------------------------------------------------

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
	const data = event.data;
	if (!data || typeof data !== 'object') return;

	try {
		switch (data.type) {
			case 'warmup': {
				await ensureEngine();
				workerScope.postMessage({ type: 'ready' } satisfies ReadyMessage);
				break;
			}

			case 'compile': {
				try {
					const result = await compileToStl(data.script);
					workerScope.postMessage(
						{
							type: 'compiled',
							id: data.id,
							stl: result.buffer,
							durationMs: result.durationMs,
						} satisfies CompiledMessage,
						[result.buffer]
					);
				} catch (err: unknown) {
					const e         = err as Error & { details?: string; classified?: ErrorMessage['errorType'] };
					const message   = e.message ?? 'Unknown compile error';
					const details   = e.details  ?? stderrCapture.join('\n');
					const errorType = e.classified ?? classifyError(message, details);

					workerScope.postMessage({
						type: 'error',
						id: data.id,
						errorType,
						message,
						details,
					} satisfies ErrorMessage);
				}
				break;
			}
		}
	} catch (outerErr: unknown) {
		const message = outerErr instanceof Error ? outerErr.message : String(outerErr);
		workerScope.postMessage({
			type: 'error',
			errorType: 'Unknown',
			message,
			details: stderrCapture.join('\n'),
		} satisfies ErrorMessage);
	}
};
