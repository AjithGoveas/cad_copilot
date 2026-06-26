import { useCallback, useEffect, useRef, useState } from 'react';
import type { EngineError, EngineStatus } from '../types';

type WorkerMessageListener = (e: MessageEvent) => void;
type WorkerErrorListener = (e: ErrorEvent) => void;

class WorkerPoolManager {
    private poolSize: number;
    private workers: {
        worker: Worker;
        isBusy: boolean;
        currentTaskId: number | null;
    }[] = [];
    private nextWorkerIndex = 0;
    
    private listeners = new Set<WorkerMessageListener>();
    private errorListeners = new Set<WorkerErrorListener>();

    constructor() {
        this.poolSize = typeof navigator !== 'undefined'
            ? Math.max(2, Math.min(4, navigator.hardwareConcurrency || 4))
            : 2;
    }

    init() {
        if (typeof window === 'undefined' || this.workers.length > 0) return;
        for (let i = 0; i < this.poolSize; i++) {
            this.spawn(i);
        }
    }

    private spawn(index: number) {
        const worker = new Worker(
            new URL('../../../workers/cad-worker.ts', import.meta.url),
            { type: 'module' }
        );
        
        worker.onmessage = (e) => {
            if (e.data.type === 'ready') return;
            
            if (e.data.type === 'compiled' || e.data.type === 'exported' || e.data.type === 'csg-compiled' || e.data.type === 'error') {
                this.releaseWorker(worker);
            }
            
            this.listeners.forEach(l => {
                try { l(e); } catch (err) {}
            });
        };

        worker.onerror = (e) => {
            const idx = this.workers.findIndex(w => w?.worker === worker);
            if (idx !== -1) {
                worker.terminate();
                this.spawn(idx);
            }
            this.errorListeners.forEach(l => {
                try { l(e); } catch (err) {}
            });
        };

        worker.postMessage({ type: 'warmup' });
        
        this.workers[index] = {
            worker,
            isBusy: false,
            currentTaskId: null
        };
    }

    addListener(l: WorkerMessageListener) {
        this.listeners.add(l);
    }

    removeListener(l: WorkerMessageListener) {
        this.listeners.delete(l);
    }

    addErrorListener(l: WorkerErrorListener) {
        this.errorListeners.add(l);
    }

    removeErrorListener(l: WorkerErrorListener) {
        this.errorListeners.delete(l);
    }

    terminateAll() {
        this.workers.forEach(w => {
            if (w) w.worker.terminate();
        });
        this.workers = [];
    }

    cancelObsoleteTasks(latestRequestId: number) {
        this.workers.forEach((w, index) => {
            if (w && w.isBusy && w.currentTaskId !== null && w.currentTaskId < latestRequestId) {
                w.worker.terminate();
                this.spawn(index);
            }
        });
    }

    getWorker(taskId: number): Worker {
        this.init();
        
        const idleEntry = this.workers.find(w => w && !w.isBusy);
        if (idleEntry) {
            idleEntry.isBusy = true;
            idleEntry.currentTaskId = taskId;
            return idleEntry.worker;
        }

        const index = this.nextWorkerIndex;
        this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.poolSize;

        const entry = this.workers[index];
        if (entry) {
            entry.worker.terminate();
        }
        this.spawn(index);

        const newEntry = this.workers[index];
        newEntry.isBusy = true;
        newEntry.currentTaskId = taskId;
        return newEntry.worker;
    }

    private releaseWorker(worker: Worker) {
        const entry = this.workers.find(w => w && w.worker === worker);
        if (entry) {
            entry.isBusy = false;
            entry.currentTaskId = null;
        }
    }
}

let poolManager: WorkerPoolManager | null = null;
function getPoolManager(): WorkerPoolManager {
    if (typeof window === 'undefined') {
        throw new Error('WorkerPoolManager cannot be accessed on server side');
    }
    if (!poolManager) {
        poolManager = new WorkerPoolManager();
    }
    return poolManager;
}

// 128 MB RAM Bound Main-Thread LRU Cache for compiled part buffers
class MainThreadLRUCache<K, V extends { parts: { id: string; buffer: ArrayBuffer; color?: string }[]; logs: string[] }> {
    private maxBytes: number;
    private currentBytes = 0;
    private cache: Map<K, V>;

    constructor(maxBytes = 128 * 1024 * 1024) {
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
        const incomingSize = val.parts.reduce((sum, p) => sum + p.buffer.byteLength, 0);

        while (this.currentBytes + incomingSize > this.maxBytes && this.cache.size > 0) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey !== undefined) {
                const evicted = this.cache.get(firstKey);
                if (evicted) {
                    this.currentBytes -= evicted.parts.reduce((sum, p) => sum + p.buffer.byteLength, 0);
                }
                this.cache.delete(firstKey);
            }
        }

        if (this.cache.has(key)) {
            const existing = this.cache.get(key);
            if (existing) {
                this.currentBytes -= existing.parts.reduce((sum, p) => sum + p.buffer.byteLength, 0);
            }
            this.cache.delete(key);
        }

        this.cache.set(key, val);
        this.currentBytes += incomingSize;
    }
}

const mainThreadCache = new MainThreadLRUCache<string, { parts: { id: string; buffer: ArrayBuffer; color?: string }[]; logs: string[] }>();

async function computeScriptHash(text: string): Promise<string> {
    try {
        const msgUint8 = new TextEncoder().encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        let hash = 5381;
        for (let i = 0; i < text.length; i++) {
            hash = (hash * 33) ^ text.charCodeAt(i);
        }
        return (hash >>> 0).toString(16);
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

export type CADWorkerConfig = {
    script:      string;
    enabled?:    boolean;
    debounceMs?: number;
};

const STATUS_LABELS: Record<EngineStatus, string> = {
    idle:       'Awaiting Input…',
    compiling:  'Compiling Geometry…',
    ready:      'Engine Ready',
    error:      'Kernel Exception',
};

export function useCadWorker({
    script,
    enabled    = true,
    debounceMs = 300,
}: CADWorkerConfig) {
    const [stlUrls,     setStlUrls]     = useState<Map<string, { url: string; color?: string }>>(new Map());
    const [status,      setStatus]      = useState<EngineStatus>('idle');
    const [engineError, setEngineError] = useState<EngineError | null>(null);
    const [warnings,    setWarnings]    = useState<string[]>([]);
    const [isExporting, setIsExporting] = useState(false);

    const lastRequestIdRef = useRef<number>(0);
    const pendingRequestsRef = useRef<Map<number, { 
        resolve: (data: any) => void, 
        reject: (reason?: any) => void 
    }>>(new Map());

    const activeUrlsRef = useRef<Map<string, { url: string; color?: string }>>(new Map());
    useEffect(() => {
        activeUrlsRef.current = stlUrls;
    }, [stlUrls]);

    const compilationPartsRef = useRef<{
        requestId: number;
        expectedCount: number;
        parts: { id: string; buffer: ArrayBuffer; color?: string }[];
        hasError: boolean;
        logs: string[];
    } | null>(null);

    const flushPendingRequests = useCallback((reason: string) => {
        pendingRequestsRef.current.forEach(({ reject }) => reject(new Error(reason)));
        pendingRequestsRef.current.clear();
    }, []);

    const terminateWorker = useCallback(() => {
        const pm = getPoolManager();
        pm.terminateAll();
        flushPendingRequests('Worker pool terminated.');
    }, [flushPendingRequests]);

    const handleCompiledParts = useCallback((parts: { id: string; buffer: ArrayBuffer; color?: string }[]) => {
        setStlUrls(prev => {
            prev.forEach(item => URL.revokeObjectURL(item.url));
            const next = new Map<string, { url: string; color?: string }>();
            parts.forEach((p) => {
                const blob = new Blob([p.buffer], { type: 'model/stl' });
                next.set(p.id, {
                    url: URL.createObjectURL(blob),
                    color: p.color
                });
            });
            return next;
        });
        setStatus('ready');
    }, []);

    const parseWarnings = useCallback((logs: string[]) => {
        const warningLogs = logs.filter(log => log.toUpperCase().includes('WARNING:'));
        setWarnings(warningLogs);
    }, []);

    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            const data = e.data;
            if (data.type === 'ready') return;

            if (data.type === 'error' && (!data.id || data.id === lastRequestIdRef.current)) {
                if (compilationPartsRef.current && compilationPartsRef.current.requestId === data.id) {
                    compilationPartsRef.current.hasError = true;
                }
                setEngineError({
                    errorType: data.errorType ?? 'Unknown',
                    message:   data.message   ?? 'Unknown engine error.',
                    details:   data.details   ?? '',
                });
                setStatus('error');
            }

            if (data.id && pendingRequestsRef.current.has(data.id)) {
                const { resolve, reject } = pendingRequestsRef.current.get(data.id)!;
                if (data.type === 'error') {
                    reject(new Error(data.message || 'Worker task failed'));
                } else {
                    resolve(data);
                }
                pendingRequestsRef.current.delete(data.id);
            }

            if (data.type === 'compiled' && data.id === lastRequestIdRef.current) {
                const state = compilationPartsRef.current;
                if (state && state.requestId === data.id && !state.hasError) {
                    state.parts.push(...data.parts);
                    if (data.logs) {
                        state.logs.push(...data.logs);
                    }
                    
                    if (state.parts.length >= state.expectedCount) {
                        // Store the successfully compiled parts in main thread LRU Cache
                        computeScriptHash(script).then(hash => {
                            mainThreadCache.set(hash, {
                                parts: state.parts.map(p => ({ ...p, buffer: p.buffer.slice(0) })),
                                logs: [...state.logs]
                            });
                        });
                        
                        handleCompiledParts(state.parts);
                        parseWarnings(state.logs);
                    }
                }
            }
        };

        const handleError = (e: ErrorEvent) => {
            setEngineError({
                errorType: 'Unknown',
                message:   'WASM Worker crashed.',
                details:   e.message ?? '',
            });
            setStatus('error');
            terminateWorker();
        };

        const pm = getPoolManager();
        pm.addListener(handleMessage);
        pm.addErrorListener(handleError);

        return () => {
            pm.removeListener(handleMessage);
            pm.removeErrorListener(handleError);
        };
    }, [terminateWorker, handleCompiledParts, parseWarnings, script]);

    const executeCompile = useCallback(async (codeToCompile: string) => {
        // Check local LRU Cache first
        const hash = await computeScriptHash(codeToCompile);
        const cached = mainThreadCache.get(hash);
        if (cached) {
            handleCompiledParts(cached.parts.map(p => ({ ...p, buffer: p.buffer.slice(0) })));
            parseWarnings(cached.logs);
            setEngineError(null);
            return;
        }

        const pm = getPoolManager();
        const requestId = Date.now();
        lastRequestIdRef.current = requestId;

        setStatus('compiling');
        setEngineError(null);
        setWarnings([]);

        pm.cancelObsoleteTasks(requestId);

        const colors = getUniqueColors(codeToCompile);

        if (colors.length <= 1) {
            compilationPartsRef.current = {
                requestId,
                expectedCount: 1,
                parts: [],
                hasError: false,
                logs: []
            };
            const worker = pm.getWorker(requestId);
            worker.postMessage({ type: 'compile', script: codeToCompile, id: requestId });
        } else {
            compilationPartsRef.current = {
                requestId,
                expectedCount: colors.length,
                parts: [],
                hasError: false,
                logs: []
            };

            const rewritten = prepareMultiColorScript(codeToCompile, colors);
            colors.forEach(color => {
                const partScript = `RENDER_COLOR = "${color}";\n${rewritten}`;
                const worker = pm.getWorker(requestId);
                worker.postMessage({
                    type: 'compile',
                    script: partScript,
                    color,
                    partId: `part_${color}`,
                    id: requestId
                });
            });
        }
    }, [handleCompiledParts, parseWarnings]);

    const exportModel = useCallback(async (
        format: 'stl' | 'dxf',
        dxfMode?: 'silhouette' | 'section' | 'blueprint',
        customScript?: string
    ): Promise<ArrayBuffer> => {
        terminateWorker();

        const codeToProcess = customScript || script;
        if (!codeToProcess) throw new Error('No script available to export');

        const pm = getPoolManager();
        const requestId = Date.now();
        const worker = pm.getWorker(requestId);

        setIsExporting(true);

        try {
             return await new Promise<ArrayBuffer>((resolve, reject) => {
                pendingRequestsRef.current.set(requestId, {
                    resolve: (data) => resolve(data.data),
                    reject
                });

                worker.postMessage({
                    type: 'export',
                    script: codeToProcess,
                    format,
                    dxfMode,
                    id: requestId
                });
            });
        } finally {
            setIsExporting(false);
        }
    }, [script, terminateWorker]);

    const compileCsgTree = useCallback(async (customScript?: string): Promise<string> => {
        terminateWorker();

        const codeToProcess = customScript || script;
        if (!codeToProcess) throw new Error('No script available to compile CSG');

        const pm = getPoolManager();
        const requestId = Date.now();
        const worker = pm.getWorker(requestId);

        setIsExporting(true);

        try {
            return await new Promise<string>((resolve, reject) => {
                pendingRequestsRef.current.set(requestId, {
                    resolve: (data) => resolve(data.csgTree),
                    reject
                });

                worker.postMessage({
                    type: 'compile-csg',
                    script: codeToProcess,
                    id: requestId
                });
            });
        } finally {
            setIsExporting(false);
        }
    }, [script, terminateWorker]);

    const rebuild = useCallback(() => {
        if (!script) return;
        executeCompile(script);
    }, [script, executeCompile]);

    const respawn = useCallback(() => {
        terminateWorker();
        if (script) executeCompile(script);
    }, [script, executeCompile, terminateWorker]);

    useEffect(() => {
        if (!enabled || !script) return;
        
        const timer = setTimeout(() => {
            executeCompile(script);
        }, debounceMs);

        return () => clearTimeout(timer);
    }, [script, enabled, executeCompile, debounceMs]);

    useEffect(() => {
        return () => {
            flushPendingRequests('Component unmounted');
            activeUrlsRef.current.forEach(item => URL.revokeObjectURL(item.url));
        };
    }, [flushPendingRequests]);

    return {
        stlUrls,
        status,
        statusText:    STATUS_LABELS[status] || 'Initialising…',
        engineError,
        error:         engineError?.message ?? null,
        warnings,
        isRecompiling: status === 'compiling',
        isExporting,
        rebuild,
        respawn,
        exportModel,
        compileCsgTree,
    };
}
