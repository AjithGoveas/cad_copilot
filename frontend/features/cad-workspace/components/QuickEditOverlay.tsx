'use client';

import { Html } from '@react-three/drei';
import { useState, useRef, useEffect } from 'react';
import { AnnotationEntry } from '@/lib/openscadParameters';

type Props = {
    position: [number, number, number];
    parameterKey: string;
    annotation: AnnotationEntry;
    onUpdate: (key: string, newValue: number) => void;
    onCancel: () => void;
};

export function QuickEditOverlay({ position, parameterKey, annotation, onUpdate, onCancel }: Props) {
    const [val, setVal] = useState(annotation?.value?.toString() || '');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [parameterKey]);

    useEffect(() => {
        setVal(annotation?.value?.toString() || '');
    }, [annotation?.value]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const numVal = parseFloat(val);
            if (!isNaN(numVal)) {
                onUpdate(parameterKey, numVal);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
        }
    };

    return (
        <Html position={position} center zIndexRange={[100, 0]}>
            <div className="flex flex-col items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
                <div className="rounded-lg border border-blue-500/50 bg-zinc-900/90 p-2 shadow-2xl backdrop-blur-xl">
                    <div className="mb-1 flex items-center justify-between px-1 gap-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                            {parameterKey}
                        </span>
                        <span className="text-[9px] text-zinc-600">Enter to save</span>
                    </div>
                    <input
                        ref={inputRef}
                        type="number"
                        value={val}
                        onChange={(e) => setVal(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onBlur={onCancel}
                        className="w-full rounded bg-black/50 px-2 py-1 text-center font-mono text-sm font-semibold text-blue-400 outline-none focus:ring-1 focus:ring-blue-500"
                        step="any"
                        onPointerDown={(e) => e.stopPropagation()}
                    />
                </div>
            </div>
        </Html>
    );
}
