'use client';

import { useMemo, useEffect, memo } from 'react';
import { Target, X, Sliders } from 'lucide-react';
import { ParameterInput } from './ParameterInput';

type ParameterDrawerProps = {
	parameters: Record<string, any>;
	isReadOnly?: boolean;
	selection?: { id: string } | null;
	activeFeatureId?: string | null;
	onClearSelection?: () => void;
	onChangeParameter?: (key: string, value: any) => void;
	onHoverParameter?: (key: string | null) => void;
};

function ParameterDrawerInner({
	parameters,
	isReadOnly = false,
	selection,
	activeFeatureId,
	onClearSelection,
	onChangeParameter,
	onHoverParameter,
}: ParameterDrawerProps) {
	const memoizedParams = useMemo(() => {
		return Object.entries(parameters);
	}, [parameters]);

	useEffect(() => {
		const targetId = activeFeatureId || selection?.id;
		if (targetId) {
			const element = document.getElementById(`param-card-${targetId}`);
			if (element) {
				element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
			}
		}
	}, [activeFeatureId, selection]);

	return (
		<div className="flex flex-col">
			{/* Selected Item Notification Banner */}
			{selection && (
				<div className="mb-6 flex items-center justify-between rounded-lg bg-amber-500/10 px-3 py-2.5 ring-1 ring-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
					<div className="flex items-center gap-2 text-xs font-medium text-amber-500">
						<Target size={14} />
						<span className="max-w-[200px] truncate">Selected: {selection.id}</span>
					</div>
					<button 
						onClick={onClearSelection} 
						className="rounded-full p-1 text-amber-600/60 transition-colors hover:bg-amber-500/20 hover:text-amber-400"
					>
						<X size={14} />
					</button>
				</div>
			)}

			<div className="flex flex-col">
				<h3 className="mb-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">Properties</h3>
				<div className="flex flex-col rounded-lg border border-zinc-800/60 bg-[#121214] p-4 shadow-sm">
					{memoizedParams.length > 0 ? (
						<div className="space-y-6">
							{memoizedParams.map(([key, val]) => (
								<ParameterInput
									key={key}
									label={key}
									value={val}
									isFocused={selection?.id === key}
									isHovered={activeFeatureId === key}
									isReadOnly={isReadOnly}
									onChange={(newVal) => onChangeParameter?.(key, newVal)}
									onMouseEnter={() => onHoverParameter?.(key)}
									onMouseLeave={() => onHoverParameter?.(null)}
									onFocus={() => onHoverParameter?.(key)}
									onBlur={() => onHoverParameter?.(null)}
								/>
							))}
						</div>
					) : (
						<div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
							<div className="rounded-full bg-zinc-900/50 p-3 ring-1 ring-zinc-800">
								<Sliders size={18} className="text-zinc-600" />
							</div>
							<p className="text-xs text-zinc-500">
								{isReadOnly ? 'No parameters available' : 'Generate a script to edit parameters'}
							</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export const ParameterDrawer = memo(ParameterDrawerInner);
