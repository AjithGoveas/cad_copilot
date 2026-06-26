import type { CamConfig } from '../types/cam';

export interface GCodeParams extends CamConfig {
    demoMode: boolean;
    csgTree?: string;
    assetId?: string | null;
}

export const camApi = {
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

    async importStl(file: File, demoMode: boolean) {
        const formData = new FormData();
        formData.append('file', file);
        if (demoMode) {
            formData.append('demoMode', 'true');
        }

        const res = await fetch('/api/v1/import/stl', {
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
            console.error('[camApi.teardownStep] failed:', err);
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
