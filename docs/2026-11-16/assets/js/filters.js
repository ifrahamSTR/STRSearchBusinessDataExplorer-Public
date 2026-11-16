/* Global filter bar: one row above all content; every section re-renders on change.
   Period applies to each record's natural start: Pipedrive deal created date, Jira effective start
   (client_start_date from the reporting layer). Pipedrive attributes reach Jira through the linked deal. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util;

  const PERIODS = [
    { value: 'all', label: 'All time' },
    { value: 'l12m', label: 'Last 12 months' },
    { value: 'l6m', label: 'Last 6 months' },
    { value: 'ytd', label: 'Year to date' },
    { value: 'y2025', label: '2025' },
    { value: 'y2024', label: '2024' },
    { value: 'custom', label: 'Custom months…' },
  ];

  const DIMS = [
    { key: 'product', label: 'Package', field: 'product' },
    { key: 'source', label: 'Lead channel (UTM)', field: 'source' },
    { key: 'rep', label: 'Sales rep', field: 'rep' },
    { key: 'experience', label: 'Client experience', field: 'experience' },
  ];

  function options(field) {
    const counts = U.countBy(SX.data.deals.filter(d => d.in_scope), d => d[field] == null ? 'Unknown' : d[field]);
    const arr = Array.from(counts.entries()).sort((a, b) => (a[0] === 'Unknown') - (b[0] === 'Unknown') || b[1] - a[1]);
    return arr.map(([v, n]) => ({ value: v, label: v + ' (' + U.fmtInt(n) + ')' }));
  }

  function select(id, label, opts, value, onChange) {
    const sel = U.el('select', { id, 'aria-label': label });
    opts.forEach(o => sel.append(U.el('option', { value: o.value, text: o.label })));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    const wrap = U.el('label', { class: 'filter', for: id }, [U.el('span', { text: label }), sel]);
    return wrap;
  }

  SX.renderFilters = function (root) {
    const container = U.el('div', { class: 'container' });
    root.textContent = '';
    root.append(container);

    function draw() {
      const s = SX.state.get();
      container.textContent = '';
      container.append(U.el('span', { class: 'filter-label', text: 'Filters' }));
      const per = select('f-period', 'Period', PERIODS, s.period, v => {
        if (v === 'custom') SX.state.set({ period: 'custom', from: s.from || U.addMonths(SX.data.asofMonth, -11), to: s.to || SX.data.asofMonth });
        else SX.state.set({ period: v, from: null, to: null });
      });
      per.classList.toggle('is-set', s.period !== 'all');
      per.title = 'Applies to Pipedrive deal created date and Jira effective start date';
      container.append(per);
      if (s.period === 'custom') {
        const months = U.monthRange(SX.data.firstMonth, SX.data.asofMonth).reverse().map(m => ({ value: m, label: U.fmtMonth(m, true) }));
        container.append(select('f-from', 'From', months.slice().reverse(), s.from, v => SX.state.set({ from: v > s.to ? s.to : v })));
        container.append(select('f-to', 'To', months, s.to, v => SX.state.set({ to: v < s.from ? s.from : v })));
      }
      DIMS.forEach(d => {
        const opts = [{ value: 'all', label: 'All' }].concat(options(d.field));
        const w = select('f-' + d.key, d.label, opts, s[d.key], v => SX.state.set({ [d.key]: v }));
        w.classList.toggle('is-set', s[d.key] !== 'all');
        container.append(w);
      });
      const reset = U.el('button', { class: 'filter-reset', type: 'button', text: 'Reset', disabled: SX.state.isDefault() });
      reset.addEventListener('click', () => SX.state.reset());
      container.append(reset);

      const nDeals = SX.model.deals().length;
      const nJira = SX.model.jira().length;
      const sum = U.el('div', { class: 'filter-summary' });
      sum.append(U.el('strong', { text: U.fmtInt(nDeals) }), ' deals · ', U.el('strong', { text: U.fmtInt(nJira) }), ' Jira issues');
      if (SX.model.pdFilterActive()) sum.append(U.el('span', { text: ' · Jira issues without a linked deal are excluded' }));
      sum.title = 'Period: ' + SX.state.range().label + '. Deals = STR Search pipeline (pipedrive_reporting_base, keep = true, Test Lead / Duplicate excluded); Jira issues and engagements are dated by client_start_date.';
      container.append(sum);
    }
    draw();
    SX.bus.on('filters', draw);
  };
})();
