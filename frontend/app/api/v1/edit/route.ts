import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPatch } from 'diff';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

function extractParameters(code: string): Record<string, any> {
    const params: Record<string, any> = {};
    const lines = code.split('\n');
    const paramRegex = /^([a-zA-Z0-9_]+)\s*=\s*([^;]+);/i;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || !trimmed.includes('=')) continue;

        const match = trimmed.match(paramRegex);
        if (match) {
            const [, name, rawValue] = match;
            let val: any = rawValue.trim();

            if (val.toLowerCase() === 'true') val = true;
            else if (val.toLowerCase() === 'false') val = false;
            else if (!isNaN(Number(val))) val = Number(val);
            else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);

            params[name] = val;
        }
    }
    return params;
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { prompt, currentCode, targetPoint, model, demoMode, sessionId } = body;
        const isDemoMode = demoMode === true;

        let authSession = null;
        if (!isDemoMode) {
            authSession = await getServerSession(authOptions);
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

        // Extract parameters for database snapshot caching
        const parameters = extractParameters(cadCode);

        // Persist history item if authenticated and in session
        if (!isDemoMode && authSession?.user?.id && sessionId) {
            const delta = createPatch('script.scad', currentCode, cadCode);
            await prisma.historyItem.create({
                data: {
                    sessionId,
                    actionType: 'EDIT',
                    prompt,
                    patchDelta: delta,
                    isFullSnapshot: false,
                    parametersJson: parameters,
                    targetPoint: targetPoint || [],
                },
            });
        }

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
