// Toasts, overlay stack (modals + one slide-over drawer; Esc, focus trap, return focus), confirm dialog, popover menus.
import { h, btn, ic, skeleton, mount } from './dom.js';
import { getBase, setHashSilently } from './router.js';

// ---------- Toasts ----------
let toastHost;
export function toast(message, type = 'info', ms = 3800) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
  }
  const iconName = { success: 'check', error: 'alert', info: 'info', warn: 'alert' }[type] || 'info';
  const t = h('div', { class: 'toast ' + type },
    h('span', { class: 'ti', 'aria-hidden': 'true' }, ic(iconName, 13)), h('span', null, message),
    h('button', { type: 'button', class: 'tx', 'aria-label': 'Dismiss', onclick: () => t.remove() }, ic('x', 14)));
  toastHost.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, type === 'error' ? ms + 2500 : ms);
  return t;
}
export function errMsg(e) { return (e && (e.message || e.error_description || e.msg)) || String(e || 'Something went wrong'); }

// ---------- Overlay stack ----------
const stack = [];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

document.addEventListener('keydown', e => {
  const top = stack[stack.length - 1];
  if (!top) return;
  if (e.key === 'Escape') { e.preventDefault(); top.request(); }
  else if (e.key === 'Tab') {
    const f = [...top.panel.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === document.activeElement);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!top.panel.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  }
});

// Clicking any scrollbar (e.g. the side scrollbar of a popup) must not steal focus from the field
// being edited; otherwise an open suggestion list closes as soon as the user tries to scroll.
document.addEventListener('mousedown', e => {
  const t = e.target;
  if (!(t instanceof HTMLElement) || t === document.documentElement || t === document.body) return;
  const r = t.getBoundingClientRect();
  const sbW = t.offsetWidth - t.clientWidth - (parseFloat(getComputedStyle(t).borderLeftWidth) || 0) - (parseFloat(getComputedStyle(t).borderRightWidth) || 0);
  const sbH = t.offsetHeight - t.clientHeight - (parseFloat(getComputedStyle(t).borderTopWidth) || 0) - (parseFloat(getComputedStyle(t).borderBottomWidth) || 0);
  const onV = sbW > 0 && e.clientX >= r.right - sbW - 1;
  const onH = sbH > 0 && e.clientY >= r.bottom - sbH - 1;
  if (onV || onH) e.preventDefault(); // scrolling still works; focus stays where it was
}, true);

const pathOf = hsh => String(hsh || '').replace(/^#/, '').split('?')[0];
/** Reflect an overlay in the URL (#/invoices/12) and restore the previous hash when it closes. */
function hashCtl(hash) {
  if (!hash) return { restore() { } };
  const prev = pathOf(location.hash) === pathOf(hash) ? '#' + getBase() : (location.hash || '#' + getBase());
  setHashSilently(hash);
  return { restore() { if (pathOf(location.hash) === pathOf(hash)) setHashSilently(prev); } };
}
function syncBody() {
  document.body.classList.toggle('modal-open', stack.length > 0);
}

function makeEntry(kind, { el, panel, onClose, guard, hash }) {
  const prevFocus = document.activeElement;
  let resolve; const result = new Promise(r => (resolve = r));
  const hc = hashCtl(hash);
  const api = {
    kind, el, panel, result, closed: false, dirty: false,
    close(r, { silent } = {}) {
      if (api.closed) return; api.closed = true;
      const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
      el.classList.add('out'); setTimeout(() => el.remove(), 180);
      syncBody();
      if (!silent) hc.restore();
      onClose && onClose(r);
      resolve(r);
      if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    },
    /** Close requested by the user (✕ / Esc / backdrop): ask first when the form has unsaved edits. */
    async request() {
      if (api.closed || api.asking) return;
      if (guard && api.dirty) {
        api.asking = true;
        const ok = await confirmDialog('You have unsaved changes. Discard them?', { title: 'Discard changes?', okText: 'Discard', cancelText: 'Keep editing', danger: true });
        api.asking = false;
        if (!ok) return;
      }
      api.close(null);
    },
    markClean() { api.dirty = false; },
  };
  if (guard) {
    const mark = e => { if (!e.target.closest('[data-noguard]')) api.dirty = true; };
    panel.addEventListener('input', mark); panel.addEventListener('change', mark);
  }
  stack.push(api);
  document.body.appendChild(el);
  syncBody();
  return api;
}

/**
 * openModal({title, head, body, footer, size, cls, guard, hash}) → { el, panel, body, close(result), request(), result }
 * size: sm | md | lg | xl. guard: confirm "Discard changes?" on ✕/Esc/backdrop when edited.
 */
export function openModal({ title, head, body, footer, size = 'md', cls = '', onClose, closeOnBackdrop = true, guard = false, hash, focus = true } = {}) {
  const titleId = 'mt' + Math.random().toString(36).slice(2, 8);
  const bodyEl = h('div', { class: 'm-body' }, body);
  const xBtn = h('button', { type: 'button', class: 'ibtn m-x', 'aria-label': 'Close dialog', title: 'Close (Esc)' }, ic('x', 18));
  const panel = h('div', { class: `m-panel ${size} ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'm-head' }, h('h2', { id: titleId }, title), head ? h('div', { class: 'm-head-x' }, head) : null, xBtn),
    bodyEl,
    footer ? h('div', { class: 'm-foot' }, footer) : null);
  const el = h('div', { class: 'm-overlay' }, panel);
  const api = makeEntry('modal', { el, panel, onClose, guard, hash });
  api.body = bodyEl;
  api.setFooter = nodes => { const f = panel.querySelector('.m-foot'); if (f) f.replaceChildren(...nodes); };
  xBtn.addEventListener('click', () => api.request());
  if (closeOnBackdrop) {
    let downOnBackdrop = false;
    el.addEventListener('mousedown', e => { downOnBackdrop = e.target === el; });
    el.addEventListener('click', e => { if (downOnBackdrop && e.target === el) api.request(); });
  }
  if (focus) requestAnimationFrame(() => {
    const first = panel.querySelector('[autofocus]') || panel.querySelector('.m-body input:not([type=hidden]):not([type=checkbox]), .m-body select, .m-body textarea') || panel.querySelector(FOCUSABLE);
    (first || panel).focus?.({ preventScroll: true });
  });
  return api;
}

/**
 * Right slide-over drawer for viewing a record. Only one drawer at a time (opening another replaces it).
 * render(api) → { title, sub, badge, actions, body } (may be async). api.refresh() re-renders in place.
 */
export function openDrawer({ render, hash, label = 'Details', size = '' }) {
  const old = stack.find(x => x.kind === 'drawer');
  if (old) { while (stack.length && stack[stack.length - 1] !== old) stack[stack.length - 1].close(null, { silent: true }); old.close(null); }
  const titleId = 'dt' + Math.random().toString(36).slice(2, 8);
  const head = h('div', { class: 'dw-head' });
  const bar = h('div', { class: 'dw-bar' });
  const bodyEl = h('div', { class: 'dw-body' }, skeleton(5, { head: false }));
  const xBtn = h('button', { type: 'button', class: 'ibtn dw-x', 'aria-label': 'Close panel', title: 'Close (Esc)' }, ic('x', 18));
  const panel = h('aside', { class: 'dw-panel ' + size, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, 'aria-label': label, tabindex: '-1' },
    h('div', { class: 'dw-top' }, head, xBtn), bar, bodyEl);
  const el = h('div', { class: 'dw-overlay' }, panel);
  const api = makeEntry('drawer', { el, panel, hash });
  xBtn.addEventListener('click', () => api.request());
  el.addEventListener('mousedown', e => { if (e.target === el) api.request(); });
  let seq = 0;
  api.refresh = async () => {
    const my = ++seq; const y = bodyEl.scrollTop;
    try {
      const r = await render(api);
      if (my !== seq || api.closed) return;
      if (!r) { api.close(null); return; }
      mount(head, h('div', { class: 'dw-title' }, h('h2', { id: titleId }, r.title, r.badge ? [' ', r.badge] : null), r.sub ? h('p', { class: 'dw-sub' }, r.sub) : null));
      mount(bar, r.actions || null); bar.hidden = !r.actions;
      mount(bodyEl, r.body); bodyEl.scrollTop = y;
    } catch (e) {
      console.error(e);
      mount(bodyEl, h('div', { class: 'form-error' }, errMsg(e)));
    }
  };
  api.refresh().then(() => { if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true }); });
  return api;
}
export function currentDrawer() { return stack.find(x => x.kind === 'drawer' && !x.closed) || null; }
export function refreshDrawer() { const d = currentDrawer(); if (d) d.refresh(); }
export function closeDrawerPanel() { const d = currentDrawer(); if (d) { while (stack.length && stack[stack.length - 1] !== d) stack[stack.length - 1].close(null, { silent: true }); d.close(null); } }
export function closeAllModals() { while (stack.length) stack[stack.length - 1].close(null, { silent: true }); }
export function overlayOpen() { return stack.length > 0; }

export function confirmDialog(message, { title = 'Please confirm', okText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  let m;
  const ok = btn(okText, () => m.close(true), { cls: danger ? 'danger' : 'gold' });
  m = openModal({
    title, size: 'sm', focus: false,
    body: h('p', { class: 'confirm-text' }, message),
    footer: [btn(cancelText, () => m.close(false)), ok],
  });
  setTimeout(() => ok.focus(), 30);
  return m.result.then(r => !!r);
}

/** Run an async action while a button shows a busy state. */
export async function busy(button, fn) {
  if (button) { button.disabled = true; button.classList.add('busy'); }
  try { return await fn(); }
  finally { if (button) { button.disabled = false; button.classList.remove('busy'); } }
}

// ---------- Popover menu ----------
let openMenu = null;
export function popMenu(anchor, items, { align = 'right' } = {}) {
  closeMenu();
  const menu = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map(it => it === '-' ? h('div', { class: 'menu-sep', role: 'separator' }) :
      it.label && !it.onClick ? h('div', { class: 'menu-lbl' }, it.label, it.sub ? h('small', null, it.sub) : null) :
        h('button', { type: 'button', role: 'menuitem', class: 'menu-it ' + (it.cls || ''), onclick: () => { closeMenu(); it.onClick(); } },
          it.icon ? h('span', { 'aria-hidden': 'true', class: 'mi' }, ic(it.icon, 15)) : null, it.text, it.kbd ? h('kbd', null, it.kbd) : null)));
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mh = menu.offsetHeight;
  const top = r.bottom + 6 + mh > window.innerHeight - 8 ? Math.max(8, r.top - 6 - mh) : r.bottom + 6;
  menu.style.top = top + 'px';
  if (align === 'left') menu.style.left = Math.max(8, r.left) + 'px';
  else menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
  openMenu = { menu, anchor };
  anchor.setAttribute('aria-expanded', 'true');
  menu.querySelector('button')?.focus();
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
  menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); anchor.focus(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const b = [...menu.querySelectorAll('button')]; const i = b.indexOf(document.activeElement);
      b[(i + (e.key === 'ArrowDown' ? 1 : -1) + b.length) % b.length]?.focus();
    }
  });
}
function outside(e) { if (openMenu && !openMenu.menu.contains(e.target) && !openMenu.anchor.contains(e.target)) closeMenu(); }
export function closeMenu() {
  if (!openMenu) return;
  openMenu.anchor.setAttribute('aria-expanded', 'false');
  openMenu.menu.remove(); openMenu = null;
  document.removeEventListener('mousedown', outside);
}
