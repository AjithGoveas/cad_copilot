"use client";

import { signOut } from "next-auth/react";
import { LogOut } from "lucide-react";

export default function LogoutButton() {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/app/login" })}
      className="inline-flex items-center gap-2 rounded-xl bg-red-950/30 hover:bg-red-950/50 border border-red-900/30 hover:border-red-900/50 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-red-450 hover:text-red-400 transition-all duration-200 active:scale-[0.98] cursor-pointer shadow-[0_0_15px_rgba(239,68,68,0.05)]"
    >
      <LogOut className="h-4 w-4" />
      Logout
    </button>
  );
}
