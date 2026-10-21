// Vendors (owner): print labs, album box makers, lamination, courier, designers. Rate cards, bills (expenses), paid / unpaid.
import { h, mount, table, field, input, textarea, btn, iconBtn, searchBox, chips, ic, pill, empty, nextId } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, insert, update, remove, getRow, state, markPaid, logActivity } from '../store.js';
import { money, fmtDate, includesCI, debounce, sum, num, round2 } from '../util.js';
import { VENDOR_KINDS, RATE_UNITS, vendorRates, vendorTotals } from '../bizcalc.js';
import { pageHead, dwSection, statRow, recLink } from './common.js';
import { openWhatsApp } from '../share.js';

const UI = { kind: '', q: '', sort: { key: 'Unpaid', dir: -1 } };
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const waText = v => [`Hello ${v.name},`, '', `This is ${state.company?.name || 'our studio'}.`, '', `— ${state.company?.name || 'Studio'}`].join('\n');

// ======================================================================
// Vendor form (with rate list editor)
// ======================================================================
export function openVendorForm(existing = null, preset = {}) {
  const v = existing || { kind: 'Print lab', rates: [], ...preset };
  const f = {
    name: input({ value: v.name || '', autocomplete: 'off', placeholder: 'e.g. Print Lab A' }),
    phone: input({ value: v.phone || '', type: 'tel', inputmode: 'tel', placeholder: '+91 …' }),
    notes: textarea({ value: v.notes || '', rows: 2, placeholder: 'Turnaround, contact person, account details…' }),
  };
  let kind = VENDOR_KINDS.includes(v.kind) ? v.kind : (v.kind || 'Other');
  const kinds = VENDOR_KINDS.includes(kind) ? VENDOR_KINDS : [kind, ...VENDOR_KINDS];
  let m;
  const kindChips = chips(kinds.map(k => [k, k]), kind, x => { kind = x; if (m) m.dirty = true; }, 'Vendor kind');
  kindChips.classList.add('src-chips');
  const rates = vendorRates(v).map(r => ({ item: r.item || '', unit: r.unit || '', rate: r.rate ?? '' }));
  const dl = h('datalist', { id: nextId('units') }, RATE_UNITS.map(u => h('option', { value: u })));
  const ratesHost = h('div', { class: 'rate-list' });
  const drawRates = (focusLast) => {
    mount(ratesHost, rates.length ? [h('div', { class: 'rate-row rate-head', 'aria-hidden': 'true' }, h('span', null, 'Item'), h('span', null, 'Unit'), h('span', { class: 'r' }, 'Rate (₹)'), h('span'))] : null,
      rates.length ? rates.map((r, i) => {
        const it = input({ value: r.item, placeholder: 'e.g. Lay-flat print 12×36', 'aria-label': `Rate ${i + 1} item` });
        const un = input({ value: r.unit, placeholder: 'sheet', list: dl.id, 'aria-label': `Rate ${i + 1} unit` });
        const rt = input({ type: 'number', min: '0', step: 'any', class: 'inp num', value: String(r.rate), placeholder: '0', 'aria-label': `Rate ${i + 1} amount` });
        it.addEventListener('input', () => (r.item = it.value)); un.addEventListener('input', () => (r.unit = un.value)); rt.addEventListener('input', () => (r.rate = rt.value));
        rt.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addRate(); } });
        return h('div', { class: 'rate-row' }, it, un, rt, h('div', { class: 'rate-x' },
          iconBtn('chevronLeft', `Move rate ${i + 1} up`, () => { if (i) { [rates[i - 1], rates[i]] = [rates[i], rates[i - 1]]; m.dirty = true; drawRates(); } }, 'rot90'),
          iconBtn('x', `Remove rate ${i + 1}`, () => { rates.splice(i, 1); m.dirty = true; drawRates(); }, 'danger')));
      }) : h('p', { class: 'dim small' }, 'No rates yet. Add the items you buy from this vendor — picking a rate fills the unit rate when you add a cost.'));
    if (focusLast) ratesHost.querySelectorAll('.rate-row:not(.rate-head)')[rates.length - 1]?.querySelector('input')?.focus();
  };
  const addRate = () => { rates.push({ item: '', unit: rates[rates.length - 1]?.unit || 'sheet', rate: '' }); if (m) m.dirty = true; drawRates(true); };
  drawRates();
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const save = btn(existing ? 'Save changes' : 'Add vendor', async () => {
    errBox.textContent = '';
    const name = f.name.value.trim();
    if (!name) { errBox.textContent = 'Vendor name is required.'; f.name.focus(); return; }
    const bad = rates.find(r => r.item.trim() && !(Number(r.rate) >= 0 && String(r.rate).trim() !== ''));
    if (bad) { errBox.textContent = `Enter a rate for “${bad.item.trim()}”.`; return; }
    const row = {
      name, kind, phone: f.phone.value.trim() || null, notes: f.notes.value.trim() || null,
      rates: rates.filter(r => r.item.trim()).map(r => ({ item: r.item.trim(), unit: r.unit.trim() || null, rate: round2(r.rate) })),
    };
    await busy(save, async () => {
      try {
        const saved = existing ? await update('vendors', existing.id, row) : await insert('vendors', row);
        if (!existing) logActivity(`Vendor ${saved.name} added`, '☺');
        toast(existing ? 'Vendor updated' : 'Vendor added', 'success'); m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: existing ? 'Edit vendor' : 'New vendor', guard: true, size: 'lg',
    body: [errBox, dl, h('form', { class: 'form-grid', novalidate: true, onsubmit: e => { e.preventDefault(); save.click(); } },
      field('Name', f.name, { required: true }), field('Phone / WhatsApp', f.phone),
      h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Kind'), kindChips),
      field('Notes', f.notes, { cls: 'full' }),
      h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Rate list'), ratesHost, h('div', null, btn('Add rate', addRate, { cls: 'sm', icon: 'plus' }))),
      h('button', { type: 'submit', hidden: true, tabindex: '-1' }))],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  return m.result;
}

async function deleteVendor(v) {
  const bills = (await all('expenses')).filter(e => e.vendor_id === v.id).length;
  if (!(await confirmDialog(`Delete vendor “${v.name}”?${bills ? ` Their ${bills} bill${bills === 1 ? '' : 's'} stay in Expenses without a vendor.` : ''}`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('vendors', v.id); toast('Vendor deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
const addBill = v => import('./expenses.js').then(m => m.openExpenseForm(null, { preset: { vendor_id: v.id, category: { 'Print lab': 'Printing', 'Album box': 'Album Box', Lamination: 'Lamination', Courier: 'Courier', Designer: 'Designer' }[v.kind] || 'Other', paid_status: 'unpaid' } }));

// ======================================================================
// Page
// ======================================================================
export const routeView = ({ params }) => openVendorDrawer(params.id);

export async function render({ query = {}, refresh } = {}) {
  if (!refresh && query.kind) UI.kind = query.kind;
  const [vendors, expenses] = await Promise.all([all('vendors'), all('expenses')]);
  const tot = new Map(vendors.map(v => [v.id, vendorTotals(v.id, expenses)]));
  const sb = searchBox({ placeholder: 'Search vendor, phone, rate item…', 'aria-label': 'Search vendors', value: UI.q, wrapCls: 'grow' });
  const kindChips = chips([['', 'All', vendors.length], ...VENDOR_KINDS.map(k => [k, k, vendors.filter(v => v.kind === k).length])], UI.kind, x => { UI.kind = x; draw(); }, 'Filter by kind');
  const kpiHost = h('div', { class: 'kpis' }); const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim();
    const rows = vendors.filter(v => (!UI.kind || v.kind === UI.kind) && (!t || includesCI(v.name, t) || includesCI(v.phone, t) || includesCI(v.kind, t) || vendorRates(v).some(r => includesCI(r.item, t))));
    const T = { billed: sum(rows, v => tot.get(v.id).billed), paid: sum(rows, v => tot.get(v.id).paid), unpaid: sum(rows, v => tot.get(v.id).unpaid) };
    const owing = rows.filter(v => tot.get(v.id).unpaid > 0).length;
    const k = (l, v, cls = '', d = '') => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v ' + cls }, v), d ? h('div', { class: 'd' }, d) : null);
    mount(kpiHost, k('Vendors', String(rows.length), '', `${VENDOR_KINDS.filter(x => rows.some(v => v.kind === x)).length} kinds`), k('Billed', money(T.billed), '', 'All linked bills & costs'), k('Paid', money(T.paid), 'up'), k('Unpaid', money(T.unpaid), T.unpaid ? 'warn' : '', `${owing} vendor${owing === 1 ? '' : 's'} to pay`));
    const tb = table([
      { label: 'Vendor', sort: v => v.name, cell: v => [h('b', null, v.name), h('small', null, v.phone || '—')] },
      { label: 'Kind', sort: v => v.kind || '', cell: v => h('span', { class: 'tag' }, v.kind || 'Other') },
      { label: 'Rates', sort: v => vendorRates(v).length, cell: v => { const r = vendorRates(v); return r.length ? [h('span', null, `${r.length} item${r.length === 1 ? '' : 's'}`), h('small', null, `${r[0].item} · ${money(r[0].rate)}${r[0].unit ? '/' + r[0].unit : ''}`)] : h('span', { class: 'dim' }, '—'); } },
      { label: 'Billed', cls: 'r', sort: v => tot.get(v.id).billed, sortDir: -1, cell: v => [h('span', { class: 'num' }, money(tot.get(v.id).billed)), h('small', null, `${tot.get(v.id).count} bill${tot.get(v.id).count === 1 ? '' : 's'}`)] },
      { label: 'Paid', cls: 'r', sort: v => tot.get(v.id).paid, sortDir: -1, cell: v => h('span', { class: 'num up' }, money(tot.get(v.id).paid)) },
      { label: 'Unpaid', cls: 'r', sort: v => tot.get(v.id).unpaid, sortDir: -1, cell: v => (tot.get(v.id).unpaid > 0 ? h('b', { class: 'num warn' }, money(tot.get(v.id).unpaid)) : h('span', { class: 'dim num' }, money(0))) },
    ], rows, {
      sort: UI.sort, onRow: v => openVendorDrawer(v.id), rowLabel: v => 'Open vendor ' + v.name,
      actions: v => [
        v.phone ? iconBtn('whatsapp', `WhatsApp ${v.name}`, () => openWhatsApp(v.phone, waText(v)), 'wa-ic') : null,
        v.phone ? iconBtn('phone', `Call ${v.name}`, () => { location.href = telHref(v.phone); }) : null,
        iconBtn('receipt', `Add bill from ${v.name}`, () => addBill(v)),
        iconBtn('pencil', `Edit ${v.name}`, () => openVendorForm(v)),
      ],
      emptyText: vendors.length ? 'No vendors match these filters.' : 'No vendors yet.',
      emptyAction: btn('New vendor', () => openVendorForm(), { cls: 'gold', icon: 'plus' }),
    });
    tb.querySelector?.('table')?.classList.add('stack');
    if (!vendors.length) mount(host, empty('Add your print lab, album box maker, lamination and courier with their rates. Album costs then fill themselves.', btn('New vendor', () => openVendorForm(), { cls: 'gold', icon: 'plus' }), { icon: 'truck', title: 'No vendors yet' }));
    else mount(host, tb);
    foot.textContent = rows.length ? `${rows.length} vendor${rows.length === 1 ? '' : 's'} · unpaid ${money(T.unpaid)}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  if (!refresh && query.new) setTimeout(() => openVendorForm(), 0);
  if (!refresh && query.edit) setTimeout(async () => { const v = await getRow('vendors', query.edit); if (v) openVendorForm(v); }, 0);
  return h('div', null,
    pageHead('Vendors', 'Labs, album boxes, lamination and courier — rates and what you owe them.', [btn('New vendor', () => openVendorForm(), { cls: 'gold', icon: 'plus' })]),
    kpiHost,
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb), h('div', { class: 'toolbar' }, kindChips), host, foot));
}

// ======================================================================
// Drawer
// ======================================================================
export function openVendorDrawer(id) {
  const d = openDrawer({
    hash: '/vendors/' + id, label: 'Vendor',
    render: async () => {
      const v = await getRow('vendors', id);
      if (!v) { toast('Vendor not found.', 'warn'); return null; }
      const [expenses, albums, customers] = await Promise.all([all('expenses'), all('album_orders').catch(() => []), all('customers')]);
      const aMap = new Map(albums.map(a => [a.id, a])); const cMap = new Map(customers.map(c => [c.id, c]));
      const t = vendorTotals(v.id, expenses);
      const bills = expenses.filter(e => e.vendor_id === v.id).sort((a, b) => String(b.expense_date || '').localeCompare(String(a.expense_date || '')));
      const unpaid = bills.filter(e => e.paid_status === 'unpaid');
      const rates = vendorRates(v);
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Edit vendor', icon: 'pencil', onClick: () => openVendorForm(v) }, '-',
        { text: 'Delete vendor', icon: 'trash', cls: 'danger', onClick: async () => { if (await deleteVendor(v)) closeDrawerPanel(); } },
      ]));
      const toggle = async (e, b) => busy(b, async () => {
        try { await update('expenses', e.id, { paid_status: e.paid_status === 'unpaid' ? 'paid' : 'unpaid' }); toast(e.paid_status === 'unpaid' ? `Marked paid · ${money(e.amount)}` : 'Marked unpaid', 'success'); }
        catch (er) { toast(errMsg(er), 'error'); }
      });
      const payAll = unpaid.length > 1 ? btn(`Mark all paid · ${money(t.unpaid)}`, async ev => {
        const b = ev.currentTarget;
        if (!(await confirmDialog(`Mark ${unpaid.length} unpaid bills from ${v.name} (${money(t.unpaid)}) as paid?`, { okText: 'Mark paid' }))) return;
        await busy(b, async () => { try { await markPaid(unpaid.map(e => e.id)); toast(`${v.name}: all bills paid`, 'success'); } catch (er) { toast(errMsg(er), 'error'); } });
      }, { cls: 'sm', icon: 'check' }) : null;
      const billRow = e => {
        const a = aMap.get(e.album_order_id);
        const b = e.paid_status === 'unpaid'
          ? btn('Mark paid', ev => toggle(e, ev.currentTarget), { cls: 'sm gold', icon: 'check', aria: `Mark ${e.description || e.category} paid` })
          : iconBtn('repeat', `Mark ${e.description || e.category} unpaid`, ev => toggle(e, ev.currentTarget));
        return h('div', { class: 'li bill-li' + (e.paid_status === 'unpaid' ? ' unpaid' : '') },
          h('div', null, h('button', { type: 'button', class: 'lnk', onclick: () => import('./expenses.js').then(m => m.openExpenseForm(e)) }, e.description || e.category),
            h('small', null, [fmtDate(e.expense_date), e.category, e.qty != null && e.unit_rate != null ? `${num(e.qty)} × ${money(e.unit_rate)}` : null].filter(Boolean).join(' · '),
              a ? [' · ', recLink('album', a.id, `${a.title || 'Album'} (${cMap.get(a.customer_id)?.name || '—'})`)] : null)),
          h('div', null, h('span', { class: 'amt' }, money(e.amount)), pill(e.paid_status === 'unpaid' ? 'Unpaid' : 'Paid', e.paid_status === 'unpaid' ? 's3' : 's2'), b));
      };
      return {
        title: v.name, badge: h('span', { class: 'tag' }, v.kind || 'Other'),
        sub: [v.phone, rates.length ? `${rates.length} rate${rates.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ') || 'Vendor',
        actions: h('div', { class: 'btns' },
          btn('Add bill', () => addBill(v), { cls: 'gold sm', icon: 'plus' }),
          v.phone ? btn('WhatsApp', () => openWhatsApp(v.phone, waText(v)), { cls: 'wa sm', icon: 'whatsapp' }) : null,
          v.phone ? h('a', { class: 'btn sm', href: telHref(v.phone) }, h('span', { class: 'bi' }, ic('phone', 15)), 'Call') : null,
          btn('Edit', () => openVendorForm(v), { cls: 'sm', icon: 'pencil' }),
          h('span', { class: 'grow' }), more),
        body: [
          statRow([['Billed', money(t.billed)], ['Paid', money(t.paid), 'up'], ['Unpaid', money(t.unpaid), t.unpaid ? 'warn' : '']]),
          dwSection('Rates', rates.length ? h('div', { class: 'rate-view' }, rates.map(r => h('div', { class: 'rv-row' }, h('span', null, r.item), h('span', { class: 'dim' }, r.unit ? 'per ' + r.unit : ''), h('b', { class: 'num' }, money(r.rate)))))
            : h('p', { class: 'dim small' }, 'No rates saved. ', h('button', { type: 'button', class: 'lnk', onclick: () => openVendorForm(v) }, 'Add rates'))),
          dwSection(`Bills & costs (${bills.length})`, bills.length ? h('div', null, bills.map(billRow)) : h('p', { class: 'dim small' }, 'No bills yet. Album job costs with this vendor appear here too.'), payAll),
          v.notes ? dwSection('Notes', h('div', { class: 'notes-box' }, v.notes)) : null,
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
