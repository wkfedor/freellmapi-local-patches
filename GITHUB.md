# GitHub

| Репозиторий | URL |
|-------------|-----|
| **Патчи FreeLLMAPI** (этот код) | https://github.com/wkfedor/freellmapi-local-patches |
| Fork **LiteLLM** | https://github.com/wkfedor/litellm |
| Fork **FreeLLMAPI** (upstream) | https://github.com/wkfedor/freellmapi |

## Теги

- `v1.0.0-log` — лог запросов `/analytics/log`
- `v1.1.0-router` — настройки роутера `/settings`

Логирование и кастомный роутер реализованы как **Docker-патчи** к образу `ghcr.io/tashfeenahmed/freellmapi`, не как изменения внутри LiteLLM.

## Open WebUI + LiteLLM

Каталог `open-webui-litellm/` — стек на порту **3013** (UI → LiteLLM → FreeLLMAPI :3012).

EOF