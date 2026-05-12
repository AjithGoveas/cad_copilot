'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, PerspectiveCamera } from '@react-three/drei';
import { Loader2 } from 'lucide-react';

type CadViewportProps = {
	stlUrl: string | null;
	statusText: string;
	isRecompiling: boolean;
	hasStl: boolean;
	hasStep: boolean;
	hasDxf: boolean;
	isDownloadingStl: boolean;
	isDownloadingStep: boolean;
	isDownloadingDxf: boolean;
	onDownloadStl: () => void;
	onDownloadStep: () => void;
	onDownloadDxf: () => void;

	children?: React.ReactNode; // For StlMesh
};

export function CadViewport({
	stlUrl,
	statusText,
	isRecompiling,
	hasStl,
	hasStep,
	hasDxf,
	isDownloadingStl,
	isDownloadingStep,
	isDownloadingDxf,
	onDownloadStl,
	onDownloadStep,
	onDownloadDxf,

	children
}: CadViewportProps) {
	return (
		<section className="relative flex flex-1 flex-col overflow-hidden bg-black">
			<header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-[#09090b]/80 backdrop-blur-md px-6 z-10">
				<div>
					<p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Geometry Stream</p>
					<p className="text-sm font-medium text-zinc-100 flex items-center gap-2">
						<span className={`size-1.5 rounded-full ${stlUrl ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
						{statusText}
					</p>
				</div>
				
				<div className="flex items-center gap-2">
					{hasDxf && (
						<button
							onClick={onDownloadDxf}
							disabled={isDownloadingDxf}
							className="flex h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-[11px] font-bold uppercase tracking-wider text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 transition-all disabled:opacity-50"
						>
							{isDownloadingDxf ? <Loader2 className="size-3 animate-spin" /> : 'DXF'}
						</button>
					)}

					{hasStl && (
						<button
							onClick={onDownloadStl}
							disabled={isDownloadingStl}
							className="flex h-9 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-[11px] font-bold uppercase tracking-wider text-zinc-100 hover:border-zinc-500 hover:bg-zinc-800 transition-all disabled:opacity-50"
						>
							{isDownloadingStl ? <Loader2 className="size-3 animate-spin" /> : 'STL'}
						</button>
					)}
					{hasStep && (
						<button
							onClick={onDownloadStep}
							disabled={isDownloadingStep}
							className="flex h-9 items-center gap-2 rounded-lg bg-amber-500 px-4 text-[11px] font-bold uppercase tracking-wider text-black hover:bg-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)] transition-all disabled:opacity-50"
						>
							{isDownloadingStep ? <Loader2 className="size-3 animate-spin" /> : 'STEP'}
						</button>
					)}
				</div>
			</header>

			<div className="relative flex-1">
				<Canvas shadows dpr={[1, 2]}>
					<PerspectiveCamera makeDefault position={[5, 5, 5]} fov={40} />
					<color attach="background" args={['#000000']} />
					
					<Suspense fallback={null}>
						<Stage intensity={0.5} environment="city" adjustCamera={false} shadows="contact">
							{children}
						</Stage>
					</Suspense>


					<OrbitControls makeDefault enableDamping dampingFactor={0.05} minPolarAngle={0} maxPolarAngle={Math.PI / 1.75} />
				</Canvas>

				{!stlUrl && !isRecompiling && (
					<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-12">
						<div className="max-w-md rounded-2xl border border-zinc-800/50 bg-zinc-900/30 backdrop-blur-xl p-8 text-center shadow-2xl">
							<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-zinc-800/50 text-zinc-500">
								<Loader2 className="size-6 opacity-20" />
							</div>
							<h3 className="mb-2 text-sm font-bold text-zinc-100">Waiting for CAD Parameters</h3>
							<p className="text-xs text-zinc-500 leading-relaxed">
								Upload a technical drawing and generate a script. Once generated, we'll render your 3D model here.
							</p>
						</div>
					</div>
				)}

				{isRecompiling && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-20 transition-all">
						<div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-zinc-950 p-6 shadow-[0_0_30px_rgba(245,158,11,0.1)]">
							<div className="relative">
								<div className="absolute inset-0 size-5 animate-ping rounded-full bg-amber-500/20" />
								<Loader2 className="size-5 animate-spin text-amber-500" />
							</div>
							<div className="flex flex-col">
								<span className="text-xs font-bold uppercase tracking-widest text-zinc-100">Engine Active</span>
								<span className="text-[10px] text-zinc-500">Recomputing Geometry Topology...</span>
							</div>
						</div>
					</div>
				)}
			</div>
		</section>
	);
}
