import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ViewerClient from './ViewerClient';

type Props = {
	params: Promise<{
		shareToken: string;
	}>;
};

export default async function Page({ params }: Props) {
	const { shareToken } = await params;

	const session = await prisma.session.findUnique({
		where: {
			shareToken: shareToken,
		},
		include: {
			historyItems: {
				orderBy: {
					createdAt: 'asc',
				},
			},
		},
	});

	if (!session || session.historyItems.length === 0) {
		notFound();
	}

	const latestSnapshot = session.historyItems[session.historyItems.length - 1];

	return (
		<ViewerClient
			prompt={session.title}
			scadCode={latestSnapshot.openscadCode}
			parametersJson={latestSnapshot.parametersJson}
		/>
	);
}
