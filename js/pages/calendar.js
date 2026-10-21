// Calendar (owner): month / week / agenda views of shoots, deliveries, crew, payments due, leads and occasions.
import { h, mount, btn, ic, empty } from '../dom.js';
import { openDrawer, popMenu, toast } from '../ui.js';
import { calendarData, state } from '../store.js';
import {
  collectEvents, conflictMap, monthGrid, weekStartOf, eventOn, KINDS, KIND_COLOR, KIND_LABEL, buildIcs, gcalUrl, wishText, typeColor,
} from '../calcore.js';
import { todayIST, addDays, addMonths, fmtDate, fmtDateShort, money } from '../util.js';
import { pageHead, openRecord, dwSection } from './common.js';
import { openWhatsApp } from '../share.js';

const VIEWS = [['month', 'Month', 'grid'], ['week', 'Week', 'columns'], ['agenda', 'Agenda', 'list']];
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const UI = { view: null, cursor: null, off: new Set() };
const KIND_SINGLE = { shoot: 'Shoot', delivery: 'Delivery', task: 'Crew', due: 'Payment due', lead: 'Lead', occasion: 'Occasion' };
const isPhone = () => matchMedia('(max-width: 760px)').matches;
const monthTitle = iso => new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso.slice(0, 7) + '-01T00:00:00Z'));
const weekday = (iso, style = 'long') => new Intl.DateTimeFormat('en-IN', { weekday: style, timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
const plural = (n, w, p = w + 's') => `${n} ${n === 1 ? w : p}`;

// ---------- downloads / external calendar ----------
export function downloadText(fileName, text, mime = 'text/calendar;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: fileName, hidden: true });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const icsName = s => String(s || 'event').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 50) || 'event';
export function downloadIcs(events, fileName) {
  downloadText(fileName || `${icsName(events[0]?.title)}.ics`, buildIcs(events, { name: state.company?.name || 'Studio Manager' }));
  toast(`Downloaded ${fileName || icsName(events[0]?.title) + '.ics'}`, 'success');
}
export function openGoogleCalendar(e) {
  if (!window.open(gcalUrl(e), '_blank', 'noopener')) toast('Pop-up blocked. Allow pop-ups for Google Calendar.', 'warn');
}
/** "Calendar" button for drawers: Google Calendar link + .ics download for each entry (shoot / delivery / task). */
export function calendarButton(getEvents) {
  const b = h('button', { type: 'button', class: 'btn sm', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, h('span', { class: 'bi', 'aria-hidden': 'true' }, ic('calendar', 15)), 'Calendar', ic('chevronDown', 13));
  b.addEventListener('click', () => {
    const evs = getEvents().filter(e => e.start);
    if (!evs.length) { toast('Add a date first.', 'info'); return; }
    const many = evs.length > 1;
    const lbl = e => (e.kind === 'delivery' ? 'delivery' : e.kind === 'task' ? 'work' : 'shoot');
    popMenu(b, evs.flatMap((e, i) => [i ? '-' : null,
      many ? { label: e.kind === 'delivery' ? 'Delivery' : 'Shoot', sub: e.end && e.end !== e.start ? `${fmtDateShort(e.start)} – ${fmtDate(e.end)}` : fmtDate(e.start) } : null,
      { text: `Add ${lbl(e)} to Google Calendar`, icon: 'external', onClick: () => openGoogleCalendar(e) },
      { text: `Download ${lbl(e)} (.ics)`, icon: 'download', onClick: () => downloadIcs([e], `${icsName(e.title)}-${e.start}.ics`) }]).filter(Boolean));
  });
  return b;
}

// ---------- page ----------
function rangeOf(view, cursor) {
  if (view === 'week') { const f = weekStartOf(cursor); return { from: f, to: addDays(f, 6) }; }
  if (view === 'agenda') return { from: cursor, to: addDays(cursor, 29) };
  const g = monthGrid(cursor); return { from: g.start, to: g.end, grid: g };
}

function evPill(e, day, onOpen) {
  const contR = (e.end || e.date) > day;
  return h('button', {
    type: 'button', class: ['cal-ev', 'k-' + e.kind, e.dashed ? 'dashed' : null, e.done ? 'done' : null, e.date < day ? 'cont-l' : null, contR ? 'cont-r' : null],
    style: { '--c': e.color }, title: `${e.title}${e.sub ? ' — ' + e.sub : ''}`,
    'aria-label': `${KIND_LABEL[e.kind]}: ${e.title}${e.sub ? ', ' + e.sub : ''}`,
    onclick: ev => { ev.stopPropagation(); onOpen(e); },
  },
  e.kind === 'task' ? h('span', { class: 'cal-ini', 'aria-hidden': 'true' }, e.initials) : h('i', { class: 'cal-dot', 'aria-hidden': 'true' }),
  h('span', { class: 'cal-t' }, e.title));
}

function openEvent(e) {
  const { type, id } = e.ref;
  openRecord(type, id);
}

export async function render({ query = {}, refresh } = {}) {
  if (!refresh) {
    if (VIEWS.some(v => v[0] === query.view)) UI.view = query.view;
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) UI.cursor = query.date;
  }
  if (!UI.view) UI.view = isPhone() ? 'agenda' : 'month';
  if (!UI.cursor) UI.cursor = todayIST();
  const data = await calendarData();
  const today = todayIST();
  const host = h('div');

  const draw = () => {
    const { from, to, grid } = rangeOf(UI.view, UI.cursor);
    const all_ = collectEvents(data, from, to);
    const conf = conflictMap(all_, from, to);
    const evs = all_.filter(e => !UI.off.has(e.kind));
    const counts = Object.fromEntries(KINDS.map(([k]) => [k, all_.filter(e => e.kind === k).length]));
    const byDay = day => evs.filter(e => eventOn(e, day));

    const move = n => {
      if (UI.view === 'month') UI.cursor = addMonths(UI.cursor.slice(0, 7) + '-01', n);
      else UI.cursor = addDays(UI.cursor, n * (UI.view === 'week' ? 7 : 30));
      draw();
    };
    const title = UI.view === 'month' ? monthTitle(UI.cursor) : `${fmtDateShort(from)} – ${fmtDate(to)}`;
    const seg = h('div', { class: 'cal-seg', role: 'group', 'aria-label': 'Calendar view' }, VIEWS.map(([v, l, icn]) => h('button', {
      type: 'button', 'aria-pressed': String(UI.view === v), onclick: () => { if (UI.view !== v) { UI.view = v; if (v === 'agenda' && UI.cursor < today && UI.cursor.slice(0, 7) === today.slice(0, 7)) UI.cursor = today; draw(); } },
    }, ic(icn, 14), h('span', null, l))));
    const fchips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Show event kinds' }, KINDS.map(([k, l]) => h('button', {
      type: 'button', class: 'chip cal-chip', 'aria-pressed': String(!UI.off.has(k)), style: { '--c': KIND_COLOR[k] },
      onclick: () => { if (UI.off.has(k)) UI.off.delete(k); else UI.off.add(k); draw(); },
    }, h('i', { class: 'cal-dot' + (k === 'lead' ? ' dashed' : ''), 'aria-hidden': 'true' }), l, h('span', { class: 'cnt' }, String(counts[k])))));
    const nav = h('div', { class: 'cal-nav' },
      h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Previous', title: 'Previous', onclick: () => move(-1) }, ic('chevronLeft', 18)),
      btn('Today', () => { UI.cursor = today; draw(); }, { cls: 'sm' }),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Next', title: 'Next', onclick: () => move(1) }, ic('chevronRight', 18)),
      h('h2', { class: 'cal-title', 'aria-live': 'polite' }, title));

    let body;
    if (UI.view === 'month') body = monthView(grid, byDay, conf, today);
    else if (UI.view === 'week') body = weekView(from, byDay, conf, today);
    else body = agendaView(from, to, byDay, conf, today);

    // Project-type legend (only types visible in range)
    const types = [...new Set(evs.filter(e => e.kind === 'shoot').map(e => e.projectType).filter(Boolean))];
    const legend = types.length && !UI.off.has('shoot') ? h('div', { class: 'cal-legend', 'aria-label': 'Shoot colours by project type' },
      types.map(t => h('span', null, h('i', { class: 'cal-dot', style: { '--c': typeColor(t, data.types) }, 'aria-hidden': 'true' }), t))) : null;
    const nConf = [...conf.keys()].filter(d => d >= from && d <= to && (UI.view !== 'month' || d.slice(0, 7) === UI.cursor.slice(0, 7))).length;
    mount(host,
      h('div', { class: 'card cal-card' },
        h('div', { class: 'cal-bar' }, nav, h('span', { class: 'grow' }), seg),
        h('div', { class: 'toolbar cal-filters' }, fchips, nConf ? h('span', { class: 'cal-warn-sum' }, h('i', { class: 'cal-conf', 'aria-hidden': 'true' }), plural(nConf, 'day') + ' with clashes') : null),
        body, legend));
  };

  function monthView(g, byDay, conf, today_) {
    const mk = UI.cursor.slice(0, 7);
    const MAX = 3;
    const cell = day => {
      const list = byDay(day);
      const occ = list.filter(e => e.kind === 'occasion'); const main = list.filter(e => e.kind !== 'occasion');
      const c = conf.get(day);
      const label = `${weekday(day)} ${fmtDate(day)}: ${list.length ? plural(list.length, 'item') : 'nothing scheduled'}${c ? ', has clashes' : ''}. Open day`;
      return h('div', { class: ['cal-cell', day.slice(0, 7) !== mk ? 'out' : null, day === today_ ? 'today' : null, day < today_ ? 'past' : null, c ? 'conf' : null], role: 'gridcell', onclick: e => { if (!e.target.closest('.cal-ev,.cal-more')) openDay(day); } },
        h('div', { class: 'cal-dh' },
          h('button', { type: 'button', class: 'cal-dn', 'aria-label': label, onclick: e => { e.stopPropagation(); openDay(day); } }, String(Number(day.slice(8)))),
          c ? h('span', { class: 'cal-conf', title: c.map(x => x.text).join('\n'), 'aria-hidden': 'true' }) : null,
          occ.length ? h('span', { class: 'cal-occ', title: occ.map(o => o.title).join('\n'), 'aria-hidden': 'true' }, ic(occ[0].occasion === 'birthday' ? 'gift' : 'heart', 11), occ.length > 1 ? String(occ.length) : null) : null),
        h('div', { class: 'cal-evs' }, main.slice(0, MAX).map(e => evPill(e, day, openEvent)),
          main.length > MAX ? h('button', { type: 'button', class: 'cal-more', onclick: e => { e.stopPropagation(); openDay(day); } }, `+${main.length - MAX} more`) : null));
    };
    const weeks = []; for (let i = 0; i < g.days.length; i += 7) weeks.push(g.days.slice(i, i + 7));
    return h('div', { class: 'cal-month', role: 'grid', 'aria-label': monthTitle(UI.cursor) },
      h('div', { class: 'cal-wd', role: 'row' }, WD.map(w => h('div', { role: 'columnheader' }, w))),
      weeks.map(w => h('div', { class: 'cal-week-row', role: 'row' }, w.map(cell))));
  }

  function weekView(from, byDay, conf, today_) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    return h('div', { class: 'cal-wk' }, days.map(day => {
      const list = byDay(day); const c = conf.get(day);
      return h('section', { class: ['cal-wk-col', day === today_ ? 'today' : null, c ? 'conf' : null], 'aria-label': `${weekday(day)} ${fmtDate(day)}` },
        h('button', { type: 'button', class: 'cal-wk-h', onclick: () => openDay(day), 'aria-label': `Open ${weekday(day)} ${fmtDate(day)}` },
          h('span', null, weekday(day, 'short')), h('b', null, String(Number(day.slice(8)))), c ? h('i', { class: 'cal-conf', title: c.map(x => x.text).join('\n'), 'aria-hidden': 'true' }) : null),
        h('div', { class: 'cal-wk-list' }, list.length ? list.map(e => h('button', {
          type: 'button', class: ['cal-card-ev', 'k-' + e.kind, e.dashed ? 'dashed' : null, e.done ? 'done' : null], style: { '--c': e.color },
          onclick: () => openEvent(e), title: `${e.title}${e.sub ? ' — ' + e.sub : ''}`,
        }, h('span', { class: 'cal-ck' }, e.kind === 'task' ? h('span', { class: 'cal-ini' }, e.initials) : null, KIND_SINGLE[e.kind],
          e.date !== e.end ? h('small', null, `${fmtDateShort(e.date)}–${fmtDateShort(e.end)}`) : null),
        h('b', null, e.title), e.sub ? h('small', null, e.sub) : null, e.amount ? h('small', { class: 'warn' }, money(e.amount)) : null))
          : h('button', { type: 'button', class: 'cal-wk-empty', onclick: () => openDay(day) }, 'Free')));
    }));
  }

  function agendaView(from, to, byDay, conf, today_) {
    const groups = [];
    for (let d = from; d <= to; d = addDays(d, 1)) { const list = byDay(d); if (list.length) groups.push([d, list]); }
    if (!groups.length) return empty('Nothing scheduled in these 30 days.', btn('New project', () => import('./projects.js').then(m => m.openProjectForm()), { cls: 'gold', icon: 'plus' }), { icon: 'calendar' });
    return h('div', { class: 'cal-agenda' }, groups.map(([d, list]) => {
      const c = conf.get(d);
      return h('section', { class: 'cal-ag-day' + (d === today_ ? ' today' : '') },
        h('button', { type: 'button', class: 'cal-ag-h', onclick: () => openDay(d) },
          h('span', { class: 'cal-ag-d' }, h('b', null, String(Number(d.slice(8)))), h('small', null, weekday(d, 'short'))),
          h('span', { class: 'cal-ag-m' }, d === today_ ? 'Today' : d === addDays(today_, 1) ? 'Tomorrow' : fmtDate(d)),
          c ? h('span', { class: 'cal-ag-warn' }, h('i', { class: 'cal-conf', 'aria-hidden': 'true' }), plural(c.length, 'clash', 'clashes')) : null),
        h('div', { class: 'cal-ag-list' }, list.map(e => h('button', {
          type: 'button', class: ['li', 'li-btn', 'cal-ag-it', e.dashed ? 'dashed' : null, e.done ? 'done' : null], style: { '--c': e.color }, onclick: () => openEvent(e),
        }, h('div', { class: 'cal-ag-main' }, h('i', { class: 'cal-bar-c', 'aria-hidden': 'true' }), h('div', null, h('b', null, e.title), e.sub ? h('small', null, e.sub) : null)),
        h('div', null, e.amount ? h('span', { class: 'amt warn' }, money(e.amount)) : null, e.kind === 'task' ? h('span', { class: 'mini-av sm', 'aria-hidden': 'true' }, e.initials) : null, h('span', { class: 'tag' }, KIND_LABEL[e.kind]))))));
    }));
  }

  draw();
  if (!refresh && /^\d{4}-\d{2}-\d{2}$/.test(query.day || '')) setTimeout(() => openDay(query.day), 0);

  const exportAll = btn('Export all (.ics)', () => exportIcs(data), { icon: 'download' });
  const { from, to } = rangeOf('month', UI.cursor);
  const monthEvs = collectEvents(data, from, to).filter(e => e.date.slice(0, 7) === UI.cursor.slice(0, 7));
  const n = k => monthEvs.filter(e => e.kind === k).length;
  return h('div', null,
    pageHead('Calendar', `${monthTitle(UI.cursor)}: ${plural(n('shoot'), 'shoot')} · ${plural(n('delivery'), 'delivery', 'deliveries')} · ${plural(n('task'), 'crew booking')}`, [
      exportAll,
      btn('Assign work', () => import('./team.js').then(m => m.openTaskForm()), { icon: 'team' }),
      btn('New project', () => import('./projects.js').then(m => m.openProjectForm()), { cls: 'gold', icon: 'plus' })]),
    host);
}

/** Next 12 months of shoots, deliveries and crew work as one .ics file. */
export function exportIcs(data) {
  const today = todayIST();
  const evs = collectEvents(data, today, addMonths(today, 12)).filter(e => ['shoot', 'delivery', 'task'].includes(e.kind) && !(e.kind === 'delivery' && e.done));
  if (!evs.length) { toast('Nothing to export in the next 12 months.', 'info'); return null; }
  const ics = evs.map(e => ({ uid: e.key.replace(':', '-'), title: e.kind === 'task' ? `${e.title} · ${e.memberName}` : e.title, start: e.date, end: e.end, location: e.venue || '', description: e.sub || '' }));
  downloadText(`studio-calendar-${today}.ics`, buildIcs(ics, { name: state.company?.name || 'Studio Manager' }));
  toast(`Exported ${plural(ics.length, 'event')} (next 12 months)`, 'success');
  return ics.length;
}

// ---------- day drawer ----------
export function openDay(day) {
  return openDrawer({
    hash: '/calendar?day=' + day, label: 'Day', size: 'narrow',
    render: async () => {
      const data = await calendarData();
      const evs = collectEvents(data, day, day);
      const conf = conflictMap(evs, day, day).get(day) || [];
      const today = todayIST();
      const rel = day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : day === addDays(today, -1) ? 'Yesterday' : null;
      const confKeys = new Set(conf.flatMap(c => c.keys));
      const row = e => {
        const right = [];
        if (e.amount) right.push(h('span', { class: 'amt warn' }, money(e.amount)));
        if (confKeys.has(e.key)) right.push(h('span', { class: 'st s3' }, 'Clash'));
        if (e.kind === 'occasion') {
          const c = e.customer;
          right.push(h('button', { type: 'button', class: 'btn wa sm', 'aria-label': `Send ${e.occasion} wishes to ${c.name} on WhatsApp`, onclick: ev => { ev.stopPropagation(); openWhatsApp(c.whatsapp || c.mobile, wishText({ customer: c, kind: e.occasion, years: e.years }, state.company?.name)); } }, ic('whatsapp', 14), 'Wish'));
        }
        return h('div', { class: 'li li-btn cal-dl' + (e.dashed ? ' dashed' : ''), role: 'button', tabindex: '0', style: { '--c': e.color },
          onclick: ev => { if (!ev.target.closest('button')) openEvent(e); }, onkeydown: ev => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) openEvent(e); } },
        h('div', { class: 'cal-ag-main' }, e.kind === 'task' ? h('span', { class: 'mini-av sm', 'aria-hidden': 'true' }, e.initials) : h('i', { class: 'cal-bar-c', 'aria-hidden': 'true' }),
          h('div', null, h('b', null, e.title), h('small', null, [e.sub, e.date !== e.end ? `${fmtDateShort(e.date)} – ${fmtDateShort(e.end)}` : null].filter(Boolean).join(' · ')))),
        h('div', null, right));
      };
      return {
        title: fmtDate(day), sub: `${weekday(day)}${rel ? ' · ' + rel : ''} · ${evs.length ? plural(evs.length, 'item') : 'nothing scheduled'}`,
        badge: conf.length ? h('span', { class: 'st s3' }, plural(conf.length, 'clash', 'clashes')) : null,
        actions: h('div', { class: 'btns' },
          btn('New project on this date', () => import('./projects.js').then(m => m.openProjectForm(null, { event_date: day })), { cls: 'gold sm', icon: 'plus' }),
          btn('Assign work', () => import('./team.js').then(m => m.openTaskForm(null, { work_date: day })), { cls: 'sm', icon: 'team' })),
        body: [
          conf.length ? h('div', { class: 'warn-box cal-warnbox', role: 'note' }, ic('alert', 15), h('div', null,
            h('b', null, 'Possible clash'), conf.map(c => h('p', null, c.text)),
            h('p', { class: 'dim small' }, 'Check that you have enough crew and travel time.'))) : null,
          ...KINDS.map(([k, l]) => { const list = evs.filter(e => e.kind === k); return list.length ? dwSection(l, list.map(row), h('span', { class: 'dim small' }, String(list.length))) : null; }),
          evs.length ? null : empty('Nothing on this day yet.', null, { icon: 'calendar' }),
        ],
      };
    },
  });
}
