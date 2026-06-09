import crypto from 'crypto';
import { getDb } from '../db/index.js';

const PREVIEW_MAX = Number(process.env.REQUEST_LOG_PREVIEW_MAX) || 120000;
/** Max chars returned to /analytics/log feed (full text stays in DB until end of day). */
export const FEED_PREVIEW_MAX = Number(process.env.REQUEST_LOG_FEED_PREVIEW_MAX) || 4000;
/** Hard cap on traces shown in /analytics/log — never exceed (UI perf). */
export const MAX_LOG_FEED_TRACES = 500;

let schemaReady = false;

export function truncateText(text, max = PREVIEW_MAX) {
    if (text == null)
        return null;
    const s = String(text);
    if (s.length <= max)
        return s;
    return `${s.slice(0, max)}… [truncated ${s.length - max} chars]`;
}

export function buildPromptPreview(messages) {
    if (!Array.isArray(messages) || messages.length === 0)
        return '';
    const parts = [];
    for (const m of messages) {
        const role = m.role ?? '?';
        let body = '';
        if (typeof m.content === 'string')
            body = m.content;
        else if (Array.isArray(m.content)) {
            body = m.content.map((b) => {
                if (b?.type === 'text')
                    return b.text ?? '';
                if (b?.type === 'image_url' || b?.type === 'image')
                    return '[image]';
                return `[${b?.type ?? 'block'}]`;
            }).join(' ');
        }
        else if (m.content != null)
            body = JSON.stringify(m.content);
        if (m.tool_calls?.length) {
            const names = m.tool_calls.map((t) => t.function?.name ?? '?').join(', ');
            body += (body ? ' ' : '') + `[tool_calls: ${names}]`;
        }
        if (m.tool_call_id)
            body = `[tool result id=${m.tool_call_id}] ${body}`;
        parts.push(`${role}: ${body}`);
    }
    return truncateText(parts.join('\n---\n'));
}

export function buildResponsePreview(result) {
    if (!result)
        return null;
    const msg = result.choices?.[0]?.message;
    if (!msg)
        return truncateText(JSON.stringify(result).slice(0, PREVIEW_MAX));
    const chunks = [];
    if (msg.content != null && msg.content !== '')
        chunks.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
    if (msg.tool_calls?.length) {
        chunks.push(`[tool_calls: ${msg.tool_calls.map((t) => `${t.function?.name ?? '?'}(${truncateText(t.function?.arguments ?? '', 500)})`).join('; ')}]`);
    }
    const finish = result.choices?.[0]?.finish_reason;
    if (finish)
        chunks.push(`[finish_reason: ${finish}]`);
    return truncateText(chunks.join('\n'));
}

export function ensureRequestDetailSchema() {
    if (schemaReady)
        return;
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS request_log_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      client_model TEXT,
      routed_platform TEXT,
      routed_model TEXT,
      display_name TEXT,
      key_id INTEGER,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      ttfb_ms INTEGER,
      error TEXT,
      stream INTEGER NOT NULL DEFAULT 0,
      has_tools INTEGER NOT NULL DEFAULT 0,
      message_count INTEGER NOT NULL DEFAULT 0,
      prompt_preview TEXT,
      response_preview TEXT,
      client_ip TEXT,
      user_agent TEXT,
      final_success INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rld_trace ON request_log_detail(trace_id);
    CREATE INDEX IF NOT EXISTS idx_rld_created ON request_log_detail(created_at);
    CREATE INDEX IF NOT EXISTS idx_rld_status ON request_log_detail(status);
    CREATE INDEX IF NOT EXISTS idx_rld_platform ON request_log_detail(routed_platform);
  `);
    const deleted = pruneRequestDetailLog();
    if (deleted > 0)
        console.log(`[RequestLog] purged ${deleted} rows older than today`);
    schemaReady = true;
}

/** Keep only today's rows (local TZ of container). Runs on every insert and at startup. */
export function pruneRequestDetailLog() {
    const db = getDb();
    if (!schemaReady) {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='request_log_detail'").get();
        if (!table)
            return 0;
    }
    return db.prepare(`
    DELETE FROM request_log_detail
    WHERE created_at < datetime('now', 'start of day', 'localtime')
  `).run().changes;
}

export function truncateForFeed(text, max = FEED_PREVIEW_MAX) {
    if (text == null)
        return text;
    const s = String(text);
    if (s.length <= max)
        return s;
    return `${s.slice(0, max)}… [ещё ${s.length - max} симв.]`;
}

export function logRequestDetail(entry) {
    try {
        ensureRequestDetailSchema();
        const db = getDb();
        db.prepare(`
      INSERT INTO request_log_detail (
        trace_id, attempt, client_model, routed_platform, routed_model, display_name,
        key_id, status, input_tokens, output_tokens, latency_ms, ttfb_ms, error,
        stream, has_tools, message_count, prompt_preview, response_preview,
        client_ip, user_agent, final_success
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            entry.traceId,
            entry.attempt ?? 0,
            entry.clientModel ?? null,
            entry.routedPlatform ?? null,
            entry.routedModel ?? null,
            entry.displayName ?? null,
            entry.keyId ?? null,
            entry.status,
            entry.inputTokens ?? 0,
            entry.outputTokens ?? 0,
            entry.latencyMs ?? 0,
            entry.ttfbMs ?? null,
            entry.error ?? null,
            entry.stream ? 1 : 0,
            entry.hasTools ? 1 : 0,
            entry.messageCount ?? 0,
            entry.promptPreview ?? null,
            entry.responsePreview ?? null,
            entry.clientIp ?? null,
            entry.userAgent ?? null,
            entry.finalSuccess ? 1 : 0,
        );
        pruneRequestDetailLog();
    }
    catch (e) {
        console.error('[RequestLog] Failed to write detail log:', e);
    }
}

export function newTraceId() {
    return crypto.randomUUID();
}
