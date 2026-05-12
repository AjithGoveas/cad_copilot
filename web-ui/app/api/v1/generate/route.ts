import { type NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000';

/**
 * POST /api/v1/generate
 *
 * Next.js Route Handler that acts as a resilient proxy to the FastAPI backend.
 * Using a Route Handler instead of next.config.ts rewrites gives us:
 *  - Configurable timeout (Gemini calls can take 30-60s)
 *  - Proper error forwarding (no silent ECONNRESET to the client)
 *  - Header passthrough without the dev-proxy's hard 30s socket limit
 */
export const maxDuration = 120; // seconds — Vercel/Edge: up to 300s on Pro

export async function POST(req: NextRequest) {
	// Forward the raw multipart FormData directly to FastAPI
	const body = await req.blob();

	let backendRes: Response;
	try {
		backendRes = await fetch(`${BACKEND_URL}/api/v1/generate`, {
			method:  'POST',
			headers: {
				// Forward content-type (includes boundary for multipart)
				'content-type': req.headers.get('content-type') ?? 'application/octet-stream',
			},
			body,
			// Node 18+ fetch does not have a built-in timeout; wrap with AbortSignal
			signal: AbortSignal.timeout(110_000), // 110s — just under maxDuration
		});
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('[proxy /api/v1/generate]', msg);
		return NextResponse.json(
			{ error: { message: `Backend unreachable: ${msg}` } },
			{ status: 502 }
		);
	}

	// Relay the response body and status verbatim
	const responseBody = await backendRes.arrayBuffer();
	return new NextResponse(responseBody, {
		status:  backendRes.status,
		headers: {
			'content-type': backendRes.headers.get('content-type') ?? 'application/json',
		},
	});
}
