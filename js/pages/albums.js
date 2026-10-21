// Albums (owner): album orders on a stage board (drag & drop) + list, order form, drawer with job costing and profit.
import { h, mount, table, field, input, textarea, select, btn, iconBtn, searchBox, chips, ic, pill, empty, nextId } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, insert, update, remove, getRow, state, logActivity } from '../store.js';
import { money, moneyShort, fmtDate, fmtDateShort, includesCI, debounce, todayIST, addDays, daysBetween, sum, num } from '../util.js';
import { ALBUM_STAGES, ALBUM_STAGE_LABEL, albumCosting, albumOverdue, fmtPct } from '../bizcalc.js';
import { weekStart } from '../teamcalc.js';
import { attachCombo } from '../combo.js';
import { pageHead, dwSection, statRow, recLink, invStatus } from './common.js';
import { openCustomerForm } from './customers.js';
import { openWhatsApp, sharePdf } from '../share.js';

export const SIZES = ['12×36', '12×30', '10×30', '12×24'];
export const PAPERS = ['Glossy', 'Matte', 'Lustre', 'Metallic', 'NT'];
const TONE = { design: 's1', approval: 's3', sent_to_print: 's5', printed: 's5', binding: 's1', delivered: 's2' };
export const albumPill = s => pill(ALBUM_STAGE_LABEL[s] || 'Design', TONE[s] || 's1');
const UI = { view: null, q: '', due: '', sort: { key: 'Due', dir: 1 } };
const nextStage = s => ALBUM_STAGES[ALBUM_STAGES.indexOf(s || 'design') + 1] || null;
const STATUS_LINE = {
  design: 'Our designer is working on your album layout.',
  approval: 'Your album design is ready for approval. Please check it and share any changes.',
  sent_to_print: 'Your album has been sent to the lab for printing.',
  printed: 'Your album pages are printed and going for binding.',
  binding: 'Your album is being bound and boxed.',
  delivered: 'Your album is ready. We hope you love it!',
};
export function statusText(a, c) {
  const co = state.company?.name || 'our studio';
  return [`Hello ${c?.name || 'there'},`, '', `Update on your album *${a.title || 'Album'}* from *${co}*:`, '',
    `📒 Status: *${ALBUM_STAGE_LABEL[a.stage] || 'Design'}*`, STATUS_LINE[a.stage] || '',
    a.sheets ? `📐 ${num(a.sheets)} sheets${a.size ? ' · ' + a.size : ''}${a.paper ? ' · ' + a.paper : ''}` : null,
    a.due_date && a.stage !== 'delivered' ? `📅 Expected by: ${fmtDate(a.due_date)}` : null,
    '', 'Thank you!', `— ${co}`].filter(x => x !== null).join('\n');
}
const dueText = (a, today) => {
  if (!a.due_date) return 'No due date';
  if (a.stage === 'delivered') return 'Delivered';
  const n = daysBetween(today, a.due_date);
  return n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `Due ${fmtDateShort(a.due_date)}`;
};

/** Chip picker with a "Custom" option that reveals a text box. Returns { el, value() }. */
function chipPick(options, value, label, onChange) {
  const isCustom = !!value && !options.includes(value);
  let cur = isCustom ? '__custom' : (value || '');
  const custom = input({ value: isCustom ? value : '', placeholder: 'Type a custom value', 'aria-label': `Custom ${label.toLowerCase()}`, class: 'inp chip-custom' });
  custom.hidden = cur !== '__custom';
  const c = chips([...options.map(o => [o, o]), ['__custom', 'Custom']], cur, v => { cur = v; custom.hidden = v !== '__custom'; if (v === '__custom') custom.focus(); onChange && onChange(); }, label);
  c.classList.add('src-chips');
  return { el: h('div', { class: 'chip-pick' }, c, custom), value: () => (cur === '__custom' ? custom.value.trim() : cur) || null };
}

// ======================================================================
// Album order form
// ======================================================================
export async function openAlbumForm(existing = null, preset = {}) {
  const a = existing || { stage: 'design', size: '12×36', paper: 'Glossy', ...preset };
  const [customers0, projects, invoices] = await Promise.all([all('customers'), all('projects'), all('invoices')]);
  const customers = customers0.slice().sort((x, y) => x.name.localeCompare(y.name));
  let m;
  const f = {
    title: input({ value: a.title || '', placeholder: 'e.g. Wedding Album – Customer A' }),
    sheets: input({ type: 'number', min: '0', step: '1', inputmode: 'numeric', class: 'inp num', value: a.sheets ?? '' }),
    price: input({ type: 'number', min: '0', step: 'any', inputmode: 'decimal', class: 'inp num', value: a.price ?? '' }),
    due_date: input({ type: 'date', value: a.due_date || '' }),
    stage: select(ALBUM_STAGES.map(s => [s, ALBUM_STAGE_LABEL[s]]), a.stage || 'design'),
    notes: textarea({ value: a.notes || '', rows: 2, placeholder: 'Layout notes, cover text, box embossing…' }),
    project_id: select([['', '— No project —']], ''),
    invoice_id: select([['', '— No invoice —']], ''),
  };
  const size = chipPick(SIZES, a.size, 'Size', () => { if (m) m.dirty = true; });
  const paper = chipPick(PAPERS, a.paper, 'Paper', () => { if (m) m.dirty = true; });

  // ----- customer combobox + quick add -----
  let custId = a.customer_id || '';
  const cName = () => customers.find(c => c.id === custId)?.name || '';
  const custInp = input({ id: nextId('al-c'), value: cName(), placeholder: 'Search or add a customer…' });
  const custHost = h('div', { class: 'cb-host' }, h('span', { class: 'cb-lead' }, ic('user', 15)), custInp);
  const custMeta = h('small', { class: 'hint' });
  function fillLinks() {
    const ps = projects.filter(p => p.customer_id === custId);
    const is = invoices.filter(i => i.customer_id === custId).sort((x, y) => String(y.invoice_date).localeCompare(String(x.invoice_date)));
    const curP = f.project_id.value || a.project_id || ''; const curI = f.invoice_id.value || a.invoice_id || '';
    mount(f.project_id, h('option', { value: '' }, ps.length ? '— No project —' : custId ? '— No projects for this customer —' : '— Choose a customer first —'), ps.map(p => h('option', { value: p.id }, `${p.name}${p.event_date ? ' · ' + fmtDate(p.event_date) : ''}`)));
    mount(f.invoice_id, h('option', { value: '' }, is.length ? '— No invoice —' : '— No invoices for this customer —'), is.map(i => h('option', { value: i.id }, `${i.number} · ${fmtDate(i.invoice_date)} · ${money(i.total)}`)));
    f.project_id.value = ps.some(p => p.id === curP) ? curP : ''; f.invoice_id.value = is.some(i => i.id === curI) ? curI : '';
    f.project_id.disabled = !ps.length; f.invoice_id.disabled = !is.length;
    const c = customers.find(x => x.id === custId);
    custMeta.textContent = c ? [c.mobile, c.city].filter(Boolean).join(' · ') : '';
  }
  const setCustomer = id => { const changed = id !== custId; custId = id || ''; custInp.value = cName(); if (changed) { f.project_id.value = ''; f.invoice_id.value = ''; a.project_id = null; a.invoice_id = null; } fillLinks(); };
  async function newCustomer(name) {
    const c = await openCustomerForm(null, { name });
    if (c) { customers.push(c); customers.sort((x, y) => x.name.localeCompare(y.name)); setCustomer(c.id); m.dirty = true; }
    custInp.focus();
  }
  attachCombo(custInp, {
    label: 'Customers',
    source: q => {
      const t = q.trim(); const d = t.replace(/\D/g, ''); const showAll = !t || t === cName();
      return customers.filter(c => showAll || includesCI(c.name, t) || includesCI(c.city, t) || (d.length >= 3 && String(c.mobile || '').replace(/\D/g, '').includes(d)))
        .slice(0, 8).map(c => ({ key: c.id, label: c.name, sub: [c.mobile, c.city].filter(Boolean).join(' · '), data: c }));
    },
    extra: q => [{ key: '+new', action: true, icon: 'plus', label: q.trim() && q.trim() !== cName() ? `New customer “${q.trim()}”` : 'New customer', data: { name: q.trim() !== cName() ? q.trim() : '' } }],
    onPick: o => { if (o.action) newCustomer(o.data.name); else { setCustomer(o.data.id); m.dirty = true; f.project_id.disabled ? f.title.focus() : f.project_id.focus(); } },
  });
  custInp.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === custInp) return;
    if (!custInp.value.trim()) { if (custId) setCustomer(''); } else if (custInp.value !== cName()) custInp.value = cName();
  }, 150));
  f.project_id.addEventListener('change', () => {
    const p = projects.find(x => x.id === f.project_id.value);
    if (p && !f.title.value.trim()) f.title.value = `${p.name} – Album`;
    if (p && !f.due_date.value && p.delivery_date) f.due_date.value = p.delivery_date;
  });
  fillLinks();

  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const save = btn(existing ? 'Save changes' : 'Create album order', async () => {
    errBox.textContent = '';
    if (!custId) { errBox.textContent = 'Choose a customer.'; custInp.focus(); return; }
    if (!f.title.value.trim()) { errBox.textContent = 'Give the album a title.'; f.title.focus(); return; }
    const sheets = f.sheets.value === '' ? null : Number(f.sheets.value);
    if (sheets != null && !(Number.isInteger(sheets) && sheets >= 0)) { errBox.textContent = 'Sheets must be a whole number.'; f.sheets.focus(); return; }
    const price = Number(f.price.value || 0);
    if (!(price >= 0)) { errBox.textContent = 'Price cannot be negative.'; f.price.focus(); return; }
    const row = {
      customer_id: custId, project_id: f.project_id.value || null, invoice_id: f.invoice_id.value || null, title: f.title.value.trim(),
      sheets, size: size.value(), paper: paper.value(), price, due_date: f.due_date.value || null, stage: f.stage.value, notes: f.notes.value.trim() || null,
    };
    await busy(save, async () => {
      try {
        const saved = existing ? await update('album_orders', existing.id, row) : await insert('album_orders', row);
        if (!existing) logActivity(`Album order “${saved.title}” created`, '▣');
        toast(existing ? 'Album updated' : 'Album order created', 'success'); m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: existing ? 'Edit album order' : 'New album order', size: 'lg', guard: true,
    body: [errBox, h('form', { class: 'form-grid', novalidate: true, onsubmit: e => { e.preventDefault(); save.click(); } },
      h('div', { class: 'field full' }, h('label', { for: custInp.id }, 'Customer', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), custHost, custMeta),
      field('Project', f.project_id), field('Invoice (optional)', f.invoice_id, { hint: 'Link if the album is already billed' }),
      field('Title', f.title, { required: true, cls: 'full' }),
      field('Sheets', f.sheets, { hint: 'Spreads / sheets in the album' }), field('Due date', f.due_date),
      h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Size'), size.el),
      h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Paper'), paper.el),
      field('Price to customer (₹)', f.price, { hint: 'What you charge for the album' }), field('Stage', f.stage),
      field('Notes', f.notes, { cls: 'full' }),
      h('button', { type: 'submit', hidden: true, tabindex: '-1' }))],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  return m.result;
}

// ======================================================================
// Actions
// ======================================================================
export async function setAlbumStage(a, stage) {
  if (a.stage === stage) return a;
  try { const s = await update('album_orders', a.id, { stage }); toast(`${a.title}: ${ALBUM_STAGE_LABEL[stage]}`, 'success'); return s; }
  catch (e) { toast(errMsg(e), 'error'); return null; }
}
async function deleteAlbum(a) {
  const n = (await all('expenses')).filter(e => e.album_order_id === a.id).length;
  if (!(await confirmDialog(`Delete album order “${a.title}”?${n ? ` Its ${n} cost${n === 1 ? '' : 's'} stay in Expenses without the album link.` : ''}`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('album_orders', a.id); toast('Album order deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
export const openCostForm = (a, existing = null) => import('./expenses.js').then(m => m.openExpenseForm(existing, { album: a }));
/** Invoice prefilled with "<title> – <sheets> sheets <size>" at the album price; links the album to the saved invoice. */
export async function createAlbumInvoice(a) {
  const { openInvoiceEditor } = await import('./invoices.js');
  const desc = `${a.title || 'Album'}${a.sheets ? ` – ${a.sheets} sheets` : ''}${a.size ? ' ' + a.size : ''}`;
  return openInvoiceEditor(null, {
    preset: { customer: a.customer_id, project: a.project_id || '', items: [{ description: desc, detail: a.paper ? `${a.paper} paper` : '', qty: 1, rate: Number(a.price) || 0 }] },
    afterSave: async saved => { const cur = await getRow('album_orders', a.id); if (cur && !cur.invoice_id) await update('album_orders', a.id, { invoice_id: saved.id }); },
  });
}
/** Internal job card (shows vendor costs and profit) — download only, never shared to the customer. */
export function jobCardShare(a) {
  return sharePdf({ make: async () => (await import('../pdf/reports.js')).albumJobCardPdf(a.id), channel: 'download' });
}
const waStatus = async a => { const c = await getRow('customers', a.customer_id); openWhatsApp(c?.whatsapp || c?.mobile, statusText(a, c)); };

// ======================================================================
// Page
// ======================================================================
export const routeView = ({ params, query = {} }) => {
  const d = openAlbumDrawer(params.id);
  if (query.cost) setTimeout(async () => { const a = await getRow('album_orders', params.id); if (a) openCostForm(a); }, 350);
  return d;
};

export async function render({ query = {}, refresh } = {}) {
  if (!refresh) {
    if (query.view === 'list' || query.view === 'board') UI.view = query.view;
    if (query.due) UI.due = query.due;
  }
  if (!UI.view) UI.view = matchMedia('(max-width: 760px)').matches ? 'list' : 'board';
  const [albums, customers, expenses] = await Promise.all([all('album_orders'), all('customers'), all('expenses')]);
  const cMap = new Map(customers.map(c => [c.id, c]));
  const today = todayIST(); const wf = weekStart(today); const wt = addDays(wf, 6);
  const K = new Map(albums.map(a => [a.id, albumCosting(a, expenses)]));
  const isWeek = a => a.stage !== 'delivered' && !!a.due_date && a.due_date >= wf && a.due_date <= wt;
  const prod = albums.filter(a => a.stage !== 'delivered');
  const over = albums.filter(a => albumOverdue(a, today));

  const sb = searchBox({ placeholder: 'Search customer, album, size, paper…', 'aria-label': 'Search albums', value: UI.q, wrapCls: 'grow' });
  const dueChips = chips([['', 'All', albums.length], ['overdue', 'Overdue', over.length], ['week', 'Due this week', albums.filter(isWeek).length]], UI.due, v => { UI.due = v; draw(); }, 'Filter by due date');
  const seg = h('div', { class: 'cal-seg', role: 'group', 'aria-label': 'Albums view' }, [['board', 'Board', 'kanban'], ['list', 'List', 'list']].map(([v, l, icn]) =>
    h('button', { type: 'button', 'aria-pressed': String(UI.view === v), dataset: { v }, onclick: () => { UI.view = v; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); draw(); } }, ic(icn, 14), h('span', null, l))));
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const filtered = () => {
    UI.q = sb.input.value; const t = UI.q.trim();
    return albums.filter(a => (!UI.due || (UI.due === 'overdue' ? albumOverdue(a, today) : isWeek(a)))
      && (!t || includesCI(cMap.get(a.customer_id)?.name, t) || includesCI(a.title, t) || includesCI(a.size, t) || includesCI(a.paper, t) || includesCI(cMap.get(a.customer_id)?.mobile, t)));
  };
  async function moveTo(a, stage) { if (stage !== a.stage) await setAlbumStage(a, stage); }

  function card(a) {
    const k = K.get(a.id); const od = albumOverdue(a, today);
    const sel = select(ALBUM_STAGES.map(s => [s, ALBUM_STAGE_LABEL[s]]), a.stage || 'design', { class: 'inp lead-sel', 'aria-label': `Move ${a.title} to` });
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', () => moveTo(a, sel.value));
    const el = h('article', {
      class: ['lead-card', 'album-card', od ? 'od' : null], tabindex: '0', draggable: 'true', dataset: { id: a.id }, 'aria-label': `Album ${a.title} for ${cMap.get(a.customer_id)?.name || 'customer'}, ${ALBUM_STAGE_LABEL[a.stage]}. Press Enter to open.`,
      onclick: e => { if (!e.target.closest('select,button')) openAlbumDrawer(a.id); },
      onkeydown: e => { if (e.key === 'Enter' && e.target === el) openAlbumDrawer(a.id); },
    },
    h('div', { class: 'lc-top' }, h('b', { title: a.title }, a.title || 'Album'), a.price ? h('span', { class: 'lc-bud' }, moneyShort(a.price)) : null),
    h('div', { class: 'lc-ev' }, cMap.get(a.customer_id)?.name || '—'),
    h('div', { class: 'al-spec' }, [a.sheets ? `${a.sheets} sheets` : null, a.size, a.paper].filter(Boolean).join(' · ') || h('span', { class: 'dim' }, 'Specs not set')),
    h('div', { class: 'lc-foot' },
      h('span', { class: 'lc-due' + (od ? ' dn' : ''), title: a.due_date ? 'Due ' + fmtDate(a.due_date) : '' }, ic(od ? 'alert' : 'clock', 12), dueText(a, today)),
      k.cost ? h('span', { class: 'lc-age', title: `Cost ${money(k.cost)} · profit ${money(k.profit)}` }, 'Profit ', h('b', { class: k.profit >= 0 ? 'up' : 'dn' }, moneyShort(k.profit))) : null),
    h('div', { class: 'lc-act' }, sel,
      iconBtn('whatsapp', `WhatsApp status to ${cMap.get(a.customer_id)?.name || 'customer'}`, e => { e.stopPropagation(); waStatus(a); }, 'wa-ic'),
      iconBtn('plus', `Add cost to ${a.title}`, e => { e.stopPropagation(); openCostForm(a); })));
    el.addEventListener('dragstart', e => { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', a.id); } catch { /* ignore */ } });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }
  function board(rows) {
    return h('div', { class: 'lead-board album-board' }, ALBUM_STAGES.map(s => {
      const list = rows.filter(a => (a.stage || 'design') === s).sort((x, y) => String(x.due_date || '9999').localeCompare(String(y.due_date || '9999')));
      const nOver = list.filter(a => albumOverdue(a, today)).length;
      const col = h('section', { class: 'lead-col k-' + s, 'aria-label': `${ALBUM_STAGE_LABEL[s]}: ${list.length} album${list.length === 1 ? '' : 's'}` },
        h('div', { class: 'lead-col-h' }, albumPill(s), h('span', { class: 'cnt' }, String(list.length)), h('span', { class: 'grow' }), nOver ? h('small', { class: 'dn' }, `${nOver} late`) : list.length ? h('small', { class: 'dim' }, moneyShort(sum(list, a => a.price))) : null),
        h('div', { class: 'lead-col-b' }, list.length ? list.map(card) : h('p', { class: 'lead-empty' }, s === 'design' ? 'No albums in design.' : 'Drop an album here')),
        s === 'design' ? h('button', { type: 'button', class: 'lead-add', onclick: () => openAlbumForm() }, ic('plus', 14), 'New album order') : null);
      col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('over');
        let id = ''; try { id = e.dataTransfer.getData('text/plain'); } catch { /* ignore */ }
        const a = albums.find(x => x.id === id); if (a) moveTo(a, s);
      });
      return col;
    }));
  }
  function listView(rows) {
    const t = table([
      { label: 'Album', sort: a => a.title || '', cell: a => [h('b', null, a.title || 'Album'), h('small', null, cMap.get(a.customer_id)?.name || '—')] },
      { label: 'Stage', sort: a => ALBUM_STAGES.indexOf(a.stage), cell: a => albumPill(a.stage) },
      { label: 'Specs', cell: a => h('span', { class: 'muted' }, [a.sheets ? `${a.sheets} sh` : null, a.size, a.paper].filter(Boolean).join(' · ') || '—') },
      { label: 'Due', sort: a => a.due_date || '9999', cell: a => h('span', { class: 'nowrap' + (albumOverdue(a, today) ? ' dn' : '') }, a.due_date ? fmtDate(a.due_date) : '—', albumOverdue(a, today) ? h('small', null, dueText(a, today)) : null) },
      { label: 'Price', cls: 'r', sort: a => Number(a.price) || 0, sortDir: -1, cell: a => h('span', { class: 'num' }, money(a.price)) },
      { label: 'Cost', cls: 'r', sort: a => K.get(a.id).cost, sortDir: -1, cell: a => h('span', { class: 'num muted' }, money(K.get(a.id).cost)) },
      { label: 'Profit', cls: 'r', sort: a => K.get(a.id).profit, sortDir: -1, cell: a => { const k = K.get(a.id); return [h('b', { class: 'num ' + (k.profit >= 0 ? 'up' : 'dn') }, money(k.profit)), h('small', null, fmtPct(k.margin))]; } },
    ], rows, {
      sort: UI.sort, onRow: a => openAlbumDrawer(a.id), rowLabel: a => 'Open album ' + a.title,
      actions: a => {
        const nx = nextStage(a.stage);
        return [nx ? btn(ALBUM_STAGE_LABEL[nx], () => moveTo(a, nx), { cls: 'sm ghost', icon: 'arrowRight', aria: `Move ${a.title} to ${ALBUM_STAGE_LABEL[nx]}` }) : pill('Done', 's2'),
          iconBtn('whatsapp', 'WhatsApp status', () => waStatus(a), 'wa-ic'), iconBtn('pencil', `Edit ${a.title}`, () => openAlbumForm(a))];
      },
      emptyText: albums.length ? 'No albums match these filters.' : 'No album orders yet.',
      emptyAction: btn('New album order', () => openAlbumForm(), { cls: 'gold', icon: 'plus' }),
    });
    t.querySelector?.('table')?.classList.add('stack');
    return t;
  }
  const draw = () => {
    const rows = filtered();
    if (!albums.length) mount(host, empty('Track every album from design to delivery, with lab, box and courier costs so you see the real profit.', btn('New album order', () => openAlbumForm(), { cls: 'gold', icon: 'plus' }), { icon: 'album', title: 'No album orders yet' }));
    else mount(host, UI.view === 'board' ? board(rows) : listView(rows));
    const P = sum(rows, a => K.get(a.id).price), C = sum(rows, a => K.get(a.id).cost);
    foot.textContent = rows.length ? `${rows.length} album${rows.length === 1 ? '' : 's'} · price ${money(P)} · cost ${money(C)} · profit ${money(P - C)}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  draw();
  if (!refresh && query.new) setTimeout(() => openAlbumForm(), 0);
  if (!refresh && query.edit) setTimeout(async () => { const a = await getRow('album_orders', query.edit); if (a) openAlbumForm(a); }, 0);
  const profit = sum(albums, a => K.get(a.id).profit);
  return h('div', null,
    pageHead('Albums', [`${prod.length} in production`, over.length ? `${over.length} overdue` : null, `profit ${money(profit)}`].filter(Boolean).join(' · '), [
      btn('Vendors', () => { location.hash = '#/vendors'; }, { icon: 'truck' }),
      btn('New album order', () => openAlbumForm(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, dueChips, h('span', { class: 'grow tb-sp' }), seg), host, foot));
}

// ======================================================================
// Drawer
// ======================================================================
function albumStepper(stage, onPick) {
  const cur = Math.max(0, ALBUM_STAGES.indexOf(stage || 'design'));
  return h('div', { class: 'stepper al-stepper', role: 'group', 'aria-label': 'Album stage' },
    ALBUM_STAGES.map((s, i) => h('button', {
      type: 'button', class: 'step' + (i < cur ? ' done' : i === cur ? ' cur' : ''), 'aria-pressed': String(i === cur),
      'aria-label': `${ALBUM_STAGE_LABEL[s]}${i === cur ? ' (current)' : ''}`, onclick: () => onPick(s),
    }, ALBUM_STAGE_LABEL[s])));
}

export function openAlbumDrawer(id) {
  const d = openDrawer({
    hash: '/albums/' + id, label: 'Album order',
    render: async () => {
      const a = await getRow('album_orders', id);
      if (!a) { toast('Album order not found.', 'warn'); return null; }
      const [customer, project, invoice, expenses, vendors] = await Promise.all([
        a.customer_id ? getRow('customers', a.customer_id) : null, a.project_id ? getRow('projects', a.project_id) : null, a.invoice_id ? getRow('invoices', a.invoice_id) : null,
        all('expenses'), all('vendors').catch(() => [])]);
      const vMap = new Map(vendors.map(v => [v.id, v]));
      const k = albumCosting(a, expenses); const today = todayIST(); const od = albumOverdue(a, today);
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Edit album order', icon: 'pencil', onClick: () => openAlbumForm(a) },
        { text: 'Job card PDF (internal, with costs)', icon: 'download', onClick: () => jobCardShare(a) },
        invoice ? { text: 'Create another invoice', icon: 'invoice', onClick: () => createAlbumInvoice(a) } : null, '-',
        { text: 'Delete album order', icon: 'trash', cls: 'danger', onClick: async () => { if (await deleteAlbum(a)) closeDrawerPanel(); } },
      ]));
      const toggle = async (e, b) => busy(b, async () => {
        try { await update('expenses', e.id, { paid_status: e.paid_status === 'unpaid' ? 'paid' : 'unpaid' }); toast(e.paid_status === 'unpaid' ? `Marked paid · ${money(e.amount)}` : 'Marked unpaid', 'success'); }
        catch (er) { toast(errMsg(er), 'error'); }
      });
      const costRows = k.costs.length ? h('div', { class: 'jc' },
        h('div', { class: 'jc-row jc-head', 'aria-hidden': 'true' }, h('span', null, 'Cost'), h('span', { class: 'r' }, 'Qty × Rate'), h('span', { class: 'r' }, 'Amount'), h('span', { class: 'r' }, 'Status'), h('span')),
        k.costs.map(e => {
          const v = vMap.get(e.vendor_id);
          return h('div', { class: 'jc-row' },
            h('span', { class: 'jc-main' }, h('span', { class: 'tag' }, e.category), h('span', null, h('b', null, e.description || e.category), h('small', null, v ? recLink('vendor', v.id, v.name) : 'No vendor', ' · ', h('span', { class: 'nowrap' }, fmtDateShort(e.expense_date))))),
            h('span', { class: 'r muted nowrap' }, e.qty != null && e.unit_rate != null ? `${num(e.qty)} × ${money(e.unit_rate)}` : '—'),
            h('span', { class: 'r nowrap' }, h('b', { class: 'num' }, money(e.amount))),
            h('span', { class: 'r' }, h('button', { type: 'button', class: 'st-btn ' + (e.paid_status === 'unpaid' ? 's3' : 's2'), title: e.paid_status === 'unpaid' ? 'Click to mark paid' : 'Click to mark unpaid', 'aria-label': `${e.description || e.category}: ${e.paid_status === 'unpaid' ? 'unpaid, mark paid' : 'paid, mark unpaid'}`, onclick: ev => toggle(e, ev.currentTarget) }, e.paid_status === 'unpaid' ? 'Unpaid' : 'Paid')),
            h('span', { class: 'jc-act' }, iconBtn('pencil', `Edit cost ${e.description || e.category}`, () => openCostForm(a, e))));
        }),
        h('div', { class: 'jc-row jc-total' }, h('span', null, 'Total cost', k.unpaid ? h('small', { class: 'warn' }, `${money(k.unpaid)} unpaid to vendors`) : null), h('span'), h('span', { class: 'r' }, h('b', { class: 'num' }, money(k.cost))), h('span'), h('span')))
        : h('p', { class: 'dim small' }, 'No costs yet. Add the lab print, lamination, box and courier bills to see the profit.');
      return {
        title: a.title || 'Album', badge: albumPill(a.stage),
        sub: [customer?.name, [a.sheets ? `${a.sheets} sheets` : null, a.size, a.paper].filter(Boolean).join(' · '), a.due_date ? `due ${fmtDate(a.due_date)}` : null].filter(Boolean).join(' · '),
        actions: h('div', { class: 'btns' },
          btn('Add cost', () => openCostForm(a), { cls: 'gold sm', icon: 'plus' }),
          invoice ? btn(invoice.number, () => import('./common.js').then(m => m.openRecord('invoice', invoice.id)), { cls: 'sm', icon: 'invoice', aria: `Open invoice ${invoice.number}` }) : btn('Create invoice', () => createAlbumInvoice(a), { cls: 'sm', icon: 'invoice' }),
          customer && (customer.whatsapp || customer.mobile) ? btn('WhatsApp status', () => openWhatsApp(customer.whatsapp || customer.mobile, statusText(a, customer)), { cls: 'wa sm', icon: 'whatsapp' }) : null,
          btn('Edit', () => openAlbumForm(a), { cls: 'sm', icon: 'pencil' }),
          h('span', { class: 'grow' }), more),
        body: [
          od ? h('div', { class: 'warn-box', role: 'note' }, ic('alert', 15), h('span', null, h('b', null, 'Overdue'), ` — was due ${fmtDate(a.due_date)} (${dueText(a, today)}). Update the customer on WhatsApp.`)) : null,
          h('div', { class: 'stat-row g4' },
            [['Price', money(k.price)], ['Total cost', money(k.cost)], ['Profit', money(k.profit), k.profit >= 0 ? 'up' : 'dn'], ['Margin', fmtPct(k.margin), k.margin == null ? '' : k.margin >= 0 ? 'up' : 'dn']]
              .map(([l, v, cls]) => h('div', { class: 'stat' }, h('span', null, l), h('b', { class: cls || '' }, v)))),
          dwSection('Stage', [albumStepper(a.stage, s => setAlbumStage(a, s)), h('p', { class: 'dim small', style: { marginTop: '8px' } }, 'Click a stage to move the album. Send the customer a WhatsApp update after each step.')]),
          dwSection('Job costing', costRows, btn('Add cost', () => openCostForm(a), { cls: 'sm', icon: 'plus' })),
          h('div', { class: 'kv dw-kv' },
            h('span', null, 'Customer'), h('b', null, customer ? recLink('customer', customer.id, customer.name) : '—'),
            h('span', null, 'Project'), h('b', null, project ? recLink('project', project.id, project.name) : '—'),
            h('span', null, 'Invoice'), h('b', null, invoice ? [recLink('invoice', invoice.id, invoice.number), ' ', invStatus(invoice.status)] : '—'),
            h('span', null, 'Sheets'), h('b', null, a.sheets != null ? String(a.sheets) : '—'),
            h('span', null, 'Size'), h('b', null, a.size || '—'), h('span', null, 'Paper'), h('b', null, a.paper || '—'),
            h('span', null, 'Due date'), h('b', { class: od ? 'dn' : '' }, fmtDate(a.due_date)),
            h('span', null, 'Ordered'), h('b', null, fmtDate(String(a.created_at || '').slice(0, 10)))),
          a.notes ? dwSection('Notes', h('div', { class: 'notes-box' }, a.notes)) : null,
        ],
      };
    },
  });
  d.recId = id;
  return d;
}

/** Dashboard block "Albums in production" (shown when Settings → Album & printing module is on). */
export function albumsBlock(albums, expenses, cMap, today) {
  const prod = albums.filter(a => a.stage !== 'delivered');
  const over = prod.filter(a => albumOverdue(a, today));
  const next = prod.slice().sort((x, y) => String(x.due_date || '9999').localeCompare(String(y.due_date || '9999'))).slice(0, 5);
  const counts = ALBUM_STAGES.filter(s => s !== 'delivered').map(s => [s, prod.filter(a => a.stage === s).length]);
  const unpaid = sum(expenses.filter(e => e.album_order_id && e.paid_status === 'unpaid'), e => e.amount);
  return h('section', { class: 'card al-dash' },
    h('div', { class: 'ch' }, h('h3', null, 'Albums in production'), h('div', { class: 'btns' }, h('span', { class: over.length ? 'dn small' : 'dim small' }, over.length ? `${over.length} overdue` : 'Nothing overdue'), h('a', { class: 'btn sm', href: '#/albums' }, 'Album board'))),
    h('div', { class: 'al-stages' }, counts.map(([s, n]) => h('a', { class: 'mk' + (n ? '' : ' zero'), href: '#/albums' }, h('span', null, ALBUM_STAGE_LABEL[s]), h('b', null, String(n)))),
      h('a', { class: 'mk' + (over.length ? ' late' : ' zero'), href: '#/albums?due=overdue' }, h('span', null, 'Overdue'), h('b', { class: over.length ? 'dn' : '' }, String(over.length)))),
    next.length ? h('div', null, next.map(a => h('div', { class: 'li' },
      h('div', null, recLink('album', a.id, a.title || 'Album'), h('small', { class: albumOverdue(a, today) ? 'dn' : '' }, [cMap.get(a.customer_id)?.name, ALBUM_STAGE_LABEL[a.stage], dueText(a, today)].filter(Boolean).join(' · '))),
      h('div', null, albumPill(a.stage)))))
      : empty('No albums in production.', h('a', { class: 'btn sm gold', href: '#/albums?new=1' }, 'New album order'), { icon: 'album' }),
    unpaid > 0 ? h('p', { class: 'dim small al-unpaid' }, `${money(unpaid)} unpaid to album vendors · `, h('a', { href: '#/vendors' }, 'Vendors')) : null);
}
