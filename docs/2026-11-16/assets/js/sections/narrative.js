/* Shared calculations + narrative sections: Overview, How it works, Definitions. */
(function () {
  'use strict';
  const SX = window.SX, U = SX.util, C = SX.charts, el = U.el;
  SX.sections = SX.sections || {};

  /* ------------------------------------------------------------ shared calculations */
  const calc = SX.calc = {
    stats(arr) {
      const v = arr.filter(x => x != null && x >= 0);
      return { n: v.length, mean: U.mean(v), median: U.median(v), p25: U.quantile(v, 0.25), p75: U.quantile(v, 0.75), p90: U.quantile(v, 0.9) };
    },
    days(j, milestone, basis) {
      const m = j[milestone + '_d'];
      if (m == null) return null;
      const s = basis === 'created' ? j.created_d : basis === 'due' ? j.due_d : j.start_d;
      return s == null ? null : m - s;
    },
    monthCounts(rows, field) {
      const m = new Map();
      rows.forEach(r => { const d = r[field + '_d']; if (d == null) return; const k = U.monthKeyFromDay(d); m.set(k, (m.get(k) || 0) + 1); });
      return m;
    },
    /** Jira issues whose milestone date falls inside the period (event view, not start-date view). */
    jiraEvents(milestone) {
      const r = SX.state.range();
      return SX.model.jira({ ignorePeriod: true }).filter(j => { const d = j[milestone + '_d']; return d != null && (r.from == null || d >= r.from) && (r.to == null || d <= r.to); });
    },
    km(rows, milestone, basis) {
      const asof = SX.data.asofDay;
      const items = [];
      rows.forEach(j => {
        const s = basis === 'created' ? j.created_d : basis === 'due' ? j.due_d : j.start_d;
        if (s == null) return;
        const m = j[milestone + '_d'];
        items.push(m != null ? { t: m - s, e: true } : { t: asof - s, e: false });
      });
      return U.kaplanMeier(items);
    },
    groupColor(t, group) {
      return ({ 'Pre-sale onboarding': t.series[2], 'Declined': t.deemph, 'Hunting': t.series[0], 'Under contract': t.series[4],
        'Closed': t.series[1], 'Post-close': t.series[3], 'Inactive': t.deemph2, 'Other': t.deemph })[group] || t.deemph;
    },
    groups() { return SX.data.defs.status_groups.map(g => g.name); },
  };

  function head(root, id, kicker, title, lede) {
    const h = el('div', { class: 'section-head' }, [
      el('div', { class: 'section-kicker', text: kicker }),
      el('h2', { id: id + '-title', text: title }),
      lede ? el('p', { class: 'section-lede', text: lede }) : null,
    ]);
    root.append(h);
    return h;
  }
  SX.head = head;

  /** Re-render a block of DOM on every filter change. */
  SX.live = function (parent, draw) {
    const box = el('div');
    parent.append(box);
    const run = () => { box.textContent = ''; draw(box); };
    run();
    SX.bus.on('filters', run);
    return box;
  };

  /* ------------------------------------------------------------ Overview */
  SX.sections.overview = function (root) {
    const D = SX.data, m = D.meta, ex = D.expected, v = m.version || {};
    root.append(el('div', { class: 'hero-kicker', text: 'Business Data Explorer · ' + (v.label || '') + ' reporting package' }));
    root.append(el('h1', { id: 'overview-title', text: 'How STRSearch’s sales and client acquisition fit together' }));
    root.append(el('p', { class: 'hero-lede', text: 'Built from the Supabase reporting layer (SQL views refreshed ' + U.fmtDate(m.asof) + '): Pipedrive deals, Jira client issues, and one row per won engagement that links them. Every figure follows the reporting layer’s definitions; the 12 Nov 2026 package stays available, unchanged, in the version menu.' }));
    const chips = el('div', { class: 'chips' });
    chips.append(el('span', { class: 'chip', text: 'Data as of ' + U.fmtDate(m.asof) }), el('span', { class: 'chip', text: 'Built ' + m.built_at }), el('span', { class: 'chip', text: (D.recon || []).filter(r => r.ok).length + '/' + (D.recon || []).length + ' reconciliation checks pass' }));
    root.append(chips);

    SX.live(root, box => {
      const deals = SX.model.deals(), won = deals.filter(d => d.status === 'won');
      const sig = SX.model.jira({ population: 'signed' }), eng = SX.model.eng({ population: 'confirmed' });
      const per = SX.state.range().label;
      const row = el('div', { class: 'kpis' });
      SX.ui.kpi(row, { sys: 'Pipedrive', label: 'Deals (STR Search)', value: U.fmtInt(deals.length), sub: 'created ' + per });
      SX.ui.kpi(row, { sys: 'Pipedrive', label: 'Won deals', value: U.fmtInt(won.length), sub: U.fmtPct(U.ratio(won.length, deals.length)) + ' of deals' });
      SX.ui.kpi(row, { sys: 'Pipedrive', label: 'Booked value (won)', value: U.fmtMoney(U.sum(won, d => d.value), true), sub: 'deal value, not cash' });
      SX.ui.kpi(row, { sys: 'Jira', label: 'Signed-up clients', value: U.fmtInt(sig.length), sub: U.fmtInt(sig.filter(j => j.active).length) + ' Active · ' + U.fmtInt(sig.filter(j => j.hunting).length) + ' hunting' });
      SX.ui.kpi(row, { sys: 'Engagements', label: 'Confirmed starts', value: U.fmtInt(eng.length), sub: 'won deals with a Jira client_start_date' });
      const su = calc.stats(eng.map(e => calc.days(e, 'uc'))), sc = calc.stats(eng.map(e => calc.days(e, 'closed')));
      SX.ui.kpi(row, { cls: 'kpi--accent', sys: 'Engagements', label: 'Median days to UC / CLOSED', value: U.fmtMed(su.median) + ' / ' + U.fmtMed(sc.median), unit: 'days', sub: 'from client_start_date · means ' + U.fmt1(su.mean) + ' / ' + U.fmt1(sc.mean) });
      box.append(row);
      const flow = el('div', { class: 'flow' });
      const allEng = SX.model.eng({ dateField: 'won_date' });
      const steps = [['Deals', deals.length, 'Pipedrive, created in period'], ['Won', won.length, 'contract signed'],
        ['Won with a Jira match', allEng.filter(e => e.has_jira).length, 'won in period, unique Jira link'],
        ['Confirmed starts', eng.length, 'client_start_date in period'], ['Reached UC', eng.filter(e => e.uc_d != null).length, 'latest valid contract'],
        ['CLOSED', eng.filter(e => e.closed_d != null).length, 'completed closings'], ['Post-close', eng.filter(e => e.group === 'Post-close').length, 'photography, listing']];
      steps.forEach((s, i) => { flow.append(el('div', { class: 'flow-step' }, [el('b', { text: U.fmtInt(s[1]) }), el('span', { text: s[0] }), el('small', { text: s[2] })])); });
      box.append(flow);
      box.append(el('p', { class: 'small muted', text: 'Deal steps are dated by the Pipedrive created date (won-with-Jira by won date); client steps by client_start_date. Different clocks, so steps are not a strict funnel.' }));
    });

    const t = el('div', { class: 'takeaways' });
    const card = (kicker, title, body, href) => t.append(el('a', { class: 'takeaway', href }, [el('div', { class: 'kicker', text: kicker }), el('h4', { text: title }), el('p', { text: body })]));
    const q = ex.q3.filter(r => r.month < D.asofMonth).slice(-1)[0] || {};
    card('What changed', 'New reporting layer, new definitions', 'Client start = client_start_date (due date before 1 Jun 2026, won date from 1 Jun). Under Contract = latest valid contract. Durations use won engagements with a confirmed start.', '#definitions');
    card('Key question 1', 'Median ' + U.fmtMed(ex.q1.uc.median) + ' days to UC, ' + U.fmtMed(ex.q1.closed.median) + ' to CLOSED', 'Means ' + U.fmt1(ex.q1.uc.mean) + ' and ' + U.fmt1(ex.q1.closed.mean) + ' days. Counting unfinished journeys (Kaplan-Meier), half reach UC by day ' + U.fmtInt(ex.q1.km_uc) + ' and CLOSED by day ' + U.fmtInt(ex.q1.km_closed) + '.', '#questions');
    card('Key question 2', U.fmtPct(U.ratio(ex.q2.active_uc, ex.q2.active)) + ' of Active clients reached UC', U.fmtPct(U.ratio(ex.q2.active_closed, ex.q2.active)) + ' reached CLOSED (' + U.fmtInt(ex.q2.active) + ' Active Jira clients, of whom ' + U.fmtInt(ex.q2.hunting) + ' are hunting).', '#q2');
    card('Pace', (q.net_client_change >= 0 ? '+' : '') + U.fmtInt(q.net_client_change) + ' net clients in ' + U.fmtMonth(q.month), U.fmtInt(q.started) + ' confirmed starts against ' + U.fmtInt(q.uc) + ' Under Contract events that month (calendar throughput, not a backlog).', '#q3');
    card('Data caution', 'Some fields are recorded only at purchase', 'total_oop, purchase price and deals sent are mostly filled once a client goes under contract, so they cannot explain speed without survivorship bias.', '#health');
    root.append(t);
  };

  /* ------------------------------------------------------------ How it works */
  SX.sections.how = function (root) {
    head(root, 'how', 'Section 1 · The reporting layer', 'Where each figure comes from',
      'Two operational systems feed five reporting views. Pipedrive tracks the sale, Jira tracks the property search, and won_clients_master links each won deal to its Jira issue. Winning a deal and closing a property are separate events on separate clocks.');
    const D = SX.data, ex = D.expected, src = (D.meta.sources || {}).sheets || [];
    const rows = Object.fromEntries(src.map(s => [s.sheet, s.rows]));
    const sys = el('div', { class: 'systems' });
    const card = (name, role, p, dl) => {
      const c = el('div', { class: 'system-card' }, [el('div', { class: 'role', text: role }), el('h4', { text: name }), el('p', { text: p })]);
      if (dl) { const d = el('dl'); dl.forEach(([k, v]) => d.append(el('dt', { text: k }), el('dd', { text: v }))); c.append(d); }
      sys.append(c);
    };
    card('pipedrive_reporting_base', 'Sales · one row per deal', 'Every STR Search Pipedrive deal with its stage, outcome, value, product, funnel flags and UTM fields.', [['Rows', U.fmtInt(rows.pipedrive_reporting_base)], ['In scope', U.fmtInt(ex.deals.in_scope)], ['Won', U.fmtInt(ex.deals.won_all)]]);
    card('jira_reporting_base', 'Acquisition · one row per Jira issue', 'Client issues and, since 27 May 2026, pre-sale prospects. Carries client_start_date, the signed / active / inactive / hunting / HENRY flags and the milestone dates.', [['Rows', U.fmtInt(rows.jira_reporting_base)], ['Signed-up', U.fmtInt(ex.jira.signed)], ['Hunting', U.fmtInt(ex.jira.hunting)]]);
    card('won_clients_master', 'Link · one row per won deal', 'Every won deal, matched to its Jira issue through the deal id parsed from the Jira deal URL. Refunds, repeats and missing Jira records stay in.', [['Engagements', U.fmtInt(ex.engagements.total)], ['With Jira', U.fmtInt(ex.engagements.has_jira)], ['Confirmed starts', U.fmtInt(ex.engagements.confirmed_starts)]]);
    card('Derived views', 'Events · daily · cohorts · cash', 'client_events (one row per milestone), daily_client_activity and client_cohort_performance (rebuilt here from their SQL and reconciled), client_cash_forecast (modeled, not receipts).', [['Events', U.fmtInt(rows.client_events)], ['Reconciliation', (D.recon || []).filter(r => r.ok).length + '/' + (D.recon || []).length + ' pass']]);
    root.append(sys);

    const won = D.deals.filter(d => d.in_scope && d.status === 'won');
    const clocks = el('div', { class: 'clocks' });
    const clock = (title, nodes, segs, note) => {
      const c = el('div', { class: 'clock' }, [el('h4', { text: title })]);
      const tr = el('div', { class: 'track' });
      nodes.forEach((n, i) => { tr.append(el('div', { class: 'node' }, [el('b', { text: n[0] }), n[1]])); if (i < segs.length) tr.append(el('div', { class: 'seg-line' }, [el('span', { text: segs[i] })])); });
      c.append(tr, el('p', { text: note }));
      clocks.append(c);
    };
    clock('Sales clock (Pipedrive)', [['Deal created', 'call booked'], ['Won', 'contract signed']], ['median ' + U.fmtInt(ex.deals.median_days_to_win) + ' d'],
      'Median days from deal creation to won date, across ' + U.fmtInt(won.length) + ' won in-scope deals.');
    clock('Acquisition clock (reporting layer)', [['client_start_date', 'due date before 1 Jun 2026 · won date from 1 Jun'], ['Under Contract', 'latest valid contract'], ['CLOSED', 'closing date']],
      ['median ' + U.fmtMed(ex.q1.uc.median) + ' d', 'median ' + U.fmtMed(ex.q1.uc_to_close.median) + ' d'],
      'Won engagements with a confirmed Jira start; completed milestones only. Days = milestone date − client start date.');
    root.append(clocks);

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Two dates to keep apart: 27 May and 1 June 2026' })]));
    const g = el('div', { class: 'grid grid-12' });
    root.append(g);
    const left = el('div', { class: 'span-8' }), right = el('div', { class: 'span-4' });
    g.append(left, right);
    C.card(left, {
      id: 'how-intake', title: 'New Jira issues per month, by today’s status group', subtitle: 'Issue created month · all issues · respects filters', height: 320,
      render({ t }) {
        const rows = SX.model.jira({ dateField: 'created' });
        const months = SX.model.months('2024-03');
        const groups = calc.groups();
        const by = new Map(groups.map(gr => [gr, new Map()]));
        rows.forEach(j => { const k = U.monthKeyFromDay(j.created_d); const mm = by.get(j.group) || by.get('Other'); if (mm) mm.set(k, (mm.get(k) || 0) + 1); });
        const series = groups.filter(gr => Array.from(by.get(gr).values()).some(Boolean)).map(gr => C.stackBar(gr, months.map(k => by.get(gr).get(k) || 0), calc.groupColor(t, gr), 'g', t));
        if (!series.length) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }), xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t), series }),
          table: { columns: [{ key: 'm', label: 'Month' }].concat(series.map((s, i) => ({ key: 's' + i, label: s.name, num: true }))), rows: months.map((k, mi) => Object.assign({ m: U.fmtMonth(k) }, Object.fromEntries(series.map((s, i) => ['s' + i, s.data[mi]])))) },
        };
      },
    });
    right.append(el('div', { class: 'callout mt-0' }, [el('h4', { text: 'Operational change vs reporting rule' }), el('ul', {}, [
      el('li', { text: '27 May 2026 — New Client Experience (operational): Jira issues now open at onboarding booking, before the sale, so raw issue counts include prospects.' }),
      el('li', { text: '1 Jun 2026 — reporting rule: issues created from this date take the Pipedrive won date as client_start_date; earlier issues keep the due date (or created + 4 days).' }),
      el('li', { text: 'Neither date alone proves a cause for changes in speed or volume: the new experience, the Complete package and the start rule overlap in time.' })])]));
  };

  /* ------------------------------------------------------------ Definitions */
  SX.sections.definitions = function (root) {
    const D = SX.data, defs = D.defs, ch = D.raw.changes;
    head(root, 'definitions', 'Section 9 · Definitions', 'Definitions, sources and what changed since 12 Nov 2026',
      'The reporting layer’s SQL reference (dated ' + U.fmtDate(defs.sql_reference.dated) + ') is authoritative for this version. Every rule below is re-checked against the export on each build.');
    const sm = defs.status_meta, st = defs.statuses;
    const rows = Object.keys(sm).map(s => ({ s, g: sm[s].group, o: sm[s].order, sig: st.signed_up.includes(s), act: st.active.includes(s), hun: st.hunting.includes(s), m: sm[s].meaning }));
    const yes = v => v ? '✓' : '';
    root.append(el('h3', { text: 'Jira statuses and the reporting-layer flags' }), SX.ui.table({ sortKey: 'o', sortDir: 1, columns: [
      { key: 's', label: 'Status' }, { key: 'g', label: 'Group' }, { key: 'sig', label: 'signed_up_client', fmt: yes }, { key: 'act', label: 'active_clients', fmt: yes },
      { key: 'hun', label: 'hunting_clients', fmt: yes }, { key: 'm', label: 'Meaning' }], rows }));
    const items = [
      ['Client start date', defs.start_rule],
      ['Under Contract', defs.milestones.uc], ['Passed inspection', defs.milestones.pi], ['CLOSED', defs.milestones.closed], ['Refund', defs.milestones.refund],
      ['Active vs hunting', 'active_clients = signed-up minus Refunded, Paused and Additional Service; it includes closed and post-close clients. hunting_clients = Client Start, 2, 4, 6 and 8 Weeks: the clients still searching.'],
      ['Engagement', 'One won STR Search Pipedrive deal (won_clients_master). Repeat purchases are separate engagements; refunded and Jira-less won deals stay in.'],
      ['Confirmed start', 'client_start_date_source = JIRA. A Pipedrive fallback (won date) is not a confirmed start and never enters starts, durations or cohorts.'],
      ['Monthly throughput', 'daily_client_activity: SUM daily counts by month; net change = starts − UC; replacement rate = UC ÷ starts recomputed from sums; cumulative net change is the last day’s value and is not the hunting backlog.'],
      ['Matured cohorts', 'client_cohort_performance: a client enters an N-day window only once N days have passed (eligible_N); conversion = SUM(uc_within_N × eligible_N) ÷ SUM(eligible_N). Refund-excluded drops currently refunded clients.'],
      ['HENRY', defs.henry], ['Modeled cash', defs.cash],
      ['Deals sent', 'total_deals_sent is the current cumulative total with no dates; there is no record of when each property was sent.'],
    ];
    const dl = el('dl', { class: 'defs' });
    items.forEach(([k, v]) => dl.append(el('dt', { text: k }), el('dd', { text: v })));
    root.append(el('h3', { class: 'mt-2', text: 'Metric definitions' }), dl);
    if (ch && ch.headline) {
      const o = ch.headline.old, n = ch.headline.new, pc = v => v == null ? '–' : U.fmtPct(v);
      const hr = [['Signed-up clients', o.signed, n.signed], ['Active / Inactive', o.active + ' / ' + o.inactive, n.active + ' / ' + n.inactive],
        ['Median / mean days to UC', o.uc_median + ' / ' + o.uc_mean, n.uc_median + ' / ' + n.uc_mean], ['Median / mean days to CLOSED', o.closed_median + ' / ' + o.closed_mean, n.closed_median + ' / ' + n.closed_mean],
        ['Kaplan-Meier day 50% (UC / CLOSED)', o.km_uc + ' / ' + o.km_closed, n.km_uc + ' / ' + n.km_closed], ['Active reaching UC / CLOSED', pc(o.active_uc_share) + ' / ' + pc(o.active_closed_share), pc(n.active_uc_share) + ' / ' + pc(n.active_closed_share)]];
      root.append(el('h3', { class: 'mt-2', id: 'changes', text: 'Why 12 Nov and 16 Nov figures differ' }),
        SX.ui.table({ sortable: false, columns: [{ key: 'k', label: 'Figure' }, { key: 'o', label: '12 Nov 2026 (archived)' }, { key: 'n', label: '16 Nov 2026' }], rows: hr.map(r => ({ k: r[0], o: r[1], n: r[2] })) }));
      const sd = ch.start_date, uc = ch.under_contract, cl = ch.closing, rc = ch.records;
      root.append(el('ul', { class: 'changes' }, [
        el('li', { text: 'Populations: ' + ch.headline.populations.old + ' (12 Nov) vs ' + ch.headline.populations.new + ' (16 Nov).' }),
        el('li', { text: 'Start date: ' + sd.differ + ' of ' + sd.signed_compared + ' signed clients in both packages have a different start (' + sd.pre_june_plus4 + ' pre-June issues move by +4 days; ' + sd.post_june.differ + ' issues from June take the won date, median shift ' + sd.post_june.median_shift + ' days).' }),
        el('li', { text: 'Under Contract: ' + uc.moved + ' clients’ UC date moved to their latest valid contract (median +' + uc.median_move_days + ' days); ' + uc.new_only + ' now have a UC date the old package lacked.' }),
        el('li', { text: 'Closing: ' + cl.differ + ' of ' + cl.compared + ' closing dates differ (' + cl.earlier + ' earlier, median ' + cl.median_diff_days + ' days); ' + cl.new_only + ' clients newly have one; ' + cl.scheduled_after_asof + ' are dated after the data date.' }),
        el('li', { text: 'Records: ' + rc.dropped.n + ' Jira issues in the 12 Nov package are absent now (' + rc.dropped.signed + ' signed-up); ' + rc.added.created_before_old_asof + ' older issues appear for the first time.' }),
        el('li', { text: 'Monthly starts: from June 2026 a start is the won date, so starts move between months and no longer fill in after a month ends.' })]));
    }
    const s = D.meta.sources || {};
    root.append(el('h3', { class: 'mt-2', text: 'Sources' }), el('ul', {}, [
      el('li', { text: (s.workbook || {}).file + ' — ' + ((s.sheets || []).map(x => x.sheet + ' (' + U.fmtInt(x.rows) + ' rows)').join(', ')) }),
      el('li', { text: defs.sql_reference.file + ' (dated ' + defs.sql_reference.dated + '). Not exported, rebuilt from their SQL: ' + defs.not_exported_views.join(', ') + '.' }),
      el('li', { text: 'Record keys, deal ids and staff names are pseudonymised in the public build. No names, e-mails, addresses, URLs, prices, budgets or free text are published.' })]));
  };
})();
