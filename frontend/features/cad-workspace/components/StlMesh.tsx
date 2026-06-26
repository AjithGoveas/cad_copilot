'use client';

import { useState, useEffect, memo, useMemo } from 'react';
import { STLLoader } from 'three-stdlib';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

const BRUSHED_STEEL_CONFIG = {
    metalness: 1.0,
    roughness: 0.42,
    clearcoat: 0.05,
    clearcoatRoughness: 0.3,
    envMapIntensity: 1.2,
};

type Props = {
    id:  string;
    url: string;
    isSelected?: boolean;
    color?: string;
    onMeshClick?: (point: [number, number, number] | null) => void;
};

export const StlMesh = memo(function StlMesh({ id, url, isSelected, color, onMeshClick }: Props) {
    const [hovered, setHovered] = useState(false);
    const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

    const baseColor = useMemo(() => new THREE.Color(color || '#94a3b8'), [color]);
    const hoverColor = useMemo(() => {
        const c = baseColor.clone();
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        c.setHSL(hsl.h, hsl.s, Math.min(hsl.l + 0.12, 1.0));
        return c;
    }, [baseColor]);

    const selectionColor = useMemo(() => new THREE.Color(color || '#94a3b8'), [color]);

    useEffect(() => {
        let isCurrent = true;
        const loader = new STLLoader();

        loader.load(
            url,
            (loadedGeometry) => {
                if (isCurrent) setGeo(loadedGeometry);
            },
            undefined,
            (err) => {
                if (isCurrent) console.error(`[StlMesh] Failed to load "${url}":`, err);
            }
        );

        return () => { isCurrent = false; };
    }, [url]);

    // Separate effect: dispose geometry when it's replaced or on unmount
    useEffect(() => {
        return () => { geo?.dispose(); };
    }, [geo]);

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
                    const localPt = e.object.worldToLocal(e.point.clone());
                    onMeshClick?.([localPt.x, localPt.y, localPt.z]);
                }}
                onPointerMissed={() => onMeshClick?.(null)}
            >
                {isSelected ? (
                    <meshStandardMaterial 
                        color={selectionColor}
                        metalness={0.6}
                        roughness={0.2}
                        emissive={selectionColor}
                        emissiveIntensity={0.25}
                        flatShading={true}
                    />
                ) : (
                    <meshPhysicalMaterial 
                        {...BRUSHED_STEEL_CONFIG}
                        color={hovered ? hoverColor : baseColor}
                        flatShading={true}
                    />
                )}
                
                {(isSelected || hovered) && (
                    <Edges 
                        scale={1.001}
                        threshold={30} 
                        color={isSelected ? '#f59e0b' : '#94a3b8'} 
                        opacity={isSelected ? 1 : 0.4}
                        transparent
                    />
                )}
            </mesh>
        </group>
    );
});
