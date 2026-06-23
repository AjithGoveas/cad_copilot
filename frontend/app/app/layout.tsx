'use client';

import { useParams, usePathname } from 'next/navigation';
import HitlWorkspace from '@/components/HitlWorkspace';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const sessionId = params?.sessionId as string | undefined;

  const isAuthOrView = pathname?.includes('/login') || pathname?.includes('/signup') || pathname?.includes('/view');

  if (isAuthOrView) {
    return <>{children}</>;
  }

  return (
    <>
      <HitlWorkspace sessionId={sessionId} />
      {children}
    </>
  );
}
