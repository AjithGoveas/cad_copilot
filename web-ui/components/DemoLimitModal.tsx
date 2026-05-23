'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Clock, FileWarning, ArrowRight } from 'lucide-react';

type DemoLimitReason = 'time' | 'prompt' | 'export';

interface DemoLimitModalProps {
    reason: DemoLimitReason;
}

export function DemoLimitModal({ reason }: DemoLimitModalProps) {
    const router = useRouter();

    const getModalContent = () => {
        switch (reason) {
            case 'time':
                return {
                    icon: <Clock size={32} className="text-amber-500" />,
                    title: 'Demo session expired',
                    desc: 'Your 5-minute playground session has ended. To continue prototyping and saving your work, create a free account.'
                };
            case 'prompt':
                return {
                    icon: <FileWarning size={32} className="text-red-500" />,
                    title: 'Generation limit reached',
                    desc: 'The demo environment allows exactly one generation per session to prevent abuse. Unlock unlimited generations by signing up.'
                };
            case 'export':
                return {
                    icon: <Lock size={32} className="text-zinc-400" />,
                    title: 'Export locked',
                    desc: 'Sign up to export production-ready STL, DXF, and STEP models. Anonymous exports are disabled in the demo.'
                };
        }
    };

    const content = getModalContent();

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-md">
            <div className="w-full max-w-md bg-[#0a0a0a] border border-white/[0.05] shadow-[0_0_100px_rgba(0,0,0,1)] rounded-2xl overflow-hidden animate-in zoom-in-95 fade-in duration-300">
                <div className="p-8 flex flex-col items-center text-center">
                    <div className="size-16 rounded-2xl bg-white/[0.02] border border-white/[0.05] flex items-center justify-center mb-6 shadow-inner">
                        {content.icon}
                    </div>
                    
                    <h2 className="text-2xl font-bold text-white mb-3 tracking-tight">
                        {content.title}
                    </h2>
                    
                    <p className="text-sm text-zinc-400 leading-relaxed mb-8">
                        {content.desc}
                    </p>

                    <div className="w-full space-y-3">
                        <button 
                            onClick={() => router.push('/app/signup')}
                            className="w-full bg-amber-500 hover:bg-amber-400 text-black py-3 rounded-lg font-bold text-sm tracking-wide transition-colors flex items-center justify-center gap-2"
                        >
                            Create Free Account <ArrowRight size={16} />
                        </button>
                        <button 
                            onClick={() => router.push('/app/login')}
                            className="w-full bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.05] text-white py-3 rounded-lg font-bold text-sm tracking-wide transition-colors"
                        >
                            Sign In
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
