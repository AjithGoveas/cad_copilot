import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ViewerClient from './ViewerClient';

type Props = {
	params: Promise<{
		sessionId: string;
	}>;
};

export default async function Page({ params }: Props) {
	const { sessionId } = await params;

	const project = await prisma.project.findUnique({
		where: {
			id: sessionId,
		},
	});

	if (!project || !project.scadCode) {
		notFound();
	}

	return (
		<ViewerClient
			prompt={project.prompt}
			scadCode={project.scadCode}
			parametersJson={project.parametersJson}
		/>
	);
}
