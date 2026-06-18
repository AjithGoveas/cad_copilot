'use client';

import { Suspense, useState, useMemo, memo, useCallback, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stage, ContactShadows, Center } from '@react-three/drei';
import { Loader2, MousePointer2, Cuboid, Upload } from 'lucide-react';
import { StlMesh } from './StlMesh';
import { DimensionOverlay } from './DimensionOverlay';
import { CameraRig } from './CameraRig';
import { findNearestParameter } from '@/lib/openscadParameters';
import { QuickEditOverlay } from './QuickEditOverlay';

type Selection = { id: string; point: [number, number, number] };

type Props = {
    stlUrls: Map<string, string>; statusText: string; isCompiling: boolean;
    selection?: Selection | null; onMeshClick?: (id: string | null, point: [number, number, number] | null) => void;
    annotations?: Record<string, any>; activeFeatureId?: string | null;
    onSelectParameter?: (key: string | null) => void; onHoverParameter?: (key: string | null) => void;
    onParameterUpdate?: (key: string, value: number) => void;
    targetPoint?: [number, number, number] | null;
    onImportStep?: (file: File) => Promise<void>;
};

export const Viewport = memo(function Viewport({ 
    stlUrls, statusText, isCompiling, selection, onMeshClick,
    annotations = {}, activeFeatureId = null, onSelectParameter, onHoverParameter, onParameterUpdate,
    targetPoint = null, onImportStep,
}: Props) {
    const [geometryCenter, setGeometryCenter] = useState<[number, number, number]>([0, 0, 0]);
    const [geometryScale, setGeometryScale] = useState<number>(1.0);
    const [geometrySize, setGeometrySize] = useState<[number, number, number]>([10, 10, 10]);
    const [quickEdit, setQuickEdit] = useState<{ key: string; point: [number, number, number] } | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImportStep?.(file);
        }
    }, [onImportStep]);

    const handleGeometryLoaded = useCallback((center: [number, number, number], size: [number, number, number], scale: number) => {
        setGeometryCenter(prev => prev[0] === center[0] && prev[1] === center[1] && prev[2] === center[2] ? prev : center);
        setGeometrySize(prev => prev[0] === size[0] && prev[1] === size[1] && prev[2] === size[2] ? prev : size);
        setGeometryScale(scale);
    }, []);

    const geometryInfo = useMemo(() => ({ center: geometryCenter, scale: geometryScale, size: geometrySize }), [geometryCenter, geometryScale, geometrySize]);
    const hasGeometry = stlUrls.size > 0;

    const handleMeshClick = useCallback((id: string | null, point: [number, number, number] | null) => {
        if (!point) {
            onMeshClick?.(id, null);
            setQuickEdit(null);
            return;
        }

        const nearestKey = findNearestParameter(point, annotations, geometryCenter, geometryScale, 5.0);
        if (nearestKey) {
            setQuickEdit({ key: nearestKey, point });
            onSelectParameter?.(nearestKey);
        } else {
            setQuickEdit(null);
            onMeshClick?.(id, point);
        }
    }, [annotations, geometryCenter, geometryScale, onMeshClick, onSelectParameter]);

    return (
        <section className="relative flex-1 overflow-hidden bg-[#09090b] shadow-[inset_0_0_80px_rgba(0,0,0,0.8)]">
            
            {/* Subtle radial glow behind the canvas to separate geometry from absolute black */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(39,39,42,0.4)_0%,transparent_70%)] pointer-events-none" />

            <Canvas
                shadows="percentage" dpr={[1, 2]}
                gl={{ antialias: true, logarithmicDepthBuffer: true, alpha: false }}
                className="absolute inset-0 z-0"
            >
                <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />

                <Suspense fallback={null}>
                    <Stage intensity={0.6} environment="city" adjustCamera={false} shadows="contact" preset="rembrandt" center={{ disable: true }}>
                        <Center
                            onCentered={({ center, width, height, depth }) => handleGeometryLoaded(
                                [center.x, center.y, center.z], [width, height, depth], 1.0
                            )}
                        >
                            {Array.from(stlUrls.entries()).map(([id, url]) => (
                                <StlMesh
                                    key={id} id={id} url={url}
                                    isSelected={selection?.id === id}
                                    onMeshClick={(pt) => handleMeshClick(id, pt)}
                                />
                            ))}
                        </Center>
                    </Stage>
                    {/* Softer contact shadow for realism */}
                    <ContactShadows position={[0, -1.2, 0]} opacity={0.6} scale={25} blur={2.5} far={4} color="#000000" />
                </Suspense>

                <CameraRig activeParameter={activeFeatureId} annotations={annotations} geometryInfo={geometryInfo} />
                
                {geometryInfo && (
                    <DimensionOverlay
                        annotations={annotations} activeParameter={activeFeatureId}
                        geometryScale={geometryScale} geometryCenter={geometryCenter}
                        onSelectParameter={onSelectParameter} onHoverParameter={onHoverParameter}
                    />
                )}
                
                {quickEdit && annotations[quickEdit.key] && (
                    <QuickEditOverlay
                        position={quickEdit.point}
                        parameterKey={quickEdit.key}
                        annotation={annotations[quickEdit.key]}
                        onUpdate={(key, val) => {
                            onParameterUpdate?.(key, val);
                            setQuickEdit(null);
                        }}
                        onCancel={() => setQuickEdit(null)}
                    />
                )}

                {targetPoint && (
                    <group position={targetPoint}>
                        <mesh renderOrder={9999}>
                            <sphereGeometry args={[0.1, 16, 16]} />
                            <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={0.9} />
                        </mesh>
                        <mesh renderOrder={9999}>
                            <sphereGeometry args={[0.25, 16, 16]} />
                            <meshBasicMaterial color="#3b82f6" depthTest={false} transparent opacity={0.3} />
                        </mesh>
                    </group>
                )}
                
                <OrbitControls makeDefault enableDamping dampingFactor={0.05} minPolarAngle={0} maxPolarAngle={Math.PI / 1.75} />
            </Canvas>

            {/* Top Left Status Pill */}
            <div className="absolute top-5 left-5 z-10">
                <div className="flex items-center gap-3 rounded-full border border-zinc-800/60 bg-zinc-900/60 backdrop-blur-xl px-4 py-2 shadow-xl transition-all duration-300">
                    <div className="relative flex size-2 items-center justify-center">
                        {isCompiling && <div className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />}
                        <div className={`relative inline-flex size-2 rounded-full ${isCompiling ? 'bg-blue-500' : hasGeometry ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                    </div>
                    <span className="font-sans text-[11px] font-semibold tracking-wider text-zinc-300">
                        {statusText}
                    </span>
                </div>
            </div>

            {/* Bottom Interaction Hint */}
            {hasGeometry && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 pointer-events-none animate-in slide-in-from-bottom-4 duration-500 fade-in">
                    <div className="flex items-center gap-2.5 rounded-full border border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md px-5 py-2 shadow-2xl">
                        <MousePointer2 size={14} className="text-zinc-400" />
                        <span className="font-sans text-[12px] font-medium tracking-wide text-zinc-300">
                            Select mesh or labels to focus
                        </span>
                    </div>
                </div>
            )}

            {/* Premium Empty State */}
            {!hasGeometry && !isCompiling && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 pointer-events-none z-10">
                    <div className="relative flex size-20 items-center justify-center rounded-3xl bg-zinc-900/50 border border-zinc-800/50 shadow-2xl backdrop-blur-sm animate-in zoom-in duration-1000">
                        <div className="absolute inset-0 rounded-3xl bg-blue-500/5 animate-pulse" />
                        <Cuboid size={32} strokeWidth={1.5} className="text-zinc-600" />
                    </div>
                    <div className="text-center flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-1000 delay-150">
                        <h3 className="font-sans text-sm font-medium tracking-wide text-zinc-300">Awaiting Geometry</h3>
                        <p className="mt-2 font-sans text-[13px] text-zinc-500 max-w-[250px] leading-relaxed mb-4">
                            Upload a blueprint or describe a shape in CADVΞX to begin generating.
                        </p>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".step,.stp"
                            className="hidden"
                        />
                        {onImportStep && (
                            <button
                                onClick={handleImportClick}
                                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-[11px] font-semibold text-zinc-200 transition-all shadow-xl active:scale-95 pointer-events-auto cursor-pointer"
                            >
                                <Upload size={13} className="text-blue-500" />
                                Import STEP File
                            </button>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
});