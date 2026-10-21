// App state + cached data access + business flows. Pages use only this module.
import { setCurrency, todayIST, round2, money } from './util.js';

export const params = new URLSearchParams(location.search);
export const DEMO = params.get('demo') === '1';
export let api = null;
export const state = { session: null, member: null, company: null, settings: {}, logoUrl: null };

export async function initApi() {
  api = DEMO ? (await import('./demo-api.js')).default : (await import('./api.js')).default;
  await api.init({ role: params.get('role') });
  return api;
}

export function setCompany(company) {
  state.company = company;
  state.settings = company?.settings || {};
  setCurrency(state.settings.currency);
}
export const gstOn = () => !!state.settings.gst_enabled;

// ---------- cache ----------
const cache = new Map();
export async function all(table) {
  if (!cache.has(table)) cache.set(table, api.list(table).catch(e => { cache.delete(table); throw e; }));
  return cache.get(table);
}
export function invalidate() { cache.clear(); listeners.forEach(f => { try { f(); } catch { /* ignore */ } }); }
const listeners = new Set();
export function onChange(f) { listeners.add(f); return () => listeners.delete(f); }
export async function getRow(table, id) { return (await all(table)).find(r => r.id === id) || null; }

async function write(fn) { try { return await fn(); } finally { invalidate(); } }

export async function logActivity(text, icon = '•') {
  try { await api.insert('activities', { text, icon }); } catch { /* activity log is best-effort */ }
}

// ---------- generic ----------
export const insert = (t, row) => write(() => api.insert(t, row));
export const update = (t, id, patch) => write(() => api.update(t, id, patch));
export const remove = (t, id) => write(() => api.remove(t, id));

// ---------- invoices & quotations ----------
const COMPUTED = {
  invoice: ['number', 'subtotal', 'tax_amount', 'total', 'paid_amount', 'balance', 'status'],
  quotation: ['number', 'subtotal', 'tax_amount', 'total'],
};
const META = ['id', 'company_id', 'created_at', 'updated_at', 'legacy_id'];

/**
 * Save header → replace items (delete + insert) → (invoice) replace installments → final update to apply
 * discount against the new subtotal → re-select to get server totals.
 */
export async function saveDoc(kind, id, header, items, installments) {
  const T = kind === 'invoice' ? 'invoices' : 'quotations';
  const IT = kind + '_items'; const FK = kind + '_id';
  const row = { ...header };
  for (const k of [...COMPUTED[kind], ...META]) delete row[k];
  return write(async () => {
    const saved = id ? await api.update(T, id, row) : await api.insert(T, row);
    await api.removeWhere(IT, FK, saved.id);
    const its = items.map((it, i) => ({ [FK]: saved.id, sort: i, description: it.description || '', detail: it.detail || null, sac: it.sac || null, qty: Number(it.qty) || 0, rate: Number(it.rate) || 0 }));
    await api.insertMany(IT, its);
    if (kind === 'invoice' && installments) {
      await api.removeWhere('invoice_installments', 'invoice_id', saved.id);
      await api.insertMany('invoice_installments', installments.map((x, i) => ({
        invoice_id: saved.id, sort: i, label: x.label || `Installment ${i + 1}`, percent: x.percent === '' || x.percent == null ? null : Number(x.percent),
        amount: round2(x.amount), due_date: x.due_date || null, due_note: x.due_note || null,
      })));
    }
    // The server clamps discount to the subtotal at insert time (items not there yet) — re-apply it now.
    await api.update(T, saved.id, { discount_amount: Number(row.discount_amount) || 0 });
    const fresh = await api.get(T, saved.id);
    if (!id) logActivity(`${kind === 'invoice' ? 'Invoice' : 'Quotation'} ${fresh.number} created`, kind === 'invoice' ? '▤' : '✎');
    return fresh;
  });
}

export async function docItems(kind, id) {
  const rows = await api.list(kind + '_items', { eq: { [kind + '_id']: id } });
  return rows.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}
/**
 * Items for a set of documents, in one pass. Returns Map(docId -> sorted items[]).
 * Loads the whole *_items table once (RLS limits it to the company) and groups in memory,
 * which is cheaper than one query per document (used by the customer ledger PDF).
 */
export async function docItemsByDoc(kind, ids) {
  const FK = kind + '_id';
  const want = new Set(ids);
  const rows = await api.list(kind + '_items');
  const map = new Map(ids.map(id => [id, []]));
  for (const r of rows) if (want.has(r[FK])) map.get(r[FK]).push(r);
  for (const list of map.values()) list.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  return map;
}
export async function installments(invoiceId) {
  const rows = await api.list('invoice_installments', { eq: { invoice_id: invoiceId } });
  return rows.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

export async function convertQuotation(q) {
  return write(async () => {
    const invId = await api.rpc('convert_quotation_to_invoice', { p_quotation: q.id });
    // Carry the quotation discount over (the RPC inserts before items exist, so the server clamps it to 0).
    if (Number(q.discount_amount) > 0) await api.update('invoices', invId, { discount_amount: Number(q.discount_amount) });
    const inv = await api.get('invoices', invId);
    logActivity(`Quotation ${q.number} converted to invoice ${inv?.number || ''}`, '✎');
    return invId;
  });
}

// ---------- payments ----------
export async function recordPayment({ invoice_id, amount, payment_date, mode, notes }) {
  return write(async () => {
    const pay = await api.insert('payments', { invoice_id, amount: round2(amount), payment_date: payment_date || todayIST(), mode, notes: notes || null });
    const rc = (await api.list('receipts', { eq: { payment_id: pay.id } }))[0] || null;
    const inv = await api.get('invoices', invoice_id);
    logActivity(`Payment ${money(pay.amount)} received${inv ? ' for ' + inv.number : ''}`, '₹');
    return { payment: pay, receipt: rc, invoice: inv };
  });
}

// ---------- team & tasks ----------
const memberErr = e => {
  if (e?.code === '23505') { const x = new Error('This Gmail is already added — one Gmail can belong to only one company. Ask them to use another Google account, or remove it from the other studio first.'); x.code = e.code; return x; }
  return e;
};
export const isSelf = m => !!m && m.id === state.member?.id;
/** Insert / update a member. Email is lower-cased; the owner's own role/email/active are never sent. */
export async function saveMember(existing, row) {
  const r = { ...row };
  if ('email' in r) r.email = String(r.email || '').trim().toLowerCase();
  if (existing && isSelf(existing)) { delete r.role; delete r.email; delete r.active; }
  try {
    return await write(async () => {
      const saved = existing ? await api.update('members', existing.id, r) : await api.insert('members', r);
      if (!existing) logActivity(`${saved.display_name || saved.email} added to the team`, '☺');
      if (isSelf(saved)) Object.assign(state.member, saved);
      return saved;
    });
  } catch (e) { throw memberErr(e); }
}
export async function teamData() {
  const [members, tasks, payouts] = await Promise.all([all('members'), all('tasks'), all('payouts')]);
  const mMap = new Map(members.map(m => [m.id, m]));
  return { members, tasks, payouts, mMap, mname: id => { const m = mMap.get(id); return m ? (m.display_name || m.email) : '—'; } };
}
/** Status change. Employees send only { status } (the server trigger rejects anything else). */
export async function setTaskStatus(task, status) {
  return write(() => api.update('tasks', task.id, { status }));
}
export async function recordPayout({ member_id, task_id, payout_date, amount, mode, notes }) {
  return write(async () => {
    const p = await api.insert('payouts', { member_id, task_id: task_id || null, payout_date: payout_date || todayIST(), amount: round2(amount), mode, notes: notes || null });
    logActivity(`Payout ${money(p.amount)} recorded`, '₹');
    return p;
  });
}

// ---------- leads ----------
const digits = s => String(s || '').replace(/\D/g, '').replace(/^(?:91|0)(?=\d{10}$)/, '');
/**
 * Lead → customer. Re-uses an existing customer with the same mobile number (last 10 digits) instead of creating a duplicate.
 * Sets lead.customer_id and status 'won'. Returns { customer, lead, created }.
 */
export async function convertLead(lead) {
  return write(async () => {
    let customer = lead.customer_id ? await api.get('customers', lead.customer_id) : null;
    let created = false;
    if (!customer && digits(lead.mobile).length >= 10) {
      const list = await api.list('customers');
      customer = list.find(c => digits(c.mobile) === digits(lead.mobile) || digits(c.whatsapp) === digits(lead.mobile)) || null;
    }
    if (!customer) {
      customer = await api.insert('customers', {
        name: String(lead.name || '').trim() || 'Customer', mobile: lead.mobile || null, whatsapp: lead.mobile || null, email: lead.email || null,
        notes: [lead.source ? `Lead source: ${lead.source}` : null, lead.notes || null].filter(Boolean).join('\n') || null,
      });
      created = true;
      logActivity(`Customer ${customer.name} added from a lead`, '☺');
    }
    const saved = await api.update('leads', lead.id, { customer_id: customer.id, status: 'won' });
    logActivity(`Lead ${lead.name} won`, '☺');
    return { customer, lead: saved, created };
  });
}

// ---------- packages ----------
/** Package items are stored as jsonb [{description, detail, qty, rate}]; header rows use detail '__header__', qty 0, rate 0. */
export function packageItems(p) {
  let it = p?.items;
  if (typeof it === 'string') { try { it = JSON.parse(it); } catch { it = []; } }
  return Array.isArray(it) ? it : [];
}
/** Package → invoice / quotation item rows (header rows stay qty 0 / rate 0; a missing qty becomes 1). */
export function packageToDocItems(p, sac = '') {
  return packageItems(p).map(x => (String(x.detail || '') === '__header__'
    ? { description: x.description || '', detail: '__header__', sac: '', qty: 0, rate: 0 }
    : { description: x.description || '', detail: x.detail || '', sac, qty: Number(x.qty) || 1, rate: Number(x.rate) || 0 }));
}
export async function savePackage(existing, row) {
  const r = { ...row };
  for (const k of META) delete r[k];
  r.items = (r.items || []).map(x => (x.detail === '__header__'
    ? { description: String(x.description || '').trim(), detail: '__header__', qty: 0, rate: 0 }
    : { description: String(x.description || '').trim(), detail: String(x.detail || '').trim() || null, qty: Number(x.qty) || 0, rate: Number(x.rate) || 0 }))
    .filter(x => x.description);
  r.price = round2(r.price);
  return write(() => (existing ? api.update('packages', existing.id, r) : api.insert('packages', r)));
}

// ---------- calendar ----------
/** Everything the calendar needs, in one go (owner only). */
export async function calendarData() {
  const [projects, tasks, invoices, installments, leads, customers, members] = await Promise.all([
    all('projects'), all('tasks'), all('invoices'), all('invoice_installments').catch(() => []), all('leads').catch(() => []), all('customers'), all('members')]);
  const types = state.settings.project_types || [];
  return { projects, tasks, invoices, installments, leads, customers, members, types };
}

// ---------- vendors / albums ----------
/** Mark expenses paid (vendor bills / album costs). */
export async function markPaid(ids) {
  return write(async () => { for (const id of ids) await api.update('expenses', id, { paid_status: 'paid' }); return ids.length; });
}
export async function studioData() {
  const [albums, vendors, expenses] = await Promise.all([all('album_orders').catch(() => []), all('vendors').catch(() => []), all('expenses')]);
  return { albums, vendors, expenses };
}

/**
 * create_company RPC: a completely separate company whose owner signs in with `ownerEmail`.
 * The caller gets no access to it. Server errors (e.g. Gmail already used) are passed through with a clearer message.
 */
export async function createCompany(name, ownerEmail) {
  const email = String(ownerEmail || '').trim().toLowerCase();
  try {
    const id = await api.rpc('create_company', { p_name: String(name || '').trim(), p_owner_email: email });
    logActivity(`New company “${String(name).trim()}” created for ${email}`, '☺');
    return id;
  } catch (e) {
    if (e?.code === '23505' || /duplicate|already|unique/i.test(e?.message || '')) {
      const x = new Error(`${email} is already used by a company. One Gmail can belong to only one company — use another Gmail for the new owner.`); x.code = e.code; throw x;
    }
    throw e;
  }
}

// ---------- company ----------
export async function saveCompany(patch) {
  return write(async () => { const c = await api.updateCompany(patch); setCompany(c); return c; });
}
export async function refreshLogo() {
  state.logoUrl = state.company?.logo_path ? await api.logoUrl(state.company.logo_path) : null;
  return state.logoUrl;
}

// ---------- lookups ----------
export async function lookups() {
  const [customers, projects, invoices] = await Promise.all([all('customers'), all('projects'), all('invoices')]);
  const cMap = new Map(customers.map(c => [c.id, c]));
  const pMap = new Map(projects.map(p => [p.id, p]));
  const iMap = new Map(invoices.map(i => [i.id, i]));
  return { customers, projects, invoices, cMap, pMap, iMap, cname: id => cMap.get(id)?.name || '—' };
}
