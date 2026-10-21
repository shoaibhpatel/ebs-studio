import { h, mount, table, field, input, textarea, select, btn, iconBtn, searchBox, chips, ic } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel } from '../ui.js';
import { all, lookups, recordPayment, remove, getRow, state } from '../store.js';
import { money, fmtDate, todayIST, includesCI, debounce, sum, monthKey } from '../util.js';
import { PAYMENT_MODES } from '../config.js';
import { pageHead, recLink, openRecord, dwSection, statRow, invStatus } from './common.js';
import { sharePdf, receiptText, preOpenShareWindow } from '../share.js';

const UI = { mode: '', q: '', sort: { key: 'Date', dir: -1 } };
const UR = { q: '', sort: { key: 'Date', dir: -1 } };

export async function receiptShare(r, channel, win) {
  const [inv, c] = await Promise.all([getRow('invoices', r.invoice_id), getRow('customers', r.customer_id)]);
  return sharePdf({
    make: async () => (await import('../pdf/docs.js')).receiptPdf(r.id), channel, win,
    phone: c?.whatsapp || c?.mobile, email: c?.email,
    subject: `Payment receipt ${r.number} from ${state.company?.name || 'Studio'}`,
    text: receiptText(r, c, inv, channel === 'whatsapp'),
  });
}
const shareW = (r, ch) => e => { const w = ch === 'whatsapp' ? preOpenShareWindow(ch) : null; busy(e.currentTarget, () => receiptShare(r, ch, w)); };

/** Record Payment modal. Resolves to { payment, receipt } or null. */
export async function openPaymentModal(invoiceId = null, { onSaved } = {}) {
  const { invoices, cname } = await lookups();
  const open = invoices.filter(i => Number(i.balance) > 0.009 || i.id === invoiceId)
    .sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
  if (!open.length) { toast('No invoices with a balance due.', 'info'); return null; }
  const invSel = select([['', '— Select invoice —'], ...open.map(i => [i.id, `${i.number} · ${cname(i.customer_id)} · balance ${money(i.balance)}`])], invoiceId || '', { id: 'pm-inv' });
  const info = h('div', { class: 'pay-info', 'aria-live': 'polite' });
  const amount = input({ type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', class: 'inp num big-inp', id: 'pm-amt' });
  const date = input({ type: 'date', value: todayIST() });
  let mode = 'UPI';
  const modeChips = chips(PAYMENT_MODES.map(x => [x, x]), mode, v => { mode = v; }, 'Payment mode');
  const notes = textarea({ rows: 2, placeholder: 'Optional (e.g. Advance, UTR number)' });
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const quick = h('div', { class: 'chips' });
  const upd = () => {
    const i = open.find(x => x.id === invSel.value);
    if (!i) { mount(info, h('span', { class: 'muted' }, 'Choose an invoice to see its balance.')); mount(quick); return; }
    mount(info,
      h('div', { class: 'pi' }, h('span', null, 'Customer'), h('b', null, cname(i.customer_id))),
      h('div', { class: 'pi' }, h('span', null, 'Invoice total'), h('b', null, money(i.total))),
      h('div', { class: 'pi' }, h('span', null, 'Received'), h('b', { class: 'up' }, money(i.paid_amount))),
      h('div', { class: 'pi' }, h('span', null, 'Balance due'), h('b', { class: 'warn' }, money(i.balance))));
    const bal = Number(i.balance);
    amount.value = String(bal > 0 ? bal : '');
    mount(quick, [['Full balance', bal], ['50%', Math.round(bal / 2)], ['30%', Math.round(bal * 0.3)]].filter(([, v]) => v > 0).map(([l, v]) => h('button', { type: 'button', class: 'chip sm', onclick: () => { amount.value = String(v); amount.focus(); } }, `${l} · ${money(v)}`)));
  };
  invSel.addEventListener('change', upd); upd();
  let m;
  const save = btn('Save payment', async () => {
    errBox.textContent = '';
    if (!invSel.value) { errBox.textContent = 'Choose an invoice.'; invSel.focus(); return; }
    const amt = Number(amount.value);
    if (!(amt > 0)) { errBox.textContent = 'Enter an amount greater than 0.'; amount.focus(); return; }
    await busy(save, async () => {
      try {
        const res = await recordPayment({ invoice_id: invSel.value, amount: amt, payment_date: date.value, mode, notes: notes.value.trim() });
        toast(`Payment ${money(amt)} saved${res.receipt ? ' · receipt ' + res.receipt.number : ''}`, 'success');
        m.markClean(); m.close(res);
      } catch (e) { errBox.textContent = errMsg(e); } // server message, e.g. overpayment
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: 'Record payment', guard: true,
    body: [errBox, field('Invoice', invSel, { required: true }), info,
      h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', { for: 'pm-amt' }, 'Amount received (₹)', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), amount, quick), field('Date', date)),
      h('div', { class: 'field' }, h('span', { class: 'flbl' }, 'Mode'), modeChips), field('Notes', notes)],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  if (invoiceId) setTimeout(() => { amount.focus(); amount.select(); }, 60);
  const res = await m.result;
  if (res && onSaved) onSaved(res);
  if (res?.receipt) {
    const r = res.receipt; let m2;
    m2 = openModal({
      title: `Receipt ${r.number}`, size: 'sm', body: h('div', { class: 'done-box' }, h('span', { class: 'done-ic' }, ic('check', 22)), h('p', { class: 'confirm-text' }, `Payment of ${money(r.amount)} recorded. Share the receipt with the customer?`)),
      footer: [btn('Close', () => m2.close(), { cls: 'ghost' }), btn('PDF', shareW(r, 'download'), { icon: 'download' }), btn('WhatsApp', shareW(r, 'whatsapp'), { cls: 'wa', icon: 'whatsapp' }), btn('Gmail', shareW(r, 'gmail'), { icon: 'mail' })],
    });
  }
  return res;
}

export async function deletePayment(p, receipt) {
  if (!(await confirmDialog(`Delete the payment of ${money(p.amount)} on ${fmtDate(p.payment_date)}${receipt ? ` (receipt ${receipt.number})` : ''}? The invoice balance goes back up and the receipt is deleted.`, { danger: true, okText: 'Delete payment' }))) return false;
  try { await remove('payments', p.id); toast('Payment deleted', 'success'); return true; }
  catch (e) { toast(errMsg(e), 'error'); return false; }
}

export async function renderPayments({ query, refresh }) {
  if (!refresh) { UI.mode = query.mode || ''; UI.q = ''; }
  const [{ iMap, cname }, payments, receipts] = await Promise.all([lookups(), all('payments'), all('receipts')]);
  const rcBy = new Map(receipts.map(r => [r.payment_id, r]));
  const sb = searchBox({ placeholder: 'Search customer, invoice, receipt…', 'aria-label': 'Search payments', value: UI.q, wrapCls: 'grow' });
  const modeChips = chips([['', 'All modes', payments.length], ...PAYMENT_MODES.map(x => [x, x, payments.filter(p => p.mode === x).length])], UI.mode, v => { UI.mode = v; draw(); }, 'Filter by mode');
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim();
    const rows = payments.filter(p => (!UI.mode || p.mode === UI.mode) && (!t || includesCI(cname(p.customer_id), t) || includesCI(iMap.get(p.invoice_id)?.number, t) || includesCI(rcBy.get(p.id)?.number, t)));
    host.replaceChildren(table([
      { label: 'Date', sort: p => p.payment_date || '', sortDir: -1, cell: p => h('span', { class: 'nowrap' }, fmtDate(p.payment_date)) },
      { label: 'Receipt', sort: p => rcBy.get(p.id)?.number || '', cell: p => h('span', { class: 'mono' }, rcBy.get(p.id)?.number || '—') },
      { label: 'Invoice', cell: p => { const i = iMap.get(p.invoice_id); return i ? recLink('invoice', i.id, i.number) : '—'; } },
      { label: 'Customer', sort: p => cname(p.customer_id), cell: p => cname(p.customer_id) },
      { label: 'Mode', sort: p => p.mode, cell: p => h('span', { class: 'tag' }, p.mode) },
      { label: 'Notes', cell: p => h('span', { class: 'muted' }, p.notes || '') },
      { label: 'Amount', cls: 'r', sort: p => Number(p.amount), sortDir: -1, cell: p => h('b', { class: 'num' }, money(p.amount)) },
    ], rows, {
      sort: UI.sort,
      onRow: p => { const r = rcBy.get(p.id); if (r) openReceiptDrawer(r.id); else openRecord('invoice', p.invoice_id); }, rowLabel: p => `Open payment of ${money(p.amount)}`,
      actions: p => {
        const r = rcBy.get(p.id);
        return [r ? iconBtn('download', `Download receipt ${r.number}`, shareW(r, 'download')) : null,
          r ? iconBtn('whatsapp', `Send receipt ${r.number} on WhatsApp`, shareW(r, 'whatsapp'), 'wa-ic') : null,
          iconBtn('trash', `Delete payment ${money(p.amount)}`, () => deletePayment(p, r), 'danger')];
      },
      emptyText: t || UI.mode ? 'No payments match these filters.' : 'No payments yet. Record the first advance you receive.',
      emptyAction: btn('Record payment', () => openPaymentModal(null), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
    foot.textContent = rows.length ? `${rows.length} payment${rows.length === 1 ? '' : 's'} · ${money(sum(rows, r => r.amount))}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120)); draw();
  const mk = monthKey(todayIST());
  const thisMonth = sum(payments.filter(p => monthKey(p.payment_date) === mk), p => p.amount);
  if (!refresh && query.new) setTimeout(() => openPaymentModal(query.invoice || null), 0);
  return h('div', null,
    pageHead('Payments', `${money(thisMonth)} received this month`, [btn('Record payment', () => openPaymentModal(null), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, modeChips), host, foot));
}

export const routeReceipt = ({ params }) => openReceiptDrawer(params.id);

export async function renderReceipts({ refresh }) {
  if (!refresh) UR.q = '';
  const [{ iMap, cname }, receipts] = await Promise.all([lookups(), all('receipts')]);
  const sb = searchBox({ placeholder: 'Search receipt, invoice, customer…', 'aria-label': 'Search receipts', value: UR.q, wrapCls: 'grow' });
  const host = h('div');
  const draw = () => {
    UR.q = sb.input.value; const t = UR.q.trim();
    const rows = receipts.filter(r => !t || includesCI(r.number, t) || includesCI(cname(r.customer_id), t) || includesCI(iMap.get(r.invoice_id)?.number, t));
    host.replaceChildren(table([
      { label: 'Receipt', sort: r => r.number, cell: r => h('b', { class: 'mono' }, r.number) },
      { label: 'Date', sort: r => r.receipt_date || '', sortDir: -1, cell: r => h('span', { class: 'nowrap' }, fmtDate(r.receipt_date)) },
      { label: 'Customer', sort: r => cname(r.customer_id), cell: r => cname(r.customer_id) },
      { label: 'Invoice', cell: r => { const i = iMap.get(r.invoice_id); return i ? recLink('invoice', i.id, i.number) : '—'; } },
      { label: 'Mode', cell: r => h('span', { class: 'tag' }, r.mode || '—') },
      { label: 'Amount', cls: 'r', sort: r => Number(r.amount), sortDir: -1, cell: r => h('b', { class: 'num' }, money(r.amount)) },
    ], rows, {
      sort: UR.sort,
      onRow: r => openReceiptDrawer(r.id), rowLabel: r => 'Open receipt ' + r.number,
      actions: r => [iconBtn('download', `Download receipt ${r.number}`, shareW(r, 'download')), iconBtn('whatsapp', `Send receipt ${r.number} on WhatsApp`, shareW(r, 'whatsapp'), 'wa-ic'), iconBtn('mail', `Email receipt ${r.number} with Gmail`, shareW(r, 'gmail'))],
      emptyText: 'No receipts yet. Receipts are created automatically when you record a payment.',
    }));
    host.querySelector('table')?.classList.add('stack');
  };
  sb.input.addEventListener('input', debounce(draw, 120)); draw();
  return h('div', null,
    pageHead('Receipts', `${receipts.length} receipt${receipts.length === 1 ? '' : 's'} · created automatically for every payment`, [btn('Record payment', () => openPaymentModal(null), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb), host));
}

export function openReceiptDrawer(id) {
  const d = openDrawer({
    hash: '/receipts/' + id, label: 'Receipt', size: 'narrow',
    render: async () => {
      const r = await getRow('receipts', id);
      if (!r) { toast('Receipt not found.', 'warn'); return null; }
      const [inv, c, pay] = await Promise.all([getRow('invoices', r.invoice_id), getRow('customers', r.customer_id), getRow('payments', r.payment_id)]);
      return {
        title: `Receipt ${r.number}`, sub: `${c?.name || '—'} · ${fmtDate(r.receipt_date)}`,
        actions: h('div', { class: 'btns' }, btn('PDF', shareW(r, 'download'), { icon: 'download', cls: 'sm' }), btn('WhatsApp', shareW(r, 'whatsapp'), { icon: 'whatsapp', cls: 'sm wa' }), btn('Gmail', shareW(r, 'gmail'), { icon: 'mail', cls: 'sm' }),
          h('span', { class: 'grow' }), pay ? iconBtn('trash', 'Delete this payment', async () => { if (await deletePayment(pay, r)) closeDrawerPanel(); }, 'danger') : null),
        body: [
          statRow([['Amount received', money(r.amount), 'up'], ['Mode', r.mode || '—'], ['Date', fmtDate(r.receipt_date)]]),
          h('div', { class: 'kv dw-kv' },
            h('span', null, 'Received from'), h('b', null, c ? recLink('customer', c.id, c.name) : '—'),
            h('span', null, 'Against invoice'), h('b', null, inv ? recLink('invoice', inv.id, inv.number) : '—'),
            inv ? [h('span', null, 'Invoice total'), h('b', null, money(inv.total)), h('span', null, 'Balance now'), h('b', { class: Number(inv.balance) > 0 ? 'warn' : 'up' }, money(inv.balance)), h('span', null, 'Invoice status'), h('b', null, invStatus(inv.status))] : null,
            r.notes ? [h('span', null, 'Notes'), h('b', null, r.notes)] : null),
          dwSection('Share', h('p', { class: 'dim small' }, 'On a phone, WhatsApp / Gmail share the PDF directly. On a computer the PDF downloads first, then WhatsApp or Gmail opens with the message ready.')),
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
