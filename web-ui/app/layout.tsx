import { Toaster } from '@/components/ui/sonner';
import type { Metadata } from 'next';
import { IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const ibmPlexMono = IBM_Plex_Mono({
	weight: ['400', '500', '600', '700'],
	variable: '--font-ibm-plex-mono',
	subsets: ['latin'],
});

export const metadata: Metadata = {
	title: 'Docs-to-CAD Tactical Workspace',
	description: 'Generate and refine CAD from documents with HITL controls.',
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" className={`${ibmPlexMono.variable} h-full antialiased`}>
			<body className={`${ibmPlexMono.className} min-h-full flex flex-col`}>
				{children}
				<Toaster richColors position="top-right" />
			</body>
		</html>
	);
}
