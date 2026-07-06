import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { workspaceApi } from '../api/workspaceApi';
import { extractOpenScadParameters, injectOpenScadParameters } from '@/lib/openscadParameters';
import { toast } from 'sonner';
import type { Message, Selection, EngineError } from '../types';

type Config = {
    isDemoMode: boolean;
    sessionId?: string;
    activeSessionId?: string;
    setActiveSessionId: (id?: string) => void;
    mutateActiveSession: () => void;
    mutateList: () => void;
    handleClearImport: () => void;
    activeSessionData?: any;
};

export function useWorkspaceEditor({
    isDemoMode,
    sessionId,
    activeSessionId,
    setActiveSessionId,
    mutateActiveSession,
    mutateList,
    handleClearImport,
    activeSessionData,
}: Config) {
    const router = useRouter();

    const [prompt, setPrompt] = useState('');
    const [messages, setMessages] = useState<Message[]>([]);
    const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash');

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

    const [cadScript, setCadScript] = useState<string>('');
    const [parameters, setParameters] = useState<Record<string, any>>({});
    const [isGenerating, setIsGenerating] = useState(false);

    const [shareToken, setShareToken] = useState<string | null>(null);
    const [targetPoint, setTargetPoint] = useState<[number, number, number] | null>(null);
    const [selection, setSelection] = useState<Selection | null>(null);
    const [isAutoRepairing, setIsAutoRepairing] = useState(false);

    const [promptCount, setPromptCount] = useState(0);
    const [demoLimitReason, setDemoLimitReason] = useState<'time' | 'prompt' | 'export' | 'entry-limit' | null>(null);

    const failedGenerationRef = useRef(false);

    // Sync activeSessionId with external sessionId prop updates
    useEffect(() => {
        setActiveSessionId(sessionId);
    }, [sessionId, setActiveSessionId]);

    // Restore state from active session history timeline
    useEffect(() => {
        if (activeSessionData && activeSessionData.historyItems && activeSessionData.historyItems.length > 0) {
            const items = activeSessionData.historyItems;
            const reconstructedMessages: Message[] = [];
            
            items.forEach((item: any) => {
                if (item.prompt) {
                    const meta = item.metaData as { attachment?: { name: string } } | null;
                    reconstructedMessages.push({
                        id: `user-${item.id}`,
                        role: 'user',
                        content: item.prompt,
                        attachment: meta?.attachment ? { name: meta.attachment.name } : undefined,
                    });
                }
                
                reconstructedMessages.push({
                    id: `assistant-${item.id}`,
                    role: 'assistant',
                    content: item.actionType === 'GENERATE'
                        ? `I've generated the OpenSCAD code for your request. You can now tweak the parameters in the drawer or edit the code directly.`
                        : `I've updated the model with your requested changes. Let me know if you need further adjustments.`,
                });
            });

            setMessages(reconstructedMessages);

            const latestSnapshot = items[items.length - 1];
            setCadScript(latestSnapshot.openscadCode);
            if (latestSnapshot.parametersJson) {
                setParameters(latestSnapshot.parametersJson);
            }
            if (activeSessionData.shareToken) {
                setShareToken(activeSessionData.shareToken);
            }
        }
    }, [activeSessionData]);

    // Reset workspace on session departure
    useEffect(() => {
        if (!sessionId) {
            if (failedGenerationRef.current) {
                failedGenerationRef.current = false;
                return;
            }
            setMessages([]);
            setCadScript('');
            setParameters({});
            setShareToken(null);
            setTargetPoint(null);
            setActiveSessionId(undefined);
            handleClearImport();
        }
    }, [sessionId, handleClearImport, setActiveSessionId]);

    // Demo Entry Count Tracking
    useEffect(() => {
        if (!isDemoMode) return;
        const currentCount = parseInt(localStorage.getItem('demoEntryCount') || '0', 10);
        if (currentCount >= 3) {
            setDemoLimitReason('entry-limit');
        } else {
            localStorage.setItem('demoEntryCount', (currentCount + 1).toString());
        }
    }, [isDemoMode]);

    const handleRepair = useCallback((engineError: EngineError | null) => {
        if (!engineError || isAutoRepairing || !cadScript) return;
        setIsAutoRepairing(true);

        const repairPromise = (async () => {
            try {
                const data = await workspaceApi.repairCad({
                    code: cadScript,
                    error: `${engineError.message}\n${engineError.details || ''}`,
                    sessionId: activeSessionId || sessionId || null,
                    model: selectedModel,
                    demoMode: isDemoMode,
                });

                if (!data.code) {
                    throw new Error('No repaired code returned');
                }

                setCadScript(data.code);
                const parsedParams = extractOpenScadParameters(data.code);
                setParameters(parsedParams);

                const repairMsg: Message = {
                    id: `repair-${Date.now()}`,
                    role: 'assistant',
                    content: `🔧 **Manual Repair:** Triggered repair for compilation error: *"${engineError.message}"*. Syntax has been corrected.`,
                };
                setMessages((prev) => [...prev, repairMsg]);
            } finally {
                setIsAutoRepairing(false);
            }
        })();

        toast.promise(repairPromise, {
            loading: 'Attempting code repair...',
            success: 'Repair succeeded!',
            error: 'Repair failed. Please check the compiler errors.',
        });
    }, [cadScript, activeSessionId, sessionId, selectedModel, isDemoMode, isAutoRepairing]);

    const handleGenerate = async (e?: React.FormEvent, overridePrompt?: string) => {
        if (e) e.preventDefault();
        const activePrompt = overridePrompt || prompt;
        if (!activePrompt.trim()) return;

        if (isDemoMode && promptCount >= 1) {
            setDemoLimitReason('prompt');
            return;
        }

        const userMsg: Message = { 
            id: Date.now().toString(), 
            role: 'user', 
            content: activePrompt,
            attachment: selectedFile ? { name: selectedFile.name, file: selectedFile } : undefined
        };
        
        setMessages((prev) => [...prev, userMsg]);
        setPrompt('');
        setSelectedFile(null);
        setIsGenerating(true);

        const isEditing = cadScript.trim().length > 0;

        let tempSessionId: string | undefined;
        if (!isEditing) {
            tempSessionId = `temp-${Date.now()}`;
            setActiveSessionId(tempSessionId);
            window.history.pushState(null, '', `/app/${tempSessionId}`);
        }

        try {
            let data;
            if (isEditing) {
                data = await workspaceApi.editCad({
                    prompt: activePrompt,
                    currentCode: cadScript,
                    targetPoint: targetPoint || null,
                    model: selectedModel,
                    demoMode: isDemoMode,
                    sessionId: activeSessionId || sessionId || null,
                });
            } else {
                data = await workspaceApi.generateCad(activePrompt, selectedModel, selectedFile, isDemoMode);
            }

            setCadScript(data.code);
            
            if (data.shareToken && data.shareToken !== 'demo-token') {
                setShareToken(data.shareToken);
            }
            
            const parsedParams = extractOpenScadParameters(data.code);
            setParameters(parsedParams);

            const assistantMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: isEditing
                    ? `I've updated the model with your requested changes. Let me know if you need further adjustments.`
                    : `I've generated the OpenSCAD code for your request. You can now tweak the parameters in the drawer or edit the code directly.`,
            };
            setMessages((prev) => [...prev, assistantMsg]);
            
            if (isEditing) {
                if (activeSessionId) {
                    mutateActiveSession();
                }
            } else if (data.id && data.id !== 'demo-project') {
                const newSessionPayload = {
                    id: data.id,
                    shareToken: data.shareToken,
                    title: activePrompt.length > 50 ? activePrompt.substring(0, 47) + '...' : activePrompt,
                    userId: '',
                    createdAt: data.createdAt,
                    updatedAt: data.createdAt,
                    historyItems: [
                        {
                            id: `init-${data.id}`,
                            sessionId: data.id,
                            actionType: 'GENERATE',
                            prompt: activePrompt,
                            openscadCode: data.code,
                            patchDelta: null,
                            isFullSnapshot: true,
                            parametersJson: data.parameters,
                            targetPoint: [],
                            metaData: userMsg.attachment ? { attachment: { name: userMsg.attachment.name } } : null,
                            createdAt: data.createdAt,
                        }
                    ]
                };

                mutateActiveSession();
                window.history.replaceState(null, '', `/app/${data.id}`);
                setActiveSessionId(data.id);
                mutateList();
            }
            
            if (isDemoMode) setPromptCount(prev => prev + 1);
            setTargetPoint(null);
        } catch (err: any) {
            toast.error(err?.message || (isEditing ? 'Failed to modify CAD model' : 'Failed to generate CAD model'));
            if (!isEditing) {
                failedGenerationRef.current = true;
                setPrompt(activePrompt);
                setSelectedFile(userMsg.attachment?.file || null);
                setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
                setActiveSessionId(undefined);
                window.history.replaceState(null, '', '/app');
            }
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFileChange = useCallback((file: File | null) => {
        setSelectedFile(file);
        if (file) {
            setUploadedFiles((prev) => {
                if (prev.some((f) => f.name === file.name && f.size === file.size)) return prev;
                return [...prev, file];
            });
        }
    }, []);

    const handleUpdateMessageFile = useCallback(async (messageId: string, file: File | null) => {
        if (file) {
            setUploadedFiles((prev) => {
                if (prev.some((f) => f.name === file.name && f.size === file.size)) return prev;
                return [...prev, file];
            });
        }

        const index = messages.findIndex((m) => m.id === messageId);
        if (index === -1) return;

        const targetMessage = messages[index];
        const updatedMessages = messages.slice(0, index);
        const updatedTargetMsg: Message = {
            ...targetMessage,
            attachment: file ? { name: file.name, file } : undefined,
        };

        setMessages([...updatedMessages, updatedTargetMsg]);
        setIsGenerating(true);

        try {
            const data = await workspaceApi.generateCad(targetMessage.content, selectedModel, file, isDemoMode);
            setCadScript(data.code);
            
            if (data.shareToken && data.shareToken !== 'demo-token') {
                setShareToken(data.shareToken);
            }
            
            const parsedParams = extractOpenScadParameters(data.code);
            setParameters(parsedParams);

            const assistantMsg: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `I've updated the model using the selected file context.`,
            };
            setMessages((prev) => [...prev, assistantMsg]);

            if (data.id && data.id !== 'demo-project') {
                router.push(`/app/${data.id}`);
            }
        } catch (err) {
            toast.error('Failed to regenerate model');
        } finally {
            setIsGenerating(false);
        }
    }, [messages, selectedModel, isDemoMode, router]);

    const handleParamChange = useCallback((key: string, value: unknown) => {
        setParameters((prev) => {
            const next = { ...prev, [key]: value };
            setCadScript((script) => injectOpenScadParameters(script, next));
            return next;
        });
    }, []);

    const handleMeshClick = useCallback((id: string | null, point: [number, number, number] | null) => {
        if (point && id) {
            setSelection({ id, point });
            setTargetPoint(point);
        } else {
            setSelection(null);
            setTargetPoint(null);
        }
    }, []);

    const handleLoadSession = useCallback((id: string) => {
        if (!id) {
            router.push('/app');
        } else {
            router.push(`/app/${id}`);
        }
    }, [router]);

    const handleLoadHistoryItem = useCallback((code: string, params: any) => {
        setCadScript(code);
        if (params) {
            setParameters(params);
        }
        toast.success('Restored timeline state');
    }, []);

    const handleShare = async () => {
        if (!shareToken) return;
        try {
            const origin = typeof window !== 'undefined' ? window.location.origin : '';
            const shareUrl = `${origin}/app/view/${shareToken}`;
            await navigator.clipboard.writeText(shareUrl);
            toast.success('Link copied to clipboard!');
        } catch (err) {
            toast.error('Failed to copy link');
        }
    };

    const handleFixWithAI = useCallback((warningsList: string[]) => {
        const warningMsg = warningsList.join('\n');
        const fixPrompt = `Please fix the following compiler warnings in my CAD model: \n${warningMsg}`;
        handleGenerate(undefined, fixPrompt);
    }, [cadScript, activeSessionId, selectedModel]);

    return {
        prompt,
        setPrompt,
        messages,
        setMessages,
        selectedModel,
        setSelectedModel,
        selectedFile,
        setSelectedFile,
        uploadedFiles,
        setUploadedFiles,
        cadScript,
        setCadScript,
        parameters,
        setParameters,
        isGenerating,
        shareToken,
        setShareToken,
        targetPoint,
        setTargetPoint,
        selection,
        setSelection,
        isAutoRepairing,
        demoLimitReason,
        setDemoLimitReason,
        handleRepair,
        handleGenerate,
        handleFileChange,
        handleUpdateMessageFile,
        handleParamChange,
        handleMeshClick,
        handleLoadSession,
        handleLoadHistoryItem,
        handleShare,
        handleFixWithAI,
    };
}
