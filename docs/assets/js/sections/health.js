/* Data health & trust + record explorer. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;

  SX.sections.health = function (root) {
    SX.head(root, 'health', 'Section 6 · Data health & trust', 'What the data can support, and where it needs care',
      'Checks run on every build. Severity reflects the impact on business metrics. Expand a check to see the affected Jira keys or deal IDs, so they can be fixed at source.');
    const order = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };
    const q = SX.data.quality.slice().sort((a, b) => order[a.severity] - order[b.severity]);
    const counts = U.countBy(q, c => c.severity);
    const sum = el('div', { class: 'control-row' });
    ['critical', 'serious', 'warning', 'info', 'good'].forEach(s => { if (counts.get(s)) sum.append(SX.ui.status(s, counts.get(s) + ' ' + ({ critical: 'critical', serious: 'issues', warning: 'cautions', info: 'notes', good: 'passed' })[s])); });
    root.append(sum);
    const list = el('div', { class: 'checks' });
    q.forEach(c => {
      const node = el('div', { class: 'check' }, [
        SX.ui.status(c.severity),
        el('div', {}, [el('h4', { text: c.title }), el('p', { text: c.detail }), el('p', { class: 'small muted', text: 'Impact: ' + c.impact }), el('span', { class: 'badge', text: c.area })]),
        el('div', { class: 'check-metric', text: c.metric }),
      ]);
      if (c.keys && c.keys.length) node.append(el('details', {}, [el('summary', { text: 'Affected records (' + c.keys.length + (c.keys.length >= 60 ? '+' : '') + ')' }), el('div', { class: 'keys', text: c.keys.join(', ') })]));
      list.append(node);
    });
    root.append(list);

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Existing reporting (FCT) vs this rebuild' }), el('span', { class: 'hint', text: 'FCT - Daily_Reporting_STR_Search, Sales_Funnel sheet' })]));
    const g = el('div', { class: 'grid grid-12' });
    root.append(g);
    const l = el('div', { class: 'span-7' }), r = el('div', { class: 'span-5' });
    g.append(l, r);
    C.card(l, {
      id: 'health-recon', title: 'PD_Deals per month: FCT report vs rebuild from the DIM tables', subtitle: 'Created month · differences come from snapshot timing and moved deals · not filterable', height: 280,
      render({ t }) {
        const rows = SX.data.recon.monthly || [];
        if (!rows.length) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }),
            xAxis: C.catAxis(t, rows.map(x => U.fmtMonth(x.month, true))), yAxis: C.valAxis(t),
            series: [C.line('FCT PD_Deals', rows.map(x => x.fct_deals), t.series[1]), C.line('Rebuilt (official filter)', rows.map(x => x.dim_deals), t.series[0])] }),
          table: { columns: [{ key: 'month', label: 'Month' }, { key: 'fct_deals', label: 'FCT deals', num: true }, { key: 'dim_deals', label: 'Rebuilt deals', num: true }, { key: 'fct_won', label: 'FCT won', num: true }, { key: 'dim_won', label: 'Rebuilt won', num: true }, { key: 'fct_jira', label: 'FCT Jira_Clients', num: true }, { key: 'dim_jira', label: 'Jira issues created', num: true }], rows },
        };
      },
    });
    r.append(SX.ui.table({ sortable: false, columns: [{ key: 'metric', label: 'FCT metric' }, { key: 'verdict', label: 'Verdict', html: (v, row) => SX.ui.status(row.sev, v) }, { key: 'note', label: 'Why' }], rows: SX.data.recon.verdicts || [] }));

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Which business metrics these extracts can support' })]));
    const sup = [
      ['Deals, wins and booked value by month', 'good', 'Supported', 'Pipedrive timestamps are complete. From June 2026, account for no-shows moved to the SDR pipeline.'],
      ['Win rate and sales cycle', 'good', 'Supported, with maturity caveat', 'Use matured cohorts. Median time to win is 21 days.'],
      ['Stage-to-stage conversion', 'critical', 'Not supported', 'Only the current stage is extracted. A stage-history extract is needed.'],
      ['Package / payment mix', 'warning', 'Partial', 'Filled mostly for recent wins. Payment labels unconfirmed.'],
      ['Time to UC / CLOSED', 'good', 'Supported, with caveats', 'From Jira changelog first dates. Early history is incomplete and dates are UTC.'],
      ['Conversion to UC / CLOSED', 'warning', 'Supported as cohorts', 'Snapshot shares (Carson Q2) need the cohort view beside them.'],
      ['Refund rate', 'warning', 'Partial', 'Refunded status count only. No refund dates or amounts.'],
      ['Revenue, cash collected, receivables', 'critical', 'Not supported', 'No payment or invoice data. Deal_Value is booked value only.'],
      ['CAC / channel ROI', 'critical', 'Not yet', 'Ads spend, Rabbu cost and GHL are in separate workbooks, not joined here.'],
      ['Affiliate / referral income', 'warning', 'Not loaded', 'Brokerage, lending and Cribs tracking sheets exist and look fresh. A candidate for the next phase.'],
    ];
    root.append(SX.ui.table({ sortable: false, columns: [{ key: 'a', label: 'Metric' }, { key: 'b', label: 'Status', html: (v, row) => SX.ui.status(row.s, v) }, { key: 'c', label: 'Note' }], rows: sup.map(([a, s, b, c]) => ({ a, s, b, c })) }));
  };

  /* ------------------------------------------------------------ Explorer */
  SX.sections.explorer = function (root) {
    SX.head(root, 'explorer', 'Section 7 · Record explorer', 'Inspect the de-identified records behind every chart',
      'One row per Jira issue or STR Search deal, already filtered by the bar above. No names, emails, phones or addresses are included. ' + (SX.data.meta.anonymized ? 'In this public build, Jira keys, deal IDs and staff names are replaced with stable pseudonyms (J0001, D0001, Rep 0001).' : 'Keys can be looked up in Jira and Pipedrive by people who have access.'));
    const v = { tab: 'jira', q: '', page: 0 };
    const tools = el('div', { class: 'explorer-tools' });
    const search = el('input', { class: 'search', type: 'search', placeholder: 'Search key, status, assignee, source…', 'aria-label': 'Search records' });
    const dl = el('button', { class: 'tool-btn', type: 'button', text: 'Download CSV' });
    const count = el('span', { class: 'small muted' });
    tools.append(SX.ui.seg('', [{ value: 'jira', label: 'Jira issues' }, { value: 'deals', label: 'Pipedrive deals' }], v.tab, t => { v.tab = t; v.page = 0; draw(); }), search, dl, count);
    root.append(tools);
    const box = el('div');
    root.append(box);
    const COLS = {
      jira: [
        { key: 'key', label: 'Jira key' }, { key: 'status', label: 'Status' }, { key: 'carson_class', label: 'Carson class' },
        { key: 'start', label: 'Effective start', sort: r => r.start_d }, { key: 'start_src', label: 'Start from' }, { key: 'uc', label: 'First UC', sort: r => r.uc_d },
        { key: 'days_uc', label: 'Days to UC', num: true }, { key: 'closed', label: 'First CLOSED', sort: r => r.closed_d }, { key: 'days_closed', label: 'Days to CLOSED', num: true },
        { key: 'assignee', label: 'Assignee' }, { key: 'deal_id', label: 'Deal ID' }, { key: 'pd_status', label: 'Deal status' }, { key: 'pd_product', label: 'Package' }, { key: 'pd_source', label: 'Source' }],
      deals: [
        { key: 'id', label: 'Deal ID' }, { key: 'created', label: 'Created', sort: r => r.created_d }, { key: 'status', label: 'Status' }, { key: 'stage', label: 'Stage' },
        { key: 'won_date', label: 'Won', sort: r => r.won_date_d }, { key: 'days_to_win', label: 'Days to win', num: true }, { key: 'value', label: 'Value', num: true, fmt: x => x == null ? '–' : U.fmtMoney(x) },
        { key: 'lost_reason', label: 'Lost reason' }, { key: 'source', label: 'Source' }, { key: 'rep', label: 'Rep' }, { key: 'product', label: 'Package' }, { key: 'payment', label: 'Payment' },
        { key: 'jira_key', label: 'Jira key' }, { key: 'experience', label: 'Experience' }],
    };
    let current = [];
    function rows() {
      const base = v.tab === 'jira' ? SX.model.jira() : SX.model.deals();
      const q = v.q.trim().toLowerCase();
      if (!q) return base;
      const cols = COLS[v.tab];
      return base.filter(r => cols.some(c => r[c.key] != null && String(r[c.key]).toLowerCase().includes(q)));
    }
    function draw() {
      current = rows();
      count.textContent = U.fmtInt(current.length) + ' records';
      box.textContent = '';
      box.append(SX.ui.table({ columns: COLS[v.tab], rows: current, maxRows: 300, cls: 'explorer-table', sortKey: v.tab === 'jira' ? 'start' : 'created', sortDir: -1 }));
    }
    search.addEventListener('input', U.debounce(() => { v.q = search.value; draw(); }, 200));
    dl.addEventListener('click', () => U.downloadCSV('strsearch-' + v.tab + '-' + SX.data.meta.asof + '.csv', COLS[v.tab], current));
    draw();
    SX.bus.on('filters', draw);
  };
})();
