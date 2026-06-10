#!/usr/bin/env bash
# git add / commit / push для ~/freellmapi (freellmapi-local-patches).
# Вызывается из UI FreeLLMAPI (POST /api/git-push) или вручную / двойным кликом.

set -u

ROOT="${FREELLMAPI_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
LOG_DIR="${ROOT}/logs"
JSON=0
COMMIT_MSG=""
WAIT_SEC="${FREELLMAPI_GIT_PUSH_WAIT_SEC:-10}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --message) COMMIT_MSG="${2:-}"; shift 2 ;;
    --no-wait) WAIT_SEC=0; shift ;;
    *) shift ;;
  esac
done

mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/git-push-$(date +%Y%m%d_%H%M%S).log"

# Двойной клик без терминала → перезапуск в окне (только интерактивный режим).
if [[ "${JSON}" -eq 0 ]] && [[ -z "${FREELLMAPI_GIT_PUSH_IN_TERMINAL:-}" ]] && [[ ! -t 1 ]]; then
  export FREELLMAPI_GIT_PUSH_IN_TERMINAL=1
  CMD="cd $(printf '%q' "${ROOT}") && $(printf '%q' "${BASH_SOURCE[0]}")"
  for term in gnome-terminal konsole xfce4-terminal x-terminal-emulator xterm; do
    if command -v "${term}" >/dev/null 2>&1; then
      case "${term}" in
        gnome-terminal) exec gnome-terminal -- bash -c "${CMD}; exec bash" ;;
        konsole)        exec konsole -e bash -c "${CMD}; exec bash" ;;
        xfce4-terminal) exec xfce4-terminal -e "bash -c '${CMD}; exec bash'" ;;
        x-terminal-emulator) exec x-terminal-emulator -e bash -c "${CMD}; exec bash" ;;
        xterm)          exec xterm -hold -e bash -c "${CMD}" ;;
      esac
    fi
  done
  echo "Не найден терминал. Запустите: ${BASH_SOURCE[0]}"
  read -r -p "Enter для выхода..."
  exit 1
fi

log() {
  local line="[$(date '+%H:%M:%S')] $*"
  if [[ "${JSON}" -eq 1 ]]; then
    echo "${line}" >> "${LOG_FILE}"
  else
    echo -e "${line}" | tee -a "${LOG_FILE}"
  fi
}

emit_json() {
  local ok="$1" committed="$2" pushed="$3" message="$4"
  MESSAGE="${message}" OK="${ok}" COMMITTED="${committed}" PUSHED="${pushed}" LOG_FILE="${LOG_FILE}" \
  node -e '
const fs = require("fs");
const logFile = process.env.LOG_FILE || "";
const log = logFile && fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
console.log(JSON.stringify({
  ok: process.env.OK === "1",
  committed: process.env.COMMITTED === "1",
  pushed: process.env.PUSHED === "1",
  message: process.env.MESSAGE || "",
  log,
  logFile,
}));
'
}

finish() {
  local code="$1" ok="$2" committed="$3" pushed="$4" message="$5"
  if [[ "${JSON}" -eq 1 ]]; then
    emit_json "${ok}" "${committed}" "${pushed}" "${message}"
  else
    log "${message}"
    if [[ "${WAIT_SEC}" -gt 0 ]]; then
      log "Окно закроется через ${WAIT_SEC} сек..."
      sleep "${WAIT_SEC}"
    fi
  fi
  exit "${code}"
}

if [[ ! -d "${ROOT}/.git" ]]; then
  finish 1 0 0 0 "Нет git-репозитория в ${ROOT}"
fi

if ! command -v git >/dev/null 2>&1; then
  finish 1 0 0 0 "git не найден в PATH"
fi

cd "${ROOT}" || finish 1 0 0 0 "Не удалось перейти в ${ROOT}"

log "=== FreeLLMAPI git push ==="
log "root=${ROOT}"
log "branch=$(git branch --show-current 2>/dev/null || echo '?')"
log "remote=$(git remote get-url origin 2>/dev/null || echo 'нет origin')"

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  finish 1 0 0 0 ".env в индексе git — коммит отменён"
fi

log "$ git add -A"
git add -A >> "${LOG_FILE}" 2>&1

git reset HEAD -- .env '**/.env' logs/ '*.log' 2>/dev/null || true

if git diff --cached --quiet 2>/dev/null; then
  porcelain="$(git status --porcelain)"
  if [[ -z "${porcelain//[$' \t\n']/}" ]]; then
    finish 0 1 0 0 "Нечего коммитить — рабочая копия чистая"
  fi
  finish 0 1 0 0 "Нечего коммитить — после git add нет изменений в индексе"
fi

if [[ -z "${COMMIT_MSG}" ]]; then
  COMMIT_MSG="FreeLLMAPI: update $(date '+%Y-%m-%d %H:%M:%S')"
fi

log "$ git commit"
if ! git commit -m "${COMMIT_MSG}" >> "${LOG_FILE}" 2>&1; then
  finish 1 0 0 0 "git commit не удался (см. log)"
fi

branch="$(git branch --show-current)"
branch="${branch:-main}"

log "$ git push -u origin ${branch}"
if git push -u origin "${branch}" >> "${LOG_FILE}" 2>&1; then
  finish 0 1 1 1 "Закоммичено и отправлено в origin/${branch}"
fi

log "push отклонён — fetch + pull --no-rebase + push"
git fetch origin "${branch}" >> "${LOG_FILE}" 2>&1 || true
git pull --no-rebase origin "${branch}" >> "${LOG_FILE}" 2>&1 || true
if git push -u origin "${branch}" >> "${LOG_FILE}" 2>&1; then
  finish 0 1 1 1 "Закоммичено и отправлено в origin/${branch} (после pull)"
fi

finish 1 0 1 0 "Коммит создан, push не удался (см. log)"
