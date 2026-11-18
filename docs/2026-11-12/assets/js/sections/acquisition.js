/* Acquisition (Jira) + Connected lifecycle (Pipedrive <-> Jira). */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;

  SX.sections.acquisition = function (root) {
    SX.head(root, 'acquisition', 'Section 4 · Client acquisition (Jira)', 'Where Jira clients are in their property search',
      'Status is today’s value, so these views describe the current book of clients. Milestone dates (first UC, first CLOSED) carry the history. Period filters use the effective start date.');
    SX.live(root, box => {
      const all = SX.model.jira();
      const sig = all.filter(j => j.signed_list), act = all.filter(j => j.active_list);
      const searching = act.filter(j => j.group === 'Searching');
      const asof = SX.data.asofDay;
      const row = el('div', { class: 'kpi-row' });
      SX.ui.kpi(row, { label: 'Signed-up clients', value: U.fmtInt(sig.length), sub: U.fmtInt(act.length) + ' Active · ' + U.fmtInt(sig.length - act.length) + ' Inactive (status list)' });
      SX.ui.kpi(row, { label: 'Searching now', value: U.fmtInt(searching.length), sub: 'Client Start / 2–8 Weeks · median ' + U.fmtInt(U.median(searching.map(j => asof - j.start_d))) + ' days since start' });
      SX.ui.kpi(row, { label: 'Under contract now', value: U.fmtInt(act.filter(j => j.group === 'Under contract').length), sub: 'Under Contract or Passed Inspection' });
      SX.ui.kpi(row, { label: 'Refunded / Paused', value: U.fmtInt(sig.filter(j => j.status === 'Refunded').length) + ' / ' + U.fmtInt(sig.filter(j => j.status === 'Paused').length), sub: U.fmtPct(U.ratio(sig.filter(j => j.status === 'Refunded').length, sig.length), 1) + ' of signed-up clients refunded' });
      SX.ui.kpi(row, { label: 'Pre-sale prospects in Jira', value: U.fmtInt(all.length - sig.length), sub: 'New Clients, Onboarding Completed, Services Declined' });
      box.append(row);
    });

    const g = el('div', { class: 'grid grid-2 mt-2' });
    root.append(g);
    C.card(g, {
      id: 'acq-status', title: 'Current Jira status, grouped by lifecycle stage', subtitle: 'All issues in the slice · colour = lifecycle group', height: 430,
      render({ t }) {
        const rows = SX.model.jira();
        if (!rows.length) return { empty: true };
        const meta = SX.data.defs.status_meta;
        const cnt = U.countBy(rows, j => j.status);
        const names = Array.from(cnt.keys()).sort((a, b) => ((meta[b] || {}).order || 99) - ((meta[a] || {}).order || 99));
        return {
          option: C.base(t, { grid: { left: 6, right: 44, top: 8, bottom: 6, containLabel: true },
            tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => ({ title: p.name, rows: [['issues', U.fmtInt(p.value)], ['group', (meta[p.name] || {}).group || 'Other']], note: (meta[p.name] || {}).meaning })) }),
            yAxis: C.catAxis(t, names), xAxis: C.valAxis(t),
            series: [C.bar('Issues', names.map(n => ({ value: cnt.get(n), itemStyle: { color: SX.calc.groupColor(t, (meta[n] || {}).group || 'Other'), borderRadius: [0, 4, 4, 0] } })), t.series[0], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11 } })] }),
          table: { columns: [{ key: 's', label: 'Status' }, { key: 'g', label: 'Group' }, { key: 'c', label: 'Status class' }, { key: 'n', label: 'Issues', num: true }],
            rows: names.slice().reverse().map(n => ({ s: n, g: (meta[n] || {}).group, c: rows.find(j => j.status === n).status_class, n: cnt.get(n) })) },
          foot: 'Groups: pre-sale onboarding (blue), declined (grey), searching (teal), under contract (violet), closed (amber), post-close (magenta), inactive (light grey).',
        };
      },
    });
    C.card(g, {
      id: 'acq-aging', title: 'Searching clients: days since effective start', subtitle: 'Active clients in Client Start / 2 / 4 / 6 / 8 Weeks · stacked by status', height: 430,
      render({ t }) {
        const asof = SX.data.asofDay;
        const rows = SX.model.jira({ population: 'active' }).filter(j => j.group === 'Searching');
        if (!rows.length) return { empty: true };
        const bands = [[0, 30, '0–30'], [31, 60, '31–60'], [61, 90, '61–90'], [91, 180, '91–180'], [181, 365, '181–365'], [366, 1e6, '365+']];
        const sts = ['Client Start', '2 Weeks', '4 Weeks', '6 Weeks', '8 Weeks'].filter(s => rows.some(j => j.status === s));
        const cols = [t.series[2], t.series[0], t.series[4], t.series[3], t.series[1]];
        const series = sts.map((s, i) => C.stackBar(s, bands.map(([a, b]) => rows.filter(j => j.status === s && asof - j.start_d >= a && asof - j.start_d <= b).length), cols[i], 'a', t));
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 12, top: 40, bottom: 26, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v) + ' clients', { title: p => U.escapeHtml(p.axisValueLabel) + ' days in search' }) }),
            xAxis: C.catAxis(t, bands.map(b => b[2]), { name: 'days since effective start', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: t.label, fontSize: 11 } }), yAxis: C.valAxis(t), series }),
          table: { columns: [{ key: 'b', label: 'Days' }].concat(sts.map(s => ({ key: s, label: s, num: true }))), rows: bands.map((b, i) => Object.assign({ b: b[2] }, Object.fromEntries(sts.map((s, si) => [s, series[si].data[i]])))) },
          foot: U.fmtInt(rows.filter(j => asof - j.start_d > 180).length) + ' searching clients started more than 180 days ago. “8 Weeks” works as a catch-all for long searches, so these clients may need attention.',
        };
      },
    });

    // Pre-sale funnel since the New Client Experience
    const g2 = el('div', { class: 'grid grid-12 mt-1' });
    root.append(g2);
    const pl = el('div', { class: 'span-6' }), pr = el('div', { class: 'span-6' });
    g2.append(pl, pr);
    C.card(pl, {
      id: 'acq-presale', title: 'Onboarding-first funnel: issues created since May 27, 2026', subtitle: 'Where each issue is today · by month the issue was created', height: 300,
      render({ t }) {
        const since = U.day(SX.data.defs.new_experience_date);
        const rows = SX.model.jira({ ignorePeriod: true }).filter(j => j.created_d >= since);
        if (!rows.length) return { empty: true };
        const months = U.uniq(rows.map(j => U.monthKeyFromDay(j.created_d))).sort();
        const cls = j => j.signed_list ? 'Signed client' : j.status === 'Services Declined' ? 'Declined' : 'Still pre-sale';
        const keys = ['Signed client', 'Still pre-sale', 'Declined'], cols = [t.series[0], t.series[2], t.deemph];
        const series = keys.map((k, i) => C.stackBar(k, months.map(m => rows.filter(j => U.monthKeyFromDay(j.created_d) === m && cls(j) === k).length), cols[i], 'p', t));
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }), xAxis: C.catAxis(t, months.map(m => U.fmtMonth(m, true))), yAxis: C.valAxis(t), series }),
          table: { columns: [{ key: 'm', label: 'Created' }].concat(keys.map(k => ({ key: k, label: k, num: true }))), rows: months.map((m, i) => Object.assign({ m: U.fmtMonth(m) }, Object.fromEntries(keys.map((k, ki) => [k, series[ki].data[i]])))) },
          foot: 'Of ' + U.fmtInt(rows.length) + ' issues opened since the change, <b>' + U.fmtPct(rows.filter(j => j.signed_list).length / rows.length) + '</b> are signed clients today and <b>' + U.fmtPct(rows.filter(j => j.status === 'Services Declined').length / rows.length) + '</b> declined. Recent months are still deciding.',
        };
      },
    });
    SX.live(pr, box => {
      const rows = SX.model.jira({ population: 'signed' });
      const ga = U.groupBy(rows, j => j.assignee);
      const data = Array.from(ga.entries()).map(([a, arr]) => ({ a, n: arr.length, act: arr.filter(j => j.active_list && ['Searching', 'Under contract'].includes(j.group)).length,
        uc: arr.filter(j => j.uc_d != null).length, cl: arr.filter(j => j.closed_d != null).length, md: U.median(arr.map(j => SX.calc.days(j, 'uc')).filter(v => v != null)) })).filter(x => x.n >= 3);
      box.append(el('h4', { text: 'Acquisitions team workload (Jira assignee, signed-up clients)' }), SX.ui.table({ sortKey: 'act', cls: 'explorer-table', columns: [
        { key: 'a', label: 'Assignee' }, { key: 'n', label: 'Clients', num: true }, { key: 'act', label: 'Searching / UC now', num: true },
        { key: 'uc', label: 'Reached UC', num: true }, { key: 'cl', label: 'Reached CLOSED', num: true }, { key: 'md', label: 'Median days to UC', num: true, fmt: U.fmtDays }], rows: data }),
        el('p', { class: 'small muted mt-1', text: 'Assignee is the current owner, so clients reassigned over time count for today’s assignee. Client mix differs by person, so this is a workload view, not a ranking.' }));
    });

    SX.live(root, box => {
      const sig = SX.model.jira({ population: 'signed' });
      const ucd = sig.filter(j => j.uc_d != null);
      const multi = ucd.filter(j => (j.uc_count || 0) > 1).length, fell = sig.filter(j => j.fell_out).length, multiClose = sig.filter(j => (j.closed_count || 0) > 1).length;
      const sent = sig.filter(j => j.deals_sent != null);
      box.append(el('div', { class: 'callout-grid' }, [
        el('div', { class: 'callout callout--insight' }, [el('h4', { text: 'Contracts that fall through' }), el('p', { text: U.fmtInt(multi) + ' of ' + U.fmtInt(ucd.length) + ' clients who went UC have more than one UC event, and ' + U.fmtInt(fell) + ' have a fell-out-of-contract address recorded. Q1 uses the first UC, so time to the contract that actually closed is longer.' })]),
        el('div', { class: 'callout callout--insight' }, [el('h4', { text: 'Repeat buyers' }), el('p', { text: U.fmtInt(multiClose) + ' signed-up clients have more than one CLOSED event. Per-client metrics count them once.' })]),
        el('div', { class: 'callout callout--insight' }, [el('h4', { text: 'Properties sent to clients' }), el('p', { text: 'Total_Deals_Sent is filled for ' + U.fmtInt(sent.length) + ' clients (median ' + U.fmtInt(U.median(sent.map(j => j.deals_sent))) + ' properties sent). Coverage is partial, so treat this as indicative.' })]),
      ]));
    });
  };

  /* ------------------------------------------------------------ Connected lifecycle */
  SX.sections.lifecycle = function (root) {
    SX.head(root, 'lifecycle', 'Section 5 · Connected lifecycle', 'Following deals from Pipedrive into Jira outcomes',
      'Deals are joined to Jira through the Jira issue’s PD_Deal_ID, which never repeats. The flow starts from STR Search deals created in the period and follows them to today.');
    C.card(root, {
      id: 'life-sankey', title: 'Deal → sale → Jira client → Under Contract → CLOSED', subtitle: 'Deals created in the period (official filter) · current outcome of each', height: 420,
      render({ t }) {
        const deals = SX.model.deals();
        if (!deals.length) return { empty: true };
        const jByDeal = new Map(SX.data.jira.filter(j => j.deal_id != null).map(j => [String(j.deal_id), j]));
        const L = { won: 'Won', lost: 'Lost', open: 'Open' };
        const links = new Map();
        const add = (a, b) => links.set(a + '→' + b, (links.get(a + '→' + b) || 0) + 1);
        deals.forEach(d => {
          add('Deals', L[d.status]);
          const j = jByDeal.get(String(d.id));
          if (d.status === 'won') {
            if (!j) { add('Won', 'No Jira issue'); return; }
            if (!j.signed_list) { add('Won', 'Jira: not signed-up status'); return; }
            add('Won', 'Signed-up client');
            if (j.status === 'Refunded' || j.status === 'Paused') { add('Signed-up client', 'Refunded / Paused'); return; }
            if (j.uc_d == null) { add('Signed-up client', 'Searching / no UC yet'); return; }
            add('Signed-up client', 'Under Contract');
            add('Under Contract', j.closed_d != null ? 'CLOSED' : 'Not closed yet');
          } else if (j && d.status !== 'won') {
            add(L[d.status], j.status === 'Services Declined' ? 'Jira: declined' : 'Jira: pre-sale');
          }
        });
        const nodes = U.uniq(Array.from(links.keys()).flatMap(k => k.split('→')));
        const col = n => ({ Deals: t.series[2], Won: t.series[0], 'Signed-up client': t.series[0], 'Under Contract': t.series[4], CLOSED: t.series[1], Open: t.series[2] })[n] || t.deemph;
        const data = Array.from(links.entries()).map(([k, v]) => { const [s, tg] = k.split('→'); return { source: s, target: tg, value: v }; });
        return {
          option: C.base(t, { tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => p.dataType === 'edge' ? { title: p.data.source + ' → ' + p.data.target, rows: [['deals', U.fmtInt(p.data.value)]] } : { title: p.name, rows: [['deals', U.fmtInt(p.value)]] }) }),
            series: [{ type: 'sankey', left: 8, right: 150, top: 10, bottom: 10, nodeWidth: 12, nodeGap: 12, draggable: false, layoutIterations: 64,
              emphasis: { focus: 'adjacency' }, label: { color: t.ink, fontSize: 12, formatter: p => p.name + '  ' + U.fmtInt(p.value) },
              lineStyle: { color: 'gradient', opacity: 0.28, curveness: 0.5 }, itemStyle: { borderWidth: 0 },
              data: nodes.map(n => ({ name: n, itemStyle: { color: col(n) } })), links: data }] }),
          table: { columns: [{ key: 's', label: 'From' }, { key: 't', label: 'To' }, { key: 'v', label: 'Deals', num: true }], rows: data.map(d => ({ s: d.source, t: d.target, v: d.value })) },
          foot: 'Lost and open deals that already have a Jira issue are New Client Experience prospects (onboarded before buying). “No Jira issue” won deals are mostly very recent or 2024 records.',
        };
      },
    });

    const g = el('div', { class: 'grid grid-12 mt-1' });
    root.append(g);
    const l = el('div', { class: 'span-6' }), r = el('div', { class: 'span-6' });
    g.append(l, r);
    C.card(l, {
      id: 'life-timeline', title: 'Typical timing between lifecycle events', subtitle: 'Median days between consecutive events · signed-up clients with a linked deal', height: 300,
      render({ t }) {
        const rows = SX.model.jira({ population: 'signed' }).filter(j => j.pd_created_d != null);
        if (!rows.length) return { empty: true };
        const med = (f) => { const v = rows.map(f).filter(x => x != null); return { m: U.median(v), n: v.length }; };
        const steps = [
          ['Deal created → won', med(j => j.pd_won_date_d != null ? j.pd_won_date_d - j.pd_created_d : null)],
          ['Won → Jira issue created', med(j => j.pd_won_date_d != null ? j.created_d - j.pd_won_date_d : null)],
          ['Won → effective start', med(j => j.pd_won_date_d != null ? j.start_d - j.pd_won_date_d : null)],
          ['Effective start → first UC', med(j => SX.calc.days(j, 'uc'))],
          ['First UC → first CLOSED', med(j => j.uc_d != null && j.closed_d != null ? j.closed_d - j.uc_d : null)],
          ['Deal created → first CLOSED', med(j => j.closed_d != null ? j.closed_d - j.pd_created_d : null)],
        ];
        const names = steps.map(s => s[0]).reverse(), vals = steps.map(s => s[1].m).reverse();
        return {
          option: C.base(t, { grid: { left: 6, right: 48, top: 8, bottom: 6, containLabel: true },
            tooltip: Object.assign(C.tooltipBase(t, 'item'), { formatter: C.itemTip(p => ({ title: p.name, rows: [['median days', U.fmtInt(p.value)], ['clients', U.fmtInt(steps[steps.length - 1 - p.dataIndex][1].n)]] })) }),
            yAxis: C.catAxis(t, names), xAxis: C.valAxis(t, { fmt: v => v + ' d' }),
            series: [C.bar('Median days', vals.map(v => ({ value: v, itemStyle: { color: v < 0 ? t.series[3] : t.series[0], borderRadius: v < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0] } })), t.series[0], { horizontal: true, label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: p => U.fmtInt(p.value) + ' d' } })] }),
          table: { columns: [{ key: 's', label: 'Step' }, { key: 'm', label: 'Median days', num: true, fmt: U.fmtInt }, { key: 'n', label: 'Clients', num: true }], rows: steps.map(s => ({ s: s[0], m: s[1].m, n: s[1].n })) },
          foot: 'A negative value means the second event usually comes first. Under the New Client Experience the Jira issue and onboarding happen before the sale.',
        };
      },
    });
    const sel = { dim: 'pd_product' };
    const outBox = el('div');
    r.append(outBox);
    const ctl = el('div', { class: 'control-row' });
    outBox.append(el('h4', { text: 'Jira outcomes by Pipedrive attribute (signed-up clients)' }), ctl);
    const tbl = el('div');
    outBox.append(tbl);
    function drawOut() {
      tbl.textContent = '';
      const rows = SX.model.jira({ population: 'signed' }), asof = SX.data.asofDay;
      const g2 = U.groupBy(rows, j => j[sel.dim] == null ? 'Unknown / unlinked' : j[sel.dim]);
      const data = Array.from(g2.entries()).map(([k, arr]) => { const m = arr.filter(j => asof - j.start_d >= 180);
        return { k, n: arr.length, uc: arr.filter(j => j.uc_d != null).length / arr.length, cl: arr.filter(j => j.closed_d != null).length / arr.length, rf: arr.filter(j => j.status === 'Refunded').length / arr.length,
          m180: m.length ? m.filter(j => j.uc_d != null && j.uc_d - j.start_d <= 180).length / m.length : null, nm: m.length }; }).filter(x => x.n >= 3);
      tbl.append(SX.ui.table({ sortKey: 'n', columns: [{ key: 'k', label: 'Value' }, { key: 'n', label: 'Clients', num: true },
        { key: 'm180', label: 'UC ≤ 180 d (matured)', num: true, fmt: (v, r) => v == null ? '–' : U.fmtPct(v) + ' of ' + r.nm },
        { key: 'uc', label: 'UC to date', num: true, fmt: v => U.fmtPct(v) }, { key: 'cl', label: 'CLOSED to date', num: true, fmt: v => U.fmtPct(v) }, { key: 'rf', label: 'Refunded', num: true, fmt: v => U.fmtPct(v) }], rows: data }),
        el('p', { class: 'small muted mt-1', text: 'The “to date” columns favour older groups. The matured 180-day column compares like with like. Package and payment are filled mostly for recent wins, and unlinked clients are mostly 2024 refunds.' }));
    }
    ctl.append(SX.ui.seg('', [{ value: 'pd_product', label: 'Package' }, { value: 'pd_payment', label: 'Payment' }, { value: 'pd_source', label: 'Lead source' }, { value: 'pd_rep', label: 'Sales rep' }, { value: 'pd_experience', label: 'Experience' }], sel.dim, v => { sel.dim = v; drawOut(); }));
    drawOut();
    SX.bus.on('filters', drawOut);
  };
})();
