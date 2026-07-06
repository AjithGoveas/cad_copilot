export interface ModelMetadata {
    id: string;
    name: string;
    vendor: 'google' | 'deepseek' | 'anthropic' | 'openai' | 'ollama' | 'openrouter';
    tier: 'flash' | 'pro' | 'ultra';
    maxTokens: number;
    supportsThinking: boolean;
    fallbackModelId?: string; // Designated fallback model when this model experiences errors
    description: string;
    badge: string; // Sidebar UI badge (e.g. 'thinking', 'fast')
}

export const MODEL_REGISTRY: ModelMetadata[] = [
    {
        id: 'gemini-3.5-flash',
        name: 'Gemini 3.5 Flash',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 1000000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'Google next-gen reasoning model optimized for code and speed.',
        badge: 'thinking',
    },
    {
        id: 'gemini-3.1-flash-lite',
        name: 'Gemini 3.1 Flash Lite',
        vendor: 'google',
        tier: 'flash',
        maxTokens: 256000,
        supportsThinking: false,
        description: 'Ultra-fast, lightweight fallback model for quick edits.',
        badge: 'fast',
    },
    {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        vendor: 'deepseek',
        tier: 'pro',
        maxTokens: 64000,
        supportsThinking: true,
        fallbackModelId: 'deepseek-v4-flash',
        description: 'Advanced reasoning model for complex geometric calculations.',
        badge: 'thinking',
    },
    {
        id: 'deepseek-v4-flash',
        name: 'DeepSeek V4 Flash',
        vendor: 'deepseek',
        tier: 'flash',
        maxTokens: 64000,
        supportsThinking: false,
        description: 'Low-latency DeepSeek model optimized for direct edits.',
        badge: 'fast',
    },
    {
        id: 'claude-opus-4.6',
        name: 'Claude Opus 4.6',
        vendor: 'anthropic',
        tier: 'ultra',
        maxTokens: 200000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'Anthropic flagship model for unmatched creative spatial engineering.',
        badge: 'thinking',
    },
    {
        id: 'gpt-5.4',
        name: 'GPT 5.4',
        vendor: 'openai',
        tier: 'ultra',
        maxTokens: 128000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'OpenAI premier engine for high-fidelity code synthesis.',
        badge: 'thinking',
    },
    {
        id: 'gemma4:31b-cloud',
        name: 'Gemma 4 31B',
        vendor: 'ollama',
        tier: 'pro',
        maxTokens: 32000,
        supportsThinking: false,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'Gemma 4 31B model running locally/cloud via Ollama endpoints.',
        badge: 'local',
    },
    {
        id: "google/gemini-3.5-flash",
        name: 'Gemini 3.5 Flash (OpenRouter)',
        vendor: 'openrouter',
        tier: 'flash',
        maxTokens: 32000,
        supportsThinking: true,
        fallbackModelId: 'gemini-3.1-flash-lite',
        description: 'Google next-gen reasoning model optimized for code and speed.',
        badge: 'thinking',
    },
];

export function getModelById(id: string): ModelMetadata | undefined {
    return MODEL_REGISTRY.find(m => m.id === id);
}

export function getFallbackModelId(id: string): string {
    const model = getModelById(id);
    return model?.fallbackModelId || 'gemini-3.1-flash-lite';
}
