import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';

/** Routing gate: platform must exist and have an enabled key in Keys UI / api_keys. */
export function hasEnabledApiKey(platform) {
    const db = getDb();
    const row = db.prepare(`
    SELECT COUNT(*) AS c FROM api_keys
    WHERE platform = ? AND enabled = 1 AND status IN ('healthy', 'unknown')
  `).get(platform);
    return (row?.c ?? 0) > 0;
}

export function modelCanRoute(platform) {
    if (!getProvider(platform))
        return { canRoute: false, skipReason: 'no_provider' };
    if (!hasEnabledApiKey(platform))
        return { canRoute: false, skipReason: 'no_api_key' };
    return { canRoute: true, skipReason: null };
}
