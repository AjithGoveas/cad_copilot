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
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-[#050505] px-4 selection:bg-amber-500/20">
      {/* Background ambient gold glow */}
      <div className="absolute top-1/4 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-amber-500/5 blur-[120px]" />
      <div className="absolute bottom-1/4 left-1/3 -z-10 h-96 w-96 rounded-full bg-amber-500/[0.02] blur-[150px]" />

      <div className="w-full max-w-md space-y-6">
        {/* Logo/Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/[0.03] shadow-[0_0_20px_rgba(245,158,11,0.05)] ring-1 ring-amber-500/10">
            <ShieldCheck className="h-6 w-6 text-amber-400" />
          </div>
          <h1 className="font-mono text-[11px] font-black uppercase tracking-widest text-amber-500">
            CAD Copilot — Auth Gateway
          </h1>
          <p className="text-2xl font-bold text-zinc-100 tracking-tight">Welcome back to CAD Copilot</p>
          <p className="text-xs text-zinc-500">Sign in to your secure workstation workspace</p>
        </div>

        {/* Login Form Card */}
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="login-email" className="text-xs font-semibold text-zinc-400">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-600">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  id="login-email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="login-password" className="text-xs font-semibold text-zinc-400">
                  Password
                </label>
              </div>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-zinc-600">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="login-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-950/80 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-all focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              id="login-submit-btn"
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-3 text-sm font-bold text-amber-950 shadow-[0_4px_14px_rgba(245,158,11,0.25)] transition-all hover:bg-amber-400 hover:shadow-[0_6px_20px_rgba(245,158,11,0.4)] active:scale-[0.98] disabled:pointer-events-none disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-zinc-500" />
              ) : (
                <>
                  <LogIn className="h-4 w-4" />
                  <span>Access Workstation</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-zinc-800/80 pt-6 text-center">
            <p className="text-xs text-zinc-500">
              New to CAD Copilot?{" "}
              <Link
                id="signup-link"
                href="/app/signup"
                className="font-semibold text-amber-400 hover:text-amber-300 transition-colors inline-flex items-center gap-1 group"
              >
                Create Account
                <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[10px] text-zinc-600 font-mono">
          SECURE WORKSTATION GATEWAY &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
