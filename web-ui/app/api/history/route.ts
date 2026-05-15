import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Fetches the 20 most recent CAD sessions from the database.
 */
export async function GET() {
    try {
        const sessions = await prisma.session.findMany({
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
