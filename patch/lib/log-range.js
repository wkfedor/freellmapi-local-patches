/** Whitelisted time ranges for request log and router stats. */
export const LOG_RANGES = ['1h', '3h', '6h', '12h', '24h', '7d', '30d'];

const RANGE_MS = {
    '1h': 3600000,
    '3h': 3 * 3600000,
    '6h': 6 * 3600000,
    '12h': 12 * 3600000,
    '24h': 86400000,
    '7d': 7 * 86400000,
    '30d': 30 * 86400000,
};

export function normalizeRange(range) {
    const r = String(range ?? '7d');
    return LOG_RANGES.includes(r) ? r : '7d';
}

export function rangeToMs(range) {
    return RANGE_MS[normalizeRange(range)] ?? RANGE_MS['7d'];
}

export function toSinceIso(range) {
    const since = new Date(Date.now() - rangeToMs(range));
    return since.toISOString().slice(0, 19).replace('T', ' ');
}

/** SQLite expression for WHERE created_at >= … */
export function sinceSqlForRange(range) {
    switch (normalizeRange(range)) {
        case '1h': return "datetime('now', '-1 hours')";
        case '3h': return "datetime('now', '-3 hours')";
        case '6h': return "datetime('now', '-6 hours')";
        case '12h': return "datetime('now', '-12 hours')";
        case '24h': return "datetime('now', '-1 day')";
        case '30d': return "datetime('now', '-30 days')";
        default: return "datetime('now', '-7 days')";
    }
}
