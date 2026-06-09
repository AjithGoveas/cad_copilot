import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { prompt, currentCode, targetPoint, model, demoMode } = body;
        const isDemoMode = demoMode === true;

        if (!isDemoMode) {
            const authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
        }

        if (!currentCode) {
            return NextResponse.json({ error: 'Current code is required' }, { status: 400 });
        }

        // Map camelCase fields to FastAPI Pydantic snake_case fields
        const payload = {
            prompt,
            current_code: currentCode,
            target_point: targetPoint || null,
            model: model || undefined,
        };

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/edit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`AI Engine failed: ${errorText}`);
        }

        const data = await backendRes.json();
        const cadCode = data.openscad_script || '';

        return NextResponse.json({
            code: cadCode,
        });

    } catch (err: any) {
        console.error('[API/Edit] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
