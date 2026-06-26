'use client';

import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { Vector3, Quaternion } from 'three';
import { MoveVertical, Circle, Scaling } from 'lucide-react';
import type { AnnotationEntry } from '@/lib/openscadParameters';

export type { AnnotationEntry };

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

const toWorld = (
    pt: [number, number, number],
    center: [number, number, number],
    scale: number
): Vector3 =>
    new Vector3(
        (pt[0] - center[0]) * scale,
        (pt[1] - center[1]) * scale,
        (pt[2] - center[2]) * scale
    );

const getAlignmentQuaternion = (dir: Vector3): Quaternion => {
    const up = new Vector3(0, 1, 0);
    const axis = new Vector3().crossVectors(up, dir).normalize();
    const dot = Math.min(1, Math.max(-1, up.dot(dir)));
    const radians = Math.acos(dot);
    if (axis.lengthSq() < 1e-10) {
        return dot > 0 ? new Quaternion() : new Quaternion(1, 0, 0, 0);
    }
    return new Quaternion().setFromAxisAngle(axis, radians);
};

function isRenderable(a: AnnotationEntry): boolean {
    if (a.isEps || a.isDegenerate) return false;

    const type = a.type ?? (a.p1 && a.p2 ? 'height' : a.center ? 'diameter' : 'height');

    if (type === 'diameter' || type === 'chamfer') {
        if (!a.center) return false;
        const val = a.value ?? (a.radius ? a.radius * 2 : 0);
        if (!val || val <= 0) return false;
    } else {
        if (!a.p1 || !a.p2) return false;
        const dist = Math.hypot(
            a.p2[0] - a.p1[0],
            a.p2[1] - a.p1[1],
            a.p2[2] - a.p1[2]
        );
        if (dist < 1e-4) return false;
        if (a.value !== undefined && a.value <= 0) return false;
    }
    return true;
}

const DimensionLabel = ({
    label, value, unit, icon: Icon,
    isActive, hasAnyActive, color, onClick,
}: {
    label: string; value: string; unit: string; icon: any;
    isActive: boolean; hasAnyActive: boolean; color: string;
    onClick?: () => void;
}) => {
    const opacity = isActive ? 1 : hasAnyActive ? 0.15 : 0.55;
    return (
        <div
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
            className="group"
            style={{
                background: isActive ? 'rgba(24,24,27,0.95)' : 'rgba(24,24,27,0.45)',
                border: `1px solid ${isActive ? color : 'rgba(63,63,70,0.2)'}`,
                borderRadius: isActive ? '8px' : '6px',
                padding: isActive ? '6px 10px' : '4px 6px',
                display: 'flex',
                alignItems: 'center',
                gap: isActive ? '8px' : '4px',
                backdropFilter: 'blur(4px)',
                boxShadow: isActive
                    ? `0 0 20px ${color}40, 0 4px 12px rgba(0,0,0,0.5)`
                    : '0 2px 6px rgba(0,0,0,0.2)',
                transform: isActive
                    ? 'translate(-50%,-50%) scale(1.05)'
                    : 'translate(-50%,-50%) scale(0.85)',
                transition: 'all 0.2s cubic-bezier(0.16,1,0.3,1)',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                pointerEvents: 'auto',
                opacity,
                userSelect: 'none',
            }}
        >
            <Icon size={isActive ? 12 : 10} color={isActive ? color : '#71717a'} />
            {isActive && (
                <>
                    <span style={{
                        color, fontSize: '11px', fontWeight: 600,
                        letterSpacing: '0.05em', textTransform: 'uppercase',
                        fontFamily: 'system-ui, sans-serif',
                    }}>
                        {label.replace(/_/g, ' ')}
                    </span>
                    <div style={{ width: '1px', height: '12px', background: 'rgba(82,82,91,0.6)' }} />
                </>
            )}
            <span style={{
                color: isActive ? '#f4f4f5' : '#d4d4d8',
                fontSize: isActive ? '12px' : '10px',
                fontWeight: isActive ? 700 : 500,
                fontFamily: 'monospace',
            }}>
                {value}{' '}
                <span style={{ color: '#71717a', fontSize: isActive ? '10px' : '8px' }}>{unit}</span>
            </span>
        </div>
    );
};

function HeightDimension({
    label, annotation, scale, center,
    isActive, hasAnyActive, onClick, onHover,
}: DimensionProps) {
    const p1 = annotation.p1!;
    const p2 = annotation.p2!;

    const { wP1, wP2, midpoint, displayValue, quatP1, quatP2 } = useMemo(() => {
        const tP1 = toWorld(p1, center, scale);
        const tP2 = toWorld(p2, center, scale);
        const mid = new Vector3().addVectors(tP1, tP2).multiplyScalar(0.5);

        const displayMm = annotation.value !== undefined
            ? annotation.value
            : tP1.distanceTo(tP2) / scale;

        const direction = new Vector3().subVectors(tP2, tP1).normalize();
        const qP1 = getAlignmentQuaternion(direction.clone().negate());
        const qP2 = getAlignmentQuaternion(direction);

        return { wP1: tP1, wP2: tP2, midpoint: mid, displayValue: displayMm, quatP1: qP1, quatP2: qP2 };
    }, [p1, p2, center, scale, annotation.value]);

    const color = isActive ? '#60a5fa' : '#71717a';
    const opacity = isActive ? 0.95 : hasAnyActive ? 0.1 : 0.35;
    const arrowSize = isActive ? 0.08 : 0.04;
    const hitboxLen = wP1.distanceTo(wP2);

    return (
        <group>
            <Line
                points={[wP1, wP2]}
                color={color} lineWidth={isActive ? 3 : 1.5}
                transparent opacity={opacity} depthTest={false}
            />
            <mesh position={wP1} quaternion={quatP1}>
                <coneGeometry args={[arrowSize * 0.4, arrowSize, 16]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
            </mesh>
            <mesh position={wP2} quaternion={quatP2}>
                <coneGeometry args={[arrowSize * 0.4, arrowSize, 16]} />
                <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} />
            </mesh>

            <mesh
                position={midpoint}
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
                onPointerOut={() => onHover?.(false)}
                visible={false}
            >
                <cylinderGeometry args={[0.2, 0.2, Math.max(hitboxLen, 0.01), 8]} />
            </mesh>

            <Html position={midpoint} zIndexRange={[100, 0]}>
                <DimensionLabel
                    label={label}
                    value={displayValue.toFixed(2)}
                    unit="mm"
                    icon={MoveVertical}
                    isActive={isActive}
                    hasAnyActive={hasAnyActive}
                    color="#60a5fa"
                    onClick={onClick}
                />
            </Html>
        </group>
    );
}

function DiameterDimension({
    label, annotation, scale, center,
    isActive, hasAnyActive, onClick, onHover,
}: DimensionProps) {
    const c = annotation.center!;
    const axis = annotation.axis ?? [0, 0, 1];
    const diameterMm = annotation.value!;
    const radiusWorld = (diameterMm / 2) * scale;

    const transformedCenter = useMemo(
        () => toWorld(c, center, scale),
        [c, center, scale]
    );

    const { circlePoints, crosshairs, quat } = useMemo(() => {
        const dir = new Vector3(...axis).normalize();
        const temp = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
        const u = new Vector3().crossVectors(dir, temp).normalize();
        const v = new Vector3().crossVectors(dir, u).normalize();

        const points: Vector3[] = [];
        for (let i = 0; i <= 64; i++) {
            const theta = (i / 64) * Math.PI * 2;
            points.push(
                new Vector3()
                    .copy(transformedCenter)
                    .addScaledVector(u, radiusWorld * Math.cos(theta))
                    .addScaledVector(v, radiusWorld * Math.sin(theta))
            );
        }

        const crossSize = radiusWorld * 0.2;
        const cross = [
            [new Vector3().copy(transformedCenter).addScaledVector(u, -crossSize),
             new Vector3().copy(transformedCenter).addScaledVector(u, crossSize)],
            [new Vector3().copy(transformedCenter).addScaledVector(v, -crossSize),
             new Vector3().copy(transformedCenter).addScaledVector(v, crossSize)],
        ];

        return { circlePoints: points, crosshairs: cross, quat: getAlignmentQuaternion(dir) };
    }, [transformedCenter, axis, radiusWorld]);

    const color = isActive ? '#a78bfa' : '#71717a';
    const opacity = isActive ? 0.95 : hasAnyActive ? 0.1 : 0.35;
    const labelPos = useMemo(
        () => new Vector3(
            transformedCenter.x + radiusWorld * 0.8,
            transformedCenter.y,
            transformedCenter.z
        ),
        [transformedCenter, radiusWorld]
    );

    return (
        <group>
            <Line
                points={circlePoints}
                color={color} lineWidth={isActive ? 3 : 1.5}
                transparent opacity={opacity} depthTest={false}
            />

            {isActive && (
                <>
                    <Line points={crosshairs[0]} color={color} lineWidth={1} transparent opacity={opacity * 0.7} depthTest={false} />
                    <Line points={crosshairs[1]} color={color} lineWidth={1} transparent opacity={opacity * 0.7} depthTest={false} />
                </>
            )}

            <mesh
                position={transformedCenter}
                quaternion={quat}
                onClick={(e) => { e.stopPropagation(); onClick?.(); }}
                onPointerOver={(e) => { e.stopPropagation(); onHover?.(true); }}
                onPointerOut={() => onHover?.(false)}
                visible={false}
            >
                <cylinderGeometry args={[radiusWorld, radiusWorld, 0.1, 32]} />
            </mesh>

            <Html position={labelPos} zIndexRange={[100, 0]}>
                <DimensionLabel
                    label={label}
                    value={`Ø ${diameterMm.toFixed(2)}`}
                    unit="mm"
                    icon={Circle}
                    isActive={isActive}
                    hasAnyActive={hasAnyActive}
                    color="#a78bfa"
                    onClick={onClick}
                />
            </Html>
        </group>
    );
}

function ChamferDimension({
    label, annotation, scale, center,
    isActive, hasAnyActive, onClick, onHover,
}: DimensionProps) {
    const c = annotation.center ?? [0, 0, 0];
    const axis = annotation.axis ?? [0, 0, 1];
    const radiusMm = annotation.radius ?? (annotation.value ? annotation.value / 2 : 10);
    const offset = annotation.offset ?? 1.0;

    const transformedCenter = useMemo(
        () => toWorld(c as [number,number,number], center, scale),
        [c, center, scale]
    );
    const quaternion = useMemo(() => {
        const dir = new Vector3(...axis).normalize();
        return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir);
    }, [axis]);

    const color = isActive ? '#34d399' : '#71717a';
    const opacity = isActive ? 0.95 : hasAnyActive ? 0.1 : 0.35;
    const radiusWorld = radiusMm * scale;

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
                <torusGeometry args={[radiusWorld, isActive ? 0.02 : 0.012, 16, 64]} />
                <meshBasicMaterial color={isActive ? '#ffffff' : color} transparent opacity={opacity} depthTest={false} />
            </mesh>

            <Html position={transformedCenter} zIndexRange={[100, 0]}>
                <DimensionLabel
                    label={label}
                    value={offset.toFixed(2)}
                    unit="mm"
                    icon={Scaling}
                    isActive={isActive}
                    hasAnyActive={hasAnyActive}
                    color="#34d399"
                    onClick={onClick}
                />
            </Html>
        </group>
    );
}

export function DimensionOverlay({
    annotations, activeParameter, geometryScale, geometryCenter,
    onSelectParameter, onHoverParameter,
}: DimensionOverlayProps) {
    if (!annotations) return null;
    const hasAnyActive = activeParameter !== null;

    const renderableEntries = useMemo(
        () => Object.entries(annotations).filter(([, a]) => isRenderable(a)),
        [annotations]
    );

    if (renderableEntries.length === 0) return null;

    return (
        <group>
            {renderableEntries.map(([key, annotation]) => {
                const type = annotation.type
                    ?? (annotation.p1 && annotation.p2 ? 'height'
                        : annotation.center ? 'diameter'
                        : 'height');

                const props: DimensionProps = {
                    label: key,
                    annotation,
                    scale: geometryScale,
                    center: geometryCenter,
                    isActive: key === activeParameter,
                    hasAnyActive,
                    onClick: () => onSelectParameter?.(key),
                    onHover: (hovered) => onHoverParameter?.(hovered ? key : null),
                };

                if (type === 'diameter') return <DiameterDimension key={key} {...props} />;
                if (type === 'chamfer')  return <ChamferDimension  key={key} {...props} />;
                return <HeightDimension key={key} {...props} />;
            })}
        </group>
    );
}
