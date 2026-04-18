import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isSupportedUpload(upload: File): boolean {
	const mimeType = upload.type.toLowerCase();
	if (mimeType.startsWith('image/')) {
		return true;
	}

	if (mimeType === 'application/pdf') {
		return true;
	}

	return upload.name.toLowerCase().endsWith('.pdf');
}

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	return (value || 'http://127.0.0.1:8000/api/v1').replace(/\/$/, '');
}

export async function POST(request: Request): Promise<Response> {
	let formData: FormData;
	try {
		formData = await request.clone().formData();
	} catch {
		return NextResponse.json({ error: 'Request must be multipart/form-data.' }, { status: 400 });
	}

	const promptRaw = formData.get('prompt');
	const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : '';
	if (!prompt) {
		return NextResponse.json({ error: 'Missing required field: prompt' }, { status: 400 });
	}

	const upload = formData.get('image');
	if (!(upload instanceof File)) {
		return NextResponse.json({ error: 'Missing required file field: image.' }, { status: 400 });
	}

	if (!isSupportedUpload(upload)) {
		return NextResponse.json({ error: 'Uploaded file must be an image or PDF.' }, { status: 400 });
	}

	const modelRaw = formData.get('model_name');
	const modelName = typeof modelRaw === 'string' && modelRaw.trim() ? modelRaw.trim() : 'gemini-2.0-flash';
	formData.set('model_name', modelName);

	const session = await prisma.cadSession.create({
		data: {
			prompt,
		},
	});

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/generate`, {
			method: 'POST',
			body: formData,
			headers: {
				accept: 'text/event-stream',
			},
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			{
				error: 'Unable to connect to FastAPI generate endpoint.',
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 502 }
		);
	}

	if (!upstream.ok || !upstream.body) {
		const details = await upstream.text().catch(() => '');
		return NextResponse.json(
			{
				error: 'FastAPI generate endpoint failed.',
				details,
				session_id: session.id,
			},
			{ status: upstream.status || 502 }
		);
	}

	const headers = new Headers();
	headers.set('content-type', upstream.headers.get('content-type') ?? 'text/event-stream; charset=utf-8');
	headers.set('cache-control', 'no-cache, no-transform');
	headers.set('x-accel-buffering', 'no');
	headers.set('x-session-id', session.id);

	// Return the upstream ReadableStream directly so SSE chunks are not buffered.
	return new Response(upstream.body, {
		status: upstream.status,
		headers,
	});
}
