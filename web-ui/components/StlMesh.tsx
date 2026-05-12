'use client';

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';

type Props = {
	url: string;
	onMeshClick?: (point: [number, number, number] | null) => void;
};

const MATERIAL = new THREE.MeshStandardMaterial({
	color: '#e2e8f0',
	metalness: 0.12,
	roughness: 0.28,
	flatShading: false,
});

export function StlMesh({ url, onMeshClick }: Props) {
	const geometry = useLoader(STLLoader, url);

	// Auto-centre and normalise size to ≈ 2 units
	const { geo, scale } = useMemo(() => {
		const g = geometry.clone();
		g.computeVertexNormals();
		g.computeBoundingBox();

		const box  = g.boundingBox ?? new THREE.Box3();
		const size = new THREE.Vector3();
		box.getSize(size);

		const maxDim = Math.max(size.x, size.y, size.z, 0.001);
		g.center();

		return { geo: g, scale: 2 / maxDim };
	}, [geometry]);

	return (
		<mesh
			geometry={geo}
			material={MATERIAL}
			scale={scale}
			castShadow
			receiveShadow
			onClick={(e) => {
				e.stopPropagation();
				onMeshClick?.([e.point.x, e.point.y, e.point.z]);
			}}
			onPointerMissed={() => onMeshClick?.(null)}
		/>
	);
}
