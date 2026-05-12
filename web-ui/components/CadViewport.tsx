'use client';

import { OrbitControls, PerspectiveCamera, Stage, Edges, Float, ContactShadows } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { Loader2, MousePointer2 } from 'lucide-react';
import { Suspense, useState } from 'react';

type CadViewportProps = {
    stlUrl: string | null;
    statusText: string;
    isRecompiling: boolean;
    hasStl: boolean;
    onDownloadStl: () => void;
    children?: React.ReactNode;
    onSelectPart?: (partName: string) => void;
};

export function CadViewport({ stlUrl, statusText, isRecompiling, children, onSelectPart, hasStl, onDownloadStl }: CadViewportProps) {
    const [hovered, setHovered] = useState<string | null>(null);

    return (
        <section className="relative flex h-full w-full flex-col overflow-hidden bg-transparent cursor-crosshair">
            <header className="absolute top-0 inset-x-0 h-20 flex items-start justify-between p-6 z-10 pointer-events-none">
                <div className="pointer-events-auto bg-black/40 backdrop-blur-md p-3 rounded-xl border border-white/5">
                    <div className="flex items-center gap-3">
                        <div className={`size-2 rounded-full ${stlUrl ? 'bg-cyan-500 shadow-[0_0_15px_#06b6d4]' : 'bg-amber-500 animate-pulse'}`} />
                        <div className="flex flex-col">
                            <span className="text-[10px] font-bold text-zinc-100 uppercase tracking-widest">{statusText}</span>
                            <span className="text-[8px] text-zinc-500 uppercase tracking-tighter">WASM Render Thread: Active</span>
                        </div>
                    </div>
                </div>

                <div className="pointer-events-auto flex gap-2">
                    {hovered && (
                        <div className="bg-cyan-500/10 border border-cyan-500/20 px-3 py-1.5 rounded-md flex items-center gap-2">
                            <MousePointer2 size={10} className="text-cyan-400" />
                            <span className="text-[9px] font-bold text-cyan-400 uppercase tracking-widest">{hovered}</span>
                        </div>
                    )}
                    {hasStl && (
                        <button 
                            onClick={onDownloadStl}
                            className="bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-lg text-[10px] font-bold text-zinc-400 hover:text-zinc-100 hover:border-zinc-500 transition-all"
                        >
                            EXPORT STL
                        </button>
                    )}
                </div>
            </header>

            {/* This flex-1 wrapper strictly bounds the Canvas to the remaining height */}
            <div className="relative flex-1 h-full w-full">
                <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} className="h-full w-full outline-none">
                    <PerspectiveCamera makeDefault position={[10, 10, 10]} fov={25} />
                    
                    <Suspense fallback={null}>
                        <Stage intensity={0.5} environment="warehouse" adjustCamera={false}>
                            <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.5}>
                                <group 
                                    onPointerOver={(e) => { e.stopPropagation(); setHovered(e.object.name || null); }}
                                    onPointerOut={() => setHovered(null)}
                                    onClick={(e) => { e.stopPropagation(); onSelectPart?.(e.object.name); }}
                                >
                                    {children}
                                    <Edges color="#06b6d4" threshold={15} opacity={0.3} transparent />
                                </group>
                            </Float>
                        </Stage>
                        <ContactShadows position={[0, -1, 0]} opacity={0.4} scale={20} blur={2.4} far={4.5} />
                    </Suspense>

                    <gridHelper args={[50, 50, '#1a1a1a', '#0a0a0a']} position={[0, -0.01, 0]} />
                    <OrbitControls makeDefault enableDamping minPolarAngle={0} maxPolarAngle={Math.PI / 1.75} />
                </Canvas>
            </div>

            {!stlUrl && !isRecompiling && (
                <div className="absolute inset-0 flex items-center justify-center p-12 z-0 pointer-events-none">
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="size-96 glow-bg blur-[80px] opacity-10 bg-cyan-500" />
                    </div>
                    <div className="max-w-sm text-center relative z-10 pointer-events-auto">
                        <div className="inline-flex size-14 items-center justify-center rounded-3xl bg-zinc-900/40 text-zinc-600 mb-8 border border-white/5 shadow-2xl backdrop-blur-md">
                            <Loader2 size={28} className="opacity-40" />
                        </div>
                        <h3 className="text-xs font-black text-zinc-100 uppercase tracking-[0.4em] mb-4">Awaiting Geometry</h3>
                        <p className="text-[11px] text-zinc-500 leading-relaxed font-medium max-w-[280px] mx-auto uppercase tracking-wider opacity-60">
                            Initialize the neural pipeline by uploading a technical blueprint.
                        </p>
                    </div>
                </div>
            )}

            {isRecompiling && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-20 animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-4">
                        <div className="relative">
                            <div className="absolute inset-0 size-8 rounded-full bg-cyan-500/10 animate-ping" />
                            <Loader2 size={32} className="text-cyan-500 animate-spin" />
                        </div>
                        <span className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-500/80">Compiling Mesh</span>
                    </div>
                </div>
            )}
        </section>
    );
}