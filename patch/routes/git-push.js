import { Router } from 'express';
import { GitPusherError, runGitPush } from '../lib/git-pusher.js';

export const gitPushRouter = Router();

function isLocalRequest(req) {
    const ip = req.ip || req.socket?.remoteAddress || '';
    return ip === '127.0.0.1'
        || ip === '::1'
        || ip === '::ffff:127.0.0.1'
        || ip.endsWith('127.0.0.1');
}

function authorized(req) {
    const secret = process.env.FREELLMAPI_GIT_PUSH_SECRET?.trim();
    if (!secret)
        return isLocalRequest(req);
    const key = req.get('X-Freellmapi-Git-Push-Key')?.trim();
    return key === secret;
}

gitPushRouter.post('/', async (req, res) => {
    if (!authorized(req)) {
        res.status(403).json({
            ok: false,
            error: 'Нет прав на git push. Запрос только с localhost или с заголовком X-Freellmapi-Git-Push-Key.',
            log: 'forbidden',
        });
        return;
    }
    try {
        const message = typeof req.body?.message === 'string' ? req.body.message : undefined;
        const result = await runGitPush({ message });
        res.json(result);
    }
    catch (err) {
        if (err instanceof GitPusherError) {
            res.status(422).json({
                ok: false,
                error: err.message,
                log: err.log,
            });
            return;
        }
        console.error('[freellmapi-git]', err);
        res.status(500).json({
            ok: false,
            error: err?.message || String(err),
            log: err?.message || String(err),
        });
    }
});
