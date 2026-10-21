import { h, table, searchBox, chips, btn, iconBtn, ic } from '../dom.js';
import { toast, errMsg, confirmDialog, busy, openDrawer, currentDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, getRow, docItems, installments as loadInst, remove, gstOn, lookups, state, DEMO } from '../store.js';
import { money, fmtDate, includesCI, debounce, todayIST, allocateInstallments, sum, num, monthKey, daysBetween } from '../util.js';
import { invStatus, pageHead, recLink, itemsView, totalsView, dwSection, statRow, partyLine } from './common.js';
import { openDocEditor } from './doc-editor.js';
import { sharePdf, invoiceText, preOpenShareWindow, upiPayLink, invoiceViewLink } from '../share.js';
import { openPaymentModal, deletePayment, receiptShare } from './payments.js';

// Page state survives live refreshes (after saves) so filters / search / sort are kept.
const UI = { status: '', q: '', sort: { key: 'Date', dir: -1 } };

/** Copy the public invoice link (i.html?t=<token>) to the clipboard so the owner can paste it to a client. */
export async function copyInvoiceLink(inv) {
  const link = invoiceViewLink(inv);
  if (!link) { toast('This invoice has no shareable link yet. Edit and save it once to generate one.', 'warn', 6000); return; }
  try { await navigator.clipboard.writeText(link); toast('Invoice link copied — paste it to your client', 'success'); }
  catch { toast('Could not copy automatically. Link: ' + link, 'info', 9000); }
}

export function invoiceShare(inv, customer, channel, win) {
  return sharePdf({
    make: async () => (await import('../pdf/docs.js')).invoicePdf(inv.id), channel, win,
    phone: customer?.whatsapp || customer?.mobile, email: customer?.email,
    subject: `Invoice ${inv.number} from ${state.company?.name || 'Studio'}`,
    text: invoiceText(inv, customer, channel === 'whatsapp'),
  });
}
async function shareById(id, channel, win) {
  const inv = await getRow('invoices', id); if (!inv) return;
  const c = await getRow('customers', inv.customer_id);
  return invoiceShare(inv, c, channel, win);
}

/** Open the invoice editor modal (new or edit). */
export function openInvoiceEditor(id = null, { preset = {}, demo = false, afterSave } = {}) {
  return openDocEditor('invoice', {
    id, preset, demo, hash: id ? `/invoices/${id}/edit` : '/invoices/new',
    onSaved: async (saved, action, win) => {
      if (afterSave) Promise.resolve(afterSave(saved)).catch(e => console.warn('afterSave', e));
      const d = currentDrawer();
      if (!(d && d.recId === saved.id)) openInvoiceDrawer(saved.id);
      if (action === 'pdf') shareById(saved.id, 'download');
      if (action === 'whatsapp') shareById(saved.id, 'whatsapp', win);
    },
  });
}

// ---------- overlay routes ----------
export const routeNew = ({ query }) => openInvoiceEditor(null, { preset: { customer: query.customer, project: query.project }, demo: DEMO && !!query.demoTypeahead });
export const routeEdit = ({ params }) => openInvoiceEditor(params.id);
export const routeView = ({ params }) => openInvoiceDrawer(params.id);

const isOverdue = (i, today) => Number(i.balance) > 0 && i.due_date && i.due_date < today;

export async function renderList({ query, refresh }) {
  if (!refresh) { UI.status = query.status || ''; UI.q = query.q || ''; }
  const { invoices, cMap, cname } = await lookups();
  const today = todayIST();
  const sb = searchBox({ placeholder: 'Search number, customer, mobile…', 'aria-label': 'Search invoices', value: UI.q, wrapCls: 'grow' });
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const F = {
    '': () => true, open: i => Number(i.balance) > 0, unpaid: i => i.status === 'unpaid', partial: i => i.status === 'partial',
    paid: i => i.status === 'paid', overdue: i => isOverdue(i, today), recurring: i => !!i.recurring,
  };
  const cnt = k => invoices.filter(F[k]).length;
  const chipBar = chips([['', 'All', invoices.length], ['open', 'Due', cnt('open')], ['unpaid', 'Unpaid', cnt('unpaid')], ['partial', 'Partial', cnt('partial')], ['paid', 'Paid', cnt('paid')], ['overdue', 'Overdue', cnt('overdue')], ['recurring', 'Recurring', cnt('recurring')]],
    UI.status, v => { UI.status = v; draw(); }, 'Filter invoices by status');
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim(); const d = t.replace(/\D/g, '');
    const rows = invoices.filter(i => {
      if (!(F[UI.status] || F[''])(i)) return false;
      if (!t) return true;
      const c = cMap.get(i.customer_id);
      return includesCI(i.number, t) || includesCI(c?.name, t) || (d.length >= 3 && String(c?.mobile || '').replace(/\D/g, '').includes(d));
    });
    host.replaceChildren(table([
      { label: 'Number', sort: i => i.number, cell: i => [h('b', { class: 'mono' }, i.number), partyLine(i), i.recurring ? h('small', null, ic('repeat', 11), i.recurring_active ? ` next ${fmtDate(i.recurring_next)}` : ' paused') : i.source_invoice_id ? h('small', null, 'auto-generated') : null] },
      { label: 'Customer', sort: i => cname(i.customer_id), cell: i => cname(i.customer_id) },
      { label: 'Date', sort: i => i.invoice_date || '', sortDir: -1, cell: i => h('span', { class: 'nowrap' }, fmtDate(i.invoice_date)) },
      {
        label: 'Due', sort: i => i.due_date || '9999', cell: i => {
          if (!isOverdue(i, today)) return h('span', { class: 'nowrap muted' }, fmtDate(i.due_date));
          const n = daysBetween(i.due_date, today);
          return h('span', { class: 'nowrap dn' }, fmtDate(i.due_date), h('small', null, `${n} day${n > 1 ? 's' : ''} overdue`));
        },
      },
      { label: 'Total', cls: 'r', sort: i => Number(i.total), sortDir: -1, cell: i => h('span', { class: 'num' }, money(i.total)) },
      { label: 'Balance', cls: 'r', sort: i => Number(i.balance), sortDir: -1, cell: i => h('span', { class: 'num ' + (Number(i.balance) > 0 ? 'warn' : 'dim') }, money(i.balance)) },
      { label: 'Status', sort: i => i.status, cell: i => invStatus(i.status) },
    ], rows, {
      sort: UI.sort,
      onRow: i => openInvoiceDrawer(i.id), rowLabel: i => `Open invoice ${i.number}`,
      actions: i => [
        iconBtn('eye', `View ${i.number}`, () => openInvoiceDrawer(i.id)),
        iconBtn('link', `Copy invoice link for ${i.number}`, () => copyInvoiceLink(i)),
        iconBtn('download', `Download PDF of ${i.number}`, e => busy(e.currentTarget, () => shareById(i.id, 'download'))),
        iconBtn('whatsapp', `Send ${i.number} on WhatsApp`, e => { const w = preOpenShareWindow('whatsapp'); busy(e.currentTarget, () => shareById(i.id, 'whatsapp', w)); }, 'wa-ic'),
        Number(i.balance) > 0 ? iconBtn('rupee', `Record payment for ${i.number}`, () => openPaymentModal(i.id)) : null,
      ],
      emptyText: t || UI.status ? 'No invoices match these filters.' : 'No invoices yet. Create your first invoice in a few seconds.',
      emptyAction: t || UI.status ? btn('Clear filters', () => { UI.status = ''; sb.input.value = ''; chipBar.set(''); draw(); }, { cls: 'sm' }) : btn('New invoice', () => openInvoiceEditor(), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
    foot.textContent = rows.length ? `${rows.length} invoice${rows.length === 1 ? '' : 's'} · total ${money(sum(rows, r => r.total))} · balance ${money(sum(rows, r => r.balance))}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  if (!refresh && query.new) setTimeout(() => openInvoiceEditor(null, { preset: { customer: query.customer, project: query.project }, demo: DEMO && !!query.demoTypeahead }), 0);
  const open = invoices.filter(i => Number(i.balance) > 0);
  const overdue = open.filter(i => isOverdue(i, today));
  const mk = monthKey(today);
  return h('div', null,
    pageHead('Invoices', `${open.length} with balance due`, [
      btn('Record payment', () => openPaymentModal(null), { icon: 'rupee' }),
      btn('New invoice', () => openInvoiceEditor(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'mini-stats' },
      h('button', { type: 'button', class: 'ms', onclick: () => { UI.status = 'open'; chipBar.set('open'); draw(); } }, h('span', null, 'Outstanding'), h('b', { class: 'warn' }, money(sum(open, i => i.balance))), h('small', null, `${open.length} invoices`)),
      h('button', { type: 'button', class: 'ms', onclick: () => { UI.status = 'overdue'; chipBar.set('overdue'); draw(); } }, h('span', null, 'Overdue'), h('b', { class: overdue.length ? 'dn' : '' }, money(sum(overdue, i => i.balance))), h('small', null, `${overdue.length} invoices`)),
      h('div', { class: 'ms' }, h('span', null, 'Billed this month'), h('b', null, money(sum(invoices.filter(i => monthKey(i.invoice_date) === mk), i => i.total))), h('small', null, `${invoices.filter(i => monthKey(i.invoice_date) === mk).length} invoices`))),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, chipBar), host, foot));
}

// ---------- drawer ----------
export function openInvoiceDrawer(id) {
  const d = openDrawer({
    hash: '/invoices/' + id, label: 'Invoice',
    render: async () => {
      const inv = await getRow('invoices', id);
      if (!inv) { toast('Invoice not found (it may have been deleted).', 'warn'); return null; }
      const [items, inst, customer, project, payments, receipts, allInv] = await Promise.all([
        docItems('invoice', inv.id), loadInst(inv.id), getRow('customers', inv.customer_id), inv.project_id ? getRow('projects', inv.project_id) : null,
        all('payments'), all('receipts'), all('invoices')]);
      const pays = payments.filter(p => p.invoice_id === inv.id).sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)));
      const rcBy = new Map(receipts.map(r => [r.payment_id, r]));
      const src = inv.source_invoice_id ? allInv.find(i => i.id === inv.source_invoice_id) : null;
      const share = (ch) => e => { const w = ch === 'whatsapp' ? preOpenShareWindow(ch) : null; busy(e.currentTarget, () => invoiceShare(inv, customer, ch, w)); };
      // UPI pay deep link for the current balance (amount = balance). Tapping "Pay" opens GPay / PhonePe on a phone.
      const payNote = [inv.number, inv.party_name].filter(Boolean).join(' · ');
      const payLink = Number(inv.balance) > 0 ? upiPayLink(inv.balance, payNote) : null;
      const copyPayLink = async () => {
        if (!payLink) return;
        try { await navigator.clipboard.writeText(payLink); toast('UPI pay link copied', 'success'); }
        catch { toast('Could not copy. Link: ' + payLink, 'info', 8000); }
      };
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Copy invoice link', icon: 'link', onClick: () => copyInvoiceLink(inv) },
        { text: 'Send by Gmail', icon: 'mail', onClick: () => invoiceShare(inv, customer, 'gmail') },
        payLink ? { text: 'Copy UPI pay link', icon: 'copy', onClick: copyPayLink } : null,
        customer ? { text: 'Open customer', icon: 'user', onClick: () => import('./customers.js').then(m => m.openCustomerDrawer(customer.id)) } : null,
        '-',
        {
          text: 'Delete invoice', icon: 'trash', cls: 'danger', onClick: async () => {
            const extra = pays.length ? ` Its ${pays.length} payment(s) and receipt(s) will also be deleted.` : '';
            if (!(await confirmDialog(`Delete invoice ${inv.number}?${extra} This cannot be undone.`, { danger: true, okText: 'Delete invoice' }))) return;
            try { await remove('invoices', inv.id); toast(`Invoice ${inv.number} deleted`, 'success'); closeDrawerPanel(); } catch (e) { toast(errMsg(e), 'error'); }
          },
        },
      ]));
      const actions = h('div', { class: 'btns' },
        btn('Edit', () => openInvoiceEditor(inv.id), { icon: 'pencil', cls: 'sm' }),
        btn('Copy link', () => copyInvoiceLink(inv), { icon: 'link', cls: 'sm' }),
        btn('PDF', share('download'), { icon: 'download', cls: 'sm' }),
        btn('WhatsApp', share('whatsapp'), { icon: 'whatsapp', cls: 'sm wa' }),
        payLink ? btn('Pay', () => { location.href = payLink; }, { cls: 'sm', icon: 'rupee', aria: `Open a UPI app to pay the balance of ${money(inv.balance)}` }) : null,
        Number(inv.balance) > 0 ? btn('Record payment', () => openPaymentModal(inv.id), { cls: 'gold sm', icon: 'rupee' }) : null,
        h('span', { class: 'grow' }), more);
      const sched = inst.length ? h('div', { class: 'sched' }, allocateInstallments(inst, inv.paid_amount).map(i => h('div', { class: 'si ' + i.status },
        h('span', { class: 'muted' }, `${i.label}${i.percent != null ? ' · ' + num(i.percent) + '%' : ''}`), h('b', null, money(i.amount)),
        h('span', { class: i.status === 'paid' ? 'up' : i.status === 'partial' ? 'warn' : 'dn' }, i.status === 'paid' ? 'Paid' : i.status === 'partial' ? `Part paid ${money(i.paid)}` : i.due_date ? `Due ${fmtDate(i.due_date)}` : 'Due'),
        i.due_note ? h('small', { class: 'dim', style: { display: 'block' } }, i.due_note) : null))) : null;
      const payList = pays.length ? pays.map(p => {
        const r = rcBy.get(p.id);
        return h('div', { class: 'li' },
          h('div', null, h('b', null, money(p.amount)), h('small', null, `${fmtDate(p.payment_date)} · ${p.mode}${r ? ' · ' + r.number : ''}${p.notes ? ' · ' + p.notes : ''}`)),
          h('div', { class: 'li-act' },
            r ? iconBtn('download', `Download receipt ${r.number}`, () => receiptShare(r, 'download')) : null,
            r ? iconBtn('whatsapp', `Send receipt ${r.number} on WhatsApp`, () => receiptShare(r, 'whatsapp'), 'wa-ic') : null,
            iconBtn('trash', `Delete payment of ${money(p.amount)}`, () => deletePayment(p, r), 'danger')));
      }) : h('p', { class: 'dim small' }, 'No payments recorded yet.');
      const gst = gstOn();
      return {
        title: `${gst ? 'Tax invoice' : 'Invoice'} ${inv.number}`, badge: invStatus(inv.status),
        sub: `${inv.party_name ? inv.party_name + ' · ' : ''}${customer?.name || '—'} · ${fmtDate(inv.invoice_date)}${inv.due_date ? ' · due ' + fmtDate(inv.due_date) : ''}`,
        actions,
        body: [
          statRow([['Total', money(inv.total)], ['Received', money(inv.paid_amount), 'up'], ['Balance', money(inv.balance), Number(inv.balance) > 0 ? 'warn' : 'up']]),
          h('div', { class: 'dw-grid' },
            h('div', { class: 'dw-box' }, h('div', { class: 'lbl' }, 'Billed to'), customer ? recLink('customer', customer.id, customer.name) : h('b', null, '—'),
              inv.party_name ? partyLine(inv) : null,
              h('small', null, [customer?.mobile, customer?.email, customer?.city].filter(Boolean).join(' · '))),
            h('div', { class: 'dw-box' }, h('div', { class: 'lbl' }, 'Project'), project ? recLink('project', project.id, project.name) : h('span', { class: 'muted' }, 'No project'),
              project ? h('small', null, [project.type, project.event_date ? fmtDate(project.event_date) : null, project.venue].filter(Boolean).join(' · ')) : null)),
          inv.recurring || src || inv.quotation_id ? h('div', { class: 'kv dw-kv' },
            inv.recurring ? [h('span', null, 'Recurring'), h('b', null, inv.recurring_active ? `Monthly · next ${fmtDate(inv.recurring_next)}` : 'Paused')] : null,
            src ? [h('span', null, 'Generated from'), h('b', null, recLink('invoice', src.id, src.number))] : null,
            inv.quotation_id ? [h('span', null, 'From quotation'), h('b', null, recLink('quotation', inv.quotation_id, 'View quotation'))] : null) : null,
          dwSection('Items', [itemsView(items), totalsView(inv, { invoice: true })]),
          sched ? dwSection('Payment schedule', sched) : null,
          dwSection('Payments', payList, Number(inv.balance) > 0 ? btn('Add', () => openPaymentModal(inv.id), { cls: 'sm ghost', icon: 'plus' }) : null),
          inv.notes || inv.terms ? dwSection('Notes & terms', [inv.notes ? h('div', { class: 'notes-box', style: { marginBottom: '10px' } }, inv.notes) : null, inv.terms ? h('div', { class: 'notes-box dim' }, inv.terms) : null]) : null,
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
