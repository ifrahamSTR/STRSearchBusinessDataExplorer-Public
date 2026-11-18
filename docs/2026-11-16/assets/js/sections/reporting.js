/* Engagements, cohorts and modeled cash (16 Nov 2026 reporting layer): won_clients_master grain.
   Net client flow, matured cohorts by experience, contract-to-close milestones, refunds, HENRY, links between
   Pipedrive and Jira, and the modeled cash view (assumptions, never receipts). */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;

  SX.sections.reporting = function (root) {
    SX.head(root, 'reporting', 'Section 8 · Engagements, repeats, fall-through & cash', 'One row per won deal: flows, cohorts, refunds and modeled cash',
      'won_clients_master keeps every won STR Search deal (refunds, repeats and deals without a Jira match included). Flows are counted by event date; cohorts by client start; cash is modeled from deal value and payment type, not collected.');

    /* ------------------------------------------------ net flow */
    const g1 = el('div', { class: 'grid grid-12' });
    root.append(g1);
    const f1 = el('div', { class: 'span-8' }), n1 = el('div', { class: 'span-4' });
    g1.append(f1, n1);
    C.card(f1, {
      id: 'rep-flow', title: 'Net client change per month and its running total', subtitle: 'Client Started − Under Contract events · running total from Jan 2024 (not the hunting backlog) · respects Pipedrive filters', height: 320,
      render({ t }) {
        const all = SX.model.eng({ ignorePeriod: true });
        const months = SX.model.months('2024-01');
        const st = SX.calc.monthCounts(all.filter(e => e.confirmed_start), 'start'), uc = SX.calc.monthCounts(all, 'uc');
        const firstAll = U.monthRange('2024-01', months[0] || '2024-01').slice(0, -1);
        let run = U.sum(firstAll, k => (st.get(k) || 0) - (uc.get(k) || 0));
        const net = months.map(k => (st.get(k) || 0) - (uc.get(k) || 0));
        const cum = net.map(v => (run += v));
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => (v > 0 ? '+' : '') + U.fmtInt(v)) }),
            xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t),
            series: [C.bar('Net change (starts − UC)', net.map(v => ({ value: v, itemStyle: { color: v >= 0 ? t.series[2] : t.series[0] } })), t.series[2]),
              C.line('Running total since Jan 2024', cum, t.ink2, { showSymbol: false })] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 's', label: 'Starts', num: true }, { key: 'u', label: 'UC', num: true }, { key: 'n', label: 'Net', num: true }, { key: 'c', label: 'Running total', num: true }],
            rows: months.map((k, i) => ({ m: U.fmtMonth(k), s: st.get(k) || 0, u: uc.get(k) || 0, n: net[i], c: cum[i] })) },
          foot: 'The SQL reference: cumulative net change “is NOT the actual hunting backlog”. Pauses, refunds, restarts and missing early UC dates are not netted out. For the current book of searching clients use the hunting count.',
        };
      },
    });
    SX.live(n1, box => {
      const ex = SX.data.expected, j = SX.model.jira({ population: 'hunting' });
      const asof = SX.data.asofDay, age = j.map(x => asof - x.start_d).filter(x => !Number.isNaN(x));
      box.append(el('div', { class: 'callout mt-0' }, [el('h4', { text: 'Hunting today' }),
        el('p', { text: U.fmtInt(j.length) + ' Jira clients are hunting (Client Start to 8 Weeks); median ' + U.fmtInt(U.median(age)) + ' days since their start, ' + U.fmtInt(age.filter(x => x > 90).length) + ' past 90 days. The SQL reference’s engagement count (hunting and a Jira match on a won deal) is ' + U.fmtInt(ex.engagements.hunting_official) + '.' }),
        el('p', { class: 'small muted', text: 'There is no historical snapshot of hunting clients, so past backlog levels cannot be reconstructed; the running total is a flow proxy only.' })]));
    });

    /* ------------------------------------------------ cohorts by experience */
    const ctl = el('div', { class: 'control-row mt-2' });
    root.append(ctl);
    const g2 = el('div', { class: 'grid grid-2' });
    root.append(g2);
    const v2 = { adj: false };
    const coh = C.card(g2, {
      id: 'rep-cohort-exp', title: 'Matured conversion by client experience', subtitle: 'Share of matured confirmed starts with UC within 14 / 30 / 45 / 60 / 90 days · Legacy vs New Client Experience', height: 300,
      render({ t }) {
        const rows = SX.model.eng({ population: 'confirmed' }), asof = SX.data.asofDay, W = SX.data.defs.cohort_windows;
        const exps = ['Legacy', 'New Client Experience'];
        const rate = (arr, w) => { let m = arr.filter(e => asof - e.start_d >= w); if (v2.adj) m = m.filter(e => !e.refunded); return m.length ? { r: 100 * m.filter(e => e.days_to_uc != null && e.days_to_uc >= 0 && e.days_to_uc <= w).length / m.length, n: m.length } : { r: null, n: 0 }; };
        const data = exps.map(x => W.map(w => rate(rows.filter(e => e.experience === x), w)));
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v == null ? '–' : v.toFixed(1) + '%') }),
            xAxis: C.catAxis(t, W.map(w => w + ' d')), yAxis: C.valAxis(t, { max: 100, fmt: v => v + '%' }),
            series: exps.map((x, i) => C.bar(x, data[i].map(d => d.r == null ? null : +d.r.toFixed(1)), [t.series[1], t.series[2]][i])) }),
          table: { columns: [{ key: 'w', label: 'Window' }].concat(exps.flatMap((x, i) => [{ key: 'r' + i, label: x + ' %', num: true, fmt: v => v == null ? '–' : v.toFixed(1) + '%' }, { key: 'n' + i, label: x + ' n', num: true }])),
            rows: W.map((w, wi) => Object.assign({ w: w + ' days' }, Object.fromEntries(exps.flatMap((x, i) => [['r' + i, data[i][wi].r], ['n' + i, data[i][wi].n]])))) },
          foot: 'Association, not cause: the New Client Experience (27 May 2026), the Complete package and the 1 June start-date rule (won date instead of a later kickoff date, which lengthens measured durations) overlap, and newer cohorts only enter the longer windows as they mature.',
        };
      },
    });
    ctl.append(SX.ui.seg('Denominator', [{ value: 'gross', label: 'Gross' }, { value: 'adj', label: 'Refund-excluded' }], 'gross', v => { v2.adj = v === 'adj'; coh.invalidate(); }));
    C.card(g2, {
      id: 'rep-milestones', title: 'From contract to closing', subtitle: 'Days between milestones · confirmed starts with both dates · completed closings only', height: 300,
      render({ t }) {
        const rows = SX.model.eng({ population: 'confirmed' });
        const steps = [['Start → UC', rows.map(e => e.uc_d != null ? e.uc_d - e.start_d : null)], ['UC → passed inspection', rows.map(e => e.uc_d != null && e.pi_d != null ? e.pi_d - e.uc_d : null)],
          ['Passed inspection → closing', rows.map(e => e.pi_d != null && e.closed_d != null ? e.closed_d - e.pi_d : null)], ['UC → closing', rows.map(e => e.days_uc_to_close)]];
        const st = steps.map(([k, v]) => ({ k, s: SX.calc.stats(v) }));
        const sched = rows.filter(e => e.closed_scheduled).length;
        return {
          option: C.base(t, { grid: { left: 6, right: 40, top: 10, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: p => U.escapeHtml(p.name) + ': median ' + U.fmtInt(p.value) + ' days' }),
            yAxis: C.catAxis(t, st.map(x => x.k).reverse()), xAxis: C.valAxis(t, { fmt: v => v + ' d' }),
            series: [C.bar('Median days', st.map(x => x.s.median).reverse(), t.series[4], { label: { show: true, position: 'right', color: t.ink2, formatter: p => U.fmtInt(p.value) + ' d' } })] }),
          table: { columns: [{ key: 'k', label: 'Step' }, { key: 'n', label: 'Clients', num: true }, { key: 'm', label: 'Median', num: true, fmt: U.fmtDays }, { key: 'a', label: 'Mean', num: true, fmt: v => U.fmt1(v) + ' d' }],
            rows: st.map(x => ({ k: x.k, n: x.s.n, m: x.s.median, a: x.s.mean })) },
          foot: U.fmtInt(sched) + ' further closings are dated after the data date (scheduled) and are not counted. Inspection is a new milestone in this version.',
        };
      },
    });

    /* ------------------------------------------------ refunds and HENRY */
    const g3 = el('div', { class: 'grid grid-2 mt-2' });
    root.append(g3);
    C.card(g3, {
      id: 'rep-refunds', title: 'Refunds by the month the Jira status changed to Refunded', subtitle: 'Won engagements whose current status is Refunded · status proxy, not refund transactions', height: 280,
      render({ t }) {
        const rows = SX.model.eng({ ignorePeriod: true }).filter(e => e.refunded && e.refund_date_d != null);
        if (!rows.length) return { empty: true };
        const months = U.monthRange(U.monthKeyFromDay(Math.min(...rows.map(e => e.refund_date_d))), SX.data.asofMonth);
        const m = SX.calc.monthCounts(rows, 'refund_date');
        return {
          option: C.base(t, { tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' refunded') }), xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t),
            series: [C.bar('Refunded', months.map(k => m.get(k) || 0), t.series[3])] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'n', label: 'Refunded', num: true }], rows: months.map(k => ({ m: U.fmtMonth(k), n: m.get(k) || 0 })) },
          foot: 'The date is when the status last changed to Refunded, so a spike can be a clean-up of statuses rather than a burst of refunds. Refunds that later changed status, or pre-date the Jira history, are missed.',
        };
      },
    });
    SX.live(g3, box => {
      const coh = SX.model.eng({ population: 'confirmed' });
      const byQ = U.groupBy(coh, e => U.quarterKeyFromDay(e.start_d));
      const rows = Array.from(byQ.entries()).filter(([k]) => k).sort().map(([k, arr]) => ({ k, n: arr.length, r: arr.filter(e => e.refunded).length, u: arr.filter(e => e.uc_d != null).length }));
      const jira = SX.model.jira({ population: 'signed' }), known = jira.filter(j => j.oop_known), henry = known.filter(j => j.henry);
      const ucKnown = jira.filter(j => j.uc_d != null), ucOop = ucKnown.filter(j => j.oop_known).length, huntOop = jira.filter(j => j.hunting && j.oop_known).length, hunt = jira.filter(j => j.hunting).length;
      box.append(el('h4', { text: 'Refund share by start quarter (confirmed starts)' }), SX.ui.table({ sortKey: 'k', sortDir: 1, columns: [
        { key: 'k', label: 'Start quarter' }, { key: 'n', label: 'Starts', num: true }, { key: 'r', label: 'Refunded now', num: true },
        { key: 'p', label: 'Share', num: true, sort: r => r.r / r.n, html: (v, r) => SX.ui.barCell(r.r, r.n, U.fmtPct(r.r / r.n), 'var(--series-4)') }, { key: 'u', label: 'Reached UC', num: true }], rows }),
        el('div', { class: 'callout mt-1' }, [el('h4', { text: 'HENRY (total out-of-pocket ≤ $225K)' }),
          el('p', { text: U.fmtInt(henry.length) + ' of ' + U.fmtInt(known.length) + ' signed-up clients with a known total_oop are HENRY (' + U.fmtPct(U.ratio(henry.length, known.length)) + '); ' + U.fmtInt(jira.length - known.length) + ' have no value, so their HENRY status is unknown, not “no”.' }),
          el('p', { class: 'small muted', text: 'total_oop is recorded for ' + U.fmtPct(U.ratio(ucOop, ucKnown.length)) + ' of clients who reached UC but only ' + U.fmtPct(U.ratio(huntOop, hunt)) + ' of hunting clients: it describes the purchase. Comparing HENRY speed would therefore compare buyers only (survivorship), so this build does not rank HENRY by speed.' })]));
    });

    /* ------------------------------------------------ links */
    SX.live(root, box => {
      const all = SX.model.eng({ ignorePeriod: true, dateField: 'won_date' });
      const nj = all.filter(e => !e.has_jira), byY = U.countBy(nj, e => (e.won_date || '').slice(0, 4));
      const rows = [
        ['Won engagements', all.length, 'every won STR Search deal'], ['With a unique Jira match', all.filter(e => e.has_jira).length, 'joined on the deal id parsed from the Jira deal URL'],
        ['Without a Jira match', nj.length, 'won ' + Array.from(byY.entries()).sort().map(([y, n]) => y + ': ' + n).join(', ') + ' · keep a Pipedrive fallback start'],
        ['Confirmed starts', all.filter(e => e.confirmed_start).length, 'client_start_date_source = JIRA'], ['Pipedrive fallback starts', all.filter(e => e.start_source === 'Pipedrive Fallback').length, 'not confirmed; excluded from starts and cohorts'],
        ['Jira issue still pre-sale', all.filter(e => e.has_jira && !e.signed).length, 'won in Pipedrive, Jira not yet a signed status'], ['Repeat engagements', all.filter(e => e.repeat_client).length, 'repeat_client = 1; each purchase is its own row'],
        ['Data anomalies', all.filter(e => e.anomaly).length, 'key mismatch ' + all.filter(e => e.key_mismatch).length + ' · hunting with a UC date ' + all.filter(e => e.anomaly_hunting_with_uc).length + ' · UC before start ' + all.filter(e => e.anomaly_uc_before_start).length]];
      box.append(el('div', { class: 'subhead mt-2' }, [el('h3', { text: 'How won deals link to Jira' }), el('span', { class: 'hint', text: 'Not filtered by period' })]),
        SX.ui.table({ sortable: false, columns: [{ key: 'a', label: 'Engagements' }, { key: 'n', label: 'Count', num: true }, { key: 'c', label: 'Note' }], rows: rows.map(([a, n, c]) => ({ a, n, c })) }));
    });

    /* ------------------------------------------------ modeled cash */
    root.append(el('div', { class: 'subhead mt-2' }, [el('h3', { text: 'Modeled cash (client_cash_forecast)' }), el('span', { class: 'hint', text: 'Assumptions, not receipts or revenue' })]));
    const g4 = el('div', { class: 'grid grid-12' });
    root.append(g4);
    const c1 = el('div', { class: 'span-7' }), c2 = el('div', { class: 'span-5' });
    g4.append(c1, c2);
    const v4 = { adj: false };
    const cash = C.card(c1, {
      id: 'rep-cash', title: 'Assumed collected vs modeled outstanding, by today’s status', subtitle: 'Won engagements won in the period · Paid In Full 100% at win; Split Pay 50% at win + 50% at closing', height: 320,
      render({ t }) {
        const rows = SX.model.eng({ dateField: 'won_date' });
        const grp = e => !e.has_jira ? 'No Jira match' : e.hunting ? 'Hunting' : e.status === 'Paused' ? 'Paused' : e.refunded ? 'Refunded' : (e.group || 'Other');
        const g = U.groupBy(rows, grp);
        const ks = Array.from(g.keys()).sort((a, b) => U.sum(g.get(b), e => e.cash_outstanding_cash_balance) - U.sum(g.get(a), e => e.cash_outstanding_cash_balance));
        const col = (e, k) => v4.adj ? (k === 'c' ? e.cash_refund_excluded_assumed_cash_collected : e.cash_refund_excluded_outstanding_cash_balance) : (k === 'c' ? e.cash_assumed_total_cash_collected : e.cash_outstanding_cash_balance);
        const cv = ks.map(k => U.sum(g.get(k), e => col(e, 'c'))), ov = ks.map(k => U.sum(g.get(k), e => col(e, 'o')));
        if (!rows.length) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 34, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtMoney(v, true)) }),
            yAxis: C.catAxis(t, ks.slice().reverse()), xAxis: C.valAxis(t, { fmt: v => U.fmtMoney(v, true) }),
            series: [C.stackBar('Assumed collected (modeled)', cv.slice().reverse(), t.series[0], 'c', t), C.stackBar('Outstanding (modeled)', ov.slice().reverse(), t.series[1], 'c', t)] }),
          table: { columns: [{ key: 'k', label: 'Status today' }, { key: 'n', label: 'Engagements', num: true }, { key: 'c', label: 'Assumed collected', num: true, fmt: v => U.fmtMoney(v, true) }, { key: 'o', label: 'Outstanding', num: true, fmt: v => U.fmtMoney(v, true) }],
            rows: ks.map((k, i) => ({ k, n: g.get(k).length, c: cv[i], o: ov[i] })) },
          foot: 'Modeled from deal value and payment type; the reporting layer has no QuickBooks or Stripe transactions. Outstanding sits largely with paused, refunded and Jira-less engagements, whose second installment may never be due.',
        };
      },
    });
    const ctl4 = el('div', { class: 'control-row' });
    c1.insertBefore(ctl4, c1.firstChild);
    ctl4.append(SX.ui.seg('View', [{ value: 'gross', label: 'Gross (all engagements)' }, { value: 'adj', label: 'Refund-excluded' }], 'gross', v => { v4.adj = v === 'adj'; cash.invalidate(); }));
    SX.live(c2, box => {
      const rows = SX.model.eng({ dateField: 'won_date' });
      const rec = rows.filter(e => e.payment_recorded).length, pif = rows.filter(e => e.cash_payment_type_normalized === 'Paid In Full').length;
      const sched = rows.filter(e => e.cash_second_on_scheduled_close), zero = rows.filter(e => e.value === 0).length;
      box.append(el('div', { class: 'callout callout--warn mt-0' }, [el('h4', { text: 'Assumptions behind these amounts' }), el('ul', {}, [
        el('li', { text: 'Payment type: ' + U.fmtInt(pif) + ' of ' + U.fmtInt(rows.length) + ' engagements are Paid In Full, but only ' + U.fmtInt(rec) + ' carry a recorded payment type; the base fills blanks with Split Pay, so outstanding is an upper bound.' }),
        el('li', { text: U.fmtInt(sched.length) + ' split-pay engagements have a closing date after the data date; the view already counts their second installment (' + U.fmtMoney(U.sum(sched, e => e.cash_second_installment_amount), true) + ') as collected.' }),
        el('li', { text: 'Refund-excluded zeroes the whole engagement for a Refunded status; it does not net actual refund dollars.' }),
        el('li', { text: U.fmtInt(zero) + ' won deals carry a deal value of $0 and contribute nothing.' }),
        el('li', { text: 'There is no forward monthly cash forecast yet: the second installment is dated to the actual closing month or left outstanding.' })])]));
    });
  };
})();
