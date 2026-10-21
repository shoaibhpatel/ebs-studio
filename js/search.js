// Global search (Ctrl+K): customers, invoices, quotations, projects by name / number / mobile.
import { h, mount, input } from './dom.js';
import { openModal } from './ui.js';
import { lookups, all } from './store.js';
import { money, includesCI, cap } from './util.js';

let open = null;
export async function openSearch() {
  if (open && !open.closed) { open.panel.querySelector('input')?.focus(); return; }
  const q = input({ type: 'search', placeholder: 'Type a name, invoice number or mobile…', 'aria-label': 'Search', autocomplete: 'off', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'sr-results' });
  const list = h('div', { class: 'sr-list', id: 'sr-results', role: 'listbox', 'aria-label': 'Search results' });
  open = openModal({ title: 'Search', size: 'md', body: [q, list] });
  let data = null; let items = []; let sel = 0;
  try {
    const L = await lookups(); const quotes = await all('quotations');
    const [albums, vendors] = await Promise.all([all('album_orders').catch(() => []), all('vendors').catch(() => [])]);
    data = { ...L, quotes, albums, vendors };
  } catch { mount(list, h('p', { class: 'muted' }, 'Search is not available right now.')); return; }

  const digits = s => String(s || '').replace(/\D/g, '');
  function run() {
    const t = q.value.trim(); const d = digits(t);
    const m = (s) => includesCI(s, t);
    const mobile = (c) => d.length >= 3 && (digits(c.mobile).includes(d) || digits(c.whatsapp).includes(d));
    const res = [];
    if (t) {
      const cs = data.customers.filter(c => m(c.name) || m(c.email) || m(c.city) || mobile(c)).slice(0, 6);
      if (cs.length) res.push(['Customers', cs.map(c => ({ title: c.name, sub: [c.mobile, c.city].filter(Boolean).join(' · '), kind: 'customer', id: c.id }))]);
      // Invoices: match number, customer name/mobile, and the per-document party name.
      const iv = data.invoices.filter(i => m(i.number) || m(i.party_name) || m(data.cname(i.customer_id)) || mobile(data.cMap.get(i.customer_id) || {})).slice(0, 8);
      if (iv.length) res.push(['Invoices', iv.map(i => ({
        title: [`Invoice ${i.number}`, i.party_name].filter(Boolean).join(' · '),
        sub: `${data.cname(i.customer_id)} · ${money(i.total)} · ${cap(i.status)}`, kind: 'invoice', id: i.id,
      }))]);
      const qs = data.quotes.filter(x => m(x.number) || m(x.party_name) || m(data.cMap.get(x.customer_id)?.name || x.guest_name)).slice(0, 8);
      if (qs.length) res.push(['Quotations', qs.map(x => ({
        title: [`Quotation ${x.number}`, x.party_name].filter(Boolean).join(' · '),
        sub: `${data.cMap.get(x.customer_id)?.name || x.guest_name || 'Guest'} · ${money(x.total)} · ${cap(x.status || 'draft')}`, kind: 'quotation', id: x.id,
      }))]);
      const ps = data.projects.filter(p => m(p.name) || m(p.type) || m(data.cname(p.customer_id))).slice(0, 6);
      if (ps.length) res.push(['Projects', ps.map(p => ({ title: p.name, sub: `${data.cname(p.customer_id)} · ${p.type || ''}`, kind: 'project', id: p.id }))]);
      const al = data.albums.filter(a => m(a.title) || m(data.cname(a.customer_id))).slice(0, 4);
      if (al.length) res.push(['Albums', al.map(a => ({ title: a.title || 'Album', sub: [data.cname(a.customer_id), a.sheets ? `${a.sheets} sheets` : null, a.size].filter(Boolean).join(' · '), kind: 'album', id: a.id }))]);
      const vs = data.vendors.filter(v => m(v.name) || m(v.kind) || (d.length >= 3 && digits(v.phone).includes(d))).slice(0, 4);
      if (vs.length) res.push(['Vendors', vs.map(v => ({ title: v.name, sub: [v.kind, v.phone].filter(Boolean).join(' · '), kind: 'vendor', id: v.id }))]);
    }
    items = res.flatMap(([, arr]) => arr); sel = 0;
    let idx = 0;
    mount(list, !t ? h('p', { class: 'muted small', style: { padding: '8px' } }, 'Search by customer name, mobile number, invoice / quotation number or project.')
      : !items.length ? h('p', { class: 'muted', style: { padding: '8px' } }, 'No matches.')
        : res.map(([g, arr]) => [h('div', { class: 'sr-group', role: 'presentation' }, g), arr.map(it => {
          const i = idx++;
          return h('button', { type: 'button', class: 'sr-item', role: 'option', id: 'sr-' + i, 'aria-selected': String(i === sel), onclick: () => go(it) },
            h('span', null, it.title), h('small', null, it.sub));
        })]));
    q.setAttribute('aria-activedescendant', items.length ? 'sr-0' : '');
  }
  function mark() {
    list.querySelectorAll('.sr-item').forEach((b, i) => b.setAttribute('aria-selected', String(i === sel)));
    const cur = list.querySelector(`#sr-${sel}`); cur?.scrollIntoView({ block: 'nearest' });
    q.setAttribute('aria-activedescendant', cur ? cur.id : '');
  }
  function go(it) { open.close(); import('./pages/common.js').then(m => m.openRecord(it.kind, it.id)); }
  q.addEventListener('input', run);
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter' && items[sel]) { e.preventDefault(); go(items[sel]); }
  });
  run();
  q.focus();
}
