import { useState, useCallback, useRef, useEffect } from 'react';
import { camApi } from '../api/camApi';
import { toast } from 'sonner';

type Config = {
    isDemoMode: boolean;
};

export function useStepCAM({ isDemoMode }: Config) {
    const [importedStlUrl, setImportedStlUrl] = useState<string | null>(null);
    const [isImported, setIsImported] = useState(false);
    const [geometrySource, setGeometrySource] = useState<'openscad' | 'step' | 'stl'>('openscad');
    const [sourceAssetId, setSourceAssetId] = useState<string | null>(null);
    const [isGeneratingGCode, setIsGeneratingGCode] = useState(false);

    // Stable refs so handleClearImport never gets a new reference on import
    const importedStlUrlRef = useRef<string | null>(null);
    const sourceAssetIdRef = useRef<string | null>(null);
    importedStlUrlRef.current = importedStlUrl;
    sourceAssetIdRef.current = sourceAssetId;

    // Cleanup assets on unmount
    useEffect(() => {
        return () => {
            if (importedStlUrlRef.current) {
                URL.revokeObjectURL(importedStlUrlRef.current);
            }
            if (sourceAssetIdRef.current) {
                camApi.teardownStep(sourceAssetIdRef.current);
            }
        };
    }, []);

    // Stable reference — reads current values via refs, never re-creates
    const handleClearImport = useCallback(() => {
        if (sourceAssetIdRef.current) {
            camApi.teardownStep(sourceAssetIdRef.current);
        }
        if (importedStlUrlRef.current) {
            URL.revokeObjectURL(importedStlUrlRef.current);
        }
        setImportedStlUrl(null);
        setIsImported(false);
        setGeometrySource('openscad');
        setSourceAssetId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // intentionally empty — reads via refs

    const handleImportStep = useCallback(async (file: File) => {
        const importPromise = (async () => {
            if (sourceAssetId) {
                camApi.teardownStep(sourceAssetId);
            }

            const { assetId, buffer } = await camApi.importStep(file, isDemoMode);
            if (assetId) {
                setSourceAssetId(assetId);
                setGeometrySource('step');
            }

            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            
            setImportedStlUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
            setIsImported(true);
        })();

        toast.promise(importPromise, {
            loading: 'Uploading and parsing STEP model…',
            success: 'STEP model imported successfully!',
            error: (err) => `STEP Import Failed: ${err.message || err}`,
        });
    }, [isDemoMode, sourceAssetId]);

    const handleImportStl = useCallback(async (file: File) => {
        const importPromise = (async () => {
            if (sourceAssetId) {
                camApi.teardownStep(sourceAssetId);
            }

            const { assetId, buffer } = await camApi.importStl(file, isDemoMode);
            if (assetId) {
                setSourceAssetId(assetId);
                setGeometrySource('stl');
            }

            const blob = new Blob([buffer], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            
            setImportedStlUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return url;
            });
            setIsImported(true);
        })();

        toast.promise(importPromise, {
            loading: 'Uploading and parsing STL model…',
            success: 'STL model imported successfully!',
            error: (err) => `STL Import Failed: ${err.message || err}`,
        });
    }, [isDemoMode, sourceAssetId]);

    /** Unified import handler — routes STL files locally, STEP/STP files via backend. */
    const handleImport = useCallback(async (file: File) => {
        const ext = file.name.split('.').pop()?.toLowerCase();

        if (ext === 'stl') {
            await handleImportStl(file);
            return;
        }

        // STEP / STP: convert via backend
        await handleImportStep(file);
    }, [handleImportStep, handleImportStl]);

    const handleExportStep = useCallback(async (compileCsgTree: () => Promise<string>) => {
        if (isDemoMode) {
            toast.error('Exporting STEP is disabled in demo mode.');
            return;
        }

        const run = async () => {
            let buffer: ArrayBuffer;

            if (geometrySource === 'step' || geometrySource === 'stl') {
                if (!sourceAssetId) throw new Error(`No active ${geometrySource.toUpperCase()} file imported`);
                const csgTree = JSON.stringify({ type: 'step_reference', asset_id: sourceAssetId });
                buffer = await camApi.exportStep(csgTree, isDemoMode);
            } else {
                const csgTree = await compileCsgTree();
                buffer = await camApi.exportStep(csgTree, isDemoMode);
            }

            const blob = new Blob([buffer], { type: 'application/step' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `generated_model.step`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        await toast.promise(run(), {
            loading: 'Exporting STEP model…',
            success: 'STEP Exported Successfully',
            error: (err) => `STEP Export Failed: ${err.message || err}`,
        });
    }, [geometrySource, sourceAssetId, isDemoMode]);

    const handleGenerateGCode = useCallback(async (config: any, compileCsgTree: () => Promise<string>) => {
        setIsGeneratingGCode(true);
        const controllerLabel = config.controller.toUpperCase();

        const run = async () => {
            let csgTree: string | undefined;
            let assetId: string | null = null;

            if (geometrySource === 'step') {
                assetId = sourceAssetId;
            } else {
                csgTree = await compileCsgTree();
            }

            const data = await camApi.exportGCode({
                ...config,
                demoMode: isDemoMode,
                csgTree,
                assetId,
            });

            const gcodeText = data.gcode;
            if (!gcodeText) {
                throw new Error("No G-code content returned from server.");
            }

            const blob = new Blob([gcodeText], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);

            const a = document.createElement('a');
            a.href = url;
            a.download = `generated_model_${config.controller}.gcode`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };

        try {
            await toast.promise(run(), {
                loading: `Generating ${controllerLabel} G-code…`,
                success: `${controllerLabel} G-code Generated Successfully`,
                error: (err) => `G-code Export Failed: ${err.message || err}`,
            });
        } finally {
            setIsGeneratingGCode(false);
        }
    }, [geometrySource, sourceAssetId, isDemoMode]);

    return {
        importedStlUrl,
        isImported,
        geometrySource,
        sourceAssetId,
        isGeneratingGCode,
        handleClearImport,
        handleImport,
        handleImportStep,
        handleExportStep,
        handleGenerateGCode,
    };
}
