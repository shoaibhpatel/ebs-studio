// Reports & GST (owner): period selector (Indian FY), KPIs, SVG revenue vs expense chart, breakdowns, ageing, crew, albums, GST.
// Every section: Download PDF (premium theme) + Export CSV (UTF-8 BOM). Plus one full-report PDF.
import { h, mount, table, input, btn, chips, ic, empty } from '../dom.js';
import { toast, errMsg, busy } from '../ui.js';
import { all, gstOn, state } from '../store.js';
import { money, moneyShort, fmtDate, todayIST, monthShort, safeFilePart } from '../util.js';
import { REPORT_PERIODS, reportPeriod, reportData, toCsv, fmtPct, ALBUM_STAGE_LABEL } from '../bizcalc.js';
import { pageHead, recLink } from './common.js';
import { sharePdf } from '../share.js';

const UI = { kind: 'fy', from: '', to: '' };
const SVG = 'http://www.w3.org/2000/svg';
/** Minimal SVG element helper (attributes + text via textContent only). */
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, String(v));
  for (const c of kids.flat()) { if (c == null) continue; el.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); }
  return el;
}

export function downloadCsv(fileName, rows) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: fileName, hidden: true });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Exported ${fileName}`, 'success');
}

// ---------- SVG chart: revenue vs expense by month ----------
function revExpChart(monthly) {
  const W = 760, H = 230, L = 52, B = 26, T = 12;
  const n = Math.max(1, monthly.length); const max = Math.max(1, ...monthly.map(m => Math.max(m.revenue, m.expense)));
  const step = (() => { const raw = max / 4; const p = 10 ** Math.floor(Math.log10(raw)); return Math.ceil(raw / p) * p; })();
  const top = step * 4; const ih = H - T - B; const iw = W - L - 8; const gw = iw / n; const bw = Math.max(4, Math.min(22, gw * 0.32));
  const y = v => T + ih - (v / top) * ih;
  const grid = [0, 1, 2, 3, 4].map(i => s('g', null,
    s('line', { x1: L, x2: W - 8, y1: y(step * i), y2: y(step * i), class: i ? 'ch-grid' : 'ch-axis' }),
    s('text', { x: L - 8, y: y(step * i) + 3.5, 'text-anchor': 'end', class: 'ch-lbl' }, i ? moneyShort(step * i) : '0')));
  const bars = monthly.map((m, i) => {
    const cx = L + i * gw + gw / 2;
    return s('g', { class: 'ch-grp' },
      s('rect', { x: L + i * gw + 2, y: T, width: gw - 4, height: ih, class: 'ch-hit', rx: 6 }),
      s('rect', { x: cx - bw - 1.5, y: y(m.revenue), width: bw, height: Math.max(0, T + ih - y(m.revenue)), rx: 3, class: 'ch-rev' }, s('title', null, `${m.label} · received ${money(m.revenue)}`)),
      s('rect', { x: cx + 1.5, y: y(m.expense), width: bw, height: Math.max(0, T + ih - y(m.expense)), rx: 3, class: 'ch-exp' }, s('title', null, `${m.label} · expenses + payouts ${money(m.expense)}`)),
      s('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'ch-lbl' }, n > 12 ? monthShort(m.month).slice(0, 1) : monthShort(m.month)));
  });
  const label = 'Revenue vs expense by month: ' + monthly.map(m => `${m.label} received ${money(m.revenue)}, expenses ${money(m.expense)}`).join('; ');
  return h('div', { class: 'rev-chart' },
    h('div', { class: 'ch-legend', 'aria-hidden': 'true' }, h('span', null, h('i', { class: 'lg-rev' }), 'Revenue (received)'), h('span', null, h('i', { class: 'lg-exp' }), 'Expenses + crew payouts')),
    s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'none', class: 'ch-svg' }, grid, bars));
}
/** Horizontal bars (HTML). items: [{ label, value, sub }] */
function hbars(items, { tone = 'gold', fmt = money } = {}) {
  if (!items.length) return empty('Nothing in this period.', null, { icon: 'chart' });
  const max = Math.max(1, ...items.map(x => x.value));
  return h('div', { class: 'hbars', role: 'list' }, items.map(x => h('div', { class: 'hb', role: 'listitem' },
    h('span', { class: 'hb-l', title: x.label }, x.label, x.sub ? h('small', null, x.sub) : null),
    h('span', { class: 'hb-t', 'aria-hidden': 'true' }, h('i', { class: 'hb-f ' + tone, style: { width: Math.max(1.5, x.value / max * 100) + '%' } })),
    h('b', { class: 'hb-v num' }, fmt(x.value)))));
}

// ---------- CSV builders ----------
const CSV = {
  summary: D => [['Metric', 'Amount (INR)'], ['Period', `${D.period.from} to ${D.period.to}`], ['Billed', D.summary.billed], ['Received', D.summary.received], ['Expenses', D.summary.expenses], ['Crew payouts', D.summary.payouts], ['Net profit', D.summary.net], ['Invoices', D.summary.invoices], ['Outstanding on these invoices', D.summary.outstanding]],
  monthly: D => [['Month', 'Billed', 'Received', 'Expenses', 'Crew payouts', 'Net'], ...D.monthly.map(m => [m.label, m.billed, m.revenue, m.expenses, m.payouts, m.net])],
  types: D => [['Project type', 'Invoices', 'Billed'], ...D.types.map(t => [t.type, t.count, t.billed])],
  customers: D => [['Customer', 'Invoices', 'Billed', 'Received', 'Pending'], ...D.customers.map(c => [c.name, c.invoices, c.billed, c.received, c.pending])],
  ageing: D => [['Invoice', 'Invoice date', 'Due date', 'Customer', 'Age (days)', 'Bucket', 'Total', 'Balance'], ...D.ageing.rows.map(r => [r.number, r.date, r.due || '', r.customer, r.age, r.bucket, r.total, r.balance])],
  categories: D => [['Category', 'Entries', 'Amount', 'Unpaid'], ...D.categories.map(c => [c.category, c.count, c.amount, c.unpaid])],
  crew: D => [['Team member', 'Role', 'Tasks in period', 'Earned in period', 'Paid in period', 'Pending (all time)'], ...D.crew.map(c => [c.name, c.job, c.tasks || 0, c.earned || 0, c.paid || 0, c.pending])],
  albums: D => [['Album', 'Customer', 'Stage', 'Price', 'Cost', 'Profit', 'Margin %'], ...D.albums.map(a => [a.title, a.customer, ALBUM_STAGE_LABEL[a.stage] || a.stage, a.price, a.cost, a.profit, a.margin ?? ''])],
  gst: D => D.gst ? [['Invoice', 'Date', 'Customer', 'GST %', 'Taxable value', 'CGST', 'SGST', 'Total tax', 'Invoice total'], ...D.gst.rows.map(r => [r.number, r.date, r.customer, r.rate, r.taxable, r.cgst, r.sgst, r.tax, r.total]),
    ['Total', '', '', '', D.gst.totals.taxable, D.gst.totals.cgst, D.gst.totals.sgst, D.gst.totals.tax, D.gst.totals.total]] : [['GST is off']],
};
const FILE = { summary: 'Summary', monthly: 'Revenue-vs-Expense', types: 'Revenue-by-Type', customers: 'Top-Customers', ageing: 'Ageing', categories: 'Expenses-by-Category', crew: 'Crew-Cost', albums: 'Album-Profit', gst: 'GST' };

export async function render({ query = {} } = {}) {
  if (query.period && REPORT_PERIODS.some(([k]) => k === query.period)) UI.kind = query.period;
  if (query.from) UI.from = query.from; if (query.to) UI.to = query.to;
  const [invoices, payments, expenses, payouts, tasks, projects, customers, members, albums] = await Promise.all([
    all('invoices'), all('payments'), all('expenses'), all('payouts').catch(() => []), all('tasks').catch(() => []), all('projects'), all('customers'), all('members').catch(() => []), all('album_orders').catch(() => [])]);
  const data = { invoices, payments, expenses, payouts, tasks, projects, customers, members, albums };
  const host = h('div', { class: 'rep' });
  const sub = h('span');
  let D = null;
  const today = todayIST();
  const fromInp = input({ type: 'date', value: UI.from || today.slice(0, 8) + '01', 'aria-label': 'From date' });
  const toInp = input({ type: 'date', value: UI.to || today, 'aria-label': 'To date' });
  const custom = h('div', { class: 'rep-custom', hidden: UI.kind !== 'custom' }, fromInp, h('span', { class: 'dim' }, 'to'), toInp, btn('Apply', () => { UI.from = fromInp.value; UI.to = toInp.value; draw(); }, { cls: 'sm' }));
  const per = chips(REPORT_PERIODS, UI.kind, k => { UI.kind = k; custom.hidden = k !== 'custom'; if (k !== 'custom') draw(); else fromInp.focus(); }, 'Report period');
  const pdf = (keys, b) => busy(b, () => sharePdf({ make: async () => (await import('../pdf/reports.js')).buildReportPdf(D, keys), channel: 'download' }).catch(e => toast(errMsg(e), 'error')));
  const fullBtn = btn('Download full report PDF', e => import('../pdf/reports.js').then(m => pdf(m.sectionKeys(), e.target.closest('button'))), { cls: 'gold', icon: 'download' });

  function sec(key, title, body, { sub: subTxt, cls = '' } = {}) {
    return h('section', { class: 'card rep-sec ' + cls, id: 'rep-' + key },
      h('div', { class: 'ch' }, h('h3', null, title, subTxt ? h('small', { class: 'dim ch-sub' }, subTxt) : null),
        h('div', { class: 'btns' },
          btn('PDF', e => pdf([key], e.currentTarget), { cls: 'sm ghost', icon: 'download', aria: `Download ${title} PDF` }),
          btn('CSV', () => downloadCsv(`${FILE[key]}-${safeFilePart(D.period.code)}.csv`, CSV[key](D)), { cls: 'sm ghost', icon: 'csv', aria: `Export ${title} CSV` }))),
      body);
  }

  function draw() {
    const period = reportPeriod(UI.kind, { today, from: UI.from || fromInp.value, to: UI.to || toInp.value });
    D = reportData(data, period, { today, gst: gstOn() });
    sub.textContent = `${period.label}${UI.kind === 'month' || UI.kind === 'last-month' ? ` · ${fmtDate(period.from)} – ${fmtDate(period.to)}` : ''}`;
    const S = D.summary;
    const k = (l, v, cls, d) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v ' + (cls || '') }, v), h('div', { class: 'd' }, d));
    const summary = sec('summary', 'Summary', h('div', { class: 'kpis k5' },
      k('Billed', moneyShort(S.billed), '', `${S.invoices} invoice${S.invoices === 1 ? '' : 's'} · ${money(S.billed)}`),
      k('Received', moneyShort(S.received), 'up', money(S.received)),
      k('Expenses', moneyShort(S.expenses), '', money(S.expenses)),
      k('Crew payouts', moneyShort(S.payouts), '', money(S.payouts)),
      k('Net profit', moneyShort(S.net), S.net >= 0 ? 'up' : 'dn', 'Received − expenses − payouts')), { cls: 'rep-sum' });

    const monthly = sec('monthly', 'Revenue vs Expense', D.monthly.some(m => m.revenue || m.expense) ? revExpChart(D.monthly) : empty('No payments or expenses in this period.', null, { icon: 'chart' }), { sub: 'by month' });
    const types = sec('types', 'Revenue by project type', hbars(D.types.map(t => ({ label: t.type, value: t.billed, sub: `${t.count} invoice${t.count === 1 ? '' : 's'}` }))), { sub: 'billed' });
    const cats = sec('categories', 'Expenses by category', hbars(D.categories.map(c => ({ label: c.category, value: c.amount, sub: c.unpaid ? `${money(c.unpaid)} unpaid` : `${c.count} entr${c.count === 1 ? 'y' : 'ies'}` })), { tone: 'grey' }));

    const custT = table([
      { label: 'Customer', cell: c => recLink('customer', c.id, c.name) },
      { label: 'Billed', cls: 'r', cell: c => h('span', { class: 'num' }, money(c.billed)) },
      { label: 'Received', cls: 'r', cell: c => h('span', { class: 'num up' }, money(c.received)) },
      { label: 'Pending', cls: 'r', cell: c => h('b', { class: 'num ' + (c.pending > 0 ? 'dn' : 'dim') }, money(c.pending)) },
    ], D.customers.slice(0, 8), { emptyText: 'No invoices in this period.' });
    custT.querySelector?.('table')?.classList.add('stack');
    const customersSec = sec('customers', 'Top customers', custT, { sub: D.customers.length > 8 ? `top 8 of ${D.customers.length}` : null });

    const A = D.ageing;
    const ageSec = sec('ageing', 'Pending invoices ageing', [
      h('div', { class: 'age-grid' }, A.buckets.map(b => h('div', { class: 'age-b' + (b.min > 60 && b.amount ? ' bad' : '') }, h('span', null, b.label), h('b', { class: 'num' }, moneyShort(b.amount)), h('small', null, `${b.count} invoice${b.count === 1 ? '' : 's'}`),
        h('i', { class: 'age-bar', style: { width: (A.total ? Math.max(2, b.amount / A.total * 100) : 0) + '%' }, 'aria-hidden': 'true' })))),
      A.rows.length ? h('div', { class: 'age-list' }, A.rows.slice(0, 5).map(r => h('div', { class: 'li' }, h('div', null, recLink('invoice', r.id, `${r.number} · ${r.customer}`), h('small', { class: r.age > 60 ? 'dn' : '' }, `${r.age} days · ${fmtDate(r.date)}`)), h('div', null, h('span', { class: 'amt' }, money(r.balance)))))) : empty('No pending invoices.', null, { icon: 'check' }),
    ], { sub: `${money(A.total)} as of ${fmtDate(A.asOf)}` });

    const crewT = table([
      { label: 'Member', cell: c => [h('b', null, c.name), h('small', null, c.job || '—')] },
      { label: 'Tasks', cls: 'r', cell: c => String(c.tasks || 0) },
      { label: 'Earned', cls: 'r', cell: c => h('span', { class: 'num' }, money(c.earned || 0)) },
      { label: 'Paid', cls: 'r', cell: c => h('span', { class: 'num up' }, money(c.paid || 0)) },
      { label: 'Pending', cls: 'r', cell: c => h('b', { class: 'num ' + (c.pending > 0 ? 'warn' : 'dim') }, money(c.pending)) },
    ], D.crew, { emptyText: 'No crew work in this period.' });
    crewT.querySelector?.('table')?.classList.add('stack');
    const crewSec = sec('crew', 'Crew cost by member', crewT, { sub: 'pending = all time' });

    const AT = D.albumTotals;
    const albT = table([
      { label: 'Album', cell: a => [recLink('album', a.id, a.title), h('small', null, `${a.customer} · ${ALBUM_STAGE_LABEL[a.stage] || ''}`)] },
      { label: 'Price', cls: 'r', cell: a => h('span', { class: 'num' }, money(a.price)) },
      { label: 'Cost', cls: 'r', cell: a => h('span', { class: 'num muted' }, money(a.cost)) },
      { label: 'Profit', cls: 'r', cell: a => [h('b', { class: 'num ' + (a.profit >= 0 ? 'up' : 'dn') }, money(a.profit)), h('small', null, fmtPct(a.margin))] },
    ], D.albums, { emptyText: 'No album orders in this period.' });
    albT.querySelector?.('table')?.classList.add('stack');
    const albSec = sec('albums', 'Album profit', [albT, D.albums.length ? h('div', { class: 'rep-tot' }, h('span', null, `${D.albums.length} album${D.albums.length === 1 ? '' : 's'}`), h('span', null, 'Price ', h('b', null, money(AT.price))), h('span', null, 'Cost ', h('b', null, money(AT.cost))), h('span', null, 'Profit ', h('b', { class: AT.profit >= 0 ? 'up' : 'dn' }, `${money(AT.profit)} · ${fmtPct(AT.margin)}`))) : null]);

    let gstSec = null;
    if (D.gst) {
      const G = D.gst; const T = G.totals;
      const gm = table([
        { label: 'Month', cell: m => m.label },
        { label: 'Invoices', cls: 'r', cell: m => String(m.count) },
        { label: 'Taxable value', cls: 'r', cell: m => h('span', { class: 'num' }, money(m.taxable)) },
        { label: 'CGST', cls: 'r', cell: m => h('span', { class: 'num' }, money(m.cgst)) },
        { label: 'SGST', cls: 'r', cell: m => h('span', { class: 'num' }, money(m.sgst)) },
        { label: 'Total tax', cls: 'r', cell: m => h('b', { class: 'num' }, money(m.tax)) },
      ], [...G.months, { label: 'Total', count: T.count, taxable: T.taxable, cgst: T.cgst, sgst: T.sgst, tax: T.tax, _t: true }], { rowCls: m => (m._t ? 'tot-row' : null) });
      gm.querySelector?.('table')?.classList.add('stack');
      const gi = table([
        { label: 'Invoice', sort: r => r.number, cell: r => recLink('invoice', r.id, r.number) },
        { label: 'Date', sort: r => r.date, cell: r => h('span', { class: 'nowrap' }, fmtDate(r.date)) },
        { label: 'Customer', sort: r => r.customer, cell: r => r.customer },
        { label: 'Taxable', cls: 'r', sort: r => r.taxable, cell: r => h('span', { class: 'num' }, money(r.taxable)) },
        { label: 'CGST', cls: 'r', cell: r => h('span', { class: 'num muted' }, money(r.cgst)) },
        { label: 'SGST', cls: 'r', cell: r => h('span', { class: 'num muted' }, money(r.sgst)) },
        { label: 'Total', cls: 'r', sort: r => r.total, cell: r => h('b', { class: 'num' }, money(r.total)) },
      ], G.rows, { emptyText: 'No taxed invoices in this period.', sort: { key: 'Date', dir: 1 } });
      gi.querySelector?.('table')?.classList.add('stack');
      gstSec = sec('gst', 'GST summary', [
        h('div', { class: 'mini-kpis g4' },
          h('div', { class: 'mk' }, h('span', null, 'Taxable value'), h('b', null, money(T.taxable))),
          h('div', { class: 'mk' }, h('span', null, 'CGST'), h('b', null, money(T.cgst))),
          h('div', { class: 'mk' }, h('span', null, 'SGST'), h('b', null, money(T.sgst))),
          h('div', { class: 'mk' }, h('span', null, 'Total GST'), h('b', { class: 'warn' }, money(T.tax)))),
        h('h4', { class: 'rep-h4' }, 'By month'), gm,
        h('h4', { class: 'rep-h4' }, `Invoice-wise (${G.rows.length})`), gi,
        h('p', { class: 'dim small', style: { marginTop: '8px' } }, `CGST = half of the GST (rounded to the paisa), SGST = GST − CGST.${state.settings.gst_number ? ' GSTIN ' + state.settings.gst_number + '.' : ''}`),
      ], { sub: `${T.count} taxed invoice${T.count === 1 ? '' : 's'}`, cls: 'rep-gst' });
    } else {
      gstSec = h('div', { class: 'info-box rep-gst-off' }, ic('info', 14), ' GST is off in Settings, so the GST summary is hidden. ', h('a', { href: '#/settings' }, 'Turn on GST'));
    }

    mount(host, summary, monthly,
      h('div', { class: 'grid2 even' }, types, cats),
      h('div', { class: 'grid2 even' }, customersSec, ageSec),
      h('div', { class: 'grid2 even' }, crewSec, albSec),
      gstSec);
  }
  draw();
  if (query.section) setTimeout(() => document.getElementById('rep-' + query.section)?.scrollIntoView({ block: 'start' }), 60);
  return h('div', null,
    pageHead('Reports & GST', sub, [fullBtn]),
    h('div', { class: 'card list-card rep-bar' }, h('div', { class: 'toolbar' }, per, custom)),
    host);
}
