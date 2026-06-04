import { getDb } from '../db/index.js';
import { sinceSqlForRange, normalizeRange } from './log-range.js';
import { modelCanRoute } from './provider-keys.js';
import {
    migrateRankStateContextColumns,
    ensureModelContextWindows,
    clearContextWindowSkip,
    resolveModelUiStatus,
} from './router-status.js';

const SETTINGS_DEFAULTS = {
    use_custom_routing: '1',
    retry_on_router_error: '1',
    errors_before_demote: '5',
    max_failover_attempts: '20',
    health_check_enabled: '1',
    health_check_interval_minutes: '15',
    health_probe_message: 'hi',
    stats_window: '1h',
    stats_refresh_interval_minutes: '5',
};

let schemaReady = false;
let healthTimer = null;
let statsRefreshTimer = null;
/** model_db_id → marked red until next stats refresh */
const liveErrors = new Set();
let nextStatsRefreshAt = Date.now();

export function ensureCustomRouterSchema() {
    if (schemaReady)
        return;
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS custom_router_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_rank_state (
      model_db_id INTEGER PRIMARY KEY,
      rank_order INTEGER NOT NULL,
      consecutive_errors INTEGER NOT NULL DEFAULT 0,
      total_success INTEGER NOT NULL DEFAULT 0,
      total_errors INTEGER NOT NULL DEFAULT 0,
      is_broken INTEGER NOT NULL DEFAULT 0,
      last_error_at TEXT,
      last_success_at TEXT,
      last_health_check_at TEXT,
      last_health_ok INTEGER,
      FOREIGN KEY (model_db_id) REFERENCES models(id) ON DELETE CASCADE ON UPDATE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_model_rank_order ON model_rank_state(rank_order);
  `);
    db.prepare('DELETE FROM model_rank_state WHERE model_db_id NOT IN (SELECT id FROM models)').run();
    migrateRankStateContextColumns(db);
    ensureModelContextWindows();
    for (const [key, value] of Object.entries(SETTINGS_DEFAULTS)) {
        db.prepare('INSERT OR IGNORE INTO custom_router_settings (key, value) VALUES (?, ?)').run(key, value);
    }
    syncRankStateFromFallback(db);
    schemaReady = true;
}

function syncRankStateFromFallback(db) {
    const rows = db.prepare(`
    SELECT fc.model_db_id, fc.priority
    FROM fallback_config fc
    JOIN models m ON m.id = fc.model_db_id AND m.enabled = 1
    WHERE fc.enabled = 1
    ORDER BY fc.priority ASC
  `).all();
    const insert = db.prepare(`
    INSERT OR IGNORE INTO model_rank_state (model_db_id, rank_order) VALUES (?, ?)
  `);
    for (const r of rows) {
        try {
            insert.run(r.model_db_id, r.priority);
        }
        catch (e) {
            console.warn(`[CustomRouter] skip rank sync for model ${r.model_db_id}:`, e.message);
        }
    }
}

export function getCustomRouterSettings() {
    ensureCustomRouterSchema();
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM custom_router_settings').all();
    const map = { ...SETTINGS_DEFAULTS };
    for (const r of rows)
        map[r.key] = r.value;
    const refreshMin = Math.max(1, Number(map.stats_refresh_interval_minutes) || 5);
    return {
        useCustomRouting: map.use_custom_routing === '1',
        retryOnRouterError: map.retry_on_router_error === '1',
        errorsBeforeDemote: Math.max(1, Number(map.errors_before_demote) || 5),
        maxFailoverAttempts: Math.max(1, Math.min(50, Number(map.max_failover_attempts) || 20)),
        healthCheckEnabled: map.health_check_enabled === '1',
        healthCheckIntervalMinutes: Math.max(1, Number(map.health_check_interval_minutes) || 15),
        healthProbeMessage: map.health_probe_message || 'hi',
        statsWindow: normalizeRange(map.stats_window),
        statsRefreshIntervalMinutes: refreshMin,
    };
}

export function getStatsCycleMeta() {
    const settings = getCustomRouterSettings();
    const now = Date.now();
    const secLeft = Math.max(0, Math.ceil((nextStatsRefreshAt - now) / 1000));
    return {
        statsWindow: settings.statsWindow,
        statsRefreshIntervalMinutes: settings.statsRefreshIntervalMinutes,
        nextStatsRefreshAt: new Date(nextStatsRefreshAt).toISOString(),
        secondsUntilRefresh: secLeft,
        liveErrorCount: liveErrors.size,
    };
}

function scheduleNextStatsRefresh() {
    const settings = getCustomRouterSettings();
    nextStatsRefreshAt = Date.now() + settings.statsRefreshIntervalMinutes * 60 * 1000;
}

export function runStatsRefresh() {
    liveErrors.clear();
    scheduleNextStatsRefresh();
}

function getWindowLogStatsMap() {
    ensureCustomRouterSchema();
    const settings = getCustomRouterSettings();
    const since = sinceSqlForRange(settings.statsWindow);
    const db = getDb();
    const stats = db.prepare(`
    SELECT routed_platform AS platform, routed_model AS model_id,
      SUM(CASE WHEN status = 'success' AND final_success = 1 THEN 1 ELSE 0 END) AS ok,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS err,
      SUM(COALESCE(input_tokens, 0)) AS input_tokens,
      SUM(COALESCE(output_tokens, 0)) AS output_tokens
    FROM request_log_detail
    WHERE created_at >= ${since}
    GROUP BY routed_platform, routed_model
  `).all();
    return new Map(stats.map((s) => [`${s.platform}:${s.model_id}`, s]));
}

/** Порог из «Ошибок подряд → не работает» — и для is_broken, и для пропуска в роутере. */
function errorsThreshold() {
    return getCustomRouterSettings().errorsBeforeDemote;
}

function isModelRed(modelDbId, platform, modelId, windowStat, consecutiveErrors = 0) {
    const n = errorsThreshold();
    if (consecutiveErrors >= n)
        return true;
    return (windowStat?.err ?? 0) >= n;
}

function isModelWarning(consecutiveErrors, windowStat) {
    const n = errorsThreshold();
    if (consecutiveErrors > 0 && consecutiveErrors < n)
        return true;
    const we = windowStat?.err ?? 0;
    return we > 0 && we < n;
}

export function saveCustomRouterSettings(patch) {
    ensureCustomRouterSchema();
    const db = getDb();
    const upd = db.prepare('INSERT INTO custom_router_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    if (patch.useCustomRouting !== undefined)
        upd.run('use_custom_routing', patch.useCustomRouting ? '1' : '0');
    if (patch.retryOnRouterError !== undefined)
        upd.run('retry_on_router_error', patch.retryOnRouterError ? '1' : '0');
    if (patch.errorsBeforeDemote !== undefined)
        upd.run('errors_before_demote', String(patch.errorsBeforeDemote));
    if (patch.maxFailoverAttempts !== undefined)
        upd.run('max_failover_attempts', String(patch.maxFailoverAttempts));
    if (patch.healthCheckEnabled !== undefined)
        upd.run('health_check_enabled', patch.healthCheckEnabled ? '1' : '0');
    if (patch.healthCheckIntervalMinutes !== undefined)
        upd.run('health_check_interval_minutes', String(patch.healthCheckIntervalMinutes));
    if (patch.healthProbeMessage !== undefined)
        upd.run('health_probe_message', String(patch.healthProbeMessage));
    if (patch.statsWindow !== undefined)
        upd.run('stats_window', normalizeRange(patch.statsWindow));
    if (patch.statsRefreshIntervalMinutes !== undefined)
        upd.run('stats_refresh_interval_minutes', String(patch.statsRefreshIntervalMinutes));
    if (patch.statsWindow !== undefined || patch.statsRefreshIntervalMinutes !== undefined)
        runStatsRefresh();
}

export function getModelRankList() {
    ensureCustomRouterSchema();
    const settings = getCustomRouterSettings();
    const statMap = getWindowLogStatsMap();
    const db = getDb();
    const rows = db.prepare(`
    SELECT
      mrs.model_db_id AS modelDbId,
      m.platform,
      m.model_id AS modelId,
      m.display_name AS displayName,
      mrs.rank_order AS rankOrder,
      mrs.consecutive_errors AS consecutiveErrors,
      mrs.total_success AS totalSuccess,
      mrs.total_errors AS totalErrors,
      mrs.is_broken AS isBroken,
      mrs.last_error_at AS lastErrorAt,
      mrs.last_success_at AS lastSuccessAt,
      mrs.last_health_check_at AS lastHealthCheckAt,
      mrs.last_health_ok AS lastHealthOk,
      m.rpm_limit AS rpmLimit,
      m.rpd_limit AS rpdLimit,
      m.monthly_token_budget AS monthlyTokenBudget,
      m.size_label AS sizeLabel,
      m.context_window AS contextWindow,
      mrs.context_skip_active AS contextSkipActive,
      mrs.context_skip_estimated AS contextSkipEstimated,
      mrs.context_skip_window AS contextSkipWindow,
      mrs.context_skip_at AS contextSkipAt
    FROM model_rank_state mrs
    JOIN models m ON m.id = mrs.model_db_id
    WHERE m.enabled = 1
    ORDER BY mrs.rank_order ASC
  `).all();
    return rows.map((r) => {
        const st = statMap.get(`${r.platform}:${r.modelId}`);
        const windowOk = st?.ok ?? 0;
        const windowErr = st?.err ?? 0;
        const windowInputTokens = st?.input_tokens ?? 0;
        const windowOutputTokens = st?.output_tokens ?? 0;
        const consecutiveErrors = r.consecutiveErrors ?? 0;
        const errThreshold = settings.errorsBeforeDemote;
        const contextSkipActive = r.contextSkipActive === 1;
        const isBroken = r.isBroken === 1;
        const isRed = isBroken
            || isModelRed(r.modelDbId, r.platform, r.modelId, st, consecutiveErrors);
        const isWarning = !isRed && isModelWarning(consecutiveErrors, st);
        const route = modelCanRoute(r.platform);
        const isGreen = route.canRoute && !isRed && !contextSkipActive;
        const ui = resolveModelUiStatus({
            platform: r.platform,
            modelId: r.modelId,
            isBroken,
            contextSkipActive,
            contextSkipEstimated: r.contextSkipEstimated,
            contextSkipWindow: r.contextSkipWindow,
            contextWindow: r.contextWindow,
            consecutiveErrors,
            errorsBeforeDemote: errThreshold,
            windowErr,
            statsWindow: settings.statsWindow,
        });
        return {
            ...r,
            isBroken: r.isBroken === 1,
            lastHealthOk: r.lastHealthOk === 1 ? true : r.lastHealthOk === 0 ? false : null,
            contextSkipActive,
            windowOk,
            windowErr,
            windowInputTokens,
            windowOutputTokens,
            isWarning,
            errorsBeforeDemote: errThreshold,
            isRed,
            isGreen,
            canRoute: route.canRoute,
            skipReason: route.skipReason,
            statsWindow: settings.statsWindow,
            statusCode: ui.statusCode,
            statusShort: ui.statusShort,
            statusHint: ui.statusHint,
        };
    });
}

export function reorderModels(orderedModelDbIds) {
    ensureCustomRouterSchema();
    const db = getDb();
    const tx = db.transaction(() => {
        for (let i = 0; i < orderedModelDbIds.length; i++) {
            db.prepare('UPDATE model_rank_state SET rank_order = ? WHERE model_db_id = ?').run(i + 1, orderedModelDbIds[i]);
        }
    });
    tx();
}

export function recordModelOutcome(modelDbId, success) {
    if (!modelDbId)
        return;
    ensureCustomRouterSchema();
    const db = getDb();
    const settings = getCustomRouterSettings();
    if (success) {
        clearContextWindowSkip(modelDbId);
        db.prepare(`
      UPDATE model_rank_state SET
        consecutive_errors = 0,
        total_success = total_success + 1,
        is_broken = 0,
        last_success_at = datetime('now')
      WHERE model_db_id = ?
    `).run(modelDbId);
    }
    else {
        // liveErrors — только для счётчика в statsCycle; пропуск роутера по consecutive_errors >= errorsBeforeDemote
        liveErrors.add(modelDbId);
        db.prepare(`
      UPDATE model_rank_state SET
        consecutive_errors = consecutive_errors + 1,
        total_errors = total_errors + 1,
        last_error_at = datetime('now')
      WHERE model_db_id = ?
    `).run(modelDbId);
        db.prepare(`
      UPDATE model_rank_state SET is_broken = 1
      WHERE model_db_id = ? AND consecutive_errors >= ?
    `).run(modelDbId, settings.errorsBeforeDemote);
    }
}

export function isModelSkippedForRouting(modelDbId, platform, modelId) {
    ensureCustomRouterSchema();
    const n = errorsThreshold();
    const row = getDb().prepare(`
    SELECT is_broken, consecutive_errors FROM model_rank_state WHERE model_db_id = ?
  `).get(modelDbId);
    if (row?.is_broken === 1)
        return true;
    if ((row?.consecutive_errors ?? 0) >= n)
        return true;
    const statMap = getWindowLogStatsMap();
    const st = statMap.get(`${platform}:${modelId}`);
    if ((st?.err ?? 0) >= n)
        return true;
    return false;
}

/** Green (0 errors in window, not live-red) first by rank_order; red/broken last. */
export function orderChainCustom(chain) {
    ensureCustomRouterSchema();
    const statMap = getWindowLogStatsMap();
    const rankRows = getDb().prepare(`
    SELECT model_db_id, rank_order, is_broken, context_skip_active, consecutive_errors
    FROM model_rank_state
  `).all();
    const rankMap = new Map(rankRows.map((r) => [r.model_db_id, r]));

    return [...chain].sort((a, b) => {
        const ra = rankMap.get(a.model_db_id);
        const rb = rankMap.get(b.model_db_id);
        const stA = statMap.get(`${a.platform}:${a.model_id}`);
        const stB = statMap.get(`${b.platform}:${b.model_id}`);
        const redA = (ra?.is_broken === 1
            || isModelRed(a.model_db_id, a.platform, a.model_id, stA, ra?.consecutive_errors ?? 0)) ? 1 : 0;
        const redB = (rb?.is_broken === 1
            || isModelRed(b.model_db_id, b.platform, b.model_id, stB, rb?.consecutive_errors ?? 0)) ? 1 : 0;
        if (redA !== redB)
            return redA - redB;
        const brokenA = ra?.is_broken === 1 ? 1 : 0;
        const brokenB = rb?.is_broken === 1 ? 1 : 0;
        if (brokenA !== brokenB)
            return brokenA - brokenB;
        const ctxA = ra?.context_skip_active === 1 ? 1 : 0;
        const ctxB = rb?.context_skip_active === 1 ? 1 : 0;
        if (ctxA !== ctxB)
            return ctxA - ctxB;
        const routeA = modelCanRoute(a.platform).canRoute ? 0 : 1;
        const routeB = modelCanRoute(b.platform).canRoute ? 0 : 1;
        if (routeA !== routeB)
            return routeA - routeB;
        const rankOrderA = ra?.rank_order ?? a.priority;
        const rankOrderB = rb?.rank_order ?? b.priority;
        return rankOrderA - rankOrderB;
    });
}

export function shouldRetryProviderError(err) {
    const settings = getCustomRouterSettings();
    if (!settings.retryOnRouterError)
        return false;
    const msg = (err?.message ?? '').toLowerCase();
    if (!msg)
        return false;
    if (msg.includes('no available models') || msg.includes('no models available'))
        return false;
    return true;
}

export function getMaxFailoverAttempts() {
    return getCustomRouterSettings().maxFailoverAttempts;
}

export function markHealthResult(modelDbId, ok) {
    ensureCustomRouterSchema();
    const db = getDb();
    if (ok) {
        liveErrors.delete(modelDbId);
        db.prepare(`
      UPDATE model_rank_state SET
        is_broken = 0, consecutive_errors = 0,
        last_health_check_at = datetime('now'), last_health_ok = 1
      WHERE model_db_id = ?
    `).run(modelDbId);
    }
    else {
        db.prepare(`
      UPDATE model_rank_state SET
        last_health_check_at = datetime('now'), last_health_ok = 0
      WHERE model_db_id = ?
    `).run(modelDbId);
    }
}

export function startHealthCheckWorker(routeRequestFn) {
    if (healthTimer)
        return;
    const tick = async () => {
        try {
            const settings = getCustomRouterSettings();
            if (!settings.healthCheckEnabled || !settings.useCustomRouting)
                return;
            const broken = getModelRankList().filter((m) => m.isBroken);
            const probe = settings.healthProbeMessage;
            for (const m of broken.slice(0, 5)) {
                try {
                    const route = routeRequestFn(50, undefined, m.modelDbId, false);
                    const gen = route.provider.streamChatCompletion(route.apiKey, [{ role: 'user', content: probe }], route.modelId, { max_tokens: 8 });
                    let got = '';
                    for await (const chunk of gen) {
                        const t = chunk?.choices?.[0]?.delta?.content ?? '';
                        if (t)
                            got += t;
                    }
                    markHealthResult(m.modelDbId, got.length > 0);
                }
                catch {
                    markHealthResult(m.modelDbId, false);
                }
            }
        }
        catch (e) {
            console.error('[HealthCheck]', e.message);
        }
    };
    const settings = getCustomRouterSettings();
    const ms = settings.healthCheckIntervalMinutes * 60 * 1000;
    healthTimer = setInterval(tick, ms);
    setTimeout(tick, 15000);
}

export function startStatsRefreshWorker() {
    if (statsRefreshTimer)
        return;
    try {
        scheduleNextStatsRefresh();
    }
    catch (e) {
        console.error('[CustomRouter] stats refresh init:', e.message);
        nextStatsRefreshAt = Date.now() + 60000;
    }
    const tick = () => {
        if (Date.now() >= nextStatsRefreshAt)
            runStatsRefresh();
    };
    statsRefreshTimer = setInterval(tick, 1000);
}
