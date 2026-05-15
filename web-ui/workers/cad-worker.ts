/// <reference lib="webworker" />

// ─── Message Protocol ────────────────────────────────────────────────────────

type WarmupRequest      = { type: 'warmup' };
type CompileRequest     = { type: 'compile'; id: number; script: string };
type ExportRequest      = { type: 'export'; id: number; script: string; format: 'stl' | 'dxf' | 'off' | 'amf' | '3mf' };
type WorkerRequest      = WarmupRequest | CompileRequest | ExportRequest;

type ReadyMessage           = { type: 'ready' };
type CompiledMessage        = { type: 'compiled'; id: number; stl: ArrayBuffer; durationMs: number };
type ExportedMessage        = { type: 'exported'; id: number; data: ArrayBuffer; format: string; durationMs: number };

// Structured error with type classification for the self-healing UI
type ErrorMessage = {
	type: 'error';
	id?: number;
	errorType: 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown';
	message: string;
	details: string;  // Full stack trace / WASM stderr
};

type WorkerMessage = ReadyMessage | CompiledMessage | ExportedMessage | ErrorMessage;

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
					// Ignore harmless localization warnings
					if (text.includes('localization')) return;

        			// OpenSCAD outputs build stats to stderr. Filter them so they aren't treated as crashes.
					const isStat = /Geometries|CGAL|rendering time|Top level object|Simple:|Vertices:|Halfedges:|Edges:|Halffacets:|Facets:|Volumes:/i.test(text);
					
					if (isStat) {
						// Optional: You can log these as debug info, or just do nothing to hide them
						// console.debug('[OpenSCAD Stat]', text); 
						return; 
					}

					// If it makes it here, it's a real error (like a syntax error or math failure)
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

async function exportToFile(
    script: string,
    format: 'stl' | 'dxf' | 'off' | 'amf' | '3mf'
): Promise<{ buffer: ArrayBuffer; durationMs: number }> {
    const engine   = await ensureEngine();
    const instance = engine.getInstance();
    const fs       = instance.FS;

    stderrCapture.length = 0; 
    const started = performance.now();
    const outputPath = `/output.${format}`;

    try {
        // Clean up any old files
        try { if (fs.analyzePath(INPUT_PATH).exists) fs.unlink(INPUT_PATH); } catch (e) {}
        try { if (fs.analyzePath(outputPath).exists) fs.unlink(outputPath); } catch (e) {}

        // ── DXF Safety: OpenSCAD requires 2D geometry for DXF export ──────────
        let finalScript = script;
        if (format === 'dxf' && !script.includes('projection(')) {
            console.log('[CAD-Worker] Applying projection() to final module call for DXF export...');
            
            // This regex finds the LAST function call in the file (e.g., "part_root();")
            // and safely wraps ONLY that call in the projection modifier.
            finalScript = script.replace(
                /([\w]+\s*\([^)]*\)\s*;)(?=[^;]*$)/, 
                "projection(cut=false) { $1 }"
            );
        }

        fs.writeFile(INPUT_PATH, finalScript);

        // Use callMain for direct CLI-style export
        const exitCode = instance.callMain(['-o', outputPath, INPUT_PATH]);

        if (exitCode !== 0 || !fs.analyzePath(outputPath).exists) {
            const details = stderrCapture.join('\n');
            throw Object.assign(
                new Error(`OpenSCAD export to ${format.toUpperCase()} failed (exit ${exitCode}).`),
                { details, classified: classifyError('compile', details) }
            );
        }

        const outputData = fs.readFile(outputPath) as Uint8Array;
        const buffer     = outputData.buffer.slice(outputData.byteOffset, outputData.byteOffset + outputData.byteLength) as ArrayBuffer;
        const durationMs = Math.round(performance.now() - started);

        console.log(`[CAD-Worker] Exported ${format.toUpperCase()} in ${durationMs}ms - ${Math.round(buffer.byteLength / 1024)} KB`);
        return { buffer, durationMs };

    } catch (err: unknown) {
        throw normaliseThrown(err);
    } finally {
        try { if (fs.analyzePath(INPUT_PATH).exists) fs.unlink(INPUT_PATH); } catch (e) {}
        try { if (fs.analyzePath(outputPath).exists) fs.unlink(outputPath); } catch (e) {}
    }
}

async function compileToStl(
	script: string
): Promise<{ buffer: ArrayBuffer; durationMs: number }> {
	return exportToFile(script, 'stl');
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
					handleWorkerError(err, data.id);
				}
				break;
			}

			case 'export': {
				try {
					const result = await exportToFile(data.script, data.format);
					workerScope.postMessage(
						{
							type: 'exported',
							id: data.id,
							data: result.buffer,
							format: data.format,
							durationMs: result.durationMs,
						} satisfies ExportedMessage,
						[result.buffer]
					);
				} catch (err: unknown) {
					handleWorkerError(err, data.id);
				}
				break;
			}
		}
	} catch (outerErr: unknown) {
		handleWorkerError(outerErr);
	}
};

function handleWorkerError(err: unknown, id?: number) {
	const e         = normaliseThrown(err);
	const message   = e.message ?? 'Unknown worker error';
	const details   = e.details  ?? stderrCapture.join('\n');
	const errorType = e.classified ?? classifyError(message, details);

	workerScope.postMessage({
		type: 'error',
		id,
		errorType,
		message,
		details,
	} satisfies ErrorMessage);
}
