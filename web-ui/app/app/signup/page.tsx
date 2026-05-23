"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUpUser } from "@/app/actions/auth";
import { toast } from "sonner";
import { Loader2, UserPlus, Lock, Mail, ArrowRight, ShieldCheck } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !confirmPassword) {
      toast.error("Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setIsLoading(true);

    try {
      const res = await signUpUser(email, password);

      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Account created successfully! Please log in.");
        router.push("/app/login");
      }
    } catch (error) {
      console.error(error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen w-full flex-col items-center justify-center bg-[#181818] px-4 selection:bg-[#007ACC]/20">
      {/* Background ambient blue glow */}
      <div className="absolute top-1/4 left-1/2 -z-10 h-80 w-80 -translate-x-1/2 rounded-full bg-[#007ACC]/5 blur-[120px]" />
      <div className="absolute bottom-1/4 left-1/3 -z-10 h-96 w-96 rounded-full bg-[#007ACC]/[0.02] blur-[150px]" />

      <div className="w-full max-w-md space-y-6">
        {/* Logo/Brand Header */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="flex size-12 items-center justify-center rounded-2xl border border-[#007ACC]/20 bg-[#007ACC]/[0.03] shadow-[0_0_20px_rgba(0,122,204,0.05)] ring-1 ring-[#007ACC]/10">
            <ShieldCheck className="h-6 w-6 text-[#007ACC]" />
          </div>
          <h1 className="font-mono text-[11px] font-black uppercase tracking-widest text-[#007ACC]">
            CAD Copilot — Auth Gateway
          </h1>
          <p className="text-2xl font-bold text-[#DFE1E5] tracking-tight">Create your workstation account</p>
          <p className="text-xs text-[#868A91]">Access AI-powered blueprint-to-CAD generators</p>
        </div>

        {/* Signup Form Card */}
        <div className="rounded-2xl border border-[#3C3C3C]/80 bg-[#252526]/80 p-8 shadow-2xl backdrop-blur-xl">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="signup-email" className="text-xs font-semibold text-[#A6A6A6]">
                Email Address
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#A6A6A6]">
                  <Mail className="h-4 w-4" />
                </span>
                <input
                  id="signup-email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] py-2.5 pl-10 pr-4 text-sm text-[#DFE1E5] placeholder-[#868A91] outline-none transition-all focus:border-[#007ACC]/50 focus:ring-1 focus:ring-[#007ACC]/50"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="signup-password" className="text-xs font-semibold text-[#A6A6A6]">
                Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#A6A6A6]">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="signup-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] py-2.5 pl-10 pr-4 text-sm text-[#DFE1E5] placeholder-[#868A91] outline-none transition-all focus:border-[#007ACC]/50 focus:ring-1 focus:ring-[#007ACC]/50"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="signup-confirm-password" className="text-xs font-semibold text-[#A6A6A6]">
                Confirm Password
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#A6A6A6]">
                  <Lock className="h-4 w-4" />
                </span>
                <input
                  id="signup-confirm-password"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-[#3C3C3C] bg-[#1E1E1E] py-2.5 pl-10 pr-4 text-sm text-[#DFE1E5] placeholder-[#868A91] outline-none transition-all focus:border-[#007ACC]/50 focus:ring-1 focus:ring-[#007ACC]/50"
                  required
                  disabled={isLoading}
                />
              </div>
            </div>

            <button
              id="signup-submit-btn"
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#007ACC] py-3 text-sm font-bold text-white shadow-[0_4px_14px_rgba(0,122,204,0.25)] transition-all hover:bg-[#007ACC]/90 hover:shadow-[0_6px_20px_rgba(0,122,204,0.4)] active:scale-[0.98] disabled:pointer-events-none disabled:bg-[#3C3C3C] disabled:text-[#868A91] disabled:shadow-none"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  <span>Create Account</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-6 border-t border-[#3C3C3C]/80 pt-6 text-center">
            <p className="text-xs text-[#868A91]">
              Already have an account?{" "}
              <Link
                id="login-link"
                href="/app/login"
                className="font-semibold text-[#007ACC] hover:text-[#007ACC]/80 transition-colors inline-flex items-center gap-1 group"
              >
                Log In
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
