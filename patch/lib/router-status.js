import { getDb } from '../db/index.js';
import { modelCanRoute } from './provider-keys.js';

/** Коды пропуска / статуса (для лога и API). */
export const SkipReason = {
    NO_PROVIDER: 'no_provider',
    NO_API_KEY: 'no_api_key',
    CUSTOM_ROUTER: 'custom_router',
    BROKEN: 'broken',
    VISION: 'vision',
    CONTEXT_WINDOW: 'context_window',
};

const HINTS = {
    [SkipReason.NO_PROVIDER]: {
        short: 'нет провайдера',
        hint: 'Платформа не зарегистрирована в FreeLLMAPI (нет адаптера в providers). Роутер не может отправить запрос на этот backend. Проверьте, что модель включена в Fallback и что образ содержит провайдер для этой платформы.',
    },
    [SkipReason.NO_API_KEY]: {
        short: 'нет ключа',
        hint: 'В разделе Keys нет включённого API-ключа для этой платформы (enabled=1, status healthy/unknown). Без ключа роутер не вызывает провайдер. Добавьте ключ: Keys → платформа → вставьте токен с сайта провайдера.',
    },
    [SkipReason.CUSTOM_ROUTER]: {
        short: 'красная в роутере',
        hint: 'Своя логика: модель пропускается, если подряд ошибок ≥ порога из настроек («Ошибок подряд») или ERR в окне лога ≥ того же порога, либо is_broken. Одна ошибка не отключает модель.',
    },
    [SkipReason.BROKEN]: {
        short: 'не работает',
        hint: 'Модель в состоянии is_broken: слишком много ошибок подряд (см. «Ошибок подряд → не работает»). Не участвует в очереди, пока health-check или успешный запрос не восстановит статус.',
    },
    [SkipReason.VISION]: {
        short: 'без vision',
        hint: 'В запросе есть изображение, а у модели supports_vision=0. Роутер пропускает её, чтобы не отправить картинку в текст-only модель.',
    },
    [SkipReason.CONTEXT_WINDOW]: {
        short: 'не влезает в окно',
        hint: 'Оценка размера запроса (вход + резерв под max_tokens) больше context_window модели. Роутер не вызывает провайдер, чтобы не получить 413. Этот флаг в /settings не сбрасывается по таймеру статистики — только после успешного ответа этой моделью или когда запрос снова помещается в окно.',
    },
};

export function describeSkipReason(code, ctx = {}) {
    const base = HINTS[code]?.hint ?? code;
    if (code === SkipReason.CONTEXT_WINDOW && ctx.estimatedTokens != null && ctx.contextWindow != null) {
        return `${base} Сейчас: нужно ≈${ctx.estimatedTokens} токенов, окно модели ${ctx.contextWindow}.`;
    }
    if (code === SkipReason.CUSTOM_ROUTER && ctx.platform && ctx.modelId) {
        return `${base} Модель: ${ctx.platform}/${ctx.modelId}.`;
    }
    return base;
}

export function skipReasonShort(code) {
    return HINTS[code]?.short ?? code;
}

function rankColumns(db) {
    return db.prepare('PRAGMA table_info(model_rank_state)').all().map((c) => c.name);
}

export function migrateRankStateContextColumns(db) {
    const cols = rankColumns(db);
    if (!cols.includes('context_skip_active')) {
        db.exec(`
      ALTER TABLE model_rank_state ADD COLUMN context_skip_active INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE model_rank_state ADD COLUMN context_skip_estimated INTEGER;
      ALTER TABLE model_rank_state ADD COLUMN context_skip_window INTEGER;
      ALTER TABLE model_rank_state ADD COLUMN context_skip_at TEXT;
    `);
    }
}

/** Проставить context_window там, где NULL (консервативные значения). */
export function ensureModelContextWindows() {
    const db = getDb();
    db.prepare(`
    UPDATE models SET context_window = 128000
    WHERE enabled = 1 AND context_window IS NULL
  `).run();
    db.prepare(`
    UPDATE models SET context_window = 8000
    WHERE enabled = 1 AND context_window IS NULL AND platform = 'github' AND model_id = 'gpt-4o'
  `).run();
}

export function recordContextWindowSkip(modelDbId, estimatedTokens, contextWindow) {
    migrateRankStateContextColumns(getDb());
    getDb().prepare(`
    UPDATE model_rank_state SET
      context_skip_active = 1,
      context_skip_estimated = ?,
      context_skip_window = ?,
      context_skip_at = datetime('now')
    WHERE model_db_id = ?
  `).run(estimatedTokens, contextWindow, modelDbId);
}

export function clearContextWindowSkip(modelDbId) {
    if (!modelDbId)
        return;
    const db = getDb();
    if (!rankColumns(db).includes('context_skip_active'))
        return;
    db.prepare(`
    UPDATE model_rank_state SET
      context_skip_active = 0,
      context_skip_estimated = NULL,
      context_skip_window = NULL,
      context_skip_at = NULL
    WHERE model_db_id = ?
  `).run(modelDbId);
}

export function resolveModelUiStatus(model, ctx) {
    const route = modelCanRoute(model.platform);
    if (!route.canRoute) {
        const code = route.skipReason === 'no_provider' ? SkipReason.NO_PROVIDER : SkipReason.NO_API_KEY;
        return {
            statusCode: code,
            statusShort: skipReasonShort(code),
            statusHint: describeSkipReason(code, model),
        };
    }
    if (model.isBroken) {
        return {
            statusCode: SkipReason.BROKEN,
            statusShort: skipReasonShort(SkipReason.BROKEN),
            statusHint: describeSkipReason(SkipReason.BROKEN, model),
        };
    }
    if (model.contextSkipActive) {
        const hint = describeSkipReason(SkipReason.CONTEXT_WINDOW, {
            estimatedTokens: model.contextSkipEstimated,
            contextWindow: model.contextSkipWindow ?? model.contextWindow,
        });
        return {
            statusCode: SkipReason.CONTEXT_WINDOW,
            statusShort: skipReasonShort(SkipReason.CONTEXT_WINDOW),
            statusHint: hint,
        };
    }
    const n = model.errorsBeforeDemote ?? 5;
    const ce = model.consecutiveErrors ?? 0;
    const we = model.windowErr ?? 0;
    if (ce >= n || we >= n) {
        return {
            statusCode: 'window_error',
            statusShort: `ошибок ≥ ${n} (пропуск)`,
            statusHint: `Порог из настройки «Ошибок подряд → не работает» = ${n}. Подряд в БД: ${ce}, ERR в окне «${model.statsWindow}»: ${we}. Роутер не выбирает модель, пока не сбросится (успех или таймер статистики для окна).`,
        };
    }
    if (ce > 0 || we > 0) {
        return {
            statusCode: 'warning',
            statusShort: `ошибка ${ce}/${n} подряд`,
            statusHint: `Ещё не достигнут порог ${n} — модель остаётся в очереди (зелёная/жёлтая). Подряд: ${ce}, в окне лога ERR: ${we}. После ${n} подряд — пропуск и «не работает».`,
        };
    }
    return {
        statusCode: 'ready',
        statusShort: 'готова',
        statusHint: 'Может быть выбрана роутером: есть ключ, нет блокирующих ошибок в окне, не помечена «не влезает в окно». Фактический выбор ещё зависит от размера текущего запроса и sticky-сессии.',
    };
}

export function formatContextWindowLabel(ctxWin) {
    if (ctxWin == null)
        return 'окно: ?';
    if (ctxWin >= 1_000_000)
        return `окно: ${(ctxWin / 1_000_000).toFixed(1)}M`;
    if (ctxWin >= 1000)
        return `окно: ${Math.round(ctxWin / 1000)}k`;
    return `окно: ${ctxWin}`;
}
