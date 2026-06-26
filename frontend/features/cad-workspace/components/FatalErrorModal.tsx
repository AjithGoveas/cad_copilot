'use client';

import { AlertOctagon, Terminal, RefreshCw, Sparkles } from 'lucide-react';

type Props = {
    isOpen: boolean;
    errorMessage: string;
    errorDetails: string;
    onRepair?: () => void;
    onRespawn?: () => void;
    isAutoRepairing?: boolean;
};

export function FatalErrorModal({
    isOpen,
    errorMessage,
    errorDetails,
    onRepair,
    onRespawn,
    isAutoRepairing = false,
}: Props) {
    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#09090b]/80 backdrop-blur-md p-6 animate-in fade-in duration-300">
            <div className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-red-500/30 bg-[#18181b] p-6 shadow-2xl animate-in zoom-in-95 duration-300">
                {/* Decorative background glow */}
                <div className="absolute -left-16 -top-16 -z-10 size-32 rounded-full bg-red-500/10 blur-3xl" />
                <div className="absolute -right-16 -bottom-16 -z-10 size-32 rounded-full bg-red-500/10 blur-3xl" />

                <div className="flex flex-col gap-4">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                        <div className="flex size-10 items-center justify-center rounded-xl bg-red-500/10 border border-red-500/20 shadow-[0_0_15px_rgba(239,68,68,0.15)]">
                            <AlertOctagon className="text-red-500" size={20} />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold uppercase tracking-wider text-red-500">Geometry Engine Exception</h3>
                            <p className="text-[10px] text-zinc-400">WebGL Viewport Rendering Halted</p>
                        </div>
                    </div>

                    {/* Error Message */}
                    <div className="rounded-lg bg-red-500/5 border border-red-500/10 p-3">
                        <p className="text-xs font-semibold text-red-200 leading-relaxed">{errorMessage}</p>
                    </div>

                    {/* Details/Logs Terminal */}
                    {errorDetails && (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
                                <Terminal size={12} />
                                <span>Compiler Diagnostics</span>
                            </div>
                            <pre className="max-h-36 overflow-y-auto rounded-lg bg-zinc-950 p-3 font-mono text-[10px] text-red-400/90 leading-normal custom-scrollbar border border-zinc-800">
                                {errorDetails}
                            </pre>
                        </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex items-center justify-end gap-2.5 mt-2">
                        {onRespawn && (
                            <button
                                onClick={onRespawn}
                                className="flex items-center gap-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
                            >
                                <RefreshCw size={11} />
                                Respawn Kernel
                            </button>
                        )}
                        {onRepair && (
                            <button
                                onClick={onRepair}
                                disabled={isAutoRepairing}
                                className="flex items-center gap-1.5 rounded-xl bg-[#007ACC] hover:bg-[#005A9E] text-white px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all shadow-[0_4px_12px_rgba(0,122,204,0.3)] hover:scale-[1.02] active:scale-95 disabled:opacity-50 cursor-pointer"
                            >
                                <Sparkles size={11} className={isAutoRepairing ? 'animate-spin' : ''} />
                                {isAutoRepairing ? 'Repairing with AI...' : 'Repair with AI'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
