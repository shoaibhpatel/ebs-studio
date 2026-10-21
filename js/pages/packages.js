// Packages: ready-made item sets inserted into invoices / quotations. List page (#/packages) + editor modal.
import { h, mount, table, field, input, textarea, btn, iconBtn, ic, toggle, pill, searchBox } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy } from '../ui.js';
import { all, savePackage, remove, packageItems, logActivity } from '../store.js';
import { money, round2, sum, isHeader, HEADER_FLAG, includesCI, debounce } from '../util.js';
import { pageHead } from './common.js';

const UI = { q: '', sort: { key: 'Package', dir: 1 } };
const blank = () => ({ description: '', detail: '', qty: 1, rate: 0 });
const header = (t = '') => ({ description: t, detail: HEADER_FLAG, qty: 0, rate: 0 });
const amountOf = it => round2((Number(it.qty) || 0) * (Number(it.rate) || 0));
/** Sum of the package's item rows (headers are qty 0 / rate 0). */
export const packageTotal = items => round2(sum(items.filter(x => !isHeader(x)), amountOf));
const realCount = items => items.filter(x => !isHeader(x)).length;

/**
 * Add / edit package modal. Resolves to the saved package or null.
 * preset.items: start with these rows (e.g. "Save these items as a package" from the invoice editor).
 */
export function openPackageForm(existing = null, preset = {}) {
  const p0 = existing || { active: true, ...preset };
  const items = (existing ? packageItems(existing) : preset.items || []).map(x => (isHeader(x) ? header(x.description || '') : { description: x.description || '', detail: x.detail || '', qty: Number(x.qty) || 0, rate: Number(x.rate) || 0 }));
  if (!items.some(x => !isHeader(x))) items.push(blank());
  const name = input({ value: p0.name || '', placeholder: 'e.g. Wedding Gold', autocomplete: 'off' });
  const desc = textarea({ value: p0.description || '', rows: 2, placeholder: 'Short description (for you)' });
  const act = toggle('Active — shown in the invoice / quotation editor', p0.active !== false);
  const price = input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', class: 'inp num', 'aria-label': 'Package price' });
  let auto = existing ? Math.abs(Number(existing.price || 0) - packageTotal(items)) < 0.01 || !Number(existing.price) : true;
  price.value = String(auto ? packageTotal(items) : Number(p0.price) || 0);
  const sumEl = h('b', { class: 'num' });
  const autoBtn = btn('Use item total', () => { auto = true; recalc(); price.focus(); }, { cls: 'sm ghost' });
  const priceNote = h('small', { class: 'hint' });
  price.addEventListener('input', () => { auto = false; recalc(false); });
  function recalc(setPrice = true) {
    const t = packageTotal(items);
    sumEl.textContent = money(t);
    if (auto && setPrice) price.value = String(t);
    const diff = round2((Number(price.value) || 0) - t);
    autoBtn.hidden = auto;
    priceNote.textContent = auto ? 'Price follows the item total.' : diff ? `Custom price · ${diff < 0 ? money(-diff) + ' below' : money(diff) + ' above'} the item total` : 'Custom price (same as the item total).';
  }

  // ---------- item rows (same UX as the invoice editor: grip drag, arrows, section headers) ----------
  const rowsHost = h('div', { class: 'it-rows', role: 'list', 'aria-label': 'Package items' });
  let dragFrom = -1; let m;
  const dirty = () => { if (m) m.dirty = true; };
  const grip = (idx, what) => {
    const b = h('button', { type: 'button', class: 'it-grip', 'aria-label': `Reorder ${what} ${idx + 1} (drag, or use arrow up / down)`, title: 'Drag to reorder' }, ic('grip', 15));
    b.addEventListener('keydown', e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(idx, e.key === 'ArrowUp' ? -1 : 1); } });
    b.addEventListener('pointerdown', () => { const r = b.closest('.it-row'); if (r) r.draggable = true; });
    return b;
  };
  const acts = (idx, what) => h('div', { class: 'it-actions' },
    iconBtn('copy', `Duplicate ${what} ${idx + 1}`, () => { items.splice(idx + 1, 0, { ...items[idx] }); draw(); recalc(); dirty(); }),
    iconBtn('trash', `Remove ${what} ${idx + 1}`, () => { items.splice(idx, 1); if (!items.some(x => !isHeader(x))) items.push(blank()); draw(); recalc(); dirty(); }, 'danger'));
  function rowEl(it, idx, no) {
    if (isHeader(it)) {
      const t = input({ value: it.description, class: 'inp it-sec-inp', placeholder: 'Section title, e.g. Day 1 · Haldi', 'aria-label': `Section header ${idx + 1}` });
      t.addEventListener('input', () => { it.description = t.value; });
      return h('div', { class: 'it-row it-sec', role: 'listitem', dataset: { i: String(idx) } }, grip(idx, 'section'), h('span', { class: 'it-n', 'aria-hidden': 'true' }, ic('heading', 14)), h('div', { class: 'it-sec-main' }, t), acts(idx, 'section'));
    }
    const amt = h('span', { class: 'it-amt' }, money(amountOf(it)));
    const nm = input({ value: it.description, class: 'inp it-name', placeholder: 'Item or service', 'aria-label': `Item ${no} name` });
    const dt = input({ value: it.detail, class: 'inp it-desc', placeholder: 'Add a description (optional)', 'aria-label': `Item ${no} description` });
    const qty = input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(it.qty), class: 'inp num it-qty', 'aria-label': `Item ${no} quantity` });
    const rate = input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(it.rate), class: 'inp num it-rate', 'aria-label': `Item ${no} rate` });
    const sync = () => { amt.textContent = money(amountOf(it)); recalc(); };
    nm.addEventListener('input', () => { it.description = nm.value; });
    dt.addEventListener('input', () => { it.detail = dt.value; });
    qty.addEventListener('input', () => { it.qty = qty.value === '' ? 0 : Number(qty.value); sync(); });
    rate.addEventListener('input', () => { it.rate = rate.value === '' ? 0 : Number(rate.value); sync(); });
    const order = [nm, dt, qty, rate];
    order.forEach((el, k) => el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault();
      if (k < order.length - 1) { order[k + 1].focus(); order[k + 1].select?.(); } else if (idx >= items.length - 1) addItem(); else focusRow(idx + 1);
    }));
    return h('div', { class: 'it-row', role: 'listitem', dataset: { i: String(idx) } },
      grip(idx, 'item'), h('span', { class: 'it-n' }, String(no)), h('div', { class: 'it-main' }, nm, dt),
      h('div', { class: 'it-c' }, h('span', { class: 'it-lbl' }, 'Qty'), qty),
      h('div', { class: 'it-c' }, h('span', { class: 'it-lbl' }, 'Rate'), rate),
      h('div', { class: 'it-c it-c-amt' }, h('span', { class: 'it-lbl' }, 'Amount'), amt), acts(idx, 'item'));
  }
  function draw() { let n = 0; mount(rowsHost, items.map((it, i) => rowEl(it, i, isHeader(it) ? 0 : ++n))); }
  function focusRow(i) { const el = rowsHost.querySelector(`.it-row[data-i="${i}"]`)?.querySelector('.it-name, .it-sec-inp'); el?.focus(); el?.select?.(); }
  function move(i, d) {
    const j = i + d; if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]]; draw(); dirty();
    rowsHost.querySelector(`.it-row[data-i="${j}"] .it-grip`)?.focus();
  }
  function addItem() { items.push(blank()); draw(); recalc(); focusRow(items.length - 1); dirty(); }
  function addHeader() { items.push(header('')); draw(); focusRow(items.length - 1); dirty(); }
  rowsHost.addEventListener('focusin', e => { const r = e.target.closest('.it-row'); rowsHost.querySelectorAll('.it-row.editing').forEach(x => { if (x !== r) x.classList.remove('editing'); }); r?.classList.add('editing'); });
  rowsHost.addEventListener('focusout', e => { const r = e.target.closest('.it-row'); if (r && !(e.relatedTarget && r.contains(e.relatedTarget))) setTimeout(() => { if (!r.contains(document.activeElement)) r.classList.remove('editing'); }, 0); });
  rowsHost.addEventListener('dragstart', e => {
    const r = e.target.closest?.('.it-row'); if (!r) return;
    dragFrom = Number(r.dataset.i); r.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch { /* ignore */ }
  });
  rowsHost.addEventListener('dragover', e => {
    if (dragFrom < 0) return; e.preventDefault();
    const r = e.target.closest('.it-row');
    rowsHost.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after'));
    if (r) { const b = r.getBoundingClientRect(); r.classList.add(e.clientY < b.top + b.height / 2 ? 'drop-before' : 'drop-after'); }
  });
  rowsHost.addEventListener('drop', e => {
    if (dragFrom < 0) return; e.preventDefault();
    const r = e.target.closest('.it-row');
    if (r) { let to = Number(r.dataset.i) + (r.classList.contains('drop-after') ? 1 : 0); const [it] = items.splice(dragFrom, 1); if (to > dragFrom) to--; items.splice(to, 0, it); dirty(); }
    dragFrom = -1; draw();
  });
  rowsHost.addEventListener('dragend', () => { dragFrom = -1; rowsHost.querySelectorAll('.it-row').forEach(x => { x.draggable = false; x.classList.remove('dragging', 'drop-before', 'drop-after'); }); });
  draw(); recalc();

  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const save = btn(existing ? 'Save package' : 'Create package', async () => {
    errBox.textContent = '';
    if (!name.value.trim()) { errBox.textContent = 'Package name is required.'; name.focus(); return; }
    const rows = items.filter(x => String(x.description || '').trim());
    if (!rows.some(x => !isHeader(x))) { errBox.textContent = 'Add at least one item.'; focusRow(0); return; }
    if (!(Number(price.value) >= 0)) { errBox.textContent = 'Price must be 0 or more.'; price.focus(); return; }
    await busy(save, async () => {
      try {
        const saved = await savePackage(existing, { name: name.value.trim(), description: desc.value.trim() || null, active: act.input.checked, price: Number(price.value) || 0, items: rows });
        if (!existing) logActivity(`Package “${saved.name}” created`, '✎');
        toast(existing ? 'Package saved' : `Package “${saved.name}” created`, 'success');
        m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: existing ? 'Edit package' : 'New package', size: 'lg', guard: true, cls: 'pkg-modal',
    body: [errBox,
      h('div', { class: 'form-grid' }, field('Package name', name, { required: true }), h('div', { class: 'field pkg-act' }, act.el), field('Description', desc, { cls: 'full' })),
      h('div', { class: 'pkg-items' },
        h('div', { class: 'it-row it-head', 'aria-hidden': 'true' }, h('span'), h('span', null, '#'), h('span', null, 'Item & description'), h('span', { class: 'r' }, 'Qty'), h('span', { class: 'r' }, 'Rate'), h('span', { class: 'r' }, 'Amount'), h('span')),
        rowsHost,
        h('div', { class: 'it-add' }, btn('Add item', addItem, { cls: 'sm', icon: 'plus' }), btn('Add section', addHeader, { cls: 'sm ghost', icon: 'heading' }))),
      h('p', { class: 'dim small pkg-help' }, 'Inserting a package adds its items (with their own rates) to the invoice or quotation. The package price is shown in the Packages menu as a guide.')],
    footer: [h('div', { class: 'pkg-foot' },
      h('span', { class: 'pkg-sum' }, h('small', null, 'Item total'), sumEl),
      h('label', { class: 'pkg-price' }, h('small', null, 'Package price'), price),
      autoBtn, priceNote),
    btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  return m.result;
}

async function deletePackage(p) {
  if (!(await confirmDialog(`Delete package “${p.name}”? Invoices that already used it are not changed.`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('packages', p.id); toast('Package deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
async function setActive(p, on) {
  try { await savePackage(p, { name: p.name, description: p.description, price: p.price, items: packageItems(p), active: on }); toast(`${p.name} ${on ? 'activated' : 'hidden from the editor'}`, 'success'); }
  catch (e) { toast(errMsg(e), 'error'); }
}

/** Compact list for the Settings page. */
export function packagesCard() {
  const host = h('div', { class: 'pkg-card' });
  const redraw = async () => {
    const list = (await all('packages').catch(() => [])).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const edit = async p => { await openPackageForm(p); redraw(); };
    const li = p => h('button', { type: 'button', class: 'li li-btn', onclick: () => edit(p) },
      h('div', null, h('b', null, p.name), h('small', null, `${realCount(packageItems(p))} items${p.description ? ' · ' + p.description : ''}`)),
      h('div', null, h('span', { class: 'amt' }, money(p.price)), p.active === false ? pill('Hidden', 's0') : null));
    mount(host, list.length ? list.slice(0, 6).map(li) : h('p', { class: 'dim small' }, 'No packages yet. A package is a ready-made set of items (e.g. Wedding Gold) you can insert into any invoice or quotation.'),
      h('div', { class: 'btns', style: { marginTop: '10px' } }, btn('New package', () => edit(null), { cls: 'sm', icon: 'plus' }), h('a', { class: 'btn sm ghost', href: '#/packages' }, list.length > 6 ? `All ${list.length} packages` : 'Manage packages')));
  };
  redraw();
  return host;
}

export async function render({ query = {}, refresh } = {}) {
  const pkgs = await all('packages');
  const sb = searchBox({ placeholder: 'Search packages…', 'aria-label': 'Search packages', value: UI.q, wrapCls: 'grow' });
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim();
    const rows = pkgs.filter(p => !t || includesCI(p.name, t) || includesCI(p.description, t) || packageItems(p).some(x => includesCI(x.description, t)));
    host.replaceChildren(table([
      { label: 'Package', sort: p => p.name, cell: p => [h('b', null, p.name), p.description ? h('small', null, p.description) : null] },
      { label: 'Items', cls: 'r', sort: p => realCount(packageItems(p)), cell: p => String(realCount(packageItems(p))) },
      { label: 'Item total', cls: 'r', sort: p => packageTotal(packageItems(p)), cell: p => h('span', { class: 'num muted' }, money(packageTotal(packageItems(p)))) },
      { label: 'Price', cls: 'r', sort: p => Number(p.price) || 0, sortDir: -1, cell: p => h('span', { class: 'num' }, money(p.price)) },
      { label: 'Status', sort: p => (p.active === false ? 1 : 0), cell: p => (p.active === false ? pill('Hidden', 's0') : pill('Active', 's2')) },
    ], rows, {
      sort: UI.sort, onRow: p => openPackageForm(p), rowLabel: p => 'Edit package ' + p.name, rowCls: p => (p.active === false ? 'row-dim' : null),
      actions: p => [
        iconBtn('copy', `Duplicate ${p.name}`, () => openPackageForm(null, { name: p.name + ' (copy)', description: p.description, items: packageItems(p) })),
        iconBtn(p.active === false ? 'eye' : 'x', p.active === false ? `Show ${p.name} in the editor` : `Hide ${p.name} from the editor`, () => setActive(p, p.active === false)),
        iconBtn('pencil', `Edit ${p.name}`, () => openPackageForm(p)),
        iconBtn('trash', `Delete ${p.name}`, () => deletePackage(p), 'danger'),
      ],
      emptyText: t ? 'No packages match your search.' : 'No packages yet. Create ready-made item sets like “Wedding Gold”.',
      emptyAction: btn('New package', () => openPackageForm(), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
    foot.textContent = rows.length ? `${rows.length} package${rows.length === 1 ? '' : 's'}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  if (!refresh && query.edit) setTimeout(() => { const p = pkgs.find(x => x.id === query.edit); if (p) openPackageForm(p); }, 0);
  if (!refresh && query.new) setTimeout(() => openPackageForm(), 0);
  return h('div', null,
    pageHead('Packages', 'Ready-made item sets for invoices and quotations', [
      h('a', { class: 'btn ghost', href: '#/settings' }, h('span', { class: 'bi' }, ic('chevronLeft', 15)), 'Settings'),
      btn('New package', () => openPackageForm(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb), host, foot));
}
