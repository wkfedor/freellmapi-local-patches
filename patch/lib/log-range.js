/** Whitelisted time ranges for request log and router stats. */
export const LOG_RANGES = ['today', '1h', '3h', '6h', '12h', '24h'];

const RANGE_MS = {
    today: 24 * 3600000,
    '1h': 3600000,
    '3h': 3 * 3600000,
    '6h': 6 * 3600000,
    '12h': 12 * 3600000,
    '24h': 86400000,
};

export function normalizeRange(range) {
    const r = String(range ?? 'today');
    return LOG_RANGES.includes(r) ? r : 'today';
}

export function rangeToMs(range) {
    return RANGE_MS[normalizeRange(range)] ?? RANGE_MS.today;
}

export function toSinceIso(range) {
    if (normalizeRange(range) === 'today') {
        // Approximate; SQL path uses sinceSqlForRange for accuracy.
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d.toISOString().slice(0, 19).replace('T', ' ');
    }
    const since = new Date(Date.now() - rangeToMs(range));
    return since.toISOString().slice(0, 19).replace('T', ' ');
}

/** SQLite expression for WHERE created_at >= … (localtime for today). */
export function sinceSqlForRange(range) {
    switch (normalizeRange(range)) {
        case 'today': return "datetime('now', 'start of day', 'localtime')";
        case '1h': return "datetime('now', '-1 hours')";
        case '3h': return "datetime('now', '-3 hours')";
        case '6h': return "datetime('now', '-6 hours')";
        case '12h': return "datetime('now', '-12 hours')";
        case '24h': return "datetime('now', '-1 day')";
        default: return "datetime('now', 'start of day', 'localtime')";
    }
}
