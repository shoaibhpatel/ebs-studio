import { h, mount, table, field, input, select, btn, iconBtn, pill, searchBox, chips, ic, nextId } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy } from '../ui.js';
import { all, insert, update, remove } from '../store.js';
import { money, fmtDate, todayIST, monthKey, monthLabel, includesCI, debounce, sum, round2, num } from '../util.js';
import { EXPENSE_CATEGORIES } from '../config.js';
import { ALBUM_COST_CATEGORIES, KIND_CATEGORY, vendorRates } from '../bizcalc.js';
import { attachCombo } from '../combo.js';
import { pageHead, recLink } from './common.js';

const UI = { month: null, cat: '', q: '', paid: '', sort: { key: 'Date', dir: -1 } };

/**
 * Expense / vendor bill / album job cost form.
 * opts.album: album order → "Add cost" mode (album categories as chips, qty defaults to the album's sheets for Printing).
 * opts.preset: initial values for a new expense (e.g. { vendor_id }).
 */
export async function openExpenseForm(existing = null, { preset = {}, album = null } = {}) {
  const [projects0, vendors0, albums0, customers] = await Promise.all([all('projects'), all('vendors').catch(() => []), all('album_orders').catch(() => []), all('customers')]);
  const projects = projects0.slice().sort((a, b) => a.name.localeCompare(b.name));
  const vendors = vendors0.slice().sort((a, b) => a.name.localeCompare(b.name));
  const albums = albums0.slice().sort((a, b) => String(a.title).localeCompare(String(b.title)));
  const cMap = new Map(customers.map(c => [c.id, c]));
  if (!album && existing?.album_order_id && preset.costMode) album = albums.find(a => a.id === existing.album_order_id) || null;
  const costMode = !!album;
  const e = existing || { expense_date: todayIST(), category: 'Printing', paid_status: costMode ? 'unpaid' : 'paid', qty: costMode ? '' : 1, ...preset };
  const f = {
    expense_date: input({ type: 'date', value: e.expense_date || todayIST() }),
    description: input({ value: e.description || '', placeholder: costMode ? 'e.g. Lay-flat print 12×36' : 'e.g. Album prints for Customer A' }),
    qty: input({ type: 'number', min: '0', step: 'any', class: 'inp num', value: e.qty ?? '' }),
    unit_rate: input({ type: 'number', min: '0', step: 'any', class: 'inp num', value: e.unit_rate ?? '' }),
    amount: input({ type: 'number', min: '0', step: 'any', class: 'inp num big-inp', value: e.amount ?? '' }),
    project_id: select([['', '— No project —'], ...projects.map(p => [p.id, p.name])], e.project_id || (album?.project_id ?? '')),
    album_order_id: select([['', '— No album —'], ...albums.map(a => [a.id, `${a.title || 'Album'} · ${cMap.get(a.customer_id)?.name || '—'}`])], e.album_order_id || ''),
  };
  let m;
  // ----- category -----
  let category = e.category || 'Printing'; let catTouched = !!existing;
  const catList = costMode ? (ALBUM_COST_CATEGORIES.includes(category) ? ALBUM_COST_CATEGORIES : [category, ...ALBUM_COST_CATEGORIES]) : (EXPENSE_CATEGORIES.includes(category) ? EXPENSE_CATEGORIES : [category, ...EXPENSE_CATEGORIES]);
  const catSel = select(catList, category);
  const catChips = chips(catList.map(c => [c, c]), category, v => { category = v; catTouched = true; if (m) m.dirty = true; qtyDefault(); }, 'Cost category');
  catChips.classList.add('src-chips');
  catSel.addEventListener('change', () => { category = catSel.value; catTouched = true; });
  const setCategory = c => { if (!c || !catList.includes(c)) return; category = c; catSel.value = c; catChips.set(c); qtyDefault(); };

  // ----- paid / unpaid -----
  let paid = e.paid_status === 'unpaid' ? 'unpaid' : 'paid';
  const paidChips = chips([['paid', 'Paid'], ['unpaid', 'Unpaid']], paid, v => { paid = v; if (m) m.dirty = true; }, 'Payment status');

  // ----- qty × rate → amount -----
  let qtyTouched = !!existing && e.qty != null && e.qty !== '';
  let amtTouched = false;
  const auto = () => { if (amtTouched) return; const q = Number(f.qty.value), r = Number(f.unit_rate.value); if (f.qty.value !== '' && f.unit_rate.value !== '') f.amount.value = String(round2(q * r)); };
  function qtyDefault() {
    if (!costMode || qtyTouched) return;
    f.qty.value = category === 'Printing' || category === 'Lamination' ? String(Number(album.sheets) || 1) : '1';
    auto();
  }
  f.qty.addEventListener('input', () => { qtyTouched = true; amtTouched = false; auto(); });
  f.unit_rate.addEventListener('input', () => { amtTouched = false; auto(); });
  f.amount.addEventListener('input', () => { amtTouched = f.amount.value !== '' && f.qty.value !== '' && f.unit_rate.value !== '' && Number(f.amount.value) !== round2(Number(f.qty.value) * Number(f.unit_rate.value)); });

  // ----- vendor combobox + rate list -----
  let vendorId = e.vendor_id || '';
  const vv = id => vendors.find(v => v.id === id);
  const vInp = input({ id: nextId('ev'), value: vv(vendorId)?.name || '', placeholder: 'Search vendor (optional)…' });
  const vHost = h('div', { class: 'cb-host' }, h('span', { class: 'cb-lead' }, ic('truck', 15)), vInp);
  const rateSel = select([['', '— Pick a rate —']], '', { 'aria-label': 'Vendor rate' });
  const rateField = field('Vendor rate', rateSel, { hint: 'Fills the unit rate' });
  let autoDesc = '';
  function drawRates() {
    const rates = vendorRates(vv(vendorId));
    mount(rateSel, h('option', { value: '' }, rates.length ? '— Pick a rate —' : '— No saved rates —'), rates.map((r, i) => h('option', { value: String(i) }, `${r.item} · ${money(r.rate)}${r.unit ? ' / ' + r.unit : ''}`)));
    rateSel.disabled = !rates.length;
    rateField.hidden = !vendorId;
  }
  rateSel.addEventListener('change', () => {
    const r = vendorRates(vv(vendorId))[Number(rateSel.value)]; if (!r || rateSel.value === '') return;
    f.unit_rate.value = String(Number(r.rate) || 0);
    if (!f.description.value.trim() || f.description.value === autoDesc) { f.description.value = r.item; autoDesc = r.item; }
    if (!qtyTouched && costMode) qtyDefault(); else if (f.qty.value === '') f.qty.value = '1';
    amtTouched = false; auto();
  });
  const setVendor = id => {
    vendorId = id || ''; vInp.value = vv(vendorId)?.name || '';
    const v = vv(vendorId);
    if (v && !catTouched && KIND_CATEGORY[v.kind]) setCategory(KIND_CATEGORY[v.kind]);
    drawRates();
  };
  async function newVendor(name) {
    const { openVendorForm } = await import('./vendors.js');
    const v = await openVendorForm(null, { name });
    if (v) { vendors.push(v); vendors.sort((a, b) => a.name.localeCompare(b.name)); setVendor(v.id); m.dirty = true; }
    vInp.focus();
  }
  attachCombo(vInp, {
    label: 'Vendors',
    source: q => {
      const t = q.trim(); const showAll = !t || t === (vv(vendorId)?.name || '');
      return vendors.filter(v => showAll || includesCI(v.name, t) || includesCI(v.kind, t) || includesCI(v.phone, t)).slice(0, 8)
        .map(v => ({ key: v.id, label: v.name, sub: [v.kind, v.phone].filter(Boolean).join(' · '), right: vendorRates(v).length ? `${vendorRates(v).length} rates` : null, data: v }));
    },
    extra: q => [
      { key: '+new', action: true, icon: 'plus', label: q.trim() && q.trim() !== (vv(vendorId)?.name || '') ? `New vendor “${q.trim()}”` : 'New vendor', data: { name: q.trim() !== (vv(vendorId)?.name || '') ? q.trim() : '' } },
      vendorId ? { key: 'none', action: true, icon: 'x', label: 'No vendor' } : null].filter(Boolean),
    onPick: o => { if (o.key === '+new') newVendor(o.data.name); else if (o.key === 'none') setVendor(''); else { setVendor(o.data.id); m.dirty = true; (rateSel.disabled ? f.qty : rateSel).focus(); } },
  });
  vInp.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === vInp) return;
    if (!vInp.value.trim()) { if (vendorId) setVendor(''); } else vInp.value = vv(vendorId)?.name || '';
  }, 150));
  drawRates();
  f.album_order_id.addEventListener('change', () => { const a = albums.find(x => x.id === f.album_order_id.value); if (a?.project_id && !f.project_id.value) f.project_id.value = a.project_id; });
  if (costMode && !existing) qtyDefault();

  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const save = btn(existing ? 'Save changes' : costMode ? 'Add cost' : 'Add expense', async () => {
    errBox.textContent = '';
    auto();
    const amount = Number(f.amount.value);
    if (f.amount.value === '' || !(amount >= 0)) { errBox.textContent = 'Enter the amount (or qty × unit rate).'; f.amount.focus(); return; }
    if (vInp.value.trim() && !vendorId) { errBox.textContent = 'Pick a vendor from the list, or add it as a new vendor.'; vInp.focus(); return; }
    const row = {
      expense_date: f.expense_date.value || todayIST(), category, description: f.description.value.trim() || null,
      qty: f.qty.value === '' ? null : Number(f.qty.value), unit_rate: f.unit_rate.value === '' ? null : Number(f.unit_rate.value),
      amount: round2(amount), paid_status: paid, project_id: f.project_id.value || null,
      vendor_id: vendorId || null, album_order_id: costMode ? album.id : (f.album_order_id.value || null),
    };
    await busy(save, async () => {
      try {
        const r = existing ? await update('expenses', existing.id, row) : await insert('expenses', row);
        toast(existing ? 'Saved' : costMode ? `Cost added · ${money(r.amount)}` : 'Expense added', 'success'); m.markClean(); m.close(r);
      } catch (er) { errBox.textContent = errMsg(er); }
    });
  }, { cls: 'gold', icon: 'check' });
  const footer = [btn('Cancel', () => m.request(), { cls: 'ghost' }), save];
  if (existing) footer.unshift(btn('Delete', async () => { if (await deleteExpense(existing)) { m.markClean(); m.close('deleted'); } }, { cls: 'danger ghost-danger', icon: 'trash' }), h('span', { class: 'grow' }));
  const vendorField = h('div', { class: 'field' }, h('label', { for: vInp.id }, 'Vendor'), vHost);
  m = openModal({
    title: existing ? (costMode ? 'Edit cost' : 'Edit expense') : costMode ? 'Add cost' : preset.vendor_id ? 'Add bill' : 'New expense', guard: true,
    head: costMode ? h('span', { class: 'tag' }, album.title || 'Album') : null,
    body: [errBox, h('div', { class: 'form-grid' },
      costMode
        ? [h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Category'), catChips),
          h('div', { class: 'info-box full cost-for' }, ic('album', 14), h('span', null, `${album.title || 'Album'} · ${cMap.get(album.customer_id)?.name || '—'}`), h('span', { class: 'dim' }, ` · ${num(album.sheets || 0)} sheets${album.size ? ' · ' + album.size : ''}${album.paper ? ' · ' + album.paper : ''}`))]
        : [field('Date', f.expense_date), field('Category', catSel)],
      vendorField, rateField,
      field('Description', f.description, { cls: 'full' }),
      field('Qty', f.qty, { hint: costMode && album.sheets ? `Album has ${album.sheets} sheets` : 'Optional' }), field('Unit rate (₹)', f.unit_rate, { hint: 'Qty × rate fills the amount' }),
      field('Amount (₹)', f.amount, { required: true }),
      h('div', { class: 'field' }, h('span', { class: 'flbl' }, 'Status'), paidChips),
      costMode ? field('Date', f.expense_date) : [field('Project', f.project_id), field('Album', f.album_order_id)])],
    footer,
  });
  return m.result;
}
export async function deleteExpense(e) {
  if (!(await confirmDialog(`Delete this ${e.category} expense of ${money(e.amount)}?`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('expenses', e.id); toast('Expense deleted', 'success'); return true; } catch (er) { toast(errMsg(er), 'error'); return false; }
}
export async function togglePaid(e) {
  try { await update('expenses', e.id, { paid_status: e.paid_status === 'unpaid' ? 'paid' : 'unpaid' }); toast(e.paid_status === 'unpaid' ? `Marked paid · ${money(e.amount)}` : 'Marked unpaid', 'success'); }
  catch (er) { toast(errMsg(er), 'error'); }
}

export async function render({ query, refresh }) {
  if (!refresh) { UI.month = query.month ?? monthKey(todayIST()); UI.cat = ''; UI.q = ''; UI.paid = query.status === 'unpaid' || query.status === 'paid' ? query.status : ''; if (query.status) UI.month = query.month ?? ''; }
  const [expenses, payments, projects, vendors, albums] = await Promise.all([all('expenses'), all('payments'), all('projects'), all('vendors').catch(() => []), all('album_orders').catch(() => [])]);
  const pMap = new Map(projects.map(p => [p.id, p])); const vMap = new Map(vendors.map(v => [v.id, v])); const aMap = new Map(albums.map(a => [a.id, a]));
  const months = [...new Set([monthKey(todayIST()), ...expenses.map(e => monthKey(e.expense_date))])].sort().reverse();
  const mSel = select([['', 'All months'], ...months.map(m => [m, monthLabel(m)])], UI.month, { 'aria-label': 'Filter by month' });
  const cSel = select([['', 'All categories'], ...EXPENSE_CATEGORIES], UI.cat, { 'aria-label': 'Filter by category' });
  const sb = searchBox({ placeholder: 'Search description, vendor, album…', 'aria-label': 'Search expenses', value: UI.q, wrapCls: 'grow' });
  const paidChips = chips([['', 'All'], ['paid', 'Paid'], ['unpaid', 'Unpaid', expenses.filter(e => e.paid_status === 'unpaid').length]], UI.paid, v => { UI.paid = v; draw(); }, 'Filter by payment status');
  const kpiHost = h('div', { class: 'kpis' }); const host = h('div');
  const draw = () => {
    UI.month = mSel.value; UI.cat = cSel.value; UI.q = sb.input.value;
    const mk = UI.month; const t = UI.q.trim();
    const rows = expenses.filter(e => (!mk || monthKey(e.expense_date) === mk) && (!UI.cat || e.category === UI.cat) && (!UI.paid || (e.paid_status === 'unpaid' ? 'unpaid' : 'paid') === UI.paid)
      && (!t || includesCI(e.description, t) || includesCI(e.category, t) || includesCI(vMap.get(e.vendor_id)?.name, t) || includesCI(aMap.get(e.album_order_id)?.title, t)));
    const rev = sum(payments.filter(p => !mk || monthKey(p.payment_date) === mk), p => p.amount);
    const inMonth = expenses.filter(e => !mk || monthKey(e.expense_date) === mk);
    const exp = sum(inMonth, e => e.amount); const unpaid = sum(rows.filter(e => e.paid_status === 'unpaid'), e => e.amount);
    const k = (l, v, cls = '') => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v ' + cls }, v));
    mount(kpiHost, k(mk ? `Revenue (${monthLabel(mk)})` : 'Revenue (all time)', money(rev), 'up'), k('Expenses', money(exp)), k('Unpaid (shown)', money(unpaid), unpaid ? 'warn' : ''), k('Net profit', money(rev - exp), rev - exp >= 0 ? 'up' : 'dn'));
    host.replaceChildren(table([
      { label: 'Date', sort: e => e.expense_date || '', sortDir: -1, cell: e => h('span', { class: 'nowrap' }, fmtDate(e.expense_date)) },
      { label: 'Category', sort: e => e.category, cell: e => h('span', { class: 'tag' }, e.category) },
      {
        label: 'Description', cell: e => [e.description || '—', (e.vendor_id && vMap.get(e.vendor_id)) || (e.album_order_id && aMap.get(e.album_order_id)) || (e.project_id && pMap.get(e.project_id))
          ? h('small', null, [vMap.get(e.vendor_id) ? recLink('vendor', e.vendor_id, vMap.get(e.vendor_id).name) : null, aMap.get(e.album_order_id) ? [vMap.get(e.vendor_id) ? ' · ' : '', recLink('album', e.album_order_id, aMap.get(e.album_order_id).title || 'Album')] : null,
            !e.album_order_id && pMap.get(e.project_id) ? [vMap.get(e.vendor_id) ? ' · ' : '', pMap.get(e.project_id).name] : null]) : null],
      },
      { label: 'Qty × Rate', cls: 'r', cell: e => h('span', { class: 'muted nowrap' }, e.qty != null && e.unit_rate != null ? `${num(e.qty)} × ${money(e.unit_rate)}` : '—') },
      { label: 'Amount', cls: 'r', sort: e => Number(e.amount), sortDir: -1, cell: e => h('b', { class: 'num' }, money(e.amount)) },
      { label: 'Status', sort: e => e.paid_status, cell: e => pill(e.paid_status === 'unpaid' ? 'Unpaid' : 'Paid', e.paid_status === 'unpaid' ? 's3' : 's2') },
    ], rows, {
      sort: UI.sort,
      onRow: e => openExpenseForm(e), rowLabel: e => `Edit expense ${e.description || e.category}`,
      actions: e => [
        e.paid_status === 'unpaid' ? btn('Mark paid', () => togglePaid(e), { cls: 'sm ghost', icon: 'check', aria: `Mark ${e.description || e.category} paid` }) : null,
        iconBtn('pencil', 'Edit expense', () => openExpenseForm(e)), iconBtn('trash', 'Delete expense', () => deleteExpense(e), 'danger')],
      emptyText: 'No expenses for this filter.', emptyAction: btn('Add expense', () => openExpenseForm(), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
  };
  [mSel, cSel].forEach(s => s.addEventListener('change', draw)); sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  return h('div', null,
    pageHead('Expenses', 'Track studio costs to see your real profit.', [btn('Add expense', () => openExpenseForm(), { cls: 'gold', icon: 'plus' })]),
    kpiHost,
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, mSel, cSel, h('span', { class: 'grow tb-sp' }), paidChips), host));
}
