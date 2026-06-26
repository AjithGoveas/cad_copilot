import type { CamConfig } from '../components/CamConfigModal';

export interface EditParams {
    prompt: string;
    currentCode: string;
    targetPoint: [number, number, number] | null;
    model: string;
    demoMode: boolean;
    sessionId: string | null;
}

export interface RepairParams {
    code: string;
    error: string;
    sessionId: string | null;
    model: string;
    demoMode: boolean;
}

export interface GCodeParams extends CamConfig {
    demoMode: boolean;
    csgTree?: string;
    assetId?: string | null;
}

export const workspaceApi = {
    async generateCad(prompt: string, model: string, file: File | null, demoMode: boolean) {
        const formData = new FormData();
        formData.append('prompt', prompt);
        formData.append('model', model);
        
        if (file) {
            let fileToUpload: File | Blob = file;
            let fileName = file.name;
            if (file.name.toLowerCase().endsWith('.pdf')) {
                const { rasterizePdfToPng } = await import('@/utils/pdfRasterizer');
                fileToUpload = await rasterizePdfToPng(file);
                fileName = file.name.replace(/\.pdf$/i, '.png');
            }
            formData.append('image', fileToUpload, fileName);
        }
        
        if (demoMode) {
            formData.append('demoMode', 'true');
        }

        const res = await fetch('/api/v1/generate', {
            method: 'POST',
            body: formData,
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const errorMsg = errorData?.detail?.error?.message || errorData?.detail || "Generation failed on the backend.";
            throw new Error(errorMsg);
        }

        return res.json();
    },

    async editCad(params: EditParams) {
        const res = await fetch('/api/v1/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const errorMsg = errorData?.detail?.error?.message || errorData?.detail || "Editing failed on the backend.";
            throw new Error(errorMsg);
        }

        return res.json();
    },

    async repairCad(params: RepairParams) {
        const res = await fetch('/api/v1/repair', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!res.ok) {
            throw new Error('Repair request failed');
        }

        return res.json();
    },

    async importStep(file: File, demoMode: boolean) {
        const formData = new FormData();
        formData.append('file', file);
        if (demoMode) {
            formData.append('demoMode', 'true');
        }

        const res = await fetch('/api/v1/import/step', {
            method: 'POST',
            body: formData,
            cache: 'no-store',
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Import service failed');
        }

        const assetId = res.headers.get('x-asset-id');
        const buffer = await res.arrayBuffer();
        
        return { assetId, buffer };
    },

    async teardownStep(assetId: string) {
        return fetch(`/api/v1/import/teardown/${assetId}`, { method: 'POST' }).catch((err) => {
            console.error('[workspaceApi.teardownStep] failed:', err);
        });
    },

    async exportStep(csgTree: string, demoMode: boolean) {
        const res = await fetch('/api/v1/export/step', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csgTree, demoMode }),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'STEP export service failed');
        }

        return res.arrayBuffer();
    },

    async exportGCode(params: GCodeParams) {
        const res = await fetch('/api/v1/export/gcode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error?.message || errData.error || `G-code service failed`);
        }

        return res.json();
    }
};
