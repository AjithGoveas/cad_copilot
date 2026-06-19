"use client";

import React, { useState } from "react";
import { toggleUserApproval } from "@/app/actions/admin";
import { toast } from "sonner";
import { Loader2, Mail, Calendar, UserCheck, UserX } from "lucide-react";

interface UserItem {
  id: string;
  email: string;
  isApproved: boolean;
  createdAt: Date;
}

export default function AdminTable({ initialUsers }: { initialUsers: UserItem[] }) {
  const [users, setUsers] = useState<UserItem[]>(initialUsers);
  const [pendingUserIds, setPendingUserIds] = useState<Record<string, boolean>>({});

  const handleToggle = async (userId: string, currentStatus: boolean) => {
    setPendingUserIds((prev) => ({ ...prev, [userId]: true }));
    const targetStatus = !currentStatus;

    try {
      const res = await toggleUserApproval(userId, targetStatus);
      if (res?.error) {
        toast.error(res.error);
      } else {
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, isApproved: targetStatus } : u))
        );
        toast.success(
          targetStatus
            ? `User approved successfully`
            : `User approval revoked`
        );
      }
    } catch (err) {
      toast.error("An error occurred. Please try again.");
    } finally {
      setPendingUserIds((prev) => ({ ...prev, [userId]: false }));
    }
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="rounded-2xl border border-[#3C3C3C]/80 bg-[#252526]/80 shadow-2xl backdrop-blur-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#3C3C3C]/80 bg-[#1E1E1E]/50 font-mono text-[10px] font-bold uppercase tracking-wider text-[#A6A6A6]">
              <th className="px-6 py-4">Name</th>
              <th className="px-6 py-4">Email</th>
              <th className="px-6 py-4">Registration Date</th>
              <th className="px-6 py-4 text-right">Access Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#3C3C3C]/40 text-sm">
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-xs text-[#868A91] font-mono">
                  No standard user accounts found.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const name = user.email.split("@")[0];
                const isPending = pendingUserIds[user.id];

                return (
                  <tr
                    key={user.id}
                    className="hover:bg-zinc-800/25 transition-colors duration-150"
                  >
                    <td className="px-6 py-4 font-medium text-[#DFE1E5] capitalize">
                      <div className="flex items-center gap-2">
                        <div className="flex size-7 items-center justify-center rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-[#A6A6A6]">
                          <span className="text-xs font-bold uppercase font-mono">{name.slice(0, 2)}</span>
                        </div>
                        <span>{name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#A6A6A6]">
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <Mail className="h-3.5 w-3.5 text-zinc-500" />
                        <span>{user.email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-[#A6A6A6]">
                      <div className="flex items-center gap-2 font-mono text-xs">
                        <Calendar className="h-3.5 w-3.5 text-zinc-500" />
                        <span>{formatDate(user.createdAt)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-3.5">
                        <span className={`inline-flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                          user.isApproved 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                            : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        }`}>
                          {user.isApproved ? (
                            <>
                              <UserCheck className="h-3 w-3" />
                              <span>Approved</span>
                            </>
                          ) : (
                            <>
                              <UserX className="h-3 w-3 animate-pulse" />
                              <span>Pending</span>
                            </>
                          )}
                        </span>
                        
                        <button
                          type="button"
                          onClick={() => handleToggle(user.id, user.isApproved)}
                          disabled={isPending}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-300 focus:outline-none cursor-pointer border ${
                            user.isApproved 
                              ? "bg-[#007ACC] border-[#007ACC]/50 shadow-[0_0_10px_rgba(0,122,204,0.3)]" 
                              : "bg-[#1E1E1E] border-[#3C3C3C]"
                          }`}
                        >
                          <span
                            className={`inline-block size-4 transform rounded-full bg-white transition-transform duration-300 ${
                              user.isApproved ? "translate-x-4" : "translate-x-0.5"
                            } flex items-center justify-center shadow`}
                          >
                            {isPending && (
                              <Loader2 className="h-2.5 w-2.5 animate-spin text-[#007ACC]" />
                            )}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
