/* Bootstrap: load data, render filters and sections, scrollspy navigation, theme + mobile menu. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;
  const ORDER = ['overview', 'how', 'questions', 'sales', 'acquisition', 'lifecycle', 'health', 'explorer', 'definitions'];

  function boot() {
    SX.theme.init();
    try { SX.loadData(); }
    catch (e) {
      document.getElementById('overview-root').innerHTML = '<div class="callout callout--critical"><h4>Data file missing</h4><p>' + U.escapeHtml(e.message) + '</p></div>';
      return;
    }
    SX.state.readHash();
    SX.renderFilters(document.getElementById('filterBar'));

    ORDER.forEach(id => {
      const root = document.getElementById(id + '-root');
      const fn = SX.sections && SX.sections[id];
      if (!root || !fn) return;
      root.textContent = '';
      try { fn(root); }
      catch (e) {
        console.error('[SX] section failed:', id, e);
        root.append(U.el('div', { class: 'callout callout--critical' }, [U.el('h4', { text: 'This section failed to render' }), U.el('p', { text: e.message })]));
      }
    });

    // Footer
    const m = SX.data.meta;
    const foot = document.getElementById('footer-root');
    foot.append(
      U.el('p', { text: 'STRSearch Business Data Explorer · built ' + m.built_at + ' from the reporting extracts dated ' + m.snapshot_label + '.' }),
      U.el('p', { text: 'Internal analysis. Contains no customer names, emails, phone numbers or addresses. Booked deal value is what sales entered in Pipedrive; it is not recognised revenue or cash collected.' })
    );

    // Theme toggle
    document.getElementById('themeBtn').addEventListener('click', () => SX.theme.toggle());

    // Mobile nav
    const mob = document.getElementById('mobileNav'), btn = document.getElementById('navMenuBtn');
    document.querySelectorAll('.site-nav a').forEach(a => mob.append(U.el('a', { href: a.getAttribute('href'), text: a.textContent })));
    btn.addEventListener('click', () => { const open = !mob.classList.contains('is-open'); mob.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    mob.addEventListener('click', e => { if (e.target.tagName === 'A') { mob.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); } });

    // Scrollspy
    const links = new Map(Array.from(document.querySelectorAll('.site-nav a')).map(a => [a.getAttribute('href').slice(1), a]));
    if ('IntersectionObserver' in window) {
      const vis = new Map();
      const spy = new IntersectionObserver(entries => {
        entries.forEach(e => vis.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
        let best = null, bestR = 0;
        ORDER.forEach(id => { const r = vis.get(id) || 0; if (r > bestR) { best = id; bestR = r; } });
        if (best) links.forEach((a, id) => a.classList.toggle('is-active', id === best));
      }, { rootMargin: '-120px 0px -45% 0px', threshold: [0, 0.05, 0.2, 0.5] });
      ORDER.forEach(id => { const s = document.getElementById(id); if (s) spy.observe(s); });
    }

    // Deep link to a section after async render
    const target = location.hash.split('?')[0].slice(1);
    if (target && document.getElementById(target)) setTimeout(() => document.getElementById(target).scrollIntoView(), 50);
    window.__SX_READY = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
