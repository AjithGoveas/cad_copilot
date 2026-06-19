import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import AdminTable from "./AdminTable";
import LogoutButton from "./LogoutButton";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "ADMIN") {
    notFound();
  }

  const users = await prisma.user.findMany({
    where: {
      role: "USER",
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      email: true,
      isApproved: true,
      createdAt: true,
    },
  });

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-[#181818] px-6 py-12 selection:bg-[#007ACC]/30 overflow-hidden font-sans">
      {/* Background CAD Grid Overlay */}
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
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -z-10 h-[500px] w-[500px] rounded-full bg-[#007ACC]/3 blur-[140px]" />
      <div className="absolute bottom-1/4 left-1/3 -z-10 h-[500px] w-[500px] rounded-full bg-[#8b5cf6]/2 blur-[140px]" />

      <div className="mx-auto w-full max-w-5xl space-y-8 z-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#3C3C3C]/40 pb-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-black uppercase tracking-[0.25em] text-[#00C8FF]">
                CADVΞX CONTROL
              </span>
              <span className="rounded bg-[#007ACC]/10 px-2 py-0.5 border border-[#007ACC]/25 text-[8px] font-mono font-bold text-[#007ACC] uppercase">
                ADMIN PANEL
              </span>
            </div>
            <h1 className="text-2xl font-bold text-[#DFE1E5] tracking-tight">Workstation Authorization</h1>
            <p className="text-xs text-[#868A91]">Authorize and manage engineer registration profiles</p>
          </div>
          
          <div className="flex items-center gap-3">
            <LogoutButton />
          </div>
        </div>

        <AdminTable initialUsers={users} />
      </div>
    </div>
  );
}
