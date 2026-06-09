/**
 * SPA dashboard: добавить ссылки на самописные страницы (без дубля Analytics).
 */
(function () {
  const EXTRA = [
    { href: '/analytics/log', label: 'Request log', marker: 'data-freellmapi-log' },
    { href: '/settings', label: 'Router settings', marker: 'data-freellmapi-settings' },
  ];

  function pathname() {
    return window.location.pathname.replace(/\/$/, '') || '/';
  }

  function applyActive(nav) {
    const path = pathname();
    for (const a of nav.querySelectorAll('a[href]')) {
      const href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      const isOurs = a.hasAttribute('data-freellmapi-log') || a.hasAttribute('data-freellmapi-settings');
      if (!isOurs) continue;
      const on = path === href || path.startsWith(href + '/');
      a.style.fontWeight = on ? '700' : '';
      a.style.color = on ? '#e7ecf3' : '#82aaff';
      a.setAttribute('aria-current', on ? 'page' : 'false');
    }
  }

  function inject() {
    const nav = document.querySelector('header nav, nav');
    if (!nav) return false;

    const anchor = nav.querySelector('a[href="/fallback"]')
      || nav.querySelector('a[href="/analytics"]')
      || nav.querySelector('a[href]:last-of-type');
    if (!anchor) return false;

    for (const spec of EXTRA) {
      if (nav.querySelector(`a[${spec.marker}]`)) continue;
      const a = document.createElement('a');
      a.href = spec.href;
      a.setAttribute(spec.marker, '1');
      a.textContent = spec.label;
      a.style.color = '#82aaff';
      a.style.textDecoration = 'none';
      a.style.marginLeft = '0';
      anchor.insertAdjacentElement('afterend', a);
    }
    applyActive(nav);
    return true;
  }

  function boot() {
    const run = () => {
      if (inject()) applyActive(document.querySelector('header nav, nav'));
    };
    run();
    window.addEventListener('popstate', run);
    const obs = new MutationObserver(run);
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
