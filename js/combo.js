// Accessible combobox / type-ahead (ARIA 1.2 combobox + listbox). Used for customer pickers and item suggestions.
import { h, mount, ic } from './dom.js';

let seq = 0;

/** Text with the matched part wrapped in <mark> (text nodes only). */
export function highlight(text, q) {
  const s = String(text || ''); const t = String(q || '').trim();
  if (!t) return s;
  const i = s.toLowerCase().indexOf(t.toLowerCase());
  if (i < 0) return s;
  return [s.slice(0, i), h('mark', null, s.slice(i, i + t.length)), s.slice(i + t.length)];
}

/**
 * attachCombo(input, {
 *   source(q) → [{ key, label, sub?, right?, tag?, data }],
 *   extra(q)  → [{ key, label, icon?, action: true, data }]   (e.g. "+ New customer", "+ Save as new item")
 *   onPick(option, q), openOnFocus, minChars, label
 * })
 * Returns { open(), close(), isOpen(), refresh() }.
 */
export function attachCombo(inp, { source, extra, onPick, openOnFocus = true, minChars = 0, label = 'Suggestions', maxHeight } = {}) {
  const id = 'cb' + (++seq);
  const list = h('div', { class: 'cb-list', role: 'listbox', id, 'aria-label': label, hidden: true });
  if (maxHeight) list.style.maxHeight = maxHeight;
  // Clicking/dragging the list's own scrollbar (or empty space in it) must not take focus away
  // from the input — otherwise blur closes the list mid-scroll.
  let pointerInList = false;
  list.addEventListener('pointerdown', e => { pointerInList = true; e.preventDefault(); });
  list.addEventListener('mousedown', e => e.preventDefault());
  document.addEventListener('pointerup', () => { if (pointerInList) { pointerInList = false; if (openState && document.activeElement !== inp) inp.focus({ preventScroll: true }); } });
  const wrap = inp.parentElement;
  wrap.classList.add('cb-wrap');
  wrap.appendChild(list);
  inp.setAttribute('role', 'combobox');
  inp.setAttribute('aria-autocomplete', 'list');
  inp.setAttribute('aria-expanded', 'false');
  inp.setAttribute('aria-controls', id);
  inp.setAttribute('autocomplete', 'off');
  let opts = []; let sel = -1; let openState = false;

  function render() {
    const q = inp.value;
    const main = q.trim().length >= minChars ? (source(q) || []) : [];
    const ex = (extra && extra(q)) || [];
    opts = [...main, ...ex];
    if (!opts.length) { close(); return; }
    sel = main.length ? 0 : -1;
    mount(list, opts.map((o, i) => h('div', {
      class: 'cb-opt' + (o.action ? ' cb-action' : ''), role: 'option', id: `${id}-${i}`, 'aria-selected': String(i === sel),
      onmousedown: e => e.preventDefault(), onclick: () => pick(i),
    },
      o.action ? h('span', { class: 'cb-ic' }, ic(o.icon || 'plus', 14)) : null,
      h('span', { class: 'cb-main' }, h('span', { class: 'cb-l' }, o.action ? o.label : highlight(o.label, q)), o.sub ? h('small', null, o.sub) : null),
      o.tag ? h('span', { class: 'cb-tag' }, o.tag) : null,
      o.right != null ? h('span', { class: 'cb-r' }, o.right) : null)));
    list.hidden = false; openState = true;
    inp.setAttribute('aria-expanded', 'true');
    mark();
  }
  function mark() {
    list.querySelectorAll('.cb-opt').forEach((el, i) => el.setAttribute('aria-selected', String(i === sel)));
    const cur = sel >= 0 ? list.querySelector(`#${id}-${sel}`) : null;
    cur?.scrollIntoView({ block: 'nearest' });
    if (cur) inp.setAttribute('aria-activedescendant', cur.id); else inp.removeAttribute('aria-activedescendant');
  }
  function close() {
    list.hidden = true; openState = false; sel = -1;
    inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant');
  }
  function pick(i) {
    const o = opts[i]; if (!o) return;
    const q = inp.value;
    close();
    onPick && onPick(o, q);
  }
  inp.addEventListener('input', render);
  inp.addEventListener('focus', () => { if (openOnFocus) render(); });
  inp.addEventListener('blur', () => setTimeout(() => {
    if (pointerInList || document.activeElement === inp || list.contains(document.activeElement)) return;
    close();
  }, 120));
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!openState) render(); else { sel = Math.min(opts.length - 1, sel + 1); mark(); } }
    else if (e.key === 'ArrowUp') { if (openState) { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); } }
    else if (e.key === 'Enter' && openState && sel >= 0) { e.preventDefault(); e.stopPropagation(); e.comboPicked = true; pick(sel); }
    else if (e.key === 'Escape' && openState) { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
  return { open: render, close, isOpen: () => openState, refresh: () => { if (openState) render(); } };
}
