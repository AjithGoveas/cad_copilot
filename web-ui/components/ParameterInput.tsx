'use client';

import { useMemo, useEffect, useRef, useState, memo } from 'react';

type Props = {
    label: string;
    value: unknown;
    isFocused?: boolean;
    isHovered?: boolean;
    isReadOnly?: boolean;
    onChange?: (v: unknown) => void;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
    onFocus?: () => void;
    onBlur?: () => void;
};

function ParameterInputInner({
    label, value, isFocused, isHovered, isReadOnly = false,
    onChange, onMouseEnter, onMouseLeave, onFocus, onBlur,
}: Props) {
    const displayLabel = useMemo(() => label.replace(/_/g, ' '), [label]);
    const isHighlighted = isFocused || isHovered;

    const getValueString = (val: unknown) => {
        if (typeof val === 'object' && val !== null) return JSON.stringify(val, null, 2);
        return String(val ?? '');
    };

    const [localValue, setLocalValue] = useState(() => getValueString(value));
    const isFocusedRef = useRef(false);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        if (!isFocusedRef.current) setLocalValue(getValueString(value));
    }, [value]);

    const handleLocalChange = (newValString: string) => {
        setLocalValue(newValString);
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        
        debounceTimerRef.current = setTimeout(() => {
            if (typeof value === 'number') {
                const parsed = newValString === '' ? 0 : Number(newValString);
                if (!isNaN(parsed)) onChange?.(parsed);
            } else if (typeof value === 'string') {
                onChange?.(newValString);
            }
        }, 300);
    };

    const flushChange = () => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (typeof value === 'number') {
            const parsed = localValue === '' ? 0 : Number(localValue);
            if (!isNaN(parsed) && parsed !== value) onChange?.(parsed);
        }
    };

    return (
        <div 
            id={`param-card-${label}`}
            onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
            className={`flex items-center justify-between gap-4 py-2 px-3 rounded-md transition-all duration-200 ${
                isHighlighted ? 'bg-[#3C3C3C]/40 shadow-sm' : 'hover:bg-[#3C3C3C]/20'
            }`}
        >
            <label className={`w-1/2 text-[11.5px] font-medium tracking-wide truncate transition-colors ${isHighlighted ? 'text-[#D4D4D4]' : 'text-[#A6A6A6]'}`} title={displayLabel}>
                {displayLabel}
            </label>

            <div className="w-1/2 flex justify-end">
                {isReadOnly ? (
                    <span className="font-mono text-xs text-[#D4D4D4] bg-[#1E1E1E] px-2.5 py-1 rounded-md border border-[#3C3C3C] shadow-sm">{String(value)}</span>
                ) : (
                    typeof value === 'boolean' ? (
                        <button
                            onClick={() => onChange?.(!value)}
                            className={`relative h-[18px] w-8 rounded-full transition-colors shadow-inner focus:outline-none focus:ring-2 focus:ring-[#007ACC]/50 focus:ring-offset-1 focus:ring-offset-[#252526] ${value ? 'bg-[#007ACC]' : 'bg-[#3C3C3C]'}`}
                        >
                            <span className={`inline-block size-3.5 rounded-full bg-white transition-transform shadow-sm ${value ? 'translate-x-4' : 'translate-x-[2px] opacity-80'}`} />
                        </button>
                    ) : (
                        <input
                            type={typeof value === 'number' ? "number" : "text"}
                            value={localValue}
                            onChange={(e) => handleLocalChange(e.target.value)}
                            onFocus={() => { isFocusedRef.current = true; onFocus?.(); }}
                            onBlur={() => { isFocusedRef.current = false; flushChange(); onBlur?.(); }}
                            className="h-7 w-full rounded-md border border-[#3C3C3C] bg-[#1E1E1E] px-2.5 text-right font-mono text-xs text-[#D4D4D4] transition-all focus:border-[#007ACC] focus:ring-1 focus:ring-[#007ACC]/50 focus:outline-none shadow-sm"
                        />
                    )
                )}
            </div>
        </div>
    );
}

export const ParameterInput = memo(ParameterInputInner);