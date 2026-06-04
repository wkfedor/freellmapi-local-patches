# GitHub

| Репозиторий | URL |
|-------------|-----|
| **Патчи FreeLLMAPI** (этот репозиторий, `~/freellmapi`) | https://github.com/wkfedor/freellmapi-local-patches |
| Fork **FreeLLMAPI** (исходники upstream, GitHub fork) | https://github.com/wkfedor/freellmapi → parent: `tashfeenahmed/freellmapi` |
| Fork **LiteLLM** (исходники, GitHub fork) | https://github.com/wkfedor/litellm → parent: `BerriAI/litellm` |

## Форк или патчи?

| Что | Тип | Как используется локально |
|-----|-----|---------------------------|
| `wkfedor/freellmapi` | **GitHub fork** upstream | Сейчас **не** собирается из этого клона; образ `ghcr.io/tashfeenahmed/freellmapi:latest` |
| `freellmapi-local-patches` | **Отдельный репозиторий** (не fork) | Каталог `patch/` + `docker-compose.yml` монтируют `.js` поверх образа |
| `litellm-proxy/` | Claude Code → LiteLLM :4000 | Только прокси, без Open WebUI |
| `open-webui-litellm/` | Опционально | Open WebUI + LiteLLM (не нужен для Claude Code) |
| `wkfedor/litellm` | Fork на GitHub | Запасной/будущий; в docker-compose — `docker.litellm.ai/berriai/litellm:main-stable` |

Итого: доработки роутера и лога — **volume-патчи** в этом репо, а не коммиты внутри fork `wkfedor/freellmapi`.

## Теги

- `v1.0.0-log` — лог запросов `/analytics/log`
- `v1.1.0-router` — настройки роутера `/settings`
- `v1.2.0-open-webui` — стек Open WebUI + LiteLLM (`open-webui-litellm/`)

Логирование и кастомный роутер реализованы как **Docker-патчи** к образу `ghcr.io/tashfeenahmed/freellmapi`, не как изменения внутри LiteLLM.

## Open WebUI + LiteLLM

Каталог `open-webui-litellm/` — стек на порту **3013** (UI → LiteLLM → FreeLLMAPI :3012).

EOF