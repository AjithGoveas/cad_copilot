import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const material = searchParams.get('material');
        const diameter = searchParams.get('diameter');

        if (!material || !diameter) {
            return NextResponse.json({ error: 'material and diameter parameters are required' }, { status: 400 });
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/material-defaults?material=${encodeURIComponent(material)}&diameter=${encodeURIComponent(diameter)}`, {
            method: 'GET',
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`Failed to fetch material defaults: ${errorText}`);
        }

        const data = await backendRes.json();
        return NextResponse.json(data);

    } catch (err: any) {
        console.error('[API/MaterialDefaults] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
