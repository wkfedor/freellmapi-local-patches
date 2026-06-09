/** Единое меню для самописных страниц (/analytics/log, /settings). */
(function () {
  const path = window.location.pathname.replace(/\/$/, '') || '/';

  function markActive() {
    const nav = document.querySelector('.flm-nav');
    if (!nav) return;
    for (const a of nav.querySelectorAll('a[href]')) {
      const href = (a.getAttribute('href') || '').replace(/\/$/, '') || '/';
      const on = path === href || (href !== '/' && path.startsWith(href + '/'));
      a.classList.toggle('flm-nav-active', on);
      if (on) {
        a.setAttribute('aria-current', 'page');
      } else {
        a.removeAttribute('aria-current');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', markActive);
  } else {
    markActive();
  }
})();
