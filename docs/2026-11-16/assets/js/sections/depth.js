/* Depth added on 18 Nov 2026 to the existing sections (app.js calls SX.extend[id] after each section renders):
   questions  monthly Won / starts / UC with month-on-month and year-on-year growth; the actual hunting backlog
   sales      qualification by month, open-deal age, time to win and to loss
   lifecycle  the Pipedrive -> Jira handoff, and won deals recovered by the Cash Forecast audit
   reporting  repeat service sales / searches / purchases, STR Cribs selection vs verified handoff, contract fall-through,
              booked fees -> contract balances -> expected collections -> forecast cash
   health     cross-checks against the Executive Report (same snapshot)
   definitions the glossary: counting unit, date basis, source and calculation for every business term */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;
  const X = SX.extend = {};
  const sub = (root, title, hint, id) => root.append(el('div', { class: 'subhead', id: id || null }, [el('h3', { text: title }), hint ? el('span', { class: 'hint', text: hint }) : null]));
  const money = v => U.fmtMoney(v, true);

  /* ------------------------------------------------------------ Key questions: growth + backlog */
  X.questions = function (root) {
    const q3 = root.querySelector('#q3') || root;
    const G = SX.data.views.growth;
    if (!G) return;
    const v = { mode: 'mom' };
    const NOTE = { early: 'a', rule: 'b', ucgap: 'c', zero: '–' };
    const box = el('div', { class: 'grid grid-12 mt-2', id: 'growth' });
    q3.append(box);
    const l = el('div', { class: 'span-8' }), r = el('div', { class: 'span-4' });
    box.append(l, r);
    const card = C.card(l, {
      id: 'q3-growth', title: 'Monthly Won, starts and Under Contract, with growth', subtitle: 'Pipedrive Won, confirmed Jira starts and UC events by month · all clients (not filtered) · the table shows growth only where both periods count the same way', height: 300,
      tools: [SX.ui.seg('', [{ value: 'mom', label: 'Month on month' }, { value: 'yoy', label: 'Year on year' }], 'mom', x => { v.mode = x; card.invalidate(); })],
      render({ t }) {
        const rows = G.rows;
        const g = (row, k) => { const x = row[k + '_' + v.mode]; return x.pct == null ? (x.why === 'zero' ? '–' : 'n/c ' + NOTE[x.why]) : (x.pct > 0 ? '+' : '') + (100 * x.pct).toFixed(0) + '%'; };
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip((x, p) => U.fmtInt(x) + '  (' + g(rows[p.dataIndex], ['won', 'starts', 'uc'][p.seriesIndex]) + ' ' + (v.mode === 'mom' ? 'MoM' : 'YoY') + ')') }),
            xAxis: C.catAxis(t, rows.map(x => U.fmtMonth(x.month, true) + (x.partial ? '*' : ''))), yAxis: C.valAxis(t),
            series: [C.line('Won (Pipedrive)', rows.map(x => x.won), t.series[2], { showSymbol: true, symbolSize: 5 }), C.line('Confirmed starts (Jira)', rows.map(x => x.starts), t.series[1], { showSymbol: true, symbolSize: 5 }), C.line('Under Contract', rows.map(x => x.uc), t.series[0], { showSymbol: true, symbolSize: 5 })] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'w', label: 'Won', num: true }, { key: 'wg', label: v.mode === 'mom' ? 'MoM' : 'YoY', num: true }, { key: 's', label: 'Starts', num: true }, { key: 'sg', label: v.mode === 'mom' ? 'MoM' : 'YoY', num: true },
            { key: 'u', label: 'UC', num: true }, { key: 'ug', label: v.mode === 'mom' ? 'MoM' : 'YoY', num: true }, { key: 'd', label: 'Starts − UC' }],
            rows: rows.slice().reverse().map(x => ({ m: U.fmtMonth(x.month) + (x.partial ? ' (1–' + x.days + ', partial)' : ''), w: x.won, wg: g(x, 'won'), s: x.starts, sg: g(x, 'starts'), u: x.uc, ug: g(x, 'uc'),
              d: x.diff > 0 ? x.diff + ' more starts than contracts' : x.diff < 0 ? -x.diff + ' more contracts than starts' : 'as many starts as contracts' })) },
          foot: 'n/c = not comparable: <b>a</b> ' + U.escapeHtml(G.reasons.early) + ' <b>b</b> ' + U.escapeHtml(G.reasons.rule) + ' <b>c</b> ' + U.escapeHtml(G.reasons.ucgap) + ' * partial month, compared with the same days.',
        };
      },
    });
    SX.live(r, b => {
      const hun = SX.model.jira({ population: 'hunting', ignorePeriod: true }), asof = SX.data.asofDay;
      const age = hun.filter(j => j.start_d != null).map(j => asof - j.start_d);   // clients without a start date are counted, not aged
      b.append(el('div', { class: 'callout mt-0' }, [el('h4', {}, [SX.term('backlog', 'The actual backlog')]),
        el('p', {}, [el('b', { text: U.fmtInt(hun.length) + ' clients are hunting today' }), ' (Client Start to 8 Weeks). The ' + U.fmtInt(age.length) + ' with a start date have waited a median ' + U.fmtInt(U.median(age)) + ' days; ' + U.fmtInt(age.filter(x => x > 90).length) + ' more than 90 days' + (hun.length > age.length ? '; ' + U.fmtInt(hun.length - age.length) + ' have no start date (no won deal linked).' : '.')]),
        el('p', { class: 'small muted', text: 'Use this count, not the monthly net change, for the backlog: net change (starts − UC) compares different clients and leaves out pauses, refunds and restarts, so it is never added up. Respects the package, channel, rep and experience filters.' }),
        el('a', { href: '#cohorts', text: 'Compare starts on the same clock in the cohort builder →' })]));
    });
  };

  /* ------------------------------------------------------------ Sales: qualification, open-deal age, time to win / loss */
  X.sales = function (root) {
    sub(root, 'Qualification, open deals and the sales cycle', 'All respect the filters', 'sales-depth');
    const g = el('div', { class: 'grid grid-2' });
    root.append(g);
    C.card(g, {
      id: 'sales-qual', title: 'Qualified deals by creation month', subtitle: 'Share of each month’s deals with the reporting layer’s qualification flag (pd_qualified)', height: 300,
      render({ t }) {
        const deals = SX.model.deals(), months = SX.model.months('2024-02');
        const gm = U.groupBy(deals, d => U.monthKeyFromDay(d.created_d));
        const n = months.map(k => (gm.get(k) || []).length), q = months.map(k => (gm.get(k) || []).filter(d => d.pd_qualified).length), w = months.map(k => (gm.get(k) || []).filter(d => d.status === 'won').length);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => x + '%') }), xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t, { fmt: x => x + '%', max: 100 }),
            series: [C.line('Qualified', months.map((k, i) => (n[i] ? +(100 * q[i] / n[i]).toFixed(1) : null)), t.series[0], { showSymbol: true, symbolSize: 5 }), C.line('Won to date', months.map((k, i) => (n[i] ? +(100 * w[i] / n[i]).toFixed(1) : null)), t.series[2], { showSymbol: true, symbolSize: 5 })] }),
          table: { columns: [{ key: 'm', label: 'Created' }, { key: 'n', label: 'Deals', num: true }, { key: 'q', label: 'Qualified', num: true }, { key: 'qs', label: '% qualified', num: true, fmt: x => U.fmtPct(x, 1) }, { key: 'w', label: 'Won to date', num: true }, { key: 'wq', label: 'Won ÷ qualified', num: true, fmt: x => x == null ? '–' : U.fmtPct(x, 1) }],
            rows: months.map((k, i) => ({ m: U.fmtMonth(k), n: n[i], q: q[i], qs: n[i] ? q[i] / n[i] : null, w: w[i], wq: q[i] ? w[i] / q[i] : null })) },
          foot: 'From June 2026 no-show bookings leave the STR Search pipeline, which shrinks the denominator and lifts both shares.',
        };
      },
    });
    C.card(g, {
      id: 'sales-age', title: 'Open deals by age', subtitle: 'Days since the deal was created, for deals neither won nor lost · split by current stage group', height: 300,
      render({ t }) {
        const open = SX.model.deals().filter(d => d.status === 'open'), asof = SX.data.asofDay;
        if (!open.length) return { empty: true };
        const B = [[0, 7, '0–7 d'], [8, 30, '8–30 d'], [31, 60, '31–60 d'], [61, 90, '61–90 d'], [91, 180, '91–180 d'], [181, 365, '181–365 d'], [366, 1e9, '1 yr+']];
        const stages = SX.data.defs.stages.map(s => s.name);
        const grpOf = s => { const i = stages.indexOf(s); return i < 0 ? 'Other' : i < 5 ? 'Early (booked to follow-up 2)' : i < 10 ? 'Engaged / hot / long-term' : 'Onboarding to contract'; };
        const GS = ['Early (booked to follow-up 2)', 'Engaged / hot / long-term', 'Onboarding to contract', 'Other'];
        const cnt = GS.map(gn => B.map(([a, b]) => open.filter(d => grpOf(d.stage) === gn && asof - d.created_d >= a && asof - d.created_d <= b).length));
        const ages = open.map(d => asof - d.created_d);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => U.fmtInt(x) + ' deals') }), xAxis: C.catAxis(t, B.map(b => b[2])), yAxis: C.valAxis(t),
            series: GS.map((gn, i) => C.stackBar(gn, cnt[i], [t.series[2], t.series[1], t.series[0], t.deemph][i], 'a', t)) }),
          table: { columns: [{ key: 's', label: 'Stage' }, { key: 'n', label: 'Open deals', num: true }, { key: 'm', label: 'Median age (days)', num: true }, { key: 'o', label: 'Older than 90 days', num: true }],
            rows: Array.from(U.groupBy(open, d => d.stage || '(blank)').entries()).map(([s, arr]) => { const a = arr.map(d => asof - d.created_d); return { s, n: arr.length, m: U.median(a), o: a.filter(x => x > 90).length }; }) },
          foot: U.fmtInt(open.length) + ' open deals; median age ' + U.fmtInt(U.median(ages)) + ' days; ' + U.fmtInt(ages.filter(x => x > 90).length) + ' older than 90 days. The base keeps no stage history, so age is time since creation, not time in the current stage.',
        };
      },
    });
    C.card(g, {
      id: 'sales-cycle', title: 'Time to win and time to loss', subtitle: 'Days from deal creation to the won or lost date · decided deals created in the period', height: 300, cls: 'span-all',
      render({ t }) {
        const deals = SX.model.deals();
        const won = deals.filter(d => d.status === 'won' && d.days_to_win != null && d.days_to_win >= 0).map(d => d.days_to_win);
        const lost = deals.filter(d => d.status === 'lost' && d.lost_date_d != null && d.created_d != null && d.lost_date_d >= d.created_d).map(d => d.lost_date_d - d.created_d);
        const B = [[0, 7, '0–7'], [8, 14, '8–14'], [15, 30, '15–30'], [31, 60, '31–60'], [61, 90, '61–90'], [91, 180, '91–180'], [181, 1e9, '181+']];
        const c = arr => B.map(([a, b]) => arr.filter(x => x >= a && x <= b).length);
        const byCh = Array.from(U.groupBy(deals.filter(d => d.status !== 'open'), d => d.channel || 'Unknown').entries()).map(([ch, arr]) => {
          const w = arr.filter(d => d.status === 'won').map(d => d.days_to_win).filter(x => x != null && x >= 0), l = arr.filter(d => d.status === 'lost' && d.lost_date_d != null).map(d => d.lost_date_d - d.created_d).filter(x => x >= 0);
          return { ch, n: arr.length, w: w.length, mw: U.median(w), l: l.length, ml: U.median(l) };
        }).sort((a, b) => b.n - a.n);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => U.fmtInt(x) + ' deals') }), xAxis: C.catAxis(t, B.map(b => b[2] + ' d')), yAxis: C.valAxis(t),
            series: [C.bar('Won', c(won), t.series[0]), C.bar('Lost', c(lost), t.series[3])] }),
          table: { columns: [{ key: 'ch', label: 'Lead channel' }, { key: 'n', label: 'Decided deals', num: true }, { key: 'w', label: 'Won', num: true }, { key: 'mw', label: 'Median days to win', num: true, fmt: U.fmtMed }, { key: 'l', label: 'Lost', num: true }, { key: 'ml', label: 'Median days to loss', num: true, fmt: U.fmtMed }], rows: byCh },
          foot: 'Median days to win ' + U.fmtMed(U.median(won)) + ' (n ' + U.fmtInt(won.length) + '); to loss ' + U.fmtMed(U.median(lost)) + ' (n ' + U.fmtInt(lost.length) + '). Open deals are not counted; for how many win within N days of creation by channel, use the cohort builder.',
        };
      },
    });
  };

  /* ------------------------------------------------------------ Connected: handoff and audit */
  X.lifecycle = function (root) {
    sub(root, 'From a won deal to a Jira client: the handoff', 'Won deals by won month · respects the filters', 'handoff');
    const g = el('div', { class: 'grid grid-12' });
    root.append(g);
    const l = el('div', { class: 'span-7' }), r = el('div', { class: 'span-5' });
    g.append(l, r);
    C.card(l, {
      id: 'life-handoff', title: 'What happened to each month’s won deals in Jira', subtitle: 'Confirmed start · Jira issue but not started · no Jira match in the reporting layer', height: 320,
      render({ t }) {
        const eng = SX.model.eng({ dateField: 'won_date' }), months = SX.model.months('2024-02');
        const cls = e => (e.confirmed_start ? 'Confirmed start' : e.has_jira ? 'Jira issue, not started (pre-sale or no start date)' : 'No Jira match (Pipedrive fallback)');
        const K = ['Confirmed start', 'Jira issue, not started (pre-sale or no start date)', 'No Jira match (Pipedrive fallback)'];
        const by = K.map(k => months.map(m => eng.filter(e => cls(e) === k && U.monthKeyFromDay(e.won_date_d) === m).length));
        const lag = eng.filter(e => e.confirmed_start && e.start_rule !== 'won' && e.start_d != null && e.won_date_d != null).map(e => e.start_d - e.won_date_d);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => U.fmtInt(x)) }), xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t),
            series: K.map((k, i) => C.stackBar(k, by[i], [t.series[0], t.series[1], t.series[3]][i], 'h', t)) }),
          table: { columns: [{ key: 'm', label: 'Won month' }].concat(K.map((k, i) => ({ key: 'k' + i, label: k, num: true }))), rows: months.map((m, j) => Object.assign({ m: U.fmtMonth(m) }, Object.fromEntries(K.map((k, i) => ['k' + i, by[i][j]])))) },
          foot: 'Before the 1 Jun 2026 rule a start is the kickoff date, a median ' + U.fmtMed(U.median(lag)) + ' days after the won date (n ' + U.fmtInt(lag.length) + '); from June it is the won date itself. Deals without a Jira match were resolved by the Cash Forecast audit (right).',
        };
      },
    });
    SX.live(r, box => {
      const eng = SX.model.eng({ ignorePeriod: true, dateField: 'won_date' }).filter(e => e.audit && e.audit !== 'jira');
      const lab = (SX.data.defs.budget || {}).audit || {};
      const rows = Array.from(U.groupBy(eng, e => e.audit).entries()).map(([k, arr]) => ({ k: lab[k] || k, n: arr.length, v: U.sum(arr, e => e.value), y26: arr.filter(e => (e.won_date || '').startsWith('2026')).length }));
      box.append(el('h4', { class: 'mt-0' }, [SX.term('audit', 'Won deals recovered or flagged by the audit')]),
        SX.ui.table({ sortKey: 'n', columns: [{ key: 'k', label: 'Resolution' }, { key: 'n', label: 'Won deals', num: true }, { key: 'y26', label: 'Won in 2026', num: true }, { key: 'v', label: 'Booked value', num: true, fmt: money }], rows }),
        el('p', { class: 'small muted', text: 'Every won deal without a Jira match in the reporting layer, and every post-close record without a closing date, as the Cash Forecast reconciliation resolved them (e-mail, the Jira key typed in Pipedrive, onboarding forms, brokerage / lender / affiliate records). Second deals under review stay separate from confirmed repeat purchases. Not limited by the period filter.' }));
    });
  };

  /* ------------------------------------------------------------ Engagements: repeats, Cribs, fall-through, cash bridge */
  X.reporting = function (root) {
    /* repeats */
    sub(root, 'Repeat clients: service sales, searches and purchases', 'Unique clients · not limited by the period filter', 'repeats');
    SX.live(root, box => {
      const eng = SX.model.eng({ ignorePeriod: true });
      const byC = U.groupBy(eng, e => e.client);
      const dist = n => Array.from(byC.values()).filter(a => a.length === n).length;
      const rep = Array.from(byC.values()).filter(a => a.length >= 2);
      const noIssue = eng.filter(e => e.audit === 'repeat_no_issue'), review = eng.filter(e => e.audit === 'second_review');
      const jira = SX.model.jira({ ignorePeriod: true, population: 'signed' });
      const byJ = U.groupBy(jira, j => j.client);
      const jc = Array.from(byJ.values());
      const multi = jc.filter(a => a.length >= 2), two = jc.filter(a => a.filter(j => j.stage === 'purchased').length >= 2);
      const purs = jc.filter(a => a.some(j => j.stage === 'purchased') && a.some(j => j.stage === 'hunting' || j.stage === 'under_contract'));
      const k = el('div', { class: 'kpi-row' });
      SX.ui.kpi(k, { label: 'Clients with 2+ won deals (repeat service sales)', value: U.fmtInt(rep.length), sub: U.fmtInt(dist(2)) + ' with two, ' + U.fmtInt(rep.length - dist(2)) + ' with three or more · ' + U.fmtInt(U.sum(rep, a => a.length)) + ' deals of ' + U.fmtInt(byC.size) + ' clients' });
      SX.ui.kpi(k, { label: 'Repeat deals without their own Jira issue', value: U.fmtInt(noIssue.length + review.length), sub: U.fmtInt(noIssue.length) + ' confirmed repeat purchases + ' + U.fmtInt(review.length) + ' second deals under review (kept apart)' });
      SX.ui.kpi(k, { label: 'Jira clients with 2+ searches', value: U.fmtInt(multi.length), sub: 'of ' + U.fmtInt(byJ.size) + ' Jira clients · ' + U.fmtInt(U.sum(multi, a => a.length)) + ' signed-up searches' });
      SX.ui.kpi(k, { label: 'Clients with 2+ completed purchases', value: U.fmtInt(two.length), sub: U.fmtInt(two.filter(a => a.filter(j => j.stage === 'purchased').length === 2).length) + ' with two, ' + U.fmtInt(two.filter(a => a.filter(j => j.stage === 'purchased').length >= 3).length) + ' with three or more' });
      SX.ui.kpi(k, { label: 'Pursuing their next purchase', value: U.fmtInt(purs.length), sub: 'a completed purchase and a search now hunting or under contract' });
      box.append(k, el('p', { class: 'small muted' }, [SX.term('client', 'How clients are matched'), ' · ', SX.term('repeat', 'What counts as a repeat'), ' · Pipedrive counts every won deal; Jira only searches with their own signed-up issue, so the two sides differ by the repeat deals without an issue. Use “First vs repeat search” in the cohort builder to compare their outcomes.']));
    });
    /* Cribs */
    sub(root, 'STR Cribs: selected vs verified handoff', 'Completed purchases · not limited by the period filter', 'cribs');
    const g2 = el('div', { class: 'grid grid-2' });
    root.append(g2);
    C.card(g2, {
      id: 'cribs-year', title: 'Designer recorded on completed purchases, by closing year', subtitle: 'Jira Designer Used (a recorded selection) · line: Cribs handoff verified in the Cribs tracker', height: 300,
      render({ t }) {
        const pur = SX.model.jira({ ignorePeriod: true }).filter(j => j.stage === 'purchased');
        const yr = j => (j.closed || j.start || j.created || '').slice(0, 4);
        const ys = U.uniq(pur.map(yr)).filter(Boolean).sort();
        const K = [['STR Cribs', t.series[0]], ['Other designer', t.series[2]], ['Bought turnkey', t.series[4]], [null, t.deemph]];
        const cnt = K.map(([k]) => ys.map(y => pur.filter(j => yr(j) === y && (j.designer_cat || null) === k).length));
        const hand = ys.map(y => pur.filter(j => yr(j) === y && j.cribs_tracker === 'Handed off to PM').length);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => U.fmtInt(x)) }), xAxis: C.catAxis(t, ys), yAxis: C.valAxis(t),
            series: K.map(([k, col], i) => C.stackBar(k || 'Not recorded', cnt[i], col, 'd', t)).concat([C.line('Cribs handoff verified', hand, t.ink2, { showSymbol: true, symbolSize: 7 })]) }),
          table: { columns: [{ key: 'y', label: 'Year' }, { key: 'n', label: 'Purchases', num: true }].concat(K.map(([k], i) => ({ key: 'k' + i, label: k || 'Not recorded', num: true }))).concat([{ key: 'h', label: 'Handoff verified', num: true }]),
            rows: ys.map((y, j) => Object.assign({ y, n: pur.filter(x => yr(x) === y).length, h: hand[j] }, Object.fromEntries(K.map((k, i) => ['k' + i, cnt[i][j]])))) },
          foot: 'Selection is what Jira records as the designer; a verified handoff is a Cribs deal at the purchase address in “Handed off to PM” (Cribs tracker, matched by address). The designer field was rarely filled before 2025.',
        };
      },
    });
    SX.live(g2, box => {
      const jira = SX.model.jira({ ignorePeriod: true });
      const buyers = jira.filter(j => j.stage === 'purchased' && j.client_purchases >= 2);
      const first = buyers.filter(j => j.purchase_no === 1), later = buyers.filter(j => j.purchase_no > 1);
      const row = (lab, arr) => ({ lab, n: arr.length, c: arr.filter(j => j.designer_cat === 'STR Cribs').length, o: arr.filter(j => j.designer_cat === 'Other designer').length, tk: arr.filter(j => j.designer_cat === 'Bought turnkey').length, u: arr.filter(j => !j.designer_cat).length, h: arr.filter(j => j.cribs_tracker === 'Handed off to PM').length });
      const byC = U.groupBy(buyers, j => j.client);
      let both = 0, firstC = 0;
      byC.forEach(arr => { const f = arr.find(j => j.purchase_no === 1), l2 = arr.filter(j => j.purchase_no > 1); if (f && f.designer_cat === 'STR Cribs') { firstC++; if (l2.some(j => j.designer_cat === 'STR Cribs')) both++; } });
      box.append(el('div', { class: 'card card-pad' }, [el('h3', { class: 'card-title' }, [SX.term('cribs', 'Repeat buyers: STR Cribs on the first and later purchases')]),
        el('p', { class: 'card-subtitle', text: U.fmtInt(byC.size) + ' Jira clients with two or more completed purchases · ' + U.fmtInt(both) + ' of the ' + U.fmtInt(firstC) + ' who chose Cribs the first time chose it again' }),
        SX.ui.table({ sortable: false, columns: [{ key: 'lab', label: 'Purchases' }, { key: 'n', label: 'Count', num: true }, { key: 'c', label: 'STR Cribs', num: true }, { key: 'o', label: 'Other designer', num: true }, { key: 'tk', label: 'Turnkey', num: true }, { key: 'u', label: 'Not recorded', num: true }, { key: 'h', label: 'Handoff verified', num: true }],
          rows: [row('First purchase', first), row('Later purchases', later)] }),
        el('p', { class: 'small muted', text: 'Selection, not proof of use: the tracker confirms far fewer later-purchase projects than Jira records as selected, so later handoffs may be unlogged or under another address.' })]));
    });
    /* fall-through */
    sub(root, 'Contracts that fall through', 'Signed-up clients known to have gone under contract · not limited by the period filter', 'fallthrough');
    const g3 = el('div', { class: 'grid grid-12' });
    root.append(g3);
    const fl = el('div', { class: 'span-7' }), fr = el('div', { class: 'span-5' });
    g3.append(fl, fr);
    const FG = [['documented', 'Documented (fall-out address)'], ['ended', 'Contract ended, no purchase'], ['returned', 'Back under contract after a search'], ['second_entry', 'UC entered twice, then bought'], ['none', 'No sign of a fall-through']];
    const STG = [['purchased', 'Completed purchase'], ['under_contract', 'Under contract'], ['hunting', 'Hunting'], ['paused', 'Paused'], ['refunded', 'Refunded'], ['additional', 'Additional Service']];
    C.card(fl, {
      id: 'fall-groups', title: 'Fall-through evidence and where those clients stand today', subtitle: 'Each client in one evidence group · bars split by today’s stage', height: 300,
      render({ t }) {
        const j = SX.model.jira({ ignorePeriod: true }).filter(x => x.fallout != null);
        if (!j.length) return { empty: true };
        const cols = [t.series[0], t.series[2], t.series[1], t.deemph, t.series[3], t.deemph2];
        const FC = FG.filter(([k]) => k !== 'none');
        const data = STG.map(([s]) => FC.map(([k]) => j.filter(x => x.fallout === k && x.stage === s).length));
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 40, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(x => U.fmtInt(x) + ' clients') }),
            yAxis: C.catAxis(t, FC.map(f => f[1]).reverse()), xAxis: C.valAxis(t),
            series: STG.map(([s, lab], i) => C.stackBar(lab, data[i].slice().reverse(), cols[i], 'f', t)) }),
          table: { columns: [{ key: 'g', label: 'Evidence group' }, { key: 'n', label: 'Clients', num: true }, { key: 'p', label: '% of known UC', num: true, fmt: x => U.fmtPct(x, 1) }].concat(STG.map(([s, lab]) => ({ key: s, label: lab, num: true }))),
            rows: FG.map(([k, lab]) => Object.assign({ g: lab, n: j.filter(x => x.fallout === k).length, p: j.filter(x => x.fallout === k).length / j.length }, Object.fromEntries(STG.map(([s]) => [s, j.filter(x => x.fallout === k && x.stage === s).length])))) },
          foot: 'The chart leaves out the ' + U.fmtInt(j.filter(x => x.fallout === 'none').length) + ' clients with no sign of a fall-through (in the table). ' + U.fmtInt(j.length) + ' signed-up clients are known to have gone under contract (a UC date or entry, a fall-out address, or a completed purchase).',
        };
      },
    });
    SX.live(fr, box => {
      const j = SX.model.jira({ ignorePeriod: true }).filter(x => x.fallout != null);
      const doc = j.filter(x => x.fallout === 'documented'), end = j.filter(x => x.fallout === 'ended'), ret = j.filter(x => x.fallout === 'returned');
      box.append(el('div', { class: 'callout mt-0' }, [el('h4', {}, [SX.term('fallout', 'What can and cannot be verified')]),
        el('ul', {}, [
          el('li', { text: U.fmtInt(doc.length) + ' of ' + U.fmtInt(j.length) + ' (' + U.fmtPct(doc.length / j.length, 1) + ') have a documented fall-out address; in every one it is the address still under contract, so no replacement property is documented. ' + U.fmtInt(doc.filter(x => x.stage === 'purchased').length) + ' later bought that same address.' }),
          el('li', { text: U.fmtInt(end.length) + ' more had a contract that ended without a purchase (status evidence): ' + STG.filter(([s]) => end.some(x => x.stage === s)).map(([s, lab]) => U.fmtInt(end.filter(x => x.stage === s).length) + ' ' + lab.toLowerCase()).join(', ') + '.' }),
          el('li', { text: U.fmtInt(ret.length) + ' are back under contract after returning to the search: new contracts by status; their property is not recorded.' }),
        ]),
        el('p', { class: 'small muted', text: 'Missing evidence: a dated record of each contract and its property. Jira’s fall-out field is filled for 12 issues; the reporting layer keeps only the latest valid UC date; a second UC entry can be a new contract or a repeated status entry. Source: 12 Nov Jira extract (data to 11 Nov) + 16 Nov statuses.' })]));
    });
    /* cash bridge */
    sub(root, 'Booked fees, expected collections and forecast cash', 'Won deals · at the Cash Forecast’s default assumptions · not filtered', 'cashbridge');
    const B = SX.data.views.cash_bridge;
    if (!B) return;
    const g4 = el('div', { class: 'grid grid-12' });
    root.append(g4);
    const bl = el('div', { class: 'span-7' }), br = el('div', { class: 'span-5' });
    g4.append(bl, br);
    C.card(bl, {
      id: 'cash-bridge', title: 'Where the outstanding balance on won deals sits', subtitle: 'Outstanding second installments by Cash Forecast group · won deals in each group', height: 320,
      render({ t }) {
        const gs = B.groups.filter(x => x.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
        return {
          option: C.base(t, { grid: { left: 6, right: 70, top: 10, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => { const x = gs[gs.length - 1 - p.dataIndex]; return { title: x.label, rows: [['outstanding', U.fmtMoney(x.outstanding)], ['won deals', U.fmtInt(x.n)]].concat(x.p_close != null ? [['chance of closing', U.fmtPct(x.p_close)]] : []) }; }) }),
            yAxis: C.catAxis(t, gs.map(x => x.label).reverse()), xAxis: C.valAxis(t, { fmt: x => money(x) }),
            series: [C.bar('Outstanding', gs.map(x => x.outstanding).reverse(), t.series[2], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: p => money(p.value) } })] }),
          table: { columns: [{ key: 'label', label: 'Cash Forecast group' }, { key: 'n', label: 'Won deals', num: true }, { key: 'outstanding', label: 'Outstanding', num: true, fmt: x => U.fmtMoney(x) }, { key: 'p_close', label: 'Chance of closing', num: true, fmt: x => x == null ? '–' : U.fmtPct(x) }], rows: B.groups },
        };
      },
    });
    const E = B.expected, link = (window.STR_VERSIONS && window.STR_VERSIONS.sites && window.STR_VERSIONS.sites.report.base) || 'https://ifrahamstr.github.io/STRSearchExecutiveReport/';
    br.append(el('div', { class: 'callout mt-0' }, [el('h4', {}, [SX.term('booked', 'From booked fees to forecast cash')]),
      el('ol', { class: 'bridge' }, [
        el('li', {}, [el('b', { text: money(B.booked_value_won_engagements) }), ' booked value on ' + U.fmtInt(B.engagements) + ' won deals (deal value).']),
        el('li', {}, [el('b', { text: money(B.contractual) }), ' contract balances: ' + money(B.assumed_collected) + ' assumed collected (at the win, or at closing under Split Pay), ' + money(B.gross_outstanding) + ' still outstanding.']),
        el('li', {}, [el('b', { text: money(E.service) }), ' expected service collections: ' + money(E.service_parts.contracts) + ' contracts in progress + ' + money(E.service_parts.searching) + ' clients still searching + ' + money(E.service_parts.paused) + ' paused clients who resume.']),
        el('li', {}, ['+ ', el('b', { text: money(E.affiliate) }), ' affiliate revenue (realtor, lender, STR Cribs) − ', el('b', { text: money(Math.abs(E.refunds)) }), ' future refunds.']),
        el('li', {}, [el('b', { text: money(E.net) }), ' estimated future net cash.']),
      ]),
      el('p', { class: 'small muted', text: 'Default assumptions: paused clients ' + B.defaults.paused.resume + '% resume / ' + B.defaults.paused.refund + '% refund / ' + B.defaults.paused.remain + '% stay paused; affiliate fees and conversions as on the Cash Forecast. Unverified records and second deals under review are not forecast. Matches the Cash Forecast to the cent (cross-checked on every build).' }),
      el('a', { href: link.replace(/\/$/, '') + '/2026-11-16/cash.html', target: '_blank', rel: 'noopener', text: 'Change the assumptions in the Cash Forecast →' })]));
  };

  /* ------------------------------------------------------------ Data health: cross-checks */
  X.health = function (root) {
    const cc = SX.data.raw.crosschecks || [];
    if (!cc.length) return;
    const anchor = root.querySelector('.subhead:last-of-type');
    const wrap = el('div', { id: 'crosschecks' });
    wrap.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Cross-checks against the Executive Report (same snapshot)' }), el('span', { class: 'hint', text: 'Hard checks · the build stops on any failure' })]),
      el('p', { class: 'small muted', text: cc.filter(x => x.ok).length + ' of ' + cc.length + ' pass: the budget groups, 14–90-day cohorts, client stages, repeat clients, STR Cribs, fall-through evidence, the audit resolution, the Cash Forecast groups and default totals, and the monthly growth table all equal the audited Client Journey and Cash Forecast figures.' }),
      SX.ui.table({ sortable: false, columns: [{ key: 'check', label: 'Check' }, { key: 'ok', label: 'Status', html: (x, r) => SX.ui.status(r.ok ? 'good' : 'critical', r.ok ? 'Pass' : 'Fail') }], rows: cc }));
    if (anchor) root.insertBefore(wrap, anchor); else root.append(wrap);
  };

  /* ------------------------------------------------------------ Definitions: glossary */
  X.definitions = function (root) {
    const T = SX.data.defs.terms || [];
    if (!T.length) return;
    const wrap = el('div', { id: 'glossary' });
    wrap.append(el('h3', { class: 'mt-2', text: 'Glossary: how each business term is counted' }),
      el('p', { class: 'small muted', text: 'The same entries open from the small “?” next to a term elsewhere on the page.' }),
      SX.ui.table({ sortable: false, cls: 'glossary', columns: [{ key: 'term', label: 'Term' }, { key: 'unit', label: 'Counted as' }, { key: 'date', label: 'Date' }, { key: 'source', label: 'Source' }, { key: 'calc', label: 'Calculation' }], rows: T }));
    const first = root.querySelector('h3');
    if (first) root.insertBefore(wrap, first); else root.append(wrap);
  };
})();
