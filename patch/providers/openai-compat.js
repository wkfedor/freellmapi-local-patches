import { BaseProvider } from './base.js';
import { normalizeReasoningFields, normalizeReasoningStreamChunk } from '../lib/reasoning-normalize.js';
/**
 * Generic provider for platforms that use an OpenAI-compatible API.
 * Covers: Groq, Cerebras, SambaNova, NVIDIA NIM, Mistral, OpenRouter,
 * GitHub Models, Fireworks AI.
 */
export class OpenAICompatProvider extends BaseProvider {
    platform;
    name;
    baseUrl;
    extraHeaders;
    validateUrl;
    /** Per-provider HTTP timeout override. Cloud APIs finish in ~15s; locally-hosted
     * inference (llama.cpp / vLLM on CPU) can take 30-120s for long prompts. Default 15000. */
    timeoutMs;
    constructor(opts) {
        super();
        this.platform = opts.platform;
        this.name = opts.name;
        this.baseUrl = opts.baseUrl;
        this.extraHeaders = opts.extraHeaders ?? {};
        this.validateUrl = opts.validateUrl;
        this.timeoutMs = opts.timeoutMs ?? 15000;
        this.keyless = opts.keyless ?? false;
    }
    /** Keyless providers (Kilo's anonymous free tier) must send NO Authorization
     * header — a stored sentinel like `Bearer no-key` could be treated as an
     * invalid key. OpenCode Zen free tier also rejects bogus Bearer tokens. */
    authHeader(apiKey) {
        if (this.keyless || this.platform === 'opencode')
            return {};
        return { 'Authorization': `Bearer ${apiKey}` };
    }
    async chatCompletion(apiKey, messages, modelId, options) {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                ...this.authHeader(apiKey),
                'Content-Type': 'application/json',
                ...this.extraHeaders,
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                temperature: options?.temperature,
                max_tokens: options?.max_tokens,
                top_p: options?.top_p,
                tools: options?.tools,
                tool_choice: options?.tool_choice,
                parallel_tool_calls: options?.parallel_tool_calls,
            }),
        }, this.timeoutMs);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`${this.name} API error ${res.status}: ${err.error?.message ?? res.statusText}`);
        }
        const data = await res.json();
        normalizeChoices(data);
        data._routed_via = { platform: this.platform, model: modelId };
        return data;
    }
    async *streamChatCompletion(apiKey, messages, modelId, options) {
        const res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                ...this.authHeader(apiKey),
                'Content-Type': 'application/json',
                ...this.extraHeaders,
            },
            body: JSON.stringify({
                model: modelId,
                messages,
                temperature: options?.temperature,
                max_tokens: options?.max_tokens,
                top_p: options?.top_p,
                tools: options?.tools,
                tool_choice: options?.tool_choice,
                parallel_tool_calls: options?.parallel_tool_calls,
                stream: true,
            }),
        }, this.timeoutMs);
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`${this.name} API error ${res.status}: ${err.error?.message ?? res.statusText}`);
        }
        const reader = res.body?.getReader();
        if (!reader)
            throw new Error('No response body');
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: '))
                    continue;
                const data = trimmed.slice(6);
                if (data === '[DONE]')
                    return;
                try {
                    yield normalizeReasoningStreamChunk(JSON.parse(data));
                }
                catch {
                    // Skip malformed chunks
                }
            }
        }
    }
    async validateKey(apiKey) {
        // Note: transport errors (DNS / timeout / TLS) propagate to the caller.
        // health.ts catches them and marks status='error' WITHOUT incrementing
        // the consecutive-failure counter — only confirmed 401/403 disables a key.
        const url = this.validateUrl ?? `${this.baseUrl}/models`;
        // 30s (not 10s): some upstreams return a large /v1/models catalog that
        // takes >10s from high-latency regions (e.g. NVIDIA NIM measured ~11.2s
        // from India). A 10s cap aborted those calls and health.ts marked a
        // perfectly good key status='error'. 30s aligns with chatCompletion's
        // own slow-upstream allowance and costs nothing for fast providers.
        const res = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: {
                ...this.authHeader(apiKey),
                ...this.extraHeaders,
            },
        }, 30000);
        return res.status !== 401 && res.status !== 403;
    }
}
/**
 * Some providers (Z.ai glm-4.5-flash, Cloudflare DeepSeek-R1-distill, others)
 * return reasoning models' actual answer in `message.reasoning_content` with
 * `message.content === ""`. Fold reasoning_content into content so OpenAI-
 * compatible clients see a non-empty assistant message.
 *
 * Other providers (Mistral magistral-medium) return `message.content` as an
 * array of text segments instead of a string. Flatten to string.
 */
function normalizeChoices(data) {
    for (const choice of data.choices ?? []) {
        const msg = choice.message;
        // Flatten array content (Mistral magistral) → join text segments.
        if (Array.isArray(msg.content)) {
            msg.content = msg.content
                .map(seg => (typeof seg === 'string' ? seg : (seg.text ?? '')))
                .join('');
        }
        // Fold reasoning into content if content is empty AND there are no
        // tool_calls. With tool_calls present, content=null is the correct OpenAI
        // shape; folding reasoning would confuse clients that branch on content.
        // Field naming varies by provider: Z.ai uses `reasoning_content`, Ollama
        // uses `reasoning`. Prefer `reasoning_content` when both are set.
        normalizeReasoningFields(msg);
    }
}
//# sourceMappingURL=openai-compat.js.map