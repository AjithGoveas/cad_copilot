import { useCallback, useEffect, useRef, useState } from 'react';

export type EngineErrorType = 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown';

export type EngineError = {
    errorType: EngineErrorType;
    message:   string;
    details:   string;
};

export type CADEngineConfig = {
    script:      string;
    enabled?:    boolean;
    debounceMs?: number;
};

export type EngineStatus =
    | 'idle'
    | 'compiling'
    | 'ready'
    | 'error';

const STATUS_LABELS: Record<EngineStatus, string> = {
    idle:       'Awaiting Input…',
    compiling:  'Compiling Geometry…',
    ready:      'Engine Ready',
    error:      'Kernel Exception',
};

let globalWorker: Worker | null = null;
const globalListeners = new Set<(e: MessageEvent) => void>();
const globalErrorListeners = new Set<(e: ErrorEvent) => void>();

function getGlobalWorker(): Worker {
    if (typeof window === 'undefined') {
        throw new Error('Worker cannot be created on server side');
    }

    if (!globalWorker) {
        globalWorker = new Worker(
            new URL('../workers/cad-worker.ts', import.meta.url),
            { type: 'module' }
        );

        globalWorker.onmessage = (e: MessageEvent) => {
            globalListeners.forEach(listener => {
                try { listener(e); }
                catch { }
            });
        };

        globalWorker.onerror = (e: ErrorEvent) => {
            globalErrorListeners.forEach(listener => {
                try { listener(e); }
                catch { }
            });
        };

        globalWorker.postMessage({ type: 'warmup' });
    }
    return globalWorker;
}

function terminateGlobalWorker() {
    if (globalWorker) {
        globalWorker.terminate();
        globalWorker = null;
    }
}

export function useCADEngine({
    script,
    enabled    = true,
    debounceMs = 600,
}: CADEngineConfig) {

    const [stlUrls,     setStlUrls]     = useState<Map<string, string>>(new Map());
    const [status,      setStatus]      = useState<EngineStatus>('idle');
    const [engineError, setEngineError] = useState<EngineError | null>(null);
    const [isExporting, setIsExporting] = useState(false);

    const lastRequestIdRef = useRef<number>(0);
    
    const pendingRequestsRef = useRef<Map<number, { 
        resolve: (data: any) => void, 
        reject: (reason?: any) => void 
    }>>(new Map());

    const activeUrlsRef = useRef<Map<string, string>>(new Map());
    useEffect(() => {
        activeUrlsRef.current = stlUrls;
    }, [stlUrls]);

    const flushPendingRequests = useCallback((reason: string) => {
        pendingRequestsRef.current.forEach(({ reject }) => reject(new Error(reason)));
        pendingRequestsRef.current.clear();
    }, []);

    const terminateWorker = useCallback(() => {
        terminateGlobalWorker();
        flushPendingRequests('Worker terminated.');
    }, [flushPendingRequests]);

    const getWorker = useCallback(() => {
        return getGlobalWorker();
    }, []);

    useEffect(() => {
        const handleMessage = (e: MessageEvent) => {
            const data = e.data;
            
            if (data.type === 'ready') return;

            if (data.type === 'error' && !data.id) {
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
                setStlUrls(prev => {
                    prev.forEach(url => URL.revokeObjectURL(url));
                    
                    const next = new Map<string, string>();
                    data.parts.forEach((p: { id: string; buffer: ArrayBuffer }) => {
                        const blob = new Blob([p.buffer], { type: 'model/stl' });
                        next.set(p.id, URL.createObjectURL(blob));
                    });
                    return next;
                });
                setStatus('ready');
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

        globalListeners.add(handleMessage);
        globalErrorListeners.add(handleError);

        return () => {
            globalListeners.delete(handleMessage);
            globalErrorListeners.delete(handleError);
        };
    }, [terminateWorker]);

    const executeCompile = useCallback((codeToCompile: string) => {
        const worker = getWorker();
        const requestId = Date.now();
        lastRequestIdRef.current = requestId;

        setStatus('compiling');
        setEngineError(null);

        worker.postMessage({ type: 'compile', script: codeToCompile, id: requestId });
    }, [getWorker]);

    const exportModel = useCallback(async (
        format: 'stl' | 'dxf',
        dxfMode?: 'silhouette' | 'section' | 'blueprint',
        customScript?: string
    ): Promise<ArrayBuffer> => {
        terminateWorker();

        const codeToProcess = customScript || script;
        if (!codeToProcess) throw new Error('No script available to export');

        const worker = getWorker();
        const requestId = Date.now();

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
    }, [script, getWorker, terminateWorker]);

    const compileCsgTree = useCallback(async (customScript?: string): Promise<string> => {
        terminateWorker();

        const codeToProcess = customScript || script;
        if (!codeToProcess) throw new Error('No script available to compile CSG');

        const worker = getWorker();
        const requestId = Date.now();

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
    }, [script, getWorker, terminateWorker]);

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
            activeUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
        };
    }, [flushPendingRequests]);

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
        compileCsgTree,
    };
}