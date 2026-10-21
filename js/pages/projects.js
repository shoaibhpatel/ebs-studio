import { h, mount, table, field, input, textarea, select, btn, iconBtn, pill, searchBox, chips, ic } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, insert, update, remove, state, logActivity, getRow, teamData } from '../store.js';
import { crewSection, openTaskForm } from './team.js';
import { money, fmtDate, includesCI, debounce, todayIST, sum } from '../util.js';
import { STAGES, STAGE_LABEL, PROJECT_STATUSES, DEFAULT_PROJECT_TYPES } from '../config.js';
import { projStatus, normStatus, stageProgress, pageHead, isActiveProject, invStatus, openRecord, recLink, dwSection, statRow } from './common.js';
import { openCustomerForm } from './customers.js';
import { setHashSilently } from '../router.js';
import { calendarButton } from './calendar.js';
import { projectCalEvents } from '../calcore.js';

const UI = { stage: '', status: 'active', q: '', sort: { key: 'Event', dir: 1 } };
const newInvoice = (p) => import('./invoices.js').then(m => m.openInvoiceEditor(null, { preset: { customer: p.customer_id, project: p.id } }));

export function stepper(stage, onPick) {
  const cur = Math.max(0, STAGES.indexOf(stage || 'booking'));
  return h('div', { class: 'stepper', role: 'group', 'aria-label': 'Workflow stage' },
    STAGES.map((s, i) => h('button', {
      type: 'button', class: 'step' + (i < cur ? ' done' : i === cur ? ' cur' : ''), 'aria-pressed': String(i === cur),
      'aria-label': `${STAGE_LABEL[s]}${i === cur ? ' (current)' : ''}`, onclick: onPick ? () => onPick(s) : null, disabled: !onPick,
    }, STAGE_LABEL[s])));
}

export async function openProjectForm(existing = null, preset = {}) {
  const p = existing || { stage: 'booking', status: 'Booked', booking_date: todayIST(), ...preset };
  const customers = (await all('customers')).slice().sort((a, b) => a.name.localeCompare(b.name));
  const types = (state.settings.project_types?.length ? state.settings.project_types : DEFAULT_PROJECT_TYPES).slice();
  if (p.type && !types.includes(p.type)) types.unshift(p.type);
  const custSel = select([['', '— Select customer —'], ...customers.map(c => [c.id, `${c.name}${c.mobile ? ' · ' + c.mobile : ''}`])], p.customer_id || '');
  const f = {
    name: input({ value: p.name || '' }),
    type: select(types, p.type || types[0]),
    status: select(PROJECT_STATUSES, normStatus(p.status)),
    booking_date: input({ type: 'date', value: p.booking_date || '' }),
    event_date: input({ type: 'date', value: p.event_date || '' }),
    event_end_date: input({ type: 'date', value: p.event_end_date || '' }),
    delivery_date: input({ type: 'date', value: p.delivery_date || '' }),
    venue: input({ value: p.venue || '' }),
    value: input({ type: 'number', min: '0', step: '0.01', inputmode: 'decimal', value: p.value ?? '', class: 'inp num' }),
    notes: textarea({ value: p.notes || '', rows: 3 }),
  };
  let stage = p.stage || 'booking';
  let m;
  const stepHost = h('div');
  const drawStep = () => mount(stepHost, stepper(stage, s => { stage = s; m.dirty = true; if (s === 'delivered' && f.status.value !== 'Cancelled') f.status.value = 'Completed'; drawStep(); }));
  drawStep();
  const addCust = btn('New', async () => {
    const c = await openCustomerForm();
    if (c) { custSel.appendChild(h('option', { value: c.id }, `${c.name}${c.mobile ? ' · ' + c.mobile : ''}`)); custSel.value = c.id; custSel.dispatchEvent(new Event('change', { bubbles: true })); }
  }, { cls: 'sm', aria: 'Add a new customer', icon: 'plus' });
  custSel.id = 'pc-' + Math.random().toString(36).slice(2, 7);
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const save = btn(existing ? 'Save changes' : 'Create project', async () => {
    errBox.textContent = '';
    if (!custSel.value) { errBox.textContent = 'Choose a customer.'; custSel.focus(); return; }
    if (!f.name.value.trim()) { errBox.textContent = 'Project name is required.'; f.name.focus(); return; }
    if (f.event_end_date.value && f.event_date.value && f.event_end_date.value < f.event_date.value) { errBox.textContent = 'Event end date is before the event date.'; return; }
    const row = {
      customer_id: custSel.value, name: f.name.value.trim(), type: f.type.value, status: f.status.value, stage,
      booking_date: f.booking_date.value || null, event_date: f.event_date.value || null, event_end_date: f.event_end_date.value || null,
      delivery_date: f.delivery_date.value || null, venue: f.venue.value.trim() || null, value: Number(f.value.value) || 0, notes: f.notes.value.trim() || null,
    };
    await busy(save, async () => {
      try {
        const saved = existing ? await update('projects', existing.id, row) : await insert('projects', row);
        if (!existing) logActivity(`Project “${saved.name}” booked`, '▣');
        toast(existing ? 'Project updated' : 'Project created', 'success');
        m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: existing ? 'Edit project' : 'New project', size: 'lg', guard: true,
    body: [errBox, h('div', { class: 'form-grid' },
      h('div', { class: 'field full' }, h('label', { for: custSel.id }, 'Customer', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), h('div', { class: 'with-btn' }, custSel, addCust)),
      field('Project name', f.name, { required: true, cls: 'full' }),
      field('Type', f.type), field('Status', f.status),
      h('div', { class: 'field full' }, h('span', { class: 'flbl' }, 'Workflow stage'), stepHost),
      field('Booking date', f.booking_date), field('Event date', f.event_date),
      field('Event end date', f.event_end_date, { hint: 'For multi-day events' }), field('Delivery date', f.delivery_date),
      field('Venue', f.venue), field('Package value (₹)', f.value),
      field('Notes', f.notes, { cls: 'full' }))],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  return m.result;
}

async function deleteProject(p) {
  if (!(await confirmDialog(`Delete project “${p.name}”? Linked invoices stay but lose the project link.`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('projects', p.id); toast('Project deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
async function advance(p, button) {
  const i = STAGES.indexOf(p.stage || 'booking'); const nx = STAGES[i + 1]; if (!nx) return;
  await busy(button, async () => {
    try { const patch = { stage: nx }; if (nx === 'delivered') patch.status = 'Completed'; await update('projects', p.id, patch); toast(`${p.name}: ${STAGE_LABEL[nx]}`, 'success'); }
    catch (er) { toast(errMsg(er), 'error'); }
  });
}

export const routeView = ({ params }) => openProjectDrawer(params.id);

export async function render({ query, refresh }) {
  if (!refresh) { UI.stage = query.stage || ''; UI.status = query.status || 'active'; }
  const [projects, customers, invoices] = await Promise.all([all('projects'), all('customers'), all('invoices')]);
  const cMap = new Map(customers.map(c => [c.id, c]));
  const recv = new Map(); for (const i of invoices) if (i.project_id) recv.set(i.project_id, (recv.get(i.project_id) || 0) + Number(i.paid_amount || 0));
  const sb = searchBox({ placeholder: 'Search project, customer, type, venue…', 'aria-label': 'Search projects', value: UI.q, wrapCls: 'grow' });
  const statusSel = select([['active', 'Active'], ['', 'All statuses'], ...PROJECT_STATUSES.map(s => [s, s])], UI.status, { 'aria-label': 'Filter by status' });
  const stageChips = chips([['', 'All stages', projects.length], ...STAGES.map(s => [s, STAGE_LABEL[s], projects.filter(p => p.stage === s).length])], UI.stage, v => { UI.stage = v; draw(); }, 'Filter by stage');
  const host = h('div'); const foot = h('div', { class: 'list-foot' });
  const draw = () => {
    UI.q = sb.input.value; const t = UI.q.trim();
    const rows = projects.filter(p => (!UI.stage || p.stage === UI.stage)
      && (UI.status === 'active' ? isActiveProject(p) : !UI.status || normStatus(p.status) === UI.status)
      && (!t || includesCI(p.name, t) || includesCI(p.type, t) || includesCI(cMap.get(p.customer_id)?.name, t) || includesCI(p.venue, t)));
    host.replaceChildren(table([
      { label: 'Project', sort: p => p.name, cell: p => [h('b', null, p.name), h('small', null, cMap.get(p.customer_id)?.name || '—')] },
      { label: 'Type', sort: p => p.type || '', cell: p => h('span', { class: 'muted' }, p.type || '—') },
      { label: 'Event', sort: p => p.event_date || '9999', cell: p => h('span', { class: 'nowrap' }, fmtDate(p.event_date)) },
      { label: 'Delivery', sort: p => p.delivery_date || '9999', cell: p => h('span', { class: 'nowrap muted' }, fmtDate(p.delivery_date)) },
      { label: 'Workflow', sort: p => STAGES.indexOf(p.stage || 'booking'), cell: p => stageProgress(p.stage) },
      { label: 'Value', cls: 'r', sort: p => Number(p.value) || 0, sortDir: -1, cell: p => h('span', { class: 'num' }, money(p.value)) },
      { label: 'Received', cls: 'r', sort: p => recv.get(p.id) || 0, sortDir: -1, cell: p => h('span', { class: 'num muted' }, money(recv.get(p.id) || 0)) },
      { label: 'Status', sort: p => normStatus(p.status), cell: p => projStatus(p.status) },
    ], rows, {
      sort: UI.sort,
      onRow: p => openProjectDrawer(p.id), rowLabel: p => 'Open project ' + p.name,
      actions: p => {
        const i = STAGES.indexOf(p.stage || 'booking');
        return [
          i < STAGES.length - 1 ? btn(STAGE_LABEL[STAGES[i + 1]], e => advance(p, e.currentTarget), { cls: 'sm ghost', icon: 'arrowRight', aria: `Move ${p.name} to ${STAGE_LABEL[STAGES[i + 1]]}` }) : pill('Done', 's2'),
          iconBtn('pencil', `Edit ${p.name}`, () => openProjectForm(p)),
        ];
      },
      emptyText: t || UI.stage || UI.status !== 'active' ? 'No projects match these filters.' : 'No active projects. Book your next shoot.',
      emptyAction: btn('New project', () => openProjectForm(), { cls: 'gold', icon: 'plus' }),
    }));
    host.querySelector('table')?.classList.add('stack');
    foot.textContent = rows.length ? `${rows.length} project${rows.length === 1 ? '' : 's'} · value ${money(sum(rows, p => p.value))}` : '';
  };
  sb.input.addEventListener('input', debounce(draw, 120));
  statusSel.addEventListener('change', () => { UI.status = statusSel.value; draw(); });
  draw();
  // Deep links (legacy): ?open=<id>, ?new=1&customer=<id>
  if (!refresh) setTimeout(async () => {
    if (query.open) { setHashSilently('/projects'); openProjectDrawer(query.open); }
    else if (query.new) { setHashSilently('/projects'); openProjectForm(null, query.customer ? { customer_id: query.customer } : {}); }
  }, 0);
  return h('div', null,
    pageHead('Projects', `${projects.filter(isActiveProject).length} active · ${projects.length} total`, [
      btn('New project', () => openProjectForm(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar' }, sb, statusSel), h('div', { class: 'toolbar' }, stageChips), host, foot));
}

export function openProjectDrawer(id) {
  const d = openDrawer({
    hash: '/projects/' + id, label: 'Project',
    render: async () => {
      const p = await getRow('projects', id);
      if (!p) { toast('Project not found.', 'warn'); return null; }
      const [customer, invoices, quotes, team] = await Promise.all([getRow('customers', p.customer_id), all('invoices'), all('quotations'), teamData()]);
      const myI = invoices.filter(i => i.project_id === p.id);
      const myQ = quotes.filter(q => q.project_id === p.id);
      const received = sum(myI, i => i.paid_amount); const billed = sum(myI, i => i.total);
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'New quotation', icon: 'quote', onClick: () => import('./quotations.js').then(m => m.openQuotationEditor(null, { preset: { customer: p.customer_id, project: p.id } })) },
        { text: 'Assign work', icon: 'team', onClick: () => openTaskForm(null, { project_id: p.id }) }, '-',
        { text: 'Delete project', icon: 'trash', cls: 'danger', onClick: async () => { if (await deleteProject(p)) closeDrawerPanel(); } },
      ]));
      const setStage = async s => {
        try { const patch = { stage: s }; if (s === 'delivered' && normStatus(p.status) !== 'Cancelled') patch.status = 'Completed'; await update('projects', p.id, patch); toast(`${p.name}: ${STAGE_LABEL[s]}`, 'success'); }
        catch (e) { toast(errMsg(e), 'error'); }
      };
      const li = (main, sub, right, onClick) => h('button', { type: 'button', class: 'li li-btn', onclick: onClick }, h('div', null, main, sub ? h('small', null, sub) : null), h('div', null, right));
      return {
        title: p.name, badge: projStatus(p.status),
        sub: [customer?.name, p.type, p.event_date ? fmtDate(p.event_date) : null].filter(Boolean).join(' · '),
        actions: h('div', { class: 'btns' }, btn('Edit', () => openProjectForm(p), { icon: 'pencil', cls: 'sm' }), btn('New invoice', () => newInvoice(p), { cls: 'gold sm', icon: 'plus' }),
          calendarButton(() => projectCalEvents(p, customer)), h('span', { class: 'grow' }), more),
        body: [
          statRow([['Package value', money(p.value)], ['Billed', money(billed)], ['Received', money(received), 'up']]),
          dwSection('Workflow', [stepper(p.stage, setStage), h('p', { class: 'dim small', style: { marginTop: '8px' } }, 'Click a stage to move the project.')]),
          h('div', { class: 'kv dw-kv' },
            h('span', null, 'Customer'), h('b', null, customer ? recLink('customer', customer.id, customer.name) : '—'),
            h('span', null, 'Booking date'), h('b', null, fmtDate(p.booking_date)),
            h('span', null, 'Event'), h('b', null, p.event_end_date && p.event_end_date !== p.event_date ? `${fmtDate(p.event_date)} – ${fmtDate(p.event_end_date)}` : fmtDate(p.event_date)),
            h('span', null, 'Delivery'), h('b', null, fmtDate(p.delivery_date)),
            h('span', null, 'Venue'), h('b', null, p.venue || '—')),
          crewSection(p, team),
          dwSection('Invoices', myI.length ? myI.map(i => li(h('b', { class: 'mono' }, i.number), `${fmtDate(i.invoice_date)} · ${money(i.total)}`, invStatus(i.status), () => openRecord('invoice', i.id))) : h('p', { class: 'dim small' }, 'No invoices for this project yet.')),
          myQ.length ? dwSection('Quotations', myQ.map(q => li(h('b', { class: 'mono' }, q.number), `${fmtDate(q.quote_date)} · ${money(q.total)}`, null, () => openRecord('quotation', q.id)))) : null,
          p.notes ? dwSection('Notes', h('div', { class: 'notes-box' }, p.notes)) : null,
        ],
      };
    },
  });
  d.recId = id;
  return d;
}
