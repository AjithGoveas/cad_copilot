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
    label,
    value,
    isFocused,
    isHovered,
    isReadOnly = false,
    onChange,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const displayLabel = useMemo(() => label.replace(/_/g, ' '), [label]);




    // For larger inputs (like objects/strings), we stack them. 
    // For simple inputs (numbers/booleans), we use a clean horizontal row.
    const isComplex = typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string';
    const isHighlighted = isFocused || isHovered;

    // Helper to stringify value for input
    const getValueString = (val: unknown) => {
        if (typeof val === 'object' && val !== null) {
            return JSON.stringify(val, null, 2);
        }
        return String(val ?? '');
    };

    const [localValue, setLocalValue] = useState(() => getValueString(value));
    const isFocusedRef = useRef(false);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Sync external prop value to local state when it changes from the outside,
    // but only if the user is not actively typing (i.e. not focused).
    useEffect(() => {
        if (!isFocusedRef.current) {
            setLocalValue(getValueString(value));
        }
    }, [value]);

    const handleLocalChange = (newValString: string) => {
        setLocalValue(newValString);

        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        debounceTimerRef.current = setTimeout(() => {
            if (typeof value === 'number') {
                const parsed = newValString === '' ? 0 : Number(newValString);
                if (!isNaN(parsed)) {
                    onChange?.(parsed);
                }
            } else if (typeof value === 'string') {
                onChange?.(newValString);
            } else if (isComplex) {
                try {
                    const parsed = JSON.parse(newValString);
                    onChange?.(parsed);
                } catch (e) {
                    // Ignore invalid JSON while typing
                }
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
            if (!isNaN(parsed) && parsed !== value) {
                onChange?.(parsed);
            }
        } else if (typeof value === 'string') {
            if (localValue !== value) {
                onChange?.(localValue);
            }
        } else if (isComplex) {
            try {
                const parsed = JSON.parse(localValue);
                if (JSON.stringify(parsed) !== JSON.stringify(value)) {
                    onChange?.(parsed);
                }
            } catch (e) {
                // Restore valid value if invalid JSON was left
                setLocalValue(getValueString(value));
            }
        }
    };

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    return (
        <div 
            id={`param-card-${label}`}
            ref={containerRef}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocus={onFocus}
            onBlur={onBlur}
            className={`group flex py-2.5 transition-all border-b border-zinc-800/40 last:border-0 ${
            isComplex ? 'flex-col gap-2' : 'items-center justify-between gap-4'
        } ${isHighlighted ? 'bg-amber-500/10 -mx-4 px-4 border-y border-amber-500/20 shadow-[inset_4px_0_0_0_#f59e0b]' : ''}`}>
            
            <div className="flex items-center gap-2 w-1/3 shrink-0">
                <label 
                    className={`text-[11px] font-medium tracking-wide capitalize transition-colors group-hover:text-zinc-200 truncate ${
                        isHighlighted ? 'text-amber-400' : 'text-zinc-400'
                    }`}
                    title={displayLabel}
                >
                    {displayLabel}
                </label>
                {isHighlighted && (
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                )}
            </div>

            <div className={`flex justify-end ${isComplex ? 'w-full' : 'flex-1'}`}>
                {isReadOnly ? (
                    <div className="flex items-center min-h-7">
                        {typeof value === 'number' && (
                            <span className="font-mono text-xs font-semibold text-zinc-300">
                                {value}
                            </span>
                        )}
                        {typeof value === 'boolean' && (
                            <span className={`font-mono text-xs font-bold uppercase tracking-wider ${value ? 'text-amber-500' : 'text-zinc-500'}`}>
                                {value ? 'TRUE' : 'FALSE'}
                            </span>
                        )}
                        {typeof value === 'string' && (
                            <span className="font-mono text-xs text-zinc-300">
                                "{value}"
                            </span>
                        )}
                        {isComplex && (
                            <pre className="font-mono text-[10px] text-zinc-500 bg-zinc-950/30 px-1.5 py-0.5 rounded max-w-[200px] truncate" title={JSON.stringify(value, null, 2)}>
                                {JSON.stringify(value)}
                            </pre>
                        )}
                    </div>
                ) : (
                    <>
                        {typeof value === 'number' && (
                            <input
                                type="number"
                                value={localValue}
                                onChange={(e) => handleLocalChange(e.target.value)}
                                onFocus={() => {
                                    isFocusedRef.current = true;
                                    onFocus?.();
                                }}
                                onBlur={() => {
                                    isFocusedRef.current = false;
                                    flushChange();
                                    onBlur?.();
                                }}
                                className="h-7 w-24 rounded border border-zinc-800 bg-zinc-950/50 px-2 text-right font-mono text-xs text-zinc-300 shadow-inner transition-all hover:border-zinc-600 hover:text-zinc-100 focus:border-amber-500/50 focus:bg-zinc-900 focus:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                            />
                        )}

                        {typeof value === 'boolean' && (
                            <button
                                onClick={() => onChange?.(!value)}
                                className={`relative flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-1 focus:ring-offset-zinc-950 ${
                                    value ? 'bg-amber-500' : 'bg-zinc-700 hover:bg-zinc-600'
                                }`}
                                role="switch"
                                aria-checked={value as boolean}
                            >
                                <span className={`inline-block size-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                                    value ? 'translate-x-4.5' : 'translate-x-1'
                                }`} />
                            </button>
                        )}

                        {typeof value === 'string' && (
                            <input
                                type="text"
                                value={localValue}
                                onChange={(e) => handleLocalChange(e.target.value)}
                                onFocus={() => {
                                    isFocusedRef.current = true;
                                    onFocus?.();
                                }}
                                onBlur={() => {
                                    isFocusedRef.current = false;
                                    flushChange();
                                    onBlur?.();
                                }}
                                className="h-7 w-full rounded border border-zinc-800 bg-zinc-950/50 px-2.5 text-xs text-zinc-300 shadow-inner transition-all hover:border-zinc-600 hover:text-zinc-100 focus:border-amber-500/50 focus:bg-zinc-900 focus:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                            />
                        )}

                        {isComplex && (
                            <textarea
                                value={localValue}
                                rows={5}
                                onChange={(e) => handleLocalChange(e.target.value)}
                                onFocus={() => {
                                    isFocusedRef.current = true;
                                    onFocus?.();
                                }}
                                onBlur={() => {
                                    isFocusedRef.current = false;
                                    flushChange();
                                    onBlur?.();
                                }}
                                className="w-full resize-y rounded border border-zinc-800 bg-zinc-950/80 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400 shadow-inner transition-all hover:border-zinc-700 hover:text-zinc-300 focus:border-amber-500/50 focus:bg-zinc-900 focus:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 custom-scrollbar"
                                spellCheck={false}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export const ParameterInput = memo(ParameterInputInner);