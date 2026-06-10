/** Кнопка «Залить в Git» — на самописных страницах и в SPA dashboard. */
(function () {
  const REPO_URL = 'https://github.com/wkfedor/freellmapi-local-patches';
  const API = '/api/git-push';

  function injectStyles() {
    if (document.getElementById('flm-git-push-style')) return;
    const s = document.createElement('style');
    s.id = 'flm-git-push-style';
    s.textContent = `
      .flm-git-push-wrap {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-left: auto;
      }
      .btn-flm-git-push {
        padding: 4px 10px;
        border-radius: 6px;
        border: 1px solid #2d6a3e;
        background: #1e6b3a;
        color: #e8fff0;
        font: 600 12px "Segoe UI", system-ui, sans-serif;
        cursor: pointer;
      }
      .btn-flm-git-push:hover { filter: brightness(1.08); }
      .btn-flm-git-push:disabled { opacity: 0.55; cursor: wait; }
      .flm-git-push-link {
        font: 12px "Segoe UI", system-ui, sans-serif;
        color: #82aaff;
        text-decoration: none;
        white-space: nowrap;
      }
      header nav, .flm-nav { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
    `;
    document.head.appendChild(s);
  }

  function findNav() {
    return document.querySelector('.flm-nav')
      || document.querySelector('header nav')
      || document.querySelector('nav');
  }

  function ensureButton() {
    const nav = findNav();
    if (!nav || nav.querySelector('[data-freellmapi-git-push]')) return false;
    injectStyles();
    const wrap = document.createElement('span');
    wrap.className = 'flm-git-push-wrap';
    wrap.innerHTML =
      '<button type="button" class="btn-flm-git-push" data-freellmapi-git-push="1" title="git add -A, commit, push origin">Залить в Git</button>' +
      `<a class="flm-git-push-link" href="${REPO_URL}" target="_blank" rel="noopener">github</a>`;
    nav.appendChild(wrap);
    wrap.querySelector('button').addEventListener('click', onClick);
    return true;
  }

  function onClick() {
    const btn = document.querySelector('[data-freellmapi-git-push]');
    if (!btn || btn.disabled) return;
    if (!window.confirm('Залить ~/freellmapi в github.com/wkfedor/freellmapi-local-patches?')) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = '…';
    fetch(API, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: '{}',
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (body.log) console.log('[freellmapi-git]\n' + body.log);
        if (body.ok) {
          alert(body.message || 'Готово');
          return;
        }
        const msg = body.error || body.message || 'Ошибка push';
        console.error('[freellmapi-git]', msg);
        alert(msg);
      })
      .catch((err) => {
        console.error('[freellmapi-git]', err);
        alert(err.message || 'Ошибка');
      })
      .finally(() => {
        btn.disabled = false;
        btn.textContent = prev;
      });
  }

  function boot() {
    ensureButton();
    const obs = new MutationObserver(() => ensureButton());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 45000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
