import { h, card, table, empty, pill, ic, btn } from '../dom.js';
const ACT = { '▤': 'invoice', '₹': 'rupee', '✎': 'quote', '▣': 'camera', '☺': 'user' };
import { all, lookups, state, teamData } from '../store.js';
import { todayIST, addDays, monthKey, lastMonths, monthShort, monthLabel, money, moneyShort, fmtDateShort, fmtDate, daysBetween, sum, hourIST, fmtDateTime, initials } from '../util.js';
import { STAGE_LABEL } from '../config.js';
import { invStatus, isActiveProject, stageProgress, linkBtn, openRecord, recLink, taskPill, partyLine } from './common.js';
import { payCoverage, teamPending, memberStats, periodRange, taskOn } from '../teamcalc.js';
import { openWhatsApp, reminderText } from '../share.js';
import { navigate } from '../router.js';
import { needsFollowUp, leadAge, greetingText } from './leads.js';
import { upcomingOccasions, wishText } from '../calcore.js';

function pct(cur, prev) {
  if (!prev) return cur ? h('span', { class: 'up' }, 'new') : h('span', { class: 'dim' }, '—');
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return h('span', { class: p >= 0 ? 'up' : 'dn' }, (p >= 0 ? '+' : '') + p + '%');
}
function kpi(label, value, icon, detail, href) {
  return h('a', { class: 'card kpi', href }, h('div', { class: 'ico', 'aria-hidden': 'true' }, ic(icon, 19)), h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), h('div', { class: 'd' }, detail));
}

function teamBlock(team, today) {
  const { members, tasks, payouts, mMap } = team;
  const cov = payCoverage(tasks, payouts);
  const pending = teamPending(members, tasks, payouts);
  const owed = members.filter(m => memberStats(m.id, tasks, payouts).pending > 0.009).length;
  const mon = periodRange('month');
  const paidMonth = sum(payouts.filter(p => p.payout_date >= mon.from && p.payout_date <= mon.to), p => p.amount);
  const horizon = addDays(today, 7);
  const live = tasks.filter(t => t.status !== 'cancelled');
  const todayList = live.filter(t => taskOn(t, today));
  const soon = live.filter(t => !taskOn(t, today) && t.work_date > today && t.work_date <= horizon && t.status !== 'done');
  const rows = [...todayList.sort((a, b) => String(a.work_date).localeCompare(String(b.work_date))), ...soon.sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)))];
  const name = id => mMap.get(id)?.display_name || mMap.get(id)?.email || '—';
  const when = t => (taskOn(t, today) ? 'Today' : t.work_date === addDays(today, 1) ? 'Tomorrow' : fmtDateShort(t.work_date));
  const crew = rows.length ? table([
    { label: 'When', cell: t => h('span', { class: 'nowrap' + (taskOn(t, today) ? ' warn' : '') }, when(t)) },
    { label: 'Team member', cell: t => h('span', { class: 'who-cell' }, h('span', { class: 'mini-av', 'aria-hidden': 'true' }, initials(name(t.member_id), '?')), h('span', null, h('b', null, name(t.member_id)), h('small', null, mMap.get(t.member_id)?.job_title || ''))) },
    { label: 'Work', cell: t => [h('b', null, t.title), t.project_title ? h('small', null, t.project_title) : null] },
    { label: 'Venue', cell: t => h('span', { class: 'muted' }, t.venue || '—') },
    { label: 'Status', cell: t => taskPill(t, cov.get(t.id)) },
  ], rows.slice(0, 7), { onRow: t => openRecord('task', t.id), rowLabel: t => `Open task ${t.title} for ${name(t.member_id)}` })
    : empty('No crew assigned today or in the next 7 days.', linkBtn('Assign work', '#/team?tab=tasks&assign=1', 'sm gold', 'plus'));
  crew.querySelector?.('table')?.classList.add('stack');
  return h('div', { class: 'team-row' },
    h('div', { class: 'team-kpis' },
      kpi('Pending to team', moneyShort(pending), 'team', [h('span', { class: owed ? 'warn' : 'dim' }, `${owed} member${owed === 1 ? '' : 's'}`), ` to pay · ${moneyShort(paidMonth)} paid in ${monthShort(mon.from.slice(0, 7))}`], '#/team?tab=payouts'),
      kpi('Crew today', String(todayList.length), 'camera', [h('span', { class: soon.length ? 'up' : 'dim' }, String(soon.length)), ' more in the next 7 days'], '#/team?tab=tasks&filter=today')),
    card('Crew schedule', crew, h('div', { class: 'btns' }, h('span', { class: 'dim small' }, 'Today & next 7 days'), linkBtn('All tasks', '#/team?tab=tasks', 'sm'))));
}

function leadsBlock(leads, today) {
  const open = leads.filter(l => !['won', 'lost'].includes(l.status));
  const fresh = leads.filter(l => l.status === 'new');
  const follow = leads.filter(l => needsFollowUp(l, today));
  const mk = monthKey(today);
  const won = leads.filter(l => l.status === 'won' && monthKey(l.updated_at || l.created_at) === mk).length;
  const rows = [...follow.sort((a, b) => String(a.updated_at || a.created_at).localeCompare(String(b.updated_at || b.created_at))),
    ...fresh.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))].slice(0, 5);
  const list = rows.length ? rows.map(l => {
    const fu = needsFollowUp(l, today); const age = leadAge(l, today);
    return h('div', { class: 'li' },
      h('div', null, recLink('lead', l.id, l.name), h('small', { class: fu ? 'warn' : '' }, [fu ? `Quote sent · follow up` : `New · ${age === 0 ? 'today' : age + 'd ago'}`, l.event_type, l.event_date ? fmtDateShort(l.event_date) : null].filter(Boolean).join(' · '))),
      h('div', null, l.budget ? h('span', { class: 'amt' }, moneyShort(l.budget)) : null,
        l.mobile ? h('button', { type: 'button', class: 'wa btn sm', 'aria-label': `WhatsApp ${l.name}`, onclick: () => openWhatsApp(l.mobile, greetingText(l)) }, 'WhatsApp') : null));
  }) : empty(open.length ? 'No new leads or follow-ups right now.' : 'No open leads. Add enquiries as they come in.', linkBtn('New lead', '#/leads?new=1', 'sm gold', 'plus'));
  return card('Leads', [
    h('div', { class: 'mini-kpis' },
      h('a', { class: 'mk', href: '#/leads' }, h('span', null, 'New leads'), h('b', { class: fresh.length ? 'up' : '' }, String(fresh.length))),
      h('a', { class: 'mk', href: '#/leads' }, h('span', null, 'Follow-ups'), h('b', { class: follow.length ? 'warn' : '' }, String(follow.length))),
      h('a', { class: 'mk', href: '#/leads' }, h('span', null, 'Open pipeline'), h('b', null, moneyShort(sum(open, l => l.budget))))),
    h('div', null, list)], h('div', { class: 'btns' }, h('span', { class: 'dim small' }, `${won} won this month`), linkBtn('All leads', '#/leads', 'sm')));
}

function occasionsBlock(customers, today) {
  const occ = upcomingOccasions(customers, { today, days: 14 });
  const when = o => (o.in === 0 ? 'Today' : o.in === 1 ? 'Tomorrow' : `In ${o.in} days`);
  const list = occ.length ? occ.slice(0, 6).map(o => h('div', { class: 'li' },
    h('div', { class: 'occ-li' }, h('span', { class: 'occ-ic', 'aria-hidden': 'true' }, ic(o.kind === 'birthday' ? 'gift' : 'heart', 14)),
      h('div', null, recLink('customer', o.customer.id, o.customer.name),
        h('small', { class: o.in <= 1 ? 'warn' : '' }, `${o.kind === 'birthday' ? 'Birthday' : 'Anniversary'}${o.years ? ` (${o.kind === 'birthday' ? o.years : o.years + ' yrs'})` : ''} · ${when(o)} · ${fmtDateShort(o.date)}`))),
    h('div', null, h('button', { type: 'button', class: 'wa btn sm', 'aria-label': `Send ${o.kind} wishes to ${o.customer.name} on WhatsApp`, onclick: () => openWhatsApp(o.customer.whatsapp || o.customer.mobile, wishText(o, state.company?.name)) }, 'Wish'))))
    : empty('No birthdays or anniversaries in the next 14 days.', null, { icon: 'gift' });
  return card('Upcoming occasions', list, h('div', { class: 'btns' }, h('span', { class: 'dim small' }, 'Next 14 days'), occ.length > 6 ? linkBtn(`All ${occ.length}`, '#/calendar?view=agenda', 'sm') : linkBtn('Calendar', '#/calendar', 'sm')));
}

export async function render() {
  const albumOn = !!state.settings.album_module;
  const [L, payments, expenses, activities, team, leads, albums, albumMod] = await Promise.all([lookups(), all('payments'), all('expenses'), all('activities'), teamData(), all('leads').catch(() => []),
    albumOn ? all('album_orders').catch(() => []) : [], albumOn ? import('./albums.js') : null]);
  const { projects, invoices, cname, cMap } = L;
  const today = todayIST(); const mk = monthKey(today); const prevMk = monthKey(addDays(mk + '-01', -1));

  const active = projects.filter(isActiveProject);
  const newThis = projects.filter(p => monthKey(p.created_at?.slice(0, 10) || p.booking_date) === mk).length;
  const revBy = m => sum(payments.filter(p => monthKey(p.payment_date) === m), p => p.amount);
  const expBy = m => sum(expenses.filter(e => monthKey(e.expense_date) === m), e => e.amount);
  const rev = revBy(mk), revPrev = revBy(prevMk);
  const profit = rev - expBy(mk), profitPrev = revPrev - expBy(prevMk);
  const open = invoices.filter(i => Number(i.balance) > 0.009);
  const pending = sum(open, i => i.balance);
  const overdue = open.filter(i => i.due_date && i.due_date < today);

  // Upcoming shoots & deliveries (next 14 days)
  const end = addDays(today, 14);
  const up = [];
  for (const p of projects) {
    if (!isActiveProject(p) && p.stage === 'delivered') continue;
    if (p.event_date && p.event_date >= today && p.event_date <= end) up.push({ p, date: p.event_date, kind: 'Shoot' });
    if (p.delivery_date && p.delivery_date >= today && p.delivery_date <= end && p.stage !== 'delivered') up.push({ p, date: p.delivery_date, kind: 'Delivery' });
  }
  up.sort((a, b) => (a.date < b.date ? -1 : 1));
  const shootsToday = up.filter(u => u.kind === 'Shoot' && u.date === today).length;
  const delWeek = up.filter(u => u.kind === 'Delivery' && u.date <= addDays(today, 7)).length;

  const hr = hourIST(); const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const name = state.member.display_name || state.session.user.name?.split(' ')[0] || 'there';

  // Revenue chart
  const months = lastMonths(today, 6); const vals = months.map(revBy); const max = Math.max(...vals, 1);
  const chart = h('div', null,
    h('div', { class: 'big' }, moneyShort(rev), ' ', h('span', { style: { fontSize: '12px' } }, pct(rev, revPrev), h('span', { class: 'dim' }, ` vs ${monthShort(prevMk)}`))),
    h('div', { class: 'bars', role: 'img', 'aria-label': 'Revenue for the last 6 months: ' + months.map((m, i) => `${monthLabel(m)} ${money(vals[i])}`).join(', ') },
      months.map((m, i) => h('div', { class: 'bar' + (m === mk ? ' hi' : '') }, h('i', { style: { height: Math.max(3, Math.round(vals[i] / max * 88)) + '%' } }), h('span', null, vals[i] ? moneyShort(vals[i]).replace(/^₹/, '') : '0')))),
    h('div', { class: 'mon', 'aria-hidden': 'true' }, months.map(m => h('div', null, monthShort(m)))));

  const dotColor = { Shoot: '#d4ad55', Delivery: '#b98cff' };
  const upTable = up.length ? table([
    { label: 'Project', cell: u => [h('span', { class: 'dot', style: { background: dotColor[u.kind] }, 'aria-hidden': 'true' }), u.p.name] },
    { label: 'Customer', cell: u => cname(u.p.customer_id) },
    { label: 'Date', cell: u => h('span', { class: 'nowrap' }, u.date === today ? 'Today' : fmtDateShort(u.date)) },
    { label: 'What', cell: u => u.kind },
    { label: 'Stage', cell: u => pill(STAGE_LABEL[u.p.stage] || 'Booking', { booking: 's3', shoot: 's1', editing: 's1', album: 's2', delivered: 's2' }[u.p.stage] || 's0') },
  ], up.slice(0, 7), { onRow: u => openRecord('project', u.p.id), rowLabel: u => 'Open project ' + u.p.name }) : empty('No shoots or deliveries in the next 14 days.');

  // Projects with stage progress
  const paidByProject = new Map();
  for (const i of invoices) if (i.project_id) paidByProject.set(i.project_id, (paidByProject.get(i.project_id) || 0) + Number(i.paid_amount || 0));
  const recentProjects = active.slice().sort((a, b) => String(a.event_date || '9').localeCompare(String(b.event_date || '9'))).slice(0, 6);
  const projTable = table([
    { label: 'Project', cell: p => [p.name, h('small', null, cname(p.customer_id))] },
    { label: 'Type', cell: p => p.type || '—' },
    { label: 'Workflow', cell: p => stageProgress(p.stage) },
    { label: 'Value', cls: 'r', cell: p => money(p.value) },
    { label: 'Received', cls: 'r', cell: p => money(paidByProject.get(p.id) || 0) },
    { label: 'Event', cell: p => fmtDate(p.event_date) },
  ], recentProjects, { onRow: p => openRecord('project', p.id), rowLabel: p => 'Open project ' + p.name, emptyText: 'No active projects.' });

  // Payment reminders
  const rem = open.slice().sort((a, b) => String(a.due_date || '9').localeCompare(String(b.due_date || '9'))).slice(0, 6);
  const remList = rem.length ? rem.map(i => {
    const c = cMap.get(i.customer_id);
    const dd = i.due_date ? daysBetween(i.due_date, today) : null;
    const when = dd == null ? 'no due date' : dd > 0 ? `${dd} day${dd > 1 ? 's' : ''} overdue` : dd === 0 ? 'due today' : `due in ${-dd} day${dd < -1 ? 's' : ''}`;
    return h('div', { class: 'li' },
      h('div', null, recLink('invoice', i.id, c?.name || '—'), partyLine(i), h('small', { class: dd > 0 ? 'dn' : '' }, `${i.number} · ${when}`)),
      h('div', null, h('span', { class: 'amt' }, money(i.balance)),
        h('button', { type: 'button', class: 'wa btn sm', 'aria-label': `Send WhatsApp reminder to ${c?.name || 'customer'} for ${i.number}`, onclick: () => openWhatsApp(c?.whatsapp || c?.mobile, reminderText(i, c)) }, 'WhatsApp')));
  }) : empty('No pending payments.');

  const acts = activities.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 7);
  const actList = acts.length ? acts.map(a => h('div', { class: 'li' }, h('div', null, a.text, h('small', null, fmtDateTime(a.created_at))), h('div', { 'aria-hidden': 'true', class: 'act-ic' }, ic(ACT[a.icon] || 'clock', 14)))) : empty('No activity yet.');

  // Recent invoices
  const recentInv = invoices.slice().sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date))).slice(0, 5);
  const invList = recentInv.length ? recentInv.map(i => h('div', { class: 'li' },
    h('div', null, recLink('invoice', i.id, i.number), partyLine(i), h('small', null, `${cname(i.customer_id)} · ${fmtDateShort(i.invoice_date)}`)),
    h('div', null, h('span', { class: 'amt' }, money(i.total)), invStatus(i.status)))) : empty('No invoices yet.');

  return h('div', null,
    h('div', { class: 'row' },
      h('div', null, h('h1', null, `${greet}, ${name}`),
        h('p', { class: 'sub' }, h('b', null, String(shootsToday)), ` shoot${shootsToday === 1 ? '' : 's'} today, `, h('b', null, String(delWeek)), ` deliver${delWeek === 1 ? 'y' : 'ies'} this week, `, h('b', null, money(pending)), ' pending payments')),
      h('div', { class: 'btns' }, btn('Quotation', () => import('./quotations.js').then(m => m.openQuotationEditor()), { icon: 'plus' }), btn('Invoice', () => import('./invoices.js').then(m => m.openInvoiceEditor()), { icon: 'plus' }), btn('New project', () => import('./projects.js').then(m => m.openProjectForm()), { cls: 'gold', icon: 'plus' }))),
    h('div', { class: 'kpis' },
      kpi('Active Projects', String(active.length), 'camera', [h('span', { class: newThis ? 'up' : 'dim' }, '+' + newThis), ' new this month'], '#/projects'),
      kpi(`Revenue (${monthShort(mk)})`, moneyShort(rev), 'rupee', [pct(rev, revPrev), ' vs last month'], '#/payments'),
      kpi('Pending Payments', moneyShort(pending), 'hourglass', [h('span', { class: overdue.length ? 'dn' : 'dim' }, `${overdue.length} invoice${overdue.length === 1 ? '' : 's'}`), ' overdue'], '#/invoices?status=open'),
      kpi(`Net Profit (${monthShort(mk)})`, moneyShort(profit), 'trend', [pct(profit, profitPrev), ' vs last month'], '#/expenses')),
    h('div', { class: 'grid2' },
      card('Upcoming Shoots & Deliveries', upTable, h('span', { class: 'dim small' }, 'Next 14 days')),
      card('Revenue', chart, h('span', { class: 'dim small' }, 'Last 6 months · payments'))),
    teamBlock(team, today),
    h('div', { class: 'grid2 even' }, leadsBlock(leads, today), occasionsBlock(L.customers, today)),
    albumMod ? h('div', { class: 'mb' }, albumMod.albumsBlock(albums, expenses, cMap, today)) : null,
    h('div', { class: 'mb' }, card('Projects', projTable, linkBtn('View all', '#/projects', 'sm'))),
    h('div', { class: 'grid3' },
      card('Payment Reminders', remList, open.length > rem.length ? linkBtn(`All ${open.length}`, '#/invoices?status=open', 'sm') : null),
      card('Recent Invoices', invList, linkBtn('View all', '#/invoices', 'sm')),
      card('Recent Activity', actList)));
}
