// WhatsApp / Gmail sharing. Desktop: download PDF then open the link. Mobile: Web Share with the PDF file.
import { normalizeWa, money, fmtDate, cap } from './util.js';
import { state } from './store.js';
import { toast, errMsg } from './ui.js';

export function waUrl(number, text) {
  const n = normalizeWa(number);
  return `https://wa.me/${n}?text=${encodeURIComponent(text || '')}`;
}
export function gmailUrl(to, subject, body) {
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: to || '', su: subject || '', body: body || '' });
  return `https://mail.google.com/mail/?${p.toString()}`;
}
const co = () => state.company?.name || 'Studio';
const upiLine = (wa) => state.settings.upi ? ['', `${wa ? '📲 ' : ''}UPI: ${state.settings.upi}`] : [];
const ATTACH = 'A PDF copy is attached (or open the link above to view & download).';
const b = (s, wa) => (wa ? `*${s}*` : s);
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Build a `upi://pay?...` deep link the customer can tap on their phone to open GPay / PhonePe / Paytm prefilled.
 * pa = UPI id (company settings), pn = company name, am = amount (the current balance), cu = INR, tn = note.
 * Returns null when the company has no UPI id. This tap-to-pay link is reliable in a WhatsApp message and from the
 * app's own "Pay" button; a link embedded in a PDF is not reliable, which is why we add it to the message / app instead.
 */
export function upiPayLink(amount, note) {
  const upi = state.settings.upi; if (!upi) return null;
  const p = new URLSearchParams({ pa: upi, pn: co(), am: round2(amount).toFixed(2), cu: 'INR', tn: note || '' });
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20');
}
/** The "Pay here: upi://…" line for a WhatsApp message (only when there is a balance and a UPI id). */
function upiPayLines(amount, note, wa) {
  const link = Number(amount) > 0 ? upiPayLink(amount, note) : null;
  return link ? ['', `${wa ? '💳 ' : ''}Pay here: ${link}`] : [];
}

const payNote = inv => [inv.number, inv.party_name].filter(Boolean).join(' · ');

/**
 * Short public link to view the invoice online (i.html?t=<share_token>). The customer can open it
 * without logging in to see the invoice, download the PDF and pay — so there is no need to attach a
 * file in a WhatsApp/Gmail web link (which neither service allows). Returns null if the invoice has
 * no share token yet (older rows get one on their next save). Built relative to the live site.
 */
export function invoiceViewLink(inv) {
  if (!inv?.share_token) return null;
  try { return new URL('i.html', location.href).href + '?t=' + encodeURIComponent(inv.share_token); }
  catch { return 'i.html?t=' + encodeURIComponent(inv.share_token); }
}
/** The "View / download / pay online" line for a message (only when we have a public link). */
function viewLines(inv, wa) {
  const link = invoiceViewLink(inv);
  return link ? ['', `${wa ? '🔗 ' : ''}View & pay online: ${link}`] : [];
}

export function invoiceText(inv, c, wa = true) {
  return [
    `Hello ${c?.name || 'Customer'},`, '', `Greetings from ${b(co(), wa)}.`, 'Please find your invoice details below:', '',
    inv.party_name ? `${wa ? '👰 ' : ''}Party: ${b(inv.party_name, wa)}` : null,
    `${wa ? '🧾 ' : ''}Invoice No.: ${b(inv.number, wa)}`,
    `${wa ? '📅 ' : ''}Date: ${fmtDate(inv.invoice_date)}`,
    inv.due_date ? `${wa ? '⏰ ' : ''}Due: ${fmtDate(inv.due_date)}` : null,
    `${wa ? '💰 ' : ''}Total: ${money(inv.total)}`,
    `${wa ? '✅ ' : ''}Paid: ${money(inv.paid_amount)}`,
    `${wa ? '⏳ ' : ''}Balance: ${money(inv.balance)}`,
    `${wa ? '📌 ' : ''}Status: ${cap(inv.status)}`,
    ...(Number(inv.balance) > 0 ? upiLine(wa) : []),
    ...upiPayLines(inv.balance, payNote(inv), wa),
    ...viewLines(inv, wa),
    '', ATTACH, '', 'Thank you for your business!', `— ${co()}`,
  ].filter(x => x !== null).join('\n');
}
export function reminderText(inv, c) {
  return [
    `Hello ${c?.name || 'Customer'},`, '', `This is a friendly reminder from *${co()}*.`, '',
    inv.party_name ? `👰 Party: *${inv.party_name}*` : null,
    `🧾 Invoice No.: *${inv.number}* (${fmtDate(inv.invoice_date)})`,
    `💰 Total: ${money(inv.total)}`, `✅ Paid: ${money(inv.paid_amount)}`,
    `⏳ Balance due: *${money(inv.balance)}*${inv.due_date ? ` (due ${fmtDate(inv.due_date)})` : ''}`,
    ...upiLine(true), ...upiPayLines(inv.balance, payNote(inv), true), ...viewLines(inv, true), '', 'Please ignore if already paid. Thank you!', `— ${co()}`,
  ].filter(x => x !== null).join('\n');
}
export function receiptText(r, c, inv, wa = true) {
  return [
    `Hello ${c?.name || 'Customer'},`, '', `Greetings from ${b(co(), wa)}.`, 'This is your payment receipt:', '',
    `${wa ? '🧮 ' : ''}Receipt No.: ${b(r.number, wa)}`,
    `${wa ? '📅 ' : ''}Date: ${fmtDate(r.receipt_date)}`,
    `${wa ? '💵 ' : ''}Amount received: ${money(r.amount)}`,
    `${wa ? '💳 ' : ''}Mode: ${r.mode || '—'}`,
    inv ? `${wa ? '🧾 ' : ''}Against invoice: ${inv.number}` : null,
    inv ? `${wa ? '⏳ ' : ''}Balance remaining: ${money(inv.balance)}` : null,
    ...(inv ? upiPayLines(inv.balance, payNote(inv), wa) : []),
    '', ATTACH, '', 'Thank you for your payment!', `— ${co()}`,
  ].filter(x => x !== null).join('\n');
}
export function quotationText(q, c, wa = true) {
  return [
    `Hello ${c?.name || q.guest_name || 'Customer'},`, '', `Greetings from ${b(co(), wa)}.`, 'Please find your quotation details below:', '',
    `${wa ? '📝 ' : ''}Quotation No.: ${b(q.number, wa)}`,
    `${wa ? '📅 ' : ''}Date: ${fmtDate(q.quote_date)}`,
    q.valid_until ? `${wa ? '⏳ ' : ''}Valid till: ${fmtDate(q.valid_until)}` : null,
    `${wa ? '💰 ' : ''}Total: ${money(q.total)}`,
    '', ATTACH, '', 'Looking forward to working with you!', `— ${co()}`,
  ].filter(x => x !== null).join('\n');
}
export function ledgerText(c, totals, wa = true) {
  return [
    `Hello ${c.name},`, '', `Greetings from ${b(co(), wa)}.`, 'Please find your account ledger summary below:', '',
    `${wa ? '🧾 ' : ''}Total invoices: ${totals.count}`,
    `${wa ? '💰 ' : ''}Total billing: ${money(totals.billed)}`,
    `${wa ? '✅ ' : ''}Received: ${money(totals.paid)}`,
    `${wa ? '⏳ ' : ''}Outstanding balance: ${money(totals.balance)}`,
    ...(totals.balance > 0 ? upiLine(wa) : []),
    '', ATTACH, `— ${co()}`,
  ].join('\n');
}

/** Work statement summary for a team member (no customer details, only the project titles the owner typed). */
export function statementText(m, period, st, wa = true) {
  return [
    `Hello ${m.display_name || 'there'},`, '', `Your work statement from ${b(co(), wa)}:`, `${wa ? '📅 ' : ''}Period: ${period.label}`, '',
    `${wa ? '📋 ' : ''}Tasks: ${st.periodTasks}`,
    `${wa ? '💼 ' : ''}Earned (done work): ${money(st.earned)}`,
    `${wa ? '✅ ' : ''}Received in period: ${money(st.received)}`,
    `${wa ? '⏳ ' : ''}Pending (all time): ${b(money(Math.max(0, st.pending)), wa)}`,
    st.pending < 0 ? `${wa ? 'ℹ️ ' : ''}Advance paid: ${money(-st.pending)}` : null,
    '', ATTACH, `— ${co()}`,
  ].filter(x => x !== null).join('\n');
}

export function isMobileShare() {
  return matchMedia('(pointer:coarse)').matches && typeof navigator.canShare === 'function' && typeof File === 'function';
}

/**
 * Generate a PDF and share it.
 * make: async () => ({ blob: () => Promise<Blob>, download: () => Promise, fileName })
 * channel: 'whatsapp' | 'gmail' | 'download'
 */
/** Open the share tab synchronously inside a click handler (so it is not blocked) before any await. */
export function preOpenShareWindow(channel) {
  if (channel === 'download' || isMobileShare()) return null;
  const win = window.open('', '_blank');
  if (win) { try { win.opener = null; win.document.title = 'Opening…'; } catch { /* ignore */ } }
  return win;
}

export async function sharePdf({ make, channel, phone, email, subject, text, win: preWin }) {
  // Desktop: open the target tab synchronously so it is not blocked as a pop-up.
  const mobile = channel !== 'download' && isMobileShare();
  let win = preWin || null;
  if (!win && !mobile && channel !== 'download') win = preOpenShareWindow(channel);
  try {
    const pdf = await make();
    if (mobile) {
      const blob = await pdf.blob();
      const file = new File([blob], pdf.fileName, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: pdf.fileName, text }); return; }
        catch (e) { if (e?.name === 'AbortError') return; }
      }
      await pdf.download();
      location.href = channel === 'gmail' ? gmailUrl(email, subject, text) : waUrl(phone, text);
      return;
    }
    await pdf.download();
    if (channel === 'download') { toast(`Downloaded ${pdf.fileName}`, 'success'); return; }
    const url = channel === 'gmail' ? gmailUrl(email, subject, text) : waUrl(phone, text);
    toast(`PDF downloaded — attach ${pdf.fileName} in ${channel === 'gmail' ? 'Gmail' : 'WhatsApp'}`, 'success', 6000);
    if (win && !win.closed) win.location.href = url;
    else if (!window.open(url, '_blank', 'noopener')) toast('Pop-up blocked. Allow pop-ups for sharing.', 'warn');
  } catch (e) {
    if (win && !win.closed) win.close();
    console.error(e);
    toast('Could not create the PDF: ' + errMsg(e), 'error');
  }
}

/** Open WhatsApp with text only (no PDF). */
export function openWhatsApp(phone, text) {
  if (!window.open(waUrl(phone, text), '_blank', 'noopener')) toast('Pop-up blocked. Allow pop-ups for WhatsApp.', 'warn');
}
