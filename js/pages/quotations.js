import { h, table, searchBox, chips, btn, iconBtn, ic } from '../dom.js';
import { toast, errMsg, confirmDialog, busy, openDrawer, currentDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, getRow, docItems, remove, lookups, convertQuotation, state } from '../store.js';
import { money, fmtDate, includesCI, debounce, todayIST, sum } from '../util.js';
import { QUOTE_STATUSES } from '../config.js';
import { quoteStatus, pageHead, recLink, itemsView, totalsView, dwSection, statRow, openRecord, partyLine } from './common.js';
import { openDocEditor } from './doc-editor.js';
import { sharePdf, quotationText, preOpenShareWindow } from '../share.js';

const UI = { status: '', q: '', sort: { key: 'Date', dir: -1 } };

function quoteShare(qt, customer, ch, win) {
  return sharePdf({
    make: async () => (await import('../pdf/docs.js')).quotationPdf(qt.id), channel: ch, win,
    phone: customer?.whatsapp || customer?.mobile, email: customer?.email,
    subject: `Quotation ${qt.number} from ${state.company?.name || 'Studio'}`, text: quotationText(qt, customer, ch === 'whatsapp'),
  });
}
async function shareById(id, ch, win) {
  const qt = await getRow('quotations', id); if (!qt) return;
  const c = qt.customer_id ? await getRow('customers', qt.customer_id) : null;
  return quoteShare(qt, c, ch, win);
}
async function convert(qt, button) {
  if (qt.converted_invoice_id) { openRecord('invoice', qt.converted_invoice_id); return; }
  if (!qt.customer_id) { toast('Add a customer to the quotation first (Edit → Customer).', 'warn'); return; }
  if (!(await confirmDialog(`Create an invoice from ${qt.number}? The quotation will be marked accepted.`, { okText: 'Convert' }))) return;
  await busy(button, async () => {
    try { const id = await convertQuotation(qt); toast('Invoice created from quotation', 'success'); openRecord('invoice', id); }
    catch (e) { toast(errMsg(e), 'error'); }
  });
}

/** preset: { customer, project, guest }. afterSave(saved) runs after every save (e.g. a lead moves to "Quote sent"). */
export function openQuotationEditor(id = null, { preset = {}, afterSave } = {}) {
  return openDocEditor('quotation', {
    id, preset, hash: id ? `/quotations/${id}/edit` : '/quotations/new',
    onSaved: (saved, action, win) => {
      if (afterSave) Promise.resolve(afterSave(saved)).catch(e => console.warn('afterSave', e));
      const d = currentDrawer();
      if (!(d && d.recId === saved.id)) openQuotationDrawer(saved.id);
      if (action === 'pdf') shareById(saved.id, 'download');
      if (action === 'whatsapp') shareById(saved.id, 'whatsapp', win);
    },
  });
}
export const routeNew = ({ query }) => openQuotationEditor(null, { preset: { customer: query.customer, project: query.project } });
export const routeEdit = ({ params }) => openQuotationEditor(params.id);
export const routeView = ({ params }) => openQuotationDrawer(params.id);

export async function renderList({ query, refresh }) {
  if (!refresh) { UI.status = query.status || ''; UI.q = query.q || ''; }
  const [{ cMap }, quotes] = await Promise.all([lookups(), all('quotations')]);
  const who = q => cMap.get(q.customer_id)?.name || q.guest_name || 'Guest';
  const today = todayIST();
  const sb = searchBox({ placeholder: 'Search number or customer…', 'aria-label': 'Search quotations', value: UI.q, wrapCls: 'grow' });
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const chipBar = chips([['', 'All', quotes.length], ...QUOTE_STATUSES.map(s => [s, s[0].toUpperCase() + s.slice(1), quotes.filter(x => x.status === s).length])], UI.status, v => { UI.status = v; draw(); }, 'Filter quotations by status');
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim();
    const rows = quotes.filter(x => (!UI.status || x.status === UI.status) && (!t || includesCI(x.number, t) || includesCI(who(x), t)));
    host.replaceChildren(table([
      { label: 'Number', sort: x => x.number, cell: x => [h('b', { class: 'mono' }, x.number), partyLine(x), x.converted_invoice_id ? h('small', null, 'converted to invoice') : null] },
      { label: 'Customer', sort: who, cell: who },
      { label: 'Date', sort: x => x.quote_date || '', sortDir: -1, cell: x => h('span', { class: 'nowrap' }, fmtDate(x.quote_date)) },
      { label: 'Valid until', sort: x => x.valid_until || '', cell: x => h('span', { class: 'nowrap ' + (x.valid_until && x.valid_until < today && !['accepted', 'rejected'].includes(x.status) ? 'dn' : 'muted') }, fmtDate(x.valid_until)) },
      { label: 'Total', cls: 'r', sort: x => Number(x.total), sortDir: -1, cell: x => h('span', { class: 'num' }, money(x.total)) },
      { label: 'Status', sort: x => x.status, cell: x => quoteStatus(x.status) },
    ], rows, {
      sort: UI.sort,
      onRow: x => openQuotationDrawer(x.id), rowLabel: x => 'Open quotation ' + x.number,
      actions: x => [
        iconBtn('eye', `View ${x.number}`, () => openQuotationDrawer(x.id)),
        iconBtn('download', `Download PDF of ${x.number}`, e => busy(e.currentTarget, () => shareById(x.id, 'download'))),
        iconBtn('whatsapp', `Send ${x.number} on WhatsApp`, e => { const w = preOpenShareWindow('whatsapp'); busy(e.currentTarget, () => shareById(x.id, 'whatsapp', w)); }, 'wa-ic'),
        !x.converted_invoice_id ? iconBtn('arrowRight', `Convert ${x.number} to invoice`, e => convert(x, e.currentTarget)) : null,
      ],
      emptyText: t || UI.status ? 'No quotations match these filters.' : 'No quotations yet. Send a quick price to a new enquiry.',
      emptyAction: btn('New quotation', () => openQuotationEditor(), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
    foot.textContent = rows.length ? `${rows.length} quotation${rows.length === 1 ? '' : 's'} · ${money(sum(rows, r => r.total))}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  if (!refresh && query.new) setTimeout(() => openQuotationEditor(null, { preset: { customer: query.customer } }), 0);
  return h('div', null,
    pageHead('Quotations', `${quotes.filter(x => ['draft', 'sent'].includes(x.status)).length} open`, [btn('New quotation', () => openQuotationEditor(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, chipBar), host, foot));
}

export function openQuotationDrawer(id) {
  const d = openDrawer({
    hash: '/quotations/' + id, label: 'Quotation',
    render: async () => {
      const qt = await getRow('quotations', id);
      if (!qt) { toast('Quotation not found.', 'warn'); return null; }
      const [items, customer, project] = await Promise.all([docItems('quotation', qt.id), qt.customer_id ? getRow('customers', qt.customer_id) : null, qt.project_id ? getRow('projects', qt.project_id) : null]);
      const share = ch => e => { const w = ch === 'whatsapp' ? preOpenShareWindow(ch) : null; busy(e.currentTarget, () => quoteShare(qt, customer, ch, w)); };
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Send by Gmail', icon: 'mail', onClick: () => quoteShare(qt, customer, 'gmail') }, '-',
        {
          text: 'Delete quotation', icon: 'trash', cls: 'danger', onClick: async () => {
            if (!(await confirmDialog(`Delete quotation ${qt.number}? This cannot be undone.`, { danger: true, okText: 'Delete' }))) return;
            try { await remove('quotations', qt.id); toast('Quotation deleted', 'success'); closeDrawerPanel(); } catch (e) { toast(errMsg(e), 'error'); }
          },
        },
      ]));
      const conv = btn(qt.converted_invoice_id ? 'Open invoice' : 'Convert to invoice', e => convert(qt, e.currentTarget), { cls: 'gold sm', icon: 'arrowRight' });
      return {
        title: `Quotation ${qt.number}`, badge: quoteStatus(qt.status),
        sub: `${qt.party_name ? qt.party_name + ' · ' : ''}${customer?.name || qt.guest_name || 'Guest'} · ${fmtDate(qt.quote_date)}${qt.valid_until ? ' · valid until ' + fmtDate(qt.valid_until) : ''}`,
        actions: h('div', { class: 'btns' }, btn('Edit', () => openQuotationEditor(qt.id), { icon: 'pencil', cls: 'sm' }), btn('PDF', share('download'), { icon: 'download', cls: 'sm' }), btn('WhatsApp', share('whatsapp'), { icon: 'whatsapp', cls: 'sm wa' }), conv, h('span', { class: 'grow' }), more),
        body: [
          statRow([['Quoted total', money(qt.total)], ['Valid until', fmtDate(qt.valid_until)], ['Status', qt.status ? qt.status[0].toUpperCase() + qt.status.slice(1) : 'Draft']]),
          h('div', { class: 'dw-grid' },
            h('div', { class: 'dw-box' }, h('div', { class: 'lbl' }, 'Prepared for'), customer ? recLink('customer', customer.id, customer.name) : h('b', null, qt.guest_name || 'Guest'), qt.party_name ? partyLine(qt) : null, customer ? h('small', null, [customer.mobile, customer.city].filter(Boolean).join(' · ')) : null),
            h('div', { class: 'dw-box' }, h('div', { class: 'lbl' }, 'Project'), project ? recLink('project', project.id, project.name) : h('span', { class: 'muted' }, 'No project'))),
          dwSection('Items', [itemsView(items), totalsView(qt)]),
          qt.notes || qt.terms ? dwSection('Notes & terms', [qt.notes ? h('div', { class: 'notes-box', style: { marginBottom: '10px' } }, qt.notes) : null, qt.terms ? h('div', { class: 'notes-box dim' }, qt.terms) : null]) : null,
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
