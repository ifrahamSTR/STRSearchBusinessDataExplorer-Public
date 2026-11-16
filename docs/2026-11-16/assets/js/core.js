/* STRSearch Business Data Explorer: core runtime
   - SX.util   formatting, dates, statistics (median/quantile match pandas' linear method; Kaplan-Meier)
   - SX.bus    tiny pub/sub ('filters', 'theme')
   - SX.state  global filter state (one filter row scopes every section)
   - SX.theme  light/dark tokens read from CSS custom properties
   - SX.data   EXPLORER_DATA with columnar tables expanded into row objects
   - SX.model  filtered views (deals by created date, Jira issues and won engagements by client_start_date)
   Plain classic script (no modules) so the page also works when opened from disk. */
(function () {
  'use strict';
  const SX = (window.SX = window.SX || {});

  /* ------------------------------------------------------------------ util */
  const DAY_MS = 86400000;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nfInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

  const util = {
    /** 'YYYY-MM-DD' -> integer day number (UTC based, timezone-safe). */
    day(iso) {
      if (iso == null || iso === '') return null;
      const y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
      if (!y || !m || !d) return null;
      return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
    },
    isoFromDay(n) {
      if (n == null) return null;
      const dt = new Date(n * DAY_MS);
      return dt.toISOString().slice(0, 10);
    },
    monthKeyFromDay(n) {
      if (n == null) return null;
      const dt = new Date(n * DAY_MS);
      return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0');
    },
    quarterKeyFromDay(n) {
      if (n == null) return null;
      const dt = new Date(n * DAY_MS);
      return dt.getUTCFullYear() + '-Q' + (Math.floor(dt.getUTCMonth() / 3) + 1);
    },
    monthStartDay(key) { return util.day(key + '-01'); },
    monthEndDay(key) {
      const y = +key.slice(0, 4), m = +key.slice(5, 7);
      return Math.round(Date.UTC(y, m, 0) / DAY_MS);
    },
    addMonths(key, k) {
      let y = +key.slice(0, 4), m = +key.slice(5, 7) - 1 + k;
      y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
      return y + '-' + String(m + 1).padStart(2, '0');
    },
    monthsBetween(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); },
    monthRange(from, to) {
      const out = [];
      if (!from || !to || from > to) return out;
      for (let k = from; k <= to; k = util.addMonths(k, 1)) out.push(k);
      return out;
    },
    fmtMonth(key, short) {
      if (!key) return '';
      const m = MONTHS[+key.slice(5, 7) - 1];
      return short ? m + ' ' + key.slice(2, 4) : m + ' ' + key.slice(0, 4);
    },
    fmtDate(iso) {
      if (!iso) return '–';
      const n = typeof iso === 'number' ? iso : util.day(iso);
      const dt = new Date(n * DAY_MS);
      return MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate() + ', ' + dt.getUTCFullYear();
    },
    fmtInt(v) { return v == null || Number.isNaN(v) ? '–' : nfInt.format(Math.round(v)); },
    fmt1(v) { return v == null || Number.isNaN(v) ? '–' : nf1.format(v); },
    fmtCompact(v) {
      if (v == null || Number.isNaN(v)) return '–';
      const a = Math.abs(v);
      if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
      if (a >= 1e4) return Math.round(v / 1e3) + 'K';
      if (a >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
      return nfInt.format(v);
    },
    fmtPct(v, digits) {
      if (v == null || Number.isNaN(v)) return '–';
      const d = digits == null ? (Math.abs(v) < 0.1 && v !== 0 ? 1 : 0) : digits;
      return (v * 100).toFixed(d) + '%';
    },
    fmtMoney(v, compact) {
      if (v == null || Number.isNaN(v)) return '–';
      if (compact) {
        const a = Math.abs(v);
        if (a >= 1e6) return '$' + (v / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/0$/, '').replace(/\.$/, '') + 'M';
        if (a >= 1e3) return '$' + (v / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K';
      }
      return '$' + nfInt.format(Math.round(v));
    },
    /** Medians of whole days can end in .5: show that half rather than rounding it away. */
    fmtMed(v) { return v == null || Number.isNaN(v) ? '–' : (Number.isInteger(v) ? nfInt.format(v) : nf1.format(v)); },
    fmtDays(v) { return v == null || Number.isNaN(v) ? '–' : nfInt.format(Math.round(v)) + ' d'; },
    plural(n, one, many) { return util.fmtInt(n) + ' ' + (n === 1 ? one : (many || one + 's')); },
    escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },
    /** Minimal hyperscript. attrs: {class, text, html(trusted only), on:{click}, ...} */
    el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
          if (v == null || v === false) continue;
          if (k === 'class') node.className = v;
          else if (k === 'text') node.textContent = v;
          else if (k === 'html') node.innerHTML = v; // only for our own static markup
          else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
          else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
          else node.setAttribute(k, v === true ? '' : v);
        }
      }
      (children || []).forEach(c => { if (c != null) node.append(c.nodeType ? c : document.createTextNode(String(c))); });
      return node;
    },
    sum(arr, f) { let s = 0; for (const x of arr) { const v = f ? f(x) : x; if (v != null && !Number.isNaN(v)) s += v; } return s; },
    count(arr, f) { let c = 0; for (const x of arr) if (f(x)) c++; return c; },
    mean(arr) { const v = arr.filter(x => x != null && !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; },
    /** Quantile with linear interpolation (same as pandas/numpy default). */
    quantile(arr, q) {
      const v = arr.filter(x => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
      if (!v.length) return null;
      const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
      return v[lo] + (v[hi] - v[lo]) * (pos - lo);
    },
    median(arr) { return util.quantile(arr, 0.5); },
    groupBy(arr, f) {
      const m = new Map();
      for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
      return m;
    },
    countBy(arr, f) {
      const m = new Map();
      for (const x of arr) { const k = f(x); m.set(k, (m.get(k) || 0) + 1); }
      return m;
    },
    uniq(arr) { return Array.from(new Set(arr)); },
    ratio(n, d) { return d ? n / d : null; },
    /**
     * Kaplan-Meier estimator for "time to milestone".
     * items: [{t: days (event or censor time, >= 0), e: true if milestone reached}]
     * returns {curve: [[t, cumulativeShareReached]], median, atRiskStart, events}
     */
    kaplanMeier(items, maxT) {
      const v = items.filter(x => x.t != null && x.t >= 0).sort((a, b) => a.t - b.t);
      const n0 = v.length;
      let atRisk = n0, surv = 1, i = 0, events = 0, median = null;
      const curve = [[0, 0]];
      while (i < v.length) {
        const t = v[i].t;
        let d = 0, c = 0;
        while (i < v.length && v[i].t === t) { if (v[i].e) d++; else c++; i++; }
        if (d > 0 && atRisk > 0) {
          surv *= 1 - d / atRisk;
          events += d;
          curve.push([t, 1 - surv]);
          if (median == null && surv <= 0.5) median = t;
        }
        atRisk -= d + c;
        if (maxT != null && t > maxT) break;
      }
      return { curve, median, n: n0, events, finalShare: 1 - surv };
    },
    /** Read KM curve value at day t (step function). */
    kmAt(curve, t) {
      let y = 0;
      for (const [x, v] of curve) { if (x <= t) y = v; else break; }
      return y;
    },
    debounce(fn, ms) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; },
    downloadCSV(filename, columns, rows) {
      const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const csv = [columns.map(c => esc(c.label || c.key)).join(',')]
        .concat(rows.map(r => columns.map(c => esc(typeof c.csv === 'function' ? c.csv(r) : r[c.key])).join(','))).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
  };
  SX.util = util;

  /* ------------------------------------------------------------------ bus */
  const handlers = {};
  SX.bus = {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
    emit(ev, payload) { (handlers[ev] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error('[SX] handler error for', ev, e); } }); },
  };

  /* ---------------------------------------------------------------- theme */
  const THEME_KEY = 'sx-theme';
  SX.theme = {
    mode() {
      const forced = document.documentElement.getAttribute('data-theme');
      if (forced) return forced;
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    },
    set(mode) {
      document.documentElement.setAttribute('data-theme', mode);
      try { localStorage.setItem(THEME_KEY, mode); } catch (e) { /* storage unavailable */ }
      SX.bus.emit('theme', mode);
    },
    toggle() { SX.theme.set(SX.theme.mode() === 'dark' ? 'light' : 'dark'); },
    init() {
      try { const saved = localStorage.getItem(THEME_KEY); if (saved) document.documentElement.setAttribute('data-theme', saved); } catch (e) { /* ignore */ }
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
          if (!document.documentElement.getAttribute('data-theme')) SX.bus.emit('theme', SX.theme.mode());
        });
      }
    },
    /** Resolved colour tokens for charts. */
    tokens() {
      const cs = getComputedStyle(document.documentElement);
      const g = n => cs.getPropertyValue(n).trim();
      return {
        mode: SX.theme.mode(),
        surface: g('--surface'), bg: g('--bg'), ink: g('--ink'), inkStrong: g('--ink-strong'), ink2: g('--ink-2'), muted: g('--ink-muted'),
        border: g('--border'), grid: g('--chart-grid'), axis: g('--chart-axis'), label: g('--chart-label'),
        deemph: g('--chart-deemph'), deemph2: g('--chart-deemph-2'), accent: g('--accent'),
        series: [1, 2, 3, 4, 5].map(i => g('--series-' + i)),
        seq: [0, 1, 2, 3, 4, 5, 6, 7].map(i => g('--seq-' + i)),
        status: { good: g('--status-good'), warning: g('--status-warning'), serious: g('--status-serious'), critical: g('--status-critical') },
      };
    },
  };

  /* ----------------------------------------------------------------- data */
  function expand(table, dateCols) {
    if (!table || !table.columns) return [];
    const cols = table.columns;
    const out = new Array(table.rows.length);
    for (let i = 0; i < table.rows.length; i++) {
      const r = table.rows[i], o = {};
      for (let j = 0; j < cols.length; j++) o[cols[j]] = r[j];
      for (const c of dateCols) o[c + '_d'] = util.day(o[c]);
      out[i] = o;
    }
    return out;
  }

  SX.loadData = function () {
    const raw = window.EXPLORER_DATA;
    if (!raw) throw new Error('EXPLORER_DATA missing: run pipeline/build.py to generate docs/data/explorer-data.js');
    const dealDates = (raw.deals.date_columns || []);
    const jiraDates = (raw.jira.date_columns || []);
    SX.data = {
      raw,
      meta: raw.meta,
      defs: raw.defs,
      deals: expand(raw.deals, dealDates),
      jira: expand(raw.jira, jiraDates),
      eng: expand(raw.engagements, (raw.engagements && raw.engagements.date_columns) || []),
      views: raw.views || {},
      quality: raw.quality || [],
      recon: raw.recon || {},
      expected: raw.expected || {},
      extras: raw.extras || {},
    };
    SX.data.asofDay = util.day(raw.meta.asof);
    SX.data.asofMonth = util.monthKeyFromDay(SX.data.asofDay);
    SX.data.firstMonth = raw.meta.first_month || '2024-01';
    return SX.data;
  };

  /* ---------------------------------------------------------------- state */
  const DEFAULTS = { period: 'all', from: null, to: null, product: 'all', source: 'all', rep: 'all', experience: 'all' };
  let state = Object.assign({}, DEFAULTS);
  SX.state = {
    defaults: DEFAULTS,
    get() { return Object.assign({}, state); },
    set(patch) {
      state = Object.assign({}, state, patch);
      SX.state.writeHash();
      SX.bus.emit('filters', SX.state.get());
    },
    reset() { state = Object.assign({}, DEFAULTS); SX.state.writeHash(); SX.bus.emit('filters', SX.state.get()); },
    isDefault() { return Object.keys(DEFAULTS).every(k => state[k] === DEFAULTS[k]); },
    /** Inclusive [fromDay, toDay] for the current period, or null bounds. */
    range() {
      const asof = SX.data.asofDay, am = SX.data.asofMonth;
      switch (state.period) {
        case 'l12m': return { from: util.monthStartDay(util.addMonths(am, -11)), to: asof, label: 'last 12 months' };
        case 'l6m': return { from: util.monthStartDay(util.addMonths(am, -5)), to: asof, label: 'last 6 months' };
        case 'ytd': return { from: util.day(am.slice(0, 4) + '-01-01'), to: asof, label: am.slice(0, 4) + ' year to date' };
        case 'y2025': return { from: util.day('2025-01-01'), to: util.day('2025-12-31'), label: '2025' };
        case 'y2024': return { from: util.day('2024-01-01'), to: util.day('2024-12-31'), label: '2024' };
        case 'custom': {
          const f = state.from || SX.data.firstMonth, t = state.to || am;
          return { from: util.monthStartDay(f), to: util.monthEndDay(t), label: util.fmtMonth(f, true) + ' – ' + util.fmtMonth(t, true) };
        }
        default: return { from: null, to: null, label: 'all time' };
      }
    },
    writeHash() {
      const parts = Object.keys(DEFAULTS).filter(k => state[k] !== DEFAULTS[k] && state[k] != null).map(k => k + '=' + encodeURIComponent(state[k]));
      const base = location.hash.split('?')[0];
      const next = parts.length ? base + '?' + parts.join('&') : base;
      if (next !== location.hash) history.replaceState(null, '', next || location.pathname);
    },
    readHash() {
      const q = location.hash.split('?')[1];
      if (!q) return;
      const patch = {};
      q.split('&').forEach(p => { const [k, v] = p.split('='); if (k in DEFAULTS) patch[k] = decodeURIComponent(v || ''); });
      state = Object.assign({}, state, patch);
    },
  };

  /* ---------------------------------------------------------------- model */
  function inRange(d, r) { return d != null && (r.from == null || d >= r.from) && (r.to == null || d <= r.to); }
  function dimMatch(rowVal, sel) { return sel === 'all' || (rowVal == null ? 'Unknown' : rowVal) === sel; }

  SX.model = {
    /** Pipedrive STR Search deals passing the official PD_Deals filter (+ global filters).
        opts: {ignorePeriod, includeExcluded, dateField} */
    deals(opts) {
      opts = opts || {};
      const s = state, r = opts.ignorePeriod ? { from: null, to: null } : SX.state.range();
      const df = (opts.dateField || 'created') + '_d';
      return SX.data.deals.filter(d =>
        (opts.includeExcluded || d.in_scope) &&
        (opts.ignorePeriod || inRange(d[df], r)) &&
        dimMatch(d.product, s.product) && dimMatch(d.source, s.source) && dimMatch(d.rep, s.rep) && dimMatch(d.experience, s.experience));
    },
    /** Jira issues (+ global filters; Pipedrive attributes come through the linked deal).
        opts: {ignorePeriod, dateField: 'start' | 'created', population: 'all' | 'signed' | 'active'} */
    jira(opts) {
      opts = opts || {};
      const s = state, r = opts.ignorePeriod ? { from: null, to: null } : SX.state.range();
      const df = (opts.dateField || 'start') + '_d';
      const pop = opts.population || 'all';
      return SX.data.jira.filter(j =>
        (pop === 'all' || (pop === 'signed' && j.signed) || (pop === 'active' && j.active) || (pop === 'hunting' && j.hunting)) &&
        (opts.ignorePeriod || inRange(j[df], r)) &&
        dimMatch(j.pd_product, s.product) && dimMatch(j.pd_source, s.source) && dimMatch(j.pd_rep, s.rep) && dimMatch(j.pd_experience, s.experience));
    },
    /** Won engagements (won_clients_master, one row per won deal) + global filters.
        opts: {ignorePeriod, dateField: 'start' | 'won_date', population: 'all' | 'confirmed'} */
    eng(opts) {
      opts = opts || {};
      const s = state, r = opts.ignorePeriod ? { from: null, to: null } : SX.state.range();
      const df = (opts.dateField || 'start') + '_d';
      return SX.data.eng.filter(e =>
        (opts.population !== 'confirmed' || e.confirmed_start) &&
        (opts.ignorePeriod || inRange(e[df], r)) &&
        dimMatch(e.product, s.product) && dimMatch(e.channel, s.source) && dimMatch(e.rep, s.rep) && dimMatch(e.experience, s.experience));
    },
    /** True when a Pipedrive-attribute filter is active (affects unlinked Jira issues). */
    pdFilterActive() { return ['product', 'source', 'rep', 'experience'].some(k => state[k] !== 'all'); },
    /** Months covered by the current period, clipped to the data. */
    months(minKey) {
      const r = SX.state.range();
      const from = r.from != null ? util.monthKeyFromDay(r.from) : (minKey || SX.data.firstMonth);
      const to = r.to != null ? util.monthKeyFromDay(Math.min(r.to, SX.data.asofDay)) : SX.data.asofMonth;
      return util.monthRange(from < (minKey || '0000-00') ? minKey : from, to);
    },
  };
})();
