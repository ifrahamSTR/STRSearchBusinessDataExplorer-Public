/* Sales: Pipedrive STR Search pipeline. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;

  SX.sections.sales = function (root) {
    SX.head(root, 'sales', 'Section 3 · Sales (Pipedrive)', 'The STR Search sales pipeline',
      'One deal per booked strategy call. Deals are counted with the official PD_Deals filter, dated by creation, and judged by today’s status (won, lost or open). Pipedrive has no stage history in these extracts, so every stage view is a current-state snapshot.');

    SX.live(root, box => {
      const deals = SX.model.deals(), won = deals.filter(d => d.status === 'won'), lost = deals.filter(d => d.status === 'lost');
      const row = el('div', { class: 'kpi-row' });
      SX.ui.kpi(row, { label: 'Deals created', value: U.fmtInt(deals.length), sub: U.fmtInt(deals.filter(d => d.status === 'open').length) + ' still open' });
      SX.ui.kpi(row, { label: 'Won', value: U.fmtInt(won.length), sub: 'Win rate so far ' + U.fmtPct(U.ratio(won.length, deals.length), 1) + ' · ' + U.fmtPct(U.ratio(won.length, won.length + lost.length), 1) + ' of decided deals' });
      SX.ui.kpi(row, { label: 'Booked value (won)', value: U.fmtMoney(U.sum(won, d => d.value), true), sub: 'Median deal ' + U.fmtMoney(U.median(won.map(d => d.value))) + ' · sales-entered' });
      SX.ui.kpi(row, { label: 'Median days to win', value: U.fmtInt(U.median(won.map(d => d.days_to_win))), unit: 'days', sub: 'Mean ' + U.fmt1(U.mean(won.map(d => d.days_to_win))) + ' days' });
      SX.ui.kpi(row, { label: 'No-show share', value: U.fmtPct(U.ratio(deals.filter(d => d.no_show).length, deals.length), 1), sub: 'Understated from Jun 2026 (no-shows move to SDR pipeline)' });
      box.append(row);
    });

    const g = el('div', { class: 'grid grid-2 mt-2' });
    root.append(g);
    C.card(g, {
      id: 'sales-monthly', title: 'Deals created and deals won per month', subtitle: 'Created by created date · won by won date (different deals in the same month)', height: 300,
      render({ t }) {
        const months = SX.model.months('2024-02');
        const created = SX.calc.monthCounts(SX.model.deals(), 'created');
        const wonM = SX.calc.monthCounts(SX.model.deals({ dateField: 'won_date' }).filter(d => d.status === 'won'), 'won_date');
        const a = months.map(k => created.get(k) || 0), b = months.map(k => wonM.get(k) || 0);
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }),
            xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t),
            series: [C.bar('Deals created', a, t.series[2]), C.bar('Deals won', b, t.series[0], {
              markLine: months.includes('2026-06') ? { symbol: 'none', silent: true, lineStyle: { color: t.muted, type: 'solid', width: 1 }, label: { color: t.muted, fontSize: 10, formatter: 'No-shows move to SDR' }, data: [{ xAxis: U.fmtMonth('2026-06', true) }] } : undefined })] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'a', label: 'Created', num: true }, { key: 'b', label: 'Won (by won date)', num: true }], rows: months.map((k, i) => ({ m: U.fmtMonth(k), a: a[i], b: b[i] })) },
        };
      },
    });
    C.card(g, {
      id: 'sales-winrate', title: 'Win rate by creation-month cohort', subtitle: 'Share of each month’s deals won within 90 days (matured cohorts) and won to date', height: 300,
      render({ t }) {
        const deals = SX.model.deals(), asof = SX.data.asofDay;
        const gm = U.groupBy(deals, d => U.monthKeyFromDay(d.created_d));
        const months = SX.model.months('2024-02').filter(k => gm.has(k));
        const w90 = months.map(k => { const arr = gm.get(k); if (asof - U.monthEndDay(k) < 90) return null; return +(100 * arr.filter(d => d.status === 'won' && d.days_to_win <= 90).length / arr.length).toFixed(1); });
        const ever = months.map(k => { const arr = gm.get(k); return +(100 * arr.filter(d => d.status === 'won').length / arr.length).toFixed(1); });
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => v + '%', { note: ps => 'Deals in cohort: ' + gm.get(months[ps[0].dataIndex]).length }) }),
            xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t, { fmt: v => v + '%' }),
            series: [C.line('Won within 90 days', w90, t.series[0], { showSymbol: true, symbolSize: 6 }), C.line('Won to date', ever, t.series[2])] }),
          table: { columns: [{ key: 'm', label: 'Cohort' }, { key: 'n', label: 'Deals', num: true }, { key: 'w', label: 'Won ≤ 90 d', num: true, fmt: v => v == null ? 'not mature' : v + '%' }, { key: 'e', label: 'Won to date', num: true, fmt: v => v + '%' }],
            rows: months.map((k, i) => ({ m: U.fmtMonth(k), n: gm.get(k).length, w: w90[i], e: ever[i] })) },
          foot: 'From June 2026 no-show bookings leave STR Search, which shrinks the denominator and lifts these rates. Treat the step up as partly mechanical.',
        };
      },
    });
    C.card(g, {
      id: 'sales-stages', title: 'Where open deals sit today', subtitle: 'Current stage of open deals, in pipeline order', height: 360,
      render({ t }) {
        const open = SX.model.deals().filter(d => d.status === 'open');
        if (!open.length) return { empty: true };
        const stages = SX.data.defs.stages.map(s => s.name);
        const cnt = U.countBy(open, d => d.stage);
        const names = stages.filter(s => cnt.get(s)).reverse();
        const vals = names.map(s => cnt.get(s));
        return {
          option: C.base(t, { grid: { left: 6, right: 40, top: 8, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => ({ title: p.name, rows: [['open deals', U.fmtInt(p.value)]] })) }),
            yAxis: C.catAxis(t, names, { axisLabel: { color: t.label, fontSize: 11 } }), xAxis: C.valAxis(t),
            series: [C.bar('Open deals', vals, t.series[2], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11 } })] }),
          table: { columns: [{ key: 's', label: 'Stage' }, { key: 'n', label: 'Open deals', num: true }], rows: names.slice().reverse().map(s => ({ s, n: cnt.get(s) })) },
        };
      },
    });
    C.card(g, {
      id: 'sales-lost', title: 'Why deals are lost', subtitle: 'Lost reason on lost deals · ranked', height: 360,
      render({ t }) {
        const lost = SX.model.deals().filter(d => d.status === 'lost');
        if (!lost.length) return { empty: true };
        const cnt = Array.from(U.countBy(lost, d => d.lost_reason || '(blank)').entries()).sort((a, b) => b[1] - a[1]);
        const top = cnt.slice(0, 11), other = U.sum(cnt.slice(11), x => x[1]);
        if (other) top.push(['Other reasons', other]);
        const names = top.map(x => x[0]).reverse(), vals = top.map(x => x[1]).reverse();
        return {
          option: C.base(t, { grid: { left: 6, right: 52, top: 8, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => ({ title: p.name, rows: [['lost deals', U.fmtInt(p.value)], ['share', U.fmtPct(p.value / lost.length, 1)]] })) }),
            yAxis: C.catAxis(t, names), xAxis: C.valAxis(t),
            series: [C.bar('Lost deals', vals, t.series[3], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: p => U.fmtPct(p.value / lost.length) } })] }),
          table: { columns: [{ key: 'r', label: 'Lost reason' }, { key: 'n', label: 'Deals', num: true }, { key: 's', label: 'Share', num: true }], rows: cnt.map(([r, n]) => ({ r, n, s: U.fmtPct(n / lost.length, 1) })) },
        };
      },
    });

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Where wins come from' }), el('span', { class: 'hint', text: 'Lead source, package, payment and rep · all respect the filters' })]));
    const g2 = el('div', { class: 'grid grid-12' });
    root.append(g2);
    const srcBox = el('div', { class: 'span-7' }), mixBox = el('div', { class: 'span-5' });
    g2.append(srcBox, mixBox);
    SX.live(srcBox, box => {
      const deals = SX.model.deals();
      const gs = U.groupBy(deals, d => d.source || 'Unknown');
      const rows = Array.from(gs.entries()).map(([s, arr]) => { const w = arr.filter(d => d.status === 'won'); return { s, n: arr.length, w: w.length, r: w.length / arr.length, v: U.sum(w, d => d.value) }; });
      const maxR = Math.max(...rows.map(r => r.r), 0.01);
      box.append(el('h4', { text: 'Lead source (PD_Source)' }), SX.ui.table({ sortKey: 'n', columns: [
        { key: 's', label: 'Source' }, { key: 'n', label: 'Deals', num: true, fmt: U.fmtInt }, { key: 'w', label: 'Won', num: true, fmt: U.fmtInt },
        { key: 'r', label: 'Win rate', num: true, html: (v, r) => SX.ui.barCell(r.r, maxR, U.fmtPct(r.r, 1)) }, { key: 'v', label: 'Booked', num: true, fmt: v => U.fmtMoney(v, true) }], rows, cls: 'explorer-table' }),
        el('p', { class: 'small muted mt-1', text: 'Win rates on small sources (under 30 deals) are noisy. “Partnership” is the dominant source label. Rabbu purchased leads are tracked in a separate workbook and are not split out here.' }));
    });
    C.card(mixBox, {
      id: 'sales-mix', title: 'Package and payment on won deals', subtitle: 'Share of won deals · blank = field not filled', height: 250,
      render({ t }) {
        const won = SX.model.deals().filter(d => d.status === 'won');
        if (!won.length) return { empty: true };
        const cats = ['Package', 'Payment'];
        const pk = U.countBy(won, d => d.product || 'Not filled'), pm = U.countBy(won, d => d.payment || 'Not filled');
        const keysP = ['Complete', 'Core', 'Not filled'], keysM = ['Likely Split Pay [214]', 'Likely Full Pay [215]', 'Not filled'];
        const cols = [t.series[0], t.series[1], t.deemph2];
        const series = [0, 1, 2].map(i => C.stackBar(keysP[i] + ' / ' + keysM[i], [pk.get(keysP[i]) || 0, pm.get(keysM[i]) || 0], cols[i], 'm', t, { barMaxWidth: 28 }));
        series[0].name = 'Complete · Likely Split Pay'; series[1].name = 'Core · Likely Full Pay'; series[2].name = 'Not filled';
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 16, top: 40, bottom: 6, containLabel: true },
            tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' (' + U.fmtPct(v / won.length) + ')') }),
            yAxis: C.catAxis(t, cats), xAxis: C.valAxis(t), series: series.map(s => Object.assign(s, { type: 'bar' })) }),
          table: { columns: [{ key: 'k', label: 'Value' }, { key: 'n', label: 'Won deals', num: true }], rows: keysP.map(k => ({ k: 'Package: ' + k, n: pk.get(k) || 0 })).concat(keysM.map(k => ({ k: 'Payment: ' + k, n: pm.get(k) || 0 }))) },
          foot: 'Package labels are verified ([203] = Complete, [202] = Core). <b>Payment labels are inferred</b>: no extract names options 214/215.',
        };
      },
    });
    C.card(mixBox, {
      id: 'sales-value', title: 'Booked value per won deal', subtitle: 'Deal_Value distribution · $2.5K bins', height: 230, cls: 'mt-1',
      render({ t }) {
        const won = SX.model.deals().filter(d => d.status === 'won' && d.value != null);
        if (!won.length) return { empty: true };
        const bins = []; for (let b = 0; b <= 25000; b += 2500) bins.push(b);
        const c = new Array(bins.length).fill(0);
        won.forEach(d => { c[Math.min(bins.length - 1, Math.floor(d.value / 2500))]++; });
        const lab = bins.map(b => '$' + (b / 1000) + 'K');
        return {
          option: C.base(t, { tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => ({ title: p.name + ' – $' + ((bins[p.dataIndex] + 2499) / 1000).toFixed(1) + 'K', rows: [['won deals', U.fmtInt(p.value)]] })) }),
            xAxis: C.catAxis(t, lab), yAxis: C.valAxis(t), series: [C.bar('Won deals', c, t.series[0])] }),
          table: { columns: [{ key: 'b', label: 'From' }, { key: 'n', label: 'Won deals', num: true }], rows: lab.map((b, i) => ({ b, n: c[i] })) },
        };
      },
    });

    SX.live(root, box => {
      const deals = SX.model.deals();
      const gr = U.groupBy(deals, d => d.rep || 'Unknown');
      const rows = Array.from(gr.entries()).map(([r, arr]) => { const w = arr.filter(d => d.status === 'won'); return { r, n: arr.length, w: w.length, wr: arr.length ? w.length / arr.length : null, md: U.median(w.map(d => d.days_to_win)), v: U.sum(w, d => d.value) }; }).filter(x => x.n >= 5);
      box.append(el('h4', { class: 'mt-2', text: 'Sales reps (deal owner, Sales_Rep_Name)' }), SX.ui.table({ sortKey: 'n', columns: [
        { key: 'r', label: 'Rep' }, { key: 'n', label: 'Deals', num: true, fmt: U.fmtInt }, { key: 'w', label: 'Won', num: true, fmt: U.fmtInt },
        { key: 'wr', label: 'Win rate', num: true, fmt: v => U.fmtPct(v, 1) }, { key: 'md', label: 'Median days to win', num: true, fmt: U.fmtDays }, { key: 'v', label: 'Booked', num: true, fmt: v => U.fmtMoney(v, true) }], rows }),
        el('p', { class: 'small muted mt-1', text: 'Reps with fewer than 5 deals in the slice are hidden. Owner is the current deal owner, so reassigned deals count for their current owner. Lead mix differs by rep.' }));
    });

    const sdr = el('div', { class: 'grid grid-12 mt-2' });
    root.append(sdr);
    const sl = el('div', { class: 'span-7' }), sr = el('div', { class: 'span-5' });
    sdr.append(sl, sr);
    C.card(sl, {
      id: 'sales-sdr', title: 'Booked calls moved out of STR Search since June 2026', subtitle: 'Calendly-booked deals now in the SDR Setter pipeline vs “No Show” losses left in STR Search · not filterable', height: 260,
      render({ t }) {
        const s = SX.data.extras.sdr_moves;
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }),
            xAxis: C.catAxis(t, s.map(r => U.fmtMonth(r.month, true))), yAxis: C.valAxis(t),
            series: [C.bar('Calendly-booked deals in SDR Setter pipeline', s.map(r => r.p6_calendly_booked), t.series[4]), C.bar('“No Show” lost in STR Search', s.map(r => r.p3_no_show_lost), t.series[3])] }),
          table: { columns: [{ key: 'm', label: 'Month' }, { key: 'a', label: 'In SDR pipeline (Calendly)', num: true }, { key: 'b', label: 'No Show lost (STR Search)', num: true }, { key: 'c', label: 'STR Search deals created', num: true }],
            rows: s.map(r => ({ m: U.fmtMonth(r.month), a: r.p6_calendly_booked, b: r.p3_no_show_lost, c: r.p3_created })) },
        };
      },
    });
    sr.append(el('div', { class: 'callout callout--critical mt-0' }, [el('h4', { text: 'Why this matters for every sales metric' }),
      el('p', { text: 'Pipeline membership is current-state. When a booked call no-shows, the deal is moved to the SDR Setter pipeline, which the STR Search filter excludes.' }),
      el('ul', {}, [el('li', { text: 'Deal counts and no-show rates from June 2026 are lower than the bookings that really happened.' }), el('li', { text: 'Win rate per deal rises for the same reason.' }), el('li', { text: 'Historical months can be restated as deals move.' })]),
      el('p', { text: 'Decision for Carson: should moved bookings count as STR Search deals for funnel metrics?' })]));
  };
})();
