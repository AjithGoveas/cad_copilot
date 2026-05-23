'use client';

import { useState, useCallback, useMemo, useEffect, useImperativeHandle, forwardRef, useRef } from 'react';
import { Viewport } from './Viewport';
import { useCADEngine } from '@/hooks/useCADEngine';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';
import { extractStructuredAnnotations } from '@/lib/openscadParameters';

export type CADViewerRef = {
	rebuild: () => void;
	exportModel: (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => Promise<ArrayBuffer>;
	respawn: () => void;
};

type CADViewerProps = {
	code: string;
	activeFeatureId?: string | null;
	selection?: { id: string; point: [number, number, number] } | null;
	onMeshClick?: (id: string | null, point: [number, number, number] | null) => void;
	onSelectParameter?: (key: string | null) => void;
	onHoverParameter?: (key: string | null) => void;
	isGenerating?: boolean;
	showExport?: boolean;
	onStatusChange?: (status: { isCompiling: boolean; isExporting: boolean }) => void;
	onShare?: () => void;
};

export const CADViewer = forwardRef<CADViewerRef, CADViewerProps>(function CADViewer(
	{
		code,
		activeFeatureId = null,
		selection = null,
		onMeshClick,
		onSelectParameter,
		onHoverParameter,
		isGenerating = false,
		showExport = true,
		onStatusChange,
		onShare,
	},
	ref
) {
	// WASM engine
	const {
		stlUrls,
		statusText,
		engineError,
		isRecompiling,
		isExporting,
		rebuild,
		respawn,
		exportModel,
	} = useCADEngine({
		script: code,
		enabled: !!code,
	});

	// Expose methods to parent ref
	useImperativeHandle(ref, () => ({
		rebuild,
		exportModel,
		respawn,
	}));

	// Extract annotations from scad code
	const annotations = useMemo(() => {
		return extractStructuredAnnotations(code);
	}, [code]);

	// Store the latest callback in a ref to prevent infinite render loops when parent passes inline functions
	const statusCallbackRef = useRef(onStatusChange);
	useEffect(() => {
		statusCallbackRef.current = onStatusChange;
	}, [onStatusChange]);

	// Notify status changes
	useEffect(() => {
		statusCallbackRef.current?.({
			isCompiling: isRecompiling,
			isExporting,
		});
	}, [isRecompiling, isExporting]);

	// Export handlers
	const handleExport = useCallback(
		async (format: 'stl' | 'dxf', dxfMode?: 'silhouette' | 'section' | 'blueprint') => {
			if (!code) return;
			const label = format.toUpperCase();
			const modeLabel = dxfMode ? ` (${dxfMode})` : '';
			toast.info(`Exporting ${label}${modeLabel}…`, { description: `Preparing ${label} geometry kernel…` });

			try {
				const buffer = await exportModel(format, dxfMode);
				const blob = new Blob([buffer], { type: 'application/octet-stream' });
				const url = URL.createObjectURL(blob);

				const filename = dxfMode === 'blueprint'
					? `technical_blueprint.dxf`
					: `generated_model.${format}`;

				const a = document.createElement('a');
				a.href = url;
				a.download = filename;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);

				toast.success(`${label} Exported Successfully`);
			} catch (err) {
				toast.error(`${label} Export Failed`, { description: String(err) });
			}
		},
		[code, exportModel]
	);

	const handleDownloadScad = useCallback(() => {
		if (!code) return;
		const blob = new Blob([code], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'generated_part.scad';
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		toast.success('SCAD File Downloaded');
	}, [code]);

	return (
		<div className="relative flex flex-1 h-full w-full overflow-hidden bg-transparent">
			<Viewport
				stlUrls={stlUrls}
				statusText={statusText}
				isCompiling={isRecompiling || isGenerating}
				selection={selection}
				onMeshClick={onMeshClick}
				onDownloadStl={showExport ? () => handleExport('stl') : undefined}
				onDownloadDxf={showExport ? (mode) => handleExport('dxf', mode) : undefined}
				onDownloadScad={showExport ? handleDownloadScad : undefined}
				onShare={showExport ? onShare : undefined}
				annotations={annotations}
				activeFeatureId={activeFeatureId || selection?.id}
				onSelectParameter={onSelectParameter}
				onHoverParameter={onHoverParameter}
			/>

			{/* WASM Error Banner */}
			{engineError && (
				<div className="absolute bottom-6 left-6 right-6 z-30">
					<div className="glass flex items-center justify-between rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-4 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-bottom-4 duration-500">
						<div className="flex items-center gap-4">
							<div className="flex size-10 items-center justify-center rounded-xl bg-red-500/20 border border-red-500/40">
								<AlertCircle size={20} className="text-red-500" />
							</div>
							<div>
								<h4 className="text-xs font-bold uppercase tracking-widest text-red-500">Geometry Engine Error</h4>
								<p className="mt-1 text-xs text-red-200/60 font-medium">{engineError.message}</p>
							</div>
						</div>
						<button
							onClick={respawn}
							className="rounded-lg bg-red-500 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-white transition-all hover:bg-red-400 active:scale-95"
						>
							Respawn Kernel
						</button>
					</div>
				</div>
			)}
		</div>
	);
});
