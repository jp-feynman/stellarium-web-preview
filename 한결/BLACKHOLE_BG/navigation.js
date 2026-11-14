// Prepare only the sky engine, on navigation intent; keep ordinary links and browser history.
(function () {
  'use strict';
  const links = document.querySelectorAll('a[href^="./planetarium/"]');
  const status = document.getElementById('navigation-status');
  if (!status || !links.length) return;

  let warmed = false;
  let pending = null;
  let firstFrame = 0;
  let paintFrame = 0;
  let fallback = 0;

  function prewarm() {
    const connection = navigator.connection;
    if (warmed || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
    warmed = true;
    for (const [file, as] of [['stellarium-web-engine.js', 'script'], ['stellarium-web-engine.wasm', 'fetch']]) {
      const resource = document.createElement('link');
      resource.rel = 'prefetch';
      resource.as = as;
      resource.href = new URL(`./planetarium/engine/${file}`, document.baseURI).href;
      if (as === 'fetch') { resource.type = 'application/wasm'; resource.crossOrigin = 'anonymous'; }
      document.head.append(resource);
    }
  }

  function cancelScheduledNavigation() {
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(paintFrame);
    clearTimeout(fallback);
  }

  for (const link of links) {
    link.addEventListener('pointerenter', prewarm);
    link.addEventListener('focusin', prewarm);
    link.addEventListener('click', (event) => {
      const target = link.getAttribute('target');
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
          || (target && target !== '_self') || link.hasAttribute('download')) return;
      event.preventDefault();
      if (pending) return;
      pending = link;
      link.setAttribute('aria-busy', 'true');
      status.textContent = new URL(link.href, document.baseURI).searchParams.get('view') === 'allsky'
        ? '전천 지도 준비 중…' : '플라네타리움 준비 중…';
      status.hidden = false;
      window.__hero?.setActive(false);
      let navigating = false;
      const navigate = () => {
        if (!pending || navigating) return;
        navigating = true;
        cancelScheduledNavigation();
        window.location.assign(link.href);
      };
      // Let the status paint once before replacing the document. No physics work runs meanwhile.
      firstFrame = requestAnimationFrame(() => { paintFrame = requestAnimationFrame(navigate); });
      // Navigation must still work if the browser suspends animation callbacks.
      fallback = setTimeout(navigate, 180);
    });
  }

  window.addEventListener('pagehide', () => {
    cancelScheduledNavigation();
    window.__hero?.setActive(false);
  });
  window.addEventListener('pageshow', () => {
    cancelScheduledNavigation();
    pending?.removeAttribute('aria-busy');
    pending = null;
    status.hidden = true;
    status.textContent = '';
    window.__hero?.setActive(true);
  });
})();
