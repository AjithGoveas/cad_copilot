'use client';

import { useState, useCallback, useMemo } from 'react';
import { CADViewer } from '@/components/CADViewer';
import { ParameterDrawer } from '@/components/ParameterDrawer';
import { extractOpenScadParameters } from '@/lib/openscadParameters';
import { Box, Layers } from 'lucide-react';

type ViewerClientProps = {
	prompt: string;
	scadCode: string;
	parametersJson: any;
};

type Selection = {
	id: string;
	point: [number, number, number];
};

export default function ViewerClient({ prompt, scadCode, parametersJson }: ViewerClientProps) {
	const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
	const [selection, setSelection] = useState<Selection | null>(null);
	const [engineStatus, setEngineStatus] = useState({ isCompiling: false, isExporting: false });

	const parameters = useMemo(() => {
		if (parametersJson && typeof parametersJson === 'object' && Object.keys(parametersJson).length > 0) {
			return parametersJson as Record<string, any>;
		}
		return extractOpenScadParameters(scadCode);
	}, [scadCode, parametersJson]);

	const handleMeshClick = useCallback((id: string | null, point: [number, number, number] | null) => {
		if (point && id) {
			setSelection({ id, point });
		} else {
			setSelection(null);
		}
	}, []);

	return (
		<div className="relative flex h-screen w-full overflow-hidden bg-[#050505] text-zinc-100 selection:bg-amber-500/20">
			
			{/* ── Logo & Title Banner (top-left) ────────────────────────────────── */}
			<div className="absolute top-6 left-6 z-10 flex flex-col gap-1 pointer-events-none">
				<div className="pointer-events-auto flex items-center gap-2.5 rounded-xl border border-white/5 bg-zinc-950/40 backdrop-blur-md px-4 py-3 shadow-lg">
					<div className="flex size-5 items-center justify-center rounded bg-amber-500/10 border border-amber-500/30 text-amber-500">
						<Box size={12} />
					</div>
					<span className="font-mono text-[10px] font-black uppercase tracking-[0.25em] text-amber-500">
						CAD Copilot
					</span>
					<span className="text-[10px] text-zinc-700">/</span>
					<span className="font-mono text-[9px] uppercase tracking-widest text-zinc-300 truncate max-w-[200px] md:max-w-[400px]" title={prompt}>
						{prompt}
					</span>
				</div>
			</div>

			{/* ── 3D Viewport Backdrop ─────────────────────────────────────────── */}
			<div className="absolute inset-0 z-0">
				<CADViewer
					code={scadCode}
					activeFeatureId={activeFeatureId || selection?.id}
					selection={selection}
					onMeshClick={handleMeshClick}
					onSelectParameter={(key) => {
						if (key) {
							setSelection({ id: key, point: [0, 0, 0] });
						} else {
							setSelection(null);
						}
					}}
					onHoverParameter={setActiveFeatureId}
					isGenerating={false}
					showExport={false}
					onStatusChange={(status) => setEngineStatus(status)}
				/>
			</div>

			{/* ── Floating Parameters Panel (right) ─────────────────────────────── */}
			<div className="absolute right-6 top-6 bottom-6 w-96 z-10 flex flex-col rounded-2xl border border-zinc-800/80 bg-zinc-950/70 backdrop-blur-xl shadow-2xl p-6 overflow-hidden">
				<div className="flex items-center gap-2 mb-4 shrink-0">
					<Layers size={14} className="text-amber-500" />
					<h2 className="text-xs font-black uppercase tracking-wider text-zinc-100">
						Model Viewer
					</h2>
					<div className="ml-auto flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/20">
						<span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
						<span className="font-mono text-[8px] uppercase tracking-wider text-emerald-400 font-bold">
							Read Only
						</span>
					</div>
				</div>

				<div className="custom-scrollbar flex-1 overflow-y-auto pr-1">
					<ParameterDrawer
						parameters={parameters}
						isReadOnly={true}
						selection={selection}
						activeFeatureId={activeFeatureId}
						onClearSelection={() => setSelection(null)}
						onHoverParameter={setActiveFeatureId}
					/>
				</div>

				<div className="mt-4 pt-4 border-t border-zinc-800/60 flex flex-col gap-2 shrink-0">
					<p className="font-mono text-[8px] text-zinc-500 uppercase tracking-widest text-center">
						Shared via CAD Copilot Workbench
					</p>
				</div>
			</div>

		</div>
	);
}
