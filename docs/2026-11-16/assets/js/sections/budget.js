/* Section 3 · Budget performance (added 18 Nov 2026).
   How do clients on different budgets perform, especially up to $250K (discussed as HENRYs) vs above $250K?
   Budget = the onboarding form's all-in out-of-pocket capital range, read at its upper end (Carson's rule). The historical
   HENRY flag (Jira total_oop <= $225K) stays selectable for traceability. Population: won engagements with a confirmed Jira
   start, filtered by the bar above (period = client start date). Every window share counts only eligible clients (the whole
   window has passed). Like-for-like = Mantel-Haenszel risk difference across start month x client experience x start-date
   rule, with a 95% interval. Python reference: pipeline/budget.py; SX.parity() compares the two at default filters. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;
  const NR = 'Not recorded';
  const W = [14, 30, 45, 60, 90], CW = [60, 90, 120], RW = [14, 30, 60, 90];
  const THIN = 20;
  const HENRY = ['HENRY (total_oop ≤ $225K)', 'total_oop above $225K', 'total_oop not recorded'];

  /* ------------------------------------------------------------ shared calculations (parity + cohort builder use them) */
  const B = SX.budget = {};
  B.defs = () => {
    const b = SX.data.defs.budget || {};
    const present = (b.bands || []).filter(x => SX.data.eng.some(e => e.budget_band === x));
    return {
      cmp: { key: 'cmp', label: 'Up to $250K vs above $250K', col: 'budget_cmp', groups: (b.cmp || []).concat([NR]), pair: b.cmp || [] },
      strict: { key: 'strict', label: 'Strict: below / ends at / above $250K', col: 'budget_strict', groups: (b.strict || []).concat([NR]), pair: [(b.strict || [])[0], (b.strict || [])[2]], extra: [(b.strict || [])[1], (b.strict || [])[2]] },
      band: { key: 'band', label: 'Every budget range on the form', col: 'budget_band', groups: present.concat([NR]), pair: null },
      henry: { key: 'henry', label: 'HENRY: Jira total_oop ≤ $225K (Nov 16 Explorer)', col: null, groups: HENRY.slice(), pair: HENRY.slice(0, 2) },
    };
  };
  B.groupOf = (e, def) => {
    if (def.key === 'henry') return !e.oop_known ? HENRY[2] : e.henry ? HENRY[0] : HENRY[1];
    const v = e[def.col];
    return v == null ? NR : v;
  };
  B.prep = rows => {
    const asof = SX.data.asofDay;
    return rows.map(e => ({
      e, elapsed: asof - e.start_d,
      duc: e.uc_d != null && e.days_to_uc != null && e.days_to_uc >= 0 ? e.days_to_uc : null,
      dcl: e.closed_d != null ? e.closed_d - e.start_d : null,
      drf: e.refunded && e.refund_date_d != null ? e.refund_date_d - e.start_d : null,
      hunt: !!e.hunting,
      stratum: U.monthKeyFromDay(e.start_d) + '|' + (e.experience || 'Not tagged') + '|' + (e.start_rule || '?'),
    }));
  };
  const win = (g, key, w) => { let k = 0, n = 0; g.forEach(r => { if (r.elapsed >= w) { n++; const d = r[key]; if (d != null && d >= 0 && d <= w) k++; } }); return { k, eligible: n }; };
  const st = arr => { const v = arr.filter(x => x != null); return { n: v.length, mean: v.length ? +U.mean(v).toFixed(2) : null, median: v.length ? U.median(v) : null }; };
  B.metrics = g => {
    const asof = SX.data.asofDay, o = { n: g.length };
    W.forEach(w => { o['uc' + w] = win(g, 'duc', w); });
    CW.forEach(w => { o['cl' + w] = win(g, 'dcl', w); });
    RW.forEach(w => { o['rf' + w] = win(g, 'drf', w); });
    o.recorded = st(g.map(r => r.duc));
    o.uc_to_close = st(g.map(r => (r.e.closed_d != null && r.e.uc_d != null && r.e.closed_d - r.e.uc_d >= 0 ? r.e.closed_d - r.e.uc_d : null)));
    o.scenario = st(g.map(r => (r.hunt ? asof + 1 - r.e.start_d : r.duc)));
    o.km_uc = U.kaplanMeier(g.map(r => ({ t: r.e.uc_d != null ? r.e.days_to_uc : r.elapsed, e: r.e.uc_d != null }))).median;
    o.km_closed = U.kaplanMeier(g.map(r => ({ t: r.e.closed_d != null ? r.dcl : r.elapsed, e: r.e.closed_d != null }))).median;
    o.stages = {}; g.forEach(r => { const s = r.e.stage || 'no_jira'; o.stages[s] = (o.stages[s] || 0) + 1; });
    o.closed = g.filter(r => r.e.closed_d != null).length;
    o.hunting = g.filter(r => r.hunt).length;
    const hw = g.filter(r => r.hunt).map(r => r.elapsed);
    o.hunting_wait = { median: hw.length ? U.median(hw) : null, mean: hw.length ? +U.mean(hw).toFixed(2) : null };
    return o;
  };
  /** Mantel-Haenszel risk difference (a - b) for "event within w days", strata = start month x experience x start rule */
  B.mh = (prep, def, a, b, key, w) => {
    const strata = new Map();
    prep.forEach(r => { if (r.elapsed < w) return; const g = B.groupOf(r.e, def); if (g !== a && g !== b) return; if (!strata.has(r.stratum)) strata.set(r.stratum, { a: [0, 0], b: [0, 0] }); const c = strata.get(r.stratum)[g === a ? 'a' : 'b']; c[1]++; const d = r[key]; if (d != null && d >= 0 && d <= w) c[0]++; });
    let num = 0, den = 0, v = 0; const ta = [0, 0], tb = [0, 0], cells = [];
    Array.from(strata.keys()).sort().forEach(s => {
      const x = strata.get(s);
      if (!x.a[1] || !x.b[1]) return;
      const na = x.a[1], nb = x.b[1], pa = x.a[0] / na, pb = x.b[0] / nb, wgt = na * nb / (na + nb);
      num += wgt * (pa - pb); den += wgt; v += wgt * wgt * (pa * (1 - pa) / na + pb * (1 - pb) / nb);
      ta[0] += x.a[0]; ta[1] += na; tb[0] += x.b[0]; tb[1] += nb;
      cells.push({ stratum: s, a: x.a.slice(), b: x.b.slice() });
    });
    if (!den) return { w, strata: 0, diff: null, lo: null, hi: null, a: ta, b: tb, thin: true, cells };
    const rd = num / den, se = Math.sqrt(v) / den, r4 = x => Math.round(x * 1e4) / 1e4;
    return { w, strata: cells.length, diff: r4(rd), lo: r4(rd - 1.96 * se), hi: r4(rd + 1.96 * se), a: ta, b: tb, thin: ta[1] < THIN || tb[1] < THIN, cells };
  };
  B.all = (rows, def) => {
    const prep = B.prep(rows), by = new Map(def.groups.map(g => [g, []]));
    prep.forEach(r => { const g = B.groupOf(r.e, def); if (!by.has(g)) by.set(g, []); by.get(g).push(r); });
    return { prep, by, metrics: new Map(Array.from(by.entries()).map(([g, arr]) => [g, B.metrics(arr)])) };
  };
  B.verdict = m => (m.diff == null || m.thin ? 'too few eligible clients to tell' : m.lo <= 0 && m.hi >= 0 ? 'no measurable difference' : m.diff > 0 ? 'higher' : 'lower');

  /* ------------------------------------------------------------ helpers */
  const pts = v => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v * 100).toFixed(1) + ' pts');
  const share = c => (c && c.eligible ? c.k / c.eligible : null);
  const kn = c => (c ? U.fmtInt(c.k) + ' of ' + U.fmtInt(c.eligible) : '–');
  const ci = m => (m.lo == null ? '' : '95% ' + pts(m.lo).replace(' pts', '') + ' to ' + pts(m.hi));
  function ramp(t, i, n) {
    const a = t.seq[2], b = t.seq[7];
    const p = n <= 1 ? 1 : i / (n - 1);
    const h = s => [1, 3, 5].map(j => parseInt(s.slice(j, j + 2), 16));
    if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return t.series[0];
    const x = h(a), y = h(b);
    return '#' + x.map((v, j) => Math.round(v + (y[j] - v) * p).toString(16).padStart(2, '0')).join('');
  }
  B.color = (t, def, g) => {
    if (g === NR || g === HENRY[2]) return t.deemph;
    if (def.key === 'band') { const gs = def.groups.filter(x => x !== NR); return ramp(t, gs.indexOf(g), gs.length); }
    return ({ 'Up to $250K': t.series[1], 'Below $250K': t.series[1], 'Range ends at $250K': t.series[4], 'Above $250K': t.series[0],
      [HENRY[0]]: t.series[3], [HENRY[1]]: t.series[2] })[g] || t.deemph;
  };
  const STAGES = [['purchased', 'Completed purchase'], ['under_contract', 'Under contract'], ['hunting', 'Hunting'], ['paused', 'Paused'], ['additional', 'Additional Service'], ['refunded', 'Refunded']];

  /* ------------------------------------------------------------ section */
  SX.sections.budget = function (root) {
    const D = SX.data, bmeta = D.defs.budget || {}, form = bmeta.form || {}, cov = (D.expected.budget || {}).coverage || {};
    const v = { def: 'cmp', nr: true };
    const hq = (location.hash.split('?')[1] || '').split('&').map(x => x.split('=')).find(x => x[0] === 'budget');
    if (hq && ['cmp', 'strict', 'band', 'henry'].includes(hq[1])) v.def = hq[1];

    SX.head(root, 'budget', 'Section 3 · Budget performance', 'How do clients on different budgets perform?',
      'Up to $250K (the clients discussed as HENRYs) against above $250K, on the same clock: under contract within 14 days first, then 30, 45, 60 and 90 days, time to contract and to close, where clients stand today, and a like-for-like check within the same start months. Filters above apply (period = client start date).');
    const defbar = el('div', { class: 'defbar' });
    defbar.append(el('div', {}, [el('b', { text: 'Budget: ' }), SX.term('budget', 'onboarding-form range, upper end'),
      ' — the client’s answer to “' + (form.field || 'Total out-of-pocket capital available (all-in)') + '” (form column ' + (form.column || 'M') + ', live since ' + U.fmtDate(form.since) + '). It measures ' + (form.measures || 'all-in capital') + '. Threshold: $' + (form.threshold_k || 250) + 'K. ',
      SX.term('budget_strict', 'Strict comparison'), ' keeps the $200K–$250K range on its own.']),
      el('div', {}, [el('b', { text: 'Coverage: ' }), U.fmtInt(form.since_form_matched) + ' of the ' + U.fmtInt(form.since_form) + ' confirmed starts since the form went live are matched; ' + U.fmtInt(cov.not_recorded) + ' confirmed starts have no budget (' + U.fmtInt(cov.not_recorded_before_form) + ' started before the form). They stay visible as “Not recorded”. Historical definition: ', SX.term('henry', 'HENRY = Jira total_oop ≤ $225K'), '.']));
    root.append(defbar);

    const ctl = el('div', { class: 'control-row' });
    root.append(ctl);
    const DEF = B.defs();
    ctl.append(SX.ui.seg('Compare', Object.values(DEF).map(d => ({ value: d.key, label: ({ cmp: 'Up to $250K vs above', strict: 'Strict: below / ends at / above $250K', band: 'Every budget range', henry: 'HENRY (total_oop ≤ $225K)' })[d.key], title: d.label })), v.def, x => { v.def = x; redraw(); }),
      SX.ui.seg('Not recorded', [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }], 'show', x => { v.nr = x === 'show'; redraw(); }),
      el('a', { class: 'tool-btn link-btn', href: '#cohorts', text: 'Compare other outcomes in the cohort builder →', on: { click: () => SX.cohortsPreset && SX.cohortsPreset({ entry: 'start', group: v.def === 'henry' ? 'henry' : 'budget_' + v.def, o1: { ev: 'uc', n: 14 }, o2: { ev: 'closed', n: 90 } }) } }));

    const answer = el('div', { class: 'verdict', 'aria-live': 'polite' });
    root.append(answer);
    const kpis = el('div', { class: 'kpi-row budget-kpis' });
    root.append(kpis);

    let cur = null, sig = '';
    function compute() {
      const def = B.defs()[v.def];
      const rows = SX.model.eng({ population: 'confirmed' });
      const res = B.all(rows, def);
      const groups = def.groups.filter(g => (v.nr || (g !== NR && g !== HENRY[2])) && (res.by.get(g) || []).length);
      cur = { def, res, groups };
      return cur;
    }
    // memo keyed on the filters and the controls, so every card reads the same, current computation
    const get = () => { const s = JSON.stringify(SX.state.get()) + v.def + v.nr; if (!cur || s !== sig) { sig = s; compute(); } return cur; };

    function drawAnswer() {
      const { def, res, groups } = get();
      answer.textContent = '';
      kpis.textContent = '';
      groups.forEach(g => {
        const m = res.metrics.get(g), c = m.uc14;
        SX.ui.kpi(kpis, { label: g, value: U.fmtPct(share(c), 1), unit: 'UC ≤ 14 d', sub: kn(c) + ' eligible · ' + U.fmtInt(m.n) + ' started · median ' + U.fmtMed(m.recorded.median) + ' d to UC', title: 'Under contract within 14 days of the client start date, among clients who have had 14 days' });
        kpis.lastChild.style.borderTop = '3px solid ' + B.color(SX.theme.tokens(), def, g);
      });
      if (!def.pair) {
        const sh = groups.filter(g => g !== NR).map(g => ({ g, s: share(res.metrics.get(g).uc14), n: res.metrics.get(g).uc14.eligible }));
        const ok = sh.filter(x => x.s != null);
        if (!ok.length) { answer.append(el('p', { text: 'No eligible clients under the current filters.' })); return; }
        const lo = ok.reduce((a, b) => (b.s < a.s ? b : a)), hi = ok.reduce((a, b) => (b.s > a.s ? b : a));
        answer.append(el('h3', { text: 'Every range on the form' }), el('p', { text: 'Under contract within 14 days ranges from ' + U.fmtPct(lo.s, 1) + ' (' + lo.g + ', ' + lo.n + ' eligible) to ' + U.fmtPct(hi.s, 1) + ' (' + hi.g + ', ' + hi.n + ' eligible). Ranges with fewer than ' + THIN + ' eligible clients are too small to read on their own; use the two-group comparisons for the answer.' }));
        return;
      }
      const [a, b] = def.pair, ma = res.metrics.get(a), mb = res.metrics.get(b);
      if (!ma || !mb || !ma.n || !mb.n) { answer.append(el('p', { text: 'Both groups need clients under the current filters.' })); return; }
      const m14 = B.mh(res.prep, def, a, b, 'duc', 14);
      const later = [30, 45, 60, 90].map(w => B.mh(res.prep, def, a, b, 'duc', w));
      const cl = CW.map(w => B.mh(res.prep, def, a, b, 'dcl', w));
      const rf = RW.map(w => B.mh(res.prep, def, a, b, 'drf', w));
      const clear = arr => arr.filter(m => m.diff != null && !m.thin && (m.lo > 0 || m.hi < 0));
      const crude = share(ma.uc14) - share(mb.uc14);
      answer.append(el('h3', { text: 'First 14 days: ' + (B.verdict(m14) === 'no measurable difference' ? 'no measurable difference' : a + ' ' + B.verdict(m14)) }));
      answer.append(el('p', {}, [el('b', { text: a + ': ' + U.fmtPct(share(ma.uc14), 1) }), ' under contract within 14 days (' + kn(ma.uc14) + ' eligible) against ', el('b', { text: b + ': ' + U.fmtPct(share(mb.uc14), 1) }), ' (' + kn(mb.uc14) + '), ' + pts(crude) + '. ',
        SX.term('likeforlike', 'Like-for-like'), ' (same start month, client experience and start-date rule; ' + m14.strata + ' strata): ', el('b', { text: pts(m14.diff) }), ' (' + ci(m14) + ').']));
      const lw = later.map(m => m.w + ' d ' + pts(m.diff)).join(' · ');
      const lc = clear(later);
      answer.append(el('p', { text: 'Later windows, like-for-like: ' + lw + '. ' + (lc.length ? 'Clear of zero at ' + lc.map(m => m.w + ' days').join(' and ') + '.' : 'None is clear of zero: ' + (crude < 0 ? 'no sign that ' + a + ' starts slower and catches up; ' : '') + 'no persistent gap.') }));
      const cc = clear(cl), rc = clear(rf);
      answer.append(el('p', { text: 'Closings within 60 / 90 / 120 days: ' + cl.map(m => pts(m.diff)).join(' / ') + (cc.length ? ' (clear at ' + cc.map(m => m.w + ' d').join(', ') + ').' : ', no measurable difference.') + ' Refunds within 14 / 30 / 60 / 90 days: ' + rf.map(m => pts(m.diff)).join(' / ') + (rc.length ? ' — clients ' + (/^(Up to|Below|Above)/.test(a) ? a.replace(/^Up to/, 'up to').replace(/^Below/, 'below').replace(/^Above/, 'above') : 'in ' + a) + ' refund ' + (rc[0].diff > 0 ? 'more' : 'less') + ' often, clear of zero at ' + rc.map(m => m.w + ' d').join(' and ') + ' (e.g. ' + rc[0].w + ' days: ' + U.fmtPct(rc[0].a[0] / rc[0].a[1], 1) + ' vs ' + U.fmtPct(rc[0].b[0] / rc[0].b[1], 1) + ', ' + ci(rc[0]) + ').' : ', no measurable difference.') }));
      if (def.extra) {
        const e14 = B.mh(res.prep, def, def.extra[0], def.extra[1], 'duc', 14), me = res.metrics.get(def.extra[0]);
        if (me) answer.append(el('p', { text: def.extra[0] + ' ($200K–$250K, a range rather than an amount): ' + U.fmtPct(share(me.uc14), 1) + ' within 14 days (' + kn(me.uc14) + '); like-for-like against ' + def.extra[1] + ' ' + pts(e14.diff) + ' (' + ci(e14) + ').' }));
      }
      if (def.key === 'henry') answer.append(el('p', { class: 'warn-line', text: 'Caution: total_oop is recorded for ' + U.fmtInt(cov.henry_known_with_uc) + ' of ' + U.fmtInt(cov.with_uc) + ' clients with a contract but only ' + U.fmtInt(cov.henry_known_hunting) + ' of ' + U.fmtInt(cov.hunting) + ' hunting clients, so this definition compares mostly clients who already bought. It is kept for traceability; use the onboarding budget for speed.' }));
      answer.append(el('p', { class: 'small muted', text: 'Population: confirmed starts in the current filters. Shares count only clients who have had the whole window. Differences are associations, not causes; “no measurable difference” means the 95% interval includes zero, not that the groups are identical.' }));
    }

    /* cards */
    const g1 = el('div', { class: 'grid grid-2 mt-2' });
    root.append(g1);
    const cards = [];
    cards.push(C.card(g1, {
      id: 'budget-windows', title: 'Under Contract within 14, 30, 45, 60 and 90 days', subtitle: 'Share of eligible clients (the whole window has passed) · bars by budget group', height: 320,
      render({ t }) {
        const { def, res, groups } = get();
        if (!groups.length) return { empty: true };
        const series = groups.map(g => C.bar(g, W.map(w => { const c = res.metrics.get(g)['uc' + w]; return c.eligible ? +(100 * c.k / c.eligible).toFixed(1) : null; }), B.color(t, def, g)));
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip((x, p) => x.toFixed(1) + '% · ' + kn(res.metrics.get(p.seriesName)['uc' + W[p.dataIndex]])) }),
            xAxis: C.catAxis(t, W.map(w => 'within ' + w + ' d')), yAxis: C.valAxis(t, { max: 100, fmt: x => x + '%' }), series }),
          table: { columns: [{ key: 'g', label: 'Budget group' }, { key: 'n', label: 'Started', num: true }].concat(W.map(w => ({ key: 'w' + w, label: '≤ ' + w + ' d', num: true, sort: r => r['s' + w], fmt: (x, r) => x }))),
            rows: groups.map(g => { const m = res.metrics.get(g), r = { g, n: m.n }; W.forEach(w => { const c = m['uc' + w]; r['w' + w] = c.eligible ? U.fmtPct(c.k / c.eligible, 1) + ' (' + kn(c) + ')' : 'not mature'; r['s' + w] = share(c); }); return r; }) },
          foot: 'Eligible = clients whose start is at least N days before the data date; the rest are still maturing and are not counted in that window. Latest valid Under Contract date.',
        };
      },
    }));
    cards.push(C.card(g1, {
      id: 'budget-km', title: 'Share under contract by day since the client start date', subtitle: 'Kaplan–Meier: clients still waiting count until the data date · shows whether a group starts slower and catches up', height: 320,
      render({ t }) {
        const { def, res, groups } = get();
        if (!groups.length) return { empty: true };
        const xs = []; for (let d = 0; d <= 150; d += 3) xs.push(d);
        const km = new Map(groups.map(g => [g, U.kaplanMeier((res.by.get(g) || []).map(r => ({ t: r.e.uc_d != null ? r.e.days_to_uc : r.elapsed, e: r.e.uc_d != null })))]));
        const series = groups.map(g => C.line(g, xs.map(x => +(100 * U.kmAt(km.get(g).curve, x)).toFixed(1)), B.color(t, def, g), { step: 'end' }));
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 34, bottom: 22, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => x.toFixed(1) + '%', { title: p => 'Day ' + U.escapeHtml(p.axisValueLabel) }) }),
            xAxis: C.catAxis(t, xs, { boundaryGap: false, name: 'days since client start date', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 }, axisLabel: { color: t.label, interval: 9 } }),
            yAxis: C.valAxis(t, { max: 100, fmt: x => x + '%' }), series }),
          table: { columns: [{ key: 'g', label: 'Budget group' }, { key: 'n', label: 'Started', num: true }].concat([14, 30, 45, 60, 90, 120].map(d => ({ key: 'd' + d, label: 'Day ' + d, num: true, fmt: x => x == null ? '–' : x.toFixed(1) + '%' }))).concat([{ key: 'med', label: 'Half reached UC by', num: true, fmt: x => x == null ? 'not yet' : 'day ' + x }]),
            rows: groups.map(g => { const k = km.get(g), r = { g, n: k.n, med: k.median }; [14, 30, 45, 60, 90, 120].forEach(d => { r['d' + d] = 100 * U.kmAt(k.curve, d); }); return r; }) },
          foot: 'Curves that run together and stay together mean no gap; a lower curve that meets the other later means a slower start that catches up.',
        };
      },
    }));
    cards.push(C.card(g1, {
      id: 'budget-time', title: 'Days to Under Contract and to close, recorded and “UC tomorrow”', subtitle: 'Medians by group · the table adds averages, UC → close, Kaplan–Meier and completed purchases', height: 320,
      render({ t }) {
        const { def, res, groups } = get();
        if (!groups.length) return { empty: true };
        const m = g => res.metrics.get(g);
        const series = [C.bar('Recorded median', groups.map(g => m(g).recorded.median), t.series[2]), C.bar('UC tomorrow (scenario) median', groups.map(g => m(g).scenario.median), t.deemph),
          C.bar('Kaplan–Meier median', groups.map(g => m(g).km_uc), t.series[4]), C.bar('UC → close median', groups.map(g => m(g).uc_to_close.median), t.series[0])];
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => U.fmtMed(x) + ' days') }), xAxis: C.catAxis(t, groups), yAxis: C.valAxis(t, { fmt: x => x + ' d' }), series }),
          table: { columns: [{ key: 'g', label: 'Budget group' }, { key: 'n', label: 'Started', num: true },
            { key: 'rec', label: 'To UC: n · avg · median (recorded)' }, { key: 'scn', label: 'UC tomorrow: avg · median' }, { key: 'km', label: 'KM median UC / CLOSED', num: true },
            { key: 'u2c', label: 'UC → close: n · avg · median' }, { key: 'cl', label: 'Closed ≤ 60 / 90 / 120 d' }, { key: 'pur', label: 'Completed purchase now', num: true, sort: r => r.purS }],
            rows: groups.map(g => { const x = m(g); return { g, n: x.n, rec: U.fmtInt(x.recorded.n) + ' · ' + U.fmt1(x.recorded.mean) + ' · ' + U.fmtMed(x.recorded.median), scn: U.fmt1(x.scenario.mean) + ' · ' + U.fmtMed(x.scenario.median),
              km: (x.km_uc == null ? 'not yet' : x.km_uc) + ' / ' + (x.km_closed == null ? 'not yet' : x.km_closed), u2c: U.fmtInt(x.uc_to_close.n) + ' · ' + U.fmt1(x.uc_to_close.mean) + ' · ' + U.fmtMed(x.uc_to_close.median),
              cl: CW.map(w => (x['cl' + w].eligible ? U.fmtPct(x['cl' + w].k / x['cl' + w].eligible) : '–')).join(' / '), pur: U.fmtPct((x.stages.purchased || 0) / x.n) + ' (' + (x.stages.purchased || 0) + ')', purS: (x.stages.purchased || 0) / x.n }; }) },
          foot: 'Recorded = clients who reached Under Contract. ' + '“UC tomorrow” (' + 'scenario' + '): every hunting client counts as going under contract the day after the data date, pooled once per search with everyone else’s recorded days — a floor, not a forecast. Kaplan–Meier counts clients still waiting until the data date.',
        };
      },
    }));
    cards.push(C.card(g1, {
      id: 'budget-stages', title: 'Where each group stands today', subtitle: 'Status first: completed purchase, under contract, hunting, paused, Additional Service, refunded · share of each group', height: 320,
      render({ t }) {
        const { def, res, groups } = get();
        if (!groups.length) return { empty: true };
        const cols = [t.series[0], t.series[2], t.series[1], t.deemph, t.deemph2, t.series[3]];
        const rev = groups.slice().reverse();
        const series = STAGES.map(([k, lab], i) => C.stackBar(lab, rev.map(g => { const m = res.metrics.get(g); return +(100 * (m.stages[k] || 0) / m.n).toFixed(1); }), cols[i], 's', t, { barMaxWidth: 22 }));
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 40, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip((x, p) => x.toFixed(1) + '% · ' + (res.metrics.get(rev[p.dataIndex]).stages[STAGES[p.seriesIndex][0]] || 0) + ' clients') }),
            yAxis: C.catAxis(t, rev), xAxis: C.valAxis(t, { max: 100, fmt: x => x + '%' }), series }),
          table: { columns: [{ key: 'g', label: 'Budget group' }, { key: 'n', label: 'Started', num: true }].concat(STAGES.map(([k, lab]) => ({ key: k, label: lab, num: true }))).concat([{ key: 'hw', label: 'Hunting: median days waiting', num: true }]),
            rows: groups.map(g => { const m = res.metrics.get(g), r = { g, n: m.n, hw: m.hunting_wait.median == null ? '–' : U.fmtMed(m.hunting_wait.median) }; STAGES.forEach(([k]) => { r[k] = (m.stages[k] || 0) + ' (' + U.fmtPct((m.stages[k] || 0) / m.n) + ')'; }); return r; }) },
          foot: 'A snapshot: recent starters have had less time, so compare shares only between groups that started in similar months (like-for-like table below). Pre-sale or missing Jira issues are not shown as a stage.',
        };
      },
    }));
    cards.push(C.card(g1, {
      id: 'budget-refunds', title: 'Refunded within 14, 30, 60 and 90 days', subtitle: 'Share of eligible clients · refund date = when the Jira status changed to Refunded', height: 300,
      render({ t }) {
        const { def, res, groups } = get();
        if (!groups.length) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip((x, p) => x.toFixed(1) + '% · ' + kn(res.metrics.get(p.seriesName)['rf' + RW[p.dataIndex]])) }),
            xAxis: C.catAxis(t, RW.map(w => 'within ' + w + ' d')), yAxis: C.valAxis(t, { fmt: x => x + '%' }),
            series: groups.map(g => C.bar(g, RW.map(w => { const c = res.metrics.get(g)['rf' + w]; return c.eligible ? +(100 * c.k / c.eligible).toFixed(1) : null; }), B.color(t, def, g))) }),
          table: { columns: [{ key: 'g', label: 'Budget group' }].concat(RW.map(w => ({ key: 'r' + w, label: '≤ ' + w + ' d' }))),
            rows: groups.map(g => { const m = res.metrics.get(g), r = { g }; RW.forEach(w => { const c = m['rf' + w]; r['r' + w] = c.eligible ? U.fmtPct(c.k / c.eligible, 1) + ' (' + kn(c) + ')' : '–'; }); return r; }) },
          foot: 'Refund date is a status proxy (the last change to Refunded), not a payment date. Refunds cluster early: the median refund comes about two weeks after the start.',
        };
      },
    }));

    /* like-for-like table */
    const lfl = el('div', { class: 'card card-pad lfl span-all', id: 'budget-likeforlike' });
    g1.append(lfl);
    function drawLfl() {
      const { def, res } = get();
      lfl.textContent = '';
      lfl.append(el('h3', { class: 'card-title' }, ['Like-for-like: same start month, client experience and start-date rule · ', SX.term('likeforlike', 'how it is computed')]));
      if (!def.pair) { lfl.append(el('p', { class: 'muted', text: 'Choose a two-group comparison (up to vs above $250K, strict, or HENRY) to see the like-for-like check.' })); return; }
      const [a, b] = def.pair;
      lfl.append(el('p', { class: 'card-subtitle', text: a + ' minus ' + b + ', in percentage points. Each stratum pairs clients who started in the same month under the same experience and rule; strata with only one group are left out.' }));
      const rows = [];
      [['Under contract', 'duc', W], ['Closed', 'dcl', CW], ['Refunded', 'drf', RW]].forEach(([lab, key, ws]) => ws.forEach(w => {
        const m = B.mh(res.prep, def, a, b, key, w);
        rows.push({ o: lab + ' within ' + w + ' d', a: m.a[1] ? U.fmtPct(m.a[0] / m.a[1], 1) + ' (' + m.a[0] + '/' + m.a[1] + ')' : '–', b: m.b[1] ? U.fmtPct(m.b[0] / m.b[1], 1) + ' (' + m.b[0] + '/' + m.b[1] + ')' : '–',
          d: m.diff, ci: ci(m), s: m.strata, v: B.verdict(m), m });
      }));
      lfl.append(SX.ui.table({ sortable: false, columns: [{ key: 'o', label: 'Outcome' }, { key: 'a', label: a + ' (eligible in shared strata)' }, { key: 'b', label: b }, { key: 'd', label: 'Like-for-like difference', num: true, fmt: x => pts(x) },
        { key: 'ci', label: '95% interval' }, { key: 's', label: 'Strata', num: true }, { key: 'v', label: 'Reading', html: (x, r) => el('span', { class: 'reading reading--' + (x === 'no measurable difference' ? 'none' : x.startsWith('too') ? 'thin' : 'diff'), text: x }) }], rows }));
      const det = el('details', { class: 'drill' }, [el('summary', { text: 'Show the strata behind the 14-day comparison (start month · experience · start rule)' })]);
      const m14 = B.mh(res.prep, def, a, b, 'duc', 14);
      det.append(SX.ui.table({ sortable: false, columns: [{ key: 's', label: 'Stratum' }, { key: 'a', label: a + ': UC ≤ 14 d / eligible' }, { key: 'b', label: b + ': UC ≤ 14 d / eligible' }],
        rows: m14.cells.map(c => ({ s: c.stratum.replace(/\|/g, ' · '), a: c.a[0] + ' / ' + c.a[1], b: c.b[0] + ' / ' + c.b[1] })) }));
      lfl.append(det);
      lfl.append(el('p', { class: 'small muted', text: 'The onboarding form went live on 20 Apr 2026, so matched clients started from late April: nearly all under the won-date start rule, most under the New Client Experience. “Too few eligible clients” = fewer than ' + THIN + ' eligible in either group across the shared strata.' }));
    }

    /* fall-through, repeats and STR Cribs by budget */
    const ev = el('div', { class: 'card card-pad span-all', id: 'budget-evidence' });
    g1.append(ev);
    function drawEv() {
      const { def, res, groups } = get();
      ev.textContent = '';
      ev.append(el('h3', { class: 'card-title', text: 'Contract fall-through, repeat searches and STR Cribs by budget' }),
        el('p', { class: 'card-subtitle', text: 'Counts per group, where the records allow · small numbers are marked' }));
      const rows = groups.map(g => {
        const arr = (res.by.get(g) || []).map(r => r.e), known = arr.filter(e => e.fallout != null);
        const fell = arr.filter(e => ['documented', 'ended', 'returned'].includes(e.fallout)).length, back = arr.filter(e => e.fallout === 'returned').length;
        const bought = arr.filter(e => e.stage === 'purchased');
        const cribsSel = bought.filter(e => e.cribs).length, cribsHand = bought.filter(e => e.cribs_tracker === 'Handed off to PM').length;
        return { g, n: arr.length, known: known.length, fell, fellS: known.length ? fell / known.length : null, back, rep: arr.filter(e => e.search_no > 1).length, rep2: arr.filter(e => e.purchase_no > 1).length,
          bought: bought.length, cribsSel, cribsHand };
      });
      const small = x => (x > 0 && x < 5 ? el('span', { class: 'small-n', title: 'Fewer than 5: read with care', text: U.fmtInt(x) + '*' }) : U.fmtInt(x));
      ev.append(SX.ui.table({ columns: [{ key: 'g', label: 'Budget group' }, { key: 'n', label: 'Started', num: true },
        { key: 'fell', label: 'Fell through (any evidence) / known UC', num: true, sort: r => r.fellS, html: (x, r) => el('span', {}, [small(r.fell), ' / ' + U.fmtInt(r.known) + (r.fellS != null ? ' · ' + U.fmtPct(r.fellS) : '')]) },
        { key: 'back', label: 'Back under contract after a search', num: true, html: x => small(x) },
        { key: 'rep', label: 'Repeat search (2nd+ won deal)', num: true, html: x => small(x) }, { key: 'rep2', label: '2nd+ completed purchase', num: true, html: x => small(x) },
        { key: 'bought', label: 'Completed purchases', num: true }, { key: 'cribsSel', label: 'STR Cribs selected', num: true, html: (x, r) => el('span', {}, [small(x), r.bought ? ' · ' + U.fmtPct(x / r.bought) : '']) },
        { key: 'cribsHand', label: 'Cribs handoff verified', num: true, html: (x, r) => el('span', {}, [small(x), r.bought ? ' · ' + U.fmtPct(x / r.bought) : '']) }], rows }),
        el('p', { class: 'small muted', text: 'Fall-through evidence comes from the 12 Nov Jira extract (documented fall-out address, a contract that ended without a purchase, or back under contract after a search); only 12 fall-outs are documented in all of Jira, so these are floors. Cribs selected = Jira Designer Used is STR Cribs (a recorded choice); handoff verified = a Cribs deal at the purchase address in “Handed off to PM”. * fewer than 5.' }),
        el('div', { class: 'link-row' }, [el('a', { href: '#fallthrough', text: 'Fall-through detail →' }), el('a', { href: '#repeats', text: 'Repeat clients →' }), el('a', { href: '#cribs', text: 'STR Cribs →' })]));
    }

    function redraw() { drawAnswer(); cards.forEach(c => c.invalidate()); drawLfl(); drawEv(); }
    drawAnswer(); drawLfl(); drawEv();
    SX.bus.on('filters', () => { drawAnswer(); drawLfl(); drawEv(); });
    SX.bus.on('theme', () => drawAnswer());
  };
})();
