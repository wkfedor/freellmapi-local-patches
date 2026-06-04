# Open WebUI + LiteLLM (опционально)

**Для Claude Code этот стек не нужен** — используйте отдельный [litellm-proxy/](../litellm-proxy/).

Здесь только если нужен веб-интерфейс Open WebUI на `:3013` вместе с LiteLLM.

```bash
cd ~/freellmapi/open-webui-litellm
cp .env.example .env
docker compose up -d
```

| Сервис | URL |
|--------|-----|
| Open WebUI | http://127.0.0.1:3013 |
| LiteLLM | http://127.0.0.1:4000 |

Не запускайте **одновременно** `litellm-proxy` и `open-webui-litellm`: оба занимают порт **4000** и имя контейнера `litellm-proxy`.
