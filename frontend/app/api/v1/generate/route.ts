import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getModelById } from '@/lib/models-registry';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

/**
 * Robust parameter extractor for OpenSCAD scripts.
 * Looks for top-level assignments like `param = 10; // [0:100]`
 */
function extractParameters(code: string): Record<string, any> {
    const params: Record<string, any> = {};
    const lines = code.split('\n');

    // Regex to match: name = value; // optional comment (possibly containing ranges)
    const paramRegex = /^([a-zA-Z0-9_]+)\s*=\s*([^;]+);\s*(?:\/\/\s*(.*))?/i;

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || !trimmed.includes('=')) continue;

        const match = trimmed.match(paramRegex);
        if (match) {
            const [, name, rawValue, comment] = match;
            let val: any = rawValue.trim();

            // Basic type conversion
            if (val.toLowerCase() === 'true') val = true;
            else if (val.toLowerCase() === 'false') val = false;
            else if (!isNaN(Number(val))) val = Number(val);
            else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);

            // Parse comment for rich parameter details
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
        const formData = await req.formData();
        const isDemoMode = formData.get('demoMode') === 'true';

        let authSession = null;
        if (!isDemoMode) {
            authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        const prompt = formData.get('prompt') as string;
        const model = formData.get('model') as string;
        const image = formData.get('image') as File | null;

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
        }

        // 1. Forward request to Python AI Backend
        const activeModelMetadata = getModelById(model) || getModelById('gemini-3.5-flash');
        if (!activeModelMetadata) {
            return NextResponse.json({ error: 'Selected model not found' }, { status: 400 });
        }

        let fallbackModelMetadata = null;
        if (activeModelMetadata.fallbackModelId) {
            fallbackModelMetadata = getModelById(activeModelMetadata.fallbackModelId) || null;
        }

        const backendFormData = new FormData();
        backendFormData.append('prompt', prompt);
        backendFormData.append('model_metadata', JSON.stringify(activeModelMetadata));
        if (fallbackModelMetadata) {
            backendFormData.append('fallback_metadata', JSON.stringify(fallbackModelMetadata));
        }
        if (image) {
            backendFormData.append('image', image, image.name);
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/generate`, {
            method: 'POST',
            body: backendFormData,
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            console.error(`[API/Generate] AI Backend failed with status ${backendRes.status}:`, errorText);
            throw new Error('AI Engine failed to generate OpenSCAD script. Please try again.');
        }

        const data = await backendRes.json();
        const cadCode = data.openscad_script || '';

        // 2. Extract parameters for persistence
        const parameters = extractParameters(cadCode);

        // 3. Persist project to Database (skip if demo mode)
        let projectId = 'demo-project';
        let shareToken = 'demo-token';
        let createdAt = new Date().toISOString();

        if (!isDemoMode && authSession?.user?.id) {
            const session = await prisma.session.create({
                data: {
                    userId: authSession.user.id,
                    title: prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt,
                    historyItems: {
                        create: {
                            actionType: 'GENERATE',
                            prompt,
                            openscadCode: cadCode,
                            isFullSnapshot: true,
                            parametersJson: parameters,
                            metaData: image ? { attachment: { name: image.name } } : undefined,
                        },
                    },
                },
            });
            projectId = session.id;
            shareToken = session.shareToken;
            createdAt = session.createdAt.toISOString();
        }

        // 4. Return result
        return NextResponse.json({
            id: projectId,
            shareToken: shareToken,
            code: cadCode,
            parameters: parameters,
            createdAt: createdAt,
        });

    } catch (err: any) {
        console.error('[API/Generate] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
