'use client';

import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { Vector3, Quaternion } from 'three';

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
	/** Uniform scale factor applied to the STL mesh */
	geometryScale: number;
	/** The center of the original bounding box (before centering) */
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
	onClick?: () => void;
	onHover?: (hovered: boolean) => void;
};

// Helper to transform raw model coords to canvas coordinates
const transformCoords = (pt: [number, number, number], center: [number, number, number], scale: number): Vector3 => {
	return new Vector3(
		(pt[0] - center[0]) * scale,
		(pt[1] - center[1]) * scale,
		(pt[2] - center[2]) * scale
	);
};

function HeightDimension({
	label,
	annotation,
	scale,
	center,
	isActive,
	onClick,
	onHover,
}: DimensionProps) {
	const p1 = annotation.p1 || [0, 0, 0];
	const p2 = annotation.p2 || [0, 0, 0];

	const transformedP1 = useMemo(
		() => transformCoords(p1, center, scale),
		[p1, center, scale],
	);

	const transformedP2 = useMemo(
		() => transformCoords(p2, center, scale),
		[p2, center, scale],
	);

	const midpoint = useMemo(
		() => new Vector3().addVectors(transformedP1, transformedP2).multiplyScalar(0.5),
		[transformedP1, transformedP2],
	);

	const realDistance = useMemo(() => {
		return new Vector3(...p1).distanceTo(new Vector3(...p2));
	}, [p1, p2]);

	const { tick1, tick2 } = useMemo(() => {
		const dir = new Vector3().subVectors(transformedP2, transformedP1).normalize();
		const temp = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
		const perp = new Vector3().crossVectors(dir, temp).normalize().multiplyScalar(0.12);
		
		const t1_start = new Vector3().subVectors(transformedP1, perp);
		const t1_end = new Vector3().addVectors(transformedP1, perp);
		
		const t2_start = new Vector3().subVectors(transformedP2, perp);
		const t2_end = new Vector3().addVectors(transformedP2, perp);
		
		return {
			tick1: [t1_start, t1_end],
			tick2: [t2_start, t2_end],
		};
	}, [transformedP1, transformedP2]);

	if (!isActive) {
		return (
			<mesh
				position={midpoint}
				onClick={(e) => {
					e.stopPropagation();
					onClick?.();
				}}
				onPointerOver={(e) => {
					e.stopPropagation();
					onHover?.(true);
				}}
				onPointerOut={(e) => {
					onHover?.(false);
				}}
				renderOrder={1000}
			>
				<sphereGeometry args={[0.02, 16, 16]} />
				<meshBasicMaterial color="#007ACC" transparent opacity={0.35} depthTest={false} />
			</mesh>
		);
	}

	return (
		<group>
			{/* Main Dimension Line */}
			<Line points={[transformedP1, transformedP2]} color="#007ACC" lineWidth={2.5} depthTest={false} />
			
			{/* Endcap ticks */}
			<Line points={tick1} color="#007ACC" lineWidth={2} depthTest={false} />
			<Line points={tick2} color="#007ACC" lineWidth={2} depthTest={false} />
			
			{/* Midpoint Sphere */}
			<mesh 
				position={midpoint}
				onClick={(e) => {
					e.stopPropagation();
					onClick?.();
				}}
				onPointerOver={(e) => {
					e.stopPropagation();
					onHover?.(true);
				}}
				onPointerOut={(e) => {
					onHover?.(false);
				}}
				renderOrder={1000}
			>
				<sphereGeometry args={[0.035, 16, 16]} />
				<meshBasicMaterial color="#f59e0b" depthTest={false} />
			</mesh>
			
			{/* HTML Label */}
			<Html position={midpoint} center distanceFactor={15} zIndexRange={[100, 0]}>
				<div
					onClick={(e) => {
						e.stopPropagation();
						onClick?.();
					}}
					style={{
						background: 'rgba(37, 37, 38, 0.9)',
						border: '1px solid rgba(0, 122, 204, 0.5)',
						borderRadius: '6px',
						padding: '4px 8px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '1px',
						backdropFilter: 'blur(8px)',
						boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
						transform: 'translateY(-24px)',
						whiteSpace: 'nowrap',
						cursor: 'pointer',
						pointerEvents: 'auto',
					}}
				>
					<span
						style={{
							color: '#9CDCFE',
							fontSize: '9px',
							fontWeight: 800,
							letterSpacing: '0.1em',
							textTransform: 'uppercase',
							fontFamily: 'monospace',
						}}
					>
						{label.replace(/_/g, ' ')}
					</span>
					<span
						style={{
							color: '#D4D4D4',
							fontSize: '11px',
							fontWeight: 700,
							fontFamily: 'monospace',
						}}
					>
						{realDistance.toFixed(2)} mm
					</span>
				</div>
			</Html>
		</group>
	);
}

function DiameterDimension({
	label,
	annotation,
	scale,
	center,
	isActive,
	onClick,
	onHover,
}: DimensionProps) {
	const c = annotation.center || [0, 0, 0];
	const axis = annotation.axis || [0, 0, 1];
	const value = annotation.value || (annotation.radius ? annotation.radius * 2 : 10.0);

	const transformedCenter = useMemo(
		() => transformCoords(c, center, scale),
		[c, center, scale]
	);

	const radius = (value / 2) * scale;

	// Compute circular ring points
	const circlePoints = useMemo(() => {
		const points: Vector3[] = [];
		const dir = new Vector3(...axis).normalize();
		const temp = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
		const u = new Vector3().crossVectors(dir, temp).normalize();
		const v = new Vector3().crossVectors(dir, u).normalize();

		const segments = 64;
		for (let i = 0; i <= segments; i++) {
			const theta = (i / segments) * Math.PI * 2;
			const p = new Vector3()
				.copy(transformedCenter)
				.addScaledVector(u, radius * Math.cos(theta))
				.addScaledVector(v, radius * Math.sin(theta));
			points.push(p);
		}
		return { points, u };
	}, [transformedCenter, axis, radius]);

	// Double-headed diameter line points
	const diamLinePoints = useMemo(() => {
		const { u } = circlePoints;
		const p1 = new Vector3().copy(transformedCenter).addScaledVector(u, -radius);
		const p2 = new Vector3().copy(transformedCenter).addScaledVector(u, radius);
		return [p1, p2];
	}, [transformedCenter, circlePoints, radius]);

	if (!isActive) {
		return (
			<mesh
				position={transformedCenter}
				onClick={(e) => {
					e.stopPropagation();
					onClick?.();
				}}
				onPointerOver={(e) => {
					e.stopPropagation();
					onHover?.(true);
				}}
				onPointerOut={(e) => {
					onHover?.(false);
				}}
				renderOrder={1000}
			>
				<sphereGeometry args={[0.02, 16, 16]} />
				<meshBasicMaterial color="#007ACC" transparent opacity={0.35} depthTest={false} />
			</mesh>
		);
	}

	return (
		<group>
			{/* Circular Ring */}
			<Line points={circlePoints.points} color="#007ACC" lineWidth={2} depthTest={false} />

			{/* Diameter line */}
			<Line points={diamLinePoints} color="#007ACC" lineWidth={1.5} dashed={true} dashScale={5} depthTest={false} />

			{/* Center Sphere */}
			<mesh 
				position={transformedCenter}
				onClick={(e) => {
					e.stopPropagation();
					onClick?.();
				}}
				onPointerOver={(e) => {
					e.stopPropagation();
					onHover?.(true);
				}}
				onPointerOut={(e) => {
					onHover?.(false);
				}}
				renderOrder={1000}
			>
				<sphereGeometry args={[0.035, 16, 16]} />
				<meshBasicMaterial color="#f59e0b" depthTest={false} />
			</mesh>

			{/* HTML Label */}
			<Html position={transformedCenter} center distanceFactor={15} zIndexRange={[100, 0]}>
				<div
					onClick={(e) => {
						e.stopPropagation();
						onClick?.();
					}}
					style={{
						background: 'rgba(37, 37, 38, 0.9)',
						border: '1px solid rgba(0, 122, 204, 0.5)',
						borderRadius: '6px',
						padding: '4px 8px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '1px',
						backdropFilter: 'blur(8px)',
						boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
						transform: 'translateY(-24px)',
						whiteSpace: 'nowrap',
						cursor: 'pointer',
						pointerEvents: 'auto',
					}}
				>
					<span
						style={{
							color: '#9CDCFE',
							fontSize: '9px',
							fontWeight: 800,
							letterSpacing: '0.1em',
							textTransform: 'uppercase',
							fontFamily: 'monospace',
						}}
					>
						{label.replace(/_/g, ' ')}
					</span>
					<span
						style={{
							color: '#D4D4D4',
							fontSize: '11px',
							fontWeight: 700,
							fontFamily: 'monospace',
						}}
					>
						Ø {value.toFixed(2)} mm
					</span>
				</div>
			</Html>
		</group>
	);
}

function ChamferDimension({
	label,
	annotation,
	scale,
	center,
	isActive,
	onClick,
	onHover,
}: DimensionProps) {
	const c = annotation.center || [0, 0, 0];
	const axis = annotation.axis || [0, 0, 1];
	const radius = (annotation.radius || 10.0) * scale;
	const offset = annotation.offset || 1.0;

	const transformedCenter = useMemo(
		() => transformCoords(c, center, scale),
		[c, center, scale]
	);

	const quaternion = useMemo(() => {
		const dir = new Vector3(...axis).normalize();
		return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir);
	}, [axis]);

	if (!isActive) {
		return (
			<mesh
				position={transformedCenter}
				onClick={(e) => {
					e.stopPropagation();
					onClick?.();
				}}
				onPointerOver={(e) => {
					e.stopPropagation();
					onHover?.(true);
				}}
				onPointerOut={(e) => {
					onHover?.(false);
				}}
				renderOrder={1000}
			>
				<sphereGeometry args={[0.02, 16, 16]} />
				<meshBasicMaterial color="#4EC9B0" transparent opacity={0.35} depthTest={false} />
			</mesh>
		);
	}

	return (
		<group>
			{/* Torus Mesh Highlight - Neon Cyan/Emerald style */}
			<mesh
				position={transformedCenter}
				quaternion={quaternion}
				onClick={(e) => {
					e.stopPropagation();
					onClick?.();
				}}
				onPointerOver={(e) => {
					e.stopPropagation();
					onHover?.(true);
				}}
				onPointerOut={(e) => {
					onHover?.(false);
				}}
				renderOrder={1000}
			>
				<torusGeometry args={[radius, 0.015, 16, 64]} />
				<meshBasicMaterial color="#4EC9B0" transparent opacity={0.8} depthTest={false} />
			</mesh>

			{/* HTML Label */}
			<Html position={transformedCenter} center distanceFactor={15} zIndexRange={[100, 0]}>
				<div
					onClick={(e) => {
						e.stopPropagation();
						onClick?.();
					}}
					style={{
						background: 'rgba(37, 37, 38, 0.9)',
						border: '1px solid rgba(78, 201, 176, 0.5)',
						borderRadius: '6px',
						padding: '4px 8px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '1px',
						backdropFilter: 'blur(8px)',
						boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
						transform: 'translateY(-24px)',
						whiteSpace: 'nowrap',
						cursor: 'pointer',
						pointerEvents: 'auto',
					}}
				>
					<span
						style={{
							color: '#4EC9B0',
							fontSize: '9px',
							fontWeight: 800,
							letterSpacing: '0.1em',
							textTransform: 'uppercase',
							fontFamily: 'monospace',
						}}
					>
						{label.replace(/_/g, ' ')}
					</span>
					<span
						style={{
							color: '#D4D4D4',
							fontSize: '11px',
							fontWeight: 700,
							fontFamily: 'monospace',
						}}
					>
						Chamfer: {offset.toFixed(2)} mm
					</span>
				</div>
			</Html>
		</group>
	);
}

export function DimensionOverlay({
	annotations,
	activeParameter,
	geometryScale,
	geometryCenter,
	onSelectParameter,
	onHoverParameter,
}: DimensionOverlayProps) {
	if (!annotations) {
		return null;
	}

	return (
		<group>
			{Object.entries(annotations).map(([key, annotation]) => {
				const type = annotation.type || (annotation.p1 && annotation.p2 ? 'height' : (annotation.center ? 'diameter' : 'height'));
				if (type === 'diameter') {
					return (
						<DiameterDimension
							key={key}
							label={key}
							annotation={annotation}
							scale={geometryScale}
							center={geometryCenter}
							isActive={key === activeParameter}
							onClick={() => onSelectParameter?.(key)}
							onHover={(hovered) => onHoverParameter?.(hovered ? key : null)}
						/>
					);
				} else if (type === 'chamfer') {
					return (
						<ChamferDimension
							key={key}
							label={key}
							annotation={annotation}
							scale={geometryScale}
							center={geometryCenter}
							isActive={key === activeParameter}
							onClick={() => onSelectParameter?.(key)}
							onHover={(hovered) => onHoverParameter?.(hovered ? key : null)}
						/>
					);
				} else {
					return (
						<HeightDimension
							key={key}
							label={key}
							annotation={annotation}
							scale={geometryScale}
							center={geometryCenter}
							isActive={key === activeParameter}
							onClick={() => onSelectParameter?.(key)}
							onHover={(hovered) => onHoverParameter?.(hovered ? key : null)}
						/>
					);
				}
			})}
		</group>
	);
}