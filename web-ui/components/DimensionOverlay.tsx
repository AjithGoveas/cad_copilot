'use client';

import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { Vector3, Quaternion, Euler } from 'three';
import { MoveVertical, Circle, Scaling } from 'lucide-react';

type AnnotationEntry = {
    type?: 'diameter' | 'height' | 'chamfer';
    p1?: [number, number, number];
    p2?: [number, number, number];
    center?: [number, number, number];
    axis?: [number, number, number];
    value?: number;
    offset?: number;
    radius?: number;
};

type DimensionOverlayProps = {
    annotations: Record<string, AnnotationEntry>;
    activeParameter: string | null;
    geometryScale: number;
    geometryCenter: [number, number, number];
    onSelectParameter?: (key: string | null) => void;
    onHoverParameter?: (key: string | null) => void;
};

type DimensionProps = {
    label: string;
    annotation: AnnotationEntry;
    scale: number;
    center: [number, number, number];
    isActive: boolean;
    hasAnyActive: boolean;
    onClick?: () => void;
    onHover?: (hovered: boolean) => void;
};

// --- Math Helpers ---
const transformCoords = (pt: [number, number, number], center: [number, number, number], scale: number): Vector3 => {
    return new Vector3(
        (pt[0] - center[0]) * scale,
        (pt[1] - center[1]) * scale,
        (pt[2] - center[2]) * scale
    );
};

const getAlignmentQuaternion = (dir: Vector3) => {
    const up = new Vector3(0, 1, 0);
    const axis = new Vector3().crossVectors(up, dir).normalize();
    const radians = Math.acos(up.dot(dir));
    return new Quaternion().setFromAxisAngle(axis, radians);
};

// --- Shared UI Components ---
const DimensionLabel = ({ label, value, unit, icon: Icon, isActive, hasAnyActive, color, onClick }: any) => {
    const opacity = isActive ? 1 : hasAnyActive ? 0.2 : 0.85;
    
    return (
        <div
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            className="group"
            style={{
                background: isActive ? 'rgba(24, 24, 27, 0.95)' : 'rgba(24, 24, 27, 0.65)',
                border: `1px solid ${isActive ? color : 'rgba(63, 63, 70, 0.4)'}`,
                borderRadius: '8px',
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                backdropFilter: 'blur(8px)',
                boxShadow: isActive ? `0 0 20px ${color}40, 0 4px 12px rgba(0,0,0,0.5)` : '0 4px 12px rgba(0,0,0,0.3)',
                transform: isActive ? 'translate(-50%, -50%) scale(1.05)' : 'translate(-50%, -50%) scale(1)',
                transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                pointerEvents: 'auto',
                opacity: opacity,
            }}
        >
            <Icon size={12} color={isActive ? color : '#a1a1aa'} />
            <span style={{ color: isActive ? color : '#a1a1aa', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', fontFamily: 'system-ui, sans-serif' }}>
                {label.replace(/_/g, ' ')}
            </span>
            <div style={{ width: '1px', height: '12px', background: 'rgba(82, 82, 91, 0.6)' }} />
            <span style={{ color: '#f4f4f5', fontSize: '12px', fontWeight: 700, fontFamily: 'monospace' }}>
                {value} <span style={{ color: '#a1a1aa', fontSize: '10px' }}>{unit}</span>
            </span>
        </div>
    );
};

// --- 3D Dimension Components ---

function HeightDimension({ label, annotation, scale, center, isActive, hasAnyActive, onClick, onHover }: DimensionProps) {
    if (!isActive) return null;
    const p1 = annotation.p1 || [0, 0, 0];
    const p2 = annotation.p2 || [0, 0, 0];

    const { transformedP1, transformedP2, midpoint, realDistance, dir, quatP1, quatP2 } = useMemo(() => {
        const tP1 = transformCoords(p1, center, scale);
        const tP2 = transformCoords(p2, center, scale);
        const mid = new Vector3().addVectors(tP1, tP2).multiplyScalar(0.5);
        const dist = new Vector3(...p1).distanceTo(new Vector3(...p2));
        
        const direction = new Vector3().subVectors(tP2, tP1).normalize();
        
        // Quaternions to point cones outward
        const qP1 = getAlignmentQuaternion(direction.clone().negate());
        const qP2 = getAlignmentQuaternion(direction);

        return { transformedP1: tP1, transformedP2: tP2, midpoint: mid, realDistance: dist, dir: direction, quatP1: qP1, quatP2: qP2 };
    }, [p1, p2, center, scale]);

    const color = isActive ? '#60a5fa' : '#3b82f6';
    const opacity = isActive ? 1 : hasAnyActive ? 0.15 : 0.6;
    const arrowSize = isActive ? 0.08 : 0.05;

    return (
        <group>
            {/* Main Line */}
            <Line points={[transformedP1, transformedP2]} color={color} lineWidth={isActive ? 3 : 1.5} transparent opacity={opacity} depthTest={false} />
            
            {/* End Arrows */}
            <mesh position={transformedP1} quaternion={quatP1}>
                <coneGeometry args={[arrowSize * 0.4, arrowSize, 16]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
            </mesh>
            <mesh position={transformedP2} quaternion={quatP2}>
                <coneGeometry args={[arrowSize * 0.4, arrowSize, 16]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
            </mesh>

            {/* Interaction Hitbox */}
            <mesh 
                position={midpoint}
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
                onPointerOut={() => onHover?.(false)}
                visible={false}
            >
                <cylinderGeometry args={[0.2, 0.2, realDistance * scale, 8]} />
            </mesh>
            
            {/* Label */}
            <Html position={midpoint} zIndexRange={[100, 0]}>
                <DimensionLabel label={label} value={realDistance.toFixed(2)} unit="mm" icon={MoveVertical} isActive={isActive} hasAnyActive={hasAnyActive} color="#60a5fa" onClick={onClick} />
            </Html>
        </group>
    );
}

function DiameterDimension({ label, annotation, scale, center, isActive, hasAnyActive, onClick, onHover }: DimensionProps) {
    if (!isActive) return null;
    const c = annotation.center || [0, 0, 0];
    const axis = annotation.axis || [0, 0, 1];
    const value = annotation.value || (annotation.radius ? annotation.radius * 2 : 10.0);

    const transformedCenter = useMemo(() => transformCoords(c, center, scale), [c, center, scale]);
    const radius = (value / 2) * scale;

    const { circlePoints, crosshairs, quat } = useMemo(() => {
        const points: Vector3[] = [];
        const dir = new Vector3(...axis).normalize();
        
        // Generate Circle
        const temp = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
        const u = new Vector3().crossVectors(dir, temp).normalize();
        const v = new Vector3().crossVectors(dir, u).normalize();

        for (let i = 0; i <= 64; i++) {
            const theta = (i / 64) * Math.PI * 2;
            points.push(new Vector3().copy(transformedCenter).addScaledVector(u, radius * Math.cos(theta)).addScaledVector(v, radius * Math.sin(theta)));
        }

        // Generate Crosshairs (+)
        const crossSize = radius * 0.2;
        const cross = [
            [new Vector3().copy(transformedCenter).addScaledVector(u, -crossSize), new Vector3().copy(transformedCenter).addScaledVector(u, crossSize)],
            [new Vector3().copy(transformedCenter).addScaledVector(v, -crossSize), new Vector3().copy(transformedCenter).addScaledVector(v, crossSize)]
        ];

        return { circlePoints: points, crosshairs: cross, quat: getAlignmentQuaternion(dir) };
    }, [transformedCenter, axis, radius]);

    const color = isActive ? '#a78bfa' : '#8b5cf6'; // Purple for diameters
    const opacity = isActive ? 1 : hasAnyActive ? 0.15 : 0.6;

    return (
        <group>
            {/* Circle Outline */}
            <Line points={circlePoints} color={color} lineWidth={isActive ? 3 : 1.5} transparent opacity={opacity} depthTest={false} />
            
            {/* Center Crosshairs */}
            <Line points={crosshairs[0]} color={color} lineWidth={1} transparent opacity={opacity * 0.7} depthTest={false} />
            <Line points={crosshairs[1]} color={color} lineWidth={1} transparent opacity={opacity * 0.7} depthTest={false} />

            {/* Interaction Mesh */}
            <mesh 
                position={transformedCenter} 
                quaternion={quat}
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
                onPointerOut={() => onHover?.(false)}
                visible={false}
            >
                <cylinderGeometry args={[radius, radius, 0.1, 32]} />
            </mesh>

            {/* Label (Pushed slightly outward along the X axis so it doesn't sit dead center) */}
            <Html position={new Vector3(transformedCenter.x + radius*0.8, transformedCenter.y, transformedCenter.z)} zIndexRange={[100, 0]}>
                <DimensionLabel label={label} value={`Ø ${value.toFixed(2)}`} unit="mm" icon={Circle} isActive={isActive} hasAnyActive={hasAnyActive} color="#a78bfa" onClick={onClick} />
            </Html>
        </group>
    );
}

function ChamferDimension({ label, annotation, scale, center, isActive, hasAnyActive, onClick, onHover }: DimensionProps) {
    if (!isActive) return null;
    const c = annotation.center || [0, 0, 0];
    const axis = annotation.axis || [0, 0, 1];
    const radius = (annotation.radius || 10.0) * scale;
    const offset = annotation.offset || 1.0;

    const transformedCenter = useMemo(() => transformCoords(c, center, scale), [c, center, scale]);
    const quaternion = useMemo(() => {
        const dir = new Vector3(...axis).normalize();
        return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir);
    }, [axis]);

    const color = isActive ? '#34d399' : '#10b981'; // Emerald for Edge modifiers
    const opacity = isActive ? 1 : hasAnyActive ? 0.15 : 0.6;

    return (
        <group>
            <mesh
                position={transformedCenter}
                quaternion={quaternion}
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
                onPointerOut={() => onHover?.(false)}
                renderOrder={1000}
            >
                <torusGeometry args={[radius, isActive ? 0.02 : 0.012, 16, 64]} />
                <meshBasicMaterial color={isActive ? '#ffffff' : color} transparent opacity={opacity} depthTest={false} />
            </mesh>

            <Html position={transformedCenter} zIndexRange={[100, 0]}>
                <DimensionLabel label={label} value={offset.toFixed(2)} unit="mm" icon={Scaling} isActive={isActive} hasAnyActive={hasAnyActive} color="#34d399" onClick={onClick} />
            </Html>
        </group>
    );
}

export function DimensionOverlay({ annotations, activeParameter, geometryScale, geometryCenter, onSelectParameter, onHoverParameter }: DimensionOverlayProps) {
    if (!annotations || !activeParameter) return null;
    const hasAnyActive = activeParameter !== null;

    return (
        <group>
            {Object.entries(annotations).map(([key, annotation]) => {
                const type = annotation.type || (annotation.p1 && annotation.p2 ? 'height' : (annotation.center ? 'diameter' : 'height'));
                const props = {
                    label: key, annotation, scale: geometryScale, center: geometryCenter,
                    isActive: key === activeParameter, hasAnyActive,
                    onClick: () => onSelectParameter?.(key),
                    onHover: (hovered: boolean) => onHoverParameter?.(hovered ? key : null)
                };

                if (type === 'diameter') return <DiameterDimension key={key} {...props} />;
                if (type === 'chamfer') return <ChamferDimension key={key} {...props} />;
                return <HeightDimension key={key} {...props} />;
            })}
        </group>
    );
}