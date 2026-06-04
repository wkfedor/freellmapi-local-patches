# FreeLLMAPI (локально)

Прокси для Cline / Continue: `http://127.0.0.1:3012/v1`

## После перезагрузки ПК

Поднимается сам:

1. **Docker** (`systemctl is-enabled docker` → enabled) стартует контейнер с `restart: unless-stopped`
2. **systemd user** `freellmapi.service` — запасной вариант при входе в сессию

## Подробный лог запросов

- **Request log:** http://127.0.0.1:3012/analytics/log (в меню; фильтр **12 часов**)
- **Настройки роутера:** http://127.0.0.1:3012/settings
- Старая аналитика: http://127.0.0.1:3012/analytics

- Каждый вызов `/v1/chat/completions` через прокси пишется в лог **автоматически** — отдельный ключ на странице не нужен.
- Видно: клиентская `model`, куда реально ушло (platform/model), превью промпта и ответа, ошибки, токены, latency, TTFB.
- Данные в SQLite на volume `freellmapi-data` (переживают перезагрузку Docker).
- Код патчей в `~/freellmapi/patch/` монтируется в контейнер — **не пропадает** при `docker compose pull` / перезапуске (в отличие от файлов внутри образа).

## Failover при любой ошибке провайдера

В `patch/proxy.js` включён локальный патч: при 402, 401 и других сбоях прокси переключается на следующую модель (до 20 попыток), а не отдаёт сразу 502. Файл монтируется через `docker-compose.yml`. После `docker compose pull` патч сохраняется; обновляется только образ, не `patch/proxy.js`.

## Команды

```bash
cd ~/freellmapi

# Статус
docker compose ps

# Обновить образ (после выхода новой версии freellmapi)
docker compose pull && docker compose up -d

# Логи
docker compose logs -f --tail 100

# Перезапуск
docker compose restart
```

## Cline

- Base URL: `http://127.0.0.1:3012/v1`
- API Key: см. `~/.cline/data/secrets.json` или UI FreeLLMAPI

## Claude Code

Нужен отдельный LiteLLM (не Open WebUI):

```bash
cd ~/freellmapi/litellm-proxy && docker compose up -d
```

См. [docs/claude-code.md](docs/claude-code.md) и [litellm-proxy/README.md](litellm-proxy/README.md).
