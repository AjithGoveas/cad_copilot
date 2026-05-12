import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
	// API calls are now handled by app/api/v1/generate/route.ts (Route Handler)
	// which properly controls timeout and error forwarding.
	// No rewrites needed.
};

export default nextConfig;
