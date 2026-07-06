'use client';

import { Suspense, useState, useMemo, memo, useCallback, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stage, ContactShadows, Center } from '@react-three/drei';
import { MousePointer2, Cuboid, Upload, AlertCircle } from 'lucide-react';
import { StlMesh } from '@/features/cad-workspace/components/StlMesh';
import { DimensionOverlay } from '@/features/cad-workspace/components/DimensionOverlay';
import { CameraRig } from '@/features/cad-workspace/components/CameraRig';
import { findNearestParameter } from '@/lib/openscadParameters';
import { QuickEditOverlay } from '@/features/cad-workspace/components/QuickEditOverlay';
import styles from './Viewport.module.css';

type Selection = { id: string; point: [number, number, number] };

type Props = {
    stlUrls: Map<string, { url: string; color?: string }>; statusText: string; isCompiling: boolean;
    selection?: Selection | null; onMeshClick?: (id: string | null, point: [number, number, number] | null) => void;
    annotations?: Record<string, any>; activeFeatureId?: string | null;
    onSelectParameter?: (key: string | null) => void; onHoverParameter?: (key: string | null) => void;
    onParameterUpdate?: (key: string, value: number) => void;
    targetPoint?: [number, number, number] | null;
    onImportStep?: (file: File) => Promise<void>;
    onSelectPrompt?: (prompt: string) => void;
    isReadOnly?: boolean;
    isImported?: boolean;
};

export const Viewport = memo(function Viewport({ 
    stlUrls, statusText, isCompiling, selection, onMeshClick,
    annotations = {}, activeFeatureId = null, onSelectParameter, onHoverParameter, onParameterUpdate,
    targetPoint = null, onImportStep, onSelectPrompt,
    isReadOnly = false, isImported = false,
}: Props) {
    const [geometryCenter, setGeometryCenter] = useState<[number, number, number]>([0, 0, 0]);
    const [geometryScale, setGeometryScale] = useState<number>(1.0);
    const [geometrySize, setGeometrySize] = useState<[number, number, number]>([10, 10, 10]);
    const [quickEdit, setQuickEdit] = useState<{ key: string; point: [number, number, number] } | null>(null);

    const [optimisticScale, setOptimisticScale] = useState<[number, number, number]>([1, 1, 1]);

    useEffect(() => {
        const handlePreview = (e: Event) => {
            const customEvent = e as CustomEvent<{ key: string; value: number }>;
            const { key, value } = customEvent.detail;
            
            if (annotations && annotations[key]) {
                const annotation = annotations[key];
                let dirX = 0, dirY = 0, dirZ = 0;
                
                if (annotation.p1 && annotation.p2) {
                    const dx = annotation.p2[0] - annotation.p1[0];
                    const dy = annotation.p2[1] - annotation.p1[1];
                    const dz = annotation.p2[2] - annotation.p1[2];
                    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
                    if (len > 0.001) {
                        dirX = dx / len;
                        dirY = dy / len;
                        dirZ = dz / len;
                    }
                } else if (annotation.axis) {
                    const ax = annotation.axis[0];
                    const ay = annotation.axis[1];
                    const az = annotation.axis[2];
                    const len = Math.sqrt(ax*ax + ay*ay + az*az);
                    if (len > 0.001) {
                        dirX = ax / len;
                        dirY = ay / len;
                        dirZ = az / len;
                    }
                } else {
                    dirX = 1;
                }

                const originalValue = annotation.value || 1.0;
                if (originalValue > 0.001) {
                    const ratio = value / originalValue;
                    let scaleX = 1;
                    let scaleY = 1;
                    let scaleZ = 1;
                    
                    if (Math.abs(dirX) > 0.8) scaleX = ratio;
                    else if (Math.abs(dirY) > 0.8) scaleY = ratio;
                    else if (Math.abs(dirZ) > 0.8) scaleZ = ratio;
                    else scaleX = ratio;

                    setOptimisticScale([scaleX, scaleY, scaleZ]);
                }
            }
        };

        window.addEventListener('cad-parameter-preview', handlePreview);
        return () => window.removeEventListener('cad-parameter-preview', handlePreview);
    }, [annotations]);

    useEffect(() => {
        setOptimisticScale([1, 1, 1]);
    }, [stlUrls, isCompiling]);

    const [loadingStep, setLoadingStep] = useState(0);
    const loadingSteps = useMemo(() => [
        "Initializing OpenSCAD-WASM engine...",
        "Analyzing 2D blueprint specifications...",
        "Calculating extrusion boundaries...",
        "Executing constructive solid geometry (CSG)...",
        "Triangulating 3D mesh vertices...",
        "Optimizing WebAssembly engine buffers..."
    ], []);

    useEffect(() => {
        if (!isCompiling) {
            setLoadingStep(0);
            return;
        }
        const interval = setInterval(() => {
            setLoadingStep((prev) => (prev + 1) % loadingSteps.length);
        }, 1800);
        return () => clearInterval(interval);
    }, [isCompiling, loadingSteps.length]);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImportClick = useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            onImportStep?.(file);
        }
        e.target.value = '';
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
            
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(39,39,42,0.4)_0%,transparent_70%)] pointer-events-none" />

            <Canvas
                shadows="percentage" dpr={[1, 2]}
                gl={{ antialias: true, logarithmicDepthBuffer: true, alpha: false }}
                className="absolute inset-0 z-0"
            >
                <PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />

                <Suspense fallback={null}>
                    <Stage intensity={0.6} environment="city" adjustCamera={false} shadows={false} preset="rembrandt" center={{ disable: true }}>
                        <Center
                            onCentered={({ center, width, height, depth }) => handleGeometryLoaded(
                                [center.x, center.y, center.z], [width, height, depth], 1.0
                            )}
                        >
                            <group scale={optimisticScale}>
                                {Array.from(stlUrls.entries()).map(([id, entry]) => (
                                    <StlMesh
                                        key={id} id={id} url={entry.url} color={entry.color}
                                        isSelected={selection?.id === id}
                                        onMeshClick={(pt: [number, number, number] | null) => handleMeshClick(id, pt)}
                                    />
                                ))}
                            </group>
                        </Center>

                        {annotations && (
                            <DimensionOverlay
                                annotations={annotations} activeParameter={activeFeatureId}
                                geometryScale={1.0} geometryCenter={geometryCenter}
                                onSelectParameter={onSelectParameter} onHoverParameter={onHoverParameter}
                            />
                        )}

                        {quickEdit && annotations[quickEdit.key] && (
                            <QuickEditOverlay
                                position={[
                                    quickEdit.point[0] - geometryCenter[0],
                                    quickEdit.point[1] - geometryCenter[1],
                                    quickEdit.point[2] - geometryCenter[2]
                                ]}
                                parameterKey={quickEdit.key}
                                annotation={annotations[quickEdit.key]}
                                onUpdate={(key: string, val: number) => {
                                    onParameterUpdate?.(key, val);
                                    setQuickEdit(null);
                                }}
                                onCancel={() => setQuickEdit(null)}
                            />
                        )}
                    </Stage>
                </Suspense>

                <CameraRig activeParameter={activeFeatureId} annotations={annotations} geometryInfo={geometryInfo} />

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
            {!hasGeometry && !isImported && !isCompiling && (
                isReadOnly ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10 overflow-y-auto">
                        <div className="flex flex-col items-center max-w-xl text-center pointer-events-none animate-in fade-in duration-700">
                            <div className="relative flex size-14 items-center justify-center rounded-2xl bg-zinc-900/60 border border-zinc-800/80 shadow-xl backdrop-blur-sm mb-4">
                                <div className="absolute inset-0 rounded-2xl bg-zinc-800/25 animate-pulse" />
                                <AlertCircle size={24} strokeWidth={1.5} className="text-zinc-500" />
                            </div>
                            <h3 className="font-sans text-lg font-bold tracking-wide text-zinc-100 bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 to-zinc-400">Empty Shared Workbench</h3>
                            <p className="mt-2 font-sans text-xs text-zinc-400 leading-relaxed max-w-md">
                                This shared workspace does not contain any compiled geometry. The source OpenSCAD script is empty or failed to build.
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10 overflow-y-auto">
                        <div className="flex flex-col items-center max-w-xl text-center mb-8 pointer-events-none">
                            <div className="relative flex size-14 items-center justify-center rounded-2xl bg-zinc-900/60 border border-zinc-800/80 shadow-xl backdrop-blur-sm animate-in zoom-in duration-1000 mb-4">
                                <div className="absolute inset-0 rounded-2xl bg-[#007ACC]/5 animate-pulse" />
                                <Cuboid size={24} strokeWidth={1.5} className="text-[#007ACC]" />
                            </div>
                            <h3 className="font-sans text-lg font-bold tracking-wide text-zinc-100 bg-clip-text text-transparent bg-gradient-to-r from-zinc-100 to-zinc-400">CADVΞX Workstation</h3>
                            <p className="mt-2 font-sans text-xs text-zinc-400 leading-relaxed max-w-md">
                                Welcome to your dynamic CAD workbench. Click any starter template below to instantly generate a parametric OpenSCAD model, or type your own instructions on the left.
                            </p>
                        </div>

                        {/* Starter Templates Grid */}
                        <div className="grid grid-cols-2 gap-4 w-full max-w-xl mb-6 pointer-events-auto">
                            {[
                                {
                                    title: '🔩 Flange Bracket',
                                    desc: 'High-torque mounting bracket with counterbore holes',
                                    prompt: 'Generate a heavy-duty mounting flange bracket with 4 counterbore screw holes'
                                },
                                {
                                    title: '⚙️ Spur Gear',
                                    desc: 'Parametric spur gear with teeth and hub keyway',
                                    prompt: 'Create a parametric spur gear with 18 teeth, 3mm module, and central hub'
                                },
                                {
                                    title: '📦 Electronics Box',
                                    desc: 'Project enclosure with mounting lugs and vents',
                                    prompt: 'Design a custom electronics project enclosure with mounting lugs and ventilation slots'
                                },
                                {
                                    title: '🔗 Shaft Coupler',
                                    desc: 'Rigid coupler for linking motor shaft to lead screw',
                                    prompt: 'Model a rigid clamping shaft coupler for linking a 5mm motor shaft to an 8mm lead screw'
                                }
                            ].map((tpl) => (
                                <button
                                    key={tpl.title}
                                    onClick={() => onSelectPrompt?.(tpl.prompt)}
                                    className="group flex flex-col items-start p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/40 hover:bg-[#1E1E1E]/80 hover:border-[#007ACC]/45 transition-all duration-300 text-left hover:shadow-[0_4px_20px_rgba(0,122,204,0.08)] hover:-translate-y-0.5 active:scale-[0.98] cursor-pointer"
                                >
                                    <span className="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors mb-1">{tpl.title}</span>
                                    <span className="text-[10px] text-zinc-500 leading-normal group-hover:text-zinc-400 transition-colors">{tpl.desc}</span>
                                </button>
                            ))}
                        </div>

                        <div className="flex items-center gap-3 pointer-events-auto">
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept=".step,.stp,.stl"
                                className="hidden"
                            />
                            {onImportStep && (
                                <button
                                    onClick={handleImportClick}
                                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-zinc-900/50 hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 text-[11px] font-semibold text-zinc-300 hover:text-zinc-100 transition-all shadow-md active:scale-95 cursor-pointer"
                                >
                                    <Upload size={12} className="text-[#007ACC]" />
                                    Import STEP / STL
                                </button>
                            )}
                        </div>
                    </div>
                )
            )}

            {/* Premium Loading State */}
            {!hasGeometry && isCompiling && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10 bg-[#09090b]/40 backdrop-blur-[2px] animate-in fade-in duration-500">
                    <div className="flex flex-col items-center max-w-md text-center">
                        <div className="relative flex size-24 items-center justify-center mb-6">
                            <div className={`absolute inset-0 rounded-full bg-gradient-to-tr from-blue-500 via-purple-500 to-pink-500 p-[2px] shadow-[0_0_20px_rgba(139,92,246,0.25)] ${styles.geminiSpin}`}>
                                <div className="h-full w-full rounded-full bg-[#09090b]" />
                            </div>
                            <div className="absolute -inset-1 rounded-full bg-gradient-to-tr from-blue-500/10 via-purple-500/10 to-pink-500/10 blur-md" />
                            <div className="relative animate-bounce duration-1000">
                                <Cuboid size={28} strokeWidth={1.5} className="text-indigo-300 drop-shadow-[0_0_8px_rgba(129,140,248,0.5)]" />
                            </div>
                        </div>
                        <h4 className={`font-sans text-xs font-bold tracking-widest uppercase mb-2.5 ${styles.geminiGradientText}`}>
                            Synthesizing Mesh
                        </h4>
                        <div className="h-4 flex items-center justify-center">
                            <p className="font-sans text-[11px] text-zinc-400 font-medium tracking-wide animate-pulse transition-all duration-300">
                                {loadingSteps[loadingStep]}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
});
