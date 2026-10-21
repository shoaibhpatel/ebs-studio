// Leads (owner): pipeline board with drag-and-drop + list view, lead form, lead drawer, convert to customer.
import { h, mount, table, field, input, textarea, select, btn, iconBtn, searchBox, chips, ic, pill, empty } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, insert, update, remove, getRow, state, convertLead, logActivity } from '../store.js';
import { money, moneyShort, fmtDate, fmtDateShort, includesCI, debounce, todayIST, daysBetween, sum, monthKey, monthLabel } from '../util.js';
import { DEFAULT_PROJECT_TYPES } from '../config.js';
import { pageHead, dwSection, statRow, recLink } from './common.js';
import { openWhatsApp } from '../share.js';

export const LEAD_STATUSES = ['new', 'contacted', 'quote_sent', 'won', 'lost'];
export const LEAD_LABEL = { new: 'New', contacted: 'Contacted', quote_sent: 'Quote sent', won: 'Won', lost: 'Lost' };
const LEAD_TONE = { new: 's1', contacted: 's5', quote_sent: 's3', won: 's2', lost: 's0' };
export const LEAD_SOURCES = ['Instagram', 'Facebook', 'Google', 'Referral', 'Walk-in', 'WhatsApp', 'Website', 'Other'];
export const FOLLOW_UP_DAYS = 3;

const UI = { view: null, q: '', source: '', month: '', sort: { key: 'Created', dir: -1 } };
export const leadPill = s => pill(LEAD_LABEL[s] || 'New', LEAD_TONE[s] || 's1');
const createdDay = l => String(l.created_at || '').slice(0, 10) || todayIST();
export const leadAge = (l, today = todayIST()) => Math.max(0, daysBetween(createdDay(l), today));
const ageText = n => (n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`);
/** Quote sent and no change for more than FOLLOW_UP_DAYS days. */
export function needsFollowUp(l, today = todayIST()) {
  if (l.status !== 'quote_sent') return false;
  const last = String(l.updated_at || l.created_at || '').slice(0, 10);
  return !!last && daysBetween(last, today) > FOLLOW_UP_DAYS;
}
const types = () => (state.settings.project_types?.length ? state.settings.project_types : DEFAULT_PROJECT_TYPES).slice();
export function greetingText(l) {
  const co = state.company?.name || 'our studio';
  const what = l.event_type ? ` for your ${l.event_type.toLowerCase()}` : '';
  const when = l.event_date ? ` on ${fmtDate(l.event_date)}` : '';
  return [`Hello ${l.name},`, '', `Thank you for contacting *${co}*${what}${when}. We would love to be a part of it!`, '',
    'Could you share a few details — venue, number of days / functions and the coverage you have in mind? We will send you the best package options.', '', `— ${co}`].join('\n');
}

// ======================================================================
// Lead form
// ======================================================================
export function openLeadForm(existing = null, preset = {}) {
  const l = existing || { status: 'new', source: 'Instagram', ...preset };
  const tps = types(); if (l.event_type && !tps.includes(l.event_type)) tps.unshift(l.event_type);
  const f = {
    name: input({ value: l.name || '', autocomplete: 'off', placeholder: 'Who enquired' }),
    mobile: input({ value: l.mobile || '', type: 'tel', inputmode: 'tel', placeholder: '+91 …' }),
    email: input({ value: l.email || '', type: 'email', inputmode: 'email' }),
    event_type: select([['', '— Not sure yet —'], ...tps], l.event_type || ''),
    event_date: input({ type: 'date', value: l.event_date || '' }),
    budget: input({ type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'inp num', value: l.budget ?? '' }),
    status: select(LEAD_STATUSES.map(s => [s, LEAD_LABEL[s]]), l.status || 'new'),
    notes: textarea({ value: l.notes || '', rows: 3, placeholder: 'What they asked for, follow-up notes…' }),
  };
  let source = l.source || '';
  const srcChips = chips(LEAD_SOURCES.map(s => [s, s]), source, v => { source = v; if (m) m.dirty = true; }, 'Lead source');
  srcChips.classList.add('src-chips');
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  let m;
  const save = btn(existing ? 'Save changes' : 'Add lead', async () => {
    errBox.textContent = '';
    const name = f.name.value.trim();
    if (!name) { errBox.textContent = 'Name is required.'; f.name.focus(); return; }
    if (!f.mobile.value.trim() && !f.email.value.trim()) { errBox.textContent = 'Add a mobile number or an email so you can follow up.'; f.mobile.focus(); return; }
    if (f.email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) { errBox.textContent = 'Email looks invalid.'; f.email.focus(); return; }
    const row = {
      name, mobile: f.mobile.value.trim() || null, email: f.email.value.trim() || null, event_type: f.event_type.value || null,
      event_date: f.event_date.value || null, budget: f.budget.value === '' ? null : Number(f.budget.value) || 0, source: source || null,
      status: f.status.value, notes: f.notes.value.trim() || null,
    };
    await busy(save, async () => {
      try {
        const saved = existing ? await update('leads', existing.id, row) : await insert('leads', row);
        if (!existing) logActivity(`New lead ${saved.name}${saved.source ? ' from ' + saved.source : ''}`, '☺');
        toast(existing ? 'Lead updated' : 'Lead added', 'success');
        m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: existing ? 'Edit lead' : 'New lead', guard: true,
    body: [errBox, h('form', { class: 'form-grid', novalidate: true, onsubmit: e => { e.preventDefault(); save.click(); } },
      field('Name', f.name, { required: true, cls: 'full' }),
      field('Mobile', f.mobile), field('Email', f.email),
      h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Source'), srcChips),
      field('Event type', f.event_type), field('Event date', f.event_date),
      field('Budget (₹)', f.budget), field('Status', f.status),
      field('Notes', f.notes, { cls: 'full' }),
      h('button', { type: 'submit', hidden: true, tabindex: '-1' }))],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  return m.result;
}

// ======================================================================
// Actions
// ======================================================================
export async function setLeadStatus(l, status) {
  if (l.status === status) return l;
  try {
    const saved = await update('leads', l.id, { status });
    toast(`${l.name}: ${LEAD_LABEL[status]}`, 'success');
    return saved;
  } catch (e) { toast(errMsg(e), 'error'); return null; }
}
/** Lead → customer (re-uses a customer with the same mobile), then offer to create the project. */
export async function convertToCustomer(l, { askProject = true } = {}) {
  try {
    const { customer, created } = await convertLead(l);
    toast(created ? `Customer ${customer.name} created` : `Linked to existing customer ${customer.name}`, 'success');
    if (askProject && await confirmDialog(`${customer.name} is now a customer. Create the project for this ${l.event_type ? l.event_type.toLowerCase() : 'booking'} now?`, { title: 'Create project?', okText: 'Create project', cancelText: 'Later' })) {
      const { openProjectForm } = await import('./projects.js');
      await openProjectForm(null, { customer_id: customer.id, name: l.event_type ? `${l.event_type} – ${customer.name}` : customer.name, type: l.event_type || undefined, event_date: l.event_date || null, value: l.budget || 0, notes: l.notes || null, status: 'Booked' });
    }
    return customer;
  } catch (e) { toast(errMsg(e), 'error'); return null; }
}
export async function createQuotation(l) {
  const { openQuotationEditor } = await import('./quotations.js');
  return openQuotationEditor(null, {
    preset: l.customer_id ? { customer: l.customer_id } : { guest: l.name },
    afterSave: async () => { const cur = await getRow('leads', l.id); if (cur && (cur.status === 'new' || cur.status === 'contacted')) await update('leads', l.id, { status: 'quote_sent' }); },
  });
}
async function deleteLead(l) {
  if (!(await confirmDialog(`Delete lead “${l.name}”? This cannot be undone.`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('leads', l.id); toast('Lead deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
const call = l => { if (l.mobile) location.href = 'tel:' + String(l.mobile).replace(/[^\d+]/g, ''); };
const wa = l => openWhatsApp(l.mobile, greetingText(l));

// ======================================================================
// Page
// ======================================================================
export const routeView = ({ params }) => openLeadDrawer(params.id);

export async function render({ query = {}, refresh } = {}) {
  if (!refresh) {
    if (query.view === 'list' || query.view === 'board') UI.view = query.view;
    if (query.source) UI.source = query.source;
  }
  if (!UI.view) UI.view = matchMedia('(max-width: 760px)').matches ? 'list' : 'board';
  const leads = await all('leads');
  const today = todayIST();
  const open = leads.filter(l => !['won', 'lost'].includes(l.status));
  const wonMonth = leads.filter(l => l.status === 'won' && monthKey(l.updated_at || l.created_at) === monthKey(today)).length;
  const follow = leads.filter(l => needsFollowUp(l, today));

  const sb = searchBox({ placeholder: 'Search name, mobile, event, notes…', 'aria-label': 'Search leads', value: UI.q, wrapCls: 'grow' });
  const srcSel = select([['', 'All sources'], ...LEAD_SOURCES], UI.source, { 'aria-label': 'Filter by source' });
  const months = [...new Set(leads.map(l => monthKey(l.event_date)).filter(Boolean))].sort();
  const monSel = select([['', 'Any event month'], ...months.map(k => [k, monthLabel(k)])], UI.month, { 'aria-label': 'Filter by event month' });
  const seg = h('div', { class: 'cal-seg', role: 'group', 'aria-label': 'Leads view' }, [['board', 'Board', 'kanban'], ['list', 'List', 'list']].map(([v, l, icn]) =>
    h('button', { type: 'button', 'aria-pressed': String(UI.view === v), onclick: () => { UI.view = v; seg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); draw(); }, dataset: { v } }, ic(icn, 14), h('span', null, l))));
  const host = h('div'); const foot = h('div', { class: 'list-foot' });

  const filtered = () => {
    UI.q = sb.input.value; const t = UI.q.trim(); const dg = t.replace(/\D/g, '');
    return leads.filter(l => (!UI.source || l.source === UI.source) && (!UI.month || monthKey(l.event_date) === UI.month)
      && (!t || includesCI(l.name, t) || includesCI(l.event_type, t) || includesCI(l.notes, t) || includesCI(l.email, t) || (dg.length >= 3 && String(l.mobile || '').replace(/\D/g, '').includes(dg))));
  };

  function card(l) {
    const age = leadAge(l, today); const fu = needsFollowUp(l, today);
    const sel = select(LEAD_STATUSES.map(s => [s, LEAD_LABEL[s]]), l.status, { class: 'inp lead-sel', 'aria-label': `Move ${l.name} to` });
    sel.addEventListener('click', e => e.stopPropagation());
    sel.addEventListener('change', () => moveTo(l, sel.value));
    const el = h('article', {
      class: ['lead-card', fu ? 'fu' : null], tabindex: '0', draggable: 'true', dataset: { id: l.id }, 'aria-label': `Lead ${l.name}, ${LEAD_LABEL[l.status]}. Press Enter to open.`,
      onclick: e => { if (!e.target.closest('select,button')) openLeadDrawer(l.id); },
      onkeydown: e => { if (e.key === 'Enter' && e.target === el) openLeadDrawer(l.id); },
    },
    h('div', { class: 'lc-top' }, h('b', null, l.name), l.budget ? h('span', { class: 'lc-bud' }, moneyShort(l.budget)) : null),
    h('div', { class: 'lc-ev' }, [l.event_type, l.event_date ? fmtDateShort(l.event_date) : null].filter(Boolean).join(' · ') || h('span', { class: 'dim' }, 'Event not set')),
    h('div', { class: 'lc-foot' }, l.source ? h('span', { class: 'tag' }, l.source) : null, fu ? h('span', { class: 'st s3' }, 'Follow up') : null,
      h('span', { class: 'lc-age', title: 'Enquired ' + fmtDate(createdDay(l)) }, ic('clock', 12), ageText(age))),
    h('div', { class: 'lc-act' }, sel,
      l.mobile ? iconBtn('whatsapp', `WhatsApp ${l.name}`, e => { e.stopPropagation(); wa(l); }, 'wa-ic') : null,
      l.mobile ? iconBtn('phone', `Call ${l.name}`, e => { e.stopPropagation(); call(l); }) : null));
    el.addEventListener('dragstart', e => { el.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', l.id); } catch { /* ignore */ } });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    return el;
  }

  async function moveTo(l, status) {
    if (status === l.status) return;
    if (status === 'won' && !l.customer_id) {
      const ok = await confirmDialog(`Mark ${l.name} as won and convert to a customer?`, { title: 'Lead won', okText: 'Convert to customer', cancelText: 'Just mark won' });
      if (ok) { await convertToCustomer(l); return; }
    }
    await setLeadStatus(l, status);
  }

  function board(rows) {
    return h('div', { class: 'lead-board' }, LEAD_STATUSES.map(s => {
      const list = rows.filter(l => (l.status || 'new') === s).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const col = h('section', { class: 'lead-col k-' + s, 'aria-label': `${LEAD_LABEL[s]}: ${list.length} lead${list.length === 1 ? '' : 's'}` },
        h('div', { class: 'lead-col-h' }, leadPill(s), h('span', { class: 'cnt' }, String(list.length)), h('span', { class: 'grow' }), list.length ? h('small', { class: 'dim' }, moneyShort(sum(list, l => l.budget))) : null),
        h('div', { class: 'lead-col-b' }, list.length ? list.map(card) : h('p', { class: 'lead-empty' }, s === 'new' ? 'No new enquiries.' : 'Drop a lead here')),
        s === 'new' ? h('button', { type: 'button', class: 'lead-add', onclick: () => openLeadForm() }, ic('plus', 14), 'Add lead') : null);
      col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('over'); });
      col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('over'); });
      col.addEventListener('drop', e => {
        e.preventDefault(); col.classList.remove('over');
        let id = ''; try { id = e.dataTransfer.getData('text/plain'); } catch { /* ignore */ }
        const l = leads.find(x => x.id === id); if (l) moveTo(l, s);
      });
      return col;
    }));
  }

  function listView(rows) {
    const t = table([
      { label: 'Name', sort: l => l.name, cell: l => [h('b', null, l.name), h('small', null, l.mobile || l.email || '—')] },
      { label: 'Event', sort: l => l.event_type || '', cell: l => h('span', { class: 'muted' }, l.event_type || '—') },
      { label: 'Date', sort: l => l.event_date || '9999', cell: l => h('span', { class: 'nowrap' }, fmtDate(l.event_date)) },
      { label: 'Budget', cls: 'r', sort: l => Number(l.budget) || 0, sortDir: -1, cell: l => h('span', { class: 'num' }, l.budget ? money(l.budget) : '—') },
      { label: 'Source', sort: l => l.source || '', cell: l => (l.source ? h('span', { class: 'tag' }, l.source) : '—') },
      { label: 'Status', sort: l => LEAD_STATUSES.indexOf(l.status), cell: l => [leadPill(l.status), needsFollowUp(l, today) ? [' ', pill('Follow up', 's3')] : null] },
      { label: 'Created', sort: l => String(l.created_at || ''), sortDir: -1, cell: l => h('span', { class: 'nowrap muted' }, ageText(leadAge(l, today))) },
    ], rows, {
      sort: UI.sort, onRow: l => openLeadDrawer(l.id), rowLabel: l => 'Open lead ' + l.name,
      actions: l => [
        l.mobile ? iconBtn('whatsapp', `WhatsApp ${l.name}`, () => wa(l), 'wa-ic') : null,
        l.mobile ? iconBtn('phone', `Call ${l.name}`, () => call(l)) : null,
        iconBtn('quote', `Create quotation for ${l.name}`, () => createQuotation(l)),
        iconBtn('pencil', `Edit ${l.name}`, () => openLeadForm(l)),
      ],
      emptyText: leads.length ? 'No leads match these filters.' : 'No leads yet. Add your first enquiry.',
      emptyAction: btn('New lead', () => openLeadForm(), { cls: 'gold', icon: 'plus' }),
    });
    t.querySelector?.('table')?.classList.add('stack');
    return t;
  }

  const draw = () => {
    const rows = filtered();
    if (!leads.length) mount(host, empty('Capture enquiries from Instagram, referrals and walk-ins, then follow them up to a booking.', btn('New lead', () => openLeadForm(), { cls: 'gold', icon: 'plus' }), { icon: 'target', title: 'No leads yet' }));
    else mount(host, UI.view === 'board' ? board(rows) : listView(rows));
    foot.textContent = rows.length ? `${rows.length} lead${rows.length === 1 ? '' : 's'} · budget ${money(sum(rows.filter(l => !['lost'].includes(l.status)), l => l.budget))}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  srcSel.addEventListener('change', () => { UI.source = srcSel.value; draw(); });
  monSel.addEventListener('change', () => { UI.month = monSel.value; draw(); });
  draw();
  if (!refresh && query.new) setTimeout(() => openLeadForm(), 0);
  return h('div', null,
    pageHead('Leads', [`${open.length} open`, `${wonMonth} won this month`, follow.length ? `${follow.length} to follow up` : null].filter(Boolean).join(' · '), [
      btn('New lead', () => openLeadForm(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, srcSel, monSel, h('span', { class: 'grow tb-sp' }), seg), host, foot));
}

// ======================================================================
// Drawer
// ======================================================================
export function openLeadDrawer(id) {
  const d = openDrawer({
    hash: '/leads/' + id, label: 'Lead', size: 'narrow',
    render: async () => {
      const l = await getRow('leads', id);
      if (!l) { toast('Lead not found.', 'warn'); return null; }
      const customer = l.customer_id ? await getRow('customers', l.customer_id) : null;
      const today = todayIST(); const age = leadAge(l, today); const fu = needsFollowUp(l, today);
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Edit lead', icon: 'pencil', onClick: () => openLeadForm(l) },
        l.status !== 'lost' ? { text: 'Mark as lost', icon: 'x', onClick: () => setLeadStatus(l, 'lost') } : { text: 'Reopen lead', icon: 'repeat', onClick: () => setLeadStatus(l, 'contacted') },
        '-',
        { text: 'Delete lead', icon: 'trash', cls: 'danger', onClick: async () => { if (await deleteLead(l)) closeDrawerPanel(); } },
      ]));
      const steps = h('div', { class: 'chips lead-steps', role: 'group', 'aria-label': 'Lead status' }, LEAD_STATUSES.map(s => h('button', {
        type: 'button', class: 'chip sm', 'aria-pressed': String(l.status === s),
        onclick: async () => { if (s === 'won' && !l.customer_id) { if (await confirmDialog(`Convert ${l.name} to a customer?`, { title: 'Lead won', okText: 'Convert to customer', cancelText: 'Just mark won' })) { await convertToCustomer(l); return; } } setLeadStatus(l, s); },
      }, LEAD_LABEL[s])));
      return {
        title: l.name, badge: leadPill(l.status),
        sub: [l.event_type, l.event_date ? fmtDate(l.event_date) : null, l.source].filter(Boolean).join(' · ') || 'Lead',
        actions: h('div', { class: 'btns' },
          l.mobile ? btn('WhatsApp', () => wa(l), { cls: 'wa sm', icon: 'whatsapp' }) : null,
          l.mobile ? h('a', { class: 'btn sm', href: 'tel:' + String(l.mobile).replace(/[^\d+]/g, '') }, h('span', { class: 'bi' }, ic('phone', 15)), 'Call') : null,
          btn('Create quotation', () => createQuotation(l), { cls: 'sm', icon: 'quote' }),
          customer ? null : btn('Convert to customer', () => convertToCustomer(l), { cls: 'gold sm', icon: 'user' }),
          h('span', { class: 'grow' }), more),
        body: [
          fu ? h('div', { class: 'warn-box', role: 'note' }, ic('alert', 15), h('span', null, h('b', null, 'Follow up'), ` — quotation sent more than ${FOLLOW_UP_DAYS} days ago. Send a reminder on WhatsApp or call.`)) : null,
          statRow([['Budget', l.budget ? money(l.budget) : '—'], ['Event', l.event_date ? fmtDateShort(l.event_date) : '—'], ['Enquired', ageText(age)]]),
          dwSection('Pipeline', steps),
          customer ? h('div', { class: 'info-box' }, 'Customer: ', recLink('customer', customer.id, customer.name),
            h('span', { class: 'dim' }, ' · '), h('button', { type: 'button', class: 'lnk', onclick: () => import('./projects.js').then(m => m.openProjectForm(null, { customer_id: customer.id, name: l.event_type ? `${l.event_type} – ${customer.name}` : customer.name, type: l.event_type || undefined, event_date: l.event_date || null, value: l.budget || 0 })) }, 'Create project')) : null,
          h('div', { class: 'kv dw-kv' },
            h('span', null, 'Mobile'), h('b', null, l.mobile || '—'), h('span', null, 'Email'), h('b', null, l.email || '—'),
            h('span', null, 'Event type'), h('b', null, l.event_type || '—'), h('span', null, 'Event date'), h('b', null, fmtDate(l.event_date)),
            h('span', null, 'Source'), h('b', null, l.source || '—'), h('span', null, 'Enquired on'), h('b', null, fmtDate(createdDay(l)))),
          l.notes ? dwSection('Notes', h('div', { class: 'notes-box' }, l.notes)) : null,
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
