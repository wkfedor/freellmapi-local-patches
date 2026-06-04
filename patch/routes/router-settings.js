import { Router } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    ensureCustomRouterSchema,
    getCustomRouterSettings,
    saveCustomRouterSettings,
    getModelRankList,
    reorderModels,
    getStatsCycleMeta,
} from '../lib/custom-router.js';
import { routeRequest } from '../services/router.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SETTINGS_PAGE = path.resolve(__dirname, '../public/settings.html');

export const routerSettingsRouter = Router();

routerSettingsRouter.get('/', (_req, res) => {
    ensureCustomRouterSchema();
    res.json({
        settings: getCustomRouterSettings(),
        models: getModelRankList(),
        statsCycle: getStatsCycleMeta(),
    });
});

routerSettingsRouter.put('/', (req, res) => {
    ensureCustomRouterSchema();
    const body = req.body ?? {};
    saveCustomRouterSettings(body.settings ?? body);
    if (Array.isArray(body.modelOrder))
        reorderModels(body.modelOrder);
    res.json({
        settings: getCustomRouterSettings(),
        models: getModelRankList(),
        statsCycle: getStatsCycleMeta(),
    });
});

routerSettingsRouter.post('/test-route', (_req, res) => {
    ensureCustomRouterSchema();
    try {
        const route = routeRequest(200);
        res.json({
            ok: true,
            platform: route.platform,
            modelId: route.modelId,
            displayName: route.displayName,
            modelDbId: route.modelDbId,
        });
    }
    catch (e) {
        res.status(503).json({ ok: false, error: e.message });
    }
});

routerSettingsRouter.post('/reorder', (req, res) => {
    ensureCustomRouterSchema();
    const order = req.body?.modelOrder;
    if (!Array.isArray(order))
        return res.status(400).json({ error: { message: 'modelOrder array required' } });
    reorderModels(order);
    res.json({ models: getModelRankList() });
});
