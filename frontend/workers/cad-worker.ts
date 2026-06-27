/// <reference lib="webworker" />

type WarmupRequest      = { type: 'warmup' };
type CompileRequest     = { 
    type: 'compile'; 
    id: number; 
    script: string; 
    color?: string;
    partId?: string;
};
type ExportRequest      = { 
    type: 'export'; 
    id: number; 
    script: string; 
    format: 'stl' | 'dxf';
    dxfMode?: 'silhouette' | 'section' | 'blueprint';
};
type CompileCsgRequest  = { type: 'compile-csg'; id: number; script: string };
type WorkerRequest      = WarmupRequest | CompileRequest | ExportRequest | CompileCsgRequest;

type ReadyMessage           = { type: 'ready' };

type PartData = {
    id: string;
    buffer: ArrayBuffer;
    durationMs: number;
    color?: string;
};

type CompiledMessage = { 
    type: 'compiled'; 
    id: number; 
    parts: PartData[]; 
    durationMs: number;
    logs?: string[];
};

type ExportedMessage        = { type: 'exported'; id: number; data: ArrayBuffer; format: 'stl' | 'dxf'; durationMs: number };
type CsgCompiledMessage     = { type: 'csg-compiled'; id: number; csgTree: string; encoding?: 'gzip+base64' };

type ErrorMessage = {
    type: 'error';
    id?: number;
    errorType: 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown' | 'Not3D';
    message: string;
    details: string; 
};

type WorkerMessage = ReadyMessage | CompiledMessage | ExportedMessage | ErrorMessage | CsgCompiledMessage;

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

const workerScope = self as DedicatedWorkerGlobalScope;
let enginePromise: Promise<OpenScadInstance> | null = null;
const stderrCapture: string[] = [];

async function ensureEngine(forceReload = false): Promise<OpenScadInstance> {
    if (forceReload) {
        enginePromise = null;
    }

    if (!enginePromise) {
        enginePromise = (async () => {
            const mod = (await import('openscad-wasm')) as unknown as OpenScadModule;

            if (!mod.createOpenSCAD) {
                throw new Error('openscad-wasm: createOpenSCAD function not found.');
            }

            const engine = await mod.createOpenSCAD({
                print: (_text: string) => {},
                printErr: (text: string) => {
                    // Suppress harmless informational noise
                    if (text.includes('localization')) return;
                    if (text.startsWith('TRACE:')) return;
                    if (/Ignoring request to enable unknown feature/i.test(text)) return;

                    // Suppress geometry stat lines (not errors)
                    const isStat = /Geometries|CGAL|rendering time|Top level object|Simple:|Vertices:|Halfedges:|Edges:|Halffacets:|Facets:|Volumes:/i.test(text);
                    if (isStat) return;

                    stderrCapture.push(text);
                },
                // High-performance allocation: Pre-allocating 256MB makes worker instantiation fast
                // while ALLOW_MEMORY_GROWTH allows scaling up to 2GB dynamically on demand.
                INITIAL_MEMORY: 256 * 1024 * 1024,
                MAXIMUM_MEMORY: 2048 * 1024 * 1024,
                ALLOW_MEMORY_GROWTH: 1,
            });

            // Set up font configuration dynamically to avoid crashes on 3D text modules
            try {
                const instance = engine.getInstance();
                const FS = instance.FS;
                const fontsConf = `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig></fontconfig>`;
                
                const createDir = (path: string) => {
                    const parts = path.split('/');
                    let current = '';
                    for (const p of parts) {
                        if (!p) continue;
                        current += '/' + p;
                        try {
                            if (!FS.analyzePath(current).exists) {
                                FS.mkdir(current);
                            }
                        } catch (e) {}
                    }
                };

                createDir('/fonts');
                FS.writeFile('/fonts/fonts.conf', fontsConf);
                
                // Fetch default font from next server assets if available
                fetch('/Geist-Regular.ttf')
                    .then(res => {
                        if (res.ok) return res.arrayBuffer();
                        throw new Error('Font file not found');
                    })
                    .then(buf => {
                        FS.writeFile('/fonts/Geist-Regular.ttf', new Uint8Array(buf));
                    })
                    .catch(() => {});
            } catch (e) {
                console.warn('[Worker] Font initialization skipped:', e);
            }

            return engine;
        })();
    }
    return enginePromise;
}

function classifyError(message: string, details: string): ErrorMessage['errorType'] {
    const combined = `${message} ${details}`.toLowerCase();

    if (combined.includes('not a 3d object') || combined.includes('not a 3d shape') || combined.includes('not a 3d')) {
        return 'Not3D';
    }
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

class LRUCache<K, V extends { buffer: ArrayBuffer }> {
    private maxBytes: number;
    private currentBytes = 0;
    private cache: Map<K, V>;

    constructor(maxBytes = 128 * 1024 * 1024) { // 128 MB RAM Bound
        this.maxBytes = maxBytes;
        this.cache = new Map();
    }

    get(key: K): V | undefined {
        const item = this.cache.get(key);
        if (item !== undefined) {
            this.cache.delete(key);
            this.cache.set(key, item);
        }
        return item;
    }

    set(key: K, val: V): void {
        const incomingSize = val.buffer.byteLength;

        // Evict items dynamically until the buffer array clears out enough space
        while (this.currentBytes + incomingSize > this.maxBytes && this.cache.size > 0) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                const evictedItem = this.cache.get(firstKey);
                if (evictedItem) {
                    this.currentBytes -= evictedItem.buffer.byteLength;
                }
                this.cache.delete(firstKey);
            }
        }

        if (this.cache.has(key)) {
            const existingItem = this.cache.get(key);
            if (existingItem) this.currentBytes -= existingItem.buffer.byteLength;
            this.cache.delete(key);
        }

        this.cache.set(key, val);
        this.currentBytes += incomingSize;
    }
}

async function computeHash(text: string): Promise<string> {
    try {
        const msgUint8 = new TextEncoder().encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0, ch; i < text.length; i++) {
            ch = text.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
    }
}

const loadedLibraries = new Set<string>();
const loadingPromises = new Map<string, Promise<void>>();

async function loadLibraryZip(fs: FS, libName: string): Promise<void> {
    if (loadedLibraries.has(libName)) {
        return;
    }
    if (loadingPromises.has(libName)) {
        return loadingPromises.get(libName)!;
    }

    const promise = (async () => {
        let cacheAvailable = false;
        try {
            cacheAvailable = typeof caches !== 'undefined';
        } catch (e) {}

        if (cacheAvailable) {
            try {
                const cache = await caches.open('scad-libraries');
                const cachedKeys = await cache.keys();
                const libPrefix = `http://scad-library-cache/${libName}/`;
                const cachedFiles = cachedKeys.filter(req => req.url.startsWith(libPrefix));

                if (cachedFiles.length > 0) {
                    for (const req of cachedFiles) {
                        const res = await cache.match(req);
                        if (res) {
                            const buffer = await res.arrayBuffer();
                            const fileData = new Uint8Array(buffer);
                            const normalizedPath = req.url.substring(`http://scad-library-cache/`.length);
                            writeToFs(fs, normalizedPath, fileData);
                        }
                    }
                    loadedLibraries.add(libName);
                    return;
                }
            } catch (cacheErr) {
                console.warn('[Worker] Cache lookup failed, falling back to download:', cacheErr);
            }
        }

        const fflateUrl = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/+esm';
        const { unzipSync } = await import(/* webpackIgnore: true */ fflateUrl);

        const url = `/libraries/${libName}.zip`;
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch library zip from ${url}: ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const zipData = new Uint8Array(arrayBuffer);
        const unzipped = unzipSync(zipData) as Record<string, Uint8Array>;

        let cacheToWrite: any = null;
        if (cacheAvailable) {
            try {
                cacheToWrite = await caches.open('scad-libraries');
            } catch (e) {}
        }

        for (const [filePath, fileData] of Object.entries(unzipped)) {
            if (filePath.endsWith('/') || fileData.length === 0) {
                continue;
            }

            let normalizedPath = filePath;
            if (!filePath.startsWith(libName + '/')) {
                normalizedPath = libName + '/' + filePath;
            }

            writeToFs(fs, normalizedPath, fileData);

            if (cacheToWrite) {
                try {
                    const cacheUrl = `http://scad-library-cache/${normalizedPath}`;
                    await cacheToWrite.put(
                        new Request(cacheUrl),
                        new Response(fileData as any, {
                            headers: { 'Content-Type': 'application/octet-stream' }
                        })
                    );
                } catch (e) {}
            }
        }

        loadedLibraries.add(libName);
    })();

    loadingPromises.set(libName, promise);
    try {
        await promise;
    } finally {
        loadingPromises.delete(libName);
    }
}

function writeToFs(fs: FS, normalizedPath: string, fileData: Uint8Array) {
    const parts = normalizedPath.split('/');
    let currentDir = '';
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir += '/' + parts[i];
        try {
            if (!fs.analyzePath(currentDir).exists) {
                fs.mkdir(currentDir);
            }
        } catch (e) {}
    }
    fs.writeFile('/' + normalizedPath, fileData);
}

async function resolveScriptLibraries(fs: FS, script: string): Promise<void> {
    const cleanScript = script.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const includeRegex = /(?:include|use)\s*<([^>]+)>/g;
    let match;
    const loads: Promise<void>[] = [];

    while ((match = includeRegex.exec(cleanScript)) !== null) {
        const libraryPath = match[1];
        if (libraryPath.startsWith('BOSL2/')) {
            loads.push(loadLibraryZip(fs, 'BOSL2'));
        } else if (libraryPath.startsWith('BOSL/')) {
            loads.push(loadLibraryZip(fs, 'BOSL'));
        } else if (libraryPath.startsWith('MCAD/')) {
            loads.push(loadLibraryZip(fs, 'MCAD'));
        }
    }

    if (loads.length > 0) {
        await Promise.all(loads);
    }
}

const geometryCache = new LRUCache<string, { buffer: ArrayBuffer }>();
const INPUT_PATH  = '/input.scad';

async function exportToFile(
    script: string,
    format: 'stl' | 'dxf',
    dxfMode: 'silhouette' | 'section' | 'blueprint' = 'silhouette'
): Promise<{ buffer: ArrayBuffer; durationMs: number }> {
    const hash = await computeHash(script);
    const cacheKey = `${format}:${dxfMode}:${hash}`;
    const cached = geometryCache.get(cacheKey);
    if (cached) {
        return {
            buffer: cached.buffer.slice(0),
            durationMs: 0
        };
    }

    let fs: FS | undefined;
    const started = performance.now();
    const outputPath = `/output.${format}`;

    try {
        const engine   = await ensureEngine(false);
        const instance = engine.getInstance();
        fs       = instance.FS;

        stderrCapture.length = 0;

        await resolveScriptLibraries(fs, script);

        try { if (fs.analyzePath(INPUT_PATH).exists) fs.unlink(INPUT_PATH); } catch (e) {}
        try { if (fs.analyzePath(outputPath).exists) fs.unlink(outputPath); } catch (e) {}

        fs.writeFile(INPUT_PATH, script);

        // Note: --enable=manifold and --enable=fast-csg are NOT supported by the current openscad-wasm build.
        // Passing unknown feature flags causes "Ignoring request to enable unknown feature" warnings
        // which can destabilize the WASM engine state and produce spurious parse errors.
        // Only --enable=lazy-union is broadly supported and safe to use.
        const args = ['-o', outputPath, '--enable=lazy-union', INPUT_PATH];
        const exitCode = instance.callMain(args);

        if (exitCode !== 0 || !fs.analyzePath(outputPath).exists) {
            const details = stderrCapture.join('\n');
            throw Object.assign(
                new Error(`OpenSCAD export to ${format.toUpperCase()} failed (exit ${exitCode}).`),
                { details, classified: classifyError('compile', details) }
            ) as Error & { details?: string; classified?: ErrorMessage['errorType'] };
        }

        const outputData = fs.readFile(outputPath) as Uint8Array;
        const buffer     = outputData.buffer.slice(outputData.byteOffset, outputData.byteOffset + outputData.byteLength) as ArrayBuffer;
        const durationMs = Math.round(performance.now() - started);

        geometryCache.set(cacheKey, { buffer: buffer.slice(0) });

        return { buffer, durationMs };

    } catch (err: unknown) {
        throw normaliseThrown(err);
    } finally {
        if (fs) {
            const filesToCleanup = [
                INPUT_PATH,
                outputPath,
                '/input.scad',
                '/output.stl',
                '/output.dxf',
                '/output.amf',
                '/output.dxf.tmp',
                '/output.stl.tmp'
            ];
            for (const file of filesToCleanup) {
                try {
                    if (fs.analyzePath(file).exists) {
                        fs.unlink(file);
                    }
                } catch (e) {}
            }
        }
    }
}

function getUniqueColors(script: string): string[] {
    const colorRegex = /\bcolor\s*\(\s*"([^"]+)"\s*\)/g;
    const colors = new Set<string>();
    let match;
    while ((match = colorRegex.exec(script)) !== null) {
        colors.add(match[1]);
    }
    return Array.from(colors);
}

function prepareMultiColorScript(script: string, colors: string[]): string {
    let rewritten = script;
    for (const color of colors) {
        const escapedColor = color.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const re = new RegExp(`\\bcolor\\s*\\(\\s*"${escapedColor}"\\s*\\)`, 'g');
        rewritten = rewritten.replace(re, `if (RENDER_COLOR == "all" || RENDER_COLOR == "${color}") color("${color}")`);
    }
    return rewritten;
}

async function compileSingleColorOrAll(
    script: string,
    color?: string,
    partId?: string
): Promise<{ parts: PartData[]; durationMs: number; logs: string[] }> {
    const started = performance.now();
    const colors = getUniqueColors(script);
    stderrCapture.length = 0;

    try {
        if (color && colors.includes(color)) {
            const rewritten = prepareMultiColorScript(script, colors);
            const partScript = `RENDER_COLOR = "${color}";\n${rewritten}`;
            const { buffer, durationMs } = await exportToFile(partScript, 'stl');
            return {
                parts: [{
                    id: partId || `part_${color}`,
                    buffer,
                    durationMs,
                    color
                }],
                durationMs: Math.round(performance.now() - started),
                logs: [...stderrCapture]
            };
        } else {
            const result = await compileToParts(script);
            return {
                ...result,
                logs: [...stderrCapture]
            };
        }
    } catch (e: any) {
        throw Object.assign(new Error(`Geometry Engine Error: ${e.message}`), {
            details: e.details || 'The OpenSCAD engine produced no geometry.',
            classified: e.classified || 'CompileFailure'
        });
    }
}

async function compileToParts(
    script: string
): Promise<{ parts: PartData[]; durationMs: number }> {
    const started = performance.now();
    const colors = getUniqueColors(script);

    try {
        if (colors.length <= 1) {
            const { buffer, durationMs } = await exportToFile(script, 'stl');
            return {
                parts: [{ 
                    id: 'part_root', 
                    buffer, 
                    durationMs,
                    color: colors.length === 1 ? colors[0] : undefined
                }],
                durationMs: Math.round(performance.now() - started)
            };
        } else {
            const rewritten = prepareMultiColorScript(script, colors);
            const compilePromises = colors.map(async (color) => {
                const partScript = `RENDER_COLOR = "${color}";\n${rewritten}`;
                const { buffer, durationMs } = await exportToFile(partScript, 'stl');
                return {
                    id: `part_${color}`,
                    buffer,
                    durationMs,
                    color
                };
            });
            const parts = await Promise.all(compilePromises);
            return {
                parts,
                durationMs: Math.round(performance.now() - started)
            };
        }
    } catch (e: any) {
        throw Object.assign(new Error(`Geometry Engine Error: ${e.message}`), {
            details: e.details || 'The OpenSCAD engine produced no geometry.',
            classified: e.classified || 'CompileFailure'
        });
    }
}

async function compileCsg(
    script: string
): Promise<{ payload: string; encoding: 'gzip+base64' | 'raw' }> {
    let fs: FS | undefined;
    const INPUT_PATH = '/input.scad';
    const OUTPUT_PATH = '/output.csg';

    try {
        const engine = await ensureEngine(false);
        const instance = engine.getInstance();
        fs = instance.FS;

        stderrCapture.length = 0;

        await resolveScriptLibraries(fs, script);

        try { if (fs.analyzePath(INPUT_PATH).exists) fs.unlink(INPUT_PATH); } catch (e) {}
        try { if (fs.analyzePath(OUTPUT_PATH).exists) fs.unlink(OUTPUT_PATH); } catch (e) {}

        fs.writeFile(INPUT_PATH, script);

        const exitCode = instance.callMain(['-o', OUTPUT_PATH, '--enable=lazy-union', INPUT_PATH]);

        if (exitCode !== 0 || !fs.analyzePath(OUTPUT_PATH).exists) {
            const details = stderrCapture.join('\n');
            throw Object.assign(
                new Error(`OpenSCAD CSG compilation failed (exit ${exitCode}).`),
                { details, classified: classifyError('compile', details) }
            ) as Error & { details?: string; classified?: ErrorMessage['errorType'] };
        }

        const csgTreeRaw = fs.readFile(OUTPUT_PATH, { encoding: 'utf8' }) as string;
        return await compressCsgTree(csgTreeRaw);

    } catch (err: unknown) {
        throw normaliseThrown(err);
    } finally {
        if (fs) {
            const filesToCleanup = [
                INPUT_PATH,
                OUTPUT_PATH
            ];
            for (const file of filesToCleanup) {
                try {
                    if (fs.analyzePath(file).exists) {
                        fs.unlink(file);
                    }
                } catch (e) {}
            }
        }
    }
}

/**
 * Gzip + base64-encode a CSG tree string. BOSL2/MCAD-expanded CSG trees are
 * typically 70–85% token repetition (`group()`, `multmatrix(...)`, etc.) so
 * gzip yields ~5–10× reduction, dramatically shrinking the worker→backend
 * payload.
 *
 * Returns the inflated string with `encoding: 'raw'` if `CompressionStream`
 * is unavailable in this Worker (legacy browser fallback).
 */
async function compressCsgTree(text: string): Promise<{ payload: string; encoding: 'gzip+base64' | 'raw' }> {
    if (typeof CompressionStream === 'undefined') {
        return { payload: text, encoding: 'raw' };
    }
    try {
        const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
        const buffer = await new Response(stream).arrayBuffer();
        const bytes = new Uint8Array(buffer);
        // Chunked base64 to avoid call-stack overflow on large inputs.
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(
                null,
                Array.from(bytes.subarray(i, i + chunk))
            );
        }
        return { payload: btoa(binary), encoding: 'gzip+base64' };
    } catch {
        return { payload: text, encoding: 'raw' };
    }
}

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
                    const result = await compileSingleColorOrAll(data.script, data.color, data.partId);
                    workerScope.postMessage(
                        {
                            type: 'compiled',
                            id: data.id,
                            parts: result.parts,
                            durationMs: result.durationMs,
                            logs: result.logs,
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

            case 'compile-csg': {
                try {
                    const { payload, encoding } = await compileCsg(data.script);
                    workerScope.postMessage({
                        type: 'csg-compiled',
                        id: data.id,
                        csgTree: payload,
                        encoding: encoding === 'gzip+base64' ? 'gzip+base64' : undefined,
                    } satisfies CsgCompiledMessage);
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

    if (errorType === 'CompileFailure' && (message.includes('CGAL') || message.includes('pointer:'))) {
        enginePromise = null;
    }

    workerScope.postMessage({
        type: 'error',
        id,
        errorType,
        message,
        details,
    } satisfies ErrorMessage);
}