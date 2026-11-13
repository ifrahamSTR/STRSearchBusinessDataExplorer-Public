/* Carson's three Jira questions + metric parity check (browser vs Python build). */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;
  const calc = () => SX.calc;

  SX.sections.questions = function (root) {
    SX.head(root, 'questions', 'Section 2 · Carson’s questions', 'Carson’s three Jira questions, answered with their caveats',
      'Each answer leads with Carson’s exact definition, then shows what changes when the definition or population changes. Filters above apply: period = effective start date (events for Q3).');

    /* ---------------- Q1 ---------------- */
    const v1 = { pop: 'all', basis: 'start' };
    const q1 = el('div', { class: 'question', id: 'q1' });
    root.append(q1);
    q1.append(el('div', { class: 'q-head' }, [el('div', { class: 'q-num', text: '1' }), el('div', {}, [
      el('h3', { text: 'How long do Jira clients take to reach Under Contract and CLOSED?' }),
      el('p', { text: 'Average and median days from the effective start, COALESCE(issue_due_date, issue_created_date), to the first UC and first CLOSED status dates. UC and CLOSED are measured separately.' })])]));
    const ctl1 = el('div', { class: 'control-row' });
    q1.append(ctl1);
    const tiles1 = el('div', { class: 'answer' });
    q1.append(tiles1);
    const g1 = el('div', { class: 'grid grid-2' });
    q1.append(g1);

    function q1rows() { return SX.model.jira({ population: v1.pop === 'signed' ? 'signed' : 'all' }); }
    function drawTiles1() {
      tiles1.textContent = '';
      const rows = q1rows();
      const uc = calc().stats(rows.map(j => calc().days(j, 'uc', v1.basis)));
      const cl = calc().stats(rows.map(j => calc().days(j, 'closed', v1.basis)));
      const kmU = calc().km(rows.filter(j => j.carson_signed), 'uc', v1.basis), kmC = calc().km(rows.filter(j => j.carson_signed), 'closed', v1.basis);
      SX.ui.kpi(tiles1, { cls: 'kpi--accent', label: 'Median days to Under Contract', value: U.fmtInt(uc.median), unit: 'days', sub: 'Mean ' + U.fmt1(uc.mean) + ' · p25–p75 ' + U.fmtInt(uc.p25) + '–' + U.fmtInt(uc.p75) + ' · n = ' + U.fmtInt(uc.n) });
      SX.ui.kpi(tiles1, { cls: 'kpi--accent', label: 'Median days to CLOSED', value: U.fmtInt(cl.median), unit: 'days', sub: 'Mean ' + U.fmt1(cl.mean) + ' · p25–p75 ' + U.fmtInt(cl.p25) + '–' + U.fmtInt(cl.p75) + ' · n = ' + U.fmtInt(cl.n) });
      SX.ui.kpi(tiles1, { label: 'Half of signed-up clients reach UC by', value: kmU.median == null ? 'not yet' : 'day ' + U.fmtInt(kmU.median), sub: 'Kaplan-Meier, counting the ' + U.fmtInt(kmU.n - kmU.events) + ' clients still without UC' });
      SX.ui.kpi(tiles1, { label: 'Half of signed-up clients reach CLOSED by', value: kmC.median == null ? 'not yet' : 'day ' + U.fmtInt(kmC.median), sub: 'Kaplan-Meier, counting the ' + U.fmtInt(kmC.n - kmC.events) + ' clients still without CLOSED' });
    }
    ctl1.append(
      SX.ui.seg('Population', [{ value: 'all', label: 'All issues with the milestone' }, { value: 'signed', label: 'Carson signed-up only' }], v1.pop, v => { v1.pop = v; refresh1(); }),
      SX.ui.seg('Start date', [{ value: 'start', label: 'Carson: COALESCE(due, created)' }, { value: 'created', label: 'Issue created' }, { value: 'due', label: 'Due date only (ETL fields)' }], v1.basis, v => { v1.basis = v; refresh1(); }),
    );
    const hist = C.card(g1, {
      id: 'q1-hist', title: 'Distribution of days to first UC and first CLOSED', subtitle: '15-day bins · completed milestones only', height: 300,
      render({ t }) {
        const rows = q1rows();
        const bins = []; for (let b = 0; b < 360; b += 15) bins.push(b);
        const lab = bins.map(b => b + '–' + (b + 14)).concat(['360+']);
        const count = arr => { const c = new Array(bins.length + 1).fill(0); arr.forEach(v => { if (v == null || v < 0) return; c[Math.min(bins.length, Math.floor(v / 15))]++; }); return c; };
        const u = count(rows.map(j => calc().days(j, 'uc', v1.basis))), c = count(rows.map(j => calc().days(j, 'closed', v1.basis)));
        if (!u.some(Boolean) && !c.some(Boolean)) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 12, top: 34, bottom: 22, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' clients', { title: p => U.escapeHtml(p.axisValueLabel) + ' days' }) }),
            xAxis: C.catAxis(t, lab, { name: 'days from effective start', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 } }), yAxis: C.valAxis(t),
            series: [C.bar('Under Contract', u, t.series[0]), C.bar('CLOSED', c, t.series[1])] }),
          table: { columns: [{ key: 'b', label: 'Days' }, { key: 'u', label: 'First UC', num: true }, { key: 'c', label: 'First CLOSED', num: true }], rows: lab.map((b, i) => ({ b, u: u[i], c: c[i] })) },
        };
      },
    });
    const km = C.card(g1, {
      id: 'q1-km', title: 'Share of signed-up clients who have reached each milestone, by day', subtitle: 'Kaplan-Meier · clients still searching count until the as-of date', height: 300,
      render({ t }) {
        const rows = q1rows().filter(j => j.carson_signed);
        if (!rows.length) return { empty: true };
        const a = calc().km(rows, 'uc', v1.basis), b = calc().km(rows, 'closed', v1.basis);
        const xs = []; for (let d = 0; d <= 540; d += 5) xs.push(d);
        const su = xs.map(x => +(U.kmAt(a.curve, x) * 100).toFixed(1)), sc = xs.map(x => +(U.kmAt(b.curve, x) * 100).toFixed(1));
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 34, bottom: 22, containLabel: true },
            tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v.toFixed(1) + '%', { title: p => 'Day ' + U.escapeHtml(p.axisValueLabel) }) }),
            xAxis: C.catAxis(t, xs, { boundaryGap: false, name: 'days since effective start', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 }, axisLabel: { color: t.label, interval: 17 } }),
            yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: [C.line('Reached Under Contract', su, t.series[0], { step: 'end' }), C.line('Reached CLOSED', sc, t.series[1], { step: 'end' })] }),
          table: { columns: [{ key: 'd', label: 'Day', num: true }, { key: 'u', label: '% reached UC', num: true, fmt: v => v + '%' }, { key: 'c', label: '% reached CLOSED', num: true, fmt: v => v + '%' }],
            rows: xs.filter(x => x % 30 === 0).map(x => ({ d: x, u: su[xs.indexOf(x)], c: sc[xs.indexOf(x)] })) },
          foot: 'By day 90: <b>' + U.fmtPct(U.kmAt(a.curve, 90)) + '</b> reached UC and <b>' + U.fmtPct(U.kmAt(b.curve, 90)) + '</b> CLOSED. By day 180: <b>' + U.fmtPct(U.kmAt(a.curve, 180)) + '</b> and <b>' + U.fmtPct(U.kmAt(b.curve, 180)) + '</b>.',
        };
      },
    });
    const g1b = el('div', { class: 'grid grid-12 mt-1' });
    q1.append(g1b);
    const qtr = C.card(el('div', { class: 'span-7' }), {
      id: 'q1-quarter', title: 'Median days to first UC by start quarter', subtitle: 'Completed milestones only · bars show the median, the table shows n', height: 260,
      render({ t }) {
        const rows = q1rows();
        const g = U.groupBy(rows.filter(j => calc().days(j, 'uc', v1.basis) != null), j => U.quarterKeyFromDay(j.start_d));
        const ks = Array.from(g.keys()).filter(Boolean).sort();
        if (!ks.length) return { empty: true };
        const med = ks.map(k => U.median(g.get(k).map(j => calc().days(j, 'uc', v1.basis))));
        const gc = U.groupBy(rows.filter(j => calc().days(j, 'closed', v1.basis) != null), j => U.quarterKeyFromDay(j.start_d));
        const medc = ks.map(k => gc.get(k) ? U.median(gc.get(k).map(j => calc().days(j, 'closed', v1.basis))) : null);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' days', { note: ps => 'n = ' + (g.get(ks[ps[0].dataIndex]) || []).length + ' UC, ' + (gc.get(ks[ps[0].dataIndex]) || []).length + ' CLOSED' }) }),
            xAxis: C.catAxis(t, ks), yAxis: C.valAxis(t, { fmt: v => v + ' d' }),
            series: [C.bar('Median days to UC', med, t.series[0]), C.bar('Median days to CLOSED', medc, t.series[1])] }),
          table: { columns: [{ key: 'q', label: 'Start quarter' }, { key: 'n', label: 'n (UC)', num: true }, { key: 'm', label: 'Median to UC', num: true, fmt: U.fmtDays }, { key: 'nc', label: 'n (CLOSED)', num: true }, { key: 'mc', label: 'Median to CLOSED', num: true, fmt: U.fmtDays }],
            rows: ks.map((k, i) => ({ q: k, n: g.get(k).length, m: med[i], nc: (gc.get(k) || []).length, mc: medc[i] })) },
          foot: 'Recent quarters look faster partly because only the fastest clients have finished so far (right-censoring). 2024 CLOSED medians are inflated: CLOSED only became a Jira status in September 2024, so earlier closings were recorded late. Early quarters also only contain issues that still exist in Jira.',
        };
      },
    });
    g1b.append(qtr.el.parentNode || qtr.el);
    g1b.firstChild.append(qtr.el);
    const note1 = el('div', { class: 'span-5' }, [el('div', { class: 'callout mt-0' }, [
      el('h4', { text: 'How to read the answer' }),
      el('ul', {}, [
        el('li', { text: 'The averages cover clients who reached the milestone. Slow or stalled clients are not in them yet, so the true typical time is longer: compare the Kaplan-Meier day-50% line.' }),
        el('li', { text: 'First UC and CLOSED dates come from the Jira status changelog (UTC dates). 61 closed clients have no UC transition captured, so UC n is understated.' }),
        el('li', { text: 'The ETL’s days_to_* columns use the due date only and are blank when it is missing. Switch “Start date” to see the difference.' }),
        el('li', { text: 'Since May 2026 the due date is the onboarding-call date, which can come before the contract is signed.' }),
      ])])]);
    g1b.append(note1);
    function refresh1() { drawTiles1(); hist.invalidate(); km.invalidate(); qtr.invalidate(); }
    drawTiles1();
    SX.bus.on('filters', drawTiles1);

    /* ---------------- Q2 ---------------- */
    const q2 = el('div', { class: 'question', id: 'q2' });
    root.append(q2);
    q2.append(el('div', { class: 'q-head' }, [el('div', { class: 'q-num', text: '2' }), el('div', {}, [
      el('h3', { text: 'What percentage of Active Jira clients reach Under Contract and CLOSED?' }),
      el('p', { text: 'Carson’s definition: clients whose current status is on the Active list (signed-up minus Refunded, Paused, Additional Service). Numerator: clients with a first UC (or first CLOSED) date.' })])]));
    SX.live(q2, box => {
      const act = SX.model.jira({ population: 'active' }), sig = SX.model.jira({ population: 'signed' });
      const a = el('div', { class: 'answer' });
      const nU = act.filter(j => j.uc_d != null).length, nC = act.filter(j => j.closed_d != null).length;
      const sU = sig.filter(j => j.uc_d != null).length, sC = sig.filter(j => j.closed_d != null).length;
      SX.ui.kpi(a, { cls: 'kpi--accent', label: 'Active clients who reached UC', value: U.fmtPct(U.ratio(nU, act.length)), sub: U.fmtInt(nU) + ' of ' + U.fmtInt(act.length) + ' Active clients (Carson’s definition)' });
      SX.ui.kpi(a, { cls: 'kpi--accent', label: 'Active clients who reached CLOSED', value: U.fmtPct(U.ratio(nC, act.length)), sub: U.fmtInt(nC) + ' of ' + U.fmtInt(act.length) + ' Active clients' });
      SX.ui.kpi(a, { label: 'All signed-up: reached UC', value: U.fmtPct(U.ratio(sU, sig.length)), sub: U.fmtInt(sU) + ' of ' + U.fmtInt(sig.length) + ', including Paused and Refunded' });
      SX.ui.kpi(a, { label: 'All signed-up: reached CLOSED', value: U.fmtPct(U.ratio(sC, sig.length)), sub: U.fmtInt(sC) + ' of ' + U.fmtInt(sig.length) });
      box.append(a);
      const st = U.groupBy(sig, j => j.status);
      const rows = Array.from(st.entries()).map(([s, arr]) => ({ s, cls: arr[0].carson_class, n: arr.length, u: arr.filter(j => j.uc_d != null).length, c: arr.filter(j => j.closed_d != null).length, o: (SX.data.defs.status_meta[s] || {}).order || 99 }));
      const g = el('div', { class: 'grid grid-12' });
      const left = el('div', { class: 'span-7' }, [el('h4', { class: 'mt-1', text: 'What sits inside the Active denominator' }), SX.ui.table({ sortKey: 'o', sortDir: 1, columns: [
        { key: 's', label: 'Current status' }, { key: 'cls', label: 'Carson class' }, { key: 'n', label: 'Clients', num: true },
        { key: 'u', label: '% reached UC', num: true, sort: r => r.u / r.n, html: (v, r) => SX.ui.barCell(r.u, r.n, U.fmtPct(r.u / r.n), 'var(--series-1)') },
        { key: 'c', label: '% reached CLOSED', num: true, sort: r => r.c / r.n, html: (v, r) => SX.ui.barCell(r.c, r.n, U.fmtPct(r.c / r.n), 'var(--series-2)') }], rows })]);
      const closedLike = act.filter(j => ['Closed', 'Post-close'].includes(j.group)).length;
      const right = el('div', { class: 'span-5' }, [el('div', { class: 'callout callout--warn' }, [
        el('h4', { text: 'Why this is a snapshot share, not a conversion rate' }),
        el('ul', {}, [
          el('li', { text: U.fmtInt(closedLike) + ' of the ' + U.fmtInt(act.length) + ' Active clients are already CLOSED or post-close. They are counted as Active, which lifts the rate.' }),
          el('li', { text: 'Refunded and Paused clients drop out of the denominator even if they once went UC, so failures leave and successes stay.' }),
          el('li', { text: 'Clients who started last month cannot have closed yet, so the rate moves as the client mix ages.' }),
          el('li', { text: 'The 706 pre-sale prospects are outside both lists, which is correct: they have not bought.' }),
        ]),
        el('p', { text: 'For a forward-looking rate, use the cohort chart below: of clients who started in a quarter, how many reached UC within 90 or 180 days.' })])]);
      g.append(left, right);
      box.append(g);
    });
    const coh = el('div', { class: 'mt-2' });
    q2.append(coh);
    C.card(coh, {
      id: 'q2-cohort', title: 'Cohort conversion: signed-up clients reaching UC / CLOSED within 90 and 180 days of start',
      subtitle: 'By effective-start quarter · a cohort is shown only once every client has had the full window', height: 300,
      render({ t }) {
        const rows = SX.model.jira({ population: 'signed' }), asof = SX.data.asofDay;
        const g = U.groupBy(rows, j => U.quarterKeyFromDay(j.start_d));
        const ks = Array.from(g.keys()).filter(Boolean).sort();
        if (!ks.length) return { empty: true };
        const rate = (k, ms, w) => {
          const arr = g.get(k).filter(j => asof - j.start_d >= w);
          if (arr.length < g.get(k).length || !arr.length) return null;
          return +(100 * arr.filter(j => j[ms + '_d'] != null && j[ms + '_d'] - j.start_d <= w).length / arr.length).toFixed(1);
        };
        const s = [['UC within 90 d', 'uc', 90, t.series[0]], ['UC within 180 d', 'uc', 180, t.series[2]], ['CLOSED within 180 d', 'closed', 180, t.series[1]]];
        const data = s.map(([n, ms, w]) => ks.map(k => rate(k, ms, w)));
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v + '%', { note: ps => 'Cohort size ' + g.get(ks[ps[0].dataIndex]).length }) }),
            xAxis: C.catAxis(t, ks), yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: s.map(([n, , , col], i) => C.bar(n, data[i], col)) }),
          table: { columns: [{ key: 'k', label: 'Start quarter' }, { key: 'n', label: 'Clients', num: true }].concat(s.map(([n], i) => ({ key: 's' + i, label: n, num: true, fmt: v => v == null ? 'not mature' : v + '%' }))),
            rows: ks.map((k, ki) => Object.assign({ k, n: g.get(k).length }, Object.fromEntries(s.map((x, i) => ['s' + i, data[i][ki]])))) },
          foot: 'A missing bar means the cohort is not mature yet. Early cohorts lose some transitions from the changelog, so their rates are a lower bound.',
        };
      },
    });

    /* ---------------- Q3 ---------------- */
    const v3 = { basis: 'signed' };
    const q3 = el('div', { class: 'question', id: 'q3' });
    root.append(q3);
    q3.append(el('div', { class: 'q-head' }, [el('div', { class: 'q-num', text: '3' }), el('div', {}, [
      el('h3', { text: 'Monthly input vs output: new Jira clients vs clients reaching Under Contract' }),
      el('p', { text: 'Calendar throughput: new clients entering in a month next to the UC (and CLOSED) events that happened in the same month. These are different people. Same-cohort conversion follows the clients who started in each month.' })])]));
    const ctl3 = el('div', { class: 'control-row' });
    q3.append(ctl3);
    const g3 = el('div', { class: 'grid grid-12' });
    q3.append(g3);
    const thru = C.card(el('div'), {
      id: 'q3-throughput', title: 'New clients vs first-UC and first-CLOSED events per month', subtitle: 'Events are counted in the month they happened · respects period and Pipedrive filters', height: 330,
      render({ t }) {
        const all = SX.model.jira({ ignorePeriod: true });
        const months = SX.model.months('2024-03');
        const newRows = v3.basis === 'signed' ? all.filter(j => j.carson_signed) : all;
        const nm = calc().monthCounts(newRows, v3.basis === 'signed' ? 'start' : 'created');
        const um = calc().monthCounts(all, 'uc'), cm = calc().monthCounts(all, 'closed');
        const a = months.map(k => nm.get(k) || 0), b = months.map(k => um.get(k) || 0), c = months.map(k => cm.get(k) || 0);
        const label = v3.basis === 'signed' ? 'New signed-up clients (effective start)' : 'New Jira issues (created, all statuses)';
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 12, top: 34, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }),
            xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t),
            series: [C.bar(label, a, t.series[2]), C.bar('Reached UC that month', b, t.series[0]), C.bar('CLOSED that month', c, t.series[1])] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'a', label: label, num: true }, { key: 'b', label: 'First UC', num: true }, { key: 'c', label: 'First CLOSED', num: true }, { key: 'r', label: 'UC ÷ new', num: true }],
            rows: months.map((k, i) => ({ m: U.fmtMonth(k), a: a[i], b: b[i], c: c[i], r: a[i] ? (b[i] / a[i]).toFixed(2) : '–' })) },
          foot: 'The current month is partial (data to ' + SX.data.meta.asof + '). CLOSED as a status only appears from September 2024.',
        };
      },
    });
    ctl3.append(SX.ui.seg('Count “new clients” as', [{ value: 'signed', label: 'Signed-up clients by effective start' }, { value: 'all', label: 'Every new Jira issue (created date)' }], v3.basis, v => { v3.basis = v; thru.invalidate(); }));
    const l3 = el('div', { class: 'span-8' }), r3 = el('div', { class: 'span-4' });
    g3.append(l3, r3);
    l3.append(thru.el);
    SX.live(r3, box => {
      const all = SX.model.jira({ ignorePeriod: true });
      const last6 = U.monthRange(U.addMonths(SX.data.asofMonth, -6), U.addMonths(SX.data.asofMonth, -1));
      const nm = calc().monthCounts(all.filter(j => j.carson_signed), 'start'), um = calc().monthCounts(all, 'uc'), am = calc().monthCounts(all, 'created');
      const sn = U.sum(last6, k => nm.get(k) || 0), su = U.sum(last6, k => um.get(k) || 0), sa = U.sum(last6, k => am.get(k) || 0);
      box.append(el('div', { class: 'callout mt-0' }, [
        el('h4', { text: 'Last six full months (' + U.fmtMonth(last6[0], true) + '–' + U.fmtMonth(last6[5], true) + ')' }),
        el('p', { text: U.fmtInt(sn) + ' new signed-up clients against ' + U.fmtInt(su) + ' first-UC events, about ' + U.fmt1(su / Math.max(1, sn)) + ' UC per new client. Over the same months Jira opened ' + U.fmtInt(sa) + ' issues in total; the rest are prospects.' }),
        el('p', { class: 'small muted', text: 'Throughput compares flows. It does not say which clients converted. For that, see the cohort chart.' })]));
    });
    C.card(q3, {
      id: 'q3-cohort', title: 'Same-cohort conversion: share of each start month’s signed-up clients who have reached UC', subtitle: 'Cumulative to date and within 90 days · cohort size in the table', height: 300, cls: 'mt-2',
      render({ t }) {
        const rows = SX.model.jira({ population: 'signed' }), asof = SX.data.asofDay;
        const g = U.groupBy(rows, j => U.monthKeyFromDay(j.start_d));
        const ks = Array.from(g.keys()).filter(k => k && k >= '2024-03').sort();
        if (!ks.length) return { empty: true };
        const ever = ks.map(k => +(100 * g.get(k).filter(j => j.uc_d != null).length / g.get(k).length).toFixed(1));
        const w90 = ks.map(k => { const arr = g.get(k); if (arr.some(j => asof - j.start_d < 90)) return null; return +(100 * arr.filter(j => j.uc_d != null && j.uc_d - j.start_d <= 90).length / arr.length).toFixed(1); });
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v + '%', { note: ps => 'Cohort size ' + g.get(ks[ps[0].dataIndex]).length }) }),
            xAxis: C.catAxis(t, ks.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: [C.line('Reached UC to date', ever, t.series[0], { showSymbol: true, symbolSize: 6 }), C.line('Reached UC within 90 days', w90, t.series[2], { showSymbol: true, symbolSize: 6 })] }),
          table: { columns: [{ key: 'm', label: 'Start month' }, { key: 'n', label: 'Clients', num: true }, { key: 'e', label: 'UC to date', num: true, fmt: v => v + '%' }, { key: 'w', label: 'UC ≤ 90 d', num: true, fmt: v => v == null ? 'not mature' : v + '%' }],
            rows: ks.map((k, i) => ({ m: U.fmtMonth(k), n: g.get(k).length, e: ever[i], w: w90[i] })) },
          foot: 'Recent cohorts are still in progress, so “to date” falls toward the right edge for that reason. Compare the matured 90-day line.',
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
    chk('jira.signed', D.jira.filter(j => j.carson_signed).length, e.jira.signed);
    chk('jira.active', D.jira.filter(j => j.carson_active).length, e.jira.active);
    const su = SX.calc.stats(D.jira.map(j => SX.calc.days(j, 'uc'))), scl = SX.calc.stats(D.jira.map(j => SX.calc.days(j, 'closed')));
    chk('q1.uc.n', su.n, e.q1.uc.n); chk('q1.uc.median', su.median, e.q1.uc.median); chk('q1.uc.mean', +su.mean.toFixed(2), e.q1.uc.mean);
    chk('q1.closed.n', scl.n, e.q1.closed.n); chk('q1.closed.median', scl.median, e.q1.closed.median); chk('q1.closed.mean', +scl.mean.toFixed(2), e.q1.closed.mean);
    const sig = D.jira.filter(j => j.carson_signed);
    chk('q1.km_uc_signed', SX.calc.km(sig, 'uc').median, e.q1.km_uc_signed);
    chk('q1.km_closed_signed', SX.calc.km(sig, 'closed').median, e.q1.km_closed_signed);
    const act = D.jira.filter(j => j.carson_active);
    chk('q2.active_uc', act.filter(j => j.uc_d != null).length, e.q2.active_uc);
    chk('q2.active_closed', act.filter(j => j.closed_d != null).length, e.q2.active_closed);
    const nm = SX.calc.monthCounts(sig, 'start'), um = SX.calc.monthCounts(D.jira, 'uc');
    const bad = e.q3.filter(r => (nm.get(r.month) || 0) !== r.new_signed_start || (um.get(r.month) || 0) !== r.uc).length;
    chk('q3.monthly_mismatches', bad, 0);
    return { ok: out.every(x => x.ok), checks: out };
  };
})();
