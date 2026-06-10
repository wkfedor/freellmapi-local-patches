# FreeLLMAPI local patches

Расширения для [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) (не LiteLLM).

## Страницы

- `/analytics/log` — подробный лог запросов/ответов
- `/settings` — настройки кастомного роутера
- **Залить в Git** — кнопка в меню (SPA и `/analytics/log`, `/settings`); `POST /api/git-push` → `push-to-git.sh`

## Теги (git)

- `v1.0.0-log` — request log + analytics
- `v1.1.0-router` — custom routing, settings, health-check
- `v1.2.0-open-webui` — Open WebUI + LiteLLM stack
- `v1.3.0-router-v2` — skip logging, context window UI, errors threshold from config, Claude via LiteLLM

## Секреты

В git **не** коммитятся: `.env`, ключи API, `ENCRYPTION_KEY`.
