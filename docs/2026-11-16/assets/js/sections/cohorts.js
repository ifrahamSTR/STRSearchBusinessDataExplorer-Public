/* Section 4 · Cohort builder (added 18 Nov 2026): ad hoc cohort comparisons on the same clock.
   Choose an entry event and a date range (the cohort), a grouping, and up to two outcomes with a window in days. A client
   counts in a window only once that many days have passed since the entry (eligible), so recent cohorts never dilute a
   rate. Outcome 2 can be counted among everyone who entered or only among those who reached outcome 1, on a clock that
   starts at the entry or at outcome 1. Unit = the entry's record (deal, won deal, confirmed start, contract). The builder
   uses its own date range; the other filters above (package, channel, rep, experience) still apply. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;
  const THIN = 20;

  const ENTRY = {
    created: { label: 'Deal created (Pipedrive)', by: 'deal created date', unit: 'deals', rows: () => SX.model.deals({ ignorePeriod: true }), date: r => r.created_d },
    won: { label: 'Deal won', by: 'won date', unit: 'won deals', rows: () => SX.model.eng({ ignorePeriod: true }), date: r => r.won_date_d },
    start: { label: 'Client start (confirmed)', by: 'client start date', unit: 'confirmed starts', rows: () => SX.model.eng({ ignorePeriod: true, population: 'confirmed' }), date: r => r.start_d },
    uc: { label: 'Under Contract (latest valid)', by: 'Under Contract date', unit: 'contracts', rows: () => SX.model.eng({ ignorePeriod: true }).filter(e => e.uc_d != null), date: r => r.uc_d },
  };
  // outcome events: date(row, eng) for timed events, state(row, eng) for "as of today" states
  const OUT = {
    won: { label: 'Won', from: ['created'], date: r => r.won_date_d },
    lost: { label: 'Lost', from: ['created'], date: r => (r.status === 'lost' ? r.lost_date_d : null) },
    start: { label: 'Client start (confirmed)', from: ['created', 'won'], date: (r, x) => (x && x.confirmed_start ? x.start_d : null) },
    uc: { label: 'Under Contract', from: ['created', 'won', 'start'], date: (r, x) => (x ? x.uc_d : null) },
    closed: { label: 'CLOSED (closing completed)', from: ['created', 'won', 'start', 'uc'], date: (r, x) => (x ? x.closed_d : null) },
    refunded: { label: 'Refunded', from: ['created', 'won', 'start', 'uc'], date: (r, x) => (x && x.refunded ? x.refund_date_d : null) },
    purchased_now: { label: 'Completed purchase (status today)', from: ['created', 'won', 'start', 'uc'], state: (r, x) => !!x && x.stage === 'purchased' },
    hunting_now: { label: 'Still hunting today', from: ['created', 'won', 'start'], state: (r, x) => !!x && x.stage === 'hunting' },
    paused_now: { label: 'Paused today', from: ['created', 'won', 'start', 'uc'], state: (r, x) => !!x && x.stage === 'paused' },
    fell_through: { label: 'Contract fell through (any evidence)', from: ['won', 'start', 'uc'], state: (r, x) => !!x && ['documented', 'ended', 'returned'].includes(x.fallout) },
  };
  const ST = { purchased: 'Completed purchase', under_contract: 'Under contract', hunting: 'Hunting', paused: 'Paused', additional: 'Additional Service', refunded: 'Refunded', presale: 'Pre-sale prospect', declined: 'Services Declined', no_jira: 'No Jira issue' };
  const GROUPS = {
    none: { label: 'No grouping', fn: () => 'All' },
    budget_cmp: { label: 'Budget: up to $250K vs above', fn: (r, x) => (x ? x.budget_cmp || 'Not recorded' : 'Not won'), term: 'budget' },
    budget_strict: { label: 'Budget: below / ends at / above $250K', fn: (r, x) => (x ? x.budget_strict || 'Not recorded' : 'Not won'), term: 'budget_strict' },
    budget_band: { label: 'Budget: every range', fn: (r, x) => (x ? x.budget_band || 'Not recorded' : 'Not won'), term: 'budget' },
    henry: { label: 'HENRY: Jira total_oop ≤ $225K (historical)', fn: (r, x) => (!x ? 'Not won' : !x.oop_known ? 'total_oop not recorded' : x.henry ? 'HENRY (total_oop ≤ $225K)' : 'total_oop above $225K'), term: 'henry' },
    channel: { label: 'Lead channel (UTM)', fn: r => r.channel || 'Unknown', term: 'channel' },
    product: { label: 'Package', fn: r => r.product || 'Not filled', term: 'package' },
    payment: { label: 'Payment type (recorded)', fn: r => r.payment_recorded || 'Not recorded' },
    rep: { label: 'Sales rep', fn: r => r.rep || 'Unknown' },
    setter: { label: 'Setter', fn: r => r.setter || 'No setter' },
    acq_lead: { label: 'Acquisition lead', fn: (r, x) => (x ? x.acq_lead || 'Unassigned' : 'Not won') },
    experience: { label: 'Client experience', fn: r => r.experience || 'Not tagged', term: 'experience' },
    rule: { label: 'Start-date rule', fn: (r, x) => (x && x.confirmed_start ? x.start_rule : 'No confirmed start'), term: 'rule' },
    search_kind: { label: 'First vs repeat search', fn: (r, x) => (x ? x.search_kind : 'Not won'), term: 'repeat' },
    offers: { label: 'Offer experience (form)', fn: (r, x) => (x ? x.offers || 'Not recorded' : 'Not won'), term: 'offers' },
    capital: { label: 'Pipedrive stated capital', fn: r => r.capital_band || 'Not stated', term: 'capital' },
    stage: { label: 'Where the client stands today', fn: (r, x) => (x ? ST[x.stage] || x.stage : 'Not won') },
    month: { label: 'Entry month', fn: (r, x, d0) => U.monthKeyFromDay(d0), ordered: true },
    quarter: { label: 'Entry quarter', fn: (r, x, d0) => U.quarterKeyFromDay(d0), ordered: true },
  };
  const PRESETS = [
    { label: 'Jul–Sep starts by budget: UC within 2 weeks, CLOSED within 90 days', s: { entry: 'start', from: '2026-07', to: '2026-09', group: 'budget_cmp', o1: { ev: 'uc', n: 14 }, o2: { ev: 'closed', n: 90, base: 'entered', clock: 'entry' } } },
    { label: 'Lead sources: won within 30 days of creation, then bought a property', s: { entry: 'created', from: null, to: null, group: 'channel', o1: { ev: 'won', n: 30 }, o2: { ev: 'closed', n: 'any', base: 'o1', clock: 'o1' } } },
    { label: 'Package: UC within 30 days of the start', s: { entry: 'start', from: '2026-01', to: null, group: 'product', o1: { ev: 'uc', n: 30 }, o2: null } },
    { label: 'First vs repeat search: CLOSED within 120 days', s: { entry: 'start', from: null, to: null, group: 'search_kind', o1: { ev: 'closed', n: 120 }, o2: null } },
    { label: 'Acquisition lead: UC within 60 days, starts since June', s: { entry: 'start', from: '2026-06', to: null, group: 'acq_lead', o1: { ev: 'uc', n: 60 }, o2: { ev: 'refunded', n: 60, base: 'entered', clock: 'entry' } } },
  ];

  const v = { entry: 'start', from: '2026-07', to: '2026-09', group: 'budget_cmp', o1: { ev: 'uc', n: 14 }, o2: { ev: 'closed', n: 90, base: 'entered', clock: 'entry' }, sort: 'entered' };
  let rerender = null;
  SX.cohortsPreset = function (p) {
    Object.assign(v, JSON.parse(JSON.stringify(p)));
    if (!('from' in p)) { v.from = null; v.to = null; }
    if (rerender) rerender();
  };

  function engIndex() {
    if (!SX._engById) SX._engById = new Map(SX.data.eng.map(e => [String(e.id), e]));
    return SX._engById;
  }

  /* the computation, shared with the parity check */
  SX.cohorts = function (spec) {
    const s = spec || v, E = ENTRY[s.entry], asof = SX.data.asofDay, byId = engIndex();
    const from = s.from ? U.monthStartDay(s.from) : null, to = s.to ? U.monthEndDay(s.to) : null;
    const G = GROUPS[s.group] || GROUPS.none;
    const o1 = OUT[s.o1.ev], o2 = s.o2 && OUT[s.o2.ev];
    const groups = new Map(), months = new Map();
    let entered = 0;
    E.rows().forEach(r => {
      const d0 = E.date(r);
      if (d0 == null || (from != null && d0 < from) || (to != null && d0 > to) || d0 > asof) return;
      const x = s.entry === 'created' ? byId.get(String(r.id)) : r;
      entered++;
      const g = G.fn(r, x, d0);
      if (!groups.has(g)) groups.set(g, { g, entered: 0, el1: 0, k1: 0, el2: 0, k2: 0, items: [] });
      const a = groups.get(g);
      a.entered++;
      const elapsed = asof - d0;
      // outcome 1
      let e1, h1 = false, d1 = null;
      if (o1.state) { e1 = true; h1 = o1.state(r, x); }
      else {
        d1 = o1.date(r, x);
        e1 = s.o1.n === 'any' || elapsed >= s.o1.n;
        h1 = e1 && d1 != null && d1 - d0 >= 0 && (s.o1.n === 'any' || d1 - d0 <= s.o1.n);
      }
      if (e1) a.el1++;
      if (h1) a.k1++;
      a.items.push({ t: d1 != null && d1 - d0 >= 0 ? d1 - d0 : elapsed, e: !o1.state && d1 != null && d1 - d0 >= 0 });
      // outcome 2
      if (o2) {
        const inBase = s.o2.base === 'o1' ? h1 : true;
        if (inBase) {
          const c0 = s.o2.clock === 'o1' && s.o2.base === 'o1' && d1 != null ? d1 : d0;
          let e2, h2 = false;
          if (o2.state) { e2 = true; h2 = o2.state(r, x); }
          else {
            const d2 = o2.date(r, x);
            e2 = s.o2.n === 'any' || asof - c0 >= s.o2.n;
            h2 = e2 && d2 != null && d2 - c0 >= 0 && (s.o2.n === 'any' || d2 - c0 <= s.o2.n);
          }
          if (e2) a.el2++;
          if (h2) a.k2++;
        }
      }
      // maturity by entry month
      const mk = U.monthKeyFromDay(d0);
      if (!months.has(mk)) months.set(mk, { m: mk, n: 0, el1: 0 });
      const mm = months.get(mk);
      mm.n++;
      if (o1.state || s.o1.n === 'any' || elapsed >= s.o1.n) mm.el1++;
    });
    let list = Array.from(groups.values());
    if (G.ordered) list.sort((p, q) => (p.g > q.g ? 1 : -1));
    else list.sort((p, q) => q.entered - p.entered);
    const tot = list.reduce((acc, a) => { ['entered', 'el1', 'k1', 'el2', 'k2'].forEach(k => { acc[k] += a[k]; }); return acc; }, { g: 'All', entered: 0, el1: 0, k1: 0, el2: 0, k2: 0 });
    return { spec: s, groups: list, total: tot, months: Array.from(months.values()).sort((p, q) => (p.m > q.m ? 1 : -1)), entered };
  };

  SX.sections.cohorts = function (root) {
    SX.head(root, 'cohorts', 'Section 4 · Cohort builder', 'Compare any groups on the same clock',
      'Pick who enters the cohort (an event and a date range), how to split them, and what happens next within a number of days. Each window counts only clients who have had the whole window, and the maturity chart shows which recent cohorts are not there yet. The filters above (package, channel, rep, experience) still apply; the date range here replaces the period filter.');
    const presets = el('div', { class: 'preset-row' }, [el('span', { class: 'seg-label', text: 'Examples' })]);
    root.append(presets);
    PRESETS.forEach(p => presets.append(el('button', { type: 'button', class: 'tool-btn', text: p.label, on: { click: () => SX.cohortsPreset(p.s) } })));
    const form = el('div', { class: 'cohort-form' });
    root.append(form);
    const sentence = el('div', { class: 'verdict cohort-sentence', 'aria-live': 'polite' });
    root.append(sentence);
    const grid = el('div', { class: 'grid grid-12 mt-1' });
    root.append(grid);
    const left = el('div', { class: 'span-8' }), right = el('div', { class: 'span-4' });
    grid.append(left, right);

    const months = U.monthRange(SX.data.firstMonth, SX.data.asofMonth);
    const sel = (label, value, opts, onChange, id) => {
      const s = el('select', { id: 'cb-' + id, 'aria-label': label });
      opts.forEach(o => s.append(el('option', { value: o.value, text: o.label })));
      s.value = value == null ? '' : String(value);
      s.addEventListener('change', () => onChange(s.value));
      return el('label', { class: 'cb-field', for: 'cb-' + id }, [el('span', { text: label }), s]);
    };
    const num = (label, value, onChange, id) => {
      const wrap = el('label', { class: 'cb-field cb-days', for: 'cb-' + id }, [el('span', { text: label })]);
      const s = el('select', { id: 'cb-' + id, 'aria-label': label });
      [7, 14, 21, 30, 45, 60, 90, 120, 180, 365, 'any'].forEach(n => s.append(el('option', { value: String(n), text: n === 'any' ? 'any time (to date)' : n + ' days' })));
      s.value = String(value);
      s.addEventListener('change', () => onChange(s.value === 'any' ? 'any' : +s.value));
      wrap.append(s);
      return wrap;
    };
    function drawForm() {
      form.textContent = '';
      const outs = Object.entries(OUT).filter(([, o]) => o.from.includes(v.entry)).map(([k, o]) => ({ value: k, label: o.label }));
      if (!outs.some(o => o.value === v.o1.ev)) v.o1.ev = outs[0].value;
      if (v.o2 && !outs.some(o => o.value === v.o2.ev)) v.o2.ev = outs[Math.min(1, outs.length - 1)].value;
      const row1 = el('div', { class: 'cb-row' }, [el('b', { class: 'cb-step', text: '1 · Cohort' }),
        sel('Entry event', v.entry, Object.entries(ENTRY).map(([k, e]) => ({ value: k, label: e.label })), x => { v.entry = x; render(); }, 'entry'),
        sel('From', v.from || '', [{ value: '', label: 'Earliest' }].concat(months.map(m => ({ value: m, label: U.fmtMonth(m) }))), x => { v.from = x || null; if (v.to && v.from && v.from > v.to) v.to = v.from; render(); }, 'from'),
        sel('To', v.to || '', [{ value: '', label: 'Latest (data date)' }].concat(months.map(m => ({ value: m, label: U.fmtMonth(m) }))), x => { v.to = x || null; if (v.to && v.from && v.from > v.to) v.from = v.to; render(); }, 'to'),
        sel('Split by', v.group, Object.entries(GROUPS).map(([k, g]) => ({ value: k, label: g.label })), x => { v.group = x; render(); }, 'group')]);
      const row2 = el('div', { class: 'cb-row' }, [el('b', { class: 'cb-step', text: '2 · Outcome' }),
        sel('Outcome', v.o1.ev, outs, x => { v.o1.ev = x; render(); }, 'o1'),
        OUT[v.o1.ev].state ? el('span', { class: 'cb-note', text: 'status today (no window)' }) : num('within', v.o1.n, x => { v.o1.n = x; render(); }, 'o1n'),
        el('b', { class: 'cb-step', text: 'and' }),
        sel('Second outcome', v.o2 ? v.o2.ev : '', [{ value: '', label: 'None' }].concat(outs), x => { v.o2 = x ? Object.assign({ n: 90, base: 'entered', clock: 'entry' }, v.o2 || {}, { ev: x }) : null; render(); }, 'o2')]);
      if (v.o2) {
        if (!OUT[v.o2.ev].state) row2.append(num('within', v.o2.n, x => { v.o2.n = x; render(); }, 'o2n'));
        row2.append(sel('counted among', v.o2.base, [{ value: 'entered', label: 'everyone in the cohort' }, { value: 'o1', label: 'those who reached outcome 1' }], x => { v.o2.base = x; if (x === 'entered') v.o2.clock = 'entry'; render(); }, 'o2b'));
        if (v.o2.base === 'o1' && !OUT[v.o2.ev].state) row2.append(sel('days counted from', v.o2.clock, [{ value: 'entry', label: 'the entry event' }, { value: 'o1', label: 'outcome 1' }], x => { v.o2.clock = x; render(); }, 'o2c'));
      }
      const g = GROUPS[v.group];
      form.append(row1, row2, el('p', { class: 'small muted cb-help' }, ['Unit: ' + ENTRY[v.entry].unit + '. ', g.term ? SX.term(g.term, g.label) : g.label, ' · eligible = entered at least the window’s days before ' + U.fmtDate(SX.data.meta.asof) + ' (or measured from outcome 1 when chosen). ',
        SX.term('uc_within', 'How windows are counted')]));
    }
    let res = null, resSig = '';
    // memo keyed on the filters and the builder's settings: every card reads the same, current result
    const R = () => { const k = JSON.stringify(SX.state.get()) + JSON.stringify(v); if (!res || k !== resSig) { resSig = k; res = SX.cohorts(v); } return res; };
    const share = (k, n) => (n ? k / n : null);
    const fmtS = (k, n) => (n ? U.fmtPct(k / n, 1) + ' (' + U.fmtInt(k) + ' of ' + U.fmtInt(n) + ')' : '–');
    function drawSentence() {
      sentence.textContent = '';
      R();
      const s = v, t = res.total, o1 = OUT[s.o1.ev], o2 = s.o2 && OUT[s.o2.ev];
      const rng = (s.from ? U.fmtMonth(s.from) : 'the start of the data') + ' – ' + (s.to ? U.fmtMonth(s.to) : U.fmtDate(SX.data.meta.asof));
      const w1 = o1.state ? '(status today)' : s.o1.n === 'any' ? 'at any time so far' : 'within ' + s.o1.n + ' days';
      sentence.append(el('p', {}, [el('b', { text: U.fmtInt(t.entered) + ' ' + ENTRY[s.entry].unit }), ' entered, by ' + ENTRY[s.entry].by + ', ' + rng + '. ',
        el('b', { text: o1.label + ' ' + w1 + ': ' + fmtS(t.k1, t.el1) }), o1.state || s.o1.n === 'any' ? '' : ' — ' + U.fmtInt(t.entered - t.el1) + ' have not had ' + s.o1.n + ' days yet and are left out.']));
      if (o2) {
        const w2 = o2.state ? '(status today)' : s.o2.n === 'any' ? 'at any time so far' : 'within ' + s.o2.n + ' days' + (s.o2.clock === 'o1' && s.o2.base === 'o1' ? ' of outcome 1' : '');
        sentence.append(el('p', {}, [el('b', { text: o2.label + ' ' + w2 + ', among ' + (s.o2.base === 'o1' ? 'those who reached outcome 1' : 'everyone') + ': ' + fmtS(t.k2, t.el2) })]));
      }
      const thin = res.groups.filter(g => g.el1 < THIN && g.el1 > 0).length;
      if (thin) sentence.append(el('p', { class: 'small muted', text: thin + ' group(s) have fewer than ' + THIN + ' eligible records: shown, but too thin to compare on their own.' }));
    }
    const resCard = C.card(left, {
      id: 'cohort-results', title: 'Results by group', subtitle: 'Share of eligible records reaching each outcome · difference vs the whole cohort in percentage points', height: 380,
      tools: [el('button', { class: 'tool-btn', type: 'button', text: 'Download CSV', on: { click: () => R() && U.downloadCSV('strsearch-cohort-' + SX.data.meta.asof + '.csv', COLS(), rowsOut()) } })],
      render({ t }) {
        R();
        if (!res.groups.length) return { empty: true, emptyText: 'No records enter this cohort under the current choices.' };
        const top = res.groups.slice(0, 14).reverse();
        const o2 = v.o2 && OUT[v.o2.ev];
        const series = [C.bar(OUT[v.o1.ev].label, top.map(g => (g.el1 ? +(100 * g.k1 / g.el1).toFixed(1) : null)), t.series[0], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: p => (p.value == null ? '' : p.value + '%') } })];
        if (o2) series.push(C.bar(o2.label, top.map(g => (g.el2 ? +(100 * g.k2 / g.el2).toFixed(1) : null)), t.series[2], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: p => (p.value == null ? '' : p.value + '%') } }));
        return {
          height: Math.max(260, 60 + top.length * (o2 ? 38 : 26)),
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 48, top: 34, bottom: 6, containLabel: true },
            tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip((x, p) => { const g = top[p.dataIndex]; return x + '% · ' + (p.seriesIndex ? U.fmtInt(g.k2) + ' of ' + U.fmtInt(g.el2) : U.fmtInt(g.k1) + ' of ' + U.fmtInt(g.el1)); }) }),
            yAxis: C.catAxis(t, top.map(g => g.g)), xAxis: C.valAxis(t, { max: 100, fmt: x => x + '%' }), series }),
          table: { columns: COLS(), rows: rowsOut() },
          foot: res.groups.length > 14 ? 'The chart shows the 14 largest groups; the table lists all ' + res.groups.length + '.' : '',
        };
      },
    });
    function COLS() {
      const o2 = v.o2 && OUT[v.o2.ev];
      const c = [{ key: 'g', label: GROUPS[v.group].label }, { key: 'entered', label: 'Entered', num: true }, { key: 'el1', label: 'Eligible (1)', num: true }, { key: 'k1', label: 'Reached (1)', num: true },
        { key: 's1', label: OUT[v.o1.ev].label, num: true, fmt: x => (x == null ? '–' : U.fmtPct(x, 1)), csv: r => (r.s1 == null ? '' : (100 * r.s1).toFixed(1)) },
        { key: 'd1', label: 'vs all (pts)', num: true, fmt: x => (x == null ? '–' : (x > 0 ? '+' : '') + (100 * x).toFixed(1)), csv: r => (r.d1 == null ? '' : (100 * r.d1).toFixed(1)) }];
      if (o2) c.push({ key: 'el2', label: 'Eligible (2)', num: true }, { key: 'k2', label: 'Reached (2)', num: true },
        { key: 's2', label: o2.label, num: true, fmt: x => (x == null ? '–' : U.fmtPct(x, 1)), csv: r => (r.s2 == null ? '' : (100 * r.s2).toFixed(1)) },
        { key: 'd2', label: 'vs all (pts)', num: true, fmt: x => (x == null ? '–' : (x > 0 ? '+' : '') + (100 * x).toFixed(1)), csv: r => (r.d2 == null ? '' : (100 * r.d2).toFixed(1)) });
      c.push({ key: 'flag', label: 'Note' });
      return c;
    }
    function rowsOut() {
      const t = res.total, all1 = share(t.k1, t.el1), all2 = share(t.k2, t.el2);
      return res.groups.concat([Object.assign({}, t, { g: 'All (whole cohort)', __cls: 'row-total' })]).map(g => ({
        g: g.g, entered: g.entered, el1: g.el1, k1: g.k1, s1: share(g.k1, g.el1), d1: g.g.startsWith('All') || share(g.k1, g.el1) == null ? null : share(g.k1, g.el1) - all1,
        el2: g.el2, k2: g.k2, s2: share(g.k2, g.el2), d2: g.g.startsWith('All') || share(g.k2, g.el2) == null ? null : share(g.k2, g.el2) - all2,
        flag: g.el1 === 0 ? 'none eligible yet' : g.el1 < THIN ? 'thin (< ' + THIN + ' eligible)' : '', __cls: g.__cls || null }));
    }
    const matCard = C.card(right, {
      id: 'cohort-maturity', title: 'Which entry months have had enough time', subtitle: 'Share of each entry month eligible for outcome 1’s window', height: 380,
      render({ t }) {
        R();
        if (!res.months.length) return { empty: true };
        const ms = res.months;
        return {
          option: C.base(t, { grid: { left: 6, right: 30, top: 10, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip((x, p) => x + '% eligible · ' + ms[p.dataIndex].el1 + ' of ' + ms[p.dataIndex].n) }),
            yAxis: C.catAxis(t, ms.map(m => U.fmtMonth(m.m, true)).reverse()), xAxis: C.valAxis(t, { max: 100, fmt: x => x + '%' }),
            series: [C.bar('Eligible', ms.map(m => +(100 * m.el1 / m.n).toFixed(1)).reverse(), t.series[2], { horizontal: true, itemStyle: { color: p => (p.value >= 100 ? t.series[0] : t.series[1]), borderRadius: [0, 4, 4, 0] } })] }),
          table: { columns: [{ key: 'm', label: 'Entry month' }, { key: 'n', label: 'Entered', num: true }, { key: 'e', label: 'Eligible', num: true }, { key: 's', label: 'Share eligible', num: true, fmt: x => U.fmtPct(x) }],
            rows: ms.map(m => ({ m: U.fmtMonth(m.m), n: m.n, e: m.el1, s: m.el1 / m.n })) },
          foot: 'Green = every record in the month has had the window; amber = maturing (only the eligible part is counted).',
        };
      },
    });
    const kmCard = C.card(el('div', { class: 'mt-1' }), {
      id: 'cohort-km', title: 'Outcome 1 on the same clock, every record included', subtitle: 'Kaplan–Meier: records that have not reached it count until the data date · the 6 largest groups', height: 300,
      render({ t }) {
        R();
        if (!res.groups.length || OUT[v.o1.ev].state) return { empty: true, emptyText: 'Choose a timed outcome (not a status today) to see the curve.' };
        const top = res.groups.slice(0, 6), max = v.o1.n === 'any' ? 180 : Math.max(60, Math.min(365, v.o1.n * 2));
        const xs = []; for (let d = 0; d <= max; d += Math.max(1, Math.round(max / 60))) xs.push(d);
        const km = top.map(g => U.kaplanMeier(g.items));
        const cols = [t.series[0], t.series[1], t.series[2], t.series[3], t.series[4], t.deemph];
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 34, bottom: 22, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => x.toFixed(1) + '%', { title: p => 'Day ' + U.escapeHtml(p.axisValueLabel) }) }),
            xAxis: C.catAxis(t, xs, { boundaryGap: false, name: 'days since the entry event', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 } }), yAxis: C.valAxis(t, { min: 0, max: m => Math.min(100, Math.ceil((m.max + 5) / 10) * 10), fmt: x => x + '%' }),
            series: top.map((g, i) => C.line(g.g, xs.map(x => +(100 * U.kmAt(km[i].curve, x)).toFixed(1)), cols[i], { step: 'end' })) }),
          table: { columns: [{ key: 'g', label: 'Group' }, { key: 'n', label: 'Records', num: true }, { key: 'm', label: 'Half reached by', num: true }], rows: top.map((g, i) => ({ g: g.g, n: km[i].n, m: km[i].median == null ? 'not yet' : 'day ' + km[i].median })) },
        };
      },
    });
    left.append(kmCard.el);
    function render() {
      drawForm();
      drawSentence();
      resCard.invalidate(); matCard.invalidate(); kmCard.invalidate();
    }
    rerender = render;
    const hq = (location.hash.split('?')[1] || '').split('&').map(x => x.split('=')).find(x => x[0] === 'preset');
    if (hq && PRESETS[+hq[1]]) Object.assign(v, JSON.parse(JSON.stringify(PRESETS[+hq[1]].s)));
    render();
    SX.bus.on('filters', () => drawSentence());
  };
})();
