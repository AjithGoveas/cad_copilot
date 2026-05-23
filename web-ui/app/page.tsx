'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Edges, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { 
    ArrowRight, Code2, SlidersHorizontal, MessageSquare, 
    Upload, GitCommit, Box, FileCode, Cpu, Square, Circle, Plus,
    Activity, TerminalSquare, Layers, Play,
    X, Minus
} from 'lucide-react';

// ─── CONFIGURATION ──────────────────────────────────────────────────────────
const LANDING_CTA_CONFIG = {
    mode: 'playground',
    authUrl: '/app/login',
    playgroundUrl: '/app/demo'
};

// ─── 3D HERO COMPONENT (CNC MILLING HEAD) ───────────────────────────────────
function IsometricAssembly() {
    const spindleRef = useRef<THREE.Group>(null);
    const toolRef = useRef<THREE.Mesh>(null);
    const wholeGroupRef = useRef<THREE.Group>(null);
    
    useFrame((state) => {
        const time = state.clock.elapsedTime;
        
        if (toolRef.current) toolRef.current.rotation.y += 0.8; // Spindle spinning
        
        if (spindleRef.current) {
            spindleRef.current.position.x = Math.sin(time * 2) * 1.0;
            spindleRef.current.position.z = Math.cos(time * 1.5) * 1.0;
            spindleRef.current.position.y = 1.0 + Math.abs(Math.sin(time * 4)) * 0.15; // Plunge
        }

        if (wholeGroupRef.current) wholeGroupRef.current.position.y = Math.sin(time * 2) * 0.1;
    });

    const whiteMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
    const blueMat = new THREE.MeshStandardMaterial({ color: '#4F46E5', roughness: 1 }); // Ultramarine Accent
    const darkMat = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 1 });

    return (
        <group ref={wholeGroupRef} rotation={[0, Math.PI / 4, 0]}>
            {/* Raw Material Workpiece */}
            <mesh position={[0, -0.5, 0]} material={whiteMat}>
                <boxGeometry args={[4, 1, 4]} />
                <Edges scale={1.001} threshold={15} color="#111111" />
            </mesh>

            {/* Fixture plate */}
            <mesh position={[0, -1.2, 0]} material={darkMat}>
                <boxGeometry args={[5, 0.4, 5]} />
                <Edges scale={1.001} threshold={15} color="#111111" />
            </mesh>
            
            {/* CNC Spindle Assembly */}
            <group ref={spindleRef}>
                <mesh position={[0, 2.2, 0]} material={darkMat}>
                    <boxGeometry args={[1.2, 1.0, 1.2]} />
                    <Edges scale={1.001} threshold={15} color="#111111" />
                </mesh>
                <mesh position={[0, 1.0, 0]} material={whiteMat}>
                    <cylinderGeometry args={[0.8, 0.8, 1.4, 16]} />
                    <Edges scale={1.001} threshold={15} color="#111111" />
                </mesh>
                <mesh position={[0, 0.1, 0]} material={blueMat}>
                    <cylinderGeometry args={[0.5, 0.3, 0.6, 16]} />
                    <Edges scale={1.001} threshold={15} color="#111111" />
                </mesh>
                <mesh ref={toolRef} position={[0, -0.4, 0]} material={darkMat}>
                    <cylinderGeometry args={[0.12, 0.12, 0.8, 6]} />
                    <Edges scale={1.001} threshold={15} color="#111111" />
                </mesh>
            </group>
        </group>
    );
}

// ─── ANIMATION WRAPPER ──────────────────────────────────────────────────────
function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode, delay?: number, className?: string }) {
    const [isVisible, setIsVisible] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) setIsVisible(true);
        }, { threshold: 0.1 });
        if (ref.current) observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div 
            ref={ref}
            style={{ transitionDelay: `${delay}ms` }}
            className={`transition-transform duration-500 ease-out ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'
            } ${className}`}
        >
            {children}
        </div>
    );
}

// ─── SAFE HYDRATED DECORATIVE PATTERN ───────────────────────────────────────
const GeometricPattern = ({ className }: { className?: string }) => {
    const [mounted, setMounted] = useState(false);
    // Explicitly mount on client to prevent Next.js Hydration Mismatches
    useEffect(() => setMounted(true), []);
    if (!mounted) return <div className={`w-48 ${className}`} />;

    return (
        <div className={`flex flex-wrap gap-2 text-[#111111] w-48 opacity-20 ${className}`}>
            {Array.from({ length: 24 }).map((_, i) => {
                const icons = [<Square size={12} key="1"/>, <Circle size={12} key="2"/>, <Plus size={14} key="3"/>];
                return <div key={i}>{icons[Math.floor(Math.random() * icons.length)]}</div>;
            })}
        </div>
    );
};

// ─── MAIN LANDING PAGE ──────────────────────────────────────────────────────
export default function LandingPage() {
    const router = useRouter();
    const [activeMatrixTab, setActiveMatrixTab] = useState<'step' | 'dxf' | 'stl'>('step');
    const [activeIdeTab, setActiveIdeTab] = useState<'chat' | 'editor' | 'history'>('editor');

    const handleCtaNavigation = () => {
        router.push(LANDING_CTA_CONFIG.mode === 'playground' ? LANDING_CTA_CONFIG.playgroundUrl : LANDING_CTA_CONFIG.authUrl);
    };

    return (
        // ── GLOBAL BACKGROUND: Industrial Grey (#E2E4E9) for Maximum Pop ──
        <div className="min-h-screen bg-[#E2E4E9] text-[#111111] font-sans selection:bg-[#FFC900] selection:text-[#111111] overflow-x-hidden">
            
            {/* ── HEADER ── */}
            <header className="fixed top-0 z-50 w-full border-b-4 border-[#111111] bg-[#E2E4E9] px-6 py-4 flex justify-between items-center">
                <div className="font-sans text-xl font-black text-[#111111] flex items-center gap-2">
                    <div className="bg-[#111111] text-white p-1">
                        <Box size={20} strokeWidth={3} />
                    </div>
                    CAD_COPILOT
                </div>
                <button 
                    onClick={handleCtaNavigation}
                    className="px-6 py-2 bg-[#FFC900] text-[#111111] text-xs font-black uppercase tracking-widest border-2 border-[#111111] shadow-[4px_4px_0px_0px_rgba(17,17,17,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[2px_2px_0px_0px_rgba(17,17,17,1)] active:translate-y-[4px] active:translate-x-[4px] active:shadow-none transition-all"
                >
                    Console
                </button>
            </header>

            {/* ── HERO ── */}
            <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-32 px-6 max-w-7xl mx-auto flex flex-col lg:flex-row items-center gap-12 min-h-screen">
                <GeometricPattern className="absolute top-32 left-6 hidden lg:flex" />
                <GeometricPattern className="absolute bottom-10 right-6 hidden lg:flex justify-end" />

                <div className="flex-1 relative z-10 space-y-8">
                    <FadeIn>
                        <div className="inline-flex border-2 border-[#111111] bg-[#FFC900] px-3 py-1 font-bold text-xs uppercase tracking-widest shadow-[4px_4px_0px_0px_rgba(17,17,17,1)] mb-4">
                            <Activity size={14} className="inline mr-2 text-[#111111]" /> Live Engine V2
                        </div>
                        <h1 className="text-6xl lg:text-[6.5rem] font-black text-[#111111] leading-[0.9] tracking-tighter">
                            Agentic <br />
                            <span className="text-white drop-shadow-[4px_4px_0px_rgba(17,17,17,1)]">Modelling</span>
                        </h1>
                    </FadeIn>
                    
                    <FadeIn delay={150}>
                        <p className="text-lg text-[#111111]/80 max-w-lg leading-relaxed font-bold">
                            Upload a PDF blueprint, chat with the geometry engine, and export mathematically perfect STEP, STL, and DXF files directly from your browser context.
                        </p>
                    </FadeIn>

                    <FadeIn delay={300} className="flex gap-4 pt-4">
                        <button 
                            onClick={handleCtaNavigation}
                            className="bg-[#4F46E5] text-white px-10 py-5 font-black text-sm uppercase tracking-widest flex items-center gap-3 border-4 border-[#111111] shadow-[6px_6px_0px_0px_rgba(17,17,17,1)] hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-[4px_4px_0px_0px_rgba(17,17,17,1)] active:translate-y-[6px] active:translate-x-[6px] active:shadow-none transition-all"
                        >
                            Start Compiling <ArrowRight size={18} />
                        </button>
                    </FadeIn>
                </div>

                {/* ── LIVE ISOMETRIC CANVAS ── */}
                <FadeIn delay={400} className="flex-1 w-full h-[500px] lg:h-[700px] relative">
                    <div className="absolute inset-0 bg-white border-4 border-[#111111] shadow-[16px_16px_0px_0px_rgba(17,17,17,1)] rounded-xl overflow-hidden blueprint-grid">
                        <style>{`
                            .blueprint-grid {
                                background-image: linear-gradient(to right, rgba(17, 17, 17, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(17, 17, 17, 0.08) 1px, transparent 1px);
                                background-size: 32px 32px;
                            }
                        `}</style>
                        
                        <Canvas orthographic camera={{ position: [10, 10, 10], zoom: 60 }} className="w-full h-full">
                            <ambientLight intensity={1.2} />
                            <directionalLight position={[10, 20, 5]} intensity={1.5} />
                            <IsometricAssembly />
                            <ContactShadows position={[0, -2.5, 0]} opacity={0.6} scale={15} blur={1} far={4} color="#111111" />
                            {/* Force camera target so rendering works universally across browsers */}
                            <OrbitControls makeDefault enableZoom={false} enablePan={false} autoRotate={false} />
                        </Canvas>

                        <div className="absolute top-6 left-6 font-mono text-[10px] font-bold text-[#111111] border-2 border-[#111111] px-2 py-1 bg-white shadow-[2px_2px_0px_0px_rgba(17,17,17,1)] uppercase">
                            Kinematic_Solver
                        </div>
                        <div className="absolute bottom-6 right-6 font-mono text-[10px] font-bold text-white border-2 border-[#111111] px-2 py-1 bg-[#4F46E5] shadow-[2px_2px_0px_0px_rgba(17,17,17,1)] uppercase">
                            Spindle: 4000 RPM
                        </div>
                    </div>
                </FadeIn>
            </section>

            {/* ── JETBRAINS-STYLE IDE WORKSPACE SECTION ── */}
            <section className="py-32 px-6 max-w-7xl mx-auto border-t-4 border-[#111111] bg-[#FFC900]">
                <FadeIn>
                    <div className="flex flex-col md:flex-row justify-between items-end mb-12">
                        <div>
                            <h2 className="text-5xl lg:text-7xl font-black text-[#111111] tracking-tighter uppercase mb-4">
                                The Integrated <br/> Workspace.
                            </h2>
                            <p className="font-bold text-[#111111]/80 max-w-lg">A developer-first environment. Chat with the visual parser, edit the raw parametric syntax, and track every version in a powerful dark-mode IDE.</p>
                        </div>
                    </div>
                </FadeIn>

                <FadeIn delay={150}>
                    {/* IDE Window Container */}
                    <div className="w-full h-[650px] border-4 border-[#111111] bg-[#0A0A0B] shadow-[16px_16px_0px_0px_rgba(17,17,17,1)] rounded-xl overflow-hidden flex flex-col font-sans">
                        
                        {/* IDE Header */}
                        <div className="h-12 border-b-2 border-[#27272A] bg-[#18181B] flex items-center justify-between px-4">
                            <div className="flex gap-1.5 group">
                                <div className="size-3 rounded-full bg-[#FF5F56] flex items-center justify-center cursor-pointer">
                                    <X size={8} strokeWidth={4} className="text-[#4C0002] opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="size-3 rounded-full bg-[#FFBD2E] flex items-center justify-center cursor-pointer">
                                    <Minus size={8} strokeWidth={4} className="text-[#5C3E00] opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <div className="size-3 rounded-full bg-[#27C93F] flex items-center justify-center cursor-pointer">
                                    <Square size={8} strokeWidth={4} className="text-[#024D0F] opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </div>
                            <div className="flex bg-[#27272A] rounded-md p-1">
                                {(['editor', 'chat', 'history'] as const).map(tab => (
                                    <button 
                                        key={tab}
                                        onClick={() => setActiveIdeTab(tab)}
                                        className={`px-4 py-1 text-[10px] font-bold uppercase tracking-widest rounded ${activeIdeTab === tab ? 'bg-[#3F3F46] text-white shadow-sm' : 'text-[#A1A1AA] hover:text-white'}`}
                                    >
                                        {tab}
                                    </button>
                                ))}
                            </div>
                            <div className="text-[#A1A1AA] flex gap-3">
                                <Play size={14} className="fill-[#10B981] text-[#10B981]" />
                                <TerminalSquare size={14} />
                            </div>
                        </div>

                        {/* IDE Body */}
                        <div className="flex-1 flex overflow-hidden">
                            {/* Left Sidebar (Icons) */}
                            <div className="w-12 border-r-2 border-[#27272A] bg-[#18181B] flex flex-col items-center py-4 gap-6 text-[#71717A]">
                                <Layers size={18} className={activeIdeTab === 'editor' ? 'text-[#FFC900]' : 'hover:text-white'} />
                                <MessageSquare size={18} className={activeIdeTab === 'chat' ? 'text-[#FFC900]' : 'hover:text-white'} />
                                <GitCommit size={18} className={activeIdeTab === 'history' ? 'text-[#FFC900]' : 'hover:text-white'} />
                            </div>

                            {/* Main Content Area */}
                            <div className="flex-1 bg-[#0A0A0B] p-6 overflow-hidden relative">
                                
                                {/* 1. Editor View */}
                                {activeIdeTab === 'editor' && (
                                    <div className="flex h-full gap-6 animate-in fade-in duration-300">
                                        <div className="flex-1 font-mono text-sm leading-loose">
                                            <div className="text-[#71717A] mb-4">// CAD_Copilot Generated OpenSCAD</div>
                                            <div><span className="text-[#C678DD]">flange_d</span> <span className="text-[#56B6C2]">=</span> <span className="text-[#D19A66]">42.0</span>;</div>
                                            <div><span className="text-[#C678DD]">bore_d</span> <span className="text-[#56B6C2]">=</span> <span className="text-[#D19A66]">12.5</span>;</div>
                                            <div><span className="text-[#C678DD]">shaft_h</span> <span className="text-[#56B6C2]">=</span> <span className="text-[#D19A66]">80.0</span>;</div>
                                            <br/>
                                            <div><span className="text-[#E06C75]">module</span> <span className="text-[#61AFEF]">main_assembly</span>() &#123;</div>
                                            <div className="pl-6"><span className="text-[#E06C75]">difference</span>() &#123;</div>
                                            <div className="pl-12 text-[#ABB2BF]"><span className="text-[#56B6C2]">cylinder</span>(d=flange_d, h=5, center=<span className="text-[#D19A66]">true</span>);</div>
                                            <div className="pl-12 text-[#ABB2BF]"><span className="text-[#56B6C2]">cylinder</span>(d=bore_d, h=shaft_h, center=<span className="text-[#D19A66]">true</span>);</div>
                                            <div className="pl-6 text-[#ABB2BF]">&#125;</div>
                                            <div className="text-[#ABB2BF]">&#125;</div>
                                        </div>
                                        {/* Param Inspector Sidebar */}
                                        <div className="w-64 border-l-2 border-[#27272A] pl-6 flex flex-col gap-4">
                                            <div className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest mb-2">Live Parameters</div>
                                            {[
                                                { label: 'flange_d', val: '42.0' },
                                                { label: 'bore_d', val: '12.5', active: true },
                                                { label: 'shaft_h', val: '80.0' }
                                            ].map(p => (
                                                <div key={p.label} className={`p-3 rounded border-2 ${p.active ? 'border-[#4F46E5] bg-[#4F46E5]/10' : 'border-[#27272A] bg-[#18181B]'}`}>
                                                    <div className="flex justify-between text-xs font-mono mb-2">
                                                        <span className={p.active ? 'text-[#4F46E5]' : 'text-[#A1A1AA]'}>{p.label}</span>
                                                        <span className="text-white">{p.val}</span>
                                                    </div>
                                                    <div className="h-1 bg-[#27272A] rounded-full"><div className={`h-full ${p.active ? 'bg-[#4F46E5]' : 'bg-[#52525B]'}`} style={{width: '60%'}}/></div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* 2. Chat View */}
                                {activeIdeTab === 'chat' && (
                                    <div className="flex flex-col h-full max-w-2xl mx-auto justify-end pb-8 animate-in fade-in duration-300 gap-6">
                                        <div className="flex justify-end">
                                            <div className="bg-[#27272A] text-[#E4E4E7] text-sm p-4 rounded-xl rounded-tr-none border border-[#3F3F46] max-w-[80%]">
                                                Increase the bore diameter to 15mm and add a 2mm chamfer to the top edge of the flange.
                                            </div>
                                        </div>
                                        <div className="flex justify-start">
                                            <div className="bg-[#FFC900]/10 border border-[#FFC900]/30 text-[#FFC900] text-sm p-4 rounded-xl rounded-tl-none max-w-[90%]">
                                                <p className="font-bold mb-2 flex items-center gap-2"><Cpu size={14}/> Engine Context Synced</p>
                                                Done. I updated `bore_d` to 15.0 and appended a new boolean subtraction module to handle the 2mm chamfer on the top plane. 
                                            </div>
                                        </div>
                                        <div className="mt-4 border-2 border-[#27272A] rounded-lg p-2 flex items-center gap-3 bg-[#18181B]">
                                            <Upload size={16} className="text-[#A1A1AA] ml-2" />
                                            <div className="text-[#A1A1AA] text-sm font-mono flex-1">Type your intent or drop a blueprint...</div>
                                        </div>
                                    </div>
                                )}

                                {/* 3. History View */}
                                {activeIdeTab === 'history' && (
                                    <div className="h-full animate-in fade-in duration-300 max-w-xl">
                                        <div className="text-[10px] font-bold text-[#A1A1AA] uppercase tracking-widest mb-6">Version Control Timeline</div>
                                        <div className="flex flex-col gap-0 relative">
                                            <div className="absolute left-[11px] top-4 bottom-8 w-[2px] bg-[#27272A]" />
                                            {[
                                                { id: 'v1.4', msg: 'Added 2mm chamfer to flange top', time: 'Just now', active: true },
                                                { id: 'v1.3', msg: 'Adjusted bore_d from 12.5 to 15.0', time: '2 mins ago', active: false },
                                                { id: 'v1.2', msg: 'Automated dimension extraction from PDF', time: '14 mins ago', active: false },
                                                { id: 'v1.1', msg: 'Blueprint parsed (gear_housing_rev2.pdf)', time: '15 mins ago', active: false },
                                            ].map((h, i) => (
                                                <div key={h.id} className="flex gap-6 pb-8 relative z-10">
                                                    <div className={`mt-1 size-6 rounded-full border-4 border-[#0A0A0B] flex items-center justify-center ${h.active ? 'bg-[#10B981]' : 'bg-[#52525B]'}`} />
                                                    <div>
                                                        <div className="flex items-center gap-3 mb-1">
                                                            <span className="font-mono text-xs font-bold text-[#A1A1AA]">{h.id}</span>
                                                            <span className="text-sm font-bold text-white">{h.msg}</span>
                                                        </div>
                                                        <div className="text-xs text-[#52525B] font-mono">{h.time}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                            </div>
                        </div>
                    </div>
                </FadeIn>
            </section>

            {/* ── EXPORT MATRIX ── */}
            <section id="matrix" className="py-32 px-6 max-w-7xl mx-auto border-t-4 border-[#111111]">
                <FadeIn>
                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-8 mb-16">
                        <div>
                            <h2 className="text-5xl lg:text-7xl font-black text-[#111111] tracking-tighter uppercase">Export <br/> Formats.</h2>
                        </div>
                        <div className="flex bg-white border-4 border-[#111111] shadow-[6px_6px_0px_0px_rgba(17,17,17,1)]">
                            {(['step', 'dxf', 'stl'] as const).map(tab => (
                                <button
                                    key={tab}
                                    onClick={() => setActiveMatrixTab(tab)}
                                    className={`px-8 py-4 text-base font-black uppercase tracking-widest border-r-4 border-[#111111] last:border-r-0 transition-colors ${
                                        activeMatrixTab === tab ? 'bg-[#111111] text-white' : 'bg-white text-[#111111] hover:bg-[#111111]/5'
                                    }`}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>
                    </div>
                </FadeIn>

                <div className="grid lg:grid-cols-2 gap-12 h-[450px]">
                    <FadeIn className="h-full">
                        {/* Pure White Background makes this jump off the Grey page */}
                        <div className="h-full border-4 border-[#111111] bg-white p-12 shadow-[8px_8px_0px_0px_rgba(17,17,17,1)] flex flex-col justify-center">
                            {activeMatrixTab === 'step' && (
                                <div>
                                    <Box size={48} className="text-[#4F46E5] mb-8" strokeWidth={2.5} />
                                    <h3 className="text-4xl font-black text-[#111111] mb-4 uppercase tracking-tight">STEP (B-Rep)</h3>
                                    <p className="text-[#111111]/70 font-bold text-lg leading-relaxed">Mathematically pure NURBS curves compiled headless via OpenCASCADE. Ready for industrial CNC machining workflows.</p>
                                </div>
                            )}
                            {activeMatrixTab === 'dxf' && (
                                <div>
                                    <FileCode size={48} className="text-[#FF3300] mb-8" strokeWidth={2.5} />
                                    <h3 className="text-4xl font-black text-[#111111] mb-4 uppercase tracking-tight">DXF (2D Vector)</h3>
                                    <p className="text-[#111111]/70 font-bold text-lg leading-relaxed">Automated orthographic projections. Generates precise silhouettes, section cuts, and multipage blueprints natively.</p>
                                </div>
                            )}
                            {activeMatrixTab === 'stl' && (
                                <div>
                                    <Cpu size={48} className="text-[#FFC900] mb-8" strokeWidth={2.5} />
                                    <h3 className="text-4xl font-black text-[#111111] mb-4 uppercase tracking-tight">STL (Mesh)</h3>
                                    <p className="text-[#111111]/70 font-bold text-lg leading-relaxed">Instantly rendered via local WebAssembly threads in the browser. Perfect for high-speed prototyping and 3D printing.</p>
                                </div>
                            )}
                        </div>
                    </FadeIn>
                    
                    <FadeIn delay={150} className="h-full border-4 border-[#111111] bg-[#FFC900] shadow-[8px_8px_0px_0px_rgba(17,17,17,1)] flex items-center justify-center relative overflow-hidden">
                        <style>{`
                            .bg-grid-small { background-image: radial-gradient(#111111 1px, transparent 1px); background-size: 20px 20px; opacity: 0.1; }
                        `}</style>
                        <div className="absolute inset-0 bg-grid-small" />

                        {activeMatrixTab === 'step' && (
                            <div className="size-56 rounded-full border-4 border-[#111111] flex items-center justify-center bg-white shadow-[8px_8px_0px_0px_rgba(17,17,17,1)] relative z-10">
                                <div className="font-sans font-black text-2xl text-[#111111] uppercase tracking-tighter">Exact_Math</div>
                            </div>
                        )}
                        {activeMatrixTab === 'dxf' && (
                            <div className="w-72 h-56 border-4 border-[#111111] bg-white shadow-[8px_8px_0px_0px_rgba(17,17,17,1)] relative flex flex-col justify-center items-center z-10">
                                <div className="w-full border-t-4 border-dashed border-[#FF3300]" />
                                <span className="mt-4 text-base font-black uppercase text-[#FF3300] bg-white px-2">A-A Slice Plane</span>
                            </div>
                        )}
                        {activeMatrixTab === 'stl' && (
                            <svg viewBox="0 0 100 100" className="size-64 stroke-[#111111] fill-white drop-shadow-[8px_8px_0px_rgba(17,17,17,1)] z-10" strokeWidth="2">
                                <polygon points="50,5 95,25 95,75 50,95 5,75 5,25" />
                                <line x1="5" y1="25" x2="50" y2="50" />
                                <line x1="95" y1="25" x2="50" y2="50" />
                                <line x1="50" y1="95" x2="50" y2="50" />
                            </svg>
                        )}
                    </FadeIn>
                </div>
            </section>

            {/* ── BOTTOM CTA ── */}
            <section className="py-40 px-6 text-center border-t-4 border-[#111111] bg-[#E2E4E9] relative overflow-hidden">
                <GeometricPattern className="absolute top-10 left-10 hidden md:block" />
                <GeometricPattern className="absolute bottom-10 right-10 hidden md:block" />
                
                <FadeIn className="relative z-10">
                    <h2 className="text-7xl lg:text-9xl font-black text-[#111111] tracking-tighter mb-12 uppercase">
                        Start <br/> Compiling.
                    </h2>
                    <button 
                        onClick={handleCtaNavigation}
                        className="bg-[#4F46E5] text-white px-16 py-8 font-black text-2xl uppercase tracking-widest transition-all inline-flex items-center gap-4 border-4 border-[#111111] shadow-[8px_8px_0px_0px_rgba(17,17,17,1)] hover:translate-y-[4px] hover:translate-x-[4px] hover:shadow-[4px_4px_0px_0px_rgba(17,17,17,1)] active:translate-y-[8px] active:translate-x-[8px] active:shadow-none"
                    >
                        Launch App <ArrowRight size={32} strokeWidth={3} />
                    </button>
                </FadeIn>
            </section>

            {/* ── FOOTER ── */}
            <footer className="border-t-4 border-[#111111] bg-[#111111] px-6 py-12 flex flex-col md:flex-row justify-between items-center gap-6 font-sans font-bold text-sm uppercase tracking-widest text-white">
                <div className="flex items-center gap-3">
                    <Box size={20} /> © {new Date().getFullYear()} CAD_COPILOT
                </div>
                <div className="flex gap-8">
                    <a href="#" className="hover:text-[#FFC900] transition-colors underline-offset-4">Docs</a>
                    <a href={LANDING_CTA_CONFIG.playgroundUrl} className="hover:text-[#FFC900] transition-colors underline-offset-4">Playground</a>
                    <a href={LANDING_CTA_CONFIG.authUrl} className="text-[#FFC900] hover:text-white transition-colors underline-offset-4">Login</a>
                </div>
            </footer>
        </div>
    );
}