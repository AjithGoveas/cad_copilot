import useSWR, { mutate } from 'swr';
import { useCallback } from 'react';
import type { Session } from '../types';

const defaultFetcher = (url: string) => fetch(url).then((res) => {
    if (!res.ok) throw new Error('API request failed');
    return res.json();
});

export function useSessionHistory(sessionId?: string) {
    const shouldFetchList = true;
    const shouldFetchSession = !!sessionId && !sessionId.startsWith('temp-');

    // Fetch list of recent sessions
    const {
        data: historySessions,
        error: listError,
        isLoading: isLoadingHistory,
        mutate: mutateList,
    } = useSWR<Session[]>(
        shouldFetchList ? '/api/history' : null,
        defaultFetcher,
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 5000,
        }
    );

    // Fetch details of active session
    const {
        data: activeSessionData,
        error: activeSessionError,
        isLoading: isLoadingActiveSession,
        isValidating: isValidatingActiveSession,
        mutate: mutateActiveSession,
    } = useSWR<Session>(
        shouldFetchSession ? `/api/history/session/${sessionId}` : null,
        defaultFetcher,
        {
            revalidateOnFocus: false,
            keepPreviousData: true,
            dedupingInterval: 5000,
        }
    );

    // Prefetch a session timeline into SWR cache
    const prefetchSession = useCallback((targetSessionId: string) => {
        if (!targetSessionId || targetSessionId.startsWith('temp-')) return;
        const key = `/api/history/session/${targetSessionId}`;
        
        // Execute prefetch silently in background
        mutate(
            key,
            defaultFetcher(key).catch((err) => {
                console.error(`[prefetchSession] failed for ${targetSessionId}:`, err);
                return null;
            }),
            { revalidate: false }
        );
    }, []);

    return {
        historySessions: historySessions || [],
        activeSessionData,
        isLoadingHistory,
        isLoadingActiveSession,
        isValidatingActiveSession,
        listError,
        activeSessionError,
        mutateList,
        mutateActiveSession,
        prefetchSession,
    };
}
