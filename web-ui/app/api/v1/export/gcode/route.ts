import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            csgTree,
            controller,
            safe_z,
            coolant,
            resolution,
            tools,
            operations,
            demoMode
        } = body;
        
        const isDemoMode = demoMode === true;

        if (!isDemoMode) {
            const authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        if (!csgTree) {
            return NextResponse.json({ error: 'CSG Tree is required' }, { status: 400 });
        }

        const backendRes = await fetch(`${PYTHON_BACKEND_URL}/gcode`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                csg_tree: csgTree,
                machine_configuration: {
                    controller: controller || 'fanuc',
                    safe_z: safe_z !== undefined ? Number(safe_z) : 5.0,
                    coolant_active: coolant !== undefined ? Boolean(coolant) : true,
                    resolution: resolution !== undefined ? Number(resolution) : 0.5
                },
                tool_library: (tools || []).map((t: any) => ({
                    number: Number(t.number),
                    diameter: Number(t.diameter),
                    spindle_speed: Number(t.spindle_speed),
                    feed_rate: Number(t.feed_rate),
                    plunge_rate: Number(t.plunge_rate),
                    description: t.description || 'Endmill'
                })),
                operations_pipeline: (operations || []).map((op: any) => ({
                    name: op.name,
                    strategy: op.strategy || 'profile',
                    tool_number: Number(op.tool_number),
                    cutting_depth: Number(op.cutting_depth),
                    stepdown: Number(op.stepdown),
                    units: op.units || 'metric',
                    corner_slowdown_factor: op.corner_slowdown_factor !== undefined ? Number(op.corner_slowdown_factor) : 0.5
                }))
            }),
        });

        if (!backendRes.ok) {
            const errorText = await backendRes.text();
            throw new Error(`AI Engine G-code generation failed: ${errorText}`);
        }

        const data = await backendRes.json();
        return NextResponse.json(data);

    } catch (err: any) {
        console.error('[API/Export/GCode] Error:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
