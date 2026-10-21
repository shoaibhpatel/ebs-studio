// Invoice, quotation, receipt and customer ledger PDFs.
import {
  C, header, infoStrip, partyBox, kv, lbl, itemsTable, totalsBox, taxRows, payBox, termsAndSign, thankYou,
  notesBlock, docDefinition, output, R, RS, primePayQr,
} from './core.js';
import { state, gstOn, getRow, docItems, docItemsByDoc, installments as loadInst, all } from '../store.js';
import { fmtDate, amountInWords, allocateInstallments, safeFilePart, round2, cap, todayIST, sum, initials, isHeader } from '../util.js';

/** Short 1–2 line summary of an invoice's items for the ledger (e.g. "Wedding Album · Cover Pad · Calender"). */
export function itemSummary(items, max = 4) {
  const names = (items || []).filter(it => !isHeader(it) && String(it.description || '').trim()).map(it => String(it.description).trim());
  if (!names.length) return '';
  let s = names.slice(0, max).join(' · ');
  if (names.length > max) s += ` +${names.length - max} more`;
  return s.length > 110 ? s.slice(0, 107).replace(/\s+\S*$/, '') + '…' : s; // keep the line tidy on A4
}
import { memberStats, payCoverage } from '../teamcalc.js';

const custLines = c => [c?.address, [c?.city].filter(Boolean).join(''), [c?.mobile, c?.email].filter(Boolean).join('  ·  ')];
function eventBox(p) {
  if (!p) return null;
  const dates = p.event_date ? (p.event_end_date && p.event_end_date !== p.event_date ? `${fmtDate(p.event_date)} – ${fmtDate(p.event_end_date)}` : fmtDate(p.event_date)) : null;
  return partyBox('Event', [p.type, p.name].filter(Boolean).join(' · '), [dates, p.venue]);
}

function scheduleBlock(inst, paidTotal) {
  if (!inst?.length) return null;
  const al = allocateInstallments(inst, paidTotal);
  const cells = al.map(i => {
    const tone = i.status === 'paid' ? C.green : i.status === 'partial' ? C.gold : C.red;
    const st = i.status === 'paid' ? 'Paid' : i.status === 'partial' ? `Part paid · ${R(i.paid)}` : (i.due_date ? `Due ${fmtDate(i.due_date)}` : (i.due_note || 'Due'));
    return {
      stack: [
        { text: `${i.label}${i.percent != null && i.percent !== '' ? ' · ' + Number(i.percent) + '%' : ''}`, fontSize: 7, color: C.text },
        { text: R(i.amount), bold: true, fontSize: 8.8, color: C.ink, margin: [0, 1, 0, 1] },
        { text: st, fontSize: 6.8, bold: true, color: tone },
        i.due_note && i.status !== 'paid' && i.due_date ? { text: i.due_note, fontSize: 6.4, color: C.muted } : null,
      ].filter(Boolean),
      _tone: tone,
    };
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 3) {
    const r = cells.slice(i, i + 3); while (r.length < 3) r.push({ text: '', _empty: true });
    rows.push(r);
  }
  const body = rows.map(r => r.flatMap((c, j) => (j ? [{ text: '', _gap: true }, c] : [c])));
  return {
    stack: [lbl('Payment Schedule', { margin: [0, 8, 0, 3] }), {
      table: { widths: ['*', 5, '*', 5, '*'], body: body.map(r => r.map(c => ({ ...c, border: c._gap || c._empty ? [false, false, false, false] : [true, true, true, true] }))) },
      layout: {
        hLineWidth: () => 0.5, hLineColor: () => C.line,
        vLineColor: (i, node, row) => (i % 2 === 0 ? (node.table.body[row]?.[i]?._tone || C.line) : C.line),
        vLineWidth: (i) => (i % 2 === 0 ? 2.2 : 0.5),
        paddingLeft: () => 6, paddingRight: () => 5, paddingTop: () => 4, paddingBottom: () => 4,
      },
    }],
  };
}

/** Pure builder (also used by the debug page with synthetic data). */
export async function buildInvoice({ inv, items, installments = [], customer, project }) {
  const isPaid = inv.status === 'paid';
  const sealSub = isPaid ? 'with thanks' : `${R(inv.balance)} due`;
  const title = gstOn() ? 'Tax Invoice' : 'Invoice';
  await primePayQr(); // load the uploaded merchant QR image (if any) before payBox runs
  const content = [
    await header({ title, number: inv.number, sealStatus: inv.status, sealSub }),
    infoStrip([
      partyBox('Billed To', customer?.name, [inv.party_name ? inv.party_name : null, ...custLines(customer)]),
      eventBox(project),
      [lbl('Details'), kv([
        ['Invoice Date', fmtDate(inv.invoice_date)],
        ['Due Date', fmtDate(inv.due_date)],
        project?.event_date ? ['Event Date', fmtDate(project.event_date)] : null,
        ['Status', cap(inv.status)],
        ['Amount Due', R(inv.balance), { color: Number(inv.balance) > 0 ? C.red : C.green }],
      ])],
    ].filter(Boolean), project ? [ '*', '*', 150 ] : ['*', 160]),
    itemsTable(items),
    {
      unbreakable: true, margin: [0, 12, 0, 0], columns: [
        {
          width: '*', stack: [
            { text: [{ text: 'Amount in words: ', italics: true }, { text: amountInWords(inv.total), bold: true, color: C.ink }], fontSize: 7.6, margin: [0, 0, 0, 8] },
            payBox(Number(inv.balance), [inv.number, inv.party_name].filter(Boolean).join(' · ')),
            scheduleBlock(installments, inv.paid_amount),
          ].filter(Boolean),
        },
        {
          width: 196, stack: [totalsBox([
            ...taxRows(inv),
            ['Grand Total', Number(inv.total), 'grand'],
            ['Received', R(inv.paid_amount), 'green'],
            ['Balance Due', R(inv.balance), 'red'],
          ])],
        },
      ], columnGap: 16,
    },
    notesBlock(inv.notes),
    termsAndSign(inv.terms ?? state.settings.terms),
    thankYou(),
  ].filter(Boolean);
  const fileName = `Invoice-${safeFilePart(inv.number)}-${safeFilePart(customer?.name)}.pdf`;
  return output(docDefinition({ title, number: inv.number, content, info: { subject: `Invoice for ${customer?.name || ''}` } }), fileName);
}

export async function buildQuotation({ q, items, customer, project }) {
  const title = 'Quotation';
  const name = customer?.name || q.guest_name || 'Guest';
  const content = [
    await header({ title, number: q.number, sealStatus: q.status === 'accepted' ? 'accepted' : 'quote', sealSub: q.valid_until ? `till ${fmtDate(q.valid_until).slice(0, 6)}` : null }),
    infoStrip([
      partyBox('Prepared For', name, [q.party_name ? q.party_name : null, ...(customer ? custLines(customer) : [])]),
      eventBox(project),
      [lbl('Details'), kv([
        ['Quote Date', fmtDate(q.quote_date)],
        ['Valid Until', fmtDate(q.valid_until)],
        project?.event_date ? ['Event Date', fmtDate(project.event_date)] : null,
        ['Status', cap(q.status)],
      ])],
    ].filter(Boolean), project ? ['*', '*', 150] : ['*', 160]),
    itemsTable(items),
    {
      unbreakable: true, margin: [0, 12, 0, 0], columns: [
        {
          width: '*', stack: [
            { text: [{ text: 'Amount in words: ', italics: true }, { text: amountInWords(q.total), bold: true, color: C.ink }], fontSize: 7.6, margin: [0, 0, 0, 8] },
            payBox(0, q.number, { showQr: false }),
          ].filter(Boolean),
        },
        { width: 196, stack: [totalsBox([...taxRows(q), ['Quoted Total', Number(q.total), 'grand']])] },
      ], columnGap: 16,
    },
    notesBlock(q.notes),
    termsAndSign(q.terms ?? state.settings.terms),
    thankYou('We look forward to capturing your moments.'),
  ].filter(Boolean);
  const fileName = `Quotation-${safeFilePart(q.number)}-${safeFilePart(name)}.pdf`;
  return output(docDefinition({ title, number: q.number, content }), fileName);
}

export async function buildReceipt({ r, inv, customer }) {
  const title = 'Payment Receipt';
  await primePayQr();
  const content = [
    await header({ title, number: r.number, sealStatus: 'received', sealSub: fmtDate(r.receipt_date).slice(0, 6) }),
    infoStrip([
      partyBox('Received From', customer?.name, custLines(customer)),
      inv ? [lbl('Against Invoice'), { text: inv.number, font: 'Serif', bold: true, fontSize: 9.8, color: C.ink, margin: [0, 0, 0, 2] }, { text: `Dated ${fmtDate(inv.invoice_date)}\nInvoice total ${R(inv.total)}`, fontSize: 7.6, lineHeight: 1.35 }] : null,
      [lbl('Details'), kv([['Receipt Date', fmtDate(r.receipt_date)], ['Payment Mode', r.mode || '—'], ['Receipt No.', r.number]])],
    ].filter(Boolean), inv ? ['*', '*', 150] : ['*', 160]),
    {
      table: {
        widths: ['*', 'auto'], body: [[
          { stack: [lbl('Amount Received'), { text: [{ text: 'Amount in words: ', italics: true }, { text: amountInWords(r.amount), bold: true, color: C.ink }], fontSize: 7.8 }], fillColor: C.grand, margin: [4, 4, 4, 4] },
          { text: RS(r.amount), font: 'Serif', bold: true, fontSize: 22, color: C.ink, alignment: 'right', fillColor: C.grand, margin: [6, 8, 6, 4], noWrap: true },
        ]],
      },
      layout: { hLineWidth: () => 1, vLineWidth: () => 0, hLineColor: () => C.gold, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
    },
    inv ? {
      margin: [0, 14, 0, 0], columns: [
        {
          width: '*', stack: [
            r.notes ? notesBlock(r.notes) : { text: 'This receipt confirms the payment received against the invoice mentioned above.', fontSize: 7.6, color: C.muted, margin: [0, 4, 0, 0] },
            // If a balance remains, show a large QR so the customer can pay the rest (Scan to pay ₹balance).
            Number(inv.balance) > 0 ? payBox(Number(inv.balance), [inv.number, inv.party_name].filter(Boolean).join(' · ')) : null,
          ].filter(Boolean),
        },
        { width: 196, stack: [totalsBox([['Invoice total', R(inv.total)], ['Total received to date', R(inv.paid_amount), 'green'], ['Balance due', R(inv.balance), 'red']])] },
      ], columnGap: 16, unbreakable: true,
    } : notesBlock(r.notes),
    termsAndSign(''),
    thankYou('Thank you for your payment.'),
  ].filter(Boolean);
  const fileName = `Receipt-${safeFilePart(r.number)}-${safeFilePart(customer?.name)}.pdf`;
  return output(docDefinition({ title, number: r.number, content }), fileName);
}

export async function buildLedger({ customer, invoices, payments, itemsByInv = new Map() }) {
  const title = 'Customer Ledger';
  await primePayQr();
  const today = todayIST();
  const rows = [
    ...invoices.map(i => ({ date: i.invoice_date, part: 'Invoice', ref: i.number, debit: Number(i.total), credit: 0, inv: i })),
    ...payments.map(p => ({ date: p.payment_date, part: `Payment received · ${p.mode || ''}`, ref: p._ref || '', debit: 0, credit: Number(p.amount) })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.debit - a.debit));
  let bal = 0;
  const body = [['Date', 'Particulars', 'Ref.', 'Debit', 'Credit', 'Balance'].map((t, i) => ({ text: t.toUpperCase(), fontSize: 6.6, characterSpacing: 1.2, bold: true, color: C.goldD, alignment: i >= 3 ? 'right' : 'left' }))];
  for (const r of rows) {
    bal = round2(bal + r.debit - r.credit);
    // For invoice rows, add a smaller muted line under "Invoice": "INV-0012 · Sadique & Afsha" + a short item summary.
    let particulars;
    if (r.inv) {
      const summary = itemSummary(itemsByInv.get(r.inv.id));
      const detail = [r.inv.number, r.inv.party_name].filter(Boolean).join(' · ');
      particulars = {
        stack: [
          { text: 'Invoice', color: C.ink },
          detail ? { text: detail, fontSize: 6.6, color: C.muted, margin: [0, 1, 0, 0] } : null,
          summary ? { text: summary, fontSize: 6.4, color: C.muted, italics: true, lineHeight: 1.2 } : null,
        ].filter(Boolean),
      };
    } else particulars = r.part;
    body.push([{ text: fmtDate(r.date), noWrap: true }, particulars, { text: r.ref, color: C.muted }, { text: r.debit ? R(r.debit) : '', alignment: 'right', noWrap: true },
      { text: r.credit ? R(r.credit) : '', alignment: 'right', color: C.green, noWrap: true }, { text: R(bal), alignment: 'right', bold: true, color: C.ink, noWrap: true }]);
  }
  const billed = round2(sum(invoices, i => i.total)); const paid = round2(sum(payments, p => p.amount)); const out = round2(billed - paid);
  body.push([{ text: 'Total', bold: true, colSpan: 3, color: C.ink }, {}, {}, { text: R(billed), alignment: 'right', bold: true, noWrap: true }, { text: R(paid), alignment: 'right', bold: true, color: C.green, noWrap: true }, { text: R(out), alignment: 'right', bold: true, color: out > 0 ? C.red : C.ink, noWrap: true }]);
  const first = rows[0]?.date;
  const ledNo = `LED-${today.replace(/-/g, '')}`;
  const content = [
    await header({ title, number: ledNo, sealStatus: out > 0 ? 'due' : 'clear', sealSub: out > 0 ? R(out) : 'no dues' }),
    infoStrip([
      partyBox('Customer', customer.name, custLines(customer)),
      [lbl('Period'), { text: first ? `${fmtDate(first)} – ${fmtDate(today)}` : fmtDate(today), bold: true, color: C.ink, fontSize: 9 }, { text: `${invoices.length} invoice(s) · ${payments.length} payment(s)`, fontSize: 7.6, margin: [0, 2, 0, 0] }],
      [lbl('Summary'), kv([['Total billed', R(billed)], ['Received', R(paid), { color: C.green }], ['Outstanding', R(out), { color: out > 0 ? C.red : C.green }]])],
    ], ['*', '*', 150]),
    {
      table: { headerRows: 1, dontBreakRows: true, widths: [58, '*', 62, 66, 66, 70], body },
      layout: {
        hLineWidth: (i, node) => (i <= 1 || i >= node.table.body.length - 1 ? 1 : 0.4),
        hLineColor: (i, node) => (i <= 1 || i >= node.table.body.length - 1 ? C.gold : C.line),
        vLineWidth: () => 0,
        fillColor: (row, node) => (row === 0 || row === node.table.body.length - 1 ? C.cream : row % 2 === 0 ? C.zebra : null),
        paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3.6, paddingBottom: () => 3.6,
      },
    },
    {
      unbreakable: true, margin: [0, 12, 0, 0], columns: [
        { width: '*', stack: [out > 0 ? { text: [{ text: 'Outstanding in words: ', italics: true }, { text: amountInWords(out), bold: true, color: C.ink }], fontSize: 7.6, margin: [0, 0, 0, 8] } : null, payBox(out, `Ledger ${customer.name}`)].filter(Boolean) },
        { width: 196, stack: [totalsBox([['Total billed', R(billed)], ['Received', R(paid), 'green'], ['Outstanding', out, 'grand']])] },
      ], columnGap: 16,
    },
    termsAndSign(''),
    thankYou('Thank you for your continued trust.'),
  ];
  const fileName = `Ledger-${safeFilePart(customer.name)}-${today}.pdf`;
  return output(docDefinition({ title, number: ledNo, content }), fileName);
}

// ---------- Employee work statement ----------
const TASK_LBL = { assigned: 'Assigned', in_progress: 'In progress', done: 'Done', cancelled: 'Cancelled' };
export const thCell = (t, right) => ({ text: t.toUpperCase(), fontSize: 6.6, characterSpacing: 1.2, bold: true, color: C.goldD, alignment: right ? 'right' : 'left' });
export const zebraLayout = (totalRows = 1) => ({
  hLineWidth: (i, node) => (i <= 1 || i >= node.table.body.length - totalRows ? 1 : 0.4),
  hLineColor: (i, node) => (i <= 1 || i >= node.table.body.length - totalRows ? C.gold : C.line),
  vLineWidth: () => 0,
  fillColor: (row, node) => (row === 0 || row >= node.table.body.length - totalRows ? C.cream : row % 2 === 0 ? C.zebra : null),
  paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3.6, paddingBottom: () => 3.6,
});
export function statBoxes(items) {
  const row = []; const widths = [];
  items.forEach(([label, value, opt = {}], i) => {
    if (i) { row.push({ text: '', border: [false, false, false, false] }); widths.push(8); }
    row.push({
      border: [true, true, true, true], fillColor: opt.grand ? C.grand : C.cream, margin: [3, 3, 3, 2],
      stack: [lbl(label), { text: value, font: 'Serif', bold: true, fontSize: 15, color: opt.color || C.ink, noWrap: true }, opt.sub ? { text: opt.sub, fontSize: 6.8, color: C.muted, margin: [0, 2, 0, 0] } : null].filter(Boolean),
    });
    widths.push('*');
  });
  return {
    margin: [0, 0, 0, 14], table: { widths, body: [row] },
    layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: (i) => C.line, vLineColor: () => C.line, paddingLeft: () => 7, paddingRight: () => 7, paddingTop: () => 6, paddingBottom: () => 6 },
  };
}

/** Pure builder. tasks / payouts: that member's rows (all time — pending is all-time). period: { from, to, label }. */
export async function buildStatement({ member, period, tasks, payouts }) {
  const title = 'Work Statement';
  const name = member.display_name || member.email;
  const mine = tasks.filter(t => t.member_id === member.id);
  const myPay = payouts.filter(p => p.member_id === member.id);
  const st = memberStats(member.id, mine, myPay, period);
  const cov = payCoverage(mine, myPay);
  const inP = d => !!d && d >= period.from && d <= period.to;
  const T = mine.filter(t => t.status !== 'cancelled' && inP(t.work_date)).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
  const P = myPay.filter(p => inP(p.payout_date)).sort((a, b) => String(a.payout_date).localeCompare(String(b.payout_date)));
  const tById = new Map(mine.map(t => [t.id, t]));
  const pending = Math.max(0, st.pending); const advance = st.pending < 0 ? -st.pending : 0;
  const number = `ST-${initials(name, 'TM')}-${period.from.replace(/-/g, '').slice(2)}`;
  const range = period.from === period.to ? fmtDate(period.from) : `${fmtDate(period.from)} – ${fmtDate(period.to)}`;

  const tBody = [['Date', 'Project', 'Work', 'Venue', 'Status', 'Amount'].map((t, i) => thCell(t, i === 5))];
  for (const t of T) {
    const c = cov.get(t.id);
    const stTxt = t.status === 'done' ? (c?.state === 'paid' ? 'Done · Paid' : c?.state === 'partial' ? 'Done · Part paid' : 'Done · Due') : TASK_LBL[t.status] || '';
    const tone = t.status === 'done' ? (c?.state === 'paid' ? C.green : C.goldD) : C.muted;
    tBody.push([
      t.end_date && t.end_date !== t.work_date ? { stack: [{ text: fmtDate(t.work_date), noWrap: true }, { text: 'to ' + fmtDate(t.end_date), noWrap: true, color: C.muted, fontSize: 7 }] } : { text: fmtDate(t.work_date), noWrap: true },
      { text: t.project_title || '—', color: C.ink },
      { text: [{ text: t.title || '', bold: true, color: C.ink }, t.details ? { text: '\n' + t.details, color: C.muted, fontSize: 7 } : ''] },
      { text: t.venue || '—', color: C.muted, fontSize: 7.6 },
      { text: stTxt, color: tone, bold: t.status === 'done', fontSize: 7.6 },
      { text: R(t.amount), alignment: 'right', bold: t.status === 'done', color: t.status === 'done' ? C.ink : C.muted, noWrap: true },
    ]);
  }
  if (!T.length) tBody.push([{ text: 'No work in this period.', colSpan: 6, color: C.muted, alignment: 'center' }, {}, {}, {}, {}, {}]);
  const totRows = [[{ text: 'Earned in period (done work)', bold: true, colSpan: 5, color: C.ink }, {}, {}, {}, {}, { text: R(st.earned), alignment: 'right', bold: true, color: C.ink, noWrap: true }]];
  if (st.scheduled > 0) totRows.push([{ text: 'Assigned / in progress (not yet earned)', colSpan: 5, color: C.muted }, {}, {}, {}, {}, { text: R(st.scheduled), alignment: 'right', color: C.muted, noWrap: true }]);
  tBody.push(...totRows);

  const pBody = [['Date', 'Mode', 'For / notes', 'Amount'].map((t, i) => thCell(t, i === 3))];
  for (const p of P) {
    const t = p.task_id ? tById.get(p.task_id) : null;
    pBody.push([fmtDate(p.payout_date), p.mode || '—', { text: [t ? `${t.title} (${fmtDate(t.work_date)})` : '', t && p.notes ? ' — ' : '', p.notes || ''].join('') || '—', color: C.muted },
      { text: R(p.amount), alignment: 'right', bold: true, color: C.green, noWrap: true }]);
  }
  if (!P.length) pBody.push([{ text: 'No payouts in this period.', colSpan: 4, color: C.muted, alignment: 'center' }, {}, {}, {}]);
  pBody.push([{ text: 'Received in period', bold: true, colSpan: 3, color: C.ink }, {}, {}, { text: R(st.received), alignment: 'right', bold: true, color: C.green, noWrap: true }]);

  const content = [
    await header({ title, number, sealStatus: pending > 0.009 ? 'pending' : 'settled', sealSub: pending > 0.009 ? R(pending) : 'no dues' }),
    infoStrip([
      partyBox('Team Member', name, [member.job_title, member.email, member.phone]),
      [lbl('Statement Period'), { text: range, font: 'Serif', bold: true, fontSize: 9.8, color: C.ink, margin: [0, 0, 0, 2] }, { text: period.label && period.label !== range ? period.label.split(' · ')[0] : '', fontSize: 7.6 }],
      [lbl('Details'), kv([['Statement No.', number], ['Generated', fmtDate(todayIST())], ['Earned (all time)', R(st.earnedAll)], ['Paid (all time)', R(st.paidAll), { color: C.green }]])],
    ], ['*', '*', 150]),
    statBoxes([
      ['Tasks', String(st.periodTasks), { sub: `${T.filter(t => t.status === 'done').length} done` }],
      ['Earned', RS(st.earned), { sub: 'Done work in period' }],
      ['Received', RS(st.received), { color: C.green, sub: 'Payouts in period' }],
      [advance ? 'Advance' : 'Pending', RS(advance || pending), { grand: true, color: pending > 0.009 ? C.red : C.ink, sub: 'All time · done − paid' }],
    ]),
    lbl('Work', { margin: [0, 0, 0, 4] }),
    { table: { headerRows: 1, dontBreakRows: true, widths: [54, '*', '*', 78, 56, 60], body: tBody }, layout: zebraLayout(totRows.length) },
    lbl('Payouts received', { margin: [0, 14, 0, 4] }),
    { table: { headerRows: 1, dontBreakRows: true, widths: [58, 70, '*', 70], body: pBody }, layout: zebraLayout(1) },
    {
      unbreakable: true, margin: [0, 12, 0, 0], columns: [
        {
          width: '*', margin: [0, 0, 0, 0], stack: [
            { text: 'Thank you for your great work.', font: 'Serif', italics: true, fontSize: 10, color: C.goldD, margin: [0, 0, 0, 2] },
            { text: 'Pending is all-time: the total of your done work minus all payouts received so far. Assigned or in-progress work is not counted until it is marked done.', fontSize: 7.4, color: C.muted, lineHeight: 1.35 },
          ],
        },
        {
          width: 150, stack: [
            { text: state.company?.name || 'Studio', font: 'Serif', italics: true, fontSize: 13, color: C.ink, alignment: 'center', margin: [0, 4, 0, 2] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.8, lineColor: C.gold }] },
            { text: 'AUTHORISED SIGNATORY', fontSize: 6.5, characterSpacing: 1.6, color: C.muted, alignment: 'center', margin: [0, 3, 0, 0] },
          ],
        },
      ], columnGap: 24,
    },
  ];
  const fileName = `Statement-${safeFilePart(name)}-${period.from}_${period.to}.pdf`;
  return output(docDefinition({ title, number, content, info: { subject: `Work statement for ${name}` } }), fileName);
}

// ---------- loaders (fetch data by id) ----------
export async function statementPdf(memberId, period) {
  const member = await getRow('members', memberId); if (!member) throw new Error('Team member not found');
  const [tasks, payouts] = await Promise.all([all('tasks'), all('payouts')]);
  return buildStatement({ member, period, tasks: tasks.filter(t => t.member_id === memberId), payouts: payouts.filter(p => p.member_id === memberId) });
}
export async function invoicePdf(id) {
  const inv = await getRow('invoices', id); if (!inv) throw new Error('Invoice not found');
  const [items, installments, customer, project] = await Promise.all([docItems('invoice', id), loadInst(id), getRow('customers', inv.customer_id), inv.project_id ? getRow('projects', inv.project_id) : null]);
  return buildInvoice({ inv, items, installments, customer, project });
}
export async function quotationPdf(id) {
  const q = await getRow('quotations', id); if (!q) throw new Error('Quotation not found');
  const [items, customer, project] = await Promise.all([docItems('quotation', id), q.customer_id ? getRow('customers', q.customer_id) : null, q.project_id ? getRow('projects', q.project_id) : null]);
  return buildQuotation({ q, items, customer, project });
}
export async function receiptPdf(id) {
  const r = await getRow('receipts', id); if (!r) throw new Error('Receipt not found');
  const [inv, customer] = await Promise.all([getRow('invoices', r.invoice_id), getRow('customers', r.customer_id)]);
  return buildReceipt({ r, inv, customer });
}
export async function ledgerPdf(customerId) {
  const customer = await getRow('customers', customerId); if (!customer) throw new Error('Customer not found');
  const [invoices, payments, receipts] = await Promise.all([all('invoices'), all('payments'), all('receipts')]);
  const myInv = invoices.filter(i => i.customer_id === customerId);
  const ids = new Set(myInv.map(i => i.id));
  const rcBy = new Map(receipts.map(r => [r.payment_id, r.number]));
  const myPay = payments.filter(p => ids.has(p.invoice_id)).map(p => ({ ...p, _ref: rcBy.get(p.id) || '' }));
  // Load the items for every invoice in one pass so the ledger can show a short item summary per invoice.
  const itemsByInv = await docItemsByDoc('invoice', myInv.map(i => i.id));
  return buildLedger({ customer, invoices: myInv, payments: myPay, itemsByInv });
}
