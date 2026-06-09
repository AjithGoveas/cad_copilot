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
                <div className="mb-4 flex items-center justify-between bg-[#1E1E1E] border border-[#007ACC]/50 shadow-[0_4px_12px_rgba(0,122,204,0.1)] px-3 py-2.5 rounded-md animate-in fade-in duration-300">
                    <div className="flex items-center gap-2.5 text-[11px] font-semibold text-[#D4D4D4]">
                        <div className="flex size-5 items-center justify-center rounded bg-[#007ACC]/10">
                            <Target size={12} className="text-[#007ACC]" />
                        </div>
                        <span className="max-w-[200px] truncate tracking-wide">Selected: {selection.id}</span>
                    </div>
                    <button 
                        onClick={onClearSelection} 
                        className="text-[#A6A6A6] transition-colors hover:text-[#D4D4D4] hover:bg-[#3C3C3C] p-1 rounded"
                    >
                        <X size={12} />
                    </button>
                </div>
            )}

            <div className="flex flex-col">
                <div className="flex flex-col bg-[#252526] rounded-md overflow-hidden">
                    {memoizedParams.length > 0 ? (
                        <div className="flex flex-col divide-y divide-[#3C3C3C]">
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
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center opacity-70 animate-in fade-in duration-700">
                            <div className="flex size-10 items-center justify-center rounded-full bg-[#1E1E1E] border border-[#3C3C3C] shadow-sm">
                                <Sliders size={16} className="text-[#A6A6A6]" />
                            </div>
                            <p className="text-[11px] text-[#A6A6A6] font-medium tracking-wide">
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
