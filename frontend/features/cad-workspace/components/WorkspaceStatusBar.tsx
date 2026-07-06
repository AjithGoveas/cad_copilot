'use client';

import { Cpu, AlertTriangle, Sparkles } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

type Props = {
    status: 'idle' | 'compiling' | 'ready' | 'error';
    statusText: string;
    warnings: string[];
    onFixWithAI?: (warnings: string[]) => void;
    isGenerating?: boolean;
};

export function WorkspaceStatusBar({
    status,
    statusText,
    warnings,
    onFixWithAI,
    isGenerating,
}: Props) {
    const hasWarnings = warnings.length > 0;

    return (
        <div className="absolute bottom-4 left-4 z-20 flex flex-col gap-2 max-w-md pointer-events-auto">

            {/* Non-Fatal Warnings Overlay Banner */}
            {hasWarnings && (
                <div className="glass flex flex-col gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 shadow-2xl backdrop-blur-xl animate-in slide-in-from-bottom-2 duration-300 text-zinc-100 max-w-sm">
                    <div className="flex items-start gap-2.5">
                        <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="flex flex-col">
                            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">Compilation Warnings</span>
                            <div className="mt-1 flex flex-col gap-1 text-[10px] text-amber-200/80 font-mono max-h-24 overflow-y-auto">
                                {warnings.map((w, idx) => (
                                    <div key={idx} className="leading-relaxed border-b border-amber-500/10 pb-0.5 last:border-0">{w}</div>
                                ))}
                            </div>
                        </div>
                    </div>
                    {onFixWithAI && (
                        <button
                            onClick={() => onFixWithAI(warnings)}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all hover:scale-[1.02] active:scale-95 shadow-[0_4px_12px_rgba(245,158,11,0.2)]"
                        >
                            <Sparkles size={11} />
                            Fix with AI
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
