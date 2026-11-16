/* The three key acquisition questions (16 Nov 2026 reporting layer) + metric parity check (browser vs Python build).
   Populations are never mixed: Q1 uses won engagements with a confirmed Jira start (client_cohort_performance),
   Q2 uses Jira issues (reporting-layer flags), Q3 uses events by the date they happened (daily_client_activity). */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;
  const calc = () => SX.calc;

  SX.sections.questions = function (root) {
    SX.head(root, 'questions', 'Section 2 · Key questions', 'The three key acquisition questions, answered with the reporting-layer definitions',
      'Durations run from client_start_date to the latest valid Under Contract date and to the closing date. Closings dated after the data date are scheduled, not closed. Filters above apply: period = client_start_date (event date for Q3).');

    /* ---------------- Q1 ---------------- */
    const v1 = { era: 'all' };
    const q1 = el('div', { class: 'question', id: 'q1' });
    root.append(q1);
    q1.append(el('div', { class: 'q-head' }, [el('div', { class: 'q-num', text: '1' }), el('div', {}, [
      el('h3', { text: 'How long do clients take to reach Under Contract and CLOSED?' }),
      el('p', { text: 'Average and median days from client_start_date to property_uc_date (the latest valid contract) and to property_closed_date, for won engagements with a confirmed Jira start. Days = milestone date − client start date.' })])]));
    const ctl1 = el('div', { class: 'control-row' });
    q1.append(ctl1);
    const tiles1 = el('div', { class: 'answer' });
    q1.append(tiles1);
    const g1 = el('div', { class: 'grid grid-2' });
    q1.append(g1);

    function q1rows() {
      const rows = SX.model.eng({ population: 'confirmed' });
      if (v1.era === 'pre') return rows.filter(e => e.start_rule !== 'won');
      if (v1.era === 'post') return rows.filter(e => e.start_rule === 'won');
      return rows;
    }
    function drawTiles1() {
      tiles1.textContent = '';
      const rows = q1rows();
      const uc = calc().stats(rows.map(e => calc().days(e, 'uc'))), cl = calc().stats(rows.map(e => calc().days(e, 'closed')));
      const kmU = calc().km(rows, 'uc'), kmC = calc().km(rows, 'closed');
      SX.ui.kpi(tiles1, { cls: 'kpi--accent', label: 'Median days to Under Contract', value: U.fmtMed(uc.median), unit: 'days', sub: 'Mean ' + U.fmt1(uc.mean) + ' · p25–p75 ' + U.fmtInt(uc.p25) + '–' + U.fmtInt(uc.p75) + ' · n = ' + U.fmtInt(uc.n) });
      SX.ui.kpi(tiles1, { cls: 'kpi--accent', label: 'Median days to CLOSED', value: U.fmtMed(cl.median), unit: 'days', sub: 'Mean ' + U.fmt1(cl.mean) + ' · p25–p75 ' + U.fmtInt(cl.p25) + '–' + U.fmtInt(cl.p75) + ' · n = ' + U.fmtInt(cl.n) });
      SX.ui.kpi(tiles1, { label: 'Half of started clients reach UC by', value: kmU.median == null ? 'not yet' : 'day ' + U.fmtInt(kmU.median), sub: 'Kaplan-Meier on ' + U.fmtInt(kmU.n) + ' confirmed starts, counting the ' + U.fmtInt(kmU.n - kmU.events) + ' still without UC' });
      SX.ui.kpi(tiles1, { label: 'Half of started clients reach CLOSED by', value: kmC.median == null ? 'not yet' : 'day ' + U.fmtInt(kmC.median), sub: 'Kaplan-Meier, counting the ' + U.fmtInt(kmC.n - kmC.events) + ' still without a completed closing' });
    }
    ctl1.append(SX.ui.seg('Start-date era', [{ value: 'all', label: 'All confirmed starts' }, { value: 'pre', label: 'Created before 1 Jun 2026 (due date)' }, { value: 'post', label: 'From 1 Jun 2026 (won date)' }], v1.era, v => { v1.era = v; refresh1(); }));
    const hist = C.card(g1, {
      id: 'q1-hist', title: 'Distribution of days to Under Contract and CLOSED', subtitle: '15-day bins · completed milestones only', height: 300,
      render({ t }) {
        const rows = q1rows();
        const bins = []; for (let b = 0; b < 360; b += 15) bins.push(b);
        const lab = bins.map(b => b + '–' + (b + 14)).concat(['360+']);
        const count = arr => { const c = new Array(bins.length + 1).fill(0); arr.forEach(v => { if (v == null || v < 0) return; c[Math.min(bins.length, Math.floor(v / 15))]++; }); return c; };
        const u = count(rows.map(e => calc().days(e, 'uc'))), c = count(rows.map(e => calc().days(e, 'closed')));
        if (!u.some(Boolean) && !c.some(Boolean)) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 12, top: 34, bottom: 22, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' clients', { title: p => U.escapeHtml(p.axisValueLabel) + ' days' }) }),
            xAxis: C.catAxis(t, lab, { name: 'days from client start date', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 } }), yAxis: C.valAxis(t),
            series: [C.bar('Under Contract', u, t.series[0]), C.bar('CLOSED', c, t.series[1])] }),
          table: { columns: [{ key: 'b', label: 'Days' }, { key: 'u', label: 'Under Contract', num: true }, { key: 'c', label: 'CLOSED', num: true }], rows: lab.map((b, i) => ({ b, u: u[i], c: c[i] })) },
        };
      },
    });
    const km = C.card(g1, {
      id: 'q1-km', title: 'Share of started clients who have reached each milestone, by day', subtitle: 'Kaplan-Meier · clients without the milestone (still hunting, paused or refunded) count until the data date', height: 300,
      render({ t }) {
        const rows = q1rows();
        if (!rows.length) return { empty: true };
        const a = calc().km(rows, 'uc'), b = calc().km(rows, 'closed');
        const xs = []; for (let d = 0; d <= 540; d += 5) xs.push(d);
        const su = xs.map(x => +(U.kmAt(a.curve, x) * 100).toFixed(1)), sc = xs.map(x => +(U.kmAt(b.curve, x) * 100).toFixed(1));
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 34, bottom: 22, containLabel: true },
            tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v.toFixed(1) + '%', { title: p => 'Day ' + U.escapeHtml(p.axisValueLabel) }) }),
            xAxis: C.catAxis(t, xs, { boundaryGap: false, name: 'days since client start date', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 }, axisLabel: { color: t.label, interval: 17 } }),
            yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: [C.line('Reached Under Contract', su, t.series[0], { step: 'end' }), C.line('Reached CLOSED', sc, t.series[1], { step: 'end' })] }),
          table: { columns: [{ key: 'd', label: 'Day', num: true }, { key: 'u', label: '% reached UC', num: true, fmt: v => v + '%' }, { key: 'c', label: '% reached CLOSED', num: true, fmt: v => v + '%' }],
            rows: xs.filter(x => x % 30 === 0).map(x => ({ d: x, u: su[xs.indexOf(x)], c: sc[xs.indexOf(x)] })) },
          foot: 'By day 90: <b>' + U.fmtPct(U.kmAt(a.curve, 90)) + '</b> reached UC and <b>' + U.fmtPct(U.kmAt(b.curve, 90)) + '</b> CLOSED. By day 180: <b>' + U.fmtPct(U.kmAt(a.curve, 180)) + '</b> and <b>' + U.fmtPct(U.kmAt(b.curve, 180)) + '</b>. UC is the contract valid today, so a client whose earlier contract fell through counts from start to the later contract.',
        };
      },
    });
    const g1b = el('div', { class: 'grid grid-12 mt-1' });
    q1.append(g1b);
    const left1 = el('div', { class: 'span-7' });
    g1b.append(left1);
    const qtr = C.card(left1, {
      id: 'q1-quarter', title: 'Median days to Under Contract by start quarter', subtitle: 'Completed milestones only · bars show the median, the table shows n', height: 260,
      render({ t }) {
        const rows = q1rows();
        const g = U.groupBy(rows.filter(e => calc().days(e, 'uc') != null && calc().days(e, 'uc') >= 0), e => U.quarterKeyFromDay(e.start_d));
        const ks = Array.from(g.keys()).filter(Boolean).sort();
        if (!ks.length) return { empty: true };
        const med = ks.map(k => U.median(g.get(k).map(e => calc().days(e, 'uc'))));
        const gc = U.groupBy(rows.filter(e => calc().days(e, 'closed') != null), e => U.quarterKeyFromDay(e.start_d));
        const medc = ks.map(k => gc.get(k) ? U.median(gc.get(k).map(e => calc().days(e, 'closed'))) : null);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' days', { note: ps => 'n = ' + (g.get(ks[ps[0].dataIndex]) || []).length + ' UC, ' + (gc.get(ks[ps[0].dataIndex]) || []).length + ' CLOSED' }) }),
            xAxis: C.catAxis(t, ks), yAxis: C.valAxis(t, { fmt: v => v + ' d' }),
            series: [C.bar('Median days to UC', med, t.series[0]), C.bar('Median days to CLOSED', medc, t.series[1])] }),
          table: { columns: [{ key: 'q', label: 'Start quarter' }, { key: 'n', label: 'n (UC)', num: true }, { key: 'm', label: 'Median to UC', num: true, fmt: U.fmtDays }, { key: 'nc', label: 'n (CLOSED)', num: true }, { key: 'mc', label: 'Median to CLOSED', num: true, fmt: U.fmtDays }],
            rows: ks.map((k, i) => ({ q: k, n: g.get(k).length, m: med[i], nc: (gc.get(k) || []).length, mc: medc[i] })) },
          foot: 'Recent quarters look faster partly because only the fastest clients have finished so far (right-censoring). From June 2026 the clock starts on the won date; before, on the due date (a kickoff after the sale).',
        };
      },
    });
    const ex = SX.data.expected.engagements || {};
    g1b.append(el('div', { class: 'span-5' }, [el('div', { class: 'callout mt-0' }, [
      el('h4', { text: 'How to read the answer' }),
      el('ul', {}, [
        el('li', { text: 'Population: won engagements with a confirmed Jira start (' + U.fmtInt(ex.confirmed_starts) + '). The ' + U.fmtInt(ex.fallback) + ' Pipedrive fallback starts are not confirmed starts and are left out.' }),
        el('li', { text: 'Averages cover clients who reached the milestone. Slow or stalled clients are not in them yet, so compare the Kaplan-Meier day-50% line.' }),
        el('li', { text: 'Under Contract is the latest valid contract. The reporting layer keeps no first-contract history, so fall-through cannot be measured here.' }),
        el('li', { text: U.fmtInt(ex.scheduled_closings) + ' closing dates fall after the data date; they are treated as scheduled, not closed.' }),
      ])])]));
    function refresh1() { drawTiles1(); hist.invalidate(); km.invalidate(); qtr.invalidate(); }
    drawTiles1();
    SX.bus.on('filters', drawTiles1);

    /* ---------------- Q2 ---------------- */
    const q2 = el('div', { class: 'question', id: 'q2' });
    root.append(q2);
    q2.append(el('div', { class: 'q-head' }, [el('div', { class: 'q-num', text: '2' }), el('div', {}, [
      el('h3', { text: 'What percentage of Active Jira clients reach Under Contract and CLOSED?' }),
      el('p', { text: 'Jira-issue grain, using the reporting-layer flags: active_clients = signed-up minus Refunded, Paused and Additional Service. Active includes clients who already closed and are in post-close services; hunting clients are the subset still searching.' })])]));
    SX.live(q2, box => {
      const act = SX.model.jira({ population: 'active' }), sig = SX.model.jira({ population: 'signed' }), hun = SX.model.jira({ population: 'hunting' });
      const a = el('div', { class: 'answer' });
      const nU = act.filter(j => j.uc_d != null).length, nC = act.filter(j => j.closed_d != null).length;
      const sU = sig.filter(j => j.uc_d != null).length, sC = sig.filter(j => j.closed_d != null).length;
      SX.ui.kpi(a, { cls: 'kpi--accent', label: 'Active clients who reached UC', value: U.fmtPct(U.ratio(nU, act.length)), sub: U.fmtInt(nU) + ' of ' + U.fmtInt(act.length) + ' Active clients' });
      SX.ui.kpi(a, { cls: 'kpi--accent', label: 'Active clients who reached CLOSED', value: U.fmtPct(U.ratio(nC, act.length)), sub: U.fmtInt(nC) + ' of ' + U.fmtInt(act.length) + ' · ' + U.fmtInt(act.filter(j => j.closed_scheduled).length) + ' more scheduled' });
      SX.ui.kpi(a, { label: 'Hunting clients', value: U.fmtInt(hun.length), sub: 'Active and still searching (Client Start to 8 Weeks)' });
      SX.ui.kpi(a, { label: 'All signed-up: reached UC / CLOSED', value: U.fmtPct(U.ratio(sU, sig.length)) + ' / ' + U.fmtPct(U.ratio(sC, sig.length)), sub: U.fmtInt(sig.length) + ' signed-up, including Paused and Refunded' });
      box.append(a);
      const st = U.groupBy(sig, j => j.status);
      const rows = Array.from(st.entries()).map(([s, arr]) => ({ s, cls: arr[0].klass, n: arr.length, u: arr.filter(j => j.uc_d != null).length, c: arr.filter(j => j.closed_d != null).length, o: (SX.data.defs.status_meta[s] || {}).order || 99 }));
      const g = el('div', { class: 'grid grid-12' });
      const left = el('div', { class: 'span-7' }, [el('h4', { class: 'mt-1', text: 'What sits inside the Active denominator' }), SX.ui.table({ sortKey: 'o', sortDir: 1, columns: [
        { key: 's', label: 'Current status' }, { key: 'cls', label: 'Class' }, { key: 'n', label: 'Clients', num: true },
        { key: 'u', label: '% reached UC', num: true, sort: r => r.u / r.n, html: (v, r) => SX.ui.barCell(r.u, r.n, U.fmtPct(r.u / r.n), 'var(--series-1)') },
        { key: 'c', label: '% reached CLOSED', num: true, sort: r => r.c / r.n, html: (v, r) => SX.ui.barCell(r.c, r.n, U.fmtPct(r.c / r.n), 'var(--series-2)') }], rows })]);
      const closedLike = act.filter(j => ['Closed', 'Post-close'].includes(j.group)).length;
      const pre = SX.data.jira.filter(j => !j.signed).length;
      const right = el('div', { class: 'span-5' }, [el('div', { class: 'callout callout--warn' }, [
        el('h4', { text: 'Why this is a snapshot share, not a conversion rate' }),
        el('ul', {}, [
          el('li', { text: U.fmtInt(closedLike) + ' of the ' + U.fmtInt(act.length) + ' Active clients are already CLOSED or post-close. They count as Active, which lifts the rate.' }),
          el('li', { text: 'Refunded and Paused clients drop out of the denominator even if they once went UC, so failures leave and successes stay.' }),
          el('li', { text: 'Clients who started last month cannot have closed yet, so the share moves as the client mix ages.' }),
          el('li', { text: 'The ' + U.fmtInt(pre) + ' pre-sale and declined Jira issues are outside the signed-up list, which is correct: they have not bought.' }),
        ]),
        el('p', { text: 'For a forward-looking rate, use the matured-cohort chart below.' })])]);
      g.append(left, right);
      box.append(g);
    });
    const v2 = { adj: false };
    const coh = el('div', { class: 'mt-2' });
    q2.append(coh);
    const ctl2 = el('div', { class: 'control-row' });
    coh.append(ctl2);
    const mat = C.card(coh, {
      id: 'q2-cohort', title: 'Matured cohort conversion: confirmed starts reaching UC within 30, 60 and 90 days',
      subtitle: 'client_cohort_performance rule: SUM(uc_within_N × eligible_N) ÷ SUM(eligible_N), by start quarter · a client counts only once N days have passed', height: 300,
      render({ t }) {
        const rows = SX.model.eng({ population: 'confirmed' }), asof = SX.data.asofDay;
        const g = U.groupBy(rows, e => U.quarterKeyFromDay(e.start_d));
        const ks = Array.from(g.keys()).filter(Boolean).sort();
        if (!ks.length) return { empty: true };
        const W = [30, 60, 90];
        const rate = (k, w) => {
          let m = g.get(k).filter(e => asof - e.start_d >= w);
          if (v2.adj) m = m.filter(e => !e.refunded);
          if (!m.length) return null;
          return +(100 * m.filter(e => e.days_to_uc != null && e.days_to_uc >= 0 && e.days_to_uc <= w).length / m.length).toFixed(1);
        };
        const data = W.map(w => ks.map(k => rate(k, w)));
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v + '%', { note: ps => 'Cohort size ' + g.get(ks[ps[0].dataIndex]).length }) }),
            xAxis: C.catAxis(t, ks), yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: W.map((w, i) => C.bar('UC within ' + w + ' d', data[i], [t.series[2], t.series[0], t.series[1]][i])) }),
          table: { columns: [{ key: 'k', label: 'Start quarter' }, { key: 'n', label: 'Confirmed starts', num: true }].concat(W.map((w, i) => ({ key: 's' + i, label: 'UC ≤ ' + w + ' d', num: true, fmt: v => v == null ? 'not mature' : v + '%' }))),
            rows: ks.map((k, ki) => Object.assign({ k, n: g.get(k).length }, Object.fromEntries(W.map((w, i) => ['s' + i, data[i][ki]])))) },
          foot: 'Only matured clients enter each window, so an early converter is never counted against an immature denominator. Refund-excluded removes clients whose current status is Refunded (a status proxy), which lifts rates because refunds are concentrated among clients who never contracted.',
        };
      },
    });
    ctl2.append(SX.ui.seg('Denominator', [{ value: 'gross', label: 'Gross (all matured starts)' }, { value: 'adj', label: 'Refund-excluded' }], 'gross', v => { v2.adj = v === 'adj'; mat.invalidate(); }));

    /* ---------------- Q3 ---------------- */
    const v3 = { basis: 'started' };
    const q3 = el('div', { class: 'question', id: 'q3' });
    root.append(q3);
    q3.append(el('div', { class: 'q-head' }, [el('div', { class: 'q-num', text: '3' }), el('div', {}, [
      el('h3', { text: 'Monthly input vs output: clients starting vs clients reaching Under Contract' }),
      el('p', { text: 'Calendar throughput (daily_client_activity): Client Started events next to the Under Contract and closing events that happened in the same month. These are mostly different people, and the running total is not the hunting backlog. Same-cohort conversion follows each start month’s own clients.' })])]));
    const ctl3 = el('div', { class: 'control-row' });
    q3.append(ctl3);
    const g3 = el('div', { class: 'grid grid-12' });
    q3.append(g3);
    function flows() {
      const all = SX.model.eng({ ignorePeriod: true });
      const months = SX.model.months('2024-03');
      const st = calc().monthCounts(all.filter(e => e.confirmed_start), 'start'), um = calc().monthCounts(all, 'uc'), cm = calc().monthCounts(all, 'closed');
      const nm = v3.basis === 'started' ? st : calc().monthCounts(SX.model.jira({ ignorePeriod: true }), 'created');
      return { months, a: months.map(k => nm.get(k) || 0), b: months.map(k => um.get(k) || 0), c: months.map(k => cm.get(k) || 0), s: months.map(k => st.get(k) || 0) };
    }
    const thru = C.card(el('div'), {
      id: 'q3-throughput', title: 'Client Started vs Under Contract vs closing events per month', subtitle: 'Events counted in the month they happened · net change = starts − UC (positive: starts outpaced contracts)', height: 360,
      render({ t }) {
        const f = flows();
        const label = v3.basis === 'started' ? 'Client Started (confirmed Jira starts)' : 'New Jira issues (created, all statuses)';
        const net = f.s.map((v, i) => v - f.b[i]);
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 12, top: 34, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }),
            xAxis: C.catAxis(t, f.months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t),
            series: [C.bar(label, f.a, t.series[2]), C.bar('Under Contract that month', f.b, t.series[0]), C.bar('CLOSED that month', f.c, t.series[1]),
              C.line('Net change (starts − UC)', net, t.ink2, { showSymbol: true, symbolSize: 5 })] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'a', label: label, num: true }, { key: 'b', label: 'Under Contract', num: true }, { key: 'c', label: 'CLOSED', num: true }, { key: 'n', label: 'Net change', num: true }, { key: 'r', label: 'Replacement rate (UC ÷ starts)', num: true }],
            rows: f.months.map((k, i) => ({ m: U.fmtMonth(k), a: f.a[i], b: f.b[i], c: f.c[i], n: net[i], r: f.s[i] ? (f.b[i] / f.s[i]).toFixed(2) : '–' })) },
          foot: 'The current month is partial (data to ' + SX.data.meta.asof + '). Monthly figures sum daily counts; the replacement rate is recomputed from the sums. From June 2026 a start is the won date, so a month’s starts no longer change after it ends.',
        };
      },
    });
    ctl3.append(SX.ui.seg('Count “input” as', [{ value: 'started', label: 'Client Started events' }, { value: 'jira', label: 'Every new Jira issue (created date)' }], v3.basis, v => { v3.basis = v; thru.invalidate(); }));
    const l3 = el('div', { class: 'span-8' }), r3 = el('div', { class: 'span-4' });
    g3.append(l3, r3);
    l3.append(thru.el);
    SX.live(r3, box => {
      const f = flows();
      const last6 = U.monthRange(U.addMonths(SX.data.asofMonth, -6), U.addMonths(SX.data.asofMonth, -1));
      const idx = last6.map(k => f.months.indexOf(k)).filter(i => i >= 0);
      const sn = U.sum(idx, i => f.s[i]), su = U.sum(idx, i => f.b[i]);
      box.append(el('div', { class: 'callout mt-0' }, [
        el('h4', { text: 'Last six full months (' + U.fmtMonth(last6[0], true) + '–' + U.fmtMonth(last6[5], true) + ')' }),
        el('p', { text: U.fmtInt(sn) + ' Client Started events against ' + U.fmtInt(su) + ' Under Contract events: net change ' + (sn - su >= 0 ? '+' : '') + U.fmtInt(sn - su) + ', replacement rate ' + (sn ? (su / sn).toFixed(2) : '–') + '.' }),
        el('p', { class: 'small muted', text: 'Throughput compares flows. It does not say which clients converted, and a positive net change is not the backlog (pauses, refunds and restarts are not netted). For conversion, see the cohort chart.' })]));
    });
    C.card(q3, {
      id: 'q3-cohort', title: 'Same-cohort conversion: share of each start month’s clients who have reached UC', subtitle: 'Confirmed starts · to date and within 90 days (matured clients only)', height: 300, cls: 'mt-2',
      render({ t }) {
        const rows = SX.model.eng({ population: 'confirmed' }), asof = SX.data.asofDay;
        const g = U.groupBy(rows, e => U.monthKeyFromDay(e.start_d));
        const ks = Array.from(g.keys()).filter(k => k && k >= '2024-03').sort();
        if (!ks.length) return { empty: true };
        const ever = ks.map(k => +(100 * g.get(k).filter(e => e.uc_d != null).length / g.get(k).length).toFixed(1));
        const w90 = ks.map(k => { const arr = g.get(k).filter(e => asof - e.start_d >= 90); if (!arr.length) return null; return +(100 * arr.filter(e => e.days_to_uc != null && e.days_to_uc >= 0 && e.days_to_uc <= 90).length / arr.length).toFixed(1); });
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v + '%', { note: ps => 'Cohort size ' + g.get(ks[ps[0].dataIndex]).length }) }),
            xAxis: C.catAxis(t, ks.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: [C.line('Reached UC to date', ever, t.series[0], { showSymbol: true, symbolSize: 6 }), C.line('Reached UC within 90 days (matured)', w90, t.series[2], { showSymbol: true, symbolSize: 6 })] }),
          table: { columns: [{ key: 'm', label: 'Start month' }, { key: 'n', label: 'Confirmed starts', num: true }, { key: 'e', label: 'UC to date', num: true, fmt: v => v + '%' }, { key: 'w', label: 'UC ≤ 90 d', num: true, fmt: v => v == null ? 'not mature' : v + '%' }],
            rows: ks.map((k, i) => ({ m: U.fmtMonth(k), n: g.get(k).length, e: ever[i], w: w90[i] })) },
          foot: 'Recent cohorts are still in progress, so “to date” falls toward the right edge. Next month’s UC volume is not the same clients as this month’s starts: test such links with this chart, not with the monthly bars.',
        };
      },
    });
  };

  /* ---------------- parity: browser metrics vs Python expected (unfiltered) ---------------- */
  SX.parity = function () {
    const e = SX.data.expected, D = SX.data, out = [];
    const chk = (name, js, py) => out.push({ name, js, py, ok: js === py || (typeof js === 'number' && typeof py === 'number' && Math.abs(js - py) < 0.011) });
    const sc = D.deals.filter(d => d.in_scope), won = sc.filter(d => d.status === 'won');
    chk('deals.in_scope', sc.length, e.deals.in_scope);
    chk('deals.won', won.length, e.deals.won);
    chk('deals.won_value', U.sum(won, d => d.value), e.deals.won_value);
    chk('deals.median_days_to_win', U.median(won.map(d => d.days_to_win)), e.deals.median_days_to_win);
    chk('jira.signed', D.jira.filter(j => j.signed).length, e.jira.signed);
    chk('jira.active', D.jira.filter(j => j.active).length, e.jira.active);
    chk('jira.hunting', D.jira.filter(j => j.hunting).length, e.jira.hunting);
    const coh = D.eng.filter(x => x.confirmed_start);
    chk('engagements.confirmed_starts', coh.length, e.engagements.confirmed_starts);
    const su = SX.calc.stats(coh.map(x => SX.calc.days(x, 'uc'))), scl = SX.calc.stats(coh.map(x => SX.calc.days(x, 'closed')));
    chk('q1.uc.n', su.n, e.q1.uc.n); chk('q1.uc.median', su.median, e.q1.uc.median); chk('q1.uc.mean', +su.mean.toFixed(2), e.q1.uc.mean);
    chk('q1.closed.n', scl.n, e.q1.closed.n); chk('q1.closed.median', scl.median, e.q1.closed.median); chk('q1.closed.mean', +scl.mean.toFixed(2), e.q1.closed.mean);
    chk('q1.km_uc', SX.calc.km(coh, 'uc').median, e.q1.km_uc);
    chk('q1.km_closed', SX.calc.km(coh, 'closed').median, e.q1.km_closed);
    const act = D.jira.filter(j => j.active);
    chk('q2.active_uc', act.filter(j => j.uc_d != null).length, e.q2.active_uc);
    chk('q2.active_closed', act.filter(j => j.closed_d != null).length, e.q2.active_closed);
    const st = SX.calc.monthCounts(coh, 'start'), um = SX.calc.monthCounts(D.eng, 'uc'), cm = SX.calc.monthCounts(D.eng, 'closed');
    const bad = e.q3.filter(r => (st.get(r.month) || 0) !== r.started || (um.get(r.month) || 0) !== r.uc || (cm.get(r.month) || 0) !== r.closed).length;
    chk('q3.monthly_mismatches', bad, 0);
    return { ok: out.every(x => x.ok), checks: out };
  };
})();
