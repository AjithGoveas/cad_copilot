import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { csgTree, dxfMode, demoMode } = body;
        const isDemoMode = demoMode === true;

        if (!isDemoMode) {
            const authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        if (!csgTree) {
            return NextResponse.json({ error: 'CSG Tree reference is required' }, { status: 400 });
        }

        if (!dxfMode) {
            return NextResponse.json({ error: 'DXF mode is required' }, { status: 400 });
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/export-dxf`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                csg_tree: csgTree,
                dxf_mode: dxfMode
            }),
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            return NextResponse.json(
                { error: `AI Engine failed: ${errorText}` },
                { status: backendRes.status }
            );
        }

        return new Response(backendRes.body, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="model_${dxfMode}.dxf"`,
            },
        });

    } catch (err: any) {
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
