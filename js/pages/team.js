// Team & Tasks (owner): members, crew assignments, payouts, statements.
import { h, mount, table, field, input, textarea, select, btn, iconBtn, searchBox, chips, ic, toggle, empty, pill, nextId } from '../dom.js';
import { openModal, toast, errMsg, confirmDialog, busy, openDrawer, closeDrawerPanel, popMenu } from '../ui.js';
import { all, insert, update, remove, getRow, teamData, saveMember, setTaskStatus, recordPayout, isSelf, logActivity } from '../store.js';
import { money, fmtDate, fmtDateShort, fmtDateTime, todayIST, addDays, includesCI, debounce, sum, initials } from '../util.js';
import { JOB_TITLES, TASK_STATUSES, TASK_STATUS_LABEL, PAYOUT_MODES, WORK_CHIPS, WORK_CHIPS_ALL } from '../config.js';
import { pageHead, dwSection, statRow, recLink, taskPill, taskDates } from './common.js';
import { attachCombo } from '../combo.js';
import { periodRange, memberStats, payCoverage, taskOn, taskInRange } from '../teamcalc.js';
import { sharePdf, statementText, preOpenShareWindow, openWhatsApp } from '../share.js';
import { setHashSilently } from '../router.js';
import { calendarButton } from './calendar.js';
import { taskCalEvent } from '../calcore.js';

const UI = {
  tab: 'members', mq: '', mf: 'active', tf: 'upcoming', tq: '', tm: '', group: false, pq: '', pm: '', pmode: '',
  sortM: { key: 'Member', dir: 1 }, sortT: { key: 'Date', dir: 1 }, sortP: { key: 'Date', dir: -1 },
};
const TABS = ['members', 'tasks', 'payouts'];

// ---------- small helpers ----------
export const mName = m => m?.display_name || m?.email || '—';
const byName = (a, b) => mName(a).localeCompare(mName(b));
const endOf = t => (t.end_date && t.end_date > t.work_date ? t.end_date : t.work_date);
const avatar = m => h('span', { class: 'mini-av' + (m?.role === 'owner' ? ' gold' : ''), 'aria-hidden': 'true' }, initials(mName(m), '?'));
const whoCell = (m, sub) => h('span', { class: 'who-cell nw' }, avatar(m), h('span', null, h('b', null, mName(m)), sub ? h('small', null, sub) : null));
const pi = (l, v, cls = '') => h('div', { class: 'pi' }, h('span', null, l), h('b', { class: cls }, String(v)));
const rolePill = m => (m.role === 'owner' ? pill('Owner', 's3') : pill('Employee', 's0'));
const activePill = m => (m.active === false ? pill('Inactive', 's0') : pill('Active', 's2'));
const li = (main, sub, right, onClick) => h('button', { type: 'button', class: 'li li-btn', onclick: onClick }, h('div', null, main, sub ? h('small', null, sub) : null), h('div', null, right));
const plainLi = (main, sub, right) => h('div', { class: 'li' }, h('div', null, main, sub ? h('small', null, sub) : null), h('div', null, right));
const dayLabel = (d, today) => (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : d === addDays(today, -1) ? 'Yesterday' : null);

// ======================================================================
// Member form
// ======================================================================
export function openMemberForm(existing = null) {
  const m0 = existing || { role: 'employee', active: true, job_title: 'Photographer' };
  const self = !!existing && isSelf(existing);
  const jobs = JOB_TITLES.slice(); if (m0.job_title && !jobs.includes(m0.job_title)) jobs.unshift(m0.job_title);
  const f = {
    name: input({ value: m0.display_name || '', autocomplete: 'off', placeholder: 'e.g. Photographer 1' }),
    email: input({ type: 'email', inputmode: 'email', value: m0.email || '', autocomplete: 'off', placeholder: 'name@gmail.com', disabled: self, spellcheck: 'false' }),
    job: select(jobs, m0.job_title || 'Photographer'),
    phone: input({ type: 'tel', inputmode: 'tel', value: m0.phone || '', placeholder: '+91 …' }),
    role: select([['employee', 'Employee — sees only their own work'], ['owner', 'Owner — full access']], m0.role || 'employee', { disabled: self }),
  };
  const act = toggle('Active — can sign in and be assigned work', m0.active !== false, { disabled: self });
  const emailWarn = h('small', { class: 'hint warn', 'aria-live': 'polite' });
  const roleWarn = h('div', { class: 'warn-box', role: 'alert' }, ic('alert', 15),
    h('span', null, h('b', null, 'Owners see everything'), ' — customers, invoices, payments, expenses and settings — and can add or remove team members. Choose Owner only for a partner you fully trust.'));
  const syncWarn = () => {
    const v = f.email.value.trim().toLowerCase();
    emailWarn.textContent = v && /@/.test(v) && !/@gmail\.com$/.test(v) ? 'Not a @gmail.com address — it must still be a Google account (Google Workspace works).' : '';
    roleWarn.hidden = f.role.value !== 'owner' || self;
  };
  f.email.addEventListener('input', syncWarn); f.role.addEventListener('change', syncWarn);
  const emailField = field('Gmail', f.email, { required: true, hint: self ? 'You cannot change your own Gmail, role or active status.' : 'They sign in with this Google account.' });
  emailField.appendChild(emailWarn); emailField.classList.add('full');
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  let m;
  const save = btn(existing ? 'Save changes' : 'Add member', async () => {
    errBox.textContent = '';
    const email = f.email.value.trim().toLowerCase();
    const name = f.name.value.trim();
    if (!name) { errBox.textContent = 'Name is required.'; f.name.focus(); return; }
    if (!self && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { errBox.textContent = 'Enter a valid Google account email (e.g. name@gmail.com).'; f.email.focus(); return; }
    const row = { display_name: name, email, job_title: f.job.value, phone: f.phone.value.trim() || null, role: f.role.value, active: act.input.checked };
    await busy(save, async () => {
      try {
        const saved = await saveMember(existing, row);
        toast(existing ? 'Member updated' : `${saved.display_name} added — they can now sign in with ${saved.email}`, 'success', 5000);
        m.markClean(); m.close(saved);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  syncWarn();
  m = openModal({
    title: existing ? 'Edit team member' : 'Add team member', guard: true,
    body: [errBox, h('form', { class: 'form-grid', novalidate: true, onsubmit: e => { e.preventDefault(); save.click(); } },
      field('Name', f.name, { required: true, cls: 'full' }),
      emailField,
      field('Job title', f.job), field('Phone', f.phone, { hint: 'Used for WhatsApp statements' }),
      field('Role', f.role, { cls: 'full' }), h('div', { class: 'full' }, roleWarn),
      h('div', { class: 'field full' }, act.el),
      h('button', { type: 'submit', hidden: true, tabindex: '-1' }))],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  return m.result;
}

async function offerDeactivate(m, message) {
  if (!(await confirmDialog(message, { title: 'Deactivate instead?', okText: 'Deactivate' }))) return false;
  return setActive(m, false);
}
async function setActive(m, on) {
  try { await saveMember(m, { active: on }); toast(`${mName(m)} ${on ? 'activated' : 'deactivated'}`, 'success'); return true; }
  catch (e) { toast(errMsg(e), 'error'); return false; }
}
export async function removeMember(m) {
  if (isSelf(m)) { toast('You cannot remove yourself.', 'warn'); return false; }
  const { tasks, payouts } = await teamData();
  const msg = `${mName(m)} has tasks or payouts, so they can't be deleted. Deactivate instead? They won't be able to sign in and their history is kept.`;
  if (tasks.some(t => t.member_id === m.id) || payouts.some(p => p.member_id === m.id)) return offerDeactivate(m, msg);
  if (!(await confirmDialog(`Remove ${mName(m)} from the team? They will no longer be able to sign in.`, { danger: true, okText: 'Remove' }))) return false;
  try { await remove('members', m.id); toast('Member removed', 'success'); return true; }
  catch (e) { if (e.code === '23503') return offerDeactivate(m, msg); toast(errMsg(e), 'error'); return false; }
}

// ======================================================================
// Assign / edit task
// ======================================================================
export async function openTaskForm(existing = null, preset = {}) {
  const [{ members, tasks }, projects, customers] = await Promise.all([teamData(), all('projects'), all('customers')]);
  const cMap = new Map(customers.map(c => [c.id, c]));
  const today = todayIST();
  const t0 = existing || { status: 'assigned', work_date: today, ...preset };
  let memberId = t0.member_id || '';
  let projectId = t0.project_id || '';
  const pool = members.filter(x => x.active !== false || x.id === memberId).sort(byName);
  if (!pool.length) { toast('Add a team member first.', 'info'); openMemberForm(); return null; }
  const mm = id => pool.find(x => x.id === id);
  const pp = id => projects.find(x => x.id === id);
  const f = {
    project_title: input({ value: t0.project_title || '', placeholder: 'e.g. Wedding – Haldi & Sangeet' }),
    title: input({ value: t0.title || '', placeholder: 'What they will do' }),
    details: textarea({ value: t0.details || '', rows: 2, placeholder: 'Timings, gear, contact person… (visible to the team member)' }),
    work_date: input({ type: 'date', value: t0.work_date || '' }),
    end_date: input({ type: 'date', value: t0.end_date || '' }),
    venue: input({ value: t0.venue || '' }),
    amount: input({ type: 'number', min: '0', step: '1', inputmode: 'decimal', class: 'inp num', value: t0.amount ?? '' }),
    status: select(TASK_STATUSES.map(s => [s, TASK_STATUS_LABEL[s]]), t0.status || 'assigned'),
  };
  let m;
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const memMeta = h('small', { class: 'hint', 'aria-live': 'polite' });

  // ----- team member combobox -----
  const memInp = input({ id: nextId('tm'), value: memberId ? mName(mm(memberId)) : '', placeholder: 'Search team member…' });
  const memHost = h('div', { class: 'cb-host' }, h('span', { class: 'cb-lead' }, ic('user', 15)), memInp);
  const conflictCheck = () => {
    const x = mm(memberId);
    if (!x) { memMeta.textContent = ''; memMeta.className = 'hint'; return; }
    const from = f.work_date.value, to = f.end_date.value && f.end_date.value > from ? f.end_date.value : from;
    const clash = from ? tasks.filter(t => t.member_id === x.id && t.id !== existing?.id && t.status !== 'cancelled' && taskInRange(t, from, to)) : [];
    memMeta.className = clash.length ? 'hint warn' : 'hint';
    memMeta.textContent = clash.length ? `Already booked that day: ${clash.map(t => t.title + (t.project_title ? ' · ' + t.project_title : '')).join('; ')}` : [x.job_title, x.phone].filter(Boolean).join(' · ');
  };
  const setMember = id => { memberId = id || ''; memInp.value = memberId ? mName(mm(memberId)) : ''; drawChips(); conflictCheck(); };
  attachCombo(memInp, {
    label: 'Team members',
    source: q => {
      const t = q.trim(); const showAll = !t || t === mName(mm(memberId));
      return pool.filter(x => showAll || includesCI(mName(x), t) || includesCI(x.job_title, t) || includesCI(x.email, t))
        .map(x => { const open = tasks.filter(k => k.member_id === x.id && (k.status === 'assigned' || k.status === 'in_progress')).length; return { key: x.id, label: mName(x), sub: [x.job_title, x.active === false ? 'inactive' : null].filter(Boolean).join(' · '), right: open ? `${open} open` : null, data: x }; });
    },
    onPick: o => { setMember(o.data.id); m.dirty = true; projInp.focus(); },
  });
  memInp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== memInp) memInp.value = memberId ? mName(mm(memberId)) : ''; }, 150));

  // ----- project combobox -----
  const projInp = input({ id: nextId('tp'), value: projectId ? pp(projectId)?.name || '' : '', placeholder: 'Search project (optional)…' });
  const projHost = h('div', { class: 'cb-host' }, h('span', { class: 'cb-lead' }, ic('camera', 15)), projInp);
  const projSorted = projects.slice().sort((a, b) => {
    const ua = (a.event_date || '') >= today, ub = (b.event_date || '') >= today;
    if (ua !== ub) return ua ? -1 : 1;
    return ua ? String(a.event_date).localeCompare(String(b.event_date)) : String(b.event_date || '').localeCompare(String(a.event_date || ''));
  });
  const setProject = (id, autofill) => {
    projectId = id || ''; const p = pp(projectId);
    projInp.value = p?.name || '';
    if (autofill && p) {
      f.project_title.value = `${p.name}${p.type ? ' · ' + p.type : ''}`;
      if (p.venue) f.venue.value = p.venue;
      if (p.event_date) { f.work_date.value = p.event_date; f.end_date.value = p.event_end_date && p.event_end_date !== p.event_date ? p.event_end_date : ''; }
      conflictCheck();
    }
  };
  attachCombo(projInp, {
    label: 'Projects',
    source: q => {
      const t = q.trim(); const showAll = !t || t === (pp(projectId)?.name || '');
      return projSorted.filter(p => showAll || includesCI(p.name, t) || includesCI(p.type, t) || includesCI(p.venue, t) || includesCI(cMap.get(p.customer_id)?.name, t)).slice(0, 10)
        .map(p => ({ key: p.id, label: p.name, sub: [cMap.get(p.customer_id)?.name, p.type, p.event_date ? fmtDate(p.event_date) : null].filter(Boolean).join(' · '), tag: (p.event_date || '') >= today ? 'Upcoming' : null, data: p }));
    },
    extra: () => (projectId ? [{ key: 'none', action: true, icon: 'x', label: 'No project' }] : []),
    onPick: o => { if (o.action) setProject(''); else setProject(o.data.id, true); m.dirty = true; f.title.focus(); },
  });
  projInp.addEventListener('blur', () => setTimeout(() => {
    if (document.activeElement === projInp) return;
    if (!projInp.value.trim()) projectId = ''; else projInp.value = pp(projectId)?.name || '';
  }, 150));

  // ----- quick work chips -----
  const chipHost = h('div', { class: 'chips', role: 'group', 'aria-label': 'Quick work titles' });
  function drawChips() {
    const job = mm(memberId)?.job_title;
    const list = [...new Set([...(WORK_CHIPS[job] || []), ...WORK_CHIPS_ALL])].slice(0, 7);
    mount(chipHost, list.map(x => h('button', { type: 'button', class: 'chip sm', 'aria-pressed': String(f.title.value === x), onclick: () => { f.title.value = x; m.dirty = true; drawChips(); f.amount.focus(); } }, x)));
  }
  f.title.addEventListener('input', drawChips);
  f.work_date.addEventListener('change', conflictCheck); f.end_date.addEventListener('change', conflictCheck);
  drawChips(); conflictCheck();
  if (!existing && preset.project_id && pp(preset.project_id)) setProject(preset.project_id, true);

  const addedLog = h('p', { class: 'added-log', 'aria-live': 'polite', hidden: true });
  const added = [];
  async function doSave(button, again) {
    errBox.textContent = '';
    if (!memberId) { errBox.textContent = 'Choose a team member.'; memInp.focus(); return; }
    if (!f.title.value.trim()) { errBox.textContent = 'Describe the work (e.g. Candid photography).'; f.title.focus(); return; }
    if (!f.work_date.value) { errBox.textContent = 'Work date is required.'; f.work_date.focus(); return; }
    if (f.end_date.value && f.end_date.value < f.work_date.value) { errBox.textContent = 'End date is before the work date.'; f.end_date.focus(); return; }
    const amt = Number(f.amount.value || 0);
    if (!(amt >= 0)) { errBox.textContent = 'Amount cannot be negative.'; f.amount.focus(); return; }
    const row = {
      member_id: memberId, project_id: projectId || null, project_title: f.project_title.value.trim() || null, title: f.title.value.trim(),
      details: f.details.value.trim() || null, work_date: f.work_date.value, end_date: f.end_date.value && f.end_date.value !== f.work_date.value ? f.end_date.value : null,
      venue: f.venue.value.trim() || null, amount: amt, status: f.status.value,
    };
    await busy(button, async () => {
      try {
        const saved = existing ? await update('tasks', existing.id, row) : await insert('tasks', row);
        const who = mName(mm(memberId));
        if (!existing) logActivity(`Work assigned to ${who}: ${row.title}`, '▣');
        if (again) {
          tasks.push(saved); added.push(`${who} · ${row.title}`);
          addedLog.hidden = false; addedLog.textContent = `Added ${added.length}: ${added.join(', ')}`;
          toast(`Assigned to ${who}`, 'success');
          setMember(''); f.title.value = ''; f.amount.value = ''; f.details.value = ''; f.status.value = 'assigned'; drawChips();
          m.markClean(); memInp.focus();
        } else {
          toast(existing ? 'Task updated' : `Work assigned to ${who}`, 'success');
          m.markClean(); m.close(saved);
        }
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }
  const saveBtn = btn(existing ? 'Save changes' : 'Assign work', e => doSave(e.currentTarget, false), { cls: 'gold', icon: 'check' });
  const againBtn = existing ? null : btn('Save & add another', e => doSave(e.currentTarget, true), { icon: 'plus' });
  m = openModal({
    title: existing ? 'Edit task' : 'Assign work', size: 'lg', guard: true,
    body: [errBox, addedLog, h('div', { class: 'form-grid' },
      h('div', { class: 'field' }, h('label', { for: memInp.id }, 'Team member', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), memHost, memMeta),
      h('div', { class: 'field' }, h('label', { for: projInp.id }, 'Project'), projHost, h('small', { class: 'hint' }, 'Picking a project fills the title, venue and date')),
      field('Project title (shown to the team member)', f.project_title, { cls: 'full', hint: 'The team member sees only this text — never the customer’s prices or invoices.' }),
      h('div', { class: 'field full' }, h('label', { for: f.title.id = nextId('tt') }, 'Work', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), f.title, chipHost),
      field('Work date', f.work_date, { required: true }), field('End date', f.end_date, { hint: 'Optional, for multi-day work' }),
      field('Venue', f.venue), field('Amount they earn (₹)', f.amount, { hint: 'Counted as earned when the work is done' }),
      field('Status', f.status), h('div'),
      field('Details', f.details, { cls: 'full' }))],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), againBtn, saveBtn],
  });
  if (!existing && !memberId) setTimeout(() => memInp.focus(), 40);
  // Member already chosen (deep link / drawer / "Assign work" from a member): start at the work title so the
  // member list does not pop open over the form.
  else setTimeout(() => (existing ? f.title : f.title.value ? f.amount : f.title).focus({ preventScroll: true }), 40);
  return m.result;
}

async function deleteTask(t) {
  if (!(await confirmDialog(`Delete the task “${t.title}” on ${fmtDate(t.work_date)}? Linked payouts stay but lose the task link.`, { danger: true, okText: 'Delete' }))) return false;
  try { await remove('tasks', t.id); toast('Task deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}
async function changeStatus(t, status, button) {
  if (status === 'cancelled' && !(await confirmDialog(`Cancel “${t.title}” for ${fmtDate(t.work_date)}? It will not count as earned.`, { okText: 'Cancel task', cancelText: 'Keep', danger: true }))) return;
  await busy(button, async () => {
    try { await setTaskStatus(t, status); toast(`${t.title}: ${TASK_STATUS_LABEL[status]}`, 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
  });
}

// ======================================================================
// Record payout
// ======================================================================
export async function openPayoutModal({ member_id = '', task_id = '' } = {}) {
  const { members, tasks, payouts } = await teamData();
  const cov = payCoverage(tasks, payouts);
  const list = members.filter(x => x.active !== false || x.id === member_id || memberStats(x.id, tasks, payouts).pending > 0).sort(byName);
  if (!list.length) { toast('Add a team member first.', 'info'); return null; }
  const memSel = select([['', '— Select team member —'], ...list.map(x => [x.id, `${mName(x)}${x.job_title ? ' · ' + x.job_title : ''}`])], member_id || '', { id: nextId('po') });
  const info = h('div', { class: 'pay-info', 'aria-live': 'polite' });
  const amount = input({ type: 'number', min: '0.01', step: '0.01', inputmode: 'decimal', class: 'inp num big-inp', id: nextId('pa') });
  const date = input({ type: 'date', value: todayIST() });
  let mode = 'UPI';
  const modeChips = chips(PAYOUT_MODES.map(x => [x, x]), mode, v => { mode = v; }, 'Payout mode');
  const taskSel = select([['', '— Not linked to a task —']], '');
  const notes = textarea({ rows: 2, placeholder: 'Optional (e.g. UTR number, advance for travel)' });
  const quick = h('div', { class: 'chips' });
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  let pendingNow = 0;
  const drawQuick = () => {
    const c = taskSel.value ? cov.get(taskSel.value) : null;
    const items = [];
    if (pendingNow > 0) items.push(['Pay full pending', pendingNow]);
    if (c && c.due > 0 && Math.abs(c.due - pendingNow) > 0.009) items.push(['This task', c.due]);
    mount(quick, items.map(([l, v]) => h('button', { type: 'button', class: 'chip sm', onclick: () => { amount.value = String(v); amount.focus(); } }, `${l} · ${money(v)}`)));
  };
  const upd = (keepTask) => {
    const x = list.find(y => y.id === memSel.value);
    if (!x) { mount(info, h('span', { class: 'muted' }, 'Choose a team member to see what is pending.')); mount(quick); mount(taskSel, h('option', { value: '' }, '— Choose a team member first —')); taskSel.disabled = true; pendingNow = 0; return; }
    const s = memberStats(x.id, tasks, payouts);
    pendingNow = Math.max(0, s.pending);
    mount(info, pi('Done work (all time)', money(s.earnedAll)), pi('Paid so far', money(s.paidAll), 'up'),
      pi(s.pending < 0 ? 'Advance paid' : 'Pending', money(Math.abs(s.pending)), s.pending > 0 ? 'warn' : ''), pi('Open tasks', s.openCount));
    const done = tasks.filter(t => t.member_id === x.id && t.status === 'done')
      .sort((a, b) => ((cov.get(b.id)?.due > 0) - (cov.get(a.id)?.due > 0)) || String(b.work_date).localeCompare(String(a.work_date)));
    mount(taskSel, h('option', { value: '' }, '— Not linked to a task —'), done.map(t => { const c = cov.get(t.id); return h('option', { value: t.id }, `${fmtDateShort(t.work_date)} · ${t.title} · ${money(t.amount)}${c && c.due > 0 ? ` (due ${money(c.due)})` : ' (paid)'}`); }));
    taskSel.disabled = !done.length;
    taskSel.value = keepTask && done.some(t => t.id === keepTask) ? keepTask : '';
    const c = taskSel.value ? cov.get(taskSel.value) : null;
    amount.value = c && c.due > 0 ? String(c.due) : pendingNow > 0 ? String(pendingNow) : '';
    drawQuick();
  };
  memSel.addEventListener('change', () => upd(''));
  taskSel.addEventListener('change', () => { const c = cov.get(taskSel.value); if (c && c.due > 0) amount.value = String(c.due); drawQuick(); });
  upd(task_id);
  let m;
  const save = btn('Save payout', async () => {
    errBox.textContent = '';
    if (!memSel.value) { errBox.textContent = 'Choose a team member.'; memSel.focus(); return; }
    const amt = Number(amount.value);
    if (!(amt > 0)) { errBox.textContent = 'Enter an amount greater than 0.'; amount.focus(); return; }
    if (amt > pendingNow + 0.009 && !(await confirmDialog(`${money(amt)} is more than the pending ${money(pendingNow)}. Record the extra ${money(amt - pendingNow)} as an advance?`, { title: 'More than pending', okText: 'Record as advance' }))) return;
    await busy(save, async () => {
      try {
        const p = await recordPayout({ member_id: memSel.value, task_id: taskSel.value || null, payout_date: date.value, amount: amt, mode, notes: notes.value.trim() });
        toast(`Payout ${money(amt)} to ${mName(list.find(y => y.id === memSel.value))} saved`, 'success');
        m.markClean(); m.close(p);
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'check' });
  m = openModal({
    title: 'Record payout', guard: true,
    body: [errBox, field('Team member', memSel, { required: true }), info,
      h('div', { class: 'form-grid' },
        h('div', { class: 'field' }, h('label', { for: amount.id }, 'Amount paid (₹)', h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')), amount, quick),
        field('Date', date, { hint: 'India time' })),
      h('div', { class: 'field' }, h('span', { class: 'flbl' }, 'Mode'), modeChips),
      field('For task', taskSel, { hint: 'Optional — payouts are applied to the oldest unpaid work first' }), field('Notes', notes)],
    footer: [btn('Cancel', () => m.request(), { cls: 'ghost' }), save],
  });
  if (member_id) setTimeout(() => { amount.focus(); amount.select(); }, 60);
  return m.result;
}
async function deletePayout(p, who) {
  if (!(await confirmDialog(`Delete the payout of ${money(p.amount)} to ${who} on ${fmtDate(p.payout_date)}? Their pending amount goes back up.`, { danger: true, okText: 'Delete payout' }))) return false;
  try { await remove('payouts', p.id); toast('Payout deleted', 'success'); return true; } catch (e) { toast(errMsg(e), 'error'); return false; }
}

// ======================================================================
// Statement (period picker → PDF / WhatsApp)
// ======================================================================
export async function openStatementModal(member) {
  const { tasks, payouts } = await teamData();
  let kind = 'month';
  const mon = periodRange('month');
  const fromI = input({ type: 'date', value: mon.from }); const toI = input({ type: 'date', value: mon.to });
  const customWrap = h('div', { class: 'form-grid', hidden: true }, field('From', fromI), field('To', toI));
  const summary = h('div', { class: 'pay-info', 'aria-live': 'polite' });
  const label = h('p', { class: 'muted small' });
  const period = () => (kind === 'custom' ? periodRange('custom', { from: fromI.value, to: toI.value }) : periodRange(kind));
  const draw = () => {
    const p = period(); const s = memberStats(member.id, tasks, payouts, p);
    label.textContent = p.label;
    mount(summary, pi('Tasks', s.periodTasks), pi('Earned', money(s.earned)), pi('Received', money(s.received), 'up'), pi(s.pending < 0 ? 'Advance (all time)' : 'Pending (all time)', money(Math.abs(s.pending)), s.pending > 0 ? 'warn' : ''));
  };
  fromI.addEventListener('change', draw); toI.addEventListener('change', draw);
  const pc = chips([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['last-month', 'Last month'], ['custom', 'Custom']], kind, v => { kind = v; customWrap.hidden = v !== 'custom'; draw(); }, 'Statement period');
  draw();
  const go = ch => e => {
    const p = period(); const s = memberStats(member.id, tasks, payouts, p);
    const w = ch === 'whatsapp' ? preOpenShareWindow(ch) : null;
    busy(e.currentTarget, () => sharePdf({
      make: async () => (await import('../pdf/docs.js')).statementPdf(member.id, p), channel: ch, win: w,
      phone: member.phone, email: member.email, subject: `Work statement — ${p.label}`, text: statementText(member, p, s, ch === 'whatsapp'),
    }));
  };
  let m;
  m = openModal({
    title: `Statement · ${mName(member)}`,
    body: [h('div', { class: 'field' }, h('span', { class: 'flbl' }, 'Period'), pc), customWrap, label, summary,
      h('p', { class: 'dim small' }, 'The PDF lists the work, payouts and pending amount. It shows only the project titles you typed — no customer prices.')],
    footer: [btn('Close', () => m.close(), { cls: 'ghost' }), btn('Gmail', go('gmail'), { icon: 'mail' }), btn('WhatsApp', go('whatsapp'), { cls: 'wa', icon: 'whatsapp' }), btn('Download PDF', go('download'), { cls: 'gold', icon: 'download' })],
  });
  return m.result;
}

// ======================================================================
// Page
// ======================================================================
export const routeMember = ({ params }) => openMemberDrawer(params.id);
export const routeTask = ({ params }) => openTaskDrawer(params.id);

export async function render({ query, refresh }) {
  if (!refresh) {
    UI.tab = TABS.includes(query.tab) ? query.tab : /^#\/team\/tasks\//.test(location.hash) ? 'tasks' : 'members';
    if (query.member) UI.tm = query.member;
    if (query.filter) UI.tf = query.filter;
  }
  const [{ members, tasks, payouts, mMap }, projects] = await Promise.all([teamData(), all('projects')]);
  const pMap = new Map(projects.map(p => [p.id, p]));
  const today = todayIST(); const mon = periodRange('month'); const wk = periodRange('week');
  const cov = payCoverage(tasks, payouts);
  const stats = new Map(members.map(x => [x.id, memberStats(x.id, tasks, payouts, mon)]));
  const pendingTotal = sum([...stats.values()], s => Math.max(0, s.pending));
  const openTasks = tasks.filter(t => t.status === 'assigned' || t.status === 'in_progress');
  const host = h('div');
  const tabs = chips([['members', 'Team members', members.filter(x => x.active !== false).length], ['tasks', 'Tasks', openTasks.length], ['payouts', 'Payouts', payouts.length]], UI.tab, v => {
    UI.tab = v; setHashSilently('/team' + (v === 'members' ? '' : '?tab=' + v)); draw();
  }, 'Team section');
  tabs.classList.add('tabs');

  // ---------- members ----------
  function drawMembers() {
    const sb = searchBox({ placeholder: 'Search name, Gmail, job, phone…', 'aria-label': 'Search team members', value: UI.mq, wrapCls: 'grow' });
    const fc = chips([['active', 'Active', members.filter(x => x.active !== false).length], ['inactive', 'Inactive', members.filter(x => x.active === false).length], ['', 'All', members.length]], UI.mf, v => { UI.mf = v; list(); }, 'Filter members');
    const tHost = h('div'); const foot = h('div', { class: 'list-foot' });
    const list = () => {
      UI.mq = sb.input.value; const t = UI.mq.trim();
      const rows = members.filter(x => (UI.mf === 'active' ? x.active !== false : UI.mf === 'inactive' ? x.active === false : true)
        && (!t || includesCI(mName(x), t) || includesCI(x.email, t) || includesCI(x.job_title, t) || includesCI(x.phone, t)));
      tHost.replaceChildren(table([
        { label: 'Member', sort: x => mName(x), cell: x => whoCell(x, x.job_title || '—') },
        { label: 'Gmail', sort: x => x.email, cell: x => h('span', { class: 'muted' }, x.email) },
        { label: 'Phone', cell: x => h('span', { class: 'nowrap muted' }, x.phone || '—') },
        { label: 'Role', sort: x => x.role, cell: rolePill },
        { label: 'Open', cls: 'r', sort: x => stats.get(x.id).openCount, sortDir: -1, cell: x => String(stats.get(x.id).openCount || '—') },
        { label: `Earned (${mon.label.split(' ')[0]})`, cls: 'r', sort: x => stats.get(x.id).earned, sortDir: -1, cell: x => h('span', { class: 'num' }, money(stats.get(x.id).earned)) },
        { label: `Paid (${mon.label.split(' ')[0]})`, cls: 'r', sort: x => stats.get(x.id).received, sortDir: -1, cell: x => h('span', { class: 'num up' }, money(stats.get(x.id).received)) },
        { label: 'Pending', cls: 'r', sort: x => stats.get(x.id).pending, sortDir: -1, cell: x => { const p = stats.get(x.id).pending; return h('span', { class: 'num ' + (p > 0 ? 'warn' : 'dim'), title: p < 0 ? 'Advance paid' : 'All time: done work − payouts' }, p < 0 ? `${money(-p)} adv.` : money(p)); } },
        { label: 'Status', sort: x => (x.active === false ? 1 : 0), cell: activePill },
      ], rows, {
        sort: UI.sortM,
        onRow: x => openMemberDrawer(x.id), rowLabel: x => 'Open ' + mName(x),
        rowCls: x => (x.active === false ? 'row-dim' : null),
        actions: x => [
          iconBtn('plus', `Assign work to ${mName(x)}`, () => openTaskForm(null, { member_id: x.id })),
          iconBtn('rupee', `Record payout to ${mName(x)}`, () => openPayoutModal({ member_id: x.id })),
          iconBtn('download', `Statement for ${mName(x)}`, () => openStatementModal(x)),
          iconBtn('pencil', `Edit ${mName(x)}`, () => openMemberForm(x)),
        ],
        emptyText: t || UI.mf !== 'active' ? 'No team members match these filters.' : 'No team members yet. Add your photographers, editors and assistants.',
        emptyAction: btn('Add member', () => openMemberForm(), { cls: 'gold', icon: 'plus' }),
      }));
      tHost.querySelector('table')?.classList.add('stack');
      foot.textContent = rows.length ? `${rows.length} member${rows.length === 1 ? '' : 's'} · pending ${money(sum(rows, x => Math.max(0, stats.get(x.id).pending)))}` : '';
    };
    sb.input.addEventListener('input', debounce(list, 120)); list();
    return [h('div', { class: 'toolbar' }, sb, fc), tHost, foot];
  }

  // ---------- tasks ----------
  function drawTasks() {
    const TF = {
      all: () => true,
      upcoming: t => (t.status === 'assigned' || t.status === 'in_progress') && endOf(t) >= today,
      today: t => t.status !== 'cancelled' && taskOn(t, today),
      week: t => t.status !== 'cancelled' && taskInRange(t, wk.from, wk.to),
      done: t => t.status === 'done',
      unpaid: t => t.status === 'done' && cov.get(t.id)?.state !== 'paid',
    };
    const sb = searchBox({ placeholder: 'Search work, project, venue, member…', 'aria-label': 'Search tasks', value: UI.tq, wrapCls: 'grow' });
    const memSel = select([['', 'All team'], ...members.slice().sort(byName).map(x => [x.id, mName(x)])], UI.tm, { 'aria-label': 'Filter by team member' });
    const grp = toggle('Group by date', UI.group);
    const base = () => tasks.filter(t => !UI.tm || t.member_id === UI.tm);
    const fc = h('div');
    const drawChipsRow = () => {
      const b = base();
      mount(fc, chips([['upcoming', 'Upcoming'], ['today', 'Today'], ['week', 'This week'], ['done', 'Done'], ['unpaid', 'Done · unpaid'], ['all', 'All']].map(([k, l]) => [k, l, b.filter(TF[k]).length]), UI.tf, v => {
        UI.tf = v; UI.sortT = { key: 'Date', dir: ['done', 'unpaid', 'all'].includes(v) ? -1 : 1 }; list();
      }, 'Filter tasks'));
    };
    const tHost = h('div'); const foot = h('div', { class: 'list-foot' });
    const cols = () => [
      { label: 'Date', sort: t => t.work_date || '', cell: t => h('span', { class: 'nowrap' }, dayLabel(t.work_date, today) || fmtDate(t.work_date), t.end_date && t.end_date !== t.work_date ? h('small', null, 'to ' + fmtDate(t.end_date)) : null) },
      { label: 'Team member', sort: t => mName(mMap.get(t.member_id)), cell: t => whoCell(mMap.get(t.member_id), mMap.get(t.member_id)?.job_title) },
      { label: 'Work', sort: t => t.title, cell: t => [h('b', null, t.title), t.project_title ? h('small', null, t.project_title) : null] },
      { label: 'Venue', cell: t => h('span', { class: 'muted' }, t.venue || '—') },
      { label: 'Amount', cls: 'r', sort: t => Number(t.amount) || 0, sortDir: -1, cell: t => h('span', { class: 'num' + (t.status === 'cancelled' ? ' dim strike' : '') }, money(t.amount)) },
      { label: 'Status', sort: t => TASK_STATUSES.indexOf(t.status), cell: t => taskPill(t, cov.get(t.id)) },
    ];
    const actions = t => [
      t.status === 'assigned' ? btn('Start', e => changeStatus(t, 'in_progress', e.currentTarget), { cls: 'sm ghost', aria: `Start ${t.title}` }) : null,
      t.status === 'assigned' || t.status === 'in_progress' ? btn('Done', e => changeStatus(t, 'done', e.currentTarget), { cls: 'sm ghost', icon: 'check', aria: `Mark ${t.title} done` }) : null,
      t.status === 'done' && cov.get(t.id)?.due > 0 ? iconBtn('rupee', `Record payout for ${t.title}`, () => openPayoutModal({ member_id: t.member_id, task_id: t.id })) : null,
      iconBtn('pencil', `Edit ${t.title}`, () => openTaskForm(t)),
    ];
    const list = () => {
      UI.tq = sb.input.value; const q = UI.tq.trim();
      const rows = base().filter(TF[UI.tf] || TF.all).filter(t => !q || includesCI(t.title, q) || includesCI(t.project_title, q) || includesCI(t.venue, q) || includesCI(mName(mMap.get(t.member_id)), q) || includesCI(pMap.get(t.project_id)?.name, q));
      const opts = {
        sort: UI.sortT, onRow: t => openTaskDrawer(t.id), rowLabel: t => `Open task ${t.title} for ${mName(mMap.get(t.member_id))}`,
        rowCls: t => (t.status === 'cancelled' ? 'row-dim' : null), actions,
        emptyText: q || UI.tm || UI.tf !== 'all' ? 'No tasks match these filters.' : 'No work assigned yet.',
        emptyAction: btn('Assign work', () => openTaskForm(null, UI.tm ? { member_id: UI.tm } : {}), { cls: 'gold', icon: 'plus' }),
      };
      if (UI.group && rows.length) {
        const groups = new Map();
        for (const t of rows.slice().sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)) * (UI.sortT.key === 'Date' ? UI.sortT.dir || 1 : 1))) {
          if (!groups.has(t.work_date)) groups.set(t.work_date, []); groups.get(t.work_date).push(t);
        }
        tHost.replaceChildren(...[...groups].map(([d, g]) => h('section', { class: 'grp' },
          h('div', { class: 'grp-h' }, h('b', null, [dayLabel(d, today), fmtDate(d)].filter(Boolean).join(' · ')), h('span', { class: 'dim small' }, `${g.length} task${g.length === 1 ? '' : 's'} · ${money(sum(g.filter(t => t.status !== 'cancelled'), t => t.amount))}`)),
          table(cols().filter(c => c.label !== 'Date'), g, { ...opts, sort: { key: 'Team member', dir: 1 } }))));
      } else tHost.replaceChildren(table(cols(), rows, opts));
      tHost.querySelectorAll('table').forEach(x => x.classList.add('stack'));
      const live = rows.filter(t => t.status !== 'cancelled');
      foot.textContent = rows.length ? `${rows.length} task${rows.length === 1 ? '' : 's'} · crew cost ${money(sum(live, t => t.amount))}` : '';
    };
    sb.input.addEventListener('input', debounce(list, 120));
    memSel.addEventListener('change', () => { UI.tm = memSel.value; drawChipsRow(); list(); });
    grp.input.addEventListener('change', () => { UI.group = grp.input.checked; list(); });
    drawChipsRow(); list();
    return [h('div', { class: 'toolbar' }, sb, memSel, h('span', { class: 'grow' }), grp.el), h('div', { class: 'toolbar' }, fc), tHost, foot];
  }

  // ---------- payouts ----------
  function drawPayouts() {
    const owed = members.filter(x => stats.get(x.id).pending > 0.009).sort((a, b) => stats.get(b.id).pending - stats.get(a.id).pending);
    const strip = owed.length ? h('div', { class: 'pend-grid', role: 'list', 'aria-label': 'Pending to team' }, owed.map(x => h('div', { class: 'pend', role: 'listitem' },
      whoCell(x, x.job_title), h('div', { class: 'pend-r' }, h('b', { class: 'warn num' }, money(stats.get(x.id).pending)),
        btn('Pay', () => openPayoutModal({ member_id: x.id }), { cls: 'sm gold', aria: `Record payout to ${mName(x)}` }))))) : h('p', { class: 'dim small pend-none' }, 'Nothing pending — everyone is paid for their done work.');
    const sb = searchBox({ placeholder: 'Search member, task, notes…', 'aria-label': 'Search payouts', value: UI.pq, wrapCls: 'grow' });
    const memSel = select([['', 'All team'], ...members.slice().sort(byName).map(x => [x.id, mName(x)])], UI.pm, { 'aria-label': 'Filter by team member' });
    const modeChips = chips([['', 'All modes', payouts.length], ...PAYOUT_MODES.map(x => [x, x, payouts.filter(p => p.mode === x).length])], UI.pmode, v => { UI.pmode = v; list(); }, 'Filter by mode');
    const tMap = new Map(tasks.map(t => [t.id, t]));
    const tHost = h('div'); const foot = h('div', { class: 'list-foot' });
    const list = () => {
      UI.pq = sb.input.value; const q = UI.pq.trim();
      const rows = payouts.filter(p => (!UI.pm || p.member_id === UI.pm) && (!UI.pmode || p.mode === UI.pmode)
        && (!q || includesCI(mName(mMap.get(p.member_id)), q) || includesCI(p.notes, q) || includesCI(tMap.get(p.task_id)?.title, q) || includesCI(tMap.get(p.task_id)?.project_title, q)));
      tHost.replaceChildren(table([
        { label: 'Date', sort: p => p.payout_date || '', sortDir: -1, cell: p => h('span', { class: 'nowrap' }, fmtDate(p.payout_date)) },
        { label: 'Team member', sort: p => mName(mMap.get(p.member_id)), cell: p => whoCell(mMap.get(p.member_id), mMap.get(p.member_id)?.job_title) },
        { label: 'For task', cell: p => { const t = tMap.get(p.task_id); return t ? [h('span', null, t.title), h('small', null, `${fmtDateShort(t.work_date)}${t.project_title ? ' · ' + t.project_title : ''}`)] : h('span', { class: 'dim' }, '—'); } },
        { label: 'Mode', sort: p => p.mode, cell: p => h('span', { class: 'tag' }, p.mode || '—') },
        { label: 'Notes', cell: p => h('span', { class: 'muted' }, p.notes || '') },
        { label: 'Amount', cls: 'r', sort: p => Number(p.amount), sortDir: -1, cell: p => h('b', { class: 'num' }, money(p.amount)) },
      ], rows, {
        sort: UI.sortP,
        onRow: p => openMemberDrawer(p.member_id), rowLabel: p => `Payout ${money(p.amount)} to ${mName(mMap.get(p.member_id))}`,
        actions: p => [iconBtn('trash', `Delete payout ${money(p.amount)}`, () => deletePayout(p, mName(mMap.get(p.member_id))), 'danger')],
        emptyText: q || UI.pm || UI.pmode ? 'No payouts match these filters.' : 'No payouts yet. Record what you pay your team.',
        emptyAction: btn('Record payout', () => openPayoutModal(), { cls: 'gold', icon: 'plus' }),
      }));
      tHost.querySelector('table')?.classList.add('stack');
      foot.textContent = rows.length ? `${rows.length} payout${rows.length === 1 ? '' : 's'} · ${money(sum(rows, p => p.amount))}` : '';
    };
    sb.input.addEventListener('input', debounce(list, 120));
    memSel.addEventListener('change', () => { UI.pm = memSel.value; list(); });
    list();
    return [h('div', { class: 'pend-wrap' }, h('div', { class: 'pend-h' }, h('h3', null, 'Pending to team'), h('b', { class: 'warn num' }, money(pendingTotal))), strip),
      h('div', { class: 'toolbar' }, sb, memSel, modeChips), tHost, foot];
  }

  const draw = () => mount(host, UI.tab === 'tasks' ? drawTasks() : UI.tab === 'payouts' ? drawPayouts() : drawMembers());
  draw();

  // Deep links: ?assign=1&project=&member= · ?payout=1&member=&task= · ?add=1
  if (!refresh) setTimeout(() => {
    if (query.assign) openTaskForm(null, { ...(query.project ? { project_id: query.project } : {}), ...(query.member ? { member_id: query.member } : {}) });
    else if (query.payout) openPayoutModal({ member_id: query.member || '', task_id: query.task || '' });
    else if (query.add) openMemberForm();
  }, 0);

  const monthPaid = sum(payouts.filter(p => p.payout_date >= mon.from && p.payout_date <= mon.to), p => p.amount);
  return h('div', null,
    pageHead('Team & Tasks', [`${members.filter(x => x.active !== false && x.role === 'employee').length} team members · ${openTasks.length} open tasks · `, h('b', null, money(pendingTotal)), ` pending · ${money(monthPaid)} paid this month`], [
      btn('Add member', () => openMemberForm(), { icon: 'plus' }),
      btn('Record payout', () => openPayoutModal(), { icon: 'rupee' }),
      btn('Assign work', () => openTaskForm(), { cls: 'gold', icon: 'plus' })]),
    h('div', { class: 'card list-card' }, h('div', { class: 'toolbar tabs-bar' }, tabs), host));
}

// ======================================================================
// Drawers
// ======================================================================
export function openMemberDrawer(id) {
  const d = openDrawer({
    hash: '/team/members/' + id, label: 'Team member',
    render: async () => {
      const { tasks, payouts } = await teamData();
      const x = await getRow('members', id);
      if (!x) { toast('Team member not found.', 'warn'); return null; }
      const today = todayIST(); const mon = periodRange('month');
      const sM = memberStats(x.id, tasks, payouts, mon);
      const cov = payCoverage(tasks, payouts);
      const mine = tasks.filter(t => t.member_id === x.id);
      const upcoming = mine.filter(t => (t.status === 'assigned' || t.status === 'in_progress') && endOf(t) >= today).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
      const past = mine.filter(t => !upcoming.includes(t)).sort((a, b) => String(b.work_date).localeCompare(String(a.work_date)));
      const myPay = payouts.filter(p => p.member_id === x.id).sort((a, b) => String(b.payout_date).localeCompare(String(a.payout_date)));
      const tMap = new Map(mine.map(t => [t.id, t]));
      const self = isSelf(x);
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        { text: 'Edit member', icon: 'pencil', onClick: () => openMemberForm(x) },
        x.phone ? { text: 'WhatsApp message', icon: 'whatsapp', onClick: () => openWhatsApp(x.phone, `Hello ${mName(x)},`) } : null,
        self ? null : '-',
        self ? null : x.active === false ? { text: 'Activate', icon: 'check', onClick: () => setActive(x, true) } : { text: 'Deactivate', icon: 'x', onClick: () => setActive(x, false) },
        self ? null : { text: 'Remove member', icon: 'trash', cls: 'danger', onClick: async () => { if (await removeMember(x)) closeDrawerPanel(); } },
      ]));
      const taskLi = t => li(h('b', null, t.title), `${taskDates(t)}${t.project_title ? ' · ' + t.project_title : ''}`,
        [h('span', { class: 'amt' + (t.status === 'cancelled' ? ' dim strike' : '') }, money(t.amount)), taskPill(t, cov.get(t.id))], () => openTaskDrawer(t.id));
      return {
        title: mName(x), badge: [rolePill(x), ' ', activePill(x)],
        sub: [x.job_title, x.email].filter(Boolean).join(' · '),
        actions: h('div', { class: 'btns' },
          btn('Assign work', () => openTaskForm(null, { member_id: x.id }), { cls: 'gold sm', icon: 'plus' }),
          btn('Payout', () => openPayoutModal({ member_id: x.id }), { cls: 'sm', icon: 'rupee' }),
          btn('Statement', () => openStatementModal(x), { cls: 'sm', icon: 'download' }),
          btn('WhatsApp', () => openStatementModal(x), { cls: 'sm wa', icon: 'whatsapp', aria: 'Send statement summary on WhatsApp' }),
          h('span', { class: 'grow' }), more),
        body: [
          dwSection(`This month · ${mon.label}`, statRow([['Tasks', String(sM.periodTasks)], ['Earned', money(sM.earned)], ['Paid', money(sM.received), 'up']])),
          dwSection('All time', statRow([['Earned', money(sM.earnedAll)], ['Paid', money(sM.paidAll), 'up'], [sM.pending < 0 ? 'Advance' : 'Pending', money(Math.abs(sM.pending)), sM.pending > 0 ? 'warn' : '']])),
          dwSection('Upcoming work', upcoming.length ? upcoming.map(taskLi) : h('p', { class: 'dim small' }, 'Nothing assigned ahead.'), h('span', { class: 'dim small' }, String(upcoming.length))),
          dwSection('Past work', past.length ? [past.slice(0, 10).map(taskLi), past.length > 10 ? h('a', { class: 'btn sm ghost', href: '#/team?tab=tasks&filter=all&member=' + encodeURIComponent(x.id) }, `All ${past.length} tasks`) : null] : h('p', { class: 'dim small' }, 'No past work yet.')),
          dwSection('Payouts', myPay.length ? myPay.slice(0, 10).map(p => { const t = tMap.get(p.task_id); return plainLi(h('b', null, money(p.amount)), [fmtDate(p.payout_date), p.mode, t ? t.title : null, p.notes].filter(Boolean).join(' · '), h('span', { class: 'tag' }, p.mode || '—')); })
            : h('p', { class: 'dim small' }, 'No payouts yet.')),
          dwSection('Profile', h('div', { class: 'kv' },
            h('span', null, 'Gmail'), h('b', null, x.email || '—'),
            h('span', null, 'Phone'), h('b', null, x.phone || '—'),
            h('span', null, 'Job title'), h('b', null, x.job_title || '—'),
            h('span', null, 'Role'), h('b', null, x.role === 'owner' ? 'Owner (full access)' : 'Employee (own work only)'),
            h('span', null, 'Status'), h('b', null, x.active === false ? 'Inactive — cannot sign in' : 'Active'),
            x.created_at ? [h('span', null, 'Added'), h('b', null, fmtDate(x.created_at))] : null)),
        ],
      };
    },
  });
  d.recId = id;
  return d;
}

export function openTaskDrawer(id) {
  const d = openDrawer({
    hash: '/team/tasks/' + id, label: 'Task', size: 'narrow',
    render: async () => {
      const { tasks, payouts, mMap } = await teamData();
      const t = tasks.find(x => x.id === id);
      if (!t) { toast('Task not found.', 'warn'); return null; }
      const x = mMap.get(t.member_id);
      const project = t.project_id ? await getRow('projects', t.project_id) : null;
      const c = payCoverage(tasks, payouts).get(t.id);
      const linked = payouts.filter(p => p.task_id === t.id);
      const more = h('button', { type: 'button', class: 'ibtn', 'aria-label': 'More actions', title: 'More', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, ic('more', 18));
      more.addEventListener('click', () => popMenu(more, [
        t.status !== 'assigned' ? { text: 'Back to Assigned', icon: 'repeat', onClick: () => changeStatus(t, 'assigned') } : null,
        t.status !== 'cancelled' && t.status !== 'done' ? { text: 'Cancel task', icon: 'x', onClick: () => changeStatus(t, 'cancelled') } : null,
        { text: 'Duplicate for another member', icon: 'copy', onClick: () => openTaskForm(null, { project_id: t.project_id, project_title: t.project_title, title: t.title, details: t.details, work_date: t.work_date, end_date: t.end_date, venue: t.venue, amount: t.amount }) },
        '-',
        { text: 'Delete task', icon: 'trash', cls: 'danger', onClick: async () => { if (await deleteTask(t)) closeDrawerPanel(); } },
      ]));
      return {
        title: t.title, badge: taskPill(t, c),
        sub: `${mName(x)} · ${taskDates(t)}`,
        actions: h('div', { class: 'btns' },
          t.status === 'assigned' ? btn('Start', e => changeStatus(t, 'in_progress', e.currentTarget), { cls: 'sm' }) : null,
          t.status === 'assigned' || t.status === 'in_progress' ? btn('Mark done', e => changeStatus(t, 'done', e.currentTarget), { cls: 'sm gold', icon: 'check' }) : null,
          t.status === 'done' && c?.due > 0 ? btn('Record payout', () => openPayoutModal({ member_id: t.member_id, task_id: t.id }), { cls: 'sm gold', icon: 'rupee' }) : null,
          btn('Edit', () => openTaskForm(t), { cls: 'sm', icon: 'pencil' }),
          t.status !== 'cancelled' ? calendarButton(() => [taskCalEvent(t, mName(x))]) : null,
          h('span', { class: 'grow' }), more),
        body: [
          statRow(t.status === 'done' && c ? [['Amount', money(t.amount)], ['Paid', money(c.paid), 'up'], ['Due', money(c.due), c.due > 0 ? 'warn' : '']]
            : [['Amount', money(t.amount)], ['Status', TASK_STATUS_LABEL[t.status] || '—'], ['Date', fmtDateShort(t.work_date)]]),
          h('div', { class: 'kv dw-kv' },
            h('span', null, 'Team member'), h('b', null, x ? recLink('member', x.id, mName(x)) : '—'),
            h('span', null, 'Project'), h('b', null, project ? recLink('project', project.id, project.name) : '—'),
            h('span', null, 'Title the team sees'), h('b', null, t.project_title || '—'),
            h('span', null, 'Date'), h('b', null, taskDates(t)),
            h('span', null, 'Venue'), h('b', null, t.venue || '—'),
            t.done_at ? [h('span', null, 'Marked done'), h('b', null, fmtDateTime(t.done_at))] : null),
          t.details ? dwSection('Details', h('div', { class: 'notes-box' }, t.details)) : null,
          dwSection('Payouts for this task', linked.length ? linked.map(p => plainLi(h('b', null, money(p.amount)), [fmtDate(p.payout_date), p.notes].filter(Boolean).join(' · '), h('span', { class: 'tag' }, p.mode || '—')))
            : h('p', { class: 'dim small' }, t.status === 'done' ? (c?.paid > 0 ? 'Covered by general payouts (applied to the oldest work first).' : 'Not paid yet.') : 'Earned once the work is marked done.')),
        ],
      };
    },
  });
  d.recId = id;
  return d;
}

/** Crew section for the project drawer (owner only). */
export function crewSection(project, { tasks, payouts, mMap }) {
  const mine = tasks.filter(t => t.project_id === project.id).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
  const live = mine.filter(t => t.status !== 'cancelled');
  const cost = sum(live, t => t.amount);
  const margin = (Number(project.value) || 0) - cost;
  const cov = payCoverage(tasks, payouts);
  return dwSection('Crew', [
    statRow([['Crew cost', money(cost)], ['Margin', money(margin), margin < 0 ? 'dn' : 'up'], ['Crew', String(new Set(live.map(t => t.member_id)).size)]]),
    mine.length ? mine.map(t => li(h('span', { class: 'who-cell' }, avatar(mMap.get(t.member_id)), h('span', null, h('b', null, mName(mMap.get(t.member_id))), h('small', null, `${t.title} · ${taskDates(t)}`))),
      null, [h('span', { class: 'amt' + (t.status === 'cancelled' ? ' dim strike' : '') }, money(t.amount)), taskPill(t, cov.get(t.id))], () => openTaskDrawer(t.id)))
      : h('p', { class: 'dim small' }, 'No crew assigned yet.'),
    h('p', { class: 'dim small' }, 'Margin = package value − crew cost (cancelled work excluded). Other expenses are not included.'),
  ], btn('Assign work', () => openTaskForm(null, { project_id: project.id }), { cls: 'sm', icon: 'plus' }));
}
