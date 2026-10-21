// Employee panel (#/my-work). Uses only what RLS lets an employee read: own members row, own company, own tasks + payouts.
// Never shows customers, invoices or prices — only the project title the owner typed and the employee's own amount.
import { h, mount, table, empty, btn, chips, input, field, ic } from '../dom.js';
import { state, DEMO, all, setTaskStatus } from '../store.js';
import { money, fmtDate, fmtDateShort, todayIST, addDays, initials, sum } from '../util.js';
import { confirmDialog, toast, errMsg, busy } from '../ui.js';
import { signOut } from '../auth.js';
import { periodRange, memberStats, payCoverage, taskInRange } from '../teamcalc.js';
import { taskPill, taskDates } from './common.js';
import { sharePdf } from '../share.js';

const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom range']];

export async function renderEmployee() {
  const me = state.member; const co = state.company;
  document.title = `My work · ${co?.name || 'Studio'}`;
  const name = me.display_name || state.session.user.name || me.email;
  let kind = 'month';
  const mon = periodRange('month');
  const fromI = input({ type: 'date', value: mon.from, 'aria-label': 'From date' });
  const toI = input({ type: 'date', value: mon.to, 'aria-label': 'To date' });
  const period = () => (kind === 'custom' ? periodRange('custom', { from: fromI.value, to: toI.value }) : periodRange(kind));
  const root = h('div', { class: 'gate emp-gate' });
  const main = h('main', { class: 'emp', id: 'main', tabindex: '-1' });
  root.appendChild(main);

  const logo = h('div', { class: 'logo', 'aria-hidden': 'true' }, initials(co?.name, 'S'));
  if (state.logoUrl) mount(logo, h('img', { src: state.logoUrl, alt: '' }));
  const topBar = h('header', { class: 'emp-top' },
    h('div', { class: 'brand emp-brand' }, logo, h('div', { class: 'bt' }, h('b', { title: co?.name }, co?.name || 'Studio'), h('small', null, 'Team panel'))),
    h('div', { class: 'emp-me' },
      DEMO ? h('span', { class: 'pill demo' }, h('i', { 'aria-hidden': 'true' }), 'Demo mode') : null,
      h('div', { class: 'who' }, h('div', { class: 'av', 'aria-hidden': 'true' }, initials(name, 'U')), h('div', null, h('b', null, name), h('small', null, me.job_title || 'Team member'))),
      btn('Sign out', () => signOut(), { icon: 'logout', cls: 'sm' })));

  const periodChips = chips(PERIODS, kind, v => { kind = v; paint(); }, 'Show work for');
  const customRow = h('div', { class: 'emp-custom' }, field('From', fromI), field('To', toI));
  fromI.addEventListener('change', () => paint()); toI.addEventListener('change', () => paint());

  async function setStatus(t, status, button) {
    if (status === 'done' && !(await confirmDialog(`Mark “${t.title}”${t.project_title ? ` (${t.project_title})` : ''} on ${fmtDate(t.work_date)} as done? The studio sees it as completed and it counts towards your earnings.`, { title: 'Mark work as done?', okText: 'Yes, mark done' }))) return;
    await busy(button, async () => {
      try { await setTaskStatus(t, status); toast(status === 'done' ? 'Marked as done — thank you!' : 'Marked as in progress', 'success'); await paint(); }
      catch (e) { toast(errMsg(e), 'error'); }
    });
  }
  const actionsFor = t => [
    t.status === 'assigned' ? btn('Start', e => setStatus(t, 'in_progress', e.currentTarget), { cls: 'sm', aria: `Start ${t.title}` }) : null,
    t.status === 'assigned' || t.status === 'in_progress' ? btn('Mark done', e => setStatus(t, 'done', e.currentTarget), { cls: 'sm gold', icon: 'check', aria: `Mark ${t.title} as done` }) : null,
  ];

  async function paint() {
    const y = window.scrollY;
    const [tasksAll, payoutsAll] = await Promise.all([all('tasks'), all('payouts')]);
    const tasks = tasksAll.filter(t => t.member_id === me.id);
    const payouts = payoutsAll.filter(p => p.member_id === me.id);
    const today = todayIST(); const p = period();
    const st = memberStats(me.id, tasks, payouts, p);
    const cov = payCoverage(tasks, payouts);
    customRow.hidden = kind !== 'custom';
    const rows = tasks.filter(t => t.status !== 'cancelled' && taskInRange(t, p.from, p.to)).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
    const upcoming = tasks.filter(t => (t.status === 'assigned' || t.status === 'in_progress') && t.work_date > today).sort((a, b) => String(a.work_date).localeCompare(String(b.work_date)));
    const myPay = payouts.filter(x => x.payout_date >= p.from && x.payout_date <= p.to).sort((a, b) => String(b.payout_date).localeCompare(String(a.payout_date)));
    const todayCount = tasks.filter(t => t.status !== 'cancelled' && taskInRange(t, today, today)).length;

    const workTable = rows.length ? table([
      { label: 'Project', cell: t => [h('b', null, t.project_title || '—'), t.work_date < p.from ? h('small', null, `Started ${fmtDateShort(t.work_date)}`) : null] },
      { label: 'My work', cell: t => [t.title, t.details ? h('small', null, t.details) : null] },
      { label: 'Date & venue', cell: t => [h('span', { class: 'nowrap' }, t.work_date === today ? 'Today' : taskDates(t)), t.venue ? h('small', null, t.venue) : null] },
      { label: 'My payment', cls: 'r', cell: t => h('b', { class: 'num' }, money(t.amount)) },
      { label: 'Status', cell: t => taskPill(t, cov.get(t.id)) },
    ], rows, { actions: actionsFor }) : empty(`No work in ${kind === 'today' ? 'today’s list' : 'this period'}.`, null, { icon: 'calendar' });
    workTable.querySelector?.('table')?.classList.add('stack', 'emp-tbl');

    const k = (l, v, cls = '', d) => h('div', { class: 'card kpi' }, h('div', { class: 'l' }, l), h('div', { class: 'v ' + cls }, v), d ? h('div', { class: 'd' }, d) : null);
    const short = { today: 'today', week: 'this week', month: p.label.split(' ')[0], custom: 'in range' }[kind];
    mount(main,
      topBar,
      h('div', { class: 'emp-hello' }, h('h1', null, `Hi, ${name} 👋`),
        h('p', { class: 'sub' }, h('b', null, String(todayCount)), ` task${todayCount === 1 ? '' : 's'} today · `, h('b', null, String(upcoming.length)), ' coming up')),
      h('div', { class: 'kpis' },
        k(`Tasks (${short})`, `${st.periodTasks} task${st.periodTasks === 1 ? '' : 's'}`, '', `${rows.filter(t => t.status === 'done').length} done`),
        k(`Earned (${short})`, money(st.earned), '', st.scheduled > 0 ? `+ ${money(st.scheduled)} when done` : 'Done work'),
        k(`Received (${short})`, money(st.received), 'up', `${money(st.paidAll)} all time`),
        k(st.pending < 0 ? 'Advance from studio' : 'Pending from studio', money(Math.abs(st.pending)), st.pending > 0 ? 'warn' : '', 'All time · done − received')),
      h('section', { class: 'card' },
        h('div', { class: 'ch' }, h('h3', null, 'My assigned work'), periodChips),
        customRow, workTable,
        h('div', { class: 'emp-pdf' }, h('span', { class: 'muted small' }, ic('calendar', 14), ' ', p.label),
          btn('Download statement PDF', e => busy(e.currentTarget, () => sharePdf({ make: async () => (await import('../pdf/docs.js')).statementPdf(me.id, p), channel: 'download' })), { cls: 'gold', icon: 'download' }))),
      h('div', { class: 'grid2 emp-grid' },
        h('section', { class: 'card' }, h('div', { class: 'ch' }, h('h3', null, 'Coming up'), h('span', { class: 'dim small' }, `${upcoming.length} task${upcoming.length === 1 ? '' : 's'}`)),
          upcoming.length ? upcoming.slice(0, 8).map(t => h('div', { class: 'li' },
            h('div', null, h('b', null, t.title), h('small', null, [t.work_date === addDays(today, 1) ? 'Tomorrow' : taskDates(t), t.project_title, t.venue].filter(Boolean).join(' · '))),
            h('div', null, h('span', { class: 'amt' }, money(t.amount)), taskPill(t)))) : empty('Nothing scheduled ahead yet.', null, { icon: 'calendar' })),
        h('section', { class: 'card' }, h('div', { class: 'ch' }, h('h3', null, 'Payouts received'), h('span', { class: 'dim small' }, p.label)),
          myPay.length ? myPay.map(x => h('div', { class: 'li' }, h('div', null, h('b', null, money(x.amount)), h('small', null, [fmtDate(x.payout_date), x.notes].filter(Boolean).join(' · '))), h('div', null, h('span', { class: 'tag' }, x.mode || '—'))))
            : empty('No payouts in this period.', null, { icon: 'wallet' }),
          h('p', { class: 'dim small', style: { marginTop: '8px' } }, `Received in total: ${money(sum(payouts, x => x.amount))}`))),
      h('p', { class: 'lock' }, ic('info', 13), ' You only see your own work and the payments the studio entered for you — never customer prices, invoices or other staff.'));
    window.scrollTo(0, y);
  }
  await paint();
  return root;
}
