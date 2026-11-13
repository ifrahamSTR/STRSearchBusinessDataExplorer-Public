/* STRSearch Business Data Explorer: chart cards & UI components
   SX.charts.card(parent, spec)  -> chart card with table-view twin, footnote, empty state, lazy render
   SX.charts.*                   -> theme-aware ECharts option helpers (mark specs from the dataviz method)
   SX.ui.*                       -> KPI tiles, status chips, segmented toggles, sortable tables */
(function () {
  'use strict';
  const SX = window.SX;
  const U = SX.util;
  const FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

  /* ------------------------------------------------------------ ECharts helpers */
  const C = {
    base(t, extra) {
      return Object.assign({
        backgroundColor: 'transparent',
        textStyle: { fontFamily: FONT, color: t.ink2, fontSize: 12 },
        animationDuration: 350,
        animationDurationUpdate: 300,
        grid: { left: 6, right: 18, top: 30, bottom: 6, containLabel: true },
        tooltip: C.tooltipBase(t),
        aria: { enabled: true },
      }, extra || {});
    },
    tooltipBase(t, trigger) {
      return {
        trigger: trigger || 'axis',
        confine: true,
        backgroundColor: t.surface,
        borderColor: t.border,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: t.ink, fontFamily: FONT, fontSize: 12 },
        extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,0.14); border-radius: 8px;',
        axisPointer: { type: 'line', lineStyle: { color: t.axis, width: 1 }, shadowStyle: { color: 'rgba(120,140,130,0.08)' } },
      };
    },
    catAxis(t, data, opts) {
      opts = opts || {};
      return Object.assign({
        type: 'category', data,
        axisLine: { lineStyle: { color: t.axis } },
        axisTick: { show: false },
        axisLabel: { color: t.label, fontSize: 11, hideOverlap: true },
        splitLine: { show: false },
      }, opts);
    },
    valAxis(t, opts) {
      opts = opts || {};
      const fmt = opts.fmt || (v => U.fmtCompact(v));
      const o = Object.assign({
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: t.label, fontSize: 11, formatter: fmt },
        splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' } },
        nameTextStyle: { color: t.label, fontSize: 11, align: 'left' },
      }, opts);
      delete o.fmt;
      return o;
    },
    bar(name, data, color, opts) {
      opts = opts || {};
      const horizontal = !!opts.horizontal;
      const o = Object.assign({
        name, type: 'bar', data,
        barMaxWidth: 24,
        barGap: '12%',
        itemStyle: { color, borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
        emphasis: { focus: opts.focus || 'none', itemStyle: { opacity: 0.85 } },
      }, opts);
      delete o.horizontal; delete o.focus;
      return o;
    },
    stackBar(name, data, color, stack, t, opts) {
      // stacked segments: 2px surface gap between fills; radius only on the data-end of the top segment
      return Object.assign({
        name, type: 'bar', data, stack: stack || 'total',
        barMaxWidth: 24,
        itemStyle: { color, borderColor: t.surface, borderWidth: 1 },
        emphasis: { focus: 'series' },
      }, opts || {});
    },
    line(name, data, color, opts) {
      return Object.assign({
        name, type: 'line', data,
        smooth: false,
        showSymbol: false,
        symbol: 'circle', symbolSize: 8,
        lineStyle: { width: 2, color, cap: 'round', join: 'round' },
        itemStyle: { color, borderColor: 'transparent', borderWidth: 2 },
        emphasis: { focus: 'none', scale: true },
        connectNulls: false,
      }, opts || {});
    },
    area(name, data, color, opts) {
      return C.line(name, data, color, Object.assign({ areaStyle: { color, opacity: 0.1 } }, opts || {}));
    },
    legend(t, opts) {
      return Object.assign({
        top: 0, left: 0, itemWidth: 12, itemHeight: 12, itemGap: 16, icon: 'roundRect',
        textStyle: { color: t.ink2, fontSize: 12, fontFamily: FONT },
        inactiveColor: t.deemph,
      }, opts || {});
    },
    /** Axis tooltip formatter: value first (strong), series name secondary, line key in series colour. */
    axisTip(fmt, opts) {
      opts = opts || {};
      return function (params) {
        const ps = Array.isArray(params) ? params : [params];
        if (!ps.length) return '';
        const title = opts.title ? opts.title(ps[0]) : U.escapeHtml(ps[0].axisValueLabel != null ? ps[0].axisValueLabel : ps[0].name);
        let html = '<div class="sx-tip"><div class="t-title">' + title + '</div>';
        ps.forEach(p => {
          if (p.value == null || (Array.isArray(p.value) && p.value[1] == null)) return;
          const v = Array.isArray(p.value) ? p.value[p.encode && p.encode.y ? p.encode.y[0] : 1] : p.value;
          const color = typeof p.color === 'string' ? p.color : '#888';
          html += '<div class="t-row"><span class="t-key" style="background:' + color + '"></span><span class="t-val">' +
            U.escapeHtml((p.seriesIndex != null && opts.fmtBySeries && opts.fmtBySeries[p.seriesIndex]) ? opts.fmtBySeries[p.seriesIndex](v, p) : fmt(v, p)) +
            '</span><span class="t-name">' + U.escapeHtml(p.seriesName) + '</span></div>';
        });
        if (opts.note) { const n = opts.note(ps); if (n) html += '<div class="t-note">' + U.escapeHtml(n) + '</div>'; }
        return html + '</div>';
      };
    },
    /** Item tooltip formatter for bars/cells: rows = [[label, value], ...] */
    itemTip(build) {
      return function (p) {
        const spec = build(p);
        if (!spec) return '';
        let html = '<div class="sx-tip"><div class="t-title">' + U.escapeHtml(spec.title) + '</div>';
        (spec.rows || []).forEach(r => {
          html += '<div class="t-row">' + (r[2] ? '<span class="t-key" style="background:' + r[2] + '"></span>' : '') +
            '<span class="t-val">' + U.escapeHtml(r[1]) + '</span><span class="t-name">' + U.escapeHtml(r[0]) + '</span></div>';
        });
        if (spec.note) html += '<div class="t-note">' + U.escapeHtml(spec.note) + '</div>';
        return html + '</div>';
      };
    },
  };
  SX.charts = C;

  /* ------------------------------------------------------------ lazy rendering */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { const c = e.target.__sxCard; if (c) { c.visible = true; if (c.dirty) c.render(); } } });
  }, { rootMargin: '400px 0px' }) : null;

  const cards = [];
  SX.bus.on('theme', () => cards.forEach(c => c.invalidate()));

  /**
   * spec: { id, title, subtitle, height, render(ctx) -> {option, table:{columns, rows}, foot, empty, emptyText}, tableFirst, noTable, cls }
   * Columns: {key, label, num:boolean, fmt:fn(v,row)}
   */
  C.card = function (parent, spec) {
    const head = U.el('div', { class: 'card-head' });
    const titles = U.el('div', { class: 'card-titles' }, [
      U.el('h3', { class: 'card-title', text: spec.title }),
      spec.subtitle ? U.el('p', { class: 'card-subtitle', text: spec.subtitle }) : null,
    ]);
    const tools = U.el('div', { class: 'card-tools' });
    head.append(titles, tools);
    const chartDiv = U.el('div', { class: 'chart', style: { height: (spec.height || 300) + 'px' }, role: 'img', 'aria-label': spec.title });
    const tableDiv = U.el('div', { class: 'card-table' });
    const body = U.el('div', { class: 'card-body' }, [chartDiv, tableDiv]);
    const empty = U.el('div', { class: 'card-empty', text: 'No records match the current filters.' });
    const foot = U.el('div', { class: 'card-foot' });
    const el = U.el('figure', { class: 'card ' + (spec.cls || ''), id: spec.id || null, style: { margin: 0 } }, [head, body, empty, foot]);
    parent.append(el);

    const card = { el, spec, chart: null, visible: !io, dirty: true, last: null, showTable: !!spec.tableFirst };
    if (!spec.noTable) {
      const btn = U.el('button', { class: 'tool-btn', type: 'button', 'aria-pressed': card.showTable ? 'true' : 'false', text: 'Table' });
      btn.addEventListener('click', () => {
        card.showTable = !card.showTable;
        btn.setAttribute('aria-pressed', card.showTable ? 'true' : 'false');
        body.classList.toggle('is-table', card.showTable);
        if (!card.showTable && card.chart) setTimeout(() => card.chart.resize(), 0);
      });
      tools.append(btn);
      body.classList.toggle('is-table', card.showTable);
    }
    if (spec.tools) spec.tools.forEach(t => tools.append(t));

    card.invalidate = function () { card.dirty = true; if (card.visible) card.render(); };
    card.render = function () {
      card.dirty = false;
      const t = SX.theme.tokens();
      let out;
      try { out = spec.render({ t, state: SX.state.get(), card }) || {}; }
      catch (e) { console.error('[SX] render failed for', spec.id || spec.title, e); out = { empty: true, emptyText: 'This view could not be computed: ' + e.message }; }
      card.last = out;
      el.classList.toggle('is-empty', !!out.empty);
      if (out.emptyText) empty.textContent = out.emptyText; else empty.textContent = 'No records match the current filters.';
      foot.innerHTML = out.foot || spec.foot || '';
      if (out.empty) return;
      if (out.option) {
        if (!card.chart) {
          card.chart = echarts.init(chartDiv, null, { renderer: 'canvas' });
          if ('ResizeObserver' in window) new ResizeObserver(U.debounce(() => card.chart && card.chart.resize(), 60)).observe(chartDiv);
          if (spec.onClick) card.chart.on('click', p => spec.onClick(p, card));
        }
        if (out.height) chartDiv.style.height = out.height + 'px';
        card.chart.setOption(out.option, true);
        card.chart.resize();
      }
      if (out.table && !spec.noTable) renderTable(tableDiv, out.table);
    };
    if (io) { chartDiv.__sxCard = card; el.__sxCard = card; io.observe(el); }
    cards.push(card);
    SX.bus.on('filters', () => card.invalidate());
    if (!io) card.render();
    return card;
  };

  function renderTable(div, table) {
    div.textContent = '';
    div.append(SX.ui.table({ columns: table.columns, rows: table.rows, compact: true, maxRows: table.maxRows || 400 }));
  }

  /* ------------------------------------------------------------ UI components */
  const ICONS = {
    good: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    warning: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5l6 11H2z"/><path d="M8 7v3M8 12h.01"/></svg>',
    serious: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.8M8 11h.01"/></svg>',
    critical: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"/></svg>',
    info: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M8 7.3V11M8 5h.01"/></svg>',
  };
  const SEV_LABEL = { good: 'OK', warning: 'Caution', serious: 'Issue', critical: 'Critical', info: 'Info' };

  SX.ui = {
    icons: ICONS,
    status(sev, label) {
      const s = U.el('span', { class: 'status status--' + sev });
      s.innerHTML = ICONS[sev] || ICONS.info;
      s.append(document.createTextNode(label || SEV_LABEL[sev] || sev));
      return s;
    },
    kpi(parent, k) {
      const node = U.el('div', { class: 'kpi ' + (k.cls || '') }, [
        U.el('div', { class: 'kpi-label' }, [k.sys ? U.el('span', { class: 'sys', text: k.sys }) : null, k.label]),
        U.el('div', { class: 'kpi-value' }, [k.value, k.unit ? U.el('small', { text: k.unit }) : null]),
        k.sub ? U.el('div', { class: 'kpi-sub', text: k.sub }) : null,
      ]);
      if (k.title) node.title = k.title;
      parent.append(node);
      return node;
    },
    /** Segmented toggle: options [{value,label}], returns element; onChange(value). */
    seg(label, options, value, onChange) {
      const wrap = U.el('div', { class: 'seg-wrap', style: { display: 'inline-flex', alignItems: 'center' } });
      if (label) wrap.append(U.el('span', { class: 'seg-label', text: label }));
      const seg = U.el('div', { class: 'seg', role: 'group', 'aria-label': label || 'view' });
      options.forEach(o => {
        const b = U.el('button', { type: 'button', 'aria-pressed': o.value === value ? 'true' : 'false', text: o.label, title: o.title || null });
        b.addEventListener('click', () => {
          seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          onChange(o.value);
        });
        seg.append(b);
      });
      wrap.append(seg);
      return wrap;
    },
    /** Sortable data table. columns: {key,label,num,fmt(v,row),sort(row)->value,html(v,row)->Node,width}; rows: objects */
    table(cfg) {
      const wrap = U.el('div', { class: 'table-wrap' + (cfg.cls ? ' ' + cfg.cls : '') });
      const tbl = U.el('table', { class: 'data' });
      const thead = U.el('thead'), tbody = U.el('tbody');
      tbl.append(thead, tbody); wrap.append(tbl);
      let sortKey = cfg.sortKey || null, sortDir = cfg.sortDir || -1;
      const cols = cfg.columns;
      const hr = U.el('tr');
      cols.forEach(c => {
        const th = U.el('th', { class: (c.num ? 'num ' : '') + (cfg.sortable === false ? '' : 'sortable'), text: c.label, scope: 'col' });
        if (c.width) th.style.width = c.width;
        if (c.title) th.title = c.title;
        if (cfg.sortable !== false) {
          th.addEventListener('click', () => {
            if (sortKey === c.key) sortDir = -sortDir; else { sortKey = c.key; sortDir = c.num ? -1 : 1; }
            draw();
          });
        }
        hr.append(th);
      });
      thead.append(hr);
      function val(c, r) { return c && c.sort ? c.sort(r) : r[c ? c.key : sortKey]; }
      function draw() {
        let rows = cfg.rows.slice();
        if (sortKey) {
          const c = cols.find(x => x.key === sortKey);
          rows.sort((a, b) => {
            const va = val(c, a), vb = val(c, b);
            if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
            return (va > vb ? 1 : va < vb ? -1 : 0) * sortDir;
          });
          thead.querySelectorAll('th').forEach((th, i) => th.setAttribute('aria-sort', cols[i] && cols[i].key === sortKey ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'));
        }
        tbody.textContent = '';
        const max = cfg.maxRows || rows.length;
        rows.slice(0, max).forEach(r => {
          const tr = U.el('tr', { class: r.__cls || null });
          cols.forEach(c => {
            const td = U.el('td', { class: c.num ? 'num' : (c.cls || null) });
            const v = r[c.key];
            if (c.html) { const n = c.html(v, r); if (n != null) td.append(n.nodeType ? n : document.createTextNode(String(n))); }
            else td.textContent = c.fmt ? c.fmt(v, r) : (v == null ? '–' : String(v));
            tr.append(td);
          });
          tbody.append(tr);
        });
        if (rows.length > max) {
          const tr = U.el('tr'); const td = U.el('td', { colspan: cols.length, class: 'muted', text: 'Showing ' + max + ' of ' + rows.length + ' rows.' });
          tr.append(td); tbody.append(tr);
        }
        if (cfg.totalRow) { const r = cfg.totalRow; const tr = U.el('tr', { class: 'row-total' }); cols.forEach(c => tr.append(U.el('td', { class: c.num ? 'num' : null, text: c.fmt ? c.fmt(r[c.key], r) : (r[c.key] == null ? '' : String(r[c.key])) }))); tbody.append(tr); }
      }
      draw();
      wrap.redraw = function (rows) { cfg.rows = rows; draw(); };
      return wrap;
    },
    /** Inline bar used inside table cells (value 0..1 or vs max). */
    barCell(value, max, label, color) {
      const pct = max ? Math.max(0, Math.min(1, value / max)) : 0;
      const fill = U.el('div', { class: 'fill', style: { width: (pct * 100).toFixed(1) + '%', background: color || 'var(--series-1)' } });
      return U.el('div', { class: 'bar-cell' }, [U.el('div', { class: 'track' }, [fill]), U.el('span', { class: 'v', text: label })]);
    },
    legend(items) {
      const wrap = U.el('div', { class: 'card-legend' });
      items.forEach(i => wrap.append(U.el('span', { class: 'legend-key' }, [
        U.el('span', { class: i.type === 'line' ? 'legend-line' : 'legend-swatch', style: { background: i.color } }), i.name])));
      return wrap;
    },
  };
})();
