// Pure helpers: dates (IST), money (en-IN), words, phone numbers. No DOM here.
export const TZ = 'Asia/Kolkata';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date in India as YYYY-MM-DD. */
export function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function hourIST(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(now)) % 24;
}
function toUTC(iso) { return new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); }
export function addDays(iso, n) { const d = toUTC(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
/** Same day next month(s), clamped to the month end. */
export function addMonths(iso, n, dayOfMonth) {
  const d = toUTC(iso); const day = dayOfMonth || d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
export function daysBetween(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
export function monthKey(iso) { return String(iso || '').slice(0, 7); }
export function monthLabel(key) { const [y, m] = key.split('-'); return `${MON[+m - 1]} ${y}`; }
export function monthShort(key) { return MON[+key.split('-')[1] - 1]; }
/** Last n month keys (oldest first) ending with the month of `iso`. */
export function lastMonths(iso, n) {
  const out = []; for (let i = n - 1; i >= 0; i--) out.push(monthKey(addMonths(iso.slice(0, 7) + '-01', -i))); return out;
}
export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return '—';
  return `${d} ${MON[+m - 1]} ${y}`;
}
export function fmtDateShort(iso) { if (!iso) return '—'; const [, m, d] = String(iso).slice(0, 10).split('-'); return `${d} ${MON[+m - 1]}`; }
export function fmtDateTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}
export function fmtTime(ts = new Date()) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
}

// ---------- Money ----------
const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SAR: 'SAR ', AUD: 'A$', CAD: 'C$', SGD: 'S$' };
let CUR = '₹';
export function setCurrency(c) {
  const v = String(c || '').trim();
  if (!v) CUR = '₹';
  else if (/^[A-Za-z]{3}$/.test(v)) CUR = SYMBOLS[v.toUpperCase()] || v.toUpperCase() + ' ';
  else CUR = v;
}
export function currencySymbol() { return CUR; }
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
export function num(n) {
  const v = Number(n) || 0; const a = Math.abs(v);
  return a.toLocaleString('en-IN', { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 });
}
export function money(n) { const v = round2(n); return (v < 0 ? '−' : '') + CUR + num(v); }
export function moneyShort(n) {
  const v = Number(n) || 0; const a = Math.abs(v); const s = v < 0 ? '−' : '';
  if (a >= 1e7) return s + CUR + trim1(a / 1e7) + 'Cr';
  if (a >= 1e5) return s + CUR + trim1(a / 1e5) + 'L';
  if (a >= 1e4) return s + CUR + trim1(a / 1e3) + 'K';
  return money(v);
}
function trim1(x) { return (Math.round(x * 10) / 10).toString(); }

// ---------- Amount in words (Indian numbering) ----------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function two(n) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''); }
function three(n) {
  const hdr = Math.floor(n / 100), rest = n % 100;
  return [hdr ? ONES[hdr] + ' Hundred' : '', rest ? two(rest) : ''].filter(Boolean).join(' ');
}
function intWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 1e7); n %= 1e7;
  const lakh = Math.floor(n / 1e5); n %= 1e5;
  const thousand = Math.floor(n / 1e3); n %= 1e3;
  if (crore) parts.push(intWords(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (n) parts.push(three(n));
  return parts.join(' ');
}
export function amountInWords(amount) {
  const v = Math.abs(round2(amount));
  const rupees = Math.floor(v); const paise = Math.round((v - rupees) * 100);
  let s = intWords(rupees) + ' Rupees';
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return s + ' Only';
}

// ---------- Text / phone ----------
export function normalizeWa(num) {
  let d = String(num || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '91' + d;
  return d;
}
export function initials(name, fallback = 'S') {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return fallback;
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).toUpperCase();
}
export function safeFilePart(s) {
  return String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'Customer';
}
export function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
export function debounce(fn, ms = 200) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}
export function sum(arr, f = x => x) { return arr.reduce((s, x) => s + (Number(f(x)) || 0), 0); }
export function byId(arr) { const m = new Map(); for (const x of arr) m.set(x.id, x); return m; }
export function includesCI(hay, needle) { return String(hay || '').toLowerCase().includes(String(needle || '').toLowerCase()); }

/** Allocate total paid across installments in order. Returns [{...inst, paid, status:'paid'|'partial'|'due'}]. */
export function allocateInstallments(installments, paidTotal) {
  let left = round2(paidTotal);
  return installments.map(i => {
    const amt = round2(i.amount);
    const paid = Math.max(0, Math.min(amt, left)); left = round2(left - paid);
    return { ...i, paid, status: paid >= amt - 0.009 && amt > 0 ? 'paid' : paid > 0 ? 'partial' : 'due' };
  });
}

/** Section header rows ("Day 1 · Haldi") are stored as items with qty 0, rate 0 and this flag in `detail`. */
export const HEADER_FLAG = '__header__';
export const isHeader = it => !!it && it.detail === HEADER_FLAG;

/** Mirror of the server's invoice/quotation compute trigger. */
export function computeTotals(items, discount, taxPercent) {
  const sub = round2(sum(items, i => round2((Number(i.qty) || 0) * (Number(i.rate) || 0))));
  const disc = Math.min(Math.max(Number(discount) || 0, 0), sub);
  const tax = round2((sub - disc) * (Number(taxPercent) || 0) / 100);
  return { subtotal: sub, discount_amount: disc, tax_amount: tax, total: round2(sub - disc + tax) };
}
