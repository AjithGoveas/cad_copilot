import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type Props = {
    params: Promise<{
        sessionId: string;
    }>;
};

export async function GET(req: NextRequest, { params }: Props) {
    try {
        const authSession = await getServerSession(authOptions);

        if (!authSession || !authSession.user || !authSession.user.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { sessionId } = await params;

        const session = await prisma.session.findFirst({
            where: {
                id: sessionId,
                userId: authSession.user.id,
            },
            include: {
                historyItems: {
                    orderBy: {
                        createdAt: 'asc',
                    },
                },
            },
        });

        if (!session) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        return NextResponse.json(session);
    } catch (err: any) {
        console.error('[API/History/Session] Error:', err);
        return NextResponse.json(
            { error: 'Failed to fetch session timeline' },
            { status: 500 }
        );
    }
}
