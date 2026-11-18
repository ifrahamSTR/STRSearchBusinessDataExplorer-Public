/* Data health & trust + record explorer. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;

  SX.sections.health = function (root) {
    SX.head(root, 'health', 'Section 9 · Data health & trust', 'What the data can support, and where it needs care',
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

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Reconciliation with the reporting layer' }), el('span', { class: 'hint', text: 'Hard checks · the build stops on any failure' })]));
    const rc = SX.data.recon || [];
    const fmtv = x => Array.isArray(x) ? x.join(' / ') : typeof x === 'boolean' ? (x ? 'yes' : 'no') : (typeof x === 'number' ? U.fmtInt(x) : String(x));
    root.append(el('p', { class: 'small muted', text: rc.filter(x => x.ok).length + ' of ' + rc.length + ' checks pass: grains and row counts, rebuilt client_events against the export, the rebuilt daily_client_activity against the events, the cohort population, every flag against its status list, the start-date and HENRY rules, duration formulas and the cash model’s identities.' }));
    root.append(SX.ui.table({ sortable: false, maxRows: 60, columns: [{ key: 'check', label: 'Check' }, { key: 'got', label: 'Result', fmt: fmtv }, { key: 'want', label: 'Expected', fmt: fmtv },
      { key: 'ok', label: 'Status', html: (v, row) => SX.ui.status(row.ok ? 'good' : 'critical', row.ok ? 'Pass' : 'Fail') }], rows: rc }));

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Which business metrics this version can support' })]));
    const sup = [
      ['Deals, wins and booked value by month', 'good', 'Supported', 'Pipedrive timestamps are complete. Only the STR Search pipeline is in the base; from June 2026 no-show bookings move to the SDR Setter pipeline.'],
      ['Win rate and sales cycle', 'good', 'Supported, with maturity caveat', 'Use matured cohorts; the sales cycle is short compared with the acquisition clock.'],
      ['Stage-to-stage conversion', 'critical', 'Not supported', 'Only the current stage is extracted. A stage-history extract is needed.'],
      ['Package / payment mix', 'warning', 'Partial', 'Package filled for most wins. Payment type is defaulted to Split Pay when blank; only a minority of deals carry a recorded value.'],
      ['Time to UC / CLOSED', 'good', 'Supported, with caveats', 'From client_start_date to the latest valid UC and the closing date. Fall-through is evidenced only partly (12 documented fall-out addresses; status evidence for the rest): see Engagements.'],
      ['Budget performance', 'good', 'Supported since 20 Apr 2026', 'Onboarding-form capital range (upper end) matched to 394 of 409 confirmed starts since the form went live; earlier clients show as Not recorded. Jira total_oop (HENRY) is recorded mostly at purchase.'],
      ['Conversion to UC / CLOSED', 'good', 'Supported as matured cohorts', 'client_cohort_performance windows (14–90 days), gross and refund-excluded; snapshot shares (Q2) need the cohort view beside them.'],
      ['Refund rate', 'warning', 'Partial', 'Current status Refunded with the status-change date; no refund amounts or transactions.'],
      ['Revenue, cash collected, receivables', 'warning', 'Modeled', 'client_cash_forecast models contractual cash from deal value and payment type; the Cash Forecast adds expected collections, affiliate revenue and refunds (bridge in Engagements).'],
      ['CAC / channel ROI', 'critical', 'Not yet', 'Ads spend, Rabbu cost and GHL are in separate workbooks, not joined here.'],
      ['Affiliate / referral income', 'warning', 'Partial', 'Cribs tracker (handoff by address) and brokerage / lender / affiliate records (closing evidence) are used; affiliate amounts are modeled in the Cash Forecast.'],
    ];
    root.append(SX.ui.table({ sortable: false, columns: [{ key: 'a', label: 'Metric' }, { key: 'b', label: 'Status', html: (v, row) => SX.ui.status(row.s, v) }, { key: 'c', label: 'Note' }], rows: sup.map(([a, s, b, c]) => ({ a, s, b, c })) }));
  };

  /* ------------------------------------------------------------ Explorer */
  SX.sections.explorer = function (root) {
    SX.head(root, 'explorer', 'Section 10 · Record explorer', 'Inspect the de-identified records behind every chart',
      'One row per Jira issue or STR Search deal, already filtered by the bar above. No names, emails, phones or addresses are included. ' + (SX.data.meta.anonymized ? 'In this public build, Jira keys, deal IDs and staff names are replaced with stable pseudonyms (J0001, D0001, Rep 01, Lead 01).' : 'Keys can be looked up in Jira and Pipedrive by people who have access.'));
    const v = { tab: 'jira', q: '', page: 0 };
    const tools = el('div', { class: 'explorer-tools' });
    const search = el('input', { class: 'search', type: 'search', placeholder: 'Search key, status, lead, channel…', 'aria-label': 'Search records' });
    const dl = el('button', { class: 'tool-btn', type: 'button', text: 'Download CSV' });
    const count = el('span', { class: 'small muted' });
    tools.append(SX.ui.seg('', [{ value: 'jira', label: 'Jira issues' }, { value: 'deals', label: 'Pipedrive deals' }], v.tab, t => { v.tab = t; v.page = 0; draw(); }), search, dl, count);
    root.append(tools);
    const box = el('div');
    root.append(box);
    const COLS = {
      jira: [
        { key: 'key', label: 'Jira key' }, { key: 'status', label: 'Status' }, { key: 'klass', label: 'Class' },
        { key: 'start', label: 'Client start', sort: r => r.start_d }, { key: 'start_src', label: 'Start rule' }, { key: 'uc', label: 'UC (latest)', sort: r => r.uc_d },
        { key: 'days_uc', label: 'Days to UC', num: true }, { key: 'closed', label: 'Closed', sort: r => r.closed_d }, { key: 'days_closed', label: 'Days to CLOSED', num: true },
        { key: 'assignee', label: 'Acquisition lead' }, { key: 'deal_id', label: 'Deal ID' }, { key: 'pd_status', label: 'Deal status' }, { key: 'pd_product', label: 'Package' }, { key: 'pd_source', label: 'Channel' }, { key: 'hunting', label: 'Hunting', fmt: x => x ? 'yes' : '' }],
      deals: [
        { key: 'id', label: 'Deal ID' }, { key: 'created', label: 'Created', sort: r => r.created_d }, { key: 'status', label: 'Status' }, { key: 'stage', label: 'Stage' },
        { key: 'won_date', label: 'Won', sort: r => r.won_date_d }, { key: 'days_to_win', label: 'Days to win', num: true }, { key: 'value', label: 'Value', num: true, fmt: x => x == null ? '–' : U.fmtMoney(x) },
        { key: 'lost_reason', label: 'Lost reason' }, { key: 'source', label: 'Channel' }, { key: 'rep', label: 'Rep' }, { key: 'product', label: 'Package' }, { key: 'payment', label: 'Payment' },
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
