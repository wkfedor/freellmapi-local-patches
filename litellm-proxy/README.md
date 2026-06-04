# LiteLLM proxy (только Claude Code)

Переводчик **Anthropic** (`/v1/messages`) → **OpenAI** (`/v1/chat/completions`) для FreeLLMAPI на `:3012`.

Open WebUI здесь **нет**. Для веб-UI см. опциональный каталог `open-webui-litellm/`.

## Запуск

```bash
cd ~/freellmapi/litellm-proxy
cp .env.example .env   # один раз: пропишите FREELLMAPI_KEY и LITELLM_MASTER_KEY
docker compose up -d
```

Проверка: `curl -s http://127.0.0.1:4000/health/liveliness` → `"I'm alive!"`

FreeLLMAPI должен быть уже запущен: `cd ~/freellmapi && docker compose up -d`

## Claude Code

- `ANTHROPIC_BASE_URL=http://127.0.0.1:4000` в `~/.claude/settings.json`
- Ключ: `~/bin/freellmapi-litellm-key.sh` (читает `~/freellmapi/litellm-proxy/.env`)

Подробнее: [docs/claude-code.md](../docs/claude-code.md)

## Миграция с `~/open-webui-litellm`

```bash
cp ~/open-webui-litellm/.env ~/freellmapi/litellm-proxy/.env
cd ~/open-webui-litellm && docker compose down
cd ~/freellmapi/litellm-proxy && docker compose up -d
```
