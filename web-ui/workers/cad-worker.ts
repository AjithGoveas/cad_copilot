/// <reference lib="webworker" />

// ─── Message Protocol ────────────────────────────────────────────────────────

type WarmupRequest      = { type: 'warmup' };
type CompileRequest     = { type: 'compile'; id: number; script: string };
type ExportRequest      = { 
    type: 'export'; 
    id: number; 
    script: string; 
    format: 'stl' | 'dxf';
    dxfMode?: 'silhouette' | 'section' | 'blueprint';
};
type WorkerRequest      = WarmupRequest | CompileRequest | ExportRequest;

type ReadyMessage           = { type: 'ready' };

type PartData = {
    id: string;
    buffer: ArrayBuffer;
    durationMs: number;
};

type CompiledMessage = { 
    type: 'compiled'; 
    id: number; 
    parts: PartData[]; 
    durationMs: number 
};

type ExportedMessage        = { type: 'exported'; id: number; data: ArrayBuffer; format: 'stl' | 'dxf'; durationMs: number };

type ErrorMessage = {
    type: 'error';
    id?: number;
    errorType: 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown';
    message: string;
    details: string; 
};

type WorkerMessage = ReadyMessage | CompiledMessage | ExportedMessage | ErrorMessage;

// ─── Engine Interface ────────────────────────────────────────────────────────

interface FS {
    mkdir(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string, opts?: { encoding?: string }): Uint8Array | string;
    analyzePath(path: string): { exists: boolean };
    unlink(path: string): void;
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

async function ensureEngine(forceReload = false): Promise<OpenScadInstance> {
    if (forceReload) {
        console.log('[CAD-Worker] Force resetting engine instance...');
        enginePromise = null;
    }

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
                    if (text.includes('localization')) return;

                    const isStat = /Geometries|CGAL|rendering time|Top level object|Simple:|Vertices:|Halfedges:|Edges:|Halffacets:|Facets:|Volumes:/i.test(text);
                    if (isStat) return; 

                    console.warn('[OpenSCAD Error]', text);
                    stderrCapture.push(text);
                },
                INITIAL_MEMORY: 512 * 1024 * 1024,    // 512 MB
                MAXIMUM_MEMORY: 2048 * 1024 * 1024,   // 2 GB
                ALLOW_MEMORY_GROWTH: 1,
            });
        })();
    }
    return enginePromise;
}

// ─── Compilation Core ────────────────────────────────────────────────────────

function classifyError(message: string, details: string): ErrorMessage['errorType'] {
    const combined = `${message} ${details}`.toLowerCase();

    if (combined.includes('cgal') || combined.includes('non-manifold') || combined.includes('z-fighting') || combined.includes('assertion') || combined.includes('degenerate')) {
        return 'CompileFailure';
    }
    if (combined.includes('out of bounds') || combined.includes('memory access') || combined.includes('unreachable') || combined.includes('heap')) {
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
        const msg = `CGAL Geometry Engine Crash (pointer: ${err}). Likely cause: z-fighting or non-manifold geometry. Apply the Epsilon Rule - extend all subtractive volumes by \`eps = 0.05\` and shift down by \`translate([0,0,-eps/2])\`.`;
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
    format: 'stl' | 'dxf',
    dxfMode: 'silhouette' | 'section' | 'blueprint' = 'silhouette'
): Promise<{ buffer: ArrayBuffer; durationMs: number }> {
    
    // THE FIX: Pass `true` here to force a fresh WebAssembly instance every single time.
    // This completely wipes the corrupted C++ global state from previous runs.
    const engine   = await ensureEngine(true); 
    
    const instance = engine.getInstance();
    const fs       = instance.FS;

    stderrCapture.length = 0; 
    const started = performance.now();
    const outputPath = `/output.${format}`;

    try {
        try { if (fs.analyzePath(INPUT_PATH).exists) fs.unlink(INPUT_PATH); } catch (e) {}
        try { if (fs.analyzePath(outputPath).exists) fs.unlink(outputPath); } catch (e) {}

        let finalScript = script;

        if (format === 'dxf') {
            console.log(`[CAD-Worker] Formatting DXF export (Mode: ${dxfMode})...`);

            // THE FIX: We don't use regex to find a single call anymore. 
            // We append the projection commands to the absolute end of the file 
            // and wrap the ENTIRE script execution in a render() block.

            if (dxfMode === 'blueprint') {
                const spacingX = 150; // Or keep your dynamic extraction logic
                const spacingY = 150;

                // We wrap the entire original script in a module, then project that module
                finalScript = `
${script}

// --- DXF Projection Wrapper ---
module __dxf_wrapper_root() {
    // Because the script above might execute raw geometry, we wrap its evaluation
    children();
}

module generate_dxf_sheet_fixed() {
    translate([0, 0]) projection(cut = false) __dxf_wrapper_root() { ${script} }
    translate([0, -${spacingY}]) projection(cut = true) rotate([90, 0, 0]) translate([0, 0, 0.005]) __dxf_wrapper_root() { ${script} }
    translate([${spacingX}, 0]) projection(cut = false) rotate([0, 90, 0]) __dxf_wrapper_root() { ${script} }
}
generate_dxf_sheet_fixed();
`;

            } else {
                const isCut = dxfMode === 'section';
                if (isCut) {
                    finalScript = `
${script}
// --- DXF Projection Wrapper ---
translate([0, 0]) projection(cut=true) translate([0, 0, 0.005]) children() { ${script} }
`;
                } else {
                    finalScript = `
${script}
// --- DXF Projection Wrapper ---
translate([0, 0]) projection(cut=false) children() { ${script} }
`;
                }
            }
            console.log('[CAD-Worker] Final DXF Script Payload:\n', finalScript);
        }

        fs.writeFile(INPUT_PATH, finalScript);

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

async function compileToParts(
    script: string
): Promise<{ parts: PartData[]; durationMs: number }> {
    const started = performance.now();
    
    console.log('[CAD-Worker] Compiling full assembly...');
    try {
        const { buffer, durationMs } = await exportToFile(script, 'stl');
        return {
            parts: [{ id: 'part_root', buffer, durationMs }],
            durationMs: Math.round(performance.now() - started)
        };
    } catch (e: any) {
        throw Object.assign(new Error(`Geometry Engine Error: ${e.message}`), {
            details: e.details || 'The OpenSCAD engine produced no geometry.',
            classified: e.classified || 'CompileFailure'
        });
    }
}

// ─── Message Handler ─────────────────────────────────────────────────────────

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
                    const result = await compileToParts(data.script);
                    workerScope.postMessage(
                        {
                            type: 'compiled',
                            id: data.id,
                            parts: result.parts,
                            durationMs: result.durationMs,
                        } satisfies CompiledMessage,
                        result.parts.map(p => p.buffer)
                    );
                } catch (err: unknown) {
                    handleWorkerError(err, data.id);
                }
                break;
            }

            case 'export': {
                try {
                    const result = await exportToFile(data.script, data.format, data.dxfMode);
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