# Локальный образ: upstream FreeLLMAPI + git для кнопки «Залить в Git» из UI.
FROM ghcr.io/tashfeenahmed/freellmapi:latest
USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system safe.directory '*'
USER node
