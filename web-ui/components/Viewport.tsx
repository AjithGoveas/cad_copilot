'use client';

import { Suspense, useState, useMemo, memo, useCallback } from 'react';
import { Canvas, events } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stage, ContactShadows, Center } from '@react-three/drei';
import { Loader2, MousePointer2 } from 'lucide-react';
import { StlMesh } from './StlMesh';
import { DimensionOverlay } from './DimensionOverlay';
import { CameraRig } from './CameraRig';

type Selection = { id: string; point: [number, number, number] };

type Props = {
    stlUrls: Map<string, string>; statusText: string; isCompiling: boolean;
    selection?: Selection | null; onMeshClick?: (id: string | null, point: [number, number, number] | null) => void;
    annotations?: Record<string, any>; activeFeatureId?: string | null;
    onSelectParameter?: (key: string | null) => void; onHoverParameter?: (key: string | null) => void;
};

export const Viewport = memo(function Viewport({ 
    stlUrls, statusText, isCompiling, selection, onMeshClick,
    annotations = {}, activeFeatureId = null, onSelectParameter, onHoverParameter,
}: Props) {
    const [geometryCenter, setGeometryCenter] = useState<[number, number, number]>([0, 0, 0]);
    const [geometryScale, setGeometryScale] = useState<number>(1.0);
    const [geometrySize, setGeometrySize] = useState<[number, number, number]>([10, 10, 10]);

    const handleGeometryLoaded = useCallback((center: [number, number, number], size: [number, number, number], scale: number) => {
        setGeometryCenter(prev => {
            if (prev[0] === center[0] && prev[1] === center[1] && prev[2] === center[2]) return prev;
            return center;
        });
        setGeometrySize(prev => {
            if (prev[0] === size[0] && prev[1] === size[1] && prev[2] === size[2]) return prev;
            return size;
        });
        setGeometryScale(scale);
    }, []);

    const geometryInfo = useMemo(() => ({ center: geometryCenter, scale: geometryScale, size: geometrySize }), [geometryCenter, geometryScale, geometrySize]);
    const hasGeometry = stlUrls.size > 0;

    return (
        // VS Code App Background Color
        <section className="relative flex-1 overflow-hidden bg-[#181818] shadow-[inset_0_0_40px_rgba(0,0,0,0.5)]">
            <Canvas
                shadows="percentage" dpr={[1, 2]}
                gl={{ antialias: true, logarithmicDepthBuffer: true }}
                className="absolute inset-0"
            >
                <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
                <color attach="background" args={['#181818']} />

                <Suspense fallback={null}>
                    <Stage intensity={0.8} environment="city" adjustCamera={false} shadows="contact" preset="rembrandt">
                        <Center
                            onCentered={({ center, width, height, depth }) => handleGeometryLoaded(
                                [center.x, center.y, center.z],
                                [width, height, depth],
                                1.0
                            )}
                        >
                            {Array.from(stlUrls.entries()).map(([id, url]) => (
                                <StlMesh
                                    key={id} id={id} url={url}
                                    isSelected={selection?.id === id}
                                    onMeshClick={(pt) => onMeshClick?.(id, pt)}
                                />
                            ))}
                        </Center>
                    </Stage>
                    <ContactShadows position={[0, -1.2, 0]} opacity={0.35} scale={20} blur={2} far={4} />
                </Suspense>

                <CameraRig activeParameter={activeFeatureId} annotations={annotations} geometryInfo={geometryInfo} />
                {geometryInfo && (
                    <DimensionOverlay
                        annotations={annotations} activeParameter={activeFeatureId}
                        geometryScale={geometryScale} geometryCenter={geometryCenter}
                        onSelectParameter={onSelectParameter} onHoverParameter={onHoverParameter}
                    />
                )}
                <OrbitControls makeDefault enableDamping dampingFactor={0.05} minPolarAngle={0} maxPolarAngle={Math.PI / 1.75} />
            </Canvas>

            {/* Top Left Status Bar */}
            <div className="absolute top-4 left-4 z-10">
                <div className="flex items-center gap-2.5 rounded-md border border-[#3C3C3C]/60 bg-[#252526]/80 backdrop-blur-md px-3.5 py-2 shadow-lg transition-all duration-300 hover:bg-[#252526]">
                    <div className={`size-1.5 rounded-full shadow-sm ${isCompiling ? 'bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]' : hasGeometry ? 'bg-[#007ACC] shadow-[0_0_8px_rgba(0,122,204,0.6)]' : 'bg-[#A6A6A6]'}`} />
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#D4D4D4]">{statusText}</span>
                </div>
            </div>

            {hasGeometry && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center gap-2 rounded-full border border-[#3C3C3C]/50 bg-[#252526]/80 backdrop-blur-md px-4 py-1.5 shadow-xl">
                        <MousePointer2 size={12} className="text-[#A6A6A6]" />
                        <span className="font-sans text-[10px] font-medium tracking-wide text-[#D4D4D4]">Click mesh to focus parameter</span>
                    </div>
                </div>
            )}

            {!hasGeometry && !isCompiling && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 pointer-events-none">
                    <div className="flex size-14 items-center justify-center rounded-2xl bg-[#252526]/50 border border-[#3C3C3C] shadow-2xl backdrop-blur-xl animate-in zoom-in duration-700">
                        <Loader2 size={24} className="text-[#A6A6A6] opacity-50" />
                    </div>
                    <div className="text-center animate-in fade-in slide-in-from-bottom-2 duration-700 delay-100">
                        <p className="font-sans text-xs font-semibold tracking-wide text-[#D4D4D4]">Awaiting Geometry</p>
                        <p className="mt-1 font-sans text-[11px] text-[#A6A6A6]">Upload a blueprint or prompt to begin</p>
                    </div>
                </div>
            )}
        </section>
    );
});