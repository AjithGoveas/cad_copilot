'use client';

import { useState, useCallback, useMemo } from 'react';
import { CADViewerPresenter } from '@/features/cad-workspace/components/CADViewerPresenter';
import { ParameterDrawer } from '@/features/cad-workspace/components/ParameterDrawer';
import { extractOpenScadParameters } from '@/lib/openscadParameters';
import { Box, Layers } from 'lucide-react';
import { useCadWorker } from '@/features/cad-workspace/hooks/useCadWorker';

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
	const [engineStatus, setEngineStatus] = useState({ isCompiling: false, isExporting: false, isImported: false });

	const {
		stlUrls,
		statusText,
		engineError,
		isRecompiling,
		isExporting,
		rebuild,
		respawn,
		exportModel,
		compileCsgTree,
	} = useCadWorker({
		script: scadCode,
		enabled: !!scadCode,
	});

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
		<div className="relative flex h-screen w-full overflow-hidden bg-[#181818] text-[#D4D4D4] selection:bg-[#007ACC]/20">
			
			{/* Logo & Title Banner (top-left) */}
			<div className="absolute top-6 left-6 z-10 flex flex-col gap-1 pointer-events-none">
				<div className="pointer-events-auto flex items-center gap-2.5 rounded-md border border-[#3C3C3C] bg-[#252526]/80 backdrop-blur-md px-4 py-3 shadow-lg">
					<div className="flex size-5 items-center justify-center rounded bg-[#007ACC]/10 border border-[#007ACC]/30 text-[#007ACC]">
						<Box size={12} />
					</div>
					<span className="font-mono text-[10px] font-black uppercase tracking-[0.25em] text-[#007ACC]">
						CADVΞX
					</span>
					<span className="text-[10px] text-[#3C3C3C]">/</span>
					<span className="font-mono text-[10px] tracking-widest text-[#A6A6A6] truncate max-w-[200px] md:max-w-[400px]" title={prompt}>
						{prompt}
					</span>
				</div>
			</div>

			{/* 3D Viewport Backdrop */}
			<div className="absolute inset-0 z-0">
				<CADViewerPresenter
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
					isReadOnly={true}

					stlUrls={stlUrls}
					statusText={statusText}
					engineError={engineError}
					isRecompiling={isRecompiling}
					isExporting={isExporting}
					rebuild={rebuild}
					respawn={respawn}
					exportModel={exportModel}
					compileCsgTree={compileCsgTree}

					importedStlUrl={null}
					isImported={false}
					geometrySource="openscad"
					sourceAssetId={null}
					handleImportStep={async () => {}}
					handleClearImport={() => {}}
					handleGenerateGCode={async () => {}}
					isGeneratingGCode={false}
				/>
			</div>

			{/* Floating Parameters Panel (right) */}
			<div className="absolute right-6 top-6 bottom-6 w-[380px] z-10 flex flex-col rounded-md border border-[#3C3C3C] bg-[#252526]/90 backdrop-blur-xl shadow-2xl p-6 overflow-hidden">
				<div className="flex items-center gap-2 mb-4 shrink-0">
					<Layers size={14} className="text-[#007ACC]" />
					<h2 className="text-[11.5px] font-medium tracking-wide text-[#D4D4D4]">
						Model Viewer
					</h2>
					<div className="ml-auto flex items-center gap-1.5 rounded-md bg-[#007ACC]/10 px-2 py-0.5 border border-[#007ACC]/20">
						<span className="font-mono text-[9px] uppercase tracking-wider text-[#007ACC] font-bold">
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

				<div className="mt-4 pt-4 border-t border-[#3C3C3C] flex flex-col gap-2 shrink-0">
					<p className="font-mono text-[9px] text-[#A6A6A6] uppercase tracking-widest text-center">
						Shared via CADVEX Workbench | ALL RIGHTS RESERVED TO DATAVEX.AI
					</p>
				</div>
			</div>

		</div>
	);
}
