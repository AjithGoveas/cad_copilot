import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Fetches the 20 most recent CAD sessions for the authenticated user.
 */
export async function GET() {
    try {
        const session = await getServerSession(authOptions);

        if (!session || !session.user || !session.user.id) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        const sessions = await prisma.session.findMany({
            where: {
                userId: session.user.id,
            },
            take: 20,
            orderBy: {
                createdAt: 'desc',
            },
        });

        return NextResponse.json(sessions);
    } catch (err: any) {
        console.error('[API/History] Error:', err);
        return NextResponse.json(
            { error: 'Failed to fetch history' },
            { status: 500 }
        );
    }
}
