export type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    attachment?: { 
        name: string;
        file?: File;
    };
};

export type Selection = {
    id: string;
    point: [number, number, number];
};

export type EngineErrorType = 'OutOfBounds' | 'CompileFailure' | 'Timeout' | 'Unknown' | 'Not3D';

export type EngineError = {
    errorType: EngineErrorType;
    message:   string;
    details:   string;
};

export type EngineStatus =
    | 'idle'
    | 'compiling'
    | 'ready'
    | 'error';

export interface HistoryItem {
    id: string;
    sessionId: string;
    actionType: 'GENERATE' | 'EDIT' | 'REPAIR';
    prompt: string | null;
    openscadCode: string;
    patchDelta: string | null;
    isFullSnapshot: boolean;
    parametersJson: Record<string, any> | null;
    targetPoint: number[];
    metaData: any;
    createdAt: string;
}

export interface Session {
    id: string;
    shareToken: string | null;
    title: string;
    userId: string;
    createdAt: string;
    updatedAt: string;
    historyItems: HistoryItem[];
}
