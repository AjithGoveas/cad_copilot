import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

/**
 * Robust parameter extractor for OpenSCAD scripts.
 * Looks for top-level assignments like `param = 10; // [0:100]`
 */
function extractParameters(code: string): Record<string, any> {
    const params: Record<string, any> = {};
    const lines = code.split('\n');
    
    // Regex to match: name = value; // comments
    // Matches numbers, booleans, and strings
    const paramRegex = /^([a-zA-Z0-9_]+)\s*=\s*([^;]+);/i;
    
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || !trimmed.includes('=')) continue;
        
        const match = trimmed.match(paramRegex);
        if (match) {
            const [, name, rawValue] = match;
            let val: any = rawValue.trim();
            
            // Basic type conversion
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
        const formData = await req.formData();
        const prompt = formData.get('prompt') as string;
        const model = formData.get('model') as string;
        const image = formData.get('image') as File | null;

        if (!prompt) {
            return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
        }

        // 1. Forward request to Python AI Backend
        const backendFormData = new FormData();
        backendFormData.append('prompt', prompt);
        backendFormData.append('model', model);
        if (image) {
            backendFormData.append('image', image);
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/generate`, {
            method: 'POST',
            body: backendFormData,
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`AI Engine failed: ${errorText}`);
        }

        const data = await backendRes.json();
        const cadCode = data.openscad_script || '';
        
        // 2. Extract parameters for persistence
        const parameters = extractParameters(cadCode);

        // 3. Persist session to Database
        const session = await prisma.session.create({
            data: {
                prompt,
                cadScript: cadCode,
                parameters: parameters,
            },
        });

        // 4. Return result with DB ID
        return NextResponse.json({
            id: session.id,
            code: cadCode,
            parameters: parameters,
            createdAt: session.createdAt,
        });

    } catch (err: any) {
        console.error('[API/Generate] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
