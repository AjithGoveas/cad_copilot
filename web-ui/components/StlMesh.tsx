'use client';

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import { Box3, BufferGeometry, Color, MeshStandardMaterial, Vector3 } from 'three';

export function StlMesh({ url }: { url: string }) {
	const geometry = useLoader(STLLoader, url);

	const { centeredGeometry, scale } = useMemo(() => {
		const cloned = geometry.clone() as BufferGeometry;
		cloned.computeVertexNormals();
		cloned.computeBoundingBox();

		const box = cloned.boundingBox ?? new Box3();
		const size = new Vector3();
		box.getSize(size);
		const maxDim = Math.max(size.x || 0, size.y || 0, size.z || 0);
		const safeScale = maxDim > 0 ? 1.8 / maxDim : 1;

		cloned.center();
		return {
			centeredGeometry: cloned,
			scale: safeScale,
		};
	}, [geometry]);

	const material = useMemo(
		() =>
			new MeshStandardMaterial({
				color: new Color('#e4e4e7'),
				metalness: 0.2,
				roughness: 0.3,
				flatShading: false,
			}),
		[]
	);

	return <mesh geometry={centeredGeometry} material={material} scale={scale} castShadow receiveShadow />;
}
