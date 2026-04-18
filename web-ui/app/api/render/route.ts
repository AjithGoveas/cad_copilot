import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type LegacyRenderPayload = {
	script?: unknown;
	python_script?: unknown;
	parameters?: unknown;
	output_basename?: unknown;
	session_id?: unknown;
};

type FastApiRenderRequest = {
	python_script: string;
	parameters: Record<string, unknown>;
	session_id: string;
};

function getFastApiUrl(): string {
	const value = process.env.FASTAPI_URL?.trim();
	if (!value) {
		throw new Error('FASTAPI_URL is not configured');
	}
	return value.replace(/\/$/, '');
}

function toSessionId(outputBasename: string): string {
	const trimmed = outputBasename.trim();
	if (!trimmed) {
		return crypto.randomUUID();
	}

	return trimmed.startsWith('cad_') ? trimmed.slice(4) : trimmed;
}

function toFastApiRenderRequest(value: unknown): FastApiRenderRequest | null {
	if (!value || typeof value !== 'object') {
		return null;
	}

	const body = value as LegacyRenderPayload;
	const pythonScriptSource =
		typeof body.python_script === 'string' && body.python_script.trim()
			? body.python_script
			: typeof body.script === 'string' && body.script.trim()
				? body.script
				: null;

	if (!pythonScriptSource) {
		return null;
	}

	if (!body.parameters || typeof body.parameters !== 'object' || Array.isArray(body.parameters)) {
		return null;
	}

	const sessionSource =
		typeof body.session_id === 'string' && body.session_id.trim()
			? body.session_id
			: typeof body.output_basename === 'string' && body.output_basename.trim()
				? toSessionId(body.output_basename)
				: crypto.randomUUID();

	return {
		python_script: pythonScriptSource,
		parameters: body.parameters as Record<string, unknown>,
		session_id: sessionSource,
	};
}

export async function POST(request: Request): Promise<Response> {
	const body = await request.json().catch(() => null);
	const mappedPayload = toFastApiRenderRequest(body);
	if (!mappedPayload) {
		return NextResponse.json(
			{
				error: 'Request body must include script or python_script, a parameters object, and session_id/output_basename (or it will be generated).',
			},
			{ status: 400 }
		);
	}

	let upstream: Response;
	try {
		upstream = await fetch(`${getFastApiUrl()}/render`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json',
			},
			// Forward only strict FastAPI schema fields.
			body: JSON.stringify(mappedPayload),
			cache: 'no-store',
		});
	} catch (error) {
		return NextResponse.json(
			{
				error: 'Unable to connect to FastAPI render endpoint.',
				details: error instanceof Error ? error.message : String(error),
			},
			{ status: 502 }
		);
	}

	const upstreamData = await upstream.json().catch(() => null);
	if (!upstream.ok || !upstreamData || typeof upstreamData !== 'object') {
		return NextResponse.json(
			{
				error: 'FastAPI render endpoint failed.',
				details: upstreamData,
			},
			{ status: upstream.status || 502 }
		);
	}

	const data = upstreamData as Record<string, unknown>;
	const artifacts =
		data.artifacts && typeof data.artifacts === 'object' ? (data.artifacts as Record<string, unknown>) : null;
	const parametersJson = mappedPayload.parameters as Prisma.InputJsonValue;
	const stlUrl =
		typeof data.stl_url === 'string'
			? data.stl_url
			: artifacts && typeof artifacts.stl_url === 'string'
				? artifacts.stl_url
				: null;
	const stepUrl =
		typeof data.step_url === 'string'
			? data.step_url
			: artifacts && typeof artifacts.step_url === 'string'
				? artifacts.step_url
				: null;

	const updateResult = await prisma.cadSession.updateMany({
		where: { id: mappedPayload.session_id },
		data: {
			pythonScript: mappedPayload.python_script,
			parameters: parametersJson,
			stlUrl,
			stepUrl,
		},
	});

	if (updateResult.count === 0) {
		await prisma.cadSession.create({
			data: {
				id: mappedPayload.session_id,
				prompt: 'render-only-session',
				pythonScript: mappedPayload.python_script,
				parameters: parametersJson,
				stlUrl,
				stepUrl,
			},
		});
	}

	const normalizedResponse = {
		...data,
		stl_url: stlUrl,
		step_url: stepUrl,
	};

	return NextResponse.json(normalizedResponse, {
		status: upstream.status,
	});
}
