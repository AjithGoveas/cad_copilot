import { NextRequest, NextResponse } from 'next/server';

// Fallback to localhost:8000 if your env variables aren't set
const BACKEND_URL = process.env.API_URL || process.env.BACKEND_URL || 'http://127.0.0.1:8000';

export async function POST(req: NextRequest) {
    try {
        // 1. Grab the raw CSG math from the browser
        const csgBuffer = await req.arrayBuffer();

        // 2. Forward it directly to your Python FastAPI backend
        const response = await fetch(`${BACKEND_URL}/api/v1/export/step`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
            },
            body: csgBuffer,
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[Next.js Proxy] FastAPI Error:', errText);
            return NextResponse.json({ error: `Python Backend failed: ${response.statusText}` }, { status: response.status });
        }

        // 3. Grab the generated STEP file from Python
        const stepBuffer = await response.arrayBuffer();

        // 4. Stream it back to the browser
        return new NextResponse(stepBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
            },
        });
    } catch (error) {
        console.error('[Next.js Proxy] Network Error:', error);
        return NextResponse.json({ error: 'Failed to reach Python backend' }, { status: 500 });
    }
}