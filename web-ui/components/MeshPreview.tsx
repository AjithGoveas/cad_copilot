'use client';

import { CadViewport } from './CadViewport';
import { StlMesh } from './StlMesh';

type MeshPreviewProps = {
	stlUrl: string | null;
	statusText: string;
	isRecompiling: boolean;
	onDownloadStl?: () => void;
	onMeshClick?: (point: [number, number, number] | null, partId?: string) => void;
};

export function MeshPreview({
	stlUrl,
	statusText,
	isRecompiling,
	onDownloadStl = () => {},
	onMeshClick,
}: MeshPreviewProps) {
	return (
		<CadViewport
			stlUrl={stlUrl}
			statusText={statusText}
			isRecompiling={isRecompiling}
			hasStl={!!stlUrl}
			onDownloadStl={onDownloadStl}
            onSelectPart={(partName) => onMeshClick?.([0,0,0], partName)}
		>
			{stlUrl && <StlMesh url={stlUrl} onMeshClick={onMeshClick} />}
		</CadViewport>
	);
}