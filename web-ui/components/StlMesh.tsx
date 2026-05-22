'use client';

import { useMemo, useState, useEffect, memo } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { Edges, Outlines } from '@react-three/drei';

// Technical Specification: Stainless Steel Brushed
const BRUSHED_STEEL_CONFIG = {
	color: '#94a3b8',
	metalness: 1.0,
	roughness: 0.42,
	clearcoat: 0.05,
	clearcoatRoughness: 0.3,
	envMapIntensity: 1.2,
};

const SELECTION_CONFIG = {
	color: '#94a3b8',
	metalness: 0.6,
	roughness: 0.2,
	emissive: '#94a3b8',
	emissiveIntensity: 0.15,
};

type Props = {
	id:  string;
	url: string;
	isSelected?: boolean;
	onMeshClick?: (point: [number, number, number] | null) => void;
	onGeometryLoaded?: (center: [number, number, number], scale: number) => void;
};

export const StlMesh = memo(function StlMesh({ id, url, isSelected, onMeshClick, onGeometryLoaded }: Props) {
	// useLoader caches the geometry by URL automatically
	const geometry = useLoader(STLLoader, url);
	const [hovered, setHovered] = useState(false);

	const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

	// Ensure geometry is clean and sharp, and disposed on cleanup
	useEffect(() => {
		const cloned = geometry.clone();
		setGeo(cloned);

		return () => {
			cloned.dispose();
		};
	}, [geometry]);

	useEffect(() => {
		if (geo) {
			geo.computeBoundingBox();
			const box = geo.boundingBox;
			if (box) {
				const center = new THREE.Vector3();
				box.getCenter(center);
				onGeometryLoaded?.([center.x, center.y, center.z], 1.0);
			}
		}
	}, [geo, onGeometryLoaded]);

	if (!geo) return null;

	return (
		<group>
			<mesh
				geometry={geo}
				castShadow
				receiveShadow
				onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
				onPointerOut={() => setHovered(false)}
				onClick={(e) => {
					e.stopPropagation();
					onMeshClick?.([e.point.x, e.point.y, e.point.z]);
				}}
				onPointerMissed={() => onMeshClick?.(null)}
			>
				{isSelected ? (
					<meshStandardMaterial 
						{...SELECTION_CONFIG}
						flatShading={true}
					/>
				) : (
					<meshPhysicalMaterial 
						{...BRUSHED_STEEL_CONFIG}
						color={hovered ? '#cbd5e1' : BRUSHED_STEEL_CONFIG.color}
						flatShading={true}
					/>
				)}
				
				{/* High-performance Edge highlighting */}
				{(isSelected || hovered) && (
					<Edges 
						scale={1.001} // Slight offset to prevent z-fighting
						threshold={30} 
						color={isSelected ? '#f59e0b' : '#94a3b8'} 
						opacity={isSelected ? 1 : 0.4}
						transparent
					/>
				)}
				
				{/* Premium selection outline */}
				{/* {isSelected && (
					<Outlines 
						thickness={2} 
						color="#fbbf24" 
						transparent 
						opacity={0.4} 
					/>
				)} */}
			</mesh>
		</group>
	);
});
