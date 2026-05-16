'use client';

import { useMemo, useState, memo } from 'react';
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
};

export const StlMesh = memo(function StlMesh({ id, url, isSelected, onMeshClick }: Props) {
	// useLoader caches the geometry by URL automatically
	const geometry = useLoader(STLLoader, url);
	const [hovered, setHovered] = useState(false);

	// Ensure geometry is clean and sharp
	const geo = useMemo(() => {
		const g = geometry.clone();
		// Avoid computeVertexNormals to prevent the "balloon" effect
		return g;
	}, [geometry]);

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
						threshold={25} 
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
