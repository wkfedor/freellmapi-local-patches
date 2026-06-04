# Claude Code + FreeLLMAPI

Claude Code говорит с **Anthropic API** (`/v1/messages`). FreeLLMAPI отдаёт **OpenAI** (`/v1/chat/completions`), поэтому между ними нужен **LiteLLM** на `:4000`.

```
Claude Code  →  LiteLLM :4000  →  FreeLLMAPI :3012/v1  →  провайдеры
```

## Уже настроено

- Claude Code: `~/.local/bin/claude` (v2.1+)
- `~/.claude/settings.json` — `ANTHROPIC_BASE_URL=http://127.0.0.1:4000`
- Ключ: `~/bin/freellmapi-litellm-key.sh` (читает `~/open-webui-litellm/.env`)
- LiteLLM: `~/open-webui-litellm/` — модели `claude-sonnet-4` и др. → `openai/auto` на FreeLLMAPI

## Запуск

```bash
cd ~/freellmapi && docker compose up -d
cd ~/open-webui-litellm && docker compose up -d
claude
```

В сессии: `/status` — проверить endpoint; `/model` — выбрать `claude-sonnet-4` (роутер FreeLLMAPI подставит реальную модель).

## Ключи

| Переменная | Где |
|------------|-----|
| `FREELLMAPI_KEY` | `~/open-webui-litellm/.env` — ключ из UI FreeLLMAPI |
| `LITELLM_MASTER_KEY` | тот же `.env` — то, что шлёт Claude Code в LiteLLM |

## Логи

- FreeLLMAPI: http://127.0.0.1:3012/analytics/log
- Роутер: http://127.0.0.1:3012/settings
