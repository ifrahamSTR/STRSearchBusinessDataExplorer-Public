/* Business terms on demand (added 18 Nov 2026). SX.term(key, label) returns the label with a small "?" button; the button
   opens one shared popover with the term's counting unit, date basis, source and calculation (defs.terms, written by
   pipeline/glossary.py). Escape, a click outside or the close button dismisses it. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, el = U.el;
  let pop = null, owner = null;

  function terms() {
    if (!SX._terms) SX._terms = new Map(((SX.data && SX.data.defs && SX.data.defs.terms) || []).map(t => [t.key, t]));
    return SX._terms;
  }
  function close() {
    if (!pop) return;
    pop.hidden = true;
    if (owner) { owner.setAttribute('aria-expanded', 'false'); owner = null; }
  }
  function ensure() {
    if (pop) return pop;
    pop = el('div', { class: 'term-pop', role: 'dialog', 'aria-modal': 'false', hidden: true });
    document.body.append(pop);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && owner) { const o = owner; close(); o.focus(); } });
    document.addEventListener('click', e => { if (pop && !pop.hidden && !pop.contains(e.target) && e.target !== owner) close(); });
    window.addEventListener('resize', close);
    return pop;
  }
  function open(btn, t) {
    ensure();
    if (owner === btn) { close(); return; }
    close();
    pop.textContent = '';
    const dl = el('dl');
    [['Counted as', t.unit], ['Date', t.date], ['Source', t.source], ['Calculation', t.calc]].forEach(([k, v]) => { if (v) dl.append(el('dt', { text: k }), el('dd', { text: v })); });
    const x = el('button', { class: 'term-x', type: 'button', 'aria-label': 'Close definition', text: '×' });
    x.addEventListener('click', () => { const o = owner; close(); if (o) o.focus(); });
    pop.append(el('div', { class: 'term-h' }, [el('b', { text: t.term }), x]), dl,
      el('a', { class: 'term-more', href: '#glossary', text: 'All definitions →', on: { click: close } }));
    pop.hidden = false;
    owner = btn;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + window.scrollX - 20)) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 8) + 'px';
    x.focus();
  }
  /** label with an on-demand definition; returns a <span> node */
  SX.term = function (key, label) {
    const t = terms().get(key);
    const span = el('span', { class: 'term' }, [label || (t ? t.term : key)]);
    if (!t) return span;
    const b = el('button', { class: 'term-q', type: 'button', 'aria-label': 'Definition: ' + t.term, 'aria-expanded': 'false', title: 'What this means and how it is counted', text: '?' });
    b.addEventListener('click', e => { e.stopPropagation(); open(b, t); });
    span.append(b);
    return span;
  };
  SX.termList = terms;
})();
