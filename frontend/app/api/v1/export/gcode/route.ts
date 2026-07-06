import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';

const PYTHON_BACKEND_URL = process.env.FASTAPI_URL;

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const {
            csgTree,
            assetId,
            controller,
            safe_z,
            coolant,
            resolution,
            tools,
            operations,
            demoMode,
            stock_configuration
        } = body;
        
        const isDemoMode = demoMode === true;

        if (!isDemoMode) {
            const authSession = await getServerSession(authOptions);
            if (!authSession || !authSession.user || !authSession.user.id) {
                return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
            }
        }

        if (!csgTree && !assetId) {
            return NextResponse.json({ error: 'CSG Tree or Asset ID is required' }, { status: 400 });
        }

        // 1. Build the job_request object matching the backend schemas
        const jobRequest = {
            csg_tree: assetId ? JSON.stringify({ type: 'step_reference', asset_id: assetId }) : (csgTree || null),
            step_file_path: assetId || null,
            machine_configuration: {
                controller: controller || 'fanuc',
                safe_z: safe_z !== undefined ? Number(safe_z) : 5.0,
                coolant_active: coolant !== undefined ? Boolean(coolant) : true,
                resolution: resolution !== undefined ? Number(resolution) : 0.5
            },
            stock_configuration: stock_configuration || {
                stock_type: 'block',
                length_x: null,
                width_y: null,
                height_z: null,
                outer_diameter: null,
                inner_diameter: 0.0,
                length_z: null
            },
            tool_library: (tools || []).map((t: any) => ({
                number: Number(t.number),
                type: t.type || 'endmill',
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
                corner_slowdown: op.corner_slowdown !== undefined ? Number(op.corner_slowdown) : 0.5
            }))
        };

        // 2. Send to FastAPI backend
        if (assetId) {
            // Forward as JSON directly when using a cached STEP reference
            const backendRes = await fetch(`${PYTHON_BACKEND_URL}/gcode`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(jobRequest)
            });

            if (!backendRes.ok) {
                const errorText = await backendRes.text();
                console.error(`[API/Export/GCode] Backend failed with status ${backendRes.status}:`, errorText);
                return NextResponse.json(
                    { error: `AI Engine G-code generation failed: ${errorText}` },
                    { status: backendRes.status }
                );
            }

            const data = await backendRes.json();
            return NextResponse.json(data);
        } else {
            // Legacy multipart path for OpenSCAD compiled CSG
            const formData = new FormData();
            const fileBlob = new Blob([csgTree], { type: 'text/plain' });
            formData.append('file', fileBlob, 'part.csg');
            formData.append('job_request', JSON.stringify(jobRequest));

            const backendRes = await fetch(`${PYTHON_BACKEND_URL}/gcode`, {
                method: 'POST',
                body: formData
            });

            if (!backendRes.ok) {
                const errorText = await backendRes.text();
                console.error(`[API/Export/GCode] Backend failed with status ${backendRes.status}:`, errorText);
                return NextResponse.json(
                    { error: `AI Engine G-code generation failed: ${errorText}` },
                    { status: backendRes.status }
                );
            }

            const data = await backendRes.json();
            return NextResponse.json(data);
        }

    } catch (err: any) {
        console.error('[API/Export/GCode] Exception:', err);
        return NextResponse.json(
            { error: err.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
