import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const plexSans = IBM_Plex_Sans({
	weight: ['300', '400', '500', '600', '700'],
	subsets: ['latin'],
	variable: '--font-sans',
});

const plexMono = IBM_Plex_Mono({
	weight: ['400', '500', '600', '700'],
	subsets: ['latin'],
	variable: '--font-mono',
});

export const metadata: Metadata = {
	title: 'CAD Copilot — Docs-to-CAD Workstation',
	description: 'AI-powered CAD generation from technical blueprints using Gemini and OpenSCAD-WASM.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`${plexSans.variable} ${plexMono.variable} dark h-full`}>
			<body className="h-full bg-[#050505] text-zinc-100 antialiased">
				{children}
				<Toaster richColors position="top-right" theme="dark" />
			</body>
		</html>
	);
}
