import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import HitlWorkspace from '@/components/HitlWorkspace';

type Props = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function Page({ params }: Props) {
  const session = await getServerSession(authOptions);

  if (session?.user?.role === "ADMIN") {
    redirect("/admin");
  }

  const { sessionId } = await params;

  return <HitlWorkspace sessionId={sessionId} />;
}
