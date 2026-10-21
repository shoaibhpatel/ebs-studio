// Tiny DOM helper. All user data goes through textContent / properties, never innerHTML.
import { icon, hasIcon } from './icons.js';

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'multiple', 'indeterminate']);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);
let idSeq = 0;
export const nextId = (p = 'f') => `${p}${++idSeq}`;

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) if (sv != null) el.style.setProperty(sk.startsWith('--') ? sk : sk.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), String(sv));
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k.startsWith('on')) continue; // never allow string event handlers
      else if (PROPS.has(k)) el[k] = v;
      else if (k === 'ref' && typeof v === 'function') v(el);
      else if (URL_ATTRS.has(k)) {
        const s = String(v);
        if (/^\s*(javascript|vbscript|data:text\/html)/i.test(s)) continue;
        el.setAttribute(k, s);
      }
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export function mount(el, ...children) { clear(el); append(el, children); return el; }
/** Icon by name (SVG) or a short text glyph fallback. */
export function ic(name, size = 16) { return hasIcon(name) ? icon(name, { size }) : h('span', { 'aria-hidden': 'true' }, name); }

// ---------- Form controls ----------
/** Labelled field. `control` is an input/select/textarea element. */
export function field(label, control, { hint, cls, required } = {}) {
  if (!control.id) control.id = nextId();
  if (required) control.required = true;
  return h('div', { class: ['field', cls] },
    h('label', { for: control.id }, label, required ? h('span', { class: 'req', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('small', { class: 'hint' }, hint) : null);
}
export function input(attrs = {}) { return h('input', { type: 'text', class: 'inp', ...attrs }); }
export function textarea(attrs = {}) { const { value, ...rest } = attrs; const t = h('textarea', { class: 'inp', rows: 3, ...rest }); t.value = value ?? ''; return t; }
/** options: array of [value, label] or strings. */
export function select(options, value, attrs = {}) {
  const s = h('select', { class: 'inp', ...attrs });
  for (const o of options) {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    s.appendChild(h('option', { value: v }, l));
  }
  s.value = value ?? (s.options[0]?.value ?? '');
  return s;
}
/** Search input with a leading icon. Returns the wrapper; the <input> is `.inp`. */
export function searchBox(attrs = {}) {
  const inp = input({ type: 'search', autocomplete: 'off', ...attrs, class: 'inp' });
  const wrap = h('div', { class: 'search-inp ' + (attrs.wrapCls || '') }, ic('search', 15), inp);
  wrap.input = inp;
  return wrap;
}
export function toggle(label, checked, attrs = {}) {
  const cb = h('input', { type: 'checkbox', class: 'sw-inp', checked: !!checked, ...attrs });
  if (!cb.id) cb.id = nextId('t');
  return { el: h('label', { class: 'switch', for: cb.id }, cb, h('span', { class: 'sw', 'aria-hidden': 'true' }), h('span', null, label)), input: cb };
}
export function btn(label, onClick, { cls = '', icon: ico, title, type = 'button', aria, disabled } = {}) {
  return h('button', { type, class: 'btn ' + cls, onclick: onClick, title, 'aria-label': aria, disabled },
    ico ? h('span', { class: 'bi', 'aria-hidden': 'true' }, ic(ico, 15)) : null, label);
}
export function iconBtn(ico, aria, onClick, cls = '') {
  return h('button', { type: 'button', class: 'ibtn ' + cls, 'aria-label': aria, title: aria, onclick: onClick }, ic(ico, 16));
}
export function pill(text, tone = 's1') { return h('span', { class: 'st ' + tone }, text); }
export function empty(text, action, { icon: ico = 'inbox', title } = {}) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic', 'aria-hidden': 'true' }, ic(ico, 22)),
    title ? h('b', null, title) : null, h('p', null, text), action || null);
}
export function card(title, body, actions, { cls = '' } = {}) {
  return h('section', { class: 'card ' + cls },
    title ? h('div', { class: 'ch' }, h('h3', null, title), actions ? h('div', { class: 'btns' }, actions) : null) : null,
    body);
}
/** Skeleton placeholder: n rows of shimmering bars. */
export function skeleton(rows = 6, { head = true } = {}) {
  return h('div', { class: 'skel', role: 'status', 'aria-label': 'Loading' },
    head ? h('div', { class: 'skel-head' }, h('i', { style: { width: '220px', height: '22px' } }), h('i', { style: { width: '140px', height: '34px' } })) : null,
    h('div', { class: 'card' }, h('div', { class: 'skel-bar' }, h('i', { style: { width: '40%' } })),
      Array.from({ length: rows }, (_, i) => h('div', { class: 'skel-row' }, h('i', { style: { width: (30 + (i * 17) % 40) + '%' } }), h('i', { style: { width: '12%' } }), h('i', { style: { width: '10%' } })))));
}

/**
 * Data table.
 * cols: [{label, cell:(row)=>node|string, cls, sort?: row => value}]
 * opts: { onRow, rowLabel, emptyText, emptyAction, actions: row => nodes (hover quick actions), sort: {key, dir} (persisted by caller), rowCls }
 */
export function table(cols, rows, opts = {}) {
  const { onRow, rowLabel, emptyText = 'Nothing here yet.', emptyAction, actions, rowCls } = opts;
  cols = cols.filter(Boolean);
  if (!rows.length) return empty(emptyText, emptyAction);
  const sort = opts.sort || {};
  const wrap = h('div', { class: 'tbl-wrap' });
  const draw = () => {
    let list = rows;
    const sc = cols.find(c => c.sort && c.label === sort.key);
    if (sc) {
      list = rows.slice().sort((a, b) => {
        const x = sc.sort(a), y = sc.sort(b);
        const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true });
        return r * (sort.dir || 1);
      });
    }
    const th = c => {
      if (!c.sort) return h('th', { class: c.cls, scope: 'col' }, c.label);
      const on = sort.key === c.label;
      return h('th', { class: [c.cls, 'sortable', on ? 'on' : ''], scope: 'col', 'aria-sort': on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
        h('button', {
          type: 'button', class: 'th-btn', onclick: () => { if (sort.key === c.label) sort.dir = -(sort.dir || 1); else { sort.key = c.label; sort.dir = c.sortDir || 1; } draw(); },
        }, c.label, h('span', { class: 'sort-ic', 'aria-hidden': 'true' }, on ? (sort.dir > 0 ? '↑' : '↓') : '↕')));
    };
    mount(wrap, h('table', { class: 'tbl' + (actions ? ' has-act' : '') },
      h('thead', null, h('tr', null, cols.map(th), actions ? h('th', { class: 'act', scope: 'col' }, h('span', { class: 'sr-only' }, 'Actions')) : null)),
      h('tbody', null, list.map(r => {
        const tr = h('tr', { class: [onRow ? 'click' : null, rowCls ? rowCls(r) : null] },
          cols.map(c => h('td', { class: c.cls, 'data-label': c.label }, c.cell(r))),
          actions ? h('td', { class: 'act' }, h('div', { class: 'row-act' }, actions(r))) : null);
        if (onRow) {
          tr.tabIndex = 0;
          if (rowLabel) tr.setAttribute('aria-label', rowLabel(r));
          tr.addEventListener('click', e => { if (!e.target.closest('button,a,input,select,label')) onRow(r); });
          tr.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === tr) onRow(r); });
        }
        return tr;
      }))));
  };
  draw();
  return wrap;
}

/** Filter chips (single choice). items: [[value, label, count?]] */
export function chips(items, value, onPick, aria = 'Filter') {
  const host = h('div', { class: 'chips', role: 'group', 'aria-label': aria });
  const draw = (v) => mount(host, items.map(([val, label, count]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(v === val), onclick: () => { draw(val); onPick(val); },
  }, label, count != null ? h('span', { class: 'cnt' }, String(count)) : null)));
  draw(value);
  host.set = draw;
  return host;
}
