import { h, table, field, input, textarea, btn, iconBtn, searchBox, ic } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, insert, update, remove, getRow, logActivity, state } from '../store.js';
import { upcomingOccasions, wishText } from '../calcore.js';
import { money, fmtDate, sum, includesCI, debounce, initials } from '../util.js';
import { invStatus, projStatus, stageProgress, pageHead, quoteStatus, openRecord, dwSection, statRow } from './common.js';
import { sharePdf, ledgerText, openWhatsApp } from '../share.js';
const newInvoiceFor = cid => import('./invoices.js').then(m => m.openInvoiceEditor(null, { preset: { customer: cid } }));

const UI = { q: '', sort: { key: 'Name', dir: 1 } };

/** Add / edit customer modal. Resolves to the saved customer or null. */
export function openCustomerForm(existing = null, preset = {}) {
  const c = existing || preset || {};
  const f = {
    name: input({ value: c.name || '', autocomplete: 'off' }),
    mobile: input({ value: c.mobile || '', type: 'tel', inputmode: 'tel', placeholder: '+91 …' }),
    whatsapp: input({ value: c.whatsapp || '', type: 'tel', inputmode: 'tel', placeholder: 'Same as mobile if empty' }),
    email: input({ value: c.email || '', type: 'email', inputmode: 'email' }),
    city: input({ value: c.city || '' }),
    address: textarea({ value: c.address || '', rows: 2 }),
    birthday: input({ type: 'date', value: c.birthday || '' }),
    anniversary: input({ type: 'date', value: c.anniversary || '' }),
    notes: textarea({ value: c.notes || '', rows: 2 }),
  };
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  let m;
  const save = btn(existing ? 'Save changes' : 'Add customer', async () => {
    errBox.textContent = '';
    const row = Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value.trim() || null]));
    if (!row.name) { errBox.textContent = 'Name is required.'; f.name.focus(); return; }
    if (!row.mobile) { errBox.textContent = 'Mobile number is required.'; f.mobile.focus(); return; }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) { errBox.textContent = 'Email looks invalid.'; f.email.focus(); return; }
    await busy(save, async () => {
      try {
        const saved = existing ? await update('customers', existing.id, row) : await insert('customers', row);
        if (!existing) logActivity(`Customer ${saved.name} added`, '☺');
        toast(existing ? 'Customer updated' : 'Customer added', 'success');
        m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', type: 'submit', icon: 'check' });
  const form = h('form', { class: 'form-grid', onsubmit: e => { e.preventDefault(); save.click(); }, novalidate: true },
    field('Name', f.name, { required: true, cls: 'full' }),
    field('Mobile', f.mobile, { required: true }), field('WhatsApp', f.whatsapp),
    field('Email', f.email), field('City', f.city),
    field('Address', f.address, { cls: 'full' }),
    field('Birthday', f.birthday, { hint: 'Reminder on the dashboard & calendar' }), field('Anniversary', f.anniversary, { hint: 'Wish them on WhatsApp' }),
    field('Notes', f.notes, { cls: 'full' }),
    h('button', { type: 'submit', hidden: true, tabindex: '-1' }));
  m = openModal({ title: existing ? 'Edit customer' : 'New customer', body: [errBox, form], footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save], guard: true });
  if (preset.name && !existing) setTimeout(() => f.mobile.focus(), 40);
  return m.result;
}

export async function deleteCustomer(c) {
  if (!(await confirmDialog(`Delete customer “${c.name}”? This cannot be undone. Customers with projects or invoices cannot be deleted.`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('customers', c.id); toast('Customer deleted', 'success'); return true; }
  catch (e) { toast(errMsg(e), 'error'); return false; }
}

export const routeView = ({ params }) => openCustomerDrawer(params.id);

export async function renderList({ query, refresh }) {
  if (!refresh) UI.q = query.q || '';
  const [customers, projects, invoices] = await Promise.all([all('customers'), all('projects'), all('invoices')]);
  const stats = new Map();
  for (const c of customers) stats.set(c.id, { projects: 0, billed: 0, balance: 0, last: '' });
  for (const p of projects) { const s = stats.get(p.customer_id); if (s) s.projects++; }
  for (const i of invoices) { const s = stats.get(i.customer_id); if (s) { s.billed += Number(i.total); s.balance += Number(i.balance); if ((i.invoice_date || '') > s.last) s.last = i.invoice_date; } }
  const sb = searchBox({ placeholder: 'Search name, mobile, email, city…', value: UI.q, 'aria-label': 'Search customers', wrapCls: 'grow' });
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim(); const d = t.replace(/\D/g, '');
    const rows = customers.filter(c => !t || includesCI(c.name, t) || includesCI(c.email, t) || includesCI(c.city, t) || (d.length >= 3 && String(c.mobile || '').replace(/\D/g, '').includes(d)));
    host.replaceChildren(table([
      { label: 'Name', sort: c => c.name, cell: c => h('span', { class: 'who-cell' }, h('span', { class: 'mini-av', 'aria-hidden': 'true' }, initials(c.name, '?')), h('span', null, h('b', null, c.name), c.city ? h('small', null, c.city) : null)) },
      { label: 'Mobile', cell: c => h('span', { class: 'nowrap muted' }, c.mobile || '—') },
      { label: 'Email', cell: c => h('span', { class: 'muted' }, c.email || '—') },
      { label: 'Projects', cls: 'r', sort: c => stats.get(c.id).projects, sortDir: -1, cell: c => String(stats.get(c.id).projects) },
      { label: 'Billed', cls: 'r', sort: c => stats.get(c.id).billed, sortDir: -1, cell: c => h('span', { class: 'num' }, money(stats.get(c.id).billed)) },
      { label: 'Pending', cls: 'r', sort: c => stats.get(c.id).balance, sortDir: -1, cell: c => { const b = stats.get(c.id).balance; return h('span', { class: 'num ' + (b > 0 ? 'warn' : 'dim') }, money(b)); } },
    ], rows, {
      sort: UI.sort,
      onRow: c => openCustomerDrawer(c.id), rowLabel: c => 'Open ' + c.name,
      actions: c => [
        iconBtn('eye', `View ${c.name}`, () => openCustomerDrawer(c.id)),
        iconBtn('whatsapp', `WhatsApp ${c.name}`, () => openWhatsApp(c.whatsapp || c.mobile, `Hello ${c.name},`), 'wa-ic'),
        iconBtn('invoice', `New invoice for ${c.name}`, () => newInvoiceFor(c.id)),
        iconBtn('pencil', `Edit ${c.name}`, () => openCustomerForm(c)),
      ],
      emptyText: t ? 'No customers match your search.' : 'No customers yet. Add your first customer.',
      emptyAction: btn('Add customer', () => openCustomerForm().then(c => c && openCustomerDrawer(c.id)), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
    foot.textContent = rows.length ? `${rows.length} customer${rows.length === 1 ? '' : 's'} · pending ${money(sum(rows, c => stats.get(c.id).balance))}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  // Deep link: #/customers?edit=<id> opens the edit form (used by screenshots / links).
  if (!refresh && query.edit) setTimeout(() => { const c = customers.find(x => x.id === query.edit); if (c) openCustomerForm(c); }, 0);
  return h('div', null,
    pageHead('Customers', `${customers.length} customer${customers.length === 1 ? '' : 's'}`, [
      btn('Add customer', async () => { const c = await openCustomerForm(); if (c) openCustomerDrawer(c.id); }, { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb), host, foot));
}

export function openCustomerDrawer(id) {
  const d = openDrawer({
    hash: '/customers/' + id, label: 'Customer',
    render: async () => {
      const c = await getRow('customers', id);
      if (!c) { toast('Customer not found.', 'warn'); return null; }
      const [projects, invoices, payments, receipts, quotes] = await Promise.all([all('projects'), all('invoices'), all('payments'), all('receipts'), all('quotations')]);
      const myP = projects.filter(p => p.customer_id === c.id);
      const myI = invoices.filter(i => i.customer_id === c.id).sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
      const invIds = new Set(myI.map(i => i.id)); const invById = new Map(myI.map(i => [i.id, i]));
      const myPay = payments.filter(p => invIds.has(p.invoice_id)).sort((a, b) => String(b.payment_date).localeCompare(String(a.payment_date)));
      const rcBy = new Map(receipts.map(r => [r.payment_id, r]));
      const myQ = quotes.filter(q => q.customer_id === c.id);
      const billed = sum(myI, i => i.total), paid = sum(myI, i => i.paid_amount), bal = sum(myI, i => i.balance);
      const totals = { count: myI.length, billed, paid, balance: bal };
      const ledger = (channel) => sharePdf({
        make: async () => (await import('../pdf/docs.js')).ledgerPdf(c.id), channel, phone: c.whatsapp || c.mobile, email: c.email,
        subject: `Account ledger — ${c.name}`, text: ledgerText(c, totals, channel === 'whatsapp'),
      });
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Ledger PDF', icon: 'download', onClick: () => ledger('download') },
        { text: 'Ledger on WhatsApp', icon: 'whatsapp', onClick: () => ledger('whatsapp') },
        { text: 'Ledger by Gmail', icon: 'mail', onClick: () => ledger('gmail') }, '-',
        { text: 'New quotation', icon: 'quote', onClick: () => import('./quotations.js').then(m => m.openQuotationEditor(null, { preset: { customer: c.id } })) },
        { text: 'New project', icon: 'camera', onClick: () => import('./projects.js').then(m => m.openProjectForm(null, { customer_id: c.id })) }, '-',
        { text: 'Delete customer', icon: 'trash', cls: 'danger', onClick: async () => { if (await deleteCustomer(c)) closeDrawerPanel(); } },
      ]));
      const li = (main, sub, right, onClick) => h('button', { type: 'button', class: 'li li-btn', onclick: onClick }, h('div', null, main, sub ? h('small', null, sub) : null), h('div', null, right));
      return {
        title: c.name, sub: [c.mobile, c.city].filter(Boolean).join(' · ') || 'Customer',
        actions: h('div', { class: 'btns' },
          btn('Edit', () => openCustomerForm(c), { icon: 'pencil', cls: 'sm' }),
          btn('WhatsApp', () => openWhatsApp(c.whatsapp || c.mobile, `Hello ${c.name},`), { cls: 'wa sm', icon: 'whatsapp' }),
          c.mobile ? h('a', { class: 'btn sm', href: 'tel:' + String(c.mobile).replace(/[^\d+]/g, '') }, h('span', { class: 'bi' }, ic('phone', 15)), 'Call') : null,
          btn('New invoice', () => newInvoiceFor(c.id), { cls: 'gold sm', icon: 'plus' }),
          h('span', { class: 'grow' }), more),
        body: [
          ...upcomingOccasions([c], { days: 14 }).map(o => h('div', { class: 'occ-box' }, h('span', { class: 'occ-ic', 'aria-hidden': 'true' }, ic(o.kind === 'birthday' ? 'gift' : 'heart', 15)),
            h('span', { class: 'grow' }, h('b', null, o.kind === 'birthday' ? 'Birthday' : 'Anniversary'), ` ${o.in === 0 ? 'today' : o.in === 1 ? 'tomorrow' : `in ${o.in} days`} · ${fmtDate(o.date)}${o.years ? ` · ${o.kind === 'birthday' ? 'turns ' + o.years : o.years + ' years'}` : ''}`),
            btn('Wish', () => openWhatsApp(c.whatsapp || c.mobile, wishText(o, state.company?.name)), { cls: 'wa sm', icon: 'whatsapp' }))),
          statRow([['Total billed', money(billed)], ['Received', money(paid), 'up'], ['Outstanding', money(bal), bal > 0 ? 'warn' : '']]),
          dwSection('Invoices', myI.length ? myI.map(i => li(h('b', { class: 'mono' }, i.number), `${i.party_name ? i.party_name + ' · ' : ''}${fmtDate(i.invoice_date)} · ${money(i.total)}`, [Number(i.balance) > 0 ? h('span', { class: 'amt warn' }, money(i.balance)) : null, invStatus(i.status)], () => openRecord('invoice', i.id)))
            : h('p', { class: 'dim small' }, 'No invoices yet.'), myI.length ? h('span', { class: 'dim small' }, `${myI.length}`) : null),
          dwSection('Projects', myP.length ? myP.map(p => li(h('b', null, p.name), [p.type, p.event_date ? fmtDate(p.event_date) : null].filter(Boolean).join(' · '), [stageProgress(p.stage), projStatus(p.status)], () => openRecord('project', p.id)))
            : h('p', { class: 'dim small' }, 'No projects yet.')),
          myPay.length ? dwSection('Payments', myPay.slice(0, 8).map(p => { const r = rcBy.get(p.id); return li(h('b', null, money(p.amount)), `${fmtDate(p.payment_date)} · ${p.mode}${invById.get(p.invoice_id) ? ' · ' + invById.get(p.invoice_id).number : ''}`, r ? h('span', { class: 'dim small mono' }, r.number) : null, () => (r ? openRecord('receipt', r.id) : openRecord('invoice', p.invoice_id))); })) : null,
          myQ.length ? dwSection('Quotations', myQ.map(q => li(h('b', { class: 'mono' }, q.number), `${q.party_name ? q.party_name + ' · ' : ''}${fmtDate(q.quote_date)} · ${money(q.total)}`, quoteStatus(q.status), () => openRecord('quotation', q.id)))) : null,
          dwSection('Details', h('div', { class: 'kv' },
            h('span', null, 'Mobile'), h('b', null, c.mobile || '—'), h('span', null, 'WhatsApp'), h('b', null, c.whatsapp || c.mobile || '—'),
            h('span', null, 'Email'), h('b', null, c.email || '—'), h('span', null, 'City'), h('b', null, c.city || '—'),
            h('span', null, 'Address'), h('b', null, c.address || '—'), h('span', null, 'Birthday'), h('b', null, fmtDate(c.birthday)),
            h('span', null, 'Anniversary'), h('b', null, fmtDate(c.anniversary)), h('span', null, 'Notes'), h('b', null, c.notes || '—'))),
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
