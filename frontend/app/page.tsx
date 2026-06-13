"use client"

import React, { useRef, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Cylinder, Box, Torus, Edges, Float, Environment } from '@react-three/drei'
import * as THREE from 'three'
import Link from 'next/link'
import { ArrowRight, Cuboid, Zap, Layers, Code2, FileCode, Sliders, Play, Terminal, Paperclip, ArrowUp, Sparkles, Share2, Download, ChevronDown, Check, Box as BoxIcon, Globe } from 'lucide-react'
import { getSession } from 'next-auth/react'

// --- CONFIGURATION ---
const LANDING_CTA_CONFIG = {
    mode: 'playground',
    authUrl: '/app/login',
    playgroundUrl: '/app/demo'
};

function CadAssembly({ isHovered, compilingState }: { isHovered: boolean; compilingState: 'idle' | 'compiling' | 'success' }) {
  const groupRef = useRef<THREE.Group>(null!)
  
  useFrame((state) => {
    if (groupRef.current) {
      let speed = 0.4
      if (compilingState === 'compiling') {
        speed = 4.5
      } else if (isHovered) {
        speed = 1.2
      }
      groupRef.current.rotation.y = state.clock.getElapsedTime() * speed
      groupRef.current.rotation.x = Math.sin(state.clock.getElapsedTime() * 0.3) * (isHovered ? 0.35 : 0.2)
      groupRef.current.rotation.z = Math.cos(state.clock.getElapsedTime() * 0.2) * 0.1
    }
  })

  // Vibrant VS Code Dark Modern matching colors
  const edgeColor = "#52525b"
  const bodyColor = "#2d2d30"
  
  const materialProps = {
    color: bodyColor,
    metalness: 0.7,
    roughness: 0.2,
    clearcoat: 0.3,
  }

  const accentMaterialProps = {
    color: "#007ACC",
    metalness: 0.8,
    roughness: 0.2,
  }

  return (
    <Float speed={compilingState === 'compiling' ? 5 : 2} rotationIntensity={isHovered ? 0.8 : 0.5} floatIntensity={1}>
      <group ref={groupRef} scale={1.25}>
        {/* Central Hub */}
        <Cylinder args={[0.6, 0.6, 1.2, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Cylinder>

        {/* Inner Shaft */}
        <Cylinder args={[0.2, 0.2, 2.8, 32]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...accentMaterialProps} />
        </Cylinder>

        {/* Spoke 1 */}
        <Box args={[2.2, 0.3, 0.3]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Box>

        {/* Spoke 2 */}
        <Box args={[0.3, 2.2, 0.3]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Box>

        {/* Outer Ring */}
        <Torus args={[1.1, 0.15, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...materialProps} />
          <Edges scale={1.001} color={edgeColor} />
        </Torus>
        
        {/* Secondary Ring */}
        <Torus args={[1.4, 0.05, 16, 64]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial {...materialProps} />
        </Torus>
        
        {/* Accent Caps */}
        <Cylinder args={[0.3, 0.3, 0.2, 32]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.65]}>
          <meshStandardMaterial {...accentMaterialProps} />
        </Cylinder>
        <Cylinder args={[0.3, 0.3, 0.2, 32]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.65]}>
          <meshStandardMaterial {...accentMaterialProps} />
        </Cylinder>
      </group>
    </Float>
  )
}

function Hero3D({ isHovered, compilingState }: { isHovered: boolean; compilingState: 'idle' | 'compiling' | 'success' }) {
  return (
    <div className="w-full h-full min-h-[400px] flex items-center justify-center">
      <Canvas camera={{ position: [2.5, 1.8, 4.2], fov: 42 } as any}>
        <ambientLight intensity={1.2} />
        <directionalLight position={[10, 10, 10]} intensity={2.5} castShadow />
        <directionalLight position={[-10, -10, -10]} intensity={1.5} color="#007ACC" />
        <Environment preset="city" />
        <CadAssembly isHovered={isHovered} compilingState={compilingState} />
        <OrbitControls enableZoom={false} autoRotate={compilingState !== 'compiling'} autoRotateSpeed={isHovered ? 1.5 : 0.5} />
      </Canvas>
    </div>
  )
}


function AnimatedSection({
  children,
  delay = 0,
  direction = 'up',
  duration = 0.8,
  amount = 0.05,
  className = ''
}: {
  children: React.ReactNode;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  duration?: number;
  amount?: number;
  className?: string;
}) {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setIsVisible(true)
    }, { threshold: 0.05 })
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])

  const getTranslate = () => {
    if (!isVisible) {
      const val = amount * 100
      switch (direction) {
        case 'up': return `translateY(${val}px)`
        case 'down': return `translateY(-${val}px)`
        case 'left': return `translateX(${val}px)`
        case 'right': return `translateX(-${val}px)`
      }
    }
    return 'none'
  }

  return (
    <div 
      ref={ref}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: getTranslate(),
        transition: `opacity ${duration}s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s, transform ${duration}s cubic-bezier(0.16, 1, 0.3, 1) ${delay}s`
      }}
      className={className}
    >
      {children}
    </div>
  )
}

function AnimatedCode() {
  const [codeText, setCodeText] = useState('')
  const fullCode = `// CADVEX Generated Model
$fn = 64;

// Base dimensions
outer_dia = 120.0;
inner_dia = 15.0;
thickness = 12.0;

// Flange hub geometry
difference() {
  union() {
    // Central Hub
    cylinder(h=thickness, d=30, center=true);
    // Outer Ring
    rotate_extrude() 
      translate([outer_dia/2 - 6, 0, 0]) 
      circle(d=thickness);
    // Radial Spokes
    for(i=[0:4]) {
      rotate([0, 0, i * 72])
        translate([outer_dia/4, 0, 0])
        cube([outer_dia/2, 6, 6], center=true);
    }
  }
  // Shaft Hole
  cylinder(h=thickness + 2, d=inner_dia, center=true);
}`

  useEffect(() => {
    let index = 0
    let timer: NodeJS.Timeout
    const type = () => {
      setCodeText(fullCode.slice(0, index))
      index++
      if (index <= fullCode.length) {
        timer = setTimeout(type, 20)
      } else {
        timer = setTimeout(() => {
          index = 0
          type()
        }, 8000)
      }
    }
    type()
    return () => clearTimeout(timer)
  }, [])

  const syntaxHighlight = (code: string) => {
    const lines = code.split('\n');
    return lines.map((line, i) => {
      if (line.trim().startsWith('//')) {
        return <div key={i} className="text-emerald-500">{line}</div>;
      }
      const tokens = line.split(/(\s+|\(|\)|\{|\}|;|=|,|\[|\])/);
      return (
        <div key={i} className="min-h-[14px]">
          {tokens.map((token, j) => {
            if (/^(difference|union|cylinder|rotate_extrude|translate|circle|rotate|for|cube)$/.test(token)) {
              return <span key={j} className="text-blue-400 font-semibold">{token}</span>;
            }
            if (/^\d+(\.\d+)?$/.test(token)) {
              return <span key={j} className="text-amber-400">{token}</span>;
            }
            if (/^(\$fn|outer_dia|inner_dia|thickness|i)$/.test(token)) {
              return <span key={j} className="text-purple-400 font-medium">{token}</span>;
            }
            return <span key={j}>{token}</span>;
          })}
        </div>
      );
    });
  }

  return (
    <pre className="font-mono text-[9px] leading-normal text-zinc-300 overflow-x-auto whitespace-pre select-none h-full max-h-[350px] p-1">
      <code>
        {syntaxHighlight(codeText)}
        <span className="animate-pulse text-blue-500 font-bold">|</span>
      </code>
    </pre>
  )
}

function ParamsView() {
  return (
    <pre className="font-mono text-[9px] leading-relaxed text-zinc-300 overflow-x-auto whitespace-pre select-none h-full max-h-[350px] p-1">
      <code>
        {"{\n"}
        {"  "}<span className="text-purple-400">"$fn"</span>: <span className="text-amber-400">64</span>,{"\n"}
        {"  "}<span className="text-purple-400">"outer_dia"</span>: <span className="text-amber-400">120.0</span>,{"\n"}
        {"  "}<span className="text-purple-400">"inner_dia"</span>: <span className="text-amber-400">15.0</span>,{"\n"}
        {"  "}<span className="text-purple-400">"thickness"</span>: <span className="text-amber-400">12.0</span>,{"\n"}
        {"  "}<span className="text-purple-400">"spoke_count"</span>: <span className="text-amber-400">5</span>{"\n"}
        {"}"}
      </code>
    </pre>
  )
}

export default function LandingPage() {
  const router = useRouter()
  const featuresRef = useRef<HTMLDivElement>(null)
  const ctaRef = useRef<HTMLDivElement>(null)
  const [ctaCanvasActive, setCtaCanvasActive] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [activeTab, setActiveTab] = useState<'code' | 'params'>('code')
  const [compilingState, setCompilingState] = useState<'idle' | 'compiling' | 'success'>('idle')
  const [isHovered, setIsHovered] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false)

  const handleCtaNavigation = (mode: string) => {
    if (isLoggedIn) {
      router.push('/app')
    } else {
      router.push(LANDING_CTA_CONFIG.mode === mode ? LANDING_CTA_CONFIG.playgroundUrl : LANDING_CTA_CONFIG.authUrl)
    }
  }

  const scrollToFeatures = (e: React.MouseEvent) => {
    e.preventDefault()
    featuresRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await getSession()
        setIsLoggedIn(Boolean(session))
      } catch (err) {
        setIsLoggedIn(false)
      }
    }
    checkSession()
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setCtaCanvasActive(entry.isIntersecting)
    }, { threshold: 0.01 })
    if (ctaRef.current) observer.observe(ctaRef.current)
    return () => observer.disconnect()
  }, [])

  const triggerToast = (msg: string) => {
    setToastMsg(msg)
    setTimeout(() => {
      setToastMsg(null)
    }, 2500)
  }

  const handleCompile = () => {
    if (compilingState === 'compiling') return;
    setCompilingState('compiling');
    setTimeout(() => {
      setCompilingState('success');
      triggerToast("Compilation successful!");
      setTimeout(() => {
        setCompilingState('idle');
      }, 1500);
    }, 1500);
  }

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation()
    triggerToast("Workspace share link copied to clipboard!")
  }

  const handleExportOption = (format: string) => {
    setExportDropdownOpen(false)
    triggerToast(`Exporting model as ${format.toUpperCase()}...`)
  }

  return (
    <div className="min-h-screen bg-[#181818] text-[#D4D4D4] selection:bg-[#007ACC]/30 overflow-hidden relative font-sans">
      {/* Background Glows matching the app environment */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#007ACC]/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] bg-blue-500/5 rounded-full blur-[120px]" />
      </div>

      {/* Navigation */}
      <header className="sticky top-0 z-50 w-full border-b border-[#2d2d2d] bg-[#1e1e1e]/80 backdrop-blur-md">
        <nav className="flex items-center justify-between px-6 py-4 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <div className="absolute inset-0 bg-[#007ACC] rounded-lg transform rotate-45 opacity-20"></div>
              <Cuboid className="w-6 h-6 text-[#007ACC] relative z-10" />
            </div>
            <span className="text-2xl font-bold tracking-[0.2em] bg-clip-text text-transparent bg-gradient-to-b from-white via-zinc-200 to-zinc-400 drop-shadow-sm select-none">
              CADVΞX
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={() => handleCtaNavigation('auth')}
              className="group relative inline-flex items-center justify-center px-6 py-2.5 text-sm font-semibold text-white transition-all duration-200 bg-[#007ACC] rounded-xl hover:bg-[#005999] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#007ACC] shadow-[0_0_20px_rgba(0,122,204,0.3)] hover:shadow-[0_0_30px_rgba(0,122,204,0.5)] cursor-pointer"
            >
              {isLoggedIn ? 'Go to Workspace' : 'Launch App'}
              {isLoggedIn && <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex flex-col items-center justify-center px-6 pt-20 pb-16 text-center max-w-5xl mx-auto">
        {/* Badge */}
        <AnimatedSection delay={0} direction="down" duration={0.6}>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#007ACC]/10 border border-[#007ACC]/20 text-[#007ACC] text-xs font-semibold tracking-wider uppercase mb-8 backdrop-blur-md shadow-[0_0_15px_rgba(0,122,204,0.1)] select-none">
            <Zap className="w-3.5 h-3.5 text-orange-400 fill-orange-400" /> INTELLIGENT 3D EVOLUTION
          </div>
        </AnimatedSection>

        {/* Headline */}
        <AnimatedSection delay={0.1} direction="up" duration={0.8}>
          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
            <span className="block text-transparent bg-clip-text bg-gradient-to-b from-white via-zinc-200 to-zinc-450 mb-2">
              Where 2D Evolves Into
            </span>
            <span className="block text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-[#007ACC] to-cyan-400 pb-2 drop-shadow-[0_0_25px_rgba(0,122,204,0.4)]">
              Intelligent 3D
            </span>
          </h1>
        </AnimatedSection>

        {/* Subheadline */}
        <AnimatedSection delay={0.2} direction="up" duration={0.8}>
          <p className="mt-6 text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
            The next generation AI-powered CAD workstation. Seamlessly transform your two-dimensional ideas into complex, intelligent three-dimensional models with unparalleled precision.
          </p>
        </AnimatedSection>

        {/* CTA Buttons */}
        <AnimatedSection delay={0.35} direction="up" duration={0.8}>
          <div className="mt-12 flex flex-col sm:flex-row items-center gap-6 justify-center">
            <button 
              onClick={() => handleCtaNavigation('playground')}
              className="group relative inline-flex items-center justify-center px-8 py-4 text-base font-bold text-white transition-all duration-200 bg-gradient-to-b from-blue-500 to-[#007ACC] border border-blue-400/30 rounded-2xl hover:from-blue-400 hover:to-[#005999] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#007ACC] shadow-[0_0_40px_rgba(0,122,204,0.3)] overflow-hidden cursor-pointer"
            >
              <div className="absolute inset-0 w-full h-full -ml-14 bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[20deg] group-hover:animate-[shimmer_1.5s_infinite]" />
              {isLoggedIn ? 'Open Workspace' : 'Try Workspace'}
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </button>

            <button 
              onClick={scrollToFeatures}
              className="inline-flex items-center justify-center px-8 py-4 text-base font-bold text-zinc-300 transition-all duration-200 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 hover:text-white backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.3)] cursor-pointer"
            >
              Learn More
            </button>
          </div>
        </AnimatedSection>
      </main>

      {/* Mockup / Visual — elegant, aligned width, outside the constrained main */}
      <AnimatedSection delay={0.5} direction="up" duration={1.0} amount={0.05} className="relative z-10 w-full px-4 pb-20">
        <div className="relative w-full max-w-5xl mx-auto h-[580px]" style={{ perspective: '2000px' }}>
          <div className="absolute inset-0 bg-gradient-to-t from-[#181818] via-transparent to-transparent z-10 rounded-t-3xl pointer-events-none" />
          
          <div 
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => {
              setIsHovered(false)
              setExportDropdownOpen(false)
            }}
            className="relative w-full h-full rounded-t-3xl border-t border-l border-r border-[#2d2d2d] bg-[#1e1e1e] overflow-hidden shadow-[0_-20px_50px_rgba(0,122,204,0.15),0_0_1px_1px_rgba(255,255,255,0.05)_inset]"
          >
            {/* Mock Sonner Toast */}
            {toastMsg && (
              <div className="absolute top-16 right-4 z-40 bg-[#252526] border border-[#007ACC]/30 text-zinc-100 px-3.5 py-2.5 rounded-lg text-[10px] font-mono flex items-center gap-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                <Check className="w-3.5 h-3.5 text-[#007ACC]" />
                <span>{toastMsg}</span>
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#2d2d2d] bg-[#252526] absolute top-0 w-full z-20 select-none">
              <div className="flex items-center gap-6">
                {/* Window buttons */}
                <div className="flex gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                {/* Title */}
                <span className="text-[11px] text-[#A6A6A6] font-mono flex items-center gap-1.5 font-medium">
                  <Terminal className="w-3.5 h-3.5 text-[#007ACC]" />
                  cadvex_workspace/model.scad
                </span>
              </div>
              
              {/* Compiler Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCompile}
                  disabled={compilingState === 'compiling'}
                  className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#007ACC]/15 hover:bg-[#007ACC]/30 text-[#007ACC] border border-[#007ACC]/30 text-[10px] font-semibold transition-all active:scale-98 disabled:opacity-50"
                >
                  <Play className={`w-3 h-3 ${compilingState === 'compiling' ? 'animate-spin' : ''}`} />
                  {compilingState === 'compiling' ? 'COMPILING...' : 'COMPILE'}
                </button>
              </div>
            </div>

            <div className="w-full h-full bg-[#181818] pt-12 relative overflow-hidden flex">
              
              {/* Left Mock Chat Panel (Matching HitlWorkspace) */}
              <div className="hidden md:flex flex-col w-64 border-r border-[#2d2d2d] bg-[#1e1e1e] p-3 text-[11px] font-sans select-none">
                {/* Model selector mock */}
                <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#2d2d2d]">
                  <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-[#252526] border border-[#2d2d2d] text-[#D4D4D4] w-full text-[10px] font-medium">
                    <Sparkles className="w-3.5 h-3.5 text-[#007ACC]" />
                    <span>Gemini 3.5 Flash</span>
                    <ChevronDown className="w-3.5 h-3.5 text-[#858585] ml-auto" />
                  </div>
                </div>
                
                {/* Messages History */}
                <div className="flex-1 space-y-3 overflow-y-auto mb-3 pr-1 text-[10px]">
                  <div className="flex flex-col gap-1">
                    <div className="text-[9px] text-[#858585] font-mono">USER</div>
                    <div className="px-2.5 py-2 rounded bg-[#252526] border border-[#2d2d2d] text-[#D4D4D4] leading-relaxed">
                      Generate a spoked flange hub with an outer diameter of 120, thickness of 12 and 5 spokes.
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="text-[9px] text-[#007ACC] font-mono flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-[#007ACC]" /> CADVEX
                    </div>
                    <div className="px-2.5 py-2 rounded bg-[#007ACC]/5 border border-[#007ACC]/20 text-[#D4D4D4] leading-relaxed">
                      I've generated the OpenSCAD code for your request. You can adjust the parameters or edit the code directly on the right side.
                    </div>
                  </div>
                </div>
                
                {/* Chat Input Area */}
                <div className="mt-auto">
                  <div className="relative rounded-lg border border-[#2d2d2d] bg-[#252526] p-2 flex items-center gap-2">
                    <span className="text-[#858585] hover:text-zinc-300 cursor-pointer">
                      <Paperclip className="w-3.5 h-3.5" />
                    </span>
                    <input 
                      type="text" 
                      placeholder="Ask CADVEX..." 
                      disabled
                      className="flex-1 bg-transparent border-none text-[10px] text-zinc-300 outline-none placeholder-[#858585] cursor-not-allowed"
                    />
                    <button className="flex size-5 items-center justify-center rounded bg-[#007ACC] text-white hover:bg-[#005999] opacity-80 cursor-not-allowed">
                      <ArrowUp className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Main Viewport Area */}
              <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-[#181818]">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff01_1px,transparent_1px),linear-gradient(to_bottom,#ffffff01_1px,transparent_1px)] bg-[size:24px_24px]"></div>
                <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_50%_50%,_rgba(0,122,204,0.12)_0%,_transparent_60%)] pointer-events-none" />

                {/* Floating Viewport Title Overlay */}
                <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#252526]/90 border border-[#2d2d2d] text-[9px] font-mono text-zinc-400 shadow-lg z-10 select-none">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>3D VIEWPORT</span>
                </div>

                {/* Action Buttons Overlay (Share Link & Export matching CADViewer) */}
                <div className="absolute top-4 right-4 z-35 flex items-center gap-2 select-none">
                  <button 
                    onClick={handleShare}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#252526]/80 hover:bg-[#3c3c3c] border border-[#3c3c3c] shadow-lg backdrop-blur-md text-[11px] font-medium text-[#D4D4D4] transition-colors"
                  >
                    <Share2 size={13} className="text-[#007ACC]" />
                    Share Link
                  </button>

                  <div className="relative">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setExportDropdownOpen(!exportDropdownOpen);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#252526]/80 hover:bg-[#3c3c3c] border border-[#3c3c3c] shadow-lg backdrop-blur-md text-[11px] font-medium text-[#D4D4D4] transition-colors"
                    >
                      <Download size={13} className="text-[#007ACC]" />
                      Export
                      <ChevronDown size={11} className="text-[#A6A6A6] ml-0.5" />
                    </button>

                    {/* Export Dropdown Mockup */}
                    {exportDropdownOpen && (
                      <div className="absolute top-9 right-0 w-44 border border-[#3c3c3c] bg-[#252526] p-1 shadow-2xl rounded-md z-50 text-[10px] font-sans text-[#D4D4D4] animate-in fade-in slide-in-from-top-1 duration-150">
                        <div 
                          onClick={() => handleExportOption('scad')}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#007ACC] hover:text-white cursor-pointer"
                        >
                          <Layers size={11} className="text-zinc-400 group-hover:text-white" />
                          <div className="flex flex-col">
                            <span>OpenSCAD Script</span>
                            <span className="text-[8px] opacity-60">.SCAD Text File</span>
                          </div>
                        </div>
                        <div className="h-px bg-[#3c3c3c] my-1" />
                        <div 
                          onClick={() => handleExportOption('stl')}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#007ACC] hover:text-white cursor-pointer"
                        >
                          <BoxIcon size={11} className="text-amber-500" />
                          <div className="flex flex-col">
                            <span>3D Printable Mesh</span>
                            <span className="text-[8px] opacity-60">.STL Binary</span>
                          </div>
                        </div>
                        <div 
                          onClick={() => handleExportOption('step')}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-[#007ACC] hover:text-white cursor-pointer"
                        >
                          <BoxIcon size={11} className="text-blue-500" />
                          <div className="flex flex-col">
                            <span>Parametric CAD Sheet</span>
                            <span className="text-[8px] opacity-60">.STEP Model</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full h-full relative z-0">
                  <Hero3D isHovered={isHovered} compilingState={compilingState} />
                </div>
              </div>

              {/* Code/Params Editor Sidebar */}
              <div className="hidden lg:flex flex-col w-56 border-l border-[#2d2d2d] bg-[#1e1e1e] p-4 overflow-hidden">
                {/* Editor tab bar */}
                <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#2d2d2d]">
                  <div className="flex gap-1.5 select-none">
                    <button 
                      onClick={() => setActiveTab('code')}
                      className={`px-2.5 py-1 rounded text-[9px] font-mono font-semibold flex items-center gap-1 transition-colors ${activeTab === 'code' ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-500' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      <FileCode className="w-3 h-3" /> model.scad
                    </button>
                    <button 
                      onClick={() => setActiveTab('params')}
                      className={`px-2.5 py-1 rounded text-[9px] font-mono font-semibold flex items-center gap-1 transition-colors ${activeTab === 'params' ? 'bg-purple-500/10 border border-purple-500/20 text-purple-500' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                      <Sliders className="w-3 h-3" /> PARAMS
                    </button>
                  </div>
                </div>

                {/* Main Content Area */}
                <div className="flex-1 overflow-auto">
                  {activeTab === 'code' ? (
                    <AnimatedCode />
                  ) : (
                    <ParamsView />
                  )}
                </div>

                {/* Status Bar */}
                <div className="mt-auto pt-3 border-t border-[#2d2d2d] flex flex-col gap-2 select-none">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      {compilingState === 'compiling' ? (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-yellow-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-yellow-500" />
                        </>
                      ) : compilingState === 'success' ? (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                        </>
                      ) : (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                        </>
                      )}
                    </span>
                    <span className={`text-[9px] font-mono ${compilingState === 'compiling' ? 'text-yellow-500 font-semibold animate-pulse' : compilingState === 'success' ? 'text-emerald-500 font-semibold' : 'text-zinc-500'}`}>
                      {compilingState === 'compiling' ? 'Compiling kernel...' : compilingState === 'success' ? 'Compile Success!' : 'Ready'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </AnimatedSection>

      {/* Features Section */}
      <section id="features" ref={featuresRef} className="relative z-10 py-32 bg-[#1b1b1c] border-t border-[#2d2d2d]">
        <div className="max-w-7xl mx-auto px-6">
          <AnimatedSection direction="up" duration={0.7}>
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-5xl font-bold mb-6 text-transparent bg-clip-text bg-gradient-to-b from-white to-zinc-400">
                Powerful Features
              </h2>
              <p className="text-zinc-400 max-w-2xl mx-auto text-lg">
                Everything you need to design, iterate, and export complex 3D models from simple 2D descriptions.
              </p>
            </div>
          </AnimatedSection>

          <div className="grid md:grid-cols-3 gap-8">
            {/* Feature 1 */}
            <AnimatedSection delay={0} direction="up" duration={0.7}>
              <div className="p-8 rounded-3xl bg-[#1e1e1e] border border-[#2d2d2d] hover:border-[#007ACC]/55 transition-all duration-300 group hover:-translate-y-1 shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
                <div className="w-14 h-14 rounded-2xl bg-[#007ACC]/10 border border-[#007ACC]/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[#007ACC]/20 transition-all duration-300">
                  <Layers className="w-7 h-7 text-[#007ACC]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Seamless 2D to 3D</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Upload your 2D sketches and let our AI engine instantly generate precise 3D models ready for engineering and rendering.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature 2 */}
            <AnimatedSection delay={0.15} direction="up" duration={0.7}>
              <div className="p-8 rounded-3xl bg-[#1e1e1e] border border-[#2d2d2d] hover:border-[#007ACC]/55 transition-all duration-300 group hover:-translate-y-1 shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
                <div className="w-14 h-14 rounded-2xl bg-[#007ACC]/10 border border-[#007ACC]/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[#007ACC]/20 transition-all duration-300">
                  <Zap className="w-7 h-7 text-[#007ACC]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Real-time Generation</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Experience lightning-fast model generation and adjustments. See your changes reflected instantly in the interactive viewport.
                </p>
              </div>
            </AnimatedSection>

            {/* Feature 3 */}
            <AnimatedSection delay={0.3} direction="up" duration={0.7}>
              <div className="p-8 rounded-3xl bg-[#1e1e1e] border border-[#2d2d2d] hover:border-[#007ACC]/55 transition-all duration-300 group hover:-translate-y-1 shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
                <div className="w-14 h-14 rounded-2xl bg-[#007ACC]/10 border border-[#007ACC]/20 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-[#007ACC]/20 transition-all duration-300">
                  <Code2 className="w-7 h-7 text-[#007ACC]" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Parametric Control</h3>
                <p className="text-zinc-400 leading-relaxed">
                  Retain full control over the generated models with deep parametric adjustments and intelligent constraints.
                </p>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative z-10 py-32 border-t border-[#2d2d2d] overflow-hidden bg-[#181818] px-6">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,#007ACC12_0%,transparent_50%)] pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#007ACC]/5 rounded-full blur-[100px] pointer-events-none" />
        
        <AnimatedSection direction="up" duration={0.8} amount={0.15}>
          <div className="max-w-5xl mx-auto rounded-3xl border border-[#2d2d2d] bg-gradient-to-br from-[#1e1e1e] to-[#252526]/30 p-10 md:p-14 relative z-10 overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.5),0_0_1px_1px_rgba(255,255,255,0.05)_inset]">
            {/* Ambient inner glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-80 h-40 bg-[#007ACC]/10 rounded-full blur-[60px] pointer-events-none" />

            <div className="grid md:grid-cols-12 gap-10 items-center text-left">
              {/* Left Column: Info & Actions */}
              <div className="md:col-span-7 space-y-6">
                {/* Sub-badge */}
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#007ACC]/10 border border-[#007ACC]/25 text-[#007ACC] text-[10px] font-semibold tracking-wider uppercase select-none">
                  ✨ INSTANT ACCESS
                </div>

                <h2 className="text-3xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-b from-white via-zinc-100 to-zinc-400 tracking-tight leading-tight">
                  Ready to Evolve Your Design?
                </h2>
                
                <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
                  Step into the future of CAD workstations. Generate, compile, and manipulate precise mechanical structures with AI-assisted workflows in seconds.
                </p>

                {/* Features checklist */}
                <div className="space-y-2.5 text-xs text-zinc-300">
                  <div className="flex items-center gap-2.5">
                    <div className="flex w-5 h-5 items-center justify-center rounded-full bg-[#007ACC]/10 text-[#007ACC]">
                      <Check className="w-3 h-3" />
                    </div>
                    <span><strong>Zero-Setup CAD</strong>: Compile models directly in your browser context.</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex w-5 h-5 items-center justify-center rounded-full bg-[#007ACC]/10 text-[#007ACC]">
                      <Check className="w-3 h-3" />
                    </div>
                    <span><strong>Agentic Synthesis</strong>: Chat with CADVEX to generate parametric code.</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex w-5 h-5 items-center justify-center rounded-full bg-[#007ACC]/10 text-[#007ACC]">
                      <Check className="w-3 h-3" />
                    </div>
                    <span><strong>Lossless CAD Sheets</strong>: Download industry-standard STEP, STL or DXF.</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
                  <button
                    onClick={() => handleCtaNavigation('auth')}
                    className="group relative inline-flex items-center justify-center px-8 py-3.5 text-sm font-bold text-white transition-all duration-200 bg-[#007ACC] hover:bg-[#005999] rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#007ACC] shadow-[0_4px_20px_rgba(0,122,204,0.35)] hover:shadow-[0_8px_30px_rgba(0,122,204,0.5)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                  >
                    {isLoggedIn ? 'Open Workspace' : 'Launch Workspace'}
                    <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </button>
                  <button
                    onClick={scrollToFeatures}
                    className="inline-flex items-center justify-center px-6 py-3.5 text-sm font-bold text-zinc-300 transition-all duration-200 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 hover:text-white text-center cursor-pointer"
                  >
                    Learn More
                  </button>
                </div>
              </div>

              {/* Right Column: ThreeD Interactive preview */}
              <div className="md:col-span-5 relative w-full flex flex-col items-center" ref={ctaRef}>
                <div className="w-full max-w-sm h-56 rounded-xl border border-[#2d2d2d] bg-[#181818]/60 relative overflow-hidden flex items-center justify-center shadow-inner">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff01_1px,transparent_1px),linear-gradient(to_bottom,#ffffff01_1px,transparent_1px)] bg-[size:16px_16px] pointer-events-none"></div>
                  
                  {/* Floating Viewport Tag */}
                  <div className="absolute top-2 left-2 rounded bg-[#252526]/80 px-2 py-0.5 border border-[#2d2d2d] text-[7px] font-mono text-zinc-400 select-none">
                    KINETIC_RADAR
                  </div>

                  {ctaCanvasActive ? (
                    <Canvas camera={{ position: [2.5, 1.8, 4.2], fov: 42 } as any}>
                      <ambientLight intensity={1.4} />
                      <directionalLight position={[10, 10, 10]} intensity={3.0} />
                      <directionalLight position={[-10, -10, -10]} intensity={2.0} color="#007ACC" />
                      <group scale={0.7}>
                        <CadAssembly isHovered={true} compilingState="idle" />
                      </group>
                    </Canvas>
                  ) : (
                    <div className="text-zinc-600 text-[10px] font-mono select-none animate-pulse">Initializing viewport...</div>
                  )}
                  
                  {/* Compiling solver log */}
                  <div className="absolute bottom-2 left-2 right-2 rounded bg-black/90 p-2 font-mono text-[8px] text-[#A6A6A6] border border-white/5 space-y-0.5 select-none leading-relaxed text-left">
                    <div className="text-blue-400 font-bold flex items-center justify-between">
                      <span>cadv3x-wasm-kernel</span>
                      <span className="text-[7px] px-1 bg-green-500/10 border border-green-500/20 text-green-500 rounded">OK</span>
                    </div>
                    <div className="text-[7px]">Initializing geometry builder threads...</div>
                    <div className="text-[7px] text-[#CCFF00]">&gt; compiled in 0.038s</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </AnimatedSection>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[#2d2d2d] bg-[#1e1e1e] pt-16 pb-8 px-6 text-[#A6A6A6] text-xs font-sans select-none">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
          {/* Brand Info Column */}
          <div className="col-span-2 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative w-9 h-9 flex items-center justify-center">
                <div className="absolute inset-0 bg-[#007ACC] rounded-lg transform rotate-45 opacity-20"></div>
                <Cuboid className="w-5.5 h-5.5 text-[#007ACC] relative z-10" />
              </div>
              <span className="text-lg font-bold tracking-widest text-white">CADVΞX</span>
            </div>
            <p className="text-zinc-400 leading-relaxed max-w-sm">
              The next generation agentic CAD workstation. Elevating 2D engineering blueprints into production-ready 3D models with high-speed WebAssembly compilation.
            </p>
            <div className="flex items-center gap-3 pt-2">
              <a href="https://datavex.in" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">
                <Globe className="w-4 h-4" />
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div className="space-y-3">
            <h4 className="font-semibold text-white uppercase tracking-wider text-[10px]">Product</h4>
            <ul className="space-y-2">
              <li>
                <Link href="/app" className="hover:text-white transition-colors">Workspace</Link>
              </li>
              <li>
                <button onClick={() => handleCtaNavigation('playground')} className="hover:text-white transition-colors text-left cursor-pointer">Interactive Demo</button>
              </li>
              <li>
                <button onClick={scrollToFeatures} className="hover:text-white transition-colors text-left cursor-pointer">Key Features</button>
              </li>
            </ul>
          </div>

          {/* Resources Links */}
          <div className="space-y-3">
            <h4 className="font-semibold text-white uppercase tracking-wider text-[10px]">Resources</h4>
            <ul className="space-y-2">
              <li>
                <a href="#" className="hover:text-white transition-colors">Documentation</a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">WASM Kernel</a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">API References</a>
              </li>
            </ul>
          </div>

          {/* Company Links */}
          <div className="space-y-3">
            <h4 className="font-semibold text-white uppercase tracking-wider text-[10px]">Organization</h4>
            <ul className="space-y-2">
              <li>
                <a href="https://datavex.in/" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors flex items-center gap-1">
                  Datavex.ai <Globe className="w-3 h-3 text-[#007ACC]" />
                </a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">Privacy Policy</a>
              </li>
              <li>
                <a href="#" className="hover:text-white transition-colors">Terms of Service</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-8 border-t border-[#2d2d2d]/60 flex flex-col md:flex-row justify-between items-center gap-4 text-zinc-500 font-mono text-[10px]">
          <div>
            © {new Date().getFullYear()} CADVΞX. All rights reserved.
          </div>
          <div>
            Powered by <a href="https://datavex.in/" target="_blank" rel="noopener noreferrer" className="text-[#007ACC] hover:text-[#005999] transition-colors font-bold font-sans">Datavex.ai</a>
          </div>
        </div>
      </footer>

      {/* Tailwind Custom Animations */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes shimmer {
          100% { transform: translateX(200%); }
        }
      `}} />
    </div>
  )
}