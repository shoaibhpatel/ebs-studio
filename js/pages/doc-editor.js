// Invoice / quotation editor — large centred modal ("Zoho style"):
// sticky header + footer, form on the left, live mini-A4 preview + totals on the right,
// item rows with type-ahead, section headers, drag to reorder, packages.
import { h, mount, field, input, textarea, select, btn, iconBtn, toggle, ic } from '../dom.js';
import { openModal, toast, errMsg, busy, confirmDialog, popMenu } from '../ui.js';
import { all, getRow, saveDoc, docItems, installments as loadInst, state, gstOn, saveCompany, packageItems, packageToDocItems } from '../store.js';
import { todayIST, addDays, addMonths, money, round2, computeTotals, num, fmtDate, isHeader, HEADER_FLAG, initials, amountInWords, daysBetween, debounce, includesCI } from '../util.js';
import { QUOTE_STATUSES } from '../config.js';
import { attachCombo } from '../combo.js';
import { preOpenShareWindow } from '../share.js';
import { openCustomerForm } from './customers.js';
import { invStatus, quoteStatus } from './common.js';

const blankItem = (sac = '') => ({ description: '', detail: '', sac, qty: 1, rate: 0 });
const headerItem = (title = '') => ({ description: title, detail: HEADER_FLAG, sac: '', qty: 0, rate: 0 });
const amountOf = it => round2((Number(it.qty) || 0) * (Number(it.rate) || 0));

/** Previously billed items: unique by name, with the latest rate. */
async function itemHistory() {
  const [ii, inv] = await Promise.all([all('invoice_items').catch(() => []), all('invoices').catch(() => [])]);
  const date = new Map(inv.map(i => [i.id, i.invoice_date || '']));
  const m = new Map();
  for (const it of ii) {
    if (isHeader(it) || !String(it.description || '').trim()) continue;
    const k = it.description.trim().toLowerCase(); const d = date.get(it.invoice_id) || '';
    const cur = m.get(k);
    if (!cur) m.set(k, { desc: it.description.trim(), rate: Number(it.rate) || 0, sac: it.sac || '', date: d, count: 1 });
    else { cur.count++; if (d > cur.date) Object.assign(cur, { rate: Number(it.rate) || 0, sac: it.sac || cur.sac, date: d }); }
  }
  return [...m.values()];
}

/**
 * Open the editor. Resolves to the saved document (or null).
 * onSaved(saved, action, win) — action: 'save' | 'pdf' | 'whatsapp'; win: pre-opened share tab (desktop WhatsApp).
 */
export async function openDocEditor(kind, { id = null, preset = {}, demo = false, onSaved, hash } = {}) {
  const isInv = kind === 'invoice';
  const T = isInv ? 'invoices' : 'quotations';
  const label = isInv ? 'Invoice' : 'Quotation';
  const existing = id ? await getRow(T, id) : null;
  if (id && !existing) { toast(`${label} not found.`, 'error'); return null; }

  const [customers0, projects, items0, inst0, packages, history] = await Promise.all([
    all('customers'), all('projects'), id ? docItems(kind, id) : [], id && isInv ? loadInst(id) : [],
    all('packages').catch(() => []), itemHistory(),
  ]);
  const customers = customers0.slice().sort((a, b) => a.name.localeCompare(b.name));
  const S = state.settings;
  const today = todayIST();
  const doc = existing ? { ...existing } : {
    customer_id: preset.customer || '', project_id: preset.project || '',
    discount_amount: 0, tax_percent: gstOn() ? Number(S.default_tax_percent) || 0 : 0,
    notes: '', terms: S.terms || '',
    ...(isInv ? { invoice_date: today, due_date: addDays(today, 15), recurring: false, recurring_active: true, recurring_next: null }
      : { quote_date: today, valid_until: addDays(today, 15), status: 'draft', guest_name: preset.guest || '' }),
  };
  // preset.items: prefilled rows for a new document (e.g. "Create invoice" from an album order).
  const src0 = items0.length ? items0 : (!existing && Array.isArray(preset.items) ? preset.items : []);
  const items = src0.length ? src0.map(i => ({ description: i.description || '', detail: i.detail || '', sac: i.sac || '', qty: Number(i.qty), rate: Number(i.rate) })) : [blankItem()];
  const inst = inst0.map(i => ({ label: i.label || '', percent: i.percent ?? '', amount: Number(i.amount) || 0, due_date: i.due_date || '', due_note: i.due_note || '' }));
  const showTax = gstOn() || Number(doc.tax_percent) > 0;
  const showSac = gstOn();
  const paid = existing && isInv ? Number(existing.paid_amount) || 0 : 0;
  const pkgs = packages.filter(p => p.active !== false).map(p => ({ ...p, items: packageItems(p) })).filter(p => p.items.length)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));

  let m; // modal api
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const schedule = debounce(() => { drawPreview(); }, 90);

  // ================= Customer combobox =================
  let custId = doc.customer_id || '';
  const custName = () => customers.find(c => c.id === custId)?.name || '';
  const custInp = input({ id: 'de-cust', value: custName(), placeholder: isInv ? 'Search or add a customer…' : 'Search customer (or leave empty for a guest)…' });
  const custMeta = h('small', { class: 'hint cust-meta' });
  const custHost = h('div', { class: 'cb-host' }, h('span', { class: 'cb-lead' }, ic('user', 15)), custInp);
  const setCustomer = (cid) => {
    const changed = cid !== custId;
    custId = cid || ''; custInp.value = custName();
    const c = customers.find(x => x.id === custId);
    custMeta.textContent = c ? [c.mobile, c.city, c.email].filter(Boolean).join(' · ') : '';
    if (changed) { doc.project_id = ''; fillProjects(); }
    if (guestWrap) guestWrap.hidden = !!custId;
    schedule();
  };
  async function newCustomer(name) {
    const c = await openCustomerForm(null, { name });
    if (c) { customers.push(c); customers.sort((a, b) => a.name.localeCompare(b.name)); setCustomer(c.id); m.dirty = true; }
    custInp.focus();
  }
  attachCombo(custInp, {
    label: 'Customers',
    source: q => {
      const t = q.trim(); const d = t.replace(/\D/g, '');
      const showAll = !t || t === custName();
      return customers.filter(c => showAll || includesCI(c.name, t) || includesCI(c.city, t) || (d.length >= 3 && String(c.mobile || '').replace(/\D/g, '').includes(d)))
        .slice(0, 8).map(c => ({ key: c.id, label: c.name, sub: [c.mobile, c.city].filter(Boolean).join(' · '), data: c }));
    },
    extra: q => [{ key: '+new', action: true, icon: 'plus', label: q.trim() && q.trim() !== custName() ? `New customer “${q.trim()}”` : 'New customer', data: { name: q.trim() !== custName() ? q.trim() : '' } }],
    onPick: o => { if (o.action) newCustomer(o.data.name); else { setCustomer(o.data.id); projSel.focus(); } },
  });
  custInp.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === custInp) return;
    if (!custInp.value.trim()) { if (custId) setCustomer(''); } else if (custInp.value !== custName()) custInp.value = custName();
  }, 150));

  // ================= Project / dates =================
  const projSel = select([['', '— No project —']], '', { id: 'de-proj' });
  function fillProjects() {
    const list = projects.filter(p => p.customer_id === custId);
    const cur = doc.project_id || '';
    mount(projSel, h('option', { value: '' }, list.length ? '— No project —' : custId ? '— No projects for this customer —' : '— Choose a customer first —'),
      list.map(p => h('option', { value: p.id }, `${p.name}${p.event_date ? ' · ' + fmtDate(p.event_date) : ''}`)));
    projSel.value = list.some(p => p.id === cur) ? cur : '';
    projSel.disabled = !list.length;
  }
  projSel.addEventListener('change', () => {
    doc.project_id = projSel.value;
    const p = projects.find(x => x.id === projSel.value);
    const real = items.filter(x => !isHeader(x));
    if (p && real.length === 1 && !real[0].description && !Number(real[0].rate)) {
      Object.assign(real[0], { description: `${p.type ? p.type + ' – ' : ''}${p.name}`, rate: Number(p.value) || 0 });
      drawItems(); recalc();
    }
    schedule();
  });
  const dateA = input({ type: 'date', value: (isInv ? doc.invoice_date : doc.quote_date) || today });
  const dateB = input({ type: 'date', value: (isInv ? doc.due_date : doc.valid_until) || '' });
  const DUE = isInv ? [['On receipt', 0], ['7 days', 7], ['15 days', 15], ['30 days', 30]] : [['7 days', 7], ['15 days', 15], ['30 days', 30]];
  const dueChips = h('div', { class: 'chips due-chips', role: 'group', 'aria-label': isInv ? 'Due in' : 'Valid for' });
  const drawDue = () => {
    const diff = dateA.value && dateB.value ? daysBetween(dateA.value, dateB.value) : null;
    mount(dueChips, DUE.map(([l, n]) => h('button', {
      type: 'button', class: 'chip sm', 'aria-pressed': String(diff === n),
      onclick: () => { dateB.value = addDays(dateA.value || today, n); m.dirty = true; drawDue(); schedule(); },
    }, l)));
  };
  dateA.addEventListener('input', () => { drawDue(); schedule(); });
  dateB.addEventListener('input', () => { drawDue(); schedule(); });
  // Per-document party / bride & groom name (e.g. "Sadique & Afsha"). Stored on the invoice/quotation.
  const party = input({ id: 'de-party', value: doc.party_name || '', placeholder: 'e.g. Sadique & Afsha', 'aria-label': 'Party / bride and groom name' });
  party.addEventListener('input', schedule);
  const guest = input({ value: doc.guest_name || '', placeholder: 'Name for a guest quotation' });
  guest.addEventListener('input', schedule);
  const guestWrap = isInv ? null : field('Guest name', guest, { hint: 'Used when no customer is selected' });
  if (guestWrap) guestWrap.hidden = !!custId;
  const qStatus = isInv ? null : select(QUOTE_STATUSES.map(s => [s, s[0].toUpperCase() + s.slice(1)]), doc.status || 'draft');
  const statusHost = h('span', { class: 'ed-status' });
  const drawStatus = () => mount(statusHost, isInv ? (existing ? invStatus(existing.status) : h('span', { class: 'st s0' }, 'New')) : quoteStatus(qStatus.value));
  qStatus?.addEventListener('change', () => { drawStatus(); schedule(); });

  // ================= Items =================
  const rowsHost = h('div', { class: 'it-rows', role: 'list', 'aria-label': 'Items' });
  const quick = () => (state.settings.quick_items || []).filter(q => q && q.desc);
  const suggest = q => {
    const t = q.trim().toLowerCase();
    const saved = quick().filter(x => !t || x.desc.toLowerCase().includes(t));
    const names = new Set(saved.map(x => x.desc.toLowerCase()));
    const hist = history.filter(x => !names.has(x.desc.toLowerCase()) && (!t || x.desc.toLowerCase().includes(t)) && x.desc.toLowerCase() !== t)
      .sort((a, b) => b.count - a.count || String(b.date).localeCompare(String(a.date)));
    return [
      ...saved.slice(0, 7).map(x => ({ key: 's:' + x.desc, label: x.desc, tag: 'Saved', right: Number(x.rate) ? money(x.rate) : 'rate later', data: { desc: x.desc, rate: Number(x.rate) || 0, sac: x.sac || '' } })),
      ...hist.slice(0, 6).map(x => ({ key: 'h:' + x.desc, label: x.desc, sub: x.date ? `Last billed ${fmtDate(x.date)}` : 'Used before', right: money(x.rate), data: { desc: x.desc, rate: x.rate, sac: x.sac } })),
    ];
  };
  async function saveAsQuick(it) {
    const desc = it.description.trim(); if (!desc) return;
    const list = quick().slice();
    if (list.some(q => q.desc.toLowerCase() === desc.toLowerCase())) { toast('Already in saved items', 'info'); return; }
    list.push({ desc, rate: Number(it.rate) || 0, ...(it.sac ? { sac: it.sac } : {}) });
    try { await saveCompany({ settings: { ...state.settings, quick_items: list } }); toast(`“${desc}” saved to your items`, 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }

  let dragFrom = -1;
  const handle = (idx, what) => {
    const b = h('button', { type: 'button', class: 'it-grip', 'aria-label': `Reorder ${what} ${idx + 1} (drag, or use arrow up / down)`, title: 'Drag to reorder' }, ic('grip', 15));
    b.addEventListener('keydown', e => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(idx, e.key === 'ArrowUp' ? -1 : 1, true); }
    });
    b.addEventListener('pointerdown', () => { const row = b.closest('.it-row'); if (row) row.draggable = true; });
    return b;
  };
  const rowActions = (idx, what) => h('div', { class: 'it-actions' },
    iconBtn('copy', `Duplicate ${what} ${idx + 1}`, () => { items.splice(idx + 1, 0, { ...items[idx] }); drawItems(); recalc(); focusRow(idx + 1); m.dirty = true; }),
    iconBtn('trash', `Remove ${what} ${idx + 1}`, () => { items.splice(idx, 1); if (!items.some(x => !isHeader(x))) items.push(blankItem()); drawItems(); recalc(); focusRow(Math.min(idx, items.length - 1)); m.dirty = true; }, 'danger'));

  function rowEl(it, idx, no) {
    if (isHeader(it)) {
      const t = input({ value: it.description, class: 'inp it-sec-inp', placeholder: 'Section title, e.g. Day 1 · Haldi', 'aria-label': `Section header ${idx + 1}` });
      t.addEventListener('input', () => { it.description = t.value; schedule(); });
      t.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); nextFrom(idx); } });
      return h('div', { class: 'it-row it-sec', role: 'listitem', dataset: { i: String(idx) } },
        handle(idx, 'section'), h('span', { class: 'it-n', 'aria-hidden': 'true' }, ic('heading', 14)),
        h('div', { class: 'it-sec-main' }, t), rowActions(idx, 'section'));
    }
    const amt = h('span', { class: 'it-amt' }, money(amountOf(it)));
    const name = input({ value: it.description, class: 'inp it-name', placeholder: 'Type an item or service…', 'aria-label': `Item ${no} name` });
    const desc = input({ value: it.detail, class: 'inp it-desc', placeholder: 'Add a description (optional)', 'aria-label': `Item ${no} description` });
    const sac = input({ value: it.sac, class: 'inp it-sac', placeholder: 'SAC', 'aria-label': `Item ${no} SAC code`, inputmode: 'numeric' });
    const qty = input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(it.qty), class: 'inp num it-qty', 'aria-label': `Item ${no} quantity` });
    const rate = input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(it.rate), class: 'inp num it-rate', 'aria-label': `Item ${no} rate` });
    const nameHost = h('div', { class: 'cb-host' }, name);
    const sync = () => { amt.textContent = money(amountOf(it)); recalc(); };
    attachCombo(name, {
      label: 'Saved and recent items', maxHeight: '300px',
      source: suggest,
      extra: q => {
        const t = q.trim();
        if (!t || quick().some(x => x.desc.toLowerCase() === t.toLowerCase())) return [];
        return [{ key: '+save', action: true, icon: 'bookmark', label: `Save “${t}” as a new item`, data: { save: true } }];
      },
      onPick: async (o, q) => {
        if (o.data.save) { it.description = q.trim(); name.value = it.description; await saveAsQuick(it); schedule(); return; }
        it.description = o.data.desc; name.value = it.description;
        if (o.data.rate) { it.rate = o.data.rate; rate.value = String(it.rate); }
        if (o.data.sac && !it.sac) { it.sac = o.data.sac; sac.value = it.sac; }
        m.dirty = true; sync(); qty.focus(); qty.select();
      },
    });
    name.addEventListener('input', () => { it.description = name.value; schedule(); });
    desc.addEventListener('input', () => { it.detail = desc.value; schedule(); });
    sac.addEventListener('input', () => { it.sac = sac.value; });
    qty.addEventListener('input', () => { it.qty = qty.value === '' ? 0 : Number(qty.value); sync(); });
    rate.addEventListener('input', () => { it.rate = rate.value === '' ? 0 : Number(rate.value); sync(); });
    const order = [name, desc, ...(showSac ? [sac] : []), qty, rate];
    order.forEach((el, k) => el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' || e.defaultPrevented || e.isComposing) return;
      e.preventDefault();
      if (k < order.length - 1) { order[k + 1].focus(); order[k + 1].select?.(); } else nextFrom(idx);
    }));
    return h('div', { class: 'it-row', role: 'listitem', dataset: { i: String(idx) } },
      handle(idx, 'item'), h('span', { class: 'it-n' }, String(no)),
      h('div', { class: 'it-main' }, nameHost, desc),
      showSac ? h('div', { class: 'it-c it-c-sac' }, h('span', { class: 'it-lbl' }, 'SAC'), sac) : null,
      h('div', { class: 'it-c' }, h('span', { class: 'it-lbl' }, 'Qty'), qty),
      h('div', { class: 'it-c' }, h('span', { class: 'it-lbl' }, 'Rate'), rate),
      h('div', { class: 'it-c it-c-amt' }, h('span', { class: 'it-lbl' }, 'Amount'), amt),
      rowActions(idx, 'item'));
  }
  function nextFrom(idx) {
    if (idx >= items.length - 1) { addItem(); return; }
    focusRow(idx + 1);
  }
  function focusRow(i, sel) {
    const row = rowsHost.querySelector(`.it-row[data-i="${i}"]`);
    const el = row?.querySelector(sel || '.it-name, .it-sec-inp');
    el?.focus(); el?.select?.();
  }
  function drawItems() {
    let n = 0;
    mount(rowsHost, items.map((it, i) => rowEl(it, i, isHeader(it) ? 0 : ++n)));
  }
  function move(i, d, keepFocus) {
    const j = i + d; if (j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]]; drawItems(); recalc(); m.dirty = true;
    if (keepFocus) rowsHost.querySelector(`.it-row[data-i="${j}"] .it-grip`)?.focus();
  }
  function addItem(preset) {
    const lastReal = [...items].reverse().find(x => !isHeader(x));
    items.push({ ...blankItem(lastReal?.sac || ''), ...(preset || {}) });
    drawItems(); recalc(); focusRow(items.length - 1); m && (m.dirty = true);
  }
  function addHeader() { items.push(headerItem('')); drawItems(); focusRow(items.length - 1); m.dirty = true; }
  function insertPackage(p) {
    const add = packageToDocItems(p);
    const real = items.filter(x => !isHeader(x));
    if (items.length === 1 && real.length === 1 && !real[0].description && !Number(real[0].rate)) items.splice(0, 1);
    items.push(...add); drawItems(); recalc(); m.dirty = true;
    toast(`Package “${p.name}” added (${add.filter(x => !isHeader(x)).length} items)`, 'success');
  }
  // Active row highlight
  rowsHost.addEventListener('focusin', e => {
    const row = e.target.closest('.it-row');
    rowsHost.querySelectorAll('.it-row.editing').forEach(r => { if (r !== row) r.classList.remove('editing'); });
    row?.classList.add('editing');
  });
  rowsHost.addEventListener('focusout', e => {
    const row = e.target.closest('.it-row');
    if (row && !(e.relatedTarget && row.contains(e.relatedTarget))) setTimeout(() => { if (!row.contains(document.activeElement)) row.classList.remove('editing'); }, 0);
  });
  rowsHost.addEventListener('click', e => {
    const row = e.target.closest('.it-row');
    if (row && !e.target.closest('input,button,select')) row.querySelector('.it-name, .it-sec-inp')?.focus();
  });
  // Drag & drop reorder (handle only)
  rowsHost.addEventListener('dragstart', e => {
    const row = e.target.closest?.('.it-row'); if (!row) return;
    dragFrom = Number(row.dataset.i); row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(dragFrom)); } catch { /* ignore */ }
  });
  rowsHost.addEventListener('dragover', e => {
    if (dragFrom < 0) return; e.preventDefault();
    const row = e.target.closest('.it-row');
    rowsHost.querySelectorAll('.drop-before,.drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));
    if (row) { const r = row.getBoundingClientRect(); row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after'); }
  });
  rowsHost.addEventListener('drop', e => {
    if (dragFrom < 0) return; e.preventDefault();
    const row = e.target.closest('.it-row');
    if (row) {
      let to = Number(row.dataset.i) + (row.classList.contains('drop-after') ? 1 : 0);
      const [it] = items.splice(dragFrom, 1); if (to > dragFrom) to--;
      items.splice(to, 0, it); m.dirty = true;
    }
    dragFrom = -1; drawItems(); recalc();
  });
  rowsHost.addEventListener('dragend', () => { dragFrom = -1; rowsHost.querySelectorAll('.it-row').forEach(r => { r.draggable = false; r.classList.remove('dragging', 'drop-before', 'drop-after'); }); });

  const newPackage = async () => {
    const { openPackageForm } = await import('./packages.js');
    const p = await openPackageForm(null, { items: items.filter(x => isHeader(x) || String(x.description || '').trim()).map(x => ({ description: x.description, detail: x.detail, qty: x.qty, rate: x.rate })) });
    if (p && p.active !== false) { const it = packageItems(p); if (it.length) pkgs.push({ ...p, items: it }); }
  };
  const pkgBtn = btn('Packages', e => popMenu(e.currentTarget, [
    ...(pkgs.length ? [{ label: 'Insert a package', sub: 'Adds its items below' }, ...pkgs.map(p => ({ text: `${p.name}${Number(p.price) ? ' · ' + money(p.price) : ''}`, icon: 'package', onClick: () => insertPackage(p) })), '-'] : [{ label: 'No packages yet', sub: 'Save ready-made item sets' }]),
    { text: 'Save these items as a package…', icon: 'bookmark', onClick: newPackage },
  ], { align: 'left' }), { cls: 'sm ghost', icon: 'package' });
  const itemsHead = h('div', { class: 'it-row it-head', 'aria-hidden': 'true' },
    h('span'), h('span', null, '#'), h('span', null, 'Item & description'), showSac ? h('span', null, 'SAC') : null,
    h('span', { class: 'r' }, 'Qty'), h('span', { class: 'r' }, 'Rate'), h('span', { class: 'r' }, 'Amount'), h('span'));

  // ================= Totals =================
  let discMode = '₹';
  const discPctInit = 0;
  const disc = input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: String(Number(doc.discount_amount) || discPctInit), class: 'inp num', id: 'de-disc', 'aria-label': 'Discount' });
  const tax = input({ type: 'number', min: '0', max: '100', step: 'any', inputmode: 'decimal', value: String(Number(doc.tax_percent) || 0), class: 'inp num', id: 'de-tax', 'aria-label': gstOn() ? 'GST percent' : 'Tax percent' });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Discount type' });
  const drawSeg = () => mount(seg, ['₹', '%'].map(k => h('button', {
    type: 'button', 'aria-pressed': String(discMode === k), 'aria-label': k === '%' ? 'Discount in percent' : 'Discount in rupees',
    onclick: () => {
      if (discMode === k) return;
      const sub = computeTotals(items, 0, 0).subtotal;
      const v = Number(disc.value) || 0;
      disc.value = String(k === '%' ? (sub ? round2(v / sub * 100) : 0) : round2(sub * v / 100));
      discMode = k; drawSeg(); recalc();
    },
  }, k)));
  drawSeg();
  disc.addEventListener('input', recalc); tax.addEventListener('input', recalc);
  const T_ = {}; const val = k => (T_[k] = h('span', { class: 'v' }));
  const discLine = h('small', { class: 'muted disc-amt' });
  const cgstRow = h('div', { class: 'tr muted' }, h('span', { class: 'cg-l' }), val('cgst'));
  const sgstRow = h('div', { class: 'tr muted' }, h('span', { class: 'sg-l' }), val('sgst'));
  const taxRow = h('div', { class: 'tr muted' }, h('span', { class: 'tx-l' }), val('tax'));
  const capWarn = h('small', { class: 'warn', hidden: true }, 'Discount is more than the subtotal; it will be capped.');
  const totalsPanel = h('div', { class: 'totals ed-totals' },
    h('div', { class: 'tr' }, h('span', null, 'Subtotal'), val('sub')),
    h('div', { class: 'tr tr-inp' }, h('label', { for: 'de-disc' }, 'Discount'), h('div', { class: 'disc-ctl' }, disc, seg)),
    h('div', { class: 'tr tr-sub' }, h('span'), discLine), capWarn,
    showTax ? h('div', { class: 'tr tr-inp' }, h('label', { for: 'de-tax' }, gstOn() ? 'GST %' : 'Tax %'), tax) : null,
    showTax ? [cgstRow, sgstRow, taxRow] : null,
    h('div', { class: 'tr grand' }, h('span', null, 'Total'), val('total')),
    paid > 0 ? h('div', { class: 'tr' }, h('span', null, 'Already received'), h('span', { class: 'up' }, money(paid))) : null,
    isInv ? h('div', { class: 'tr bal' }, h('span', null, 'Balance due'), val('bal')) : null);
  const sumTotal = h('b', { class: 'sum-v' }); const sumBal = h('b', { class: 'sum-v2' });
  const footSum = h('div', { class: 'ed-sum', 'aria-live': 'polite' },
    h('div', null, h('span', null, 'Total'), sumTotal),
    isInv ? h('div', null, h('span', null, 'Balance'), sumBal) : null,
    h('div', { class: 'ed-count' }, h('span', null, 'Items'), h('b', { class: 'cnt-v' })));

  let current = computeTotals(items, 0, 0);
  const discAmount = () => {
    const v = Math.max(0, Number(disc.value) || 0);
    return discMode === '%' ? round2(computeTotals(items, 0, 0).subtotal * Math.min(v, 100) / 100) : v;
  };
  function recalc() {
    current = computeTotals(items, discAmount(), showTax ? tax.value : 0);
    const t = current;
    T_.sub.textContent = money(t.subtotal);
    discLine.textContent = t.discount_amount > 0 ? `– ${money(t.discount_amount)}` : '';
    capWarn.hidden = !(discMode === '₹' && Number(disc.value) > t.subtotal && t.subtotal > 0);
    if (showTax) {
      const half = round2(t.tax_amount / 2); const p2 = num(Number(tax.value) / 2);
      const g = gstOn() && t.tax_amount > 0;
      cgstRow.hidden = sgstRow.hidden = !g; taxRow.hidden = gstOn() || !(t.tax_amount > 0);
      cgstRow.firstChild.textContent = `CGST @ ${p2}%`; sgstRow.firstChild.textContent = `SGST @ ${p2}%`;
      T_.cgst.textContent = money(half); T_.sgst.textContent = money(round2(t.tax_amount - half));
      taxRow.firstChild.textContent = `Tax @ ${num(tax.value)}%`; T_.tax.textContent = money(t.tax_amount);
    }
    T_.total.textContent = money(t.total);
    const bal = round2(t.total - paid);
    if (T_.bal) { T_.bal.textContent = money(bal); T_.bal.className = 'v ' + (bal > 0 ? 'warn' : 'up'); }
    sumTotal.textContent = money(t.total); sumBal.textContent = money(bal);
    footSum.querySelector('.cnt-v').textContent = String(items.filter(x => !isHeader(x) && (x.description || Number(x.rate))).length);
    if (isInv) drawInst(false);
    schedule();
  }

  // ================= Payment schedule (invoice) =================
  const instHost = h('div');
  const instSum = h('div', { class: 'small inst-sum' });
  function drawInst(full = true) {
    if (!isInv) return;
    for (const i of inst) if (i.percent !== '' && i.percent != null) i.amount = round2(current.total * Number(i.percent) / 100);
    if (full) {
      mount(instHost, inst.length ? [h('div', { class: 'inst-row inst-head', 'aria-hidden': 'true' }, h('span', null, 'Label'), h('span', null, '%'), h('span', null, 'Amount'), h('span', null, 'Due date'), h('span', null, 'Due note'), h('span'))] : h('p', { class: 'dim small' }, 'No schedule. Use a preset or add installments.'),
        inst.map((x, i) => {
          const lab = input({ value: x.label, placeholder: 'e.g. Advance', 'aria-label': `Installment ${i + 1} label` });
          const pct = input({ type: 'number', min: '0', max: '100', step: 'any', value: x.percent === null ? '' : String(x.percent), class: 'inp num', 'aria-label': `Installment ${i + 1} percent` });
          const amt = input({ type: 'number', min: '0', step: 'any', value: String(x.amount), class: 'inp num', 'aria-label': `Installment ${i + 1} amount`, dataset: { inst: String(i) } });
          const dd = input({ type: 'date', value: x.due_date, 'aria-label': `Installment ${i + 1} due date` });
          const note = input({ value: x.due_note, placeholder: 'e.g. On shoot day', 'aria-label': `Installment ${i + 1} due note` });
          lab.addEventListener('input', () => (x.label = lab.value));
          pct.addEventListener('input', () => { x.percent = pct.value === '' ? '' : Number(pct.value); if (x.percent !== '') { x.amount = round2(current.total * x.percent / 100); amt.value = String(x.amount); } updSum(); });
          amt.addEventListener('input', () => { x.amount = Number(amt.value) || 0; x.percent = ''; pct.value = ''; updSum(); });
          dd.addEventListener('input', () => (x.due_date = dd.value));
          note.addEventListener('input', () => (x.due_note = note.value));
          return h('div', { class: 'inst-row' }, lab, pct, amt, dd, note, iconBtn('x', `Remove installment ${i + 1}`, () => { inst.splice(i, 1); drawInst(); m.dirty = true; }, 'danger'));
        }));
    } else {
      instHost.querySelectorAll('input[data-inst]').forEach(el => { const x = inst[Number(el.dataset.inst)]; if (x && document.activeElement !== el) el.value = String(x.amount); });
    }
    updSum();
  }
  function updSum() {
    if (!inst.length) { instSum.textContent = ''; instCount.textContent = ''; return; }
    const s = round2(inst.reduce((a, x) => a + (Number(x.amount) || 0), 0));
    const diff = round2(current.total - s);
    instSum.className = 'small inst-sum ' + (Math.abs(diff) < 0.01 ? 'up' : 'warn');
    instSum.textContent = Math.abs(diff) < 0.01 ? `Schedule matches the total (${money(s)}).` : `Schedule ${money(s)} · ${diff > 0 ? 'short by ' + money(diff) : 'over by ' + money(-diff)} of total ${money(current.total)}`;
    instCount.textContent = `${inst.length} installment${inst.length > 1 ? 's' : ''}`;
    schedule();
  }
  const instCount = h('span', { class: 'sum-note' });
  const section = (title, note, body, open) => h('details', { class: 'ed-sec', open: !!open },
    h('summary', null, h('span', { class: 'chev', 'aria-hidden': 'true' }, ic('chevronRight', 15)), h('span', { class: 'sum-t' }, title), note), body);
  const instSec = isInv ? section('Payment schedule', instCount, h('div', { class: 'sec-body' },
    h('div', { class: 'btns', style: { marginBottom: '10px' } },
      btn('30 / 30 / 40', () => {
        inst.splice(0, inst.length, { label: 'Advance', percent: 30, amount: 0, due_date: dateA.value, due_note: 'On booking' }, { label: 'Shoot day', percent: 30, amount: 0, due_date: '', due_note: 'On the event day' }, { label: 'On delivery', percent: 40, amount: 0, due_date: '', due_note: 'Before delivery' });
        drawInst(); m.dirty = true;
      }, { cls: 'sm', aria: 'Use a 30, 30, 40 percent schedule' }),
      btn('50 / 50', () => { inst.splice(0, inst.length, { label: 'Advance', percent: 50, amount: 0, due_date: dateA.value, due_note: 'On booking' }, { label: 'On delivery', percent: 50, amount: 0, due_date: '', due_note: 'Before delivery' }); drawInst(); m.dirty = true; }, { cls: 'sm' }),
      btn('Installment', () => { inst.push({ label: `Installment ${inst.length + 1}`, percent: '', amount: 0, due_date: '', due_note: '' }); drawInst(); instHost.querySelectorAll('.inst-row:not(.inst-head)')[inst.length - 1]?.querySelector('input')?.focus(); m.dirty = true; }, { cls: 'sm', icon: 'plus' })),
    instHost, instSum, h('p', { class: 'dim small', style: { marginTop: '6px' } }, 'Optional. Shown on the invoice PDF; paid status is worked out from payments in order.')), inst.length > 0) : null;

  // ================= Notes / terms / recurring =================
  const notes = textarea({ value: doc.notes || '', rows: 3, placeholder: 'Shown on the PDF, e.g. album selection link will be shared after the event' });
  const terms = textarea({ value: doc.terms ?? '', rows: 4, placeholder: 'One term per line' });
  notes.addEventListener('input', schedule); terms.addEventListener('input', schedule);
  const notesSec = section('Notes & terms', h('span', { class: 'sum-note' }, doc.notes ? 'Has notes' : ''), h('div', { class: 'sec-body form-grid' },
    field('Notes', notes), field('Terms & conditions', terms, { hint: 'Defaults from Settings. One term per line.' })), !!doc.notes);
  let recur = null;
  if (isInv) {
    const t = toggle('Create this invoice again every month', !!doc.recurring);
    const act = toggle('Active', doc.recurring_active !== false);
    const next = input({ type: 'date', value: doc.recurring_next || addMonths(dateA.value || today, 1), 'aria-label': 'Next invoice date' });
    const box = h('div', { class: 'form-grid', style: { marginTop: '10px' } }, field('Next invoice date', next, { hint: 'A copy is created automatically on this date.' }), h('div', { class: 'field', style: { justifyContent: 'flex-end' } }, act.el));
    box.hidden = !t.input.checked;
    const note = h('span', { class: 'sum-note' }, doc.recurring ? 'Monthly' : '');
    t.input.addEventListener('change', () => { box.hidden = !t.input.checked; note.textContent = t.input.checked ? 'Monthly' : ''; });
    recur = { t, act, next, el: section('Recurring', note, h('div', { class: 'sec-body' }, t.el, box), !!doc.recurring) };
  }

  // ================= Live mini A4 preview =================
  const pvPage = h('div', { class: 'pv-page', 'aria-hidden': 'true' });
  const pvWrap = h('div', { class: 'pv-wrap' }, pvPage);
  const ro = new ResizeObserver(() => { pvWrap.style.setProperty('--k', String(pvWrap.clientWidth / 794)); });
  ro.observe(pvWrap);
  function drawPreview() {
    const co = state.company || {}; const st = state.settings || {};
    const gst = gstOn();
    const c = customers.find(x => x.id === custId);
    const proj = projects.find(p => p.id === projSel.value);
    const t = current;
    const title = isInv ? (gst ? 'Tax Invoice' : 'Invoice') : 'Quotation';
    const number = existing?.number || `${(isInv ? st.invoice_prefix : st.quotation_prefix) || (isInv ? 'INV' : 'QT')}-····`;
    const logo = state.logoUrl ? h('img', { src: state.logoUrl, alt: '' }) : initials(co.name, 'S');
    const lines = [st.address, [st.mobile, st.email, st.website].filter(Boolean).join('  ·  '), gst && st.gst_number ? `GSTIN ${st.gst_number}` : null].filter(Boolean);
    const visible = items.filter(x => isHeader(x) ? x.description.trim() : (x.description.trim() || Number(x.rate)));
    const MAX = 16; let n = 0;
    const rows = visible.slice(0, MAX).map(it => isHeader(it)
      ? h('tr', { class: 'pv-sec' }, h('td', { colspan: String(showSac ? 6 : 5) }, it.description))
      : h('tr', null, h('td', { class: 'c' }, String(++n)), h('td', null, h('b', null, it.description || '—'), it.detail ? h('span', { class: 'pv-det' }, '  ' + it.detail) : null),
        showSac ? h('td', { class: 'pv-det' }, it.sac || '') : null, h('td', { class: 'r' }, num(it.qty)), h('td', { class: 'r' }, money(it.rate)), h('td', { class: 'r b' }, money(amountOf(it)))));
    const more = visible.length > MAX ? h('tr', null, h('td', { colspan: String(showSac ? 6 : 5), class: 'pv-more' }, `+ ${visible.length - MAX} more row(s) on the PDF`)) : null;
    const half = round2(t.tax_amount / 2);
    const bal = round2(t.total - paid);
    const tRow = (l, v, cls = '') => h('div', { class: 'pv-tr ' + cls }, h('span', null, l), h('span', null, v));
    mount(pvPage,
      h('div', { class: 'pv-bar' }), h('div', { class: 'pv-border' }),
      h('div', { class: 'pv-head' },
        h('div', { class: 'pv-logo' }, logo),
        h('div', { class: 'pv-co' }, h('div', { class: 'pv-name' }, String(co.name || 'Studio').toUpperCase()), st.tagline ? h('div', { class: 'pv-tag' }, String(st.tagline).toUpperCase()) : null, lines.map(x => h('div', null, x))),
        h('div', { class: 'pv-title' }, h('div', { class: 'pv-t' }, title), h('div', { class: 'pv-no' }, 'No. ' + number), party.value.trim() ? h('div', { class: 'pv-no' }, party.value.trim()) : null)),
      h('div', { class: 'pv-info' },
        h('div', { class: 'pv-box' }, h('div', { class: 'pv-lbl' }, isInv ? 'Billed To' : 'Prepared For'), h('div', { class: 'pv-party' }, c?.name || (!isInv && guest.value.trim()) || 'Customer name'),
          c ? h('div', { class: 'pv-small' }, [c.address, c.city, [c.mobile, c.email].filter(Boolean).join(' · ')].filter(Boolean).map(x => h('div', null, x))) : null),
        proj ? h('div', { class: 'pv-box' }, h('div', { class: 'pv-lbl' }, 'Event'), h('div', { class: 'pv-party' }, [proj.type, proj.name].filter(Boolean).join(' · ')), h('div', { class: 'pv-small' }, [proj.event_date ? fmtDate(proj.event_date) : null, proj.venue].filter(Boolean).join(' · '))) : null,
        h('div', { class: 'pv-box pv-kv' }, h('div', { class: 'pv-lbl' }, 'Details'),
          tRow(isInv ? 'Invoice Date' : 'Quote Date', fmtDate(dateA.value)), tRow(isInv ? 'Due Date' : 'Valid Until', fmtDate(dateB.value)),
          isInv ? tRow('Amount Due', money(bal), bal > 0 ? 'red' : 'green') : tRow('Status', (qStatus.value || 'draft').replace(/^./, s => s.toUpperCase())))),
      h('table', { class: 'pv-items' },
        h('thead', null, h('tr', null, h('th', { class: 'c' }, '#'), h('th', null, 'Service / Item'), showSac ? h('th', null, 'SAC') : null, h('th', { class: 'r' }, 'Qty'), h('th', { class: 'r' }, 'Rate'), h('th', { class: 'r' }, 'Amount'))),
        h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: String(showSac ? 6 : 5), class: 'pv-more' }, 'Items you add appear here')), more)),
      h('div', { class: 'pv-bottom' },
        h('div', { class: 'pv-left' }, h('div', { class: 'pv-words' }, h('i', null, 'Amount in words: '), h('b', null, amountInWords(t.total))),
          st.upi || st.bank_name ? h('div', { class: 'pv-pay' }, h('div', { class: 'pv-lbl' }, isInv && bal > 0 && st.upi ? 'Scan & Pay · Bank Details' : 'Bank Details'),
            isInv && bal > 0 && st.upi ? h('div', { class: 'pv-qr' }) : null,
            h('div', { class: 'pv-small' }, [st.upi ? `UPI  ${st.upi}` : null, st.bank_name ? `Bank  ${st.bank_name}` : null, st.account_number ? `A/C  ${st.account_number}` : null, st.ifsc ? `IFSC  ${st.ifsc}` : null].filter(Boolean).map(x => h('div', null, x)))) : null,
          isInv && inst.length ? h('div', { class: 'pv-sched' }, inst.map(x => h('div', null, h('span', null, x.label || 'Installment'), h('b', null, money(x.amount))))) : null),
        h('div', { class: 'pv-totals' },
          tRow('Subtotal', money(t.subtotal)),
          t.discount_amount > 0 ? tRow('Discount', '– ' + money(t.discount_amount)) : null,
          gst && t.tax_amount > 0 ? [tRow(`CGST @ ${num(Number(tax.value) / 2)}%`, money(half)), tRow(`SGST @ ${num(Number(tax.value) / 2)}%`, money(round2(t.tax_amount - half)))] : null,
          !gst && t.tax_amount > 0 ? tRow(`Tax @ ${num(tax.value)}%`, money(t.tax_amount)) : null,
          h('div', { class: 'pv-grand' }, h('span', null, isInv ? 'GRAND TOTAL' : 'QUOTED TOTAL'), h('b', null, money(t.total))),
          isInv ? [tRow('Received', money(paid), 'green'), tRow('Balance Due', money(bal), 'red b')] : null)),
      notes.value.trim() ? h('div', { class: 'pv-notes' }, h('div', { class: 'pv-lbl' }, 'Notes'), notes.value.trim()) : null,
      h('div', { class: 'pv-sign' }, h('div', { class: 'pv-terms' }, terms.value.trim() ? [h('div', { class: 'pv-lbl' }, 'Terms & Conditions'), terms.value.split(/\r?\n/).filter(x => x.trim()).slice(0, 5).map((x, i) => h('div', null, `${i + 1}. ${x.trim()}`))] : null),
        h('div', { class: 'pv-sig' }, h('div', { class: 'pv-sig-n' }, co.name || 'Studio'), h('div', { class: 'pv-sig-l' }, 'AUTHORISED SIGNATORY'))),
      h('div', { class: 'pv-thanks' }, isInv ? 'Thank you for letting us tell your story.' : 'We look forward to capturing your moments.'));
  }

  // ================= Save =================
  async function save(btnEl, action, win) {
    errBox.textContent = '';
    const fail = (msg, el) => { errBox.textContent = msg; el?.focus(); errBox.scrollIntoView({ block: 'nearest' }); if (win && !win.closed) win.close(); };
    if (isInv && !custId) return fail('Choose a customer for the invoice.', custInp);
    if (!isInv && !custId && !guest.value.trim()) return fail('Choose a customer or type a guest name.', custInp);
    const clean = items.filter(i => isHeader(i) ? i.description.trim() : (i.description.trim() || Number(i.rate)));
    if (!clean.some(i => !isHeader(i))) return fail('Add at least one item.', rowsHost.querySelector('.it-name'));
    if (clean.some(i => !isHeader(i) && !i.description.trim())) return fail('Every item needs a name.', null);
    if (clean.some(i => Number(i.qty) < 0 || Number(i.rate) < 0)) return fail('Quantity and rate cannot be negative.', null);
    if (isInv && inst.length) {
      const s = round2(inst.reduce((a, x) => a + (Number(x.amount) || 0), 0));
      if (Math.abs(s - current.total) >= 0.01 && !(await confirmDialog(`The payment schedule adds up to ${money(s)} but the total is ${money(current.total)}. Save anyway?`, { okText: 'Save anyway' }))) { if (win && !win.closed) win.close(); return; }
    }
    const header = {
      customer_id: custId || null, project_id: projSel.value || null,
      party_name: party.value.trim() || null,
      discount_amount: discAmount(), tax_percent: showTax ? Number(tax.value) || 0 : 0,
      notes: notes.value.trim() || null, terms: terms.value.trim() || null,
    };
    if (isInv) Object.assign(header, {
      invoice_date: dateA.value || today, due_date: dateB.value || null,
      recurring: recur.t.input.checked, recurring_active: recur.t.input.checked && recur.act.input.checked,
      recurring_next: recur.t.input.checked ? (recur.next.value || addMonths(dateA.value || today, 1)) : null,
    });
    else Object.assign(header, { quote_date: dateA.value || today, valid_until: dateB.value || null, status: qStatus.value, guest_name: custId ? null : guest.value.trim() });
    const out = clean.map(i => isHeader(i) ? { description: i.description.trim(), detail: HEADER_FLAG, sac: null, qty: 0, rate: 0 } : { ...i, description: i.description.trim(), detail: (i.detail || '').trim() });
    await busy(btnEl, async () => {
      try {
        const saved = await saveDoc(kind, id, header, out, isInv ? inst.filter(x => Number(x.amount) > 0 || x.label) : null);
        toast(`${label} ${saved.number} saved`, 'success');
        m.markClean(); m.close(saved);
        onSaved && onSaved(saved, action, win);
      } catch (e) { fail(errMsg(e), null); }
    });
  }
  const saveBtn = btn(isInv ? 'Save' : 'Save draft', e => save(e.currentTarget, 'save'), { cls: '', icon: 'check' });
  const pdfBtn = btn('Save & Download PDF', e => save(e.currentTarget, 'pdf'), { icon: 'download' });
  const waBtn = btn('Save & Send WhatsApp', e => { const win = preOpenShareWindow('whatsapp'); save(e.currentTarget, 'whatsapp', win); }, { cls: 'gold', icon: 'whatsapp' });

  // ================= Layout =================
  const pvBtn = h('button', { type: 'button', class: 'btn sm ghost pv-toggle', 'aria-pressed': 'true', 'data-noguard': '' }, h('span', { class: 'bi' }, ic('preview', 15)), 'Preview');
  const isNarrow = () => window.matchMedia('(max-width: 1099px)').matches;
  const syncPvBtn = () => {
    const shown = isNarrow() ? m.panel.classList.contains('pv-on') : !m.panel.classList.contains('pv-off');
    pvBtn.setAttribute('aria-pressed', String(shown));
    pvBtn.title = shown ? 'Hide live preview' : 'Show live preview';
  };
  pvBtn.addEventListener('click', () => {
    m.panel.classList.toggle(isNarrow() ? 'pv-on' : 'pv-off');
    syncPvBtn();
    if (m.panel.classList.contains('pv-on') && isNarrow()) pvWrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  const numberBadge = h('span', { class: 'num-badge' }, existing ? existing.number : `${(isInv ? S.invoice_prefix : S.quotation_prefix) || (isInv ? 'INV' : 'QT')}-#### · auto`);

  const top = h('section', { class: 'ed-card ed-top' },
    h('div', { class: 'ed-grid' },
      h('div', { class: 'field g-cust' }, h('label', { for: 'de-cust' }, 'Customer', isInv ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
        h('div', { class: 'with-btn' }, custHost, btn('New', () => newCustomer(''), { cls: 'sm', icon: 'plus', aria: 'Add a new customer' })), custMeta),
      field('Party / Bride & Groom', party, { cls: 'g-party', hint: 'Shown next to the number everywhere' }),
      h('div', { class: 'field g-proj' }, h('label', { for: 'de-proj' }, 'Project'), projSel),
      isInv ? null : field('Status', qStatus, { cls: 'g-status' }),
      isInv ? null : guestWrap,
      field(isInv ? 'Invoice date' : 'Quote date', dateA, { cls: 'g-date' }),
      field(isInv ? 'Due date' : 'Valid until', dateB, { cls: 'g-date' }),
      h('div', { class: 'field g-chips' }, h('span', { class: 'flbl' }, isInv ? 'Due in' : 'Valid for'), dueChips)));
  const itemsCard = h('section', { class: 'ed-card ed-items' + (showSac ? ' with-sac' : '') },
    h('div', { class: 'ed-card-h' }, h('h3', null, 'Items'), h('span', { class: 'dim small' }, 'Type to search saved & previous items · Enter for next field · drag ', ic('grip', 12), ' to reorder')),
    itemsHead, rowsHost,
    h('div', { class: 'it-add' },
      btn('Add item', () => addItem(), { cls: 'sm', icon: 'plus' }),
      btn('Add section header', () => addHeader(), { cls: 'sm ghost', icon: 'heading' }),
      pkgBtn));
  const side = h('aside', { class: 'ed-side', 'aria-label': 'Preview and totals' },
    h('div', { class: 'ed-side-in' },
      h('section', { class: 'ed-card' }, totalsPanel),
      h('div', { class: 'pv-card' }, h('div', { class: 'pv-cap' }, h('span', null, 'Live preview'), h('small', null, 'A4 · updates as you type')), pvWrap)));
  const body = h('div', { class: 'ed-body' },
    h('div', { class: 'ed-main' }, errBox, top, itemsCard),
    side,
    h('div', { class: 'ed-more' }, instSec, notesSec, recur?.el));

  m = openModal({
    title: existing ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`,
    head: [numberBadge, statusHost, pvBtn],
    size: 'xl', cls: 'editor', guard: true, hash,
    body,
    footer: [footSum, h('div', { class: 'ed-btns' }, btn('Cancel', () => m.request(), { cls: 'ghost' }), saveBtn, pdfBtn, waBtn)],
  });
  m.result.then(() => ro.disconnect());

  fillProjects(); setCustomer(custId); drawStatus(); drawDue(); drawItems(); recalc(); drawInst(); drawPreview(); syncPvBtn();
  m.dirty = false;

  // Demo-only: pre-fill rows and open the type-ahead (for screenshots / UI review).
  if (demo && !existing) {
    const cA = customers.find(c => c.name === 'Customer A') || customers[0];
    if (cA) { setCustomer(cA.id); const p = projects.find(x => x.customer_id === cA.id); if (p) { projSel.value = p.id; doc.party_name = 'Sadique & Afsha'; party.value = 'Sadique & Afsha'; doc.project_id = p.id; } }
    items.splice(0, items.length, headerItem('Day 1 · Haldi'), { ...blankItem('998386'), description: 'Traditional Photography', detail: 'Full ceremony', rate: 12000 },
      { ...blankItem('998386'), description: 'Drone Coverage', detail: 'Baraat + reception', qty: 2, rate: 8000 }, headerItem('Day 2 · Wedding'), { ...blankItem('998386'), description: '', rate: 0 });
    drawItems(); recalc(); drawPreview();
    setTimeout(() => {
      const last = items.length - 1;
      const row = rowsHost.querySelector(`.it-row[data-i="${last}"]`);
      const nm = row?.querySelector('.it-name');
      if (nm) { nm.focus(); nm.value = 'Can'; items[last].description = 'Can'; nm.dispatchEvent(new Event('input', { bubbles: true })); row.classList.add('editing'); setTimeout(() => row.classList.add('editing'), 200); }
      m.dirty = false;
    }, 250);
  } else if (!existing) {
    setTimeout(() => (custId ? rowsHost.querySelector('.it-name') : custInp)?.focus(), 60);
  }
  return m.result;
}
