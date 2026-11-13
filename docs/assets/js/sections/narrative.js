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
      return ({ 'Pre-sale onboarding': t.series[2], 'Declined': t.deemph, 'Searching': t.series[0], 'Under contract': t.series[4],
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
    const m = SX.data.meta;
    root.append(
      el('div', { class: 'section-kicker', text: 'STRSearch internal BI · Pipedrive + Jira' }),
      el('h1', { id: 'overview-title', text: 'From booked call to closed property: how STRSearch’s pipeline really moves' }),
      el('p', { class: 'section-lede', text: 'A prospect books a call (Calendly), becomes a Pipedrive deal and, if they buy, a Jira client the acquisitions team guides to an Under Contract and then a CLOSED property. This explorer follows records through both systems, answers Carson’s three Jira questions, and shows where the data can and cannot be trusted.' }),
    );
    const strip = el('div', { class: 'snapshot-strip' });
    m.sources.filter(s => s.snapshot).forEach(s => strip.append(el('span', { class: 'chip' }, [el('span', { class: 'dot' }), (s.key === 'jira' ? 'Jira' : 'Pipedrive') + ' extract ' + s.snapshot])));
    strip.append(el('span', { class: 'chip', text: 'Built ' + m.built_at }));
    root.append(strip);

    SX.live(root, box => {
      const deals = SX.model.deals(), won = deals.filter(d => d.status === 'won');
      const signed = SX.model.jira({ population: 'signed' });
      const ucE = calc.jiraEvents('uc'), clE = calc.jiraEvents('closed');
      const dUC = calc.stats(SX.model.jira().map(j => calc.days(j, 'uc')));
      const dCL = calc.stats(SX.model.jira().map(j => calc.days(j, 'closed')));
      const per = SX.state.range().label;
      const row = el('div', { class: 'kpi-row' });
      SX.ui.kpi(row, { sys: 'PD', label: 'Deals (STR Search)', value: U.fmtInt(deals.length), sub: 'Official PD_Deals filter · created ' + per });
      SX.ui.kpi(row, { sys: 'PD', label: 'Won deals', value: U.fmtInt(won.length), sub: U.fmtPct(U.ratio(won.length, deals.length), 1) + ' of those deals, so far' });
      SX.ui.kpi(row, { sys: 'PD', label: 'Booked value (won)', value: U.fmtMoney(U.sum(won, d => d.value), true), sub: 'Sales-entered Deal_Value. Not cash or revenue' });
      SX.ui.kpi(row, { sys: 'Jira', label: 'Signed-up clients', value: U.fmtInt(signed.length), sub: 'Carson’s signed-up statuses · effective start ' + per });
      SX.ui.kpi(row, { sys: 'Jira', label: 'Under Contract events', value: U.fmtInt(ucE.length), sub: 'First UC dates ' + per });
      SX.ui.kpi(row, { sys: 'Jira', label: 'CLOSED events', value: U.fmtInt(clE.length), sub: 'First CLOSED dates ' + per });
      SX.ui.kpi(row, { sys: 'Jira', label: 'Median days to UC / CLOSED', value: U.fmtInt(dUC.median) + ' / ' + U.fmtInt(dCL.median), unit: 'days', sub: 'From COALESCE(due, created), completed milestones only' });
      box.append(row);

      // Lifecycle flow for the current slice
      const withJira = won.filter(d => d.has_jira).length;
      const reachedUC = signed.filter(j => j.uc_d != null).length, reachedCL = signed.filter(j => j.closed_d != null).length;
      const flow = el('div', { class: 'flow mt-2', role: 'list', 'aria-label': 'Lifecycle counts' });
      const step = (cls, sys, name, num, desc) => flow.append(el('div', { class: 'flow-step ' + cls, role: 'listitem' }, [
        el('div', { class: 'flow-sys', text: sys }), el('div', { class: 'flow-name', text: name }), el('div', { class: 'flow-num', text: num }), el('div', { class: 'flow-desc', text: desc })]));
      step('is-top', 'GHL · Ads · Rabbu', 'Lead & call booked', U.fmtInt(deals.length), 'Calendly booking creates a Pipedrive deal');
      step('is-sales', 'Pipedrive', 'Won (sale)', U.fmtInt(won.length), 'Won date set: service sold');
      step('is-sales', 'Pipedrive → Jira', 'Won with Jira issue', U.fmtInt(withJira), U.fmtPct(U.ratio(withJira, won.length)) + ' of won deals are linked');
      step('is-acq', 'Jira', 'Signed-up clients', U.fmtInt(signed.length), 'Started in period (Carson list)');
      step('is-acq', 'Jira', 'Reached Under Contract', U.fmtInt(reachedUC), U.fmtPct(U.ratio(reachedUC, signed.length)) + ' of those clients so far');
      step('is-acq', 'Jira', 'Reached CLOSED', U.fmtInt(reachedCL), U.fmtPct(U.ratio(reachedCL, signed.length)) + ' of those clients so far');
      step('is-acq', 'Jira', 'Post-close', U.fmtInt(signed.filter(j => j.group === 'Post-close').length), 'Photography, listing or archived');
      box.append(flow);
      box.append(el('p', { class: 'small muted mt-1', text: 'The two halves use different clocks: deals by Pipedrive created date, clients by Jira effective start. Shares are “so far” because recent records are still moving.' }));
    });

    const e = SX.data.expected, q = e.q2, sm = SX.data.extras.sdr_moves;
    const tk = el('div', { class: 'takeaways' });
    const card = (k, h, p, href) => tk.append(el('div', { class: 'takeaway' }, [el('div', { class: 'tk-kicker', text: k }), el('h3', { text: h }), el('p', { text: p }), href ? el('a', { href, text: 'See the evidence →' }) : null]));
    card('Process change', 'Jira is no longer only signed clients', 'Since the New Client Experience (May 27, 2026), Jira issues open at onboarding, before the sale. ' + U.fmtInt(e.jira.unmapped) + ' of ' + U.fmtInt(e.jira.total) + ' issues are pre-sale prospects in statuses outside Carson’s lists.', '#how');
    card('Carson Q1', 'Median ' + U.fmtInt(e.q1.uc.median) + ' days to UC, ' + U.fmtInt(e.q1.closed.median) + ' to CLOSED', 'For clients who got there (means ' + U.fmt1(e.q1.uc.mean) + ' / ' + U.fmt1(e.q1.closed.mean) + '). Counting clients still searching, half of signed-up clients reach UC by day ' + U.fmtInt(e.q1.km_uc_signed) + ' and CLOSED by day ' + U.fmtInt(e.q1.km_closed_signed) + '.', '#questions');
    card('Carson Q2', U.fmtPct(q.active_uc / q.active) + ' of Active clients have gone UC', U.fmtPct(q.active_closed / q.active) + ' have CLOSED. This is a current-status snapshot: the Active list includes CLOSED and post-close clients and excludes refunded ones. The cohort view tells the forward-looking story.', '#q2');
    card('Data caution', 'No-show calls now leave the STR Search pipeline', 'Since June 2026, booked calls that no-show are moved into the SDR Setter pipeline (' + U.fmtInt(U.sum(sm.filter(s => s.month >= '2026-06'), s => s.p6_calendly_booked)) + ' deals). STR Search deal counts and no-show rates drop and win rates rise for that reason, not only because of performance.', '#health');
    card('Money', 'Booked value is not revenue', 'Pipedrive Deal_Value (median ' + U.fmtMoney(U.median(SX.data.deals.filter(d => d.in_scope && d.status === 'won').map(d => d.value))) + ') is what sales entered. There is no payment, refund-amount or cash data in these extracts, so revenue and cash work needs another source.', '#definitions');
    root.append(tk);
  };

  /* ------------------------------------------------------------ How it works */
  SX.sections.how = function (root) {
    head(root, 'how', 'Section 1 · The operating model', 'How STRSearch works, and where each system records it',
      'Marketing generates leads, Calendly books the call, Pipedrive tracks the sale and Jira tracks the property search. Winning a deal (sale) and closing a property (Jira CLOSED) are two separate events with two separate clocks.');
    const D = SX.data, ex = D.expected;
    const linkPct = U.ratio(D.jira.filter(j => j.deal_found).length, D.jira.length);
    const sys = el('div', { class: 'systems' });
    const card = (name, role, p, dl) => {
      const c = el('div', { class: 'system-card' }, [el('div', { class: 'role', text: role }), el('h4', { text: name }), el('p', { text: p })]);
      if (dl) { const d = el('dl'); dl.forEach(([k, v]) => d.append(el('dt', { text: k }), el('dd', { text: v }))); c.append(d); }
      sys.append(c);
    };
    card('GoHighLevel · Ads · Rabbu', 'Top of funnel', 'Website, lead capture and marketing attribution. Rabbu sells purchased leads. Not loaded here except as Pipedrive lead source.', [['In this explorer', 'via PD_Source']]);
    card('Calendly', 'Booking bridge', 'A booked strategy call creates the Pipedrive deal and carries UTM/referral attribution.', [['Evidence', 'Calendly_ID on deals']]);
    card('Pipedrive · STR Search pipeline', 'Sales CRM', 'One deal per booked call, moved through 16 stages to Contract Signed (won) or lost.', [['Deals (official)', U.fmtInt(ex.deals.in_scope)], ['Won', U.fmtInt(ex.deals.won)], ['SDR Setter pipeline', U.fmtInt(D.extras.p6_total) + ' (excluded)']]);
    card('Jira · Search Clients (CLIEN)', 'Acquisition CRM', 'The acquisitions team runs the client’s property search: check-in statuses, Under Contract, Passed Inspection, CLOSED, then post-close services.', [['Issues', U.fmtInt(ex.jira.total)], ['Signed-up (Carson)', U.fmtInt(ex.jira.signed)], ['Linked to a deal', U.fmtPct(linkPct)]]);
    root.append(sys);

    // Two clocks
    const won = D.deals.filter(d => d.in_scope && d.status === 'won');
    const sig = D.jira.filter(j => j.carson_signed);
    const l2c = U.median(sig.filter(j => j.closed_d != null && j.pd_created_d != null).map(j => j.closed_d - j.pd_created_d));
    const clocks = el('div', { class: 'clocks' });
    const clock = (title, nodes, segs, note) => {
      const c = el('div', { class: 'clock' }, [el('h4', { text: title })]);
      const tr = el('div', { class: 'track' });
      nodes.forEach((n, i) => { tr.append(el('div', { class: 'node' }, [el('b', { text: n[0] }), n[1]])); if (i < segs.length) tr.append(el('div', { class: 'seg-line' }, [el('span', { text: segs[i] })])); });
      c.append(tr, el('p', { text: note }));
      clocks.append(c);
    };
    clock('Sales clock (Pipedrive)', [['Deal created', 'call booked'], ['Won', 'contract signed']], ['median ' + U.fmtInt(ex.deals.median_days_to_win) + ' d'],
      'Median days from deal creation to won date, across ' + U.fmtInt(won.length) + ' won deals. The mean is ' + U.fmt1(U.mean(won.map(d => d.days_to_win))) + ' days because of a long tail.');
    clock('Acquisition clock (Jira)', [['Effective start', 'COALESCE(due, created)'], ['Under Contract', 'first UC'], ['CLOSED', 'first CLOSED']],
      ['median ' + U.fmtInt(ex.q1.uc.median) + ' d', 'median ' + U.fmtInt(ex.q1.closed.median - ex.q1.uc.median) + ' d*'],
      'Completed milestones only. *Difference of medians. Lead-to-close (deal created → first CLOSED) has a median of ' + U.fmtInt(l2c) + ' days.');
    root.append(clocks);

    // Process change chart
    const sub = el('div', { class: 'subhead' }, [el('h3', { text: 'The May 2026 process change: Jira now opens before the sale' })]);
    root.append(sub);
    const g = el('div', { class: 'grid grid-12' });
    root.append(g);
    const left = el('div', { class: 'span-8' }), right = el('div', { class: 'span-4' });
    g.append(left, right);
    C.card(left, {
      id: 'how-intake', title: 'New Jira issues per month, by today’s status group',
      subtitle: 'Issue created month · all CLIEN issues · respects filters', height: 320,
      render({ t }) {
        const rows = SX.model.jira({ dateField: 'created' });
        const months = SX.model.months('2024-03');
        const groups = calc.groups().filter(gname => rows.some(j => j.group === gname));
        const series = groups.map(gname => {
          const m = calc.monthCounts(rows.filter(j => j.group === gname), 'created');
          return C.stackBar(gname, months.map(k => m.get(k) || 0), calc.groupColor(t, gname), 'g', t);
        });
        if (!rows.length) return { empty: true };
        return {
          option: C.base(t, { legend: C.legend(t), grid: { left: 6, right: 12, top: 56, bottom: 6, containLabel: true }, tooltip: Object.assign(C.tooltipBase(t), { formatter: C.axisTip(v => U.fmtInt(v)) }),
            xAxis: C.catAxis(t, months.map(k => U.fmtMonth(k, true))), yAxis: C.valAxis(t), series }),
          table: { columns: [{ key: 'm', label: 'Month' }].concat(groups.map(gname => ({ key: gname, label: gname, num: true }))),
            rows: months.map((k, i) => Object.assign({ m: U.fmtMonth(k) }, Object.fromEntries(groups.map((gname, gi) => [gname, series[gi].data[i]])))) },
          foot: 'Teal, amber and violet are signed clients. Blue is pre-sale onboarding and grey is declined or inactive. The jump from June 2026 is prospects, not extra clients.',
        };
      },
    });
    const ex2 = el('div', { class: 'callout callout--warn mt-0' }, [
      el('h4', { text: 'What changed on May 27, 2026' }),
      el('p', { text: 'Pipedrive tags deals “New Client Experience 5.27.26”. From then on the onboarding call happens before the contract, and Jira opens an issue at onboarding:' }),
      el('ul', {}, [
        el('li', { text: 'New Clients → Onboarding Completed → Client Start (signed) or Services Declined.' }),
        el('li', { text: 'issue_due_date = onboarding-call date (90% exact), often before the won date.' }),
        el('li', { text: 'Median issue creation moved from the won day to 5 days before it.' }),
      ]),
      el('p', { text: 'Consequence: “new Jira issues” no longer equals “new clients”. Use Carson’s signed-up list.' }),
    ]);
    right.append(ex2);

    root.append(el('div', { class: 'callout-grid' }, [
      el('div', { class: 'callout callout--insight' }, [el('h4', { text: 'How the records link' }), el('p', { text: 'Jira PD_Deal_ID → Pipedrive Deal_ID resolves for ' + U.fmtPct(linkPct, 1) + ' of issues and never repeats. Both systems agree on 1,504 pairs. This explorer joins from the Jira side. Email matching is not used: it adds almost nothing and misses 12% of agreed pairs.' })]),
      el('div', { class: 'callout callout--insight' }, [el('h4', { text: 'Packages and payments' }), el('p', { text: 'Search Product Sold is an option ID: [203] = Complete and [202] = Core (verified against a labelled Supabase extract). Payment Type [214]/[215] has no label anywhere. [214] is shown as “likely Split Pay” because it covers 93% of coded wins. Both fields are blank for most older wins.' })]),
      el('div', { class: 'callout callout--insight' }, [el('h4', { text: 'Booked value ≠ revenue' }), el('p', { text: 'Deal_Value is what sales typed into Pipedrive. Recognised revenue and cash collected (Split Pay schedules, refunds) are not in these extracts, so they are not shown.' })]),
    ]));
  };

  /* ------------------------------------------------------------ Definitions */
  SX.sections.definitions = function (root) {
    head(root, 'definitions', 'Section 8 · Definitions & method', 'Definitions, status map and open questions',
      'Every number above traces back to the rules on this page. Carson’s instructions take precedence, then verified data and scripts, then older documentation.');
    const D = SX.data, defs = D.defs;
    const counts = U.countBy(D.jira, j => j.status);
    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Jira status map' }), el('span', { class: 'hint', text: 'Carson’s classification is applied verbatim to the current Issue_Status' })]));
    const rows = Object.entries(defs.status_meta).filter(([s]) => s !== 'under Contract').map(([s, mm]) => ({
      status: s, group: mm.group, order: mm.order, n: counts.get(s) || 0,
      carson: defs.carson.inactive.includes(s) ? 'Inactive' : defs.carson.active.includes(s) ? 'Active' : 'Not in lists', meaning: mm.meaning,
    }));
    root.append(SX.ui.table({ columns: [
      { key: 'status', label: 'Status' }, { key: 'group', label: 'Lifecycle group' }, { key: 'carson', label: 'Carson class' },
      { key: 'n', label: 'Issues', num: true, fmt: U.fmtInt }, { key: 'meaning', label: 'What the data shows' }], rows, sortKey: 'order', sortDir: 1 }));
    root.append(el('details', { class: 'disclosure' }, [el('summary', { text: 'Carson’s status code (verbatim)' }), el('div', { class: 'pre', text:
      'signed_up_statuses = ' + JSON.stringify(defs.carson.signed_up) + '\ninactive_statuses = ' + JSON.stringify(defs.carson.inactive) +
      '\nactive_statuses = [s for s in signed_up_statuses if s not in inactive_statuses]\neffective_start = ' + defs.carson.effective_start +
      '\n\nNote: lowercase “underContract” never appears as a current status; it survives only in changelog fields (65 issues).'.replace('underContract', 'under Contract') })]));

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Metric definitions used here' })]));
    const md = [
      ['Deals (STR Search)', 'Pipedrive pipeline 3, official PD_Deals filter: not lost as Test Lead/Duplicate, Keep = 1, no internal email domain. Dated by Deal_Created_At_EST.'],
      ['Won deal / won date', 'Won time not null (US Eastern calendar date). Deal status is won, lost or open (current state).'],
      ['Win rate', 'Won ÷ deals created in the period. Recent cohorts are immature: open deals can still win, and the median time to win is 21 days.'],
      ['Not disqualified', 'Pipedrive “qualified” column = not lost as Not Qualified / AirVal / Partner Opportunity. This is not the stage rule in the FCT Definitions sheet.'],
      ['Booked value', 'Sum of Deal_Value on won deals. Sales-entered, so not revenue or cash.'],
      ['Signed-up / Active / Inactive', 'Carson’s lists applied to today’s Issue_Status (a snapshot, not history).'],
      ['Effective start', 'COALESCE(issue_due_date, issue_created_date). The due date is the onboarding-call date.'],
      ['Days to UC / CLOSED', 'first_under_contract_date (or first_closed_date) − effective start, in days. Negative values would be excluded (none exist). The ETL’s own days_to_* fields use the due date only.'],
      ['Kaplan-Meier curve', 'Share of signed-up clients reaching the milestone by day N, counting clients still searching up to the as-of date (' + D.meta.asof + ').'],
      ['Calendar throughput vs cohort', 'Throughput counts events in a month (different people). Cohort conversion follows the clients who started in a month.'],
    ];
    root.append(SX.ui.table({ sortable: false, columns: [{ key: 'a', label: 'Term', width: '22%' }, { key: 'b', label: 'Definition' }], rows: md.map(([a, b]) => ({ a, b })) }));

    root.append(el('div', { class: 'subhead' }, [el('h3', { text: 'Open questions for Carson' }), el('span', { class: 'hint', text: 'Decisions the data cannot make' })]));
    const qs = [
      'Should “Active” stay a current-status snapshot (CLOSED and post-close count as active), or become an entry-cohort definition for conversion KPIs?',
      'For clients with no due date, should the start fall back to issue creation (Carson’s rule), the Jira Client_Won_Date or the Pipedrive won date? Since May 2026, issue creation comes before the sale.',
      'Q3 “new clients”: signed-up clients by effective start (default here), or every new Jira issue? The two diverge sharply from June 2026.',
      'Should milestones be counted per client (first UC) or per property? ' + U.fmtPct(U.ratio(D.jira.filter(j => (j.uc_count || 0) > 1).length, D.jira.filter(j => j.uc_d != null).length)) + ' of clients who went UC have more than one UC event, and some close more than once.',
      'Confirm the Payment Type labels for options 214 and 215 in Pipedrive field settings.',
      'Should no-show and cancelled booked calls that move to the SDR Setter pipeline count as STR Search deals for funnel metrics?',
      'What does “Content Pulled” mean operationally?',
    ];
    root.append(el('ol', { class: 'small' }, qs.map(q => el('li', { text: q }))));

    root.append(el('details', { class: 'disclosure' }, [el('summary', { text: 'Sources and refresh' }), el('div', { class: 'small' }, [
      el('p', { text: 'Built from: ' + D.meta.sources.map(s => s.file + ' › ' + s.sheet + ' (' + U.fmtInt(s.rows) + ' rows' + (s.snapshot ? ', snapshot ' + s.snapshot : '') + ')').join('; ') + '.' }),
      el('p', { text: 'To refresh, drop the new reporting extracts in a folder and run python pipeline/build.py --reports "<folder>/Reporting Tables", then reload this page. See README.md.' }),
    ])]));
  };
})();
