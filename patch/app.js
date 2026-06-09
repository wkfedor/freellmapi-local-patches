import express from 'express';
import cors from 'cors';
import fs from 'fs';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { keysRouter } from './routes/keys.js';
import { modelsRouter } from './routes/models.js';
import { proxyRouter } from './routes/proxy.js';
import { responsesRouter } from './routes/responses.js';
import { fallbackRouter } from './routes/fallback.js';
import { analyticsRouter } from './routes/analytics.js';
import { healthRouter } from './routes/health.js';
import { settingsRouter } from './routes/settings.js';
import { authRouter } from './routes/auth.js';
import { requestDetailLogRouter, ANALYTICS_PAGE, } from './routes/request-detail-log.js';
import { routerSettingsRouter, SETTINGS_PAGE, } from './routes/router-settings.js';
import { routeRequest } from './services/router.js';
import { startHealthCheckWorker, startStatsRefreshWorker, ensureCustomRouterSchema } from './lib/custom-router.js';
import { requireAuth } from './middleware/requireAuth.js';
import { createProxyRateLimiter } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NAV_SCRIPT = '<script src="/freellmapi-nav.js" defer></script>';
let spaIndexCache = null;
let spaIndexMtimeMs = 0;
function getSpaIndexHtml(clientDist) {
    const indexPath = path.join(clientDist, 'index.html');
    const { mtimeMs } = fs.statSync(indexPath);
    if (!spaIndexCache || mtimeMs !== spaIndexMtimeMs) {
        let html = fs.readFileSync(indexPath, 'utf8');
        if (!html.includes('freellmapi-nav.js')) {
            html = html.replace('</body>', `    ${NAV_SCRIPT}\n  </body>`);
        }
        spaIndexCache = html;
        spaIndexMtimeMs = mtimeMs;
    }
    return spaIndexCache;
}
const DEFAULT_DASHBOARD_ORIGINS = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://[::1]:5173',
];
function getAllowedCorsOrigins() {
    const configuredOrigins = (process.env.DASHBOARD_ORIGINS ?? '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
    return new Set([...DEFAULT_DASHBOARD_ORIGINS, ...configuredOrigins]);
}
export function createApp() {
    const app = express();
    const allowedCorsOrigins = getAllowedCorsOrigins();
    // CSP intentionally disabled — the SPA bundles inline styles and the OG
    // image is loaded from the same origin; enabling helmet's default CSP
    // breaks the React build's hashed-asset loader. HSTS off because this is
    // a single-user local proxy, served over HTTP on localhost. Both should
    // stay disabled unless someone serves the proxy over HTTPS publicly
    // (which is also not a supported deployment — see README).
    app.use(helmet({ contentSecurityPolicy: false, hsts: false }));
    app.use(cors({
        origin(origin, callback) {
            callback(null, !origin || allowedCorsOrigins.has(origin));
        },
    }));
    app.use(express.json({ limit: '1mb' }));
    // Dashboard auth (#35): /api/auth/{status,setup,login} bootstrap without a
    // session; everything else under /api/* requires a logged-in dashboard user.
    // The /v1 proxy keeps its own unified-API-key auth and is NOT gated here.
    app.use('/api/auth', authRouter);
    // API routes — all admin endpoints sit behind requireAuth.
    app.use('/api/keys', requireAuth, keysRouter);
    app.use('/api/models', requireAuth, modelsRouter);
    app.use('/api/fallback', requireAuth, fallbackRouter);
    app.use('/api/analytics', requireAuth, analyticsRouter);
    app.use('/api/health', requireAuth, healthRouter);
    app.use('/api/settings', requireAuth, settingsRouter);
    // OpenAI-compatible proxy. Per-IP rate limiting (#35 item #6) runs first so
    // it throttles unauthenticated brute-force / flood attempts before any
    // routing work. Tune via PROXY_RATE_LIMIT_RPM; 0 disables it.
    app.use('/v1', createProxyRateLimiter());
    app.use('/v1', proxyRouter);
    // OpenAI Responses API shim (Codex CLI requires wire_api="responses"; see #96)
    app.use('/v1', responsesRouter);
    // Health check
    app.get('/api/ping', (_req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    // Detailed request log — read-only, no API key (localhost-only via docker port bind).
    app.use('/api/request-log', requestDetailLogRouter);
    app.use('/api/router-settings', routerSettingsRouter);
    app.get('/analytics/log', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(ANALYTICS_PAGE);
    });
    app.get('/settings', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(SETTINGS_PAGE);
    });
    app.get('/local-nav.js', (_req, res) => {
        res.type('application/javascript');
        res.sendFile(path.join(__dirname, 'public/local-nav.js'));
    });
    // Error handler (for API routes)
    app.use(errorHandler);
    // Serve client static files (after API error handler)
    const clientDist = path.resolve(__dirname, '../../client/dist');
    app.use(express.static(clientDist));
    // SPA fallback — serve index.html for non-API routes
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/') || req.path.startsWith('/v1/')) {
            next();
            return;
        }
        res.type('html').send(getSpaIndexHtml(clientDist));
    });
    ensureCustomRouterSchema();
    startHealthCheckWorker(routeRequest);
    startStatsRefreshWorker();
    return app;
}
//# sourceMappingURL=app.js.map