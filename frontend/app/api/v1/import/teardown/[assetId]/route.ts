import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ assetId: string }> }
) {
    try {
        const authSession = await getServerSession(authOptions);
        if (!authSession || !authSession.user || !authSession.user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { assetId } = await params;
        if (!assetId) {
            return NextResponse.json({ error: 'Asset ID is required' }, { status: 400 });
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/import/teardown/${assetId}`, {
            method: 'POST',
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`AI Engine failed: ${errorText}`);
        }

        const data = await backendRes.json();
        return NextResponse.json(data);

    } catch (err: any) {
        console.error('[API/Import/Teardown] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
