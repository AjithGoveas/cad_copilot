import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { csgTree, demoMode } = body;
        const isDemoMode = demoMode === true;

        if (!isDemoMode) {
            const authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        if (!csgTree) {
            return NextResponse.json({ error: 'CSG Tree is required' }, { status: 400 });
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/export-step`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ csg_tree: csgTree }),
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`AI Engine failed: ${errorText}`);
        }

        // Directly stream the python backend's response body to the client
        // This prevents the Next.js API route from OOM crashing when buffering huge STEP files
        return new Response(backendRes.body, {
            status: 200,
            headers: {
                'Content-Type': 'application/step',
                'Content-Disposition': 'attachment; filename="model.step"',
            },
        });

    } catch (err: any) {
        console.error('[API/Export/Step] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
