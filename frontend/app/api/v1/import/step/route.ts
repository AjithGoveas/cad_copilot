import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const authSession = await getServerSession(authOptions);
        if (!authSession || !authSession.user || !authSession.user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const formData = await req.formData();
        const file = formData.get('file') as File | null;

        if (!file) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        // Forward file to FastAPI backend
        const backendFormData = new FormData();
        backendFormData.append('file', file, file.name);

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/import/step`, {
            method: 'POST',
            body: backendFormData,
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`AI Engine failed: ${errorText}`);
        }

        const assetId = backendRes.headers.get('x-asset-id');

        const headers: Record<string, string> = {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="imported_${file.name}.stl"`,
        };
        if (assetId) {
            headers['x-asset-id'] = assetId;
            headers['Access-Control-Expose-Headers'] = 'x-asset-id';
        }

        return new Response(backendRes.body, {
            status: 200,
            headers,
        });

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
