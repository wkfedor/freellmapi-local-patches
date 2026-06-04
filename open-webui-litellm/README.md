# Open WebUI + LiteLLM → FreeLLMAPI

| Сервис | URL |
|--------|-----|
| **Open WebUI** | http://127.0.0.1:3013 |
| LiteLLM (отладка) | http://127.0.0.1:4000 |
| FreeLLMAPI | http://127.0.0.1:3012/v1 |

Цепочка: **Open WebUI** → **LiteLLM** → **FreeLLMAPI** (ваши бесплатные провайдеры).

## Запуск

```bash
cd ~/open-webui-litellm
docker compose up -d
docker compose ps
docker compose logs -f --tail 50
```

Нужен запущенный FreeLLMAPI (`~/freellmapi`).

## Модели в Open WebUI

В чате выберите модель **auto** или **freellm-auto** (обе идут в FreeLLMAPI `auto`).

## Команды

```bash
docker compose pull && docker compose up -d   # обновление
docker compose restart
docker compose down
```

## Настройки

- `FREELLMAPI_KEY` — ключ из FreeLLMAPI UI / `~/.cline/data/secrets.json`
- `LITELLM_MASTER_KEY` — ключ для Open WebUI → LiteLLM (в `.env`)
- `litellm/config.yaml` — маршруты; добавьте `model_name` по списку `/v1/models` FreeLLMAPI
