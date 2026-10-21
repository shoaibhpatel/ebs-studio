// Shared page bits: status pills, stage progress, page header, record drawers, item lists.
import { h, pill, ic } from '../dom.js';
import { STAGES, STAGE_LABEL, TASK_STATUS_LABEL } from '../config.js';
import { cap, money, num, round2, isHeader, fmtDate, fmtDateShort } from '../util.js';
import { gstOn } from '../store.js';

export function invStatus(s) {
  const t = { paid: 's2', partial: 's3', unpaid: 's4' }[s] || 's0';
  return pill(cap(s || 'unpaid'), t);
}
/** Task status pill. For done tasks pass the payout coverage ({state}) to show Paid / Payment due. */
export function taskPill(t, cov) {
  if (t.status === 'done' && cov) {
    if (cov.state === 'paid') return pill('Done · Paid', 's2');
    return pill(cov.state === 'partial' ? 'Done · Part paid' : 'Done · Payment due', 's3');
  }
  return pill(TASK_STATUS_LABEL[t.status] || 'Assigned', { assigned: 's1', in_progress: 's5', done: 's2', cancelled: 's0' }[t.status] || 's1');
}
/** "12 Mar 2025" or "12 Mar – 14 Mar 2025" for multi-day work. */
export function taskDates(t) {
  return t.end_date && t.end_date !== t.work_date ? `${fmtDateShort(t.work_date)} – ${fmtDate(t.end_date)}` : fmtDate(t.work_date);
}
export function quoteStatus(s) { return pill(cap(s || 'draft'), { draft: 's0', sent: 's1', accepted: 's2', rejected: 's4' }[s] || 's0'); }
/** Muted "Party: <name>" line shown next to an invoice/quotation number. Returns null when empty (no stray label). */
export function partyLine(doc, { prefix = 'Party: ' } = {}) {
  const name = String(doc?.party_name || '').trim();
  return name ? h('small', { class: 'party-line' }, prefix + name) : null;
}
export function normStatus(s) {
  const v = String(s || '').toLowerCase().replace(/_/g, ' ').trim();
  if (!v) return 'Booked';
  return { inquiry: 'Inquiry', booked: 'Booked', 'in progress': 'In Progress', completed: 'Completed', cancelled: 'Cancelled', delivered: 'Completed' }[v] || cap(s);
}
export function projStatus(s) {
  const n = normStatus(s);
  return pill(n, { Inquiry: 's0', Booked: 's3', 'In Progress': 's1', Completed: 's2', Cancelled: 's4' }[n] || 's0');
}
export const isActiveProject = p => !['Completed', 'Cancelled'].includes(normStatus(p.status));
export function stageProgress(stage) {
  const i = Math.max(0, STAGES.indexOf(stage || 'booking'));
  const pct = Math.round(((i + 1) / STAGES.length) * 100);
  return h('span', { class: 'nowrap' },
    h('span', { class: 'prog', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct), 'aria-label': 'Workflow progress' }, h('i', { style: { width: pct + '%' } })),
    h('span', { class: 'stage' }, STAGE_LABEL[stage] || 'Booking'));
}
export function pageHead(title, sub, actions) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, title), sub ? h('p', { class: 'sub' }, sub) : null),
    actions ? h('div', { class: 'btns' }, actions) : null);
}
export function linkBtn(label, href, cls = '', icon) { return h('a', { class: 'btn ' + cls, href }, icon ? h('span', { class: 'bi', 'aria-hidden': 'true' }, ic(icon, 15)) : null, label); }

/** Open a record in the slide-over drawer (replaces any open drawer). kind: invoice | quotation | customer | project | receipt */
export async function openRecord(kind, id) {
  const map = {
    invoice: () => import('./invoices.js').then(m => m.openInvoiceDrawer(id)),
    quotation: () => import('./quotations.js').then(m => m.openQuotationDrawer(id)),
    customer: () => import('./customers.js').then(m => m.openCustomerDrawer(id)),
    project: () => import('./projects.js').then(m => m.openProjectDrawer(id)),
    receipt: () => import('./payments.js').then(m => m.openReceiptDrawer(id)),
    member: () => import('./team.js').then(m => m.openMemberDrawer(id)),
    task: () => import('./team.js').then(m => m.openTaskDrawer(id)),
    lead: () => import('./leads.js').then(m => m.openLeadDrawer(id)),
    album: () => import('./albums.js').then(m => m.openAlbumDrawer(id)),
    vendor: () => import('./vendors.js').then(m => m.openVendorDrawer(id)),
  };
  return map[kind]?.();
}
/** Small link-like button that opens a record drawer. */
export function recLink(kind, id, label) {
  return h('button', { type: 'button', class: 'lnk', onclick: e => { e.stopPropagation(); openRecord(kind, id); } }, label);
}

/** Read-only item list for drawers (handles section header rows). */
export function itemsView(items) {
  const sac = gstOn();
  let n = 0;
  return h('div', { class: 'iv' },
    h('div', { class: 'iv-row iv-head' }, h('span', null, '#'), h('span', null, 'Item'), h('span', { class: 'r' }, 'Qty × Rate'), h('span', { class: 'r' }, 'Amount')),
    items.length ? items.map(it => isHeader(it)
      ? h('div', { class: 'iv-sec' }, it.description)
      : h('div', { class: 'iv-row' }, h('span', { class: 'iv-n' }, String(++n)),
        h('span', null, h('b', null, it.description), it.detail || (sac && it.sac) ? h('small', null, [it.detail, sac && it.sac ? 'SAC ' + it.sac : null].filter(Boolean).join(' · ')) : null),
        h('span', { class: 'r muted nowrap' }, `${num(it.qty)} × ${money(it.rate)}`),
        h('span', { class: 'r nowrap' }, money(round2(Number(it.qty) * Number(it.rate)))))) : h('p', { class: 'dim small', style: { padding: '8px 0' } }, 'No items.'));
}

/** Totals rows (read-only) for a saved invoice / quotation. */
export function totalsView(doc, { invoice = false } = {}) {
  const gst = gstOn(); const half = round2(Number(doc.tax_amount) / 2);
  const tr = (l, v, cls = '') => h('div', { class: 'tr ' + cls }, h('span', null, l), h('span', null, v));
  return h('div', { class: 'totals' },
    tr('Subtotal', money(doc.subtotal)),
    Number(doc.discount_amount) > 0 ? tr('Discount', '– ' + money(doc.discount_amount)) : null,
    Number(doc.tax_amount) > 0 && gst ? [tr(`CGST @ ${num(doc.tax_percent / 2)}%`, money(half), 'muted'), tr(`SGST @ ${num(doc.tax_percent / 2)}%`, money(round2(doc.tax_amount - half)), 'muted')] : null,
    Number(doc.tax_amount) > 0 && !gst ? tr(`Tax @ ${num(doc.tax_percent)}%`, money(doc.tax_amount), 'muted') : null,
    h('div', { class: 'tr grand' }, h('span', null, 'Total'), h('b', null, money(doc.total))),
    invoice ? [tr('Received', h('span', { class: 'up' }, money(doc.paid_amount))), h('div', { class: 'tr bal' }, h('span', null, 'Balance due'), h('b', { class: Number(doc.balance) > 0 ? 'dn' : 'up' }, money(doc.balance)))] : null);
}

/** Section block inside a drawer. */
export function dwSection(title, body, extra) {
  return h('section', { class: 'dw-sec' }, h('div', { class: 'dw-sec-h' }, h('h3', null, title), extra || null), body);
}
/** Big summary numbers row for drawers. items: [[label, value, cls]] */
export function statRow(items) {
  return h('div', { class: 'stat-row' }, items.filter(Boolean).map(([l, v, cls]) => h('div', { class: 'stat' }, h('span', null, l), h('b', { class: cls || '' }, v))));
}
