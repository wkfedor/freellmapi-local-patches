/**
 * Providers (e.g. OpenCode DeepSeek) may return both `content` and
 * `reasoning_content`. LiteLLM maps reasoning to Anthropic `thinking_*` SSE;
 * Claude Code then shows an empty reply while FreeLLMAPI logs still have text
 * in `content`. Fold empty content from reasoning; strip reasoning when content
 * is already present (unless tool_calls need the OpenAI tool shape).
 */
function pickReasoning(msg) {
    if (typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0)
        return msg.reasoning_content;
    if (typeof msg.reasoning === 'string' && msg.reasoning.length > 0)
        return msg.reasoning;
    return null;
}

export function normalizeReasoningFields(msg) {
    if (!msg || typeof msg !== 'object')
        return msg;
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls)
        return msg;
    const content = msg.content;
    const hasContent = typeof content === 'string'
        ? content.length > 0
        : content != null && content !== '';
    if (!hasContent) {
        const fold = pickReasoning(msg);
        if (fold !== null)
            msg.content = fold;
    }
    else {
        delete msg.reasoning_content;
        delete msg.reasoning;
    }
    return msg;
}

export function normalizeReasoningResponse(data) {
    for (const choice of data?.choices ?? []) {
        if (choice?.message)
            normalizeReasoningFields(choice.message);
        if (choice?.delta)
            normalizeReasoningFields(choice.delta);
    }
    return data;
}

export function normalizeReasoningStreamChunk(chunk) {
    return normalizeReasoningResponse(chunk);
}
