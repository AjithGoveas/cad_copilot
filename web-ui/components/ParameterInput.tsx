'use client';

import { useMemo } from 'react';

type Props = {
    label: string;
    value: unknown;
    isFocused?: boolean;
    onChange: (v: unknown) => void;
};

export function ParameterInput({ label, value, isFocused, onChange }: Props) {
    const displayLabel = useMemo(() => label.replace(/_/g, ' '), [label]);

    // For larger inputs (like objects/strings), we stack them. 
    // For simple inputs (numbers/booleans), we use a clean horizontal row.
    const isComplex = typeof value !== 'number' && typeof value !== 'boolean' && typeof value !== 'string';

    return (
        <div className={`group flex py-2.5 transition-colors border-b border-zinc-800/40 last:border-0 ${
            isComplex ? 'flex-col gap-2' : 'items-center justify-between gap-4'
        } ${isFocused ? 'bg-amber-500/5 -mx-4 px-4 border-y border-amber-500/20' : ''}`}>
            
            <div className="flex items-center gap-2 w-1/3 shrink-0">
                <label 
                    className="text-[11px] font-medium tracking-wide text-zinc-400 capitalize transition-colors group-hover:text-zinc-200 truncate"
                    title={displayLabel}
                >
                    {displayLabel}
                </label>
                {isFocused && (
                    <span className="size-1.5 rounded-full bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
                )}
            </div>

            <div className={`flex justify-end ${isComplex ? 'w-full' : 'flex-1'}`}>
                {typeof value === 'number' && (
                    <input
                        type="number"
                        value={Number.isFinite(value) ? value : 0}
                        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                        className="h-7 w-24 rounded border border-zinc-800 bg-zinc-950/50 px-2 text-right font-mono text-xs text-zinc-300 shadow-inner transition-all hover:border-zinc-600 hover:text-zinc-100 focus:border-amber-500/50 focus:bg-zinc-900 focus:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                )}

                {typeof value === 'boolean' && (
                    <button
                        onClick={() => onChange(!value)}
                        className={`relative flex h-5 w-9 items-center rounded-full transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-1 focus:ring-offset-zinc-950 ${
                            value ? 'bg-amber-500' : 'bg-zinc-700 hover:bg-zinc-600'
                        }`}
                        role="switch"
                        aria-checked={value}
                    >
                        <span className={`inline-block size-3.5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
                            value ? 'translate-x-4.5' : 'translate-x-1'
                        }`} />
                    </button>
                )}

                {typeof value === 'string' && (
                    <input
                        type="text"
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        className="h-7 w-full rounded border border-zinc-800 bg-zinc-950/50 px-2.5 text-xs text-zinc-300 shadow-inner transition-all hover:border-zinc-600 hover:text-zinc-100 focus:border-amber-500/50 focus:bg-zinc-900 focus:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                    />
                )}

                {isComplex && (
                    <textarea
                        value={JSON.stringify(value, null, 2)}
                        rows={5}
                        onChange={(e) => {
                            try { onChange(JSON.parse(e.target.value)); } catch { /* Ignore mid-typing errors */ }
                        }}
                        className="w-full resize-y rounded border border-zinc-800 bg-zinc-950/80 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-400 shadow-inner transition-all hover:border-zinc-700 hover:text-zinc-300 focus:border-amber-500/50 focus:bg-zinc-900 focus:text-amber-100 focus:outline-none focus:ring-1 focus:ring-amber-500/50 custom-scrollbar"
                        spellCheck={false}
                    />
                )}
            </div>
        </div>
    );
}