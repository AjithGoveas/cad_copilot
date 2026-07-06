import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import ViewerClient from './ViewerClient';
import { reconstructHistory } from '@/utils/history';

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

	const reconstructedItems = reconstructHistory(session.historyItems);
	const latestSnapshot = reconstructedItems[reconstructedItems.length - 1];

	return (
		<ViewerClient
			prompt={session.title}
			scadCode={latestSnapshot.openscadCode}
			parametersJson={latestSnapshot.parametersJson}
		/>
	);
}
