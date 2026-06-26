'use client';

import { useParams, usePathname } from 'next/navigation';
import WorkspaceContainer from '@/features/cad-workspace/containers/WorkspaceContainer';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const sessionId = params?.sessionId as string | undefined;

  const isAuthOrView = pathname?.includes('/login') || pathname?.includes('/signup') || pathname?.includes('/view');
  const isDemo = pathname?.includes('/demo');

  if (isAuthOrView) {
    return <>{children}</>;
  }

  return (
    <>
      <WorkspaceContainer sessionId={sessionId} isDemoMode={isDemo} />
      {children}
    </>
  );
}
