"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, LogIn, Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Please fill in all fields");
      return;
    }

    setIsLoading(true);

    try {
      const res = await signIn("credentials", {
        email: email.toLowerCase(),
        password,
        redirect: false,
      });

      if (res?.error) {
        if (res.error === "CredentialsSignin") {
          toast.error("Invalid email or password");
        } else {
          toast.error(res.error);
        }
      } else {
        toast.success("Logged in successfully!");
        router.push("/app");
        router.refresh();
      }
    } catch (error) {
      console.error(error);
      toast.error("An error occurred during log in");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-[#181818] px-4 selection:bg-[#007ACC]/30 overflow-hidden font-sans">
      {/* CAD Grid Background Overlay */}
      <div 
        className="absolute inset-0 -z-20 opacity-20 pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.02) 1px, transparent 1px)
          `,
          backgroundSize: '30px 30px',
        }}
      />
      
      {/* Tech Glows */}
      <div className="absolute top-1/4 left-1/2 -z-10 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-[#007ACC]/5 blur-[120px]" />
      <div className="absolute bottom-1/4 left-1/3 -z-10 h-[450px] w-[450px] rounded-full bg-[#8b5cf6]/3 blur-[140px]" />

      {/* Top Navigation Header */}
      <header className="absolute top-0 left-0 right-0 h-14 flex items-center px-6 md:px-8 border-b border-[#3C3C3C]/30 bg-[#252526]/20 backdrop-blur-md z-30">
        <Link href="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div className="flex size-7 items-center justify-center rounded-lg bg-[#007ACC]/10 border border-[#007ACC]/30 text-[#007ACC]">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <span className="font-mono text-xs font-black uppercase tracking-[0.2em] text-[#00C8FF]">
            CADVΞX
          </span>
        </Link>
      </header>

      <div className="w-full max-w-md space-y-6 pt-12 animate-in fade-in slide-in-from-bottom-5 duration-700">
        {/* Simple Centered Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="relative flex size-14 items-center justify-center rounded-2xl border border-[#007ACC]/25 bg-[#252526] shadow-[0_0_30px_rgba(0,122,204,0.1)] ring-1 ring-[#007ACC]/10 group hover:border-[#007ACC]/50 transition-all duration-300 mb-2">
            <ShieldCheck className="h-6 w-6 text-[#007ACC] group-hover:scale-110 transition-transform duration-300" />
          </div>
          <h1 className="text-2xl font-bold text-[#DFE1E5] tracking-tight">Welcome back</h1>
          <p className="text-xs text-[#868A91]">Sign in to your secure workstation workspace</p>
        </div>

        {/* Login Form Card */}
        <div className="relative rounded-2xl border border-[#3C3C3C]/80 bg-[#252526]/80 p-8 shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Subtle top highlights */}
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#007ACC]/45 to-transparent" />
          
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6] font-mono">
                Email Address
              </label>
              <div className="relative group">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#A6A6A6] group-focus-within:text-[#00C8FF] transition-colors">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  id="login-email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-[#3C3C3C] bg-[#1E1E1E] py-3 pl-11 pr-4 text-sm text-[#DFE1E5] placeholder-[#606368] outline-none transition-all duration-200 focus:border-[#007ACC] focus:ring-1 focus:ring-[#007ACC]/30 hover:border-[#4d4d52]"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6] font-mono">
                  Password
                </label>
              </div>
              <div className="relative group">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#A6A6A6] group-focus-within:text-[#00C8FF] transition-colors">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-[#3C3C3C] bg-[#1E1E1E] py-3 pl-11 pr-4 text-sm text-[#DFE1E5] placeholder-[#606368] outline-none transition-all duration-200 focus:border-[#007ACC] focus:ring-1 focus:ring-[#007ACC]/30 hover:border-[#4d4d52]"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              disabled={isLoading}
              className="relative flex w-full items-center justify-center gap-2 rounded-xl bg-[#007ACC] py-3.5 text-xs font-bold uppercase tracking-widest text-white shadow-[0_4px_14px_rgba(0,122,204,0.2)] transition-all duration-300 hover:bg-[#007ACC]/90 hover:shadow-[0_6px_20px_rgba(0,122,204,0.4)] active:scale-[0.98] disabled:pointer-events-none disabled:bg-[#3C3C3C] disabled:text-[#868A91] disabled:shadow-none cursor-pointer"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  <span>Access Workstation</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-7 border-t border-[#3C3C3C]/80 pt-6 text-center">
            <p className="text-xs text-[#868A91]">
              New to CADVEX?{" "}
              <Link
                id="signup-link"
                href="/app/signup"
                className="font-semibold text-[#00C8FF] hover:text-[#007ACC] transition-colors inline-flex items-center gap-1 group"
              >
                Create Account
                <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-[#868A91] font-mono">
          SECURE WORKSTATION GATEWAY &copy; {new Date().getFullYear()} | ALL RIGHTS RESERVED TO DATAVEX.AI
        </p>
      </div>
    </div>
  );
}
