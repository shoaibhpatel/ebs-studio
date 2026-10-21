// Phase 2C maths (pure, no DOM): report periods (Indian FY), ageing, GST split, CSV, album job costing, vendor totals,
// and the full report data set. Shared by the Albums / Vendors / Reports pages, the report PDFs and the debug self-test.
import { todayIST, addDays, addMonths, fmtDate, monthKey, monthLabel, daysBetween, round2, sum } from './util.js';
import { periodRange, memberStats } from './teamcalc.js';

// ---------- periods ----------
export const REPORT_PERIODS = [['month', 'This month'], ['last-month', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This FY'], ['last-fy', 'Last FY'], ['custom', 'Custom']];
const lastDay = first => addDays(addMonths(first, 1), -1);
/** First day of the Indian financial year (1 April) that contains `iso`. */
export function fyStart(iso) {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04-01`;
}
export const fyLabel = from => { const y = Number(from.slice(0, 4)); return `FY ${y}–${String((y + 1) % 100).padStart(2, '0')}`; };
/**
 * Report period → { kind, from, to, label, code }. Dates are IST calendar dates (YYYY-MM-DD).
 * kind: month | last-month | quarter (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar) | fy (1 Apr – 31 Mar) | last-fy | custom.
 */
export function reportPeriod(kind, { today = todayIST(), from, to } = {}) {
  if (kind === 'month' || kind === 'last-month') {
    const p = periodRange(kind, { today });
    return { ...p, code: p.from.slice(0, 7) };
  }
  if (kind === 'quarter') {
    const y = today.slice(0, 4); const m = Number(today.slice(5, 7));
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    const f = `${y}-${String(qm).padStart(2, '0')}-01`;
    const t = lastDay(addMonths(f, 2));
    const fyQ = { 4: 1, 7: 2, 10: 3, 1: 4 }[qm];
    return { kind, from: f, to: t, label: `Q${fyQ} ${fyLabel(fyStart(f))} · ${monthLabel(monthKey(f)).slice(0, 3)} – ${monthLabel(monthKey(t))}`, code: `${fyStart(f).slice(0, 4)}Q${fyQ}` };
  }
  if (kind === 'fy' || kind === 'last-fy') {
    let f = fyStart(today);
    if (kind === 'last-fy') f = `${Number(f.slice(0, 4)) - 1}-04-01`;
    const t = `${Number(f.slice(0, 4)) + 1}-03-31`;
    return { kind, from: f, to: t, label: `${fyLabel(f)} · ${fmtDate(f)} – ${fmtDate(t)}`, code: fyLabel(f).replace(/\s|–/g, '') };
  }
  const p = periodRange('custom', { today, from, to });
  return { ...p, code: `${p.from.replace(/-/g, '')}-${p.to.replace(/-/g, '')}` };
}
export const inPeriod = (d, p) => !!d && String(d).slice(0, 10) >= p.from && String(d).slice(0, 10) <= p.to;
/** Month keys from → to (inclusive), capped. */
export function monthsBetween(from, to, cap = 24) {
  const out = []; let k = monthKey(from);
  while (k <= monthKey(to) && out.length < cap) { out.push(k); k = monthKey(addMonths(k + '-01', 1)); }
  return out;
}

// ---------- GST ----------
/** Split GST into CGST + SGST halves (CGST rounded to paise, SGST takes the remainder so they always add up). */
export function gstSplit(tax) {
  const t = round2(tax); const cgst = round2(t / 2);
  return { cgst, sgst: round2(t - cgst), tax: t };
}
/** Invoice-wise GST rows for taxed invoices in the period. */
export function gstRows(invoices, period, cname = () => '') {
  return invoices.filter(i => inPeriod(i.invoice_date, period) && Number(i.tax_amount) > 0)
    .sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date)) || String(a.number).localeCompare(String(b.number), 'en', { numeric: true }))
    .map(i => {
      const s = gstSplit(i.tax_amount);
      return { id: i.id, number: i.number, date: i.invoice_date, customer: cname(i.customer_id), rate: Number(i.tax_percent) || 0, taxable: round2(Number(i.subtotal) - Number(i.discount_amount || 0)), ...s, total: round2(i.total) };
    });
}
export function gstByMonth(rows, period) {
  return monthsBetween(period.from, period.to).map(k => {
    const r = rows.filter(x => monthKey(x.date) === k);
    return { month: k, label: monthLabel(k), count: r.length, taxable: round2(sum(r, x => x.taxable)), cgst: round2(sum(r, x => x.cgst)), sgst: round2(sum(r, x => x.sgst)), tax: round2(sum(r, x => x.tax)), total: round2(sum(r, x => x.total)) };
  });
}

// ---------- ageing ----------
export const AGE_BUCKETS = [{ key: '0-30', label: '0–30 days', min: 0, max: 30 }, { key: '31-60', label: '31–60 days', min: 31, max: 60 }, { key: '61-90', label: '61–90 days', min: 61, max: 90 }, { key: '90+', label: '90+ days', min: 91, max: Infinity }];
export function ageBucket(days) { const d = Math.max(0, days); return AGE_BUCKETS.find(b => d >= b.min && d <= b.max).key; }
/** Open invoices (balance > 0) dated on/before asOf, bucketed by days since the invoice date. */
export function ageing(invoices, asOf = todayIST()) {
  const open = invoices.filter(i => Number(i.balance) > 0.009 && i.invoice_date && i.invoice_date <= asOf)
    .map(i => ({ ...i, age: Math.max(0, daysBetween(i.invoice_date, asOf)) }))
    .sort((a, b) => b.age - a.age);
  const buckets = AGE_BUCKETS.map(b => { const l = open.filter(i => ageBucket(i.age) === b.key); return { ...b, count: l.length, amount: round2(sum(l, i => i.balance)), invoices: l }; });
  return { asOf, buckets, total: round2(sum(open, i => i.balance)), invoices: open };
}

// ---------- CSV ----------
/** One CSV cell: numbers as-is; text quoted when it has , " CR or LF (quotes doubled); a leading = + - @ is prefixed with ' (formula injection guard). */
export function csvCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** rows: array of arrays → CSV text with a UTF-8 BOM (Excel opens ₹ and Indian names correctly) and CRLF line ends. */
export function toCsv(rows) { return '\uFEFF' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

// ---------- albums ----------
export const ALBUM_STAGES = ['design', 'approval', 'sent_to_print', 'printed', 'binding', 'delivered'];
export const ALBUM_STAGE_LABEL = { design: 'Design', approval: 'Customer approval', sent_to_print: 'Sent to print', printed: 'Printed', binding: 'Binding / Box', delivered: 'Delivered' };
export const ALBUM_COST_CATEGORIES = ['Printing', 'Lamination', 'Album Box', 'Paper', 'Courier', 'Designer', 'Other'];
export const albumOverdue = (a, today = todayIST()) => !!a.due_date && a.due_date < today && a.stage !== 'delivered';
/** Job costing: price charged vs linked expenses (album_order_id). margin = profit / price × 100 (null when price is 0). */
export function albumCosting(album, expenses) {
  const costs = expenses.filter(e => e.album_order_id === album.id)
    .sort((a, b) => String(a.expense_date || '').localeCompare(String(b.expense_date || '')));
  const price = round2(album.price);
  const cost = round2(sum(costs, e => e.amount));
  const unpaid = round2(sum(costs.filter(e => e.paid_status === 'unpaid'), e => e.amount));
  const profit = round2(price - cost);
  return { costs, price, cost, paid: round2(cost - unpaid), unpaid, profit, margin: price > 0 ? round2(profit / price * 100) : null };
}
export const fmtPct = p => (p == null ? '—' : `${(Math.round(p * 10) / 10).toLocaleString('en-IN')}%`);

// ---------- vendors ----------
export const VENDOR_KINDS = ['Print lab', 'Album box', 'Lamination', 'Courier', 'Designer', 'Other'];
export const KIND_CATEGORY = { 'Print lab': 'Printing', 'Album box': 'Album Box', Lamination: 'Lamination', Courier: 'Courier', Designer: 'Designer' };
export const RATE_UNITS = ['sheet', 'page', 'box', 'piece', 'set', 'parcel', 'hour', 'job'];
export function vendorRates(v) {
  let r = v?.rates;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = []; } }
  return Array.isArray(r) ? r.filter(x => x && String(x.item || '').trim()) : [];
}
/** Billed = all linked expenses; unpaid = paid_status 'unpaid'; paid = the rest. */
export function vendorTotals(vendorId, expenses) {
  const mine = expenses.filter(e => e.vendor_id === vendorId);
  const billed = round2(sum(mine, e => e.amount));
  const unpaid = round2(sum(mine.filter(e => e.paid_status === 'unpaid'), e => e.amount));
  return { count: mine.length, billed, unpaid, paid: round2(billed - unpaid), unpaidCount: mine.filter(e => e.paid_status === 'unpaid').length };
}

// ---------- report data ----------
/**
 * Everything the Reports page / report PDF needs for one period.
 * d: { invoices, payments, expenses, payouts, tasks, projects, customers, members, albums }
 */
export function reportData(d, period, { today = todayIST(), gst = true } = {}) {
  const cMap = new Map(d.customers.map(c => [c.id, c]));
  const pMap = new Map(d.projects.map(p => [p.id, p]));
  const cname = id => cMap.get(id)?.name || '—';
  const inv = d.invoices.filter(i => inPeriod(i.invoice_date, period));
  const pay = d.payments.filter(p => inPeriod(p.payment_date, period));
  const exp = d.expenses.filter(e => inPeriod(e.expense_date, period));
  const pout = d.payouts.filter(p => inPeriod(p.payout_date, period));

  const billed = round2(sum(inv, i => i.total)); const received = round2(sum(pay, p => p.amount));
  const expenses = round2(sum(exp, e => e.amount)); const payouts = round2(sum(pout, p => p.amount));
  const summary = { billed, received, expenses, payouts, net: round2(received - expenses - payouts), invoices: inv.length, outstanding: round2(sum(inv, i => i.balance)) };

  const monthly = monthsBetween(period.from, period.to).map(k => {
    const r = round2(sum(pay.filter(p => monthKey(p.payment_date) === k), p => p.amount));
    const e = round2(sum(exp.filter(x => monthKey(x.expense_date) === k), x => x.amount));
    const c = round2(sum(pout.filter(x => monthKey(x.payout_date) === k), x => x.amount));
    return { month: k, label: monthLabel(k), billed: round2(sum(inv.filter(i => monthKey(i.invoice_date) === k), i => i.total)), revenue: r, expense: round2(e + c), expenses: e, payouts: c, net: round2(r - e - c) };
  });

  const byType = new Map();
  for (const i of inv) { const t = pMap.get(i.project_id)?.type || 'No project'; const x = byType.get(t) || { type: t, billed: 0, count: 0 }; x.billed = round2(x.billed + Number(i.total)); x.count++; byType.set(t, x); }
  const types = [...byType.values()].sort((a, b) => b.billed - a.billed);

  const byCust = new Map();
  const cust = id => { if (!byCust.has(id)) byCust.set(id, { id, name: cname(id), billed: 0, received: 0, pending: 0, invoices: 0 }); return byCust.get(id); };
  for (const i of inv) { const x = cust(i.customer_id); x.billed = round2(x.billed + Number(i.total)); x.pending = round2(x.pending + Number(i.balance)); x.invoices++; }
  for (const p of pay) { if (p.customer_id) { const x = cust(p.customer_id); x.received = round2(x.received + Number(p.amount)); } }
  const customers = [...byCust.values()].sort((a, b) => b.billed - a.billed || b.received - a.received);

  const asOf = period.to < today ? period.to : today;
  const age = ageing(d.invoices, asOf);
  age.rows = age.invoices.map(i => ({ id: i.id, number: i.number, date: i.invoice_date, due: i.due_date, customer: cname(i.customer_id), age: i.age, bucket: ageBucket(i.age), total: round2(i.total), balance: round2(i.balance) }));

  const byCat = new Map();
  for (const e of exp) { const k = e.category || 'Other'; const x = byCat.get(k) || { category: k, amount: 0, count: 0, unpaid: 0 }; x.amount = round2(x.amount + Number(e.amount)); x.count++; if (e.paid_status === 'unpaid') x.unpaid = round2(x.unpaid + Number(e.amount)); byCat.set(k, x); }
  const categories = [...byCat.values()].sort((a, b) => b.amount - a.amount);

  const crew = d.members.map(m => {
    const st = memberStats(m.id, d.tasks, d.payouts, period);
    return { id: m.id, name: m.display_name || m.email, job: m.job_title || '', tasks: st.periodTasks, earned: st.earned, paid: st.received, pending: Math.max(0, st.pending) };
  }).filter(x => x.tasks || x.paid || x.pending).sort((a, b) => b.paid - a.paid || b.earned - a.earned);

  const albums = d.albums.filter(a => {
    const k = albumCosting(a, d.expenses);
    return inPeriod(String(a.created_at || '').slice(0, 10), period) || inPeriod(a.due_date, period) || k.costs.some(e => inPeriod(e.expense_date, period));
  }).map(a => { const k = albumCosting(a, d.expenses); return { id: a.id, title: a.title || 'Album', customer: cname(a.customer_id), stage: a.stage, price: k.price, cost: k.cost, profit: k.profit, margin: k.margin, unpaid: k.unpaid }; })
    .sort((a, b) => b.profit - a.profit);
  const albumTotals = { price: round2(sum(albums, a => a.price)), cost: round2(sum(albums, a => a.cost)) };
  albumTotals.profit = round2(albumTotals.price - albumTotals.cost);
  albumTotals.margin = albumTotals.price > 0 ? round2(albumTotals.profit / albumTotals.price * 100) : null;

  let gstData = null;
  if (gst) {
    const rows = gstRows(d.invoices, period, cname);
    const months = gstByMonth(rows, period);
    gstData = { rows, months, totals: { count: rows.length, taxable: round2(sum(rows, r => r.taxable)), cgst: round2(sum(rows, r => r.cgst)), sgst: round2(sum(rows, r => r.sgst)), tax: round2(sum(rows, r => r.tax)), total: round2(sum(rows, r => r.total)) } };
  }
  return { period, summary, monthly, types, customers, ageing: age, categories, crew, albums, albumTotals, gst: gstData };
}
