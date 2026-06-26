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
    }
};
