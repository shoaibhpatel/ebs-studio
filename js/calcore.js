// Calendar maths (pure, no DOM): event collection, conflicts, yearly occasions, .ics text and Google Calendar links.
// Shared by the Calendar page, the project / task drawers, the dashboard and the debug self-test.
import { addDays, todayIST, daysBetween, allocateInstallments, initials, normalizeWa } from './util.js';

export const KINDS = [
  ['shoot', 'Shoots'], ['delivery', 'Deliveries'], ['task', 'Crew'], ['due', 'Payments due'], ['lead', 'Leads'], ['occasion', 'Occasions'],
];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const KIND_COLOR = { shoot: '#d4ad55', delivery: '#b98cff', task: '#8fb4ff', due: '#ef8a8a', lead: '#7ad49a', occasion: '#f2a7c8' };

/** Stable colour per project type (gold first, then a calm palette). */
const PALETTE = ['#d4ad55', '#7fc8c0', '#e59b6b', '#9fa8ff', '#d98fc4', '#8fd18a', '#e0c36a', '#78b7e8', '#c59bf0', '#e88f8f'];
export function typeColor(type, types = []) {
  const i = types.indexOf(type);
  if (i >= 0) return PALETTE[i % PALETTE.length];
  let hsh = 0; for (const ch of String(type || '')) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hsh % PALETTE.length];
}

const isCancelled = p => /cancel/i.test(String(p.status || ''));
const endOf = (start, end) => (end && end > start ? end : start);
const overlaps = (a, b, from, to) => a <= to && b >= from;

/** Month-day of a date in a given year (29 Feb → 28 Feb in non-leap years). */
export function inYear(iso, year) {
  const [, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const dd = m === 2 && d === 29 && !leap ? 28 : d;
  return `${year}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/**
 * Upcoming birthdays / anniversaries within `days` days from `today` (inclusive), handling the Dec → Jan wrap.
 * Returns [{ customer, kind: 'birthday'|'anniversary', date, in, years|null }] sorted by date.
 */
export function upcomingOccasions(customers, { today = todayIST(), days = 14 } = {}) {
  const out = []; const y = Number(today.slice(0, 4)); const end = addDays(today, days);
  for (const c of customers) {
    for (const kind of ['birthday', 'anniversary']) {
      const src = c[kind]; if (!src || !/^\d{4}-\d{2}-\d{2}/.test(String(src))) continue;
      let date = inYear(src, y);
      if (date < today) date = inYear(src, y + 1);
      if (date > end) continue;
      const by = Number(String(src).slice(0, 4)); const years = by > 1900 && by < Number(date.slice(0, 4)) ? Number(date.slice(0, 4)) - by : null;
      out.push({ customer: c, kind, date, in: daysBetween(today, date), years });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.customer.name).localeCompare(String(b.customer.name)));
}

/** Occasions (all customers) falling inside [from, to] — used by the calendar grid. */
function occasionsIn(customers, from, to) {
  const out = [];
  const y0 = Number(from.slice(0, 4)), y1 = Number(to.slice(0, 4));
  for (const c of customers) for (const kind of ['birthday', 'anniversary']) {
    const src = c[kind]; if (!src || !/^\d{4}-\d{2}-\d{2}/.test(String(src))) continue;
    for (let y = y0; y <= y1; y++) {
      const date = inYear(src, y);
      if (date < from || date > to) continue;
      const by = Number(String(src).slice(0, 4));
      out.push({ customer: c, kind, date, years: by > 1900 && by < y ? y - by : null });
    }
  }
  return out;
}

/**
 * All calendar events touching [from, to].
 * data: { projects, tasks, invoices, installments, leads, customers, members, types }
 * Event: { key, kind, date, end, title, sub, color, ref: { type, id }, dashed?, initials?, memberId?, done? }
 */
export function collectEvents(data, from, to) {
  const { projects = [], tasks = [], invoices = [], installments = [], leads = [], customers = [], members = [], types = [] } = data;
  const cMap = new Map(customers.map(c => [c.id, c]));
  const mMap = new Map(members.map(m => [m.id, m]));
  const iMap = new Map(invoices.map(i => [i.id, i]));
  const ev = [];
  for (const p of projects) {
    if (isCancelled(p)) continue;
    const cust = cMap.get(p.customer_id)?.name || '';
    if (p.event_date) {
      const end = endOf(p.event_date, p.event_end_date);
      if (overlaps(p.event_date, end, from, to)) ev.push({ key: 'shoot:' + p.id, kind: 'shoot', date: p.event_date, end, title: p.name, sub: [cust, p.type, p.venue].filter(Boolean).join(' · '), color: typeColor(p.type, types), ref: { type: 'project', id: p.id }, venue: p.venue || '', projectType: p.type || '' });
    }
    if (p.delivery_date && p.delivery_date >= from && p.delivery_date <= to)
      ev.push({ key: 'delivery:' + p.id, kind: 'delivery', date: p.delivery_date, end: p.delivery_date, title: 'Delivery · ' + p.name, sub: cust, color: KIND_COLOR.delivery, ref: { type: 'project', id: p.id }, done: p.stage === 'delivered' });
  }
  for (const t of tasks) {
    if (!t.work_date || t.status === 'cancelled') continue;
    const end = endOf(t.work_date, t.end_date);
    if (!overlaps(t.work_date, end, from, to)) continue;
    const m = mMap.get(t.member_id); const who = m?.display_name || m?.email || '—';
    ev.push({ key: 'task:' + t.id, kind: 'task', date: t.work_date, end, title: t.title || 'Work', sub: [who, t.project_title, t.venue].filter(Boolean).join(' · '), color: KIND_COLOR.task, ref: { type: 'task', id: t.id }, initials: initials(who, '?'), memberId: t.member_id, memberName: who, projectTitle: t.project_title || '', venue: t.venue || '', done: t.status === 'done' });
  }
  for (const i of invoices) {
    if (!i.due_date || !(Number(i.balance) > 0.009) || i.due_date < from || i.due_date > to) continue;
    ev.push({ key: 'due:' + i.id, kind: 'due', date: i.due_date, end: i.due_date, title: `${i.number} due`, sub: cMap.get(i.customer_id)?.name || '', color: KIND_COLOR.due, ref: { type: 'invoice', id: i.id }, amount: Number(i.balance) });
  }
  const byInv = new Map();
  for (const x of installments) { if (!byInv.has(x.invoice_id)) byInv.set(x.invoice_id, []); byInv.get(x.invoice_id).push(x); }
  for (const [invId, list] of byInv) {
    const inv = iMap.get(invId); if (!inv || !(Number(inv.balance) > 0.009)) continue;
    const alloc = allocateInstallments(list.slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)), inv.paid_amount);
    for (const x of alloc) {
      if (x.status === 'paid' || !x.due_date || x.due_date < from || x.due_date > to) continue;
      ev.push({ key: 'inst:' + (x.id || invId + ':' + x.sort), kind: 'due', date: x.due_date, end: x.due_date, title: `${x.label || 'Installment'} · ${inv.number}`, sub: cMap.get(inv.customer_id)?.name || '', color: KIND_COLOR.due, ref: { type: 'invoice', id: invId }, amount: Number(x.amount) - Number(x.paid || 0), installment: true });
    }
  }
  for (const l of leads) {
    if (!l.event_date || l.event_date < from || l.event_date > to || l.status === 'won' || l.status === 'lost') continue;
    ev.push({ key: 'lead:' + l.id, kind: 'lead', date: l.event_date, end: l.event_date, title: l.name, sub: ['Lead', l.event_type].filter(Boolean).join(' · '), color: KIND_COLOR.lead, ref: { type: 'lead', id: l.id }, dashed: true });
  }
  for (const o of occasionsIn(customers, from, to)) {
    ev.push({ key: `occ:${o.kind}:${o.customer.id}:${o.date}`, kind: 'occasion', date: o.date, end: o.date, title: `${o.customer.name} · ${o.kind === 'birthday' ? 'Birthday' : 'Anniversary'}`, sub: o.years ? (o.kind === 'birthday' ? `Turns ${o.years}` : `${o.years} years`) : '', color: KIND_COLOR.occasion, ref: { type: 'customer', id: o.customer.id }, occasion: o.kind, customer: o.customer, years: o.years });
  }
  const order = { shoot: 0, task: 1, delivery: 2, due: 3, lead: 4, occasion: 5 };
  return ev.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.title.localeCompare(b.title));
}

/** Does the event touch `day`? */
export const eventOn = (e, day) => e.date <= day && (e.end || e.date) >= day;

/**
 * Conflicts per day in [from, to]: ≥ 2 shoots the same day, or one member with ≥ 2 tasks the same day.
 * Returns Map day → [{ type: 'shoots'|'member', text, keys }].
 */
export function conflictMap(events, from, to) {
  const out = new Map();
  const shoots = events.filter(e => e.kind === 'shoot'); const tasks = events.filter(e => e.kind === 'task');
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const notes = [];
    const s = shoots.filter(e => eventOn(e, d));
    if (s.length >= 2) notes.push({ type: 'shoots', text: `${s.length} shoots on the same day: ${s.map(e => e.title).join(', ')}`, keys: s.map(e => e.key) });
    const byM = new Map();
    for (const t of tasks) if (eventOn(t, d)) { if (!byM.has(t.memberId)) byM.set(t.memberId, []); byM.get(t.memberId).push(t); }
    for (const list of byM.values()) if (list.length >= 2) notes.push({ type: 'member', text: `${list[0].memberName} has ${list.length} tasks: ${list.map(t => (t.projectTitle ? `${t.title} (${t.projectTitle})` : t.title)).join(', ')}`, keys: list.map(e => e.key) });
    if (notes.length) out.set(d, notes);
  }
  return out;
}

// ---------- Month / week helpers (Monday-first weeks) ----------
export function weekStartOf(iso) { const dow = new Date(iso + 'T00:00:00Z').getUTCDay(); return addDays(iso, dow === 0 ? -6 : 1 - dow); }
export function monthGrid(iso) {
  const first = iso.slice(0, 7) + '-01';
  const start = weekStartOf(first);
  const nextMonth = new Date(Date.UTC(+first.slice(0, 4), +first.slice(5, 7), 1)).toISOString().slice(0, 10);
  const last = addDays(nextMonth, -1);
  const end = addDays(weekStartOf(last), 6);
  const days = []; for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return { first, last, start, end, days };
}

// ---------- .ics (RFC 5545) ----------
const ymd = iso => String(iso).slice(0, 10).replace(/-/g, '');
/** Escape TEXT values: backslash, semicolon, comma, newlines. */
export function icsEscape(s) { return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n'); }
/** Fold content lines longer than 75 octets (CRLF + space), never splitting a UTF-8 character. */
export function icsFold(line) {
  const enc = new TextEncoder(); const out = []; let cur = ''; let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}
function stamp(now = new Date()) { return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
/**
 * All-day events → VCALENDAR text with CRLF line endings.
 * events: [{ uid, title, start (YYYY-MM-DD), end (inclusive, optional), description, location }]
 */
export function buildIcs(events, { name = 'Studio Manager', now = new Date() } = {}) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio Manager//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:' + icsEscape(name)];
  const st = stamp(now);
  for (const e of events) {
    const endEx = addDays(e.end && e.end > e.start ? e.end : e.start, 1); // DTEND is exclusive for all-day events
    L.push('BEGIN:VEVENT', `UID:${String(e.uid || Math.random().toString(36).slice(2)).replace(/[^\w.@-]/g, '-')}@studio-manager`, `DTSTAMP:${st}`,
      `DTSTART;VALUE=DATE:${ymd(e.start)}`, `DTEND;VALUE=DATE:${ymd(endEx)}`, 'SUMMARY:' + icsEscape(e.title || 'Event'));
    if (e.description) L.push('DESCRIPTION:' + icsEscape(e.description));
    if (e.location) L.push('LOCATION:' + icsEscape(e.location));
    L.push('TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.map(icsFold).join('\r\n') + '\r\n';
}

/** Google Calendar "add event" link for an all-day event (end inclusive → exclusive +1 day). */
export function gcalUrl({ title, start, end, description, location }) {
  const endEx = addDays(end && end > start ? end : start, 1);
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE'
    + `&text=${encodeURIComponent(title || '')}&dates=${ymd(start)}/${ymd(endEx)}`
    + `&details=${encodeURIComponent(description || '')}&location=${encodeURIComponent(location || '')}`;
}

// ---------- Calendar entries for records ----------
export function projectCalEvents(p, customer) {
  const out = [];
  const base = [customer?.name ? 'Customer: ' + customer.name : null, customer?.mobile ? 'Mobile: ' + customer.mobile : null, p.type ? 'Type: ' + p.type : null].filter(Boolean);
  if (p.event_date) out.push({ uid: 'shoot-' + p.id, kind: 'shoot', title: `${p.name}${customer?.name ? ' · ' + customer.name : ''}`, start: p.event_date, end: p.event_end_date || p.event_date, location: p.venue || '', description: [...base, p.delivery_date ? 'Delivery: ' + p.delivery_date : null, p.notes || null].filter(Boolean).join('\n') });
  if (p.delivery_date) out.push({ uid: 'delivery-' + p.id, kind: 'delivery', title: `Delivery · ${p.name}`, start: p.delivery_date, end: p.delivery_date, location: '', description: base.join('\n') });
  return out;
}
export function taskCalEvent(t, memberName) {
  return { uid: 'task-' + t.id, kind: 'task', title: `${t.title || 'Work'}${memberName ? ' · ' + memberName : ''}`, start: t.work_date, end: t.end_date || t.work_date, location: t.venue || '', description: [t.project_title, t.details].filter(Boolean).join('\n') };
}

// ---------- Messages ----------
export function wishText(o, company) {
  const n = o.customer?.name || 'there';
  const co = company || 'our studio';
  if (o.kind === 'birthday') return `Happy Birthday, ${n}! 🎂\n\nWishing you a wonderful year full of happy moments.\n\nWarm wishes from all of us at *${co}*.`;
  return `Happy Anniversary, ${n}! 💐\n\n${o.years ? `Congratulations on ${o.years} beautiful years together. ` : ''}Wishing you both many more years of love and happiness.\n\nWarm wishes from all of us at *${co}*.`;
}
export const sameMobile = (a, b) => { const x = normalizeWa(a), y = normalizeWa(b); return !!x && x === y; };
