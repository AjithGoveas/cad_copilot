import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPatch } from 'diff';
import { getModelById } from '@/lib/models-registry';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

function extractParameters(code: string): Record<string, any> {
    const params: Record<string, any> = {};
    const lines = code.split('\n');
    const paramRegex = /^([a-zA-Z0-9_]+)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?/i;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || !trimmed.includes('=')) continue;

        const match = trimmed.match(paramRegex);
        if (match) {
            const [, name, rawValue, comment] = match;
            let val: any = rawValue.trim();

            if (val.toLowerCase() === 'true') val = true;
            else if (val.toLowerCase() === 'false') val = false;
            else if (!isNaN(Number(val))) val = Number(val);
            else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);

            let min: number | undefined;
            let max: number | undefined;
            let step: number | undefined;
            let label: string | undefined;
            let unit: string | undefined;
            let rawComment: string | undefined = comment ? comment.trim() : undefined;

            if (comment) {
                const commentTrimmed = comment.trim();
                const rangeMatch = /\[\s*(-?\d+(?:\.\d+)?)\s*:\s*(?:(-?\d+(?:\.\d+)?)\s*:\s*)?(-?\d+(?:\.\d+)?)\s*\]/.exec(commentTrimmed);
                if (rangeMatch) {
                    const firstVal = parseFloat(rangeMatch[1]);
                    const secondVal = rangeMatch[2] ? parseFloat(rangeMatch[2]) : undefined;
                    const thirdVal = parseFloat(rangeMatch[3]);

                    if (secondVal !== undefined) {
                        min = firstVal;
                        step = secondVal;
                        max = thirdVal;
                    } else {
                        min = firstVal;
                        max = thirdVal;
                    }

                    let remaining = commentTrimmed.replace(rangeMatch[0], '').trim();
                    if (remaining) {
                        label = remaining;
                        const unitMatch = /\(([^)]+)\)$/.exec(remaining);
                        if (unitMatch) {
                            unit = unitMatch[1];
                            label = remaining.replace(unitMatch[0], '').trim();
                        }
                    }
                } else if (commentTrimmed) {
                    label = commentTrimmed;
                }
            }

            if (min !== undefined || max !== undefined || label !== undefined || rawComment !== undefined) {
                params[name] = {
                    value: val,
                    min,
                    max,
                    step,
                    label,
                    unit,
                    rawComment
                };
            } else {
                params[name] = val;
            }
        }
    }
    return params;
}

export const maxDuration = 300;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { code, error, sessionId, model, demoMode } = body;
        const isDemoMode = demoMode === true;

        let authSession = null;
        if (!isDemoMode) {
            authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        if (!code) {
            return NextResponse.json({ error: 'Code is required' }, { status: 400 });
        }
        if (!error) {
            return NextResponse.json({ error: 'Error details are required' }, { status: 400 });
        }

        const activeModelMetadata = getModelById(model) || getModelById('gemini-3.5-flash');
        if (!activeModelMetadata) {
            return NextResponse.json({ error: 'Selected model not found' }, { status: 400 });
        }

        let fallbackModelMetadata = null;
        if (activeModelMetadata.fallbackModelId) {
            fallbackModelMetadata = getModelById(activeModelMetadata.fallbackModelId) || null;
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/repair`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                code,
                error,
                model_metadata: activeModelMetadata,
                fallback_metadata: fallbackModelMetadata,
            }),
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            console.error(`[API/Repair] AI Backend failed with status ${backendRes.status}:`, errorText);
            throw new Error('AI Engine failed to repair OpenSCAD script.');
        }

        const data = await backendRes.json();
        const repairedCode = data.openscad_script || '';
        const parameters = extractParameters(repairedCode);

        if (!isDemoMode && authSession?.user?.id && sessionId) {
            const delta = createPatch('script.scad', code, repairedCode);
            await prisma.historyItem.create({
                data: {
                    sessionId,
                    actionType: 'EDIT',
                    prompt: `WASM Auto-Repair: ${error.slice(0, 150)}`,
                    patchDelta: delta,
                    isFullSnapshot: false,
                    parametersJson: parameters,
                    targetPoint: [],
                },
            });
        }

        return NextResponse.json({
            code: repairedCode,
        });

    } catch (err: any) {
        console.error('[API/Repair] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
