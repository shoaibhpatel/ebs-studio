// Minimal hash router: '#/invoices/:id?x=1'
// Overlay routes (meta.base + meta.overlay) render their base list page and open a drawer / modal on top.
const routes = [];
let handler = null;
let base = '/dashboard';

export function route(pattern, load, meta = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/\/:([\w]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
  routes.push({ pattern, re, keys, load, meta });
}
export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '') || '/dashboard';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/dashboard', query: Object.fromEntries(new URLSearchParams(qs)) };
}
export function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      return { route: r, params };
    }
  }
  return null;
}
export function startRouter(onRoute) {
  handler = onRoute;
  window.addEventListener('hashchange', fire);
  fire();
}
function fire() { const p = parseHash(); handler && handler({ ...p, matched: match(p.path) }); }
export function navigate(path, { replace = false } = {}) {
  const target = '#' + path;
  if (location.hash === target) { fire(); return; }
  if (replace) { history.replaceState(null, '', location.pathname + location.search + target); fire(); }
  else location.hash = target;
}
export function reload() { fire(); }
/** Path of the page currently rendered behind any overlay. */
export function setBase(p) { base = p; }
export function getBase() { return base; }
/** Change the hash without triggering a route (used by drawers/modals). */
export function setHashSilently(hash) {
  const h = hash.startsWith('#') ? hash : '#' + hash;
  if (location.hash !== h) history.replaceState(null, '', location.pathname + location.search + h);
}
