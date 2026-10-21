// In-memory demo backend (?demo=1). Same interface as api.js, no network.
// Emulates the server: doc numbers, totals, balance/status, receipts, overpay guard, FK rules, RPCs.
// All seed data is FAKE (generic names, +91 90000 0000x numbers, example.com emails).
import { todayIST, addDays, addMonths, round2, uuid } from './util.js';
import { DEFAULT_PROJECT_TYPES } from './config.js';

const T = {}; // table name -> array of rows
const TABLES = ['companies', 'members', 'customers', 'leads', 'packages', 'projects', 'quotations', 'quotation_items',
  'invoices', 'invoice_items', 'invoice_installments', 'payments', 'receipts', 'vendors', 'album_orders', 'expenses',
  'tasks', 'payouts', 'activities'];
TABLES.forEach(t => (T[t] = []));
const counters = { invoice: 0, quotation: 0, receipt: 0 };
const logos = {}; // path -> object URL
let CID = null;
let role = 'owner';

const clone = x => (x == null ? x : structuredClone(x));
const nowTs = () => new Date().toISOString();
function err(msg, code) { const e = new Error(msg); e.code = code; return e; }

function company() { return T.companies[0]; }
let meId = null; // the signed-in member (owner or employee)
const selfId = () => meId;
/** unique index on lower(email) across all companies: one Gmail = one company. */
function uniqueEmail(email, exceptId) {
  if (T.members.some(m => m.id !== exceptId && String(m.email).toLowerCase() === email))
    throw err('duplicate key value violates unique constraint "members_email_lower_key"', '23505');
}
/** Row-level security emulation (what each role may SELECT). */
function visible(table, rows) {
  // Company isolation: a member only ever sees rows of their own company (create_company makes others).
  rows = table === 'companies' ? rows.filter(r => r.id === CID) : rows.filter(r => !r.company_id || r.company_id === CID);
  if (role !== 'employee') return rows;
  if (table === 'tasks' || table === 'payouts') return rows.filter(r => r.member_id === meId);
  if (table === 'members') return rows.filter(r => r.id === meId);
  if (table === 'companies') return rows.filter(r => r.id === CID);
  return [];
}
/** Write permissions: employees may only update the status of their own tasks (checked in rawUpdate). */
function canWrite(table, op) {
  if (role !== 'employee') return;
  if (table === 'tasks' && op === 'update') return;
  throw err('new row violates row-level security policy for table "' + table + '"', '42501');
}
function nextNumber(type) {
  const s = company().settings || {};
  const prefix = (s[type + '_prefix'] || '').trim() || { invoice: 'INV', quotation: 'QT', receipt: 'RC' }[type];
  counters[type] += 1;
  return `${prefix}-${String(counters[type]).padStart(4, '0')}`;
}

// ---------- trigger emulation ----------
function computeInvoice(inv, isInsert) {
  const sub = isInsert ? 0 : round2(T.invoice_items.filter(i => i.invoice_id === inv.id).reduce((s, i) => s + i.amount, 0));
  const paid = isInsert ? 0 : round2(T.payments.filter(p => p.invoice_id === inv.id).reduce((s, p) => s + Number(p.amount), 0));
  const disc = Math.min(Math.max(Number(inv.discount_amount) || 0, 0), sub);
  inv.subtotal = sub; inv.discount_amount = disc;
  inv.tax_amount = round2((sub - disc) * (Number(inv.tax_percent) || 0) / 100);
  inv.total = round2(sub - disc + inv.tax_amount);
  inv.paid_amount = paid; inv.balance = round2(inv.total - paid);
  inv.status = inv.total > 0 && inv.balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
}
function computeQuote(q, isInsert) {
  const sub = isInsert ? 0 : round2(T.quotation_items.filter(i => i.quotation_id === q.id).reduce((s, i) => s + i.amount, 0));
  const disc = Math.min(Math.max(Number(q.discount_amount) || 0, 0), sub);
  q.subtotal = sub; q.discount_amount = disc;
  q.tax_amount = round2((sub - disc) * (Number(q.tax_percent) || 0) / 100);
  q.total = round2(sub - disc + q.tax_amount);
}
function touchInvoice(id) { const inv = T.invoices.find(x => x.id === id); if (inv) { computeInvoice(inv, false); inv.updated_at = nowTs(); } }
function touchQuote(id) { const q = T.quotations.find(x => x.id === id); if (q) { computeQuote(q, false); q.updated_at = nowTs(); } }

const DEFAULTS = {
  invoices: () => ({ invoice_date: todayIST(), discount_amount: 0, tax_percent: 0, recurring: false, recurring_active: false, notes: null, terms: null, party_name: null }),
  quotations: () => ({ quote_date: todayIST(), status: 'draft', discount_amount: 0, tax_percent: 0, party_name: null }),
  projects: () => ({ status: 'booked', stage: 'booking', value: 0 }),
  payments: () => ({ payment_date: todayIST(), mode: 'Cash' }),
  expenses: () => ({ expense_date: todayIST(), category: 'Other', paid_status: 'paid' }),
  tasks: () => ({ status: 'assigned', amount: 0 }),
  leads: () => ({ status: 'new', customer_id: null }),
  packages: () => ({ active: true, price: 0, items: [] }),
  vendors: () => ({ kind: 'Other', rates: [] }),
  album_orders: () => ({ stage: 'design', price: 0 }),
  invoice_items: () => ({ sort: 0, qty: 1, rate: 0 }),
  quotation_items: () => ({ sort: 0, qty: 1, rate: 0 }),
  invoice_installments: () => ({ sort: 0, amount: 0 }),
};
const COMPUTED = {
  invoices: ['subtotal', 'tax_amount', 'total', 'paid_amount', 'balance', 'status'],
  quotations: ['subtotal', 'tax_amount', 'total'],
  invoice_items: ['amount'], quotation_items: ['amount'],
};

function rawInsert(table, row) {
  if (!T[table]) throw err(`Unknown table ${table}`);
  const r = { ...(DEFAULTS[table]?.() || {}), ...clone(row) };
  for (const c of COMPUTED[table] || []) delete r[c];
  r.id = r.id || uuid(); r.company_id = r.company_id || CID;
  r.created_at = r.created_at || nowTs(); r.updated_at = r.created_at;
  if (table === 'invoices') { if (!r.number || !String(r.number).trim()) r.number = nextNumber('invoice'); computeInvoice(r, true); }
  if (table === 'quotations') { if (!r.number || !String(r.number).trim()) r.number = nextNumber('quotation'); computeQuote(r, true); }
  if (table === 'invoice_items' || table === 'quotation_items') r.amount = round2((Number(r.qty) || 0) * (Number(r.rate) || 0));
  if (table === 'payments') {
    if (!(Number(r.amount) > 0)) throw err('new row for relation "payments" violates check constraint (amount must be more than 0)', '23514');
    const inv = T.invoices.find(i => i.id === r.invoice_id);
    if (!inv) throw err('Invoice not found', 'P0001');
    r.customer_id = inv.customer_id;
    const other = T.payments.filter(p => p.invoice_id === r.invoice_id && p.id !== r.id).reduce((s, p) => s + Number(p.amount), 0);
    if (other + Number(r.amount) > inv.total + 0.009) throw err(`Payment is more than the balance due (balance: ${round2(inv.total - other)})`, 'P0001');
  }
  if (table === 'receipts' && (!r.number || !String(r.number).trim())) r.number = nextNumber('receipt');
  if (table === 'members') {
    r.email = String(r.email || '').trim().toLowerCase();
    if (!r.email) throw err('null value in column "email" violates not-null constraint', '23502');
    uniqueEmail(r.email, null);
  }
  if (table === 'payouts' && !(Number(r.amount) > 0)) throw err('new row for relation "payouts" violates check constraint (amount must be more than 0)', '23514');
  if (table === 'tasks' && r.status === 'done' && !r.done_at) r.done_at = nowTs();
  T[table].push(r);
  if (table === 'invoice_items') touchInvoice(r.invoice_id);
  if (table === 'quotation_items') touchQuote(r.quotation_id);
  if (table === 'payments') {
    rawInsert('receipts', { company_id: r.company_id, payment_id: r.id, invoice_id: r.invoice_id, customer_id: r.customer_id, receipt_date: r.payment_date, amount: r.amount, mode: r.mode, notes: r.notes ?? null });
    touchInvoice(r.invoice_id);
  }
  return r;
}

function rawUpdate(table, id, patch) {
  const r = T[table].find(x => x.id === id);
  if (!r) throw err('Record not found (it may have been deleted).', 'PGRST116');
  const p = clone(patch);
  for (const c of COMPUTED[table] || []) delete p[c];
  delete p.id; delete p.company_id;
  if (table === 'payments') {
    const inv = T.invoices.find(i => i.id === (p.invoice_id || r.invoice_id));
    const other = T.payments.filter(x => x.invoice_id === inv.id && x.id !== id).reduce((s, x) => s + Number(x.amount), 0);
    const amt = Number(p.amount ?? r.amount);
    if (other + amt > inv.total + 0.009) throw err(`Payment is more than the balance due (balance: ${round2(inv.total - other)})`, 'P0001');
  }
  if (table === 'tasks' && role === 'employee') {
    const keys = Object.keys(p).filter(k => k !== 'status' && !(k in r && JSON.stringify(r[k]) === JSON.stringify(p[k])));
    if (r.member_id !== meId || keys.length || !['in_progress', 'done'].includes(p.status)) throw err('Employees can only change the status of their own tasks (to In progress or Done).', 'P0001');
  }
  if (table === 'tasks' && 'status' in p && p.status !== r.status) p.done_at = p.status === 'done' ? nowTs() : null; // trigger
  if (table === 'payouts' && 'amount' in p && !(Number(p.amount) > 0)) throw err('new row for relation "payouts" violates check constraint (amount must be more than 0)', '23514');
  if (table === 'members') {
    if ('email' in p) { p.email = String(p.email || '').trim().toLowerCase(); uniqueEmail(p.email, id); }
    if (id === selfId()) {
      for (const k of ['role', 'email', 'active']) if (k in p && p[k] !== r[k]) throw err('You cannot change your own role, email or active status.', 'P0001');
    }
  }
  Object.assign(r, p, { updated_at: nowTs() });
  if (table === 'invoices') computeInvoice(r, false);
  if (table === 'quotations') computeQuote(r, false);
  if (table === 'invoice_items' || table === 'quotation_items') {
    r.amount = round2((Number(r.qty) || 0) * (Number(r.rate) || 0));
    table === 'invoice_items' ? touchInvoice(r.invoice_id) : touchQuote(r.quotation_id);
  }
  if (table === 'payments') {
    const rc = T.receipts.find(x => x.payment_id === r.id);
    if (rc) Object.assign(rc, { invoice_id: r.invoice_id, customer_id: r.customer_id, receipt_date: r.payment_date, amount: r.amount, mode: r.mode, notes: r.notes, updated_at: nowTs() });
    touchInvoice(r.invoice_id);
  }
  return r;
}

function setNull(table, col, id) { for (const r of T[table]) if (r[col] === id) r[col] = null; }
function rawDelete(table, id) {
  const r = T[table].find(x => x.id === id);
  if (!r) return;
  // FK rules (mirrors the database)
  if (table === 'customers') {
    if (T.projects.some(p => p.customer_id === id) || T.invoices.some(i => i.customer_id === id))
      throw err('This record is still used elsewhere (for example by projects, invoices or payments). Remove those first.', '23503');
    ['leads', 'quotations', 'payments', 'receipts', 'album_orders'].forEach(t => setNull(t, 'customer_id', id));
  }
  if (table === 'projects') ['quotations', 'invoices', 'album_orders', 'expenses', 'tasks'].forEach(t => setNull(t, 'project_id', id));
  if (table === 'quotations') { T.quotation_items = T.quotation_items.filter(i => i.quotation_id !== id); setNull('invoices', 'quotation_id', id); }
  if (table === 'invoices') {
    T.invoice_items = T.invoice_items.filter(i => i.invoice_id !== id);
    T.invoice_installments = T.invoice_installments.filter(i => i.invoice_id !== id);
    const pays = T.payments.filter(p => p.invoice_id === id).map(p => p.id);
    T.receipts = T.receipts.filter(x => x.invoice_id !== id && !pays.includes(x.payment_id));
    T.payments = T.payments.filter(p => p.invoice_id !== id);
    setNull('invoices', 'source_invoice_id', id); setNull('quotations', 'converted_invoice_id', id); setNull('album_orders', 'invoice_id', id);
  }
  if (table === 'payments') T.receipts = T.receipts.filter(x => x.payment_id !== id);
  if (table === 'members') {
    if (id === selfId()) throw err('You cannot delete yourself.', 'P0001');
    if (T.tasks.some(t => t.member_id === id) || T.payouts.some(p => p.member_id === id))
      throw err('update or delete on table "members" violates foreign key constraint on table "tasks"', '23503');
  }
  if (table === 'tasks') setNull('payouts', 'task_id', id);
  if (table === 'vendors') setNull('expenses', 'vendor_id', id);
  if (table === 'album_orders') setNull('expenses', 'album_order_id', id);
  T[table] = T[table].filter(x => x.id !== id);
  if (table === 'invoice_items') touchInvoice(r.invoice_id);
  if (table === 'quotation_items') touchQuote(r.quotation_id);
  if (table === 'payments') touchInvoice(r.invoice_id);
}

// ---------- RPCs ----------
function rpcGenerateRecurring() {
  if (role !== 'owner') throw err('Only the owner can do this', 'P0001');
  const today = todayIST(); let count = 0;
  for (const src of T.invoices.filter(i => i.recurring && i.recurring_active && i.recurring_next && i.recurring_next <= today)) {
    let next = src.recurring_next; const day = Number(src.invoice_date.slice(8, 10)); let guard = 0;
    while (next <= today && guard++ < 24) {
      if (!T.invoices.some(i => i.source_invoice_id === src.id && i.invoice_date === next)) {
        const inv = rawInsert('invoices', { customer_id: src.customer_id, project_id: src.project_id, invoice_date: next, due_date: addDays(next, 15), discount_amount: src.discount_amount, tax_percent: src.tax_percent, notes: src.notes, terms: src.terms, source_invoice_id: src.id });
        T.invoice_items.filter(i => i.invoice_id === src.id).forEach(i => rawInsert('invoice_items', { invoice_id: inv.id, sort: i.sort, description: i.description, detail: i.detail, sac: i.sac, qty: i.qty, rate: i.rate }));
        count++;
      }
      next = addMonths(next, 1, day);
    }
    rawUpdate('invoices', src.id, { recurring_next: next, recurring_last: today });
  }
  return count;
}
function rpcConvert({ p_quotation }) {
  const q = T.quotations.find(x => x.id === p_quotation);
  if (!q) throw err('Quotation not found', 'P0001');
  if (!q.customer_id) throw err('Add a customer to the quotation first', 'P0001');
  if (q.converted_invoice_id) return q.converted_invoice_id;
  const inv = rawInsert('invoices', { customer_id: q.customer_id, project_id: q.project_id, quotation_id: q.id, due_date: addDays(todayIST(), 15), discount_amount: q.discount_amount, tax_percent: q.tax_percent, notes: q.notes, terms: q.terms });
  T.quotation_items.filter(i => i.quotation_id === q.id).forEach(i => rawInsert('invoice_items', { invoice_id: inv.id, sort: i.sort, description: i.description, detail: i.detail, sac: i.sac, qty: i.qty, rate: i.rate }));
  touchInvoice(inv.id);
  rawUpdate('quotations', q.id, { status: 'accepted', converted_invoice_id: inv.id });
  return inv.id;
}

/**
 * create_company(p_name, p_owner_email) → uuid. Owner only. Creates a separate company + its owner member.
 * The caller gets NO access to it (RLS: they are not a member of the new company). One Gmail = one company.
 */
function rpcCreateCompany({ p_name, p_owner_email } = {}) {
  if (role !== 'owner') throw err('Only an owner can create a company', '42501');
  const name = String(p_name || '').trim(); const email = String(p_owner_email || '').trim().toLowerCase();
  if (!name) throw err('Company name is required', 'P0001');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err('Owner email is invalid', 'P0001');
  uniqueEmail(email, null);
  const id = uuid(); const ts = nowTs();
  T.companies.push({ id, name, logo_path: null, settings: { currency: '₹', gst_enabled: false, invoice_prefix: 'INV', quotation_prefix: 'QT', receipt_prefix: 'RC', project_types: DEFAULT_PROJECT_TYPES.slice() }, created_at: ts, updated_at: ts });
  T.members.push({ id: uuid(), company_id: id, email, role: 'owner', display_name: null, phone: null, job_title: 'Owner', active: true, google_calendar_sync: false, created_at: ts, updated_at: ts });
  return id;
}

// ---------- seed ----------
function seed() {
  const today = todayIST();
  const d = n => addDays(today, n);
  const co = rawInsert('companies', {
    id: 'demo-company', name: 'Demo Studio', logo_path: null, settings: {
      gst_enabled: true, gst_number: '27AAAAA0000A1Z5', pan: 'AAAAA0000A',
      address: 'Studio address line, City, State – 400001', mobile: '+91 90000 00000', whatsapp: '+91 90000 00000',
      email: 'studio@example.com', website: 'www.example.com',
      bank_name: 'Example Bank', account_holder: 'Demo Studio', account_number: '000000000000', ifsc: 'EXMP0000001', upi: 'demostudio@upi',
      default_tax_percent: 18, currency: '₹', invoice_prefix: 'INV', quotation_prefix: 'QT', receipt_prefix: 'RC',
      project_types: DEFAULT_PROJECT_TYPES.slice(),
      quick_items: [
        { desc: 'Traditional Photography', rate: 12000 }, { desc: 'Candid Photography', rate: 15000 },
        { desc: 'Cinematic Videography', rate: 25000 }, { desc: 'Drone Coverage', rate: 8000 },
        { desc: 'Premium Album (40 sheets)', rate: 12000 }, { desc: 'Pen Drive + Online Gallery', rate: 2000 },
      ],
      terms: 'The advance confirms your dates and is non-refundable.\nFinal photos, films and albums are released after full payment.\nRaw data is archived for 90 days after delivery.',
      album_module: true,
    },
  });
  CID = co.id; co.company_id = undefined; delete co.company_id;

  const ago = n => new Date(Date.now() - n * 864e5).toISOString();
  rawInsert('members', { id: 'demo-owner', email: 'owner@example.com', role: 'owner', display_name: 'Admin', phone: '+91 90000 00000', job_title: 'Owner', active: true, created_at: ago(300) });
  const EMP = [
    ['demo-emp-1', 'emp1@example.com', 'Photographer 1', '+91 90000 00011', 'Candid Photographer'],
    ['demo-emp-2', 'emp2@example.com', 'Videographer 1', '+91 90000 00012', 'Cinematographer'],
    ['demo-emp-3', 'emp3@example.com', 'Drone Operator 1', '+91 90000 00013', 'Drone Operator'],
    ['demo-emp-4', 'emp4@example.com', 'Editor 1', '+91 90000 00014', 'Album Designer'],
  ].map(([id, email, display_name, phone, job_title], i) => rawInsert('members', { id, email, role: 'employee', display_name, phone, job_title, active: true, google_calendar_sync: false, created_at: ago(250 - i * 30) }));

  const letters = 'ABCDEFGH'.split('');
  const cust = letters.map((L, i) => rawInsert('customers', {
    id: i === 0 ? 'demo-customer-a' : undefined,
    name: `Customer ${L}`, mobile: `+91 90000 0000${i + 1}`, whatsapp: `+91 90000 0000${i + 1}`,
    email: `customer.${L.toLowerCase()}@example.com`, city: ['City One', 'City Two', 'City Three'][i % 3],
    address: `Address line ${i + 1}, City`, notes: '', created_at: new Date(Date.now() - (200 - i * 20) * 864e5).toISOString(),
  }));
  // Occasions: month-day relative to today (leap base years so 29 Feb stays valid). A few fall in the next 14 days.
  const md = n => d(n).slice(5);
  [[0, 'birthday', `1992-${md(3)}`], [1, 'anniversary', `2016-${md(9)}`], [3, 'birthday', `1988-${md(12)}`], [5, 'anniversary', `2020-${md(1)}`],
    [4, 'birthday', `1996-${md(40)}`], [6, 'anniversary', `2012-${md(-30)}`], [2, 'birthday', `1990-${md(25)}`]]
    .forEach(([i, k, v]) => { cust[i][k] = v; });

  const P = [
    ['Wedding – Haldi & Sangeet', 0, 'Wedding Photography', 'shoot', 'In Progress', -40, 3, 5, 45, 'Venue A, City', 150000],
    ['Pre-Wedding Shoot', 1, 'Pre Wedding', 'booking', 'Booked', -10, 6, 6, 30, 'Outdoor location', 35000],
    ['Album Delivery – Engagement', 2, 'Album Designing', 'album', 'In Progress', -60, -30, -30, 5, 'Venue B, City', 52000],
    ['Corporate Event', 3, 'Custom Project', 'booking', 'Booked', -5, 10, 10, 25, 'Convention hall, City', 60000],
    ['Maternity Shoot', 4, 'Maternity', 'delivered', 'Completed', -80, -50, -50, -20, 'Studio', 18000],
    ['Engagement Film', 5, 'Engagement', 'editing', 'In Progress', -45, -12, -12, 12, 'Venue C, City', 65000],
    ['Birthday Party', 6, 'Birthday', 'booking', 'Booked', -3, 10, 10, 20, 'Banquet hall, City', 25000], // same day as the corporate event → conflict
  ].map(([name, c, type, stage, status, bk, ev, evEnd, dl, venue, value], i) => rawInsert('projects', {
    id: i === 0 ? 'demo-project-1' : undefined, customer_id: cust[c].id, name, type, stage, status, booking_date: d(bk), event_date: d(ev), event_end_date: d(evEnd), delivery_date: d(dl), venue, value, notes: '',
  }));

  const QI = (desc, detail, qty, rate) => ({ description: desc, detail, sac: '998386', qty, rate });
  const HD = title => ({ description: title, detail: '__header__', sac: null, qty: 0, rate: 0 }); // section header row

  rawInsert('packages', { id: 'demo-package-1', name: 'Wedding Gold', description: 'Two-day wedding coverage', active: true, price: 69000, items: [
    { description: 'Day 1 · Haldi', detail: '__header__', qty: 0, rate: 0 },
    { description: 'Traditional Photography', detail: 'Full ceremony', qty: 1, rate: 12000 },
    { description: 'Candid Photography', detail: '2 photographers', qty: 1, rate: 15000 },
    { description: 'Day 2 · Wedding', detail: '__header__', qty: 0, rate: 0 },
    { description: 'Cinematic Videography', detail: 'Highlight film', qty: 1, rate: 25000 },
    { description: 'Drone Coverage', detail: 'Baraat', qty: 1, rate: 8000 },
    { description: 'Premium Album (40 sheets)', detail: '12×36', qty: 1, rate: 12000 },
  ] });
  rawInsert('packages', { id: 'demo-package-2', name: 'Pre-Wedding Basic', description: 'One day, two locations', active: true, price: 32000, items: [
    { description: 'Pre-Wedding Shoot', detail: '1 day · 2 locations', qty: 1, rate: 30000 },
    { description: 'Pen Drive + Online Gallery', detail: '64 GB · 1 year', qty: 1, rate: 2000 },
  ] });
  rawInsert('packages', { name: 'Birthday Classic', description: '4-hour party coverage', active: true, price: 21000, items: [
    { description: 'Coverage', detail: '__header__', qty: 0, rate: 0 },
    { description: 'Traditional Photography', detail: '4 hours', qty: 1, rate: 8000 },
    { description: 'Traditional Videography', detail: '4 hours', qty: 1, rate: 9000 },
    { description: 'Deliverables', detail: '__header__', qty: 0, rate: 0 },
    { description: 'Photo Frames', detail: '16×24 canvas', qty: 2, rate: 1500 },
    { description: 'Pen Drive + Online Gallery', detail: '64 GB · 1 year', qty: 1, rate: 2000 },
  ] });

  // Leads across the pipeline: [name, mobile#, event type, event day, source, budget, status, created days ago, notes]
  const LD = [
    ['Lead A', 1, 'Wedding Photography', 75, 'Instagram', 180000, 'new', 0, 'Saw the reel of the haldi film. Wants candid + cinematic.'],
    ['Lead B', 2, 'Pre Wedding', 21, 'Referral', 40000, 'new', 1, 'Referred by Customer A.'],
    ['Lead C', 3, 'Birthday', 12, 'WhatsApp', 20000, 'new', 2, ''],
    ['Lead D', 4, 'Engagement', 30, 'Google', 60000, 'contacted', 4, 'Called once, asked for packages.'],
    ['Lead E', 5, 'Maternity', 18, 'Facebook', 15000, 'contacted', 6, ''],
    ['Lead F', 6, 'Wedding Photography', 95, 'Website', 250000, 'quote_sent', 9, 'Quotation shared on WhatsApp. Follow up.'],
    ['Lead G', 7, 'Newborn', 8, 'Walk-in', 12000, 'quote_sent', 2, ''],
    ['Lead H', 8, 'Wedding Photography', 40, 'Instagram', 150000, 'won', 20, 'Booked after the studio visit.'],
    ['Lead I', 9, 'Custom Project', 50, 'Other', 30000, 'lost', 30, 'Went with a cheaper option.'],
    ['Lead J', 10, 'Engagement', 5, 'Referral', 55000, 'contacted', 12, 'Prefers evening shoot.'],
  ];
  LD.forEach(([name, n, event_type, ev, source, budget, status, ago_, notes], i) => rawInsert('leads', {
    id: i === 5 ? 'demo-lead-f' : i === 0 ? 'demo-lead-a' : undefined,
    name, mobile: `+91 90000 001${String(n).padStart(2, '0')}`, email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
    event_type, event_date: d(ev), source, budget, status, notes, customer_id: status === 'won' ? cust[7].id : null, created_at: ago(ago_),
  }));
  // [customer, project|null, daysAgo, items, discount, payments [[daysAgo, fraction|'full', mode]], installments?]
  const INV = [
    [4, 4, 165, [QI('Maternity Shoot', 'Studio · 2 hrs', 1, 12000), QI('Edited Photos', '40 images', 1, 3000)], 0, [[160, 'full', 'UPI']]],
    [6, null, 150, [QI('Product Photography', '20 products', 1, 20000)], 1000, [[140, 'full', 'Bank Transfer']]],
    [7, null, 130, [QI('Birthday Event Coverage', '4 hrs', 1, 18000), QI('Photo Frames', '16×24 canvas', 2, 1500)], 0, [[125, 0.5, 'Cash'], [95, 'full', 'UPI']]],
    [2, 2, 120, [QI('Engagement Photography', 'Day 1', 1, 15000), QI('Premium Album (40 sheets)', '12×36', 1, 12000)], 2000, [[118, 0.4, 'UPI'], [60, 'full', 'UPI']]],
    [0, 0, 100, [QI('Wedding Photography Advance Package', 'Booking', 1, 50000)], 0, [[98, 'full', 'Bank Transfer']]],
    [6, null, 90, [QI('Social Media Content', 'Monthly reels + posts', 1, 15000)], 0, [[85, 'full', 'UPI']]],
    [1, 1, 75, [QI('Pre-Wedding Shoot', '1 day · 2 locations', 1, 35000)], 0, [[70, 0.3, 'UPI']]],
    [5, 5, 60, [QI('Engagement Film', '4K · highlight', 1, 45000), QI('Drone Coverage', 'Ceremony', 1, 8000), QI('Pen Drive + Online Gallery', '64 GB · 1 year', 1, 2000)], 0, [[58, 0.3, 'UPI'], [20, 0.3, 'Cash']]],
    [3, 3, 45, [QI('Corporate Event Photography', 'Full day', 1, 30000), QI('Cinematic Videography', 'Full day', 1, 25000)], 5000, [[40, 0.5, 'Bank Transfer']]],
    [7, null, 35, [QI('Passport Photos', '8 copies', 1, 400)], 0, []],
    [2, 2, 25, [QI('Album Printing', 'Lay-flat 12×36', 1, 9000), QI('Leather Album Box', 'Custom embossing', 1, 3500)], 0, [[22, 'full', 'UPI']]],
    [4, null, 18, [QI('Newborn Shoot', 'Home session', 1, 14000)], 0, [[12, 0.5, 'UPI']]],
    [0, 0, 8, [HD('Day 1 · Haldi'), QI('Traditional Photography', 'Full ceremony', 1, 12000), QI('Candid Photography', '2 photographers', 1, 15000), QI('Traditional Videography', 'Full ceremony', 1, 12000), HD('Day 2 · Sangeet & Wedding'), QI('Cinematic Videography', 'Highlight film', 1, 20000), QI('Drone Coverage', 'Baraat + reception', 2, 8000), HD('Album & delivery'), QI('Premium Lay-flat Album', '40 sheets · 12×36', 2, 12000)], 9000, [[6, 0.3, 'Bank Transfer'], [2, 0.15, 'UPI']], true],
    [1, null, 3, [QI('Photo Restoration', '5 old photos', 5, 800)], 0, []],
  ];
  // Per-document party / bride & groom names (fake) for a few invoices, keyed by INV index.
  const INV_PARTY = { 0: 'Riya & Family', 2: 'Aarav · 1st Birthday', 3: 'Isha & Rohan', 4: 'Sadique & Afsha', 7: 'Neha & Arjun', 8: 'Acme Corp Pvt Ltd', 10: 'Priya & Karan', 12: 'Sadique & Afsha' };
  let src = null;
  INV.forEach(([c, p, ago, items, disc, pays, withInst], idx) => {
    const date = d(-ago);
    const inv = rawInsert('invoices', { id: withInst ? 'demo-invoice-13' : undefined, customer_id: cust[c].id, project_id: p == null ? null : P[p].id, invoice_date: date, due_date: addDays(date, 15), tax_percent: 18, discount_amount: disc, party_name: INV_PARTY[idx] || null, notes: idx === 12 ? 'Album selection link will be shared after the event.' : null, terms: co.settings.terms });
    items.forEach((it, i) => rawInsert('invoice_items', { invoice_id: inv.id, sort: i, ...it }));
    rawUpdate('invoices', inv.id, { discount_amount: disc });
    const total = T.invoices.find(x => x.id === inv.id).total;
    if (withInst) {
      [['Advance', 30, 0, 'On booking'], ['Shoot day', 30, 3, 'On the event day'], ['On delivery', 40, 45, 'Before album delivery']].forEach(([label, pct, dd, note], i) =>
        rawInsert('invoice_installments', { invoice_id: inv.id, sort: i, label, percent: pct, amount: round2(total * pct / 100), due_date: d(dd), due_note: note }));
    }
    let paid = 0;
    for (const [pago, f, mode] of pays) {
      const amt = f === 'full' ? round2(total - paid) : Math.round(total * f);
      if (amt <= 0) continue;
      rawInsert('payments', { invoice_id: inv.id, payment_date: d(-pago), amount: amt, mode, notes: f === 'full' ? 'Final payment' : 'Part payment' });
      paid += amt;
    }
    if (idx === 5) src = inv;
  });
  // Monthly retainer (recurring source)
  if (src) rawUpdate('invoices', src.id, { recurring: true, recurring_active: true, recurring_next: addDays(today, 10) });

  const q = rawInsert('quotations', { id: 'demo-quote-1', customer_id: cust[7].id, quote_date: d(-2), valid_until: d(13), status: 'sent', tax_percent: 18, discount_amount: 0, party_name: 'Sana & Imran', notes: 'Includes two photographers and one videographer.', terms: co.settings.terms });
  [QI('Traditional Photography', 'Reception', 1, 12000), QI('Candid Photography', 'Reception', 1, 15000), QI('Cinematic Videography', 'Highlight film', 1, 25000), QI('Premium Album (40 sheets)', '12×36', 1, 12000)]
    .forEach((it, i) => rawInsert('quotation_items', { quotation_id: q.id, sort: i, ...it }));
  rawUpdate('quotations', q.id, { discount_amount: 4000 });

  // Vendors with rate cards
  const V = [
    ['demo-vendor-lab', 'Print Lab A', 'Print lab', '+91 90000 00201', 'Lay-flat printing. 5-day turnaround.', [['Lay-flat print 12×36', 'sheet', 180], ['Lay-flat print 12×30', 'sheet', 150], ['Lay-flat print 10×30', 'sheet', 130], ['Metallic print 12×24', 'sheet', 160], ['Lustre upgrade', 'sheet', 20]]],
    ['demo-vendor-box', 'Album Box Co', 'Album box', '+91 90000 00202', 'Custom embossing takes 3 days.', [['Leather box', 'box', 2200], ['Wooden box', 'box', 1600], ['Carry bag', 'piece', 450]]],
    ['demo-vendor-lam', 'Lamination Works', 'Lamination', '+91 90000 00203', '', [['Matte lamination', 'sheet', 25], ['Glossy lamination', 'sheet', 20]]],
    ['demo-vendor-courier', 'Courier Express', 'Courier', '+91 90000 00204', 'Pickup from studio before 5 pm.', [['Local parcel', 'parcel', 150], ['Outstation parcel', 'parcel', 450]]],
  ].map(([id, name, kind, phone, notes, rates], i) => rawInsert('vendors', { id, name, kind, phone, notes: notes || null, rates: rates.map(([item, unit, rate]) => ({ item, unit, rate })), created_at: ago(200 - i * 10) }));
  const [vLab, vBox, vLam, vCourier] = V.map(v => v.id);

  [[150, 'Printing', 'Album prints', 6500, vLab], [120, 'Travel', 'Outstation shoot travel', 4200], [95, 'Equipment', 'Lens service', 3800],
    [70, 'Lamination', 'Photo lamination', 1800, vLam], [55, 'Courier', 'Album courier', 600, vCourier], [40, 'Designer', 'Album design (freelance)', 7000],
    [28, 'Album Box', 'Leather boxes ×2', 4400, vBox], [15, 'Staff', 'Assistant payout', 5000], [9, 'Paper', 'Matte paper rolls', 2600], [3, 'Office', 'Internet bill', 1200]]
    .forEach(([ago, category, description, amount, vendor_id], i) => rawInsert('expenses', { expense_date: d(-ago), category, description, amount, qty: 1, unit_rate: amount, paid_status: i === 9 ? 'unpaid' : 'paid', vendor_id: vendor_id || null }));

  // Album orders across all stages + their job costs (expenses linked by album_order_id).
  // [id, customer, project, title, sheets, size, paper, price, stage, due day, created days ago, notes, costs [[category, vendor, description, qty, rate, paid, day]]]
  const albumInv = T.invoices.find(i => i.project_id === P[2].id && T.invoice_items.some(it => it.invoice_id === i.id && it.description === 'Album Printing'));
  const AL = [
    ['demo-album-1', 2, 2, 'Engagement Album', 40, '12×36', 'Lustre', 12500, 'delivered', -20, 50, 'Delivered with leather box.', [
      ['Printing', vLab, 'Lay-flat print 12×36', 40, 180, 'paid', -35], ['Lamination', vLam, 'Matte lamination', 40, 25, 'paid', -33], ['Album Box', vBox, 'Leather box', 1, 2200, 'paid', -30], ['Courier', vCourier, 'Local parcel', 1, 150, 'paid', -21]]],
    ['demo-album-2', 0, 0, 'Wedding Album – Customer A', 50, '12×36', 'Glossy', 24000, 'design', 40, 4, 'Two-day wedding. Couple wants candid-heavy layout.', [
      ['Designer', null, 'Layout design (freelance)', 1, 6000, 'unpaid', -2]]],
    ['demo-album-3', 4, 4, 'Maternity Photobook', 20, '10×30', 'Matte', 6000, 'printed', -3, 30, '', [
      ['Printing', vLab, 'Lay-flat print 10×30', 20, 130, 'unpaid', -8], ['Lamination', vLam, 'Matte lamination', 20, 25, 'unpaid', -7]]],
    ['demo-album-4', 5, 5, 'Engagement Film Album', 30, '12×30', 'NT', 15000, 'approval', 5, 14, 'Sent the design PDF for approval on WhatsApp.', [
      ['Designer', null, 'Album design', 1, 3500, 'paid', -6]]],
    ['demo-album-5', 1, 1, 'Pre-Wedding Mini Album', 15, '12×24', 'Metallic', 7000, 'sent_to_print', 9, 10, '', [
      ['Printing', vLab, 'Metallic print 12×24', 15, 160, 'unpaid', -1]]],
    ['demo-album-6', 2, 2, 'Parent Albums ×2', 30, '10×30', 'Glossy', 9000, 'binding', 2, 25, 'Two copies, 15 sheets each.', [
      ['Printing', vLab, 'Lay-flat print 10×30', 30, 130, 'paid', -12], ['Lamination', vLam, 'Glossy lamination', 30, 20, 'paid', -11], ['Album Box', vBox, 'Wooden box', 2, 1600, 'unpaid', -4]]],
  ];
  for (const [id, c, p, title, sheets, size, paper, price, stage, due, created, notes, costs] of AL) {
    const a = rawInsert('album_orders', { id, customer_id: cust[c].id, project_id: P[p].id, invoice_id: id === 'demo-album-1' ? albumInv?.id || null : null, title, sheets, size, paper, price, stage, due_date: d(due), notes: notes || null, created_at: ago(created) });
    for (const [category, vendor_id, description, qty, unit_rate, paid_status, day] of costs)
      rawInsert('expenses', { expense_date: d(day), category, description, qty, unit_rate, amount: round2(qty * unit_rate), paid_status, vendor_id, project_id: a.project_id, album_order_id: a.id });
  }

  // Crew assignments: [employee, project, title, day, endDay|null, amount, status, details]
  const TK = [
    [0, 0, 'Candid photography', 3, 5, 8000, 'assigned', 'Haldi, Sangeet and wedding day. Carry 2 bodies + 70-200.'],
    [0, 1, 'Candid photography (half day)', 6, null, 5000, 'assigned', 'Golden-hour session, two locations.'],
    [0, 3, 'Event photography', 10, null, 4000, 'assigned', ''],
    [0, 1, 'Location recce', 0, null, 1500, 'in_progress', 'Check both locations and light direction.'],
    [0, 5, 'Candid + portraits', -12, null, 7000, 'done', ''],
    [0, 2, 'Candid photography', -30, null, 6000, 'done', ''],
    [0, 4, 'Candid photography', -50, null, 4500, 'done', ''],
    [1, 0, 'Cinematic videography', 3, 5, 15000, 'assigned', 'Highlight film + full ceremony.'],
    [1, 5, 'Video editing', -5, 2, 3000, 'in_progress', 'Highlight edit, 4 minutes.'],
    [1, 5, 'Highlight film', -12, null, 9000, 'done', ''],
    [1, 4, 'Traditional videography', -50, null, 5000, 'done', ''],
    [1, 3, 'Traditional videography', 10, null, 6000, 'assigned', ''],
    [2, 0, 'Drone', 4, null, 6000, 'assigned', 'Baraat + venue aerials (permission arranged).'],
    [2, 5, 'Drone', -12, null, 4000, 'done', ''],
    [2, 3, 'Drone', 10, null, 3500, 'assigned', ''],
    [3, 2, 'Album design', -25, -20, 8000, 'done', '40 sheets, 12×36.'],
    [3, 4, 'Photo editing', -45, null, 3000, 'done', ''],
    [3, 5, 'Photo editing', -6, null, 4000, 'done', ''],
    [3, 0, 'Album design', 20, null, 9000, 'assigned', ''],
    [3, 1, 'Photo editing', -2, null, 2500, 'cancelled', 'Client postponed.'],
    [2, 6, 'Drone', 10, null, 3000, 'assigned', 'Party aerials (same day as the corporate event).'],
  ];
  const tasks = TK.map(([e, p, title, day, endDay, amount, status, details], i) => rawInsert('tasks', {
    id: i === 0 ? 'demo-task-1' : undefined, member_id: EMP[e].id, project_id: P[p].id, project_title: `${P[p].name} · ${P[p].type}`, title, details,
    work_date: d(day), end_date: endDay == null ? null : d(endDay), venue: P[p].venue, amount, status, created_at: ago(60 - i),
  }));
  [[0, -45, 4500, 'UPI', 'Maternity shoot', 6], [0, -10, 7000, 'UPI', 'Engagement film', 4], [1, -40, 5000, 'Cash', '', null], [1, -8, 6000, 'Bank Transfer', 'Part payment', null],
    [2, -5, 4000, 'UPI', 'Drone · engagement', 13], [3, -15, 8000, 'Bank Transfer', 'Album design', 15]]
    .forEach(([e, day, amount, mode, notes, ti]) => rawInsert('payouts', { member_id: EMP[e].id, task_id: ti == null ? null : tasks[ti].id, payout_date: d(day), amount, mode, notes: notes || null }));

  [['Invoice INV-0013 created for Customer A', '▤', 8], ['Payment ₹21,322 received from Customer A', '₹', 6], ['Quotation QT-0001 sent to Customer H', '✎', 2], ['Payment received from Customer A', '₹', 2], ['Project "Corporate Event" booked', '▣', 5]]
    .forEach(([text, icon, ago]) => rawInsert('activities', { text, icon, created_at: new Date(Date.now() - ago * 864e5).toISOString() }));
}

const api = {
  mode: 'demo',
  async init(opts = {}) {
    if (!T.companies.length) seed();
    role = opts.role === 'employee' ? 'employee' : 'owner';
    meId = role === 'employee' ? 'demo-emp-1' : 'demo-owner'; // ?role=employee signs in as "Photographer 1"
  },
  async getSession() {
    const m = T.members.find(x => x.id === meId);
    return { user: { id: 'demo-' + role, email: m.email, name: m.display_name, avatar: '' } };
  },
  /** Demo/self-test only: act as another member (emulates signing in with their Gmail). */
  demoAs(r, memberId) { const prev = { role, meId }; role = r; meId = memberId; return () => { role = prev.role; meId = prev.meId; }; },
  onAuthChange() { },
  async signInWithGoogle() { },
  async signOut() { location.href = location.pathname; },
  async loadMembership(email) {
    const member = T.members.find(m => m.email === email && m.active);
    const co = member && T.companies.find(c => c.id === (member.company_id || CID));
    return member && co ? { member: clone(member), company: clone(co) } : null;
  },
  companyId: () => CID,

  async list(table, { eq, order, asc = false } = {}) {
    let rows = visible(table, T[table] || []);
    if (eq) rows = rows.filter(r => Object.entries(eq).every(([k, v]) => (r[k] ?? null) === v));
    rows = rows.slice();
    if (order) rows.sort((a, b) => { const x = a[order] ?? '', y = b[order] ?? ''; return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
    return clone(rows);
  },
  async get(table, id) { return clone(visible(table, T[table] || []).find(r => r.id === id) || null); },
  async insert(table, row) { canWrite(table, 'insert'); return clone(rawInsert(table, row)); },
  async insertMany(table, rows) { canWrite(table, 'insert'); return rows.map(r => clone(rawInsert(table, r))); },
  async update(table, id, patch) {
    canWrite(table, 'update');
    if (!visible(table, T[table] || []).some(r => r.id === id)) throw err('Record not found (it may have been deleted).', 'PGRST116');
    return clone(rawUpdate(table, id, patch));
  },
  async remove(table, id) { canWrite(table, 'delete'); rawDelete(table, id); },
  async removeWhere(table, col, val) { canWrite(table, 'delete'); for (const r of T[table].filter(x => x[col] === val)) rawDelete(table, r.id); },
  async rpc(name, args) {
    if (name === 'generate_recurring_invoices') return rpcGenerateRecurring();
    if (name === 'convert_quotation_to_invoice') return rpcConvert(args);
    if (name === 'create_company') return rpcCreateCompany(args);
    throw err('Unknown function ' + name);
  },
  async updateCompany(patch) { canWrite('companies', 'update'); Object.assign(company(), clone(patch), { updated_at: nowTs() }); return clone(company()); },
  async uploadLogo(file) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${CID}/logo.${ext}`;
    if (logos[path]) URL.revokeObjectURL(logos[path]);
    logos[path] = URL.createObjectURL(file);
    return path;
  },
  async logoUrl(path) { return logos[path] || null; },
  async uploadPayQr(file) { return URL.createObjectURL(file); },
  async removePayQr() { /* demo: nothing to delete */ },
};

export default api;
