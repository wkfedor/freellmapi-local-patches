import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/index.js';
import { ensureRequestDetailSchema } from '../lib/request-detail-log.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ANALYTICS_PAGE = path.resolve(__dirname, '../public/analytics.html');

export const requestDetailLogRouter = Router();

function toSince(range) {
    const now = Date.now();
    const ms = range === '12h' ? 12 * 3600000
        : range === '24h' ? 86400000
            : range === '30d' ? 30 * 86400000
                : 7 * 86400000;
    return new Date(now - ms).toISOString().slice(0, 19).replace('T', ' ');
}

requestDetailLogRouter.get('/summary', (req, res) => {
    ensureRequestDetailSchema();
    const range = String(req.query.range ?? '7d');
    const since = toSince(range);
    const db = getDb();
    const stats = db.prepare(`
    SELECT
      COUNT(*) AS total_attempts,
      COUNT(DISTINCT trace_id) AS total_traces,
      SUM(CASE WHEN status = 'success' AND final_success = 1 THEN 1 ELSE 0 END) AS success_traces,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens,
      AVG(latency_ms) AS avg_latency_ms
    FROM request_log_detail
    WHERE created_at >= ?
  `).get(since);
    const byPlatform = db.prepare(`
    SELECT routed_platform AS platform, COUNT(*) AS attempts,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
    FROM request_log_detail WHERE created_at >= ?
    GROUP BY routed_platform ORDER BY attempts DESC
  `).all(since);
    res.json({ range, since, stats, byPlatform });
});

requestDetailLogRouter.get('/by-model', (req, res) => {
    ensureRequestDetailSchema();
    const since = toSince(String(req.query.range ?? '7d'));
    const db = getDb();
    const rows = db.prepare(`
    SELECT
      routed_platform AS platform,
      routed_model AS model_id,
      COALESCE(display_name, routed_model) AS display_name,
      COUNT(*) AS attempts,
      COUNT(DISTINCT trace_id) AS traces,
      SUM(CASE WHEN status = 'success' AND final_success = 1 THEN 1 ELSE 0 END) AS final_successes,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
      AVG(latency_ms) AS avg_latency_ms,
      SUM(input_tokens) AS input_tokens,
      SUM(output_tokens) AS output_tokens
    FROM request_log_detail
    WHERE created_at >= ?
    GROUP BY routed_platform, routed_model, display_name
    ORDER BY attempts DESC
  `).all(since);
    res.json(rows);
});

requestDetailLogRouter.get('/traces', (req, res) => {
    ensureRequestDetailSchema();
    const since = toSince(String(req.query.range ?? '7d'));
    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const status = req.query.status ? String(req.query.status) : null;
    const platform = req.query.platform ? String(req.query.platform) : null;
    const q = req.query.q ? String(req.query.q).trim() : '';

    const db = getDb();
    const clauses = ['created_at >= ?'];
    const params = [since];
    if (status === 'success' || status === 'error') {
        clauses.push('status = ?');
        params.push(status);
    }
    if (platform) {
        clauses.push('routed_platform = ?');
        params.push(platform);
    }
    if (q) {
        clauses.push(`(
      trace_id LIKE ? OR client_model LIKE ? OR routed_model LIKE ? OR display_name LIKE ?
      OR prompt_preview LIKE ? OR response_preview LIKE ? OR error LIKE ?
    )`);
        const like = `%${q}%`;
        params.push(like, like, like, like, like, like, like);
    }
    const where = clauses.join(' AND ');

    const traces = db.prepare(`
    SELECT
      trace_id,
      MIN(created_at) AS started_at,
      MAX(created_at) AS ended_at,
      MAX(client_model) AS client_model,
      MAX(message_count) AS message_count,
      MAX(has_tools) AS has_tools,
      MAX(stream) AS stream,
      COUNT(*) AS attempt_count,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_attempts,
      MAX(CASE WHEN final_success = 1 THEN display_name END) AS final_display_name,
      MAX(CASE WHEN final_success = 1 THEN routed_platform END) AS final_platform,
      MAX(CASE WHEN final_success = 1 THEN routed_model END) AS final_model,
      MAX(CASE WHEN final_success = 1 THEN response_preview END) AS final_response_preview,
      MAX(CASE WHEN final_success = 1 THEN latency_ms END) AS final_latency_ms,
      GROUP_CONCAT(DISTINCT routed_platform || '/' || routed_model) AS models_tried
    FROM request_log_detail
    WHERE ${where}
    GROUP BY trace_id
    ORDER BY started_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

    const total = db.prepare(`
    SELECT COUNT(DISTINCT trace_id) AS c FROM request_log_detail WHERE ${where}
  `).get(...params).c;

    res.json({ total, limit, offset, traces });
});

function mapAttemptRow(r) {
    return {
        id: r.id,
        attempt: r.attempt,
        clientModel: r.client_model,
        platform: r.routed_platform,
        modelId: r.routed_model,
        displayName: r.display_name,
        keyId: r.key_id,
        status: r.status,
        inputTokens: r.input_tokens,
        outputTokens: r.output_tokens,
        latencyMs: r.latency_ms,
        ttfbMs: r.ttfb_ms,
        error: r.error,
        stream: r.stream === 1,
        hasTools: r.has_tools === 1,
        messageCount: r.message_count,
        promptPreview: r.prompt_preview,
        responsePreview: r.response_preview,
        clientIp: r.client_ip,
        userAgent: r.user_agent,
        finalSuccess: r.final_success === 1,
        createdAt: r.created_at,
    };
}

// Full text feed for the log page (all attempts grouped by trace, newest first).
requestDetailLogRouter.get('/feed', (req, res) => {
    ensureRequestDetailSchema();
    const since = toSince(String(req.query.range ?? '7d'));
    const limit = Math.min(Math.max(Number(req.query.limit) || 40, 1), 150);
    const status = req.query.status ? String(req.query.status) : null;
    const q = req.query.q ? String(req.query.q).trim() : '';
    const db = getDb();

    const traceClauses = ['created_at >= ?'];
    const traceParams = [since];
    if (status === 'success' || status === 'error') {
        traceClauses.push('status = ?');
        traceParams.push(status);
    }
    if (q) {
        traceClauses.push(`(
      trace_id LIKE ? OR client_model LIKE ? OR routed_model LIKE ? OR display_name LIKE ?
      OR prompt_preview LIKE ? OR response_preview LIKE ? OR error LIKE ?
    )`);
        const like = `%${q}%`;
        traceParams.push(like, like, like, like, like, like, like);
    }
    const traceWhere = traceClauses.join(' AND ');

    const traceIds = db.prepare(`
    SELECT trace_id
    FROM request_log_detail
    WHERE ${traceWhere}
    GROUP BY trace_id
    ORDER BY MAX(id) DESC
    LIMIT ?
  `).all(...traceParams, limit).map((r) => r.trace_id);

    if (!traceIds.length) {
        res.json({ entries: [], total: 0 });
        return;
    }

    const placeholders = traceIds.map(() => '?').join(',');
    const rows = db.prepare(`
    SELECT * FROM request_log_detail
    WHERE trace_id IN (${placeholders})
    ORDER BY trace_id DESC, attempt ASC, id ASC
  `).all(...traceIds);

    const byTrace = new Map();
    for (const row of rows) {
        if (!byTrace.has(row.trace_id)) {
            byTrace.set(row.trace_id, {
                traceId: row.trace_id,
                startedAt: row.created_at,
                clientModel: row.client_model || 'auto',
                messageCount: row.message_count,
                hasTools: row.has_tools === 1,
                stream: row.stream === 1,
                userAgent: row.user_agent,
                attempts: [],
            });
        }
        const entry = byTrace.get(row.trace_id);
        entry.attempts.push(mapAttemptRow(row));
        if (row.created_at < entry.startedAt)
            entry.startedAt = row.created_at;
    }

    const entries = traceIds.map((id) => byTrace.get(id)).filter(Boolean);
    res.json({ entries, total: entries.length });
});

requestDetailLogRouter.get('/traces/:traceId', (req, res) => {
    ensureRequestDetailSchema();
    const db = getDb();
    const rows = db.prepare(`
    SELECT *
    FROM request_log_detail
    WHERE trace_id = ?
    ORDER BY attempt ASC, id ASC
  `).all(req.params.traceId);
    if (!rows.length) {
        res.status(404).json({ error: { message: 'Trace not found' } });
        return;
    }
    res.json({
        traceId: req.params.traceId,
        attempts: rows.map(mapAttemptRow),
    });
});
