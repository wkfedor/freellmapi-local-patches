import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../data/freeapi.db');

/**
 * Custom router table `model_rank_state` is not part of upstream migrations.
 * When the image updates models (DELETE/replace rows), FK from rank_state → models
 * makes initDb() fail with "FOREIGN KEY constraint failed". Rank order is rebuilt
 * from fallback_config on boot — safe to clear before migrations.
 */
export function preInitDbCleanup() {
    if (!fs.existsSync(DB_PATH))
        return;
    const db = new Database(DB_PATH);
    try {
        db.pragma('journal_mode = WAL');
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_rank_state'").get();
        if (!table)
            return;
        const removed = db.prepare('DELETE FROM model_rank_state').run().changes;
        if (removed > 0)
            console.log(`[preInit] cleared model_rank_state (${removed} rows) before DB migrations`);
    }
    finally {
        db.close();
    }
}
