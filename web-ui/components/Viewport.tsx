'use client';

import { Suspense, useState, useRef, useEffect, memo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Stage, ContactShadows } from '@react-three/drei';
import { Loader2, Download, MousePointer2, ChevronDown, Layers, Box } from 'lucide-react';
import { StlMesh } from './StlMesh';

type Props = {
	stlUrl:        string | null;
	statusText:    string;
	isCompiling:   boolean;
	onMeshClick?:  (point: [number, number, number] | null) => void;
	onDownloadStl?: () => void;
	onDownloadDxf?: () => void;
};

export const Viewport = memo(function Viewport({ stlUrl, statusText, isCompiling, onMeshClick, onDownloadStl, onDownloadDxf }: Props) {
	const [hintVisible, setHintVisible] = useState(false);
	const [isExportOpen, setIsExportOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);

	// Close dropdown on outside click
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
				setIsExportOpen(false);
			}
		};
		document.addEventListener('mousedown', handleClickOutside);
		return () => document.removeEventListener('mousedown', handleClickOutside);
	}, []);

	return (
		<section className="relative flex-1 overflow-hidden bg-[#030303]">

			{/* ── 3-D Canvas ─────────────────────────────────────────────── */}
			<Canvas
				shadows="percentage"
				dpr={[1, 2]}
				gl={{
					antialias: true,
					logarithmicDepthBuffer: true,
				}}
				className="absolute inset-0"
			>
				<PerspectiveCamera makeDefault position={[8, 8, 8]} fov={30} />
				<color attach="background" args={['#030303']} />

				<Suspense fallback={null}>
					<Stage
						intensity={0.5}
						environment="warehouse"
						adjustCamera={false}
						shadows="contact"
					>
						{stlUrl && (
							<StlMesh
								url={stlUrl}
								onMeshClick={(pt) => {
									onMeshClick?.(pt);
									setHintVisible(false);
								}}
							/>
						)}
					</Stage>
					<ContactShadows
						position={[0, -1.2, 0]}
						opacity={0.35}
						scale={20}
						blur={2}
						far={4}
					/>
				</Suspense>

				{/* <gridHelper args={[40, 40, '#111', '#0a0a0a']} position={[0, -0.01, 0]} /> */}
				<OrbitControls
					makeDefault
					enableDamping
					dampingFactor={0.06}
					maxPolarAngle={Math.PI / 1.8}
				/>
			</Canvas>

			{/* ── Status Bar (top-left) ───────────────────────────────────── */}
			<div className="absolute top-5 left-5 z-10">
				<div className="glass flex items-center gap-2.5 rounded-xl px-4 py-2.5">
					<div
						className={`size-2 shrink-0 rounded-full ${
							isCompiling
								? 'bg-amber-500 animate-pulse'
								: stlUrl
								? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]'
								: 'bg-zinc-600'
						}`}
					/>
					<span className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-300">
						{statusText}
					</span>
				</div>
			</div>

			{/* ── Action bar (top-right) ──────────────────────────────────── */}
			{(stlUrl || hintVisible) && (
				<div className="absolute top-5 right-5 z-10 flex items-center gap-2" ref={dropdownRef}>
					{stlUrl && (
						<div className="relative">
							<button
								onClick={() => setIsExportOpen(!isExportOpen)}
								className="glass flex items-center gap-2 rounded-xl px-4 py-2.5 text-[10px] font-bold uppercase tracking-widest text-zinc-300 transition-all hover:bg-white/10 active:scale-95 shadow-lg ring-1 ring-white/5"
							>
								<Download size={14} className={isExportOpen ? 'text-amber-500' : ''} />
								Export
								<ChevronDown size={12} className={`transition-transform duration-200 ${isExportOpen ? 'rotate-180' : ''}`} />
							</button>

							{isExportOpen && (
								<div className="absolute right-0 mt-2 w-48 origin-top-right rounded-xl border border-zinc-800 bg-[#0c0c0e]/95 p-1.5 shadow-2xl backdrop-blur-xl animate-in fade-in zoom-in-95 duration-200">
									<button
										onClick={() => { onDownloadStl?.(); setIsExportOpen(false); }}
										className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
									>
										<Box size={14} className="text-amber-500/60" />
										3D Mesh (.STL)
									</button>
									<button
										onClick={() => { onDownloadDxf?.(); setIsExportOpen(false); }}
										className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[10px] font-medium uppercase tracking-widest text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
									>
										<Layers size={14} className="text-emerald-500/60" />
										2D Blueprint (.DXF)
									</button>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* ── Click-to-Edit hint (bottom) ─────────────────────────────── */}
			{stlUrl && (
				<div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
					<div className="glass flex items-center gap-2 rounded-full px-4 py-2">
						<MousePointer2 size={11} className="text-zinc-500" />
						<span className="font-mono text-[9px] uppercase tracking-widest text-zinc-600">
							Click mesh to focus feature
						</span>
					</div>
				</div>
			)}

			{/* ── Empty State ─────────────────────────────────────────────── */}
			{!stlUrl && !isCompiling && (
				<div className="absolute inset-0 flex flex-col items-center justify-center gap-6 pointer-events-none">
					<div className="size-24 rounded-full bg-amber-500/5 animate-glow blur-2xl absolute" />
					<div className="glass flex size-16 items-center justify-center rounded-3xl">
						<Loader2 size={28} className="text-zinc-700" />
					</div>
					<div className="text-center">
						<p className="font-mono text-[11px] font-bold uppercase tracking-[0.35em] text-zinc-300">
							Awaiting Geometry
						</p>
						<p className="mt-2 font-mono text-[9px] uppercase tracking-widest text-zinc-600">
							Upload a blueprint to initialise the pipeline
						</p>
					</div>
				</div>
			)}

			{/* ── Compiling Overlay ───────────────────────────────────────── */}
			{isCompiling && (
				<div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[1px]">
					<div className="glass flex flex-col items-center gap-4 rounded-2xl p-8">
						<Loader2 size={32} className="animate-spin text-amber-500" />
						<span className="font-mono text-[10px] font-bold uppercase tracking-[0.25em] text-amber-500/80">
							Compiling Geometry…
						</span>
					</div>
				</div>
			)}
		</section>
	);
});
