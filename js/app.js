// Bootstrap + owner shell (sidebar, topbar, search, avatar menu, router, live refresh, shortcuts).
import { h, mount, clear, ic, skeleton } from './dom.js';
import { route, startRouter, parseHash, navigate, setBase } from './router.js';
import { initApi, api, state, DEMO, all, onChange, refreshLogo } from './store.js';
import { authenticate, signOut, renderLogin } from './auth.js';
import { toast, errMsg, popMenu, closeAllModals, refreshDrawer, overlayOpen } from './ui.js';
import { openSearch } from './search.js';
import { initials, fmtTime, debounce } from './util.js';
import { SHORTCUTS, SHORTCUTS_EXTRA } from './config.js';

// ---------- dev error reporting (local only) ----------
if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
  const send = (kind, msg) => { try { navigator.sendBeacon('/__log', JSON.stringify({ kind, msg: String(msg).slice(0, 2000), url: location.href })); } catch { /* ignore */ } };
  window.addEventListener('error', e => send('error', `${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', e => send('rejection', e.reason?.stack || e.reason));
  const ce = console.error.bind(console);
  console.error = (...a) => { send('console', a.map(x => x?.stack || x).join(' ')); ce(...a); };
}

const NAV = [
  { sec: null, items: [['search', 'search', 'Search'], ['/calendar', 'calendar', 'Calendar']] },
  { sec: 'Main', items: [['/dashboard', 'dashboard', 'Dashboard'], ['/leads', 'target', 'Leads'], ['/customers', 'users', 'Customers'], ['/projects', 'camera', 'Projects'], ['/team', 'team', 'Team & Tasks']] },
  { sec: 'Billing', items: [['/quotations', 'quote', 'Quotations'], ['/invoices', 'invoice', 'Invoices'], ['/payments', 'rupee', 'Payments'], ['/receipts', 'receipt', 'Receipts'], ['/expenses', 'wallet', 'Expenses']] },
  { sec: 'Studio', items: [['/albums', 'album', 'Albums'], ['/vendors', 'truck', 'Vendors']] },
  { sec: 'Insights', items: [['/reports', 'chart', 'Reports & GST'], ['/settings', 'settings', 'Settings']] },
];
export const TITLES = { ...Object.fromEntries(NAV.flatMap(s => s.items).map(([p, ic_, l]) => [p, { ic: ic_, l }])), '/packages': { ic: 'package', l: 'Packages' } };

const P = {
  dashboard: () => import('./pages/dashboard.js'),
  customers: () => import('./pages/customers.js'),
  projects: () => import('./pages/projects.js'),
  invoices: () => import('./pages/invoices.js'),
  quotations: () => import('./pages/quotations.js'),
  payments: () => import('./pages/payments.js'),
  expenses: () => import('./pages/expenses.js'),
  settings: () => import('./pages/settings.js'),
  team: () => import('./pages/team.js'),
  calendar: () => import('./pages/calendar.js'),
  leads: () => import('./pages/leads.js'),
  packages: () => import('./pages/packages.js'),
  albums: () => import('./pages/albums.js'),
  vendors: () => import('./pages/vendors.js'),
  reports: () => import('./pages/reports.js'),
  debug: () => import('./pages/debug-pdfs.js'),
};
const LIVE = { live: true };
function registerRoutes() {
  route('/dashboard', [P.dashboard, 'render'], LIVE);
  route('/customers', [P.customers, 'renderList'], LIVE);
  route('/customers/:id', [P.customers, 'renderList'], { ...LIVE, base: '/customers', overlay: 'routeView' });
  route('/projects', [P.projects, 'render'], LIVE);
  route('/projects/:id', [P.projects, 'render'], { ...LIVE, base: '/projects', overlay: 'routeView' });
  route('/invoices', [P.invoices, 'renderList'], LIVE);
  route('/invoices/new', [P.invoices, 'renderList'], { ...LIVE, base: '/invoices', overlay: 'routeNew' });
  route('/invoices/:id/edit', [P.invoices, 'renderList'], { ...LIVE, base: '/invoices', overlay: 'routeEdit' });
  route('/invoices/:id', [P.invoices, 'renderList'], { ...LIVE, base: '/invoices', overlay: 'routeView' });
  route('/quotations', [P.quotations, 'renderList'], LIVE);
  route('/quotations/new', [P.quotations, 'renderList'], { ...LIVE, base: '/quotations', overlay: 'routeNew' });
  route('/quotations/:id/edit', [P.quotations, 'renderList'], { ...LIVE, base: '/quotations', overlay: 'routeEdit' });
  route('/quotations/:id', [P.quotations, 'renderList'], { ...LIVE, base: '/quotations', overlay: 'routeView' });
  route('/payments', [P.payments, 'renderPayments'], LIVE);
  route('/receipts', [P.payments, 'renderReceipts'], LIVE);
  route('/receipts/:id', [P.payments, 'renderReceipts'], { ...LIVE, base: '/receipts', overlay: 'routeReceipt' });
  route('/expenses', [P.expenses, 'render'], LIVE);
  route('/settings', [P.settings, 'render']);
  route('/team', [P.team, 'render'], LIVE);
  route('/team/members/:id', [P.team, 'render'], { ...LIVE, base: '/team', overlay: 'routeMember' });
  route('/team/tasks/:id', [P.team, 'render'], { ...LIVE, base: '/team', overlay: 'routeTask' });
  route('/calendar', [P.calendar, 'render'], LIVE);
  route('/leads', [P.leads, 'render'], LIVE);
  route('/leads/:id', [P.leads, 'render'], { ...LIVE, base: '/leads', overlay: 'routeView' });
  route('/packages', [P.packages, 'render'], LIVE);
  route('/albums', [P.albums, 'render'], LIVE);
  route('/albums/:id', [P.albums, 'render'], { ...LIVE, base: '/albums', overlay: 'routeView' });
  route('/vendors', [P.vendors, 'render'], LIVE);
  route('/vendors/:id', [P.vendors, 'render'], { ...LIVE, base: '/vendors', overlay: 'routeView' });
  route('/reports', [P.reports, 'render']);
  if (DEMO) { route('/debug-pdfs', [P.debug, 'render']); route('/debug-flows', [P.debug, 'renderFlows']); }
}

// ---------- shell ----------
let els = {};
const COLLAPSE_KEY = 'sm_side_collapsed';
function navItem([path, icn, label, soon]) {
  if (path === 'search') {
    return h('button', { type: 'button', class: 'nav', 'data-tip': 'Search (Ctrl K)', onclick: () => { closeNav(); openSearch(); } },
      h('span', { class: 'ic' }, ic(icn, 17)), h('span', { class: 'nl' }, label), h('kbd', { class: 'nk' }, 'Ctrl K'));
  }
  return h('a', { class: 'nav', href: '#' + path, dataset: { path }, 'data-tip': label + (soon ? ' · soon' : ''), onclick: closeNav },
    h('span', { class: 'ic' }, ic(icn, 17)), h('span', { class: 'nl' }, label),
    path === '/invoices' ? h('span', { class: 'badge', hidden: true, id: 'due-badge' }) : null,
    soon ? h('span', { class: 'soon' }, 'Soon') : null);
}
function closeNav() { els.app?.classList.remove('nav-open'); els.hamb?.setAttribute('aria-expanded', 'false'); }

function brandNode() {
  const co = state.company;
  const logo = h('div', { class: 'logo', 'aria-hidden': 'true' }, initials(co?.name, 'SM'));
  if (state.logoUrl) mount(logo, h('img', { src: state.logoUrl, alt: '' }));
  // The brand doubles as a "home" link (like a website logo): clicking it opens the dashboard.
  return h('button', { type: 'button', class: 'brand', title: 'Go to dashboard', 'aria-label': 'Go to dashboard', onclick: () => navigate('/dashboard') },
    logo, h('div', { class: 'bt' }, h('b', { title: co?.name }, co?.name || 'Studio'), h('small', null, 'Studio Manager')));
}
export function refreshBrand() { const b = els.side?.querySelector('.brand'); if (b) b.replaceWith(brandNode()); }

// Action handlers for each "new" item, keyed by menu text. Shared by the New menu
// and the keyboard-shortcut handler so both open exactly the same form.
const NEW_ACTIONS = {
  'Invoice': () => navigate('/invoices/new'),
  'Quotation': () => navigate('/quotations/new'),
  'Lead': async () => { const m = await import('./pages/leads.js'); const l = await m.openLeadForm(); if (l) m.openLeadDrawer(l.id); },
  'Customer': async () => { const m = await import('./pages/customers.js'); const c = await m.openCustomerForm(); if (c) navigate('/customers/' + c.id); },
  'Project': async () => { const m = await import('./pages/projects.js'); await m.openProjectForm(); },
  'Payment': async () => { const m = await import('./pages/payments.js'); await m.openPaymentModal(null); },
  'Expense': async () => { const m = await import('./pages/expenses.js'); await m.openExpenseForm(); },
  'Album order': async () => { const m = await import('./pages/albums.js'); const a = await m.openAlbumForm(); if (a) m.openAlbumDrawer(a.id); },
  'Assign work': async () => { const m = await import('./pages/team.js'); await m.openTaskForm(); },
  'Team payout': async () => { const m = await import('./pages/team.js'); await m.openPayoutModal(); },
};
// Keyboard hint shown next to each New-menu item (from the central SHORTCUTS list).
const KBD_FOR = Object.fromEntries(SHORTCUTS.filter(s => s.item).map(s => [s.item, s.kbd]));

const NEW_ITEMS = () => [
  { text: 'Invoice', icon: 'invoice', kbd: KBD_FOR['Invoice'], onClick: NEW_ACTIONS['Invoice'] },
  { text: 'Quotation', icon: 'quote', kbd: KBD_FOR['Quotation'], onClick: NEW_ACTIONS['Quotation'] },
  { text: 'Lead', icon: 'target', kbd: KBD_FOR['Lead'], onClick: NEW_ACTIONS['Lead'] },
  { text: 'Customer', icon: 'user', kbd: KBD_FOR['Customer'], onClick: NEW_ACTIONS['Customer'] },
  { text: 'Project', icon: 'camera', kbd: KBD_FOR['Project'], onClick: NEW_ACTIONS['Project'] },
  { text: 'Payment', icon: 'rupee', kbd: KBD_FOR['Payment'], onClick: NEW_ACTIONS['Payment'] },
  { text: 'Expense', icon: 'wallet', kbd: KBD_FOR['Expense'], onClick: NEW_ACTIONS['Expense'] },
  { text: 'Album order', icon: 'album', kbd: KBD_FOR['Album order'], onClick: NEW_ACTIONS['Album order'] },
  '-',
  { text: 'Assign work', icon: 'team', kbd: KBD_FOR['Assign work'], onClick: NEW_ACTIONS['Assign work'] },
  { text: 'Team payout', icon: 'rupee', kbd: KBD_FOR['Team payout'], onClick: NEW_ACTIONS['Team payout'] },
];

function setCollapsed(on) {
  els.app.classList.toggle('collapsed', on);
  els.collapse.setAttribute('aria-pressed', String(on));
  els.collapse.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
  els.collapse.title = on ? 'Expand sidebar' : 'Collapse sidebar';
  try { localStorage.setItem(COLLAPSE_KEY, on ? '1' : ''); } catch { /* ignore */ }
}

function buildShell(root) {
  const user = state.session.user; const member = state.member;
  const avName = member.display_name || user.name || user.email;
  const av = h('button', { type: 'button', class: 'av', 'aria-label': 'Account menu', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    user.avatar ? h('img', { src: user.avatar, alt: '', referrerpolicy: 'no-referrer' }) : initials(avName, 'U'));
  av.addEventListener('click', () => popMenu(av, [
    { label: avName, sub: `${user.email} · ${member.role}` }, '-',
    { text: 'Settings', icon: 'settings', onClick: () => navigate('/settings') },
    { text: 'Keyboard shortcuts', icon: 'info', onClick: () => navigate('/settings') },
    { text: 'Sign out', icon: 'logout', cls: 'danger', onClick: () => signOut() },
  ]));
  els.hamb = h('button', { type: 'button', class: 'ibtn hamb', 'aria-label': 'Open menu', 'aria-expanded': 'false', onclick: () => { const o = !els.app.classList.contains('nav-open'); els.app.classList.toggle('nav-open', o); els.hamb.setAttribute('aria-expanded', String(o)); if (o) els.side.querySelector('a,button')?.focus(); } }, ic('menu', 20));
  els.crumb = h('div', { class: 'crumb' });
  els.pill = h('span', { class: 'pill' + (DEMO ? ' demo' : '') }, h('i', { 'aria-hidden': 'true' }), DEMO ? 'Demo mode' : `Synced ${fmtTime()}`);
  els.collapse = h('button', { type: 'button', class: 'ibtn collapse-btn', onclick: () => setCollapsed(!els.app.classList.contains('collapsed')) }, ic('panel', 17));
  els.side = h('aside', { class: 'side', 'aria-label': 'Main navigation' },
    brandNode(),
    h('nav', { class: 'nav-list' }, NAV.map(s => [s.sec ? h('div', { class: 'sec' }, s.sec) : h('div', { class: 'sec sec-0' }), s.items.map(navItem)])),
    h('div', { class: 'side-foot' }, h('span', { class: 'sf-t' }, DEMO ? 'Demo data · nothing is saved' : 'Studio Manager v2'), els.collapse));
  const newBtn = h('button', { type: 'button', class: 'btn gold new-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, h('span', { class: 'bi' }, ic('plus', 15)), h('span', { class: 'lbl-long' }, 'New'), ic('chevronDown', 14));
  newBtn.addEventListener('click', () => popMenu(newBtn, NEW_ITEMS()));
  els.page = h('div', { id: 'page' });
  els.main = h('main', { class: 'main', id: 'main', tabindex: '-1' },
    h('div', { class: 'top' }, els.hamb, els.crumb,
      h('button', { type: 'button', class: 'search-btn', onclick: () => openSearch(), 'aria-label': 'Search customers, invoices, projects (Ctrl K)' },
        h('span', { class: 'sb-l' }, ic('search', 15), h('span', { class: 'lbl-long' }, 'Search customer, invoice, mobile…')), h('kbd', null, 'Ctrl K')),
      h('div', { class: 'right' }, els.pill, newBtn, av)),
    els.page);
  els.app = h('div', { class: 'app' }, els.side, h('div', { class: 'scrim', onclick: closeNav }), els.main);
  mount(root, els.app);
  let saved = ''; try { saved = localStorage.getItem(COLLAPSE_KEY) || ''; } catch { /* ignore */ }
  setCollapsed(!!saved);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (e.key === 'Escape' && els.app.classList.contains('nav-open')) { closeNav(); return; }
    const t = e.target; const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (typing || e.ctrlKey || e.metaKey || e.altKey || overlayOpen()) return;
    if (e.key === '/') { e.preventDefault(); openSearch(); return; }
    const k = (e.key || '').toLowerCase();
    if (k === 'n') { e.preventDefault(); navigate('/invoices/new'); return; } // legacy: N = new invoice
    const sc = SHORTCUTS.find(s => s.key === k);
    if (sc) {
      e.preventDefault();
      if (sc.nav) navigate(sc.nav);
      else if (sc.item && NEW_ACTIONS[sc.item]) NEW_ACTIONS[sc.item]();
    }
  });
}

export function setCrumb(icn, ...parts) {
  if (!els.crumb) return;
  const p = parts.filter(Boolean);
  mount(els.crumb, h('span', { class: 'cr-ic' }, ic(icn, 16)), p.map((x, i) => [i ? h('span', { class: 'cr-sep', 'aria-hidden': 'true' }, '/') : null, h('span', { class: i === p.length - 1 ? 'cr-cur' : '' }, x)]));
  document.title = `${p.slice(-1)[0] || 'Studio'} · ${state.company?.name || 'Studio Manager'}`;
}

// ---------- routing ----------
let renderSeq = 0;
let current = null; // { base, load, fn, live }
async function renderBase(load, base, query, seq, { refresh = false } = {}) {
  const [loader, fn] = load;
  const mod = await loader();
  const node = await mod[fn]({ params: {}, query, path: base, refresh });
  if (seq !== renderSeq) return false;
  const y = window.scrollY;
  mount(els.page, node);
  if (refresh) window.scrollTo(0, y);
  return true;
}
async function onRoute({ path, query, matched }) {
  closeNav();
  if (!matched) { navigate('/dashboard', { replace: true }); return; }
  const meta = matched.route.meta || {};
  const base = meta.base || path;
  const seq = ++renderSeq;
  closeAllModals();
  const top = '/' + base.split('/')[1];
  els.side.querySelectorAll('a.nav').forEach(a => {
    const on = a.dataset.path === top;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const keep = meta.overlay && current && current.base === base;
  if (!keep) {
    const t = TITLES[top]; setCrumb(t?.ic || 'dashboard', t?.l || '');
    current = null;
    setBase(base);
    mount(els.page, skeleton(7));
    try {
      if (!(await renderBase(matched.route.load, base, meta.overlay ? {} : query, seq))) return;
      current = { base, load: matched.route.load, live: !!meta.live };
      window.scrollTo(0, 0);
      if (!document.body.classList.contains('modal-open') && !meta.overlay) els.main.focus({ preventScroll: true });
      if (!DEMO) els.pill.lastChild.textContent = `Synced ${fmtTime()}`;
    } catch (e) {
      if (seq !== renderSeq) return;
      console.error(e);
      mount(els.page, h('div', { class: 'card' }, h('h3', null, 'Could not load this page'), h('p', { class: 'muted', style: { margin: '8px 0 12px' } }, errMsg(e)),
        h('button', { type: 'button', class: 'btn', onclick: () => location.reload() }, 'Reload')));
      return;
    }
  }
  if (meta.overlay) {
    try { const mod = await matched.route.load[0](); if (seq === renderSeq) await mod[meta.overlay]({ params: matched.params, query }); }
    catch (e) { console.error(e); toast(errMsg(e), 'error'); }
  }
}

/** Re-render the page behind any open drawer/modal (after data changes). Keeps scroll + page filter state. */
export async function refreshPage() {
  if (!current || !current.live) return;
  const seq = renderSeq;
  try { await renderBase(current.load, current.base, {}, seq, { refresh: true }); } catch (e) { console.warn('refresh', e); }
}

async function updateBadge() {
  try {
    const inv = await all('invoices');
    const n = inv.filter(i => i.status !== 'paid' && Number(i.balance) > 0).length;
    const b = document.getElementById('due-badge');
    if (b) { b.textContent = n ? `${n} due` : ''; b.hidden = !n; }
  } catch { /* ignore */ }
}

async function runRecurringOnce() {
  const key = 'sm_recurring_' + (state.company?.id || '') + '_' + new Date().toDateString();
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  try {
    const n = await api.rpc('generate_recurring_invoices');
    if (Number(n) > 0) {
      const { invalidate } = await import('./store.js'); invalidate();
      toast(`${n} recurring invoice${n > 1 ? 's' : ''} generated`, 'success');
    }
  } catch (e) { console.warn('recurring', e); }
}

async function boot() {
  const root = document.getElementById('root');
  try {
    await initApi();
  } catch (e) {
    console.error(e);
    mount(root, h('div', { class: 'gate' }, h('div', { class: 'login' }, h('h1', { style: { fontSize: '18px' } }, 'Could not start'), h('p', null, 'The app could not load its libraries. Check your internet connection and reload.'), h('button', { type: 'button', class: 'btn gold', onclick: () => location.reload() }, 'Reload'))));
    return;
  }
  let ok = false;
  try { ok = await authenticate(root); }
  catch (e) { console.error(e); renderLogin(root, errMsg(e)); return; }
  if (!ok) return;

  // App lock (PIN): on open and after N idle minutes. Demo-only `?lock=1` sets PIN 1234 to preview the lock screen.
  const lk = await import('./lock.js');
  if (DEMO && new URLSearchParams(location.search).get('lock') === '1' && !lk.getPin(state.company.id)) await lk.setPin(state.company.id, '1234', 15);
  lk.initLock({ companyId: state.company.id, name: state.company.name, onForgot: () => signOut() });

  if (state.member.role === 'employee') {
    await refreshLogo().catch(() => null); // may be denied by storage policies; falls back to initials
    const { renderEmployee } = await import('./pages/mywork.js');
    if (parseHash().path !== '/my-work') history.replaceState(null, '', location.pathname + location.search + '#/my-work');
    clear(root);
    root.appendChild(await renderEmployee());
    return;
  }
  await refreshLogo().catch(() => null);
  buildShell(root);
  registerRoutes();
  onChange(debounce(updateBadge, 300));
  onChange(debounce(() => { refreshPage(); refreshDrawer(); }, 60));
  updateBadge();
  startRouter(onRoute);
  runRecurringOnce();
  // Demo-only: ?search=<query> opens the global search prefilled (used for screenshots of the search dropdown).
  if (DEMO) {
    const sq = new URLSearchParams(location.search).get('search');
    if (sq) setTimeout(async () => { await openSearch(); const inp = document.querySelector('#sr-results')?.parentElement?.querySelector('input') || document.querySelector('input[role="combobox"]'); if (inp) { inp.value = sq; inp.dispatchEvent(new Event('input', { bubbles: true })); } }, 300);
  }
}
boot();
