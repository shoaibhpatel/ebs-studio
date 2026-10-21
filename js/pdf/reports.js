// Reports & GST PDFs (one section or the full report) and the internal album job card. Same pdfmake theme as invoices.
import { C, CONTENT_W, header, infoStrip, partyBox, kv, lbl, totalsBox, notesBlock, docDefinition, output, R, RS, termsAndSign } from './core.js';
import { thCell, zebraLayout } from './docs.js';
import { state, gstOn, getRow, all } from '../store.js';
import { fmtDate, safeFilePart, todayIST, num, monthShort, round2 } from '../util.js';
import { albumCosting, fmtPct, ALBUM_STAGE_LABEL, AGE_BUCKETS } from '../bizcalc.js';

const custLines = c => [c?.address, c?.city, [c?.mobile, c?.email].filter(Boolean).join('  ·  ')];
const tdR = (v, opt = {}) => ({ text: v, alignment: 'right', noWrap: true, ...opt });

/** Data table with repeating header, zebra rows, rows never split, optional bold total rows at the end. */
function dataTable(heads, rows, { widths, totals = [], rightFrom = 1, empty = 'No data for this period.' } = {}) {
  const right = i => (Array.isArray(rightFrom) ? rightFrom.includes(i) : i >= rightFrom);
  const body = [heads.map((t, i) => thCell(t, right(i)))];
  if (!rows.length) body.push([{ text: empty, colSpan: heads.length, color: C.muted, alignment: 'center' }, ...Array(heads.length - 1).fill({})]);
  else body.push(...rows);
  const tot = rows.length ? totals : [];
  body.push(...tot);
  return { table: { headerRows: 1, dontBreakRows: true, widths: widths || heads.map((_, i) => (i === 0 ? '*' : 'auto')), body }, layout: zebraLayout(tot.length) };
}
/** Small inline bar for share columns. */
const shareBar = (frac, w = 70, color = C.gold) => ({ canvas: [{ type: 'rect', x: 0, y: 2.5, w, h: 5, r: 2, color: C.soft }, { type: 'rect', x: 0, y: 2.5, w: Math.max(1, Math.min(1, frac) * w), h: 5, r: 2, color }] });

function sectionTitle(text, sub) {
  return {
    headlineLevel: 1, margin: [0, 16, 0, 6], stack: [
      { columns: [{ text, font: 'Serif', bold: true, fontSize: 12.5, color: C.ink, width: 'auto' }, sub ? { text: sub, fontSize: 7.4, color: C.muted, alignment: 'right', margin: [0, 4, 0, 0] } : { text: '' }] },
      { canvas: [{ type: 'line', x1: 0, y1: 3, x2: CONTENT_W, y2: 3, lineWidth: 0.8, lineColor: C.goldL }] },
    ],
  };
}
function kpiBoxes(items) {
  const row = []; const widths = [];
  items.forEach(([label, value, opt = {}], i) => {
    if (i) { row.push({ text: '', border: [false, false, false, false] }); widths.push(6); }
    row.push({ border: [true, true, true, true], fillColor: opt.grand ? C.grand : C.cream, margin: [2, 2, 2, 1], stack: [lbl(label), { text: value, font: 'Serif', bold: true, fontSize: 12, color: opt.color || C.ink, noWrap: true }, opt.sub ? { text: opt.sub, fontSize: 6.6, color: C.muted, margin: [0, 2, 0, 0] } : null].filter(Boolean) });
    widths.push('*');
  });
  return { margin: [0, 0, 0, 4], table: { widths, body: [row] }, layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => C.line, vLineColor: () => C.line, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 6, paddingBottom: () => 6 } };
}
/** Revenue vs expense grouped bar chart (vector). */
function barChart(monthly) {
  const H = 110, W = CONTENT_W; const n = Math.max(1, monthly.length);
  const max = Math.max(1, ...monthly.map(m => Math.max(m.revenue, m.expense)));
  const gw = W / n; const bw = Math.min(16, gw * 0.3);
  const shapes = [0.25, 0.5, 0.75, 1].map(f => ({ type: 'line', x1: 0, y1: H - f * H, x2: W, y2: H - f * H, lineWidth: 0.3, lineColor: C.line }));
  shapes.push({ type: 'line', x1: 0, y1: H, x2: W, y2: H, lineWidth: 0.8, lineColor: C.goldL });
  monthly.forEach((m, i) => {
    const cx = i * gw + gw / 2;
    const hr = (m.revenue / max) * (H - 4); const he = (m.expense / max) * (H - 4);
    if (hr > 0) shapes.push({ type: 'rect', x: cx - bw - 1, y: H - hr, w: bw, h: hr, color: C.gold });
    if (he > 0) shapes.push({ type: 'rect', x: cx + 1, y: H - he, w: bw, h: he, color: '#c9c1b0' });
  });
  return {
    unbreakable: true, stack: [
      { columns: [{ width: 'auto', canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 6, color: C.gold }] }, { width: 'auto', text: 'Revenue (received)', fontSize: 7, margin: [3, 0, 12, 0] }, { width: 'auto', canvas: [{ type: 'rect', x: 0, y: 2, w: 8, h: 6, color: '#c9c1b0' }] }, { width: 'auto', text: 'Expenses + crew payouts', fontSize: 7, margin: [3, 0, 12, 0] }, { width: '*', text: `Max ${R(max)}`, fontSize: 6.8, color: C.muted, alignment: 'right' }], margin: [0, 0, 0, 6] },
      { canvas: shapes },
      { columns: monthly.map(m => ({ width: gw, text: n > 12 ? monthShort(m.month).slice(0, 1) : monthShort(m.month), alignment: 'center', fontSize: 6.8, color: C.muted })), columnGap: 0, margin: [0, 3, 0, 0] },
    ],
  };
}

// ---------- sections ----------
export const REPORT_SECTIONS = {
  summary: { title: 'Summary', file: 'Summary' },
  monthly: { title: 'Revenue vs Expense', file: 'Revenue-vs-Expense' },
  types: { title: 'Revenue by Project Type', file: 'Revenue-by-Type' },
  customers: { title: 'Top Customers', file: 'Top-Customers' },
  ageing: { title: 'Pending Invoices Ageing', file: 'Ageing' },
  categories: { title: 'Expenses by Category', file: 'Expenses-by-Category' },
  crew: { title: 'Crew Cost by Member', file: 'Crew-Cost' },
  albums: { title: 'Album Profit', file: 'Album-Profit' },
  gst: { title: 'GST Summary', file: 'GST' },
};
const BUILD = {
  summary: D => {
    const s = D.summary;
    return [kpiBoxes([
      ['Billed', RS(s.billed), { sub: `${s.invoices} invoice${s.invoices === 1 ? '' : 's'}` }],
      ['Received', RS(s.received), { color: C.green, sub: 'Payments in period' }],
      ['Expenses', RS(s.expenses), { sub: 'Studio costs' }],
      ['Crew payouts', RS(s.payouts), { sub: 'Paid to team' }],
      ['Net profit', RS(s.net), { grand: true, color: s.net >= 0 ? C.ink : C.red, sub: 'Received − expenses − payouts' }],
    ]), { text: `Outstanding on invoices billed in this period: ${R(s.outstanding)}.`, fontSize: 7.2, color: C.muted, margin: [0, 4, 0, 0] }];
  },
  monthly: D => [barChart(D.monthly), { margin: [0, 10, 0, 0], ...dataTable(['Month', 'Billed', 'Received', 'Expenses', 'Crew payouts', 'Net'],
    D.monthly.map(m => [m.label, tdR(R(m.billed)), tdR(R(m.revenue), { color: C.green }), tdR(R(m.expenses)), tdR(R(m.payouts)), tdR(R(m.net), { bold: true, color: m.net < 0 ? C.red : C.ink })]),
    { widths: ['*', 74, 74, 74, 74, 78], totals: [[{ text: 'Total', bold: true, color: C.ink }, tdR(R(D.summary.billed), { bold: true }), tdR(R(D.summary.received), { bold: true, color: C.green }), tdR(R(D.summary.expenses), { bold: true }), tdR(R(D.summary.payouts), { bold: true }), tdR(R(D.summary.net), { bold: true, color: D.summary.net < 0 ? C.red : C.ink })]] }) }],
  types: D => {
    const tot = D.types.reduce((s, t) => s + t.billed, 0) || 1;
    return [dataTable(['Project type', 'Invoices', 'Billed', 'Share', ''], D.types.map(t => [{ text: t.type, color: C.ink }, tdR(String(t.count)), tdR(R(t.billed), { bold: true }), tdR(fmtPct(t.billed / tot * 100)), shareBar(t.billed / tot, 90)]),
      { widths: ['*', 50, 80, 46, 92], rightFrom: [1, 2, 3] })];
  },
  customers: D => [dataTable(['Customer', 'Invoices', 'Billed', 'Received', 'Pending'], D.customers.slice(0, 25).map(c => [{ text: c.name, color: C.ink, bold: true }, tdR(String(c.invoices)), tdR(R(c.billed)), tdR(R(c.received), { color: C.green }), tdR(R(c.pending), { bold: c.pending > 0, color: c.pending > 0 ? C.red : C.muted })]),
    { widths: ['*', 50, 82, 82, 82] })],
  ageing: D => {
    const A = D.ageing;
    return [{ text: `Open invoices as of ${fmtDate(A.asOf)} · age = days since the invoice date.`, fontSize: 7.2, color: C.muted, margin: [0, 0, 0, 6] },
      dataTable(['Bucket', 'Invoices', 'Outstanding', 'Share', ''], A.buckets.map(b => [{ text: b.label, bold: true, color: b.min > 60 ? C.red : C.ink }, tdR(String(b.count)), tdR(R(b.amount), { bold: true }), tdR(fmtPct(A.total ? b.amount / A.total * 100 : 0)), shareBar(A.total ? b.amount / A.total : 0, 90, b.min > 60 ? C.red : C.gold)]),
        { widths: ['*', 50, 90, 46, 92], rightFrom: [1, 2, 3], totals: [[{ text: 'Total outstanding', bold: true, color: C.ink }, tdR(String(A.invoices.length), { bold: true }), tdR(R(A.total), { bold: true, color: C.red }), { text: '' }, { text: '' }]] }),
      { margin: [0, 10, 0, 0], ...dataTable(['Invoice', 'Date', 'Customer', 'Age', 'Total', 'Balance'], A.rows.map(r => [{ text: r.number, bold: true, color: C.ink }, { text: fmtDate(r.date), noWrap: true }, r.customer, tdR(`${r.age} d`), tdR(R(r.total)), tdR(R(r.balance), { bold: true, color: C.red })]),
        { widths: [62, 62, '*', 40, 74, 74], rightFrom: [3, 4, 5], empty: 'No pending invoices.' }) }];
  },
  categories: D => {
    const tot = D.categories.reduce((s, c) => s + c.amount, 0) || 1;
    return [dataTable(['Category', 'Entries', 'Amount', 'Unpaid', 'Share', ''], D.categories.map(c => [{ text: c.category, color: C.ink, bold: true }, tdR(String(c.count)), tdR(R(c.amount), { bold: true }), tdR(c.unpaid ? R(c.unpaid) : '—', { color: c.unpaid ? C.red : C.muted }), tdR(fmtPct(c.amount / tot * 100)), shareBar(c.amount / tot, 80)]),
      { widths: ['*', 44, 76, 70, 40, 82], rightFrom: [1, 2, 3, 4], totals: [[{ text: 'Total', bold: true, color: C.ink }, tdR(String(D.categories.reduce((s, c) => s + c.count, 0)), { bold: true }), tdR(R(D.summary.expenses), { bold: true }), tdR(R(D.categories.reduce((s, c) => s + c.unpaid, 0)), { bold: true }), { text: '' }, { text: '' }]] })];
  },
  crew: D => [dataTable(['Team member', 'Role', 'Tasks', 'Earned', 'Paid', 'Pending*'], D.crew.map(c => [{ text: c.name, bold: true, color: C.ink }, { text: c.job, color: C.muted }, tdR(String(c.tasks || 0)), tdR(R(c.earned || 0)), tdR(R(c.paid || 0), { color: C.green }), tdR(R(c.pending), { bold: c.pending > 0, color: c.pending > 0 ? C.red : C.muted })]),
    { widths: ['*', 90, 36, 70, 70, 70], rightFrom: 2, totals: [[{ text: 'Total', bold: true, colSpan: 2, color: C.ink }, {}, tdR(String(D.crew.reduce((s, c) => s + (c.tasks || 0), 0)), { bold: true }), tdR(R(D.crew.reduce((s, c) => s + (c.earned || 0), 0)), { bold: true }), tdR(R(D.summary.payouts), { bold: true, color: C.green }), tdR(R(D.crew.reduce((s, c) => s + c.pending, 0)), { bold: true })]] }),
  { text: '* Pending is all-time (done work − all payouts). Earned = done work dated in the period; paid = payouts in the period.', fontSize: 6.8, color: C.muted, margin: [0, 4, 0, 0] }],
  albums: D => [dataTable(['Album', 'Customer', 'Stage', 'Price', 'Cost', 'Profit', 'Margin'], D.albums.map(a => [{ text: a.title, bold: true, color: C.ink }, a.customer, { text: ALBUM_STAGE_LABEL[a.stage] || '', color: C.muted, fontSize: 7.4 }, tdR(R(a.price)), tdR(R(a.cost)), tdR(R(a.profit), { bold: true, color: a.profit < 0 ? C.red : C.green }), tdR(fmtPct(a.margin))]),
    { widths: ['*', 74, 64, 60, 60, 62, 40], rightFrom: 3, empty: 'No album orders in this period.', totals: [[{ text: 'Total', bold: true, colSpan: 3, color: C.ink }, {}, {}, tdR(R(D.albumTotals.price), { bold: true }), tdR(R(D.albumTotals.cost), { bold: true }), tdR(R(D.albumTotals.profit), { bold: true, color: D.albumTotals.profit < 0 ? C.red : C.green }), tdR(fmtPct(D.albumTotals.margin), { bold: true })]] })],
  gst: D => {
    const G = D.gst; if (!G) return [{ text: 'GST is off in Settings.', color: C.muted }];
    const T = G.totals;
    return [
      kpiBoxes([['Taxable value', RS(T.taxable), { sub: `${T.count} taxed invoice${T.count === 1 ? '' : 's'}` }], ['CGST', RS(T.cgst)], ['SGST', RS(T.sgst)], ['Total GST', RS(T.tax), { grand: true }]]),
      { margin: [0, 8, 0, 0], ...dataTable(['Month', 'Invoices', 'Taxable value', 'CGST', 'SGST', 'Total tax', 'Invoice value'], G.months.map(m => [m.label, tdR(String(m.count)), tdR(R(m.taxable)), tdR(R(m.cgst)), tdR(R(m.sgst)), tdR(R(m.tax), { bold: true }), tdR(R(m.total))]),
        { widths: ['*', 44, 76, 64, 64, 68, 76], totals: [[{ text: 'Total', bold: true, color: C.ink }, tdR(String(T.count), { bold: true }), tdR(R(T.taxable), { bold: true }), tdR(R(T.cgst), { bold: true }), tdR(R(T.sgst), { bold: true }), tdR(R(T.tax), { bold: true }), tdR(R(T.total), { bold: true })]] }) },
      lbl('Invoice-wise', { margin: [0, 12, 0, 4] }),
      dataTable(['Invoice', 'Date', 'Customer', 'Taxable', 'CGST', 'SGST', 'Total'], G.rows.map(r => [{ text: r.number, bold: true, color: C.ink }, { text: fmtDate(r.date), noWrap: true }, r.customer, tdR(R(r.taxable)), tdR(R(r.cgst)), tdR(R(r.sgst)), tdR(R(r.total), { bold: true })]),
        { widths: [56, 58, '*', 66, 56, 56, 68], rightFrom: 3, empty: 'No taxed invoices in this period.', totals: [[{ text: 'Total', bold: true, colSpan: 3, color: C.ink }, {}, {}, tdR(R(T.taxable), { bold: true }), tdR(R(T.cgst), { bold: true }), tdR(R(T.sgst), { bold: true }), tdR(R(T.total), { bold: true })]] }),
      { text: `CGST and SGST are each half of the GST charged on the invoice (CGST rounded to the paisa, SGST = tax − CGST).${state.settings.gst_number ? ' GSTIN ' + state.settings.gst_number + '.' : ''}`, fontSize: 6.8, color: C.muted, margin: [0, 4, 0, 0] },
    ];
  },
};
export const sectionKeys = () => Object.keys(REPORT_SECTIONS).filter(k => k !== 'gst' || gstOn());

/** Report PDF. keys: one section (e.g. ['gst']) or all (full report). */
export async function buildReportPdf(D, keys = sectionKeys()) {
  const full = keys.length > 1;
  const title = full ? 'Business Report' : REPORT_SECTIONS[keys[0]].title.replace('Pending Invoices ', '');
  const number = D.period.code;
  const s = D.summary;
  const content = [
    await header({ title: full ? 'Business Report' : (keys[0] === 'gst' ? 'GST Report' : 'Report'), number, sealStatus: s.net >= 0 ? 'profit' : 'loss', sealSub: R(Math.abs(s.net)) }),
    infoStrip([
      [lbl('Period'), { text: D.period.label.split(' · ')[0], font: 'Serif', bold: true, fontSize: 10, color: C.ink, margin: [0, 0, 0, 2] }, { text: `${fmtDate(D.period.from)} – ${fmtDate(D.period.to)}`, fontSize: 7.6 }],
      [lbl(full ? 'Contents' : 'Section'), { text: full ? keys.map(k => REPORT_SECTIONS[k].title).join(' · ') : REPORT_SECTIONS[keys[0]].title, fontSize: 7.6, lineHeight: 1.35, color: C.ink }],
      [lbl('Summary'), kv([['Received', R(s.received), { color: C.green }], ['Expenses + payouts', R(round2(s.expenses + s.payouts))], ['Net profit', R(s.net), { color: s.net >= 0 ? C.green : C.red }], ['Generated', fmtDate(todayIST())]])],
    ], ['*', '*', 160]),
  ];
  for (const k of keys) {
    if (full || k !== 'summary') content.push(sectionTitle(REPORT_SECTIONS[k].title, k === 'ageing' ? `as of ${fmtDate(D.ageing.asOf)}` : k === 'customers' && D.customers.length > 25 ? 'Top 25' : null));
    content.push(...BUILD[k](D));
  }
  content.push({ text: 'Figures are calculated from invoices, payments, expenses and crew payouts recorded in Studio Manager.', fontSize: 6.8, color: C.muted, alignment: 'center', margin: [0, 18, 0, 0] });
  const dd = docDefinition({ title, number, content, info: { subject: `${title} ${D.period.label}` } });
  // No orphan section titles at a page bottom (never re-break a title that is already near the top → no loops).
  dd.pageBreakBefore = (node, following) => node.headlineLevel === 1 && following.length < 2 && (node.startPosition?.verticalRatio ?? 0) > 0.2;
  const fileName = `Report-${full ? 'Full' : REPORT_SECTIONS[keys[0]].file}-${safeFilePart(number)}.pdf`;
  return output(dd, fileName);
}

// ---------- album job card (internal) ----------
export async function buildAlbumJobCard({ album, customer, project, invoice, expenses, vendors }) {
  const k = albumCosting(album, expenses);
  const vMap = new Map(vendors.map(v => [v.id, v]));
  const number = `ALB-${String(album.created_at || todayIST()).slice(0, 10).replace(/-/g, '')}`;
  const title = 'Album Job Card';
  const rows = k.costs.map((e, i) => [
    { text: String(i + 1), alignment: 'center', color: C.goldD, bold: true },
    { text: e.category, color: C.ink, bold: true },
    { text: [{ text: e.description || '', color: C.ink }, vMap.get(e.vendor_id) ? { text: '\n' + vMap.get(e.vendor_id).name, color: C.muted, fontSize: 7 } : ''] },
    tdR(e.qty != null ? num(e.qty) : '—'), tdR(e.unit_rate != null ? R(e.unit_rate) : '—'), tdR(R(e.amount), { bold: true, color: C.ink }),
    { text: e.paid_status === 'unpaid' ? 'Unpaid' : 'Paid', bold: true, fontSize: 7.4, color: e.paid_status === 'unpaid' ? C.red : C.green },
  ]);
  const content = [
    await header({ title, number, sealStatus: (ALBUM_STAGE_LABEL[album.stage] || 'Design').split(' ')[0], sealSub: album.due_date ? `due ${fmtDate(album.due_date).slice(0, 6)}` : null }),
    infoStrip([
      partyBox('Customer', customer?.name, custLines(customer)),
      [lbl('Album'), { text: album.title || 'Album', font: 'Serif', bold: true, fontSize: 9.8, color: C.ink, margin: [0, 0, 0, 2] }, kv([['Sheets', album.sheets != null ? String(album.sheets) : '—'], ['Size', album.size || '—'], ['Paper', album.paper || '—']])],
      [lbl('Details'), kv([['Stage', ALBUM_STAGE_LABEL[album.stage] || '—'], ['Due date', fmtDate(album.due_date)], ['Project', project?.name || '—'], ['Invoice', invoice?.number || '—']])],
    ], ['*', '*', 160]),
    lbl('Job costing', { margin: [0, 0, 0, 4] }),
    dataTable(['#', 'Category', 'Item / vendor', 'Qty', 'Rate', 'Amount', 'Status'], rows, { widths: [16, 64, '*', 34, 58, 66, 44], rightFrom: [3, 4, 5], empty: 'No costs recorded yet.' }),
    {
      unbreakable: true, margin: [0, 12, 0, 0], columns: [
        { width: '*', stack: [{ text: 'Internal document — contains vendor costs and profit. Do not share with the customer.', fontSize: 7.4, color: C.red, italics: true, margin: [0, 2, 0, 6] }, k.unpaid ? { text: `Still to pay vendors: ${R(k.unpaid)}`, fontSize: 7.8, bold: true, color: C.ink } : { text: 'All vendor costs paid.', fontSize: 7.8, color: C.green }] },
        { width: 196, stack: [totalsBox([['Price to customer', R(k.price)], ['Total cost', R(k.cost)], ['Margin', fmtPct(k.margin)], ['Profit', k.profit, 'grand']])] },
      ], columnGap: 16,
    },
    notesBlock(album.notes),
    termsAndSign(''),
  ].filter(Boolean);
  return output(docDefinition({ title, number, content, info: { subject: `Job card ${album.title || ''}` } }), `Album-JobCard-${safeFilePart(album.title)}.pdf`);
}
export async function albumJobCardPdf(id) {
  const album = await getRow('album_orders', id); if (!album) throw new Error('Album order not found');
  const [customer, project, invoice, expenses, vendors] = await Promise.all([album.customer_id ? getRow('customers', album.customer_id) : null, album.project_id ? getRow('projects', album.project_id) : null, album.invoice_id ? getRow('invoices', album.invoice_id) : null, all('expenses'), all('vendors').catch(() => [])]);
  return buildAlbumJobCard({ album, customer, project, invoice, expenses, vendors });
}
export { AGE_BUCKETS };
