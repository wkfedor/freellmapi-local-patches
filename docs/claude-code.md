# Claude Code + FreeLLMAPI

Claude Code говорит с **Anthropic API** (`/v1/messages`). FreeLLMAPI отдаёт **OpenAI** (`/v1/chat/completions`), поэтому между ними нужен **LiteLLM** на `:4000`.

```
Claude Code  →  LiteLLM :4000  →  FreeLLMAPI :3012/v1  →  провайдеры
```

## Запуск (два compose)

```bash
cd ~/freellmapi && docker compose up -d
cd ~/freellmapi/litellm-proxy && docker compose up -d
claude
```

Конфиг LiteLLM: `~/freellmapi/litellm-proxy/` (без Open WebUI).

## Claude Code

- `~/.claude/settings.json` — `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`
- Ключ: `~/bin/freellmapi-litellm-key.sh` → `~/freellmapi/litellm-proxy/.env`

В сессии: `/status` — endpoint; `/model` — `claude-sonnet-4` (роутер FreeLLMAPI выберет реальную модель).

## Ключи (`litellm-proxy/.env`)

| Переменная | Назначение |
|------------|------------|
| `FREELLMAPI_KEY` | Ключ из UI FreeLLMAPI → upstream :3012 |
| `LITELLM_MASTER_KEY` | Ключ, который шлёт Claude Code в LiteLLM |

## Проверка

```bash
curl -s http://127.0.0.1:4000/health/liveliness
curl -s http://127.0.0.1:3012/api/ping
```

## Логи

- FreeLLMAPI: http://127.0.0.1:3012/analytics/log
- Роутер: http://127.0.0.1:3012/settings

## Open WebUI

Не обязателен. Опциональный стек: `~/freellmapi/open-webui-litellm/` (не запускать вместе с `litellm-proxy` — один порт 4000).
