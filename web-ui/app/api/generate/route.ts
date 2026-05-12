import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ErrorPayload = {
	error: {
		message: string;
		hint?: string;
	};
	session_id?: string;
};

function buildError(message: string, hint?: string, sessionId?: string): ErrorPayload {
	const payload: ErrorPayload = {
		error: {
			message,
		},
	};

	if (hint) {
		payload.error.hint = hint;
	}

	if (sessionId) {
		payload.session_id = sessionId;
	}

	return payload;
}

function extractErrorFromUnknown(input: unknown, fallback: string): { message: string; hint?: string } {
	if (input && typeof input === 'object') {
		const candidate = input as {
			error?: { message?: unknown; hint?: unknown };
			detail?: unknown;
			message?: unknown;
		};

		if (candidate.error && typeof candidate.error === 'object') {
			const message = typeof candidate.error.message === 'string' ? candidate.error.message : fallback;
			const hint = typeof candidate.error.hint === 'string' ? candidate.error.hint : undefined;
			return { message, hint };
		}

		if (typeof candidate.message === 'string' && candidate.message.trim()) {
			return { message: candidate.message.trim() };
		}

		if (typeof candidate.detail === 'string' && candidate.detail.trim()) {
			return { message: candidate.detail.trim() };
		}
	}

	if (typeof input === 'string' && input.trim()) {
		return { message: input.trim() };
	}

	return { message: fallback };
}

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
		return NextResponse.json(buildError('Request must be multipart/form-data.'), { status: 400 });
	}

	const promptRaw = formData.get('prompt');
	const prompt = typeof promptRaw === 'string' ? promptRaw.trim() : '';
	if (!prompt) {
		return NextResponse.json(buildError('Prompt is required.'), { status: 400 });
	}

	const upload = formData.get('image');
	if (!(upload instanceof File)) {
		return NextResponse.json(buildError('Image or PDF file is required.'), { status: 400 });
	}

	if (!isSupportedUpload(upload)) {
		return NextResponse.json(buildError('Uploaded file must be an image or PDF.'), { status: 400 });
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
				accept: 'application/json',
			},
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			buildError(
				'Unable to connect to AI engine.',
				error instanceof Error ? error.message : undefined,
				session.id
			),
			{ status: 502 }
		);
	}

	const upstreamPayload = await upstream.json().catch(() => null);
	if (!upstream.ok || !upstreamPayload || typeof upstreamPayload !== 'object') {
		const extracted = extractErrorFromUnknown(upstreamPayload, 'AI engine failed to generate script.');
		return NextResponse.json(buildError(extracted.message, extracted.hint, session.id), {
			status: upstream.status || 502,
		});
	}

	const normalized = {
		...upstreamPayload,
		session_id: session.id,
	};

	const headers = new Headers();
	headers.set('x-session-id', session.id);

	return NextResponse.json(normalized, {
		status: upstream.status,
		headers,
	});
}
