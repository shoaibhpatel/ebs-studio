// Supabase data layer. Same interface as demo-api.js.
// Only primitives live here; business flows (save invoice, record payment) live in store.js.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, CDN } from './config.js';

let sb = null;
let companyId = null;

function friendly(error) {
  if (!error) return new Error('Unknown error');
  const code = error.code || '';
  let msg = error.message || String(error);
  if (code === '23503') msg = 'This record is still used elsewhere (for example by projects, invoices or payments). Remove those first.';
  else if (code === '23505') msg = 'A record with the same value already exists.';
  else if (code === '42501' || /row-level security/i.test(msg)) msg = 'You do not have permission to do that.';
  else if (code === 'PGRST301' || /JWT expired/i.test(msg)) msg = 'Your session expired. Please sign in again.';
  const e = new Error(msg); e.code = code; e.raw = error; return e;
}
async function run(q) {
  const { data, error } = await q;
  if (error) throw friendly(error);
  return data;
}

const api = {
  mode: 'live',

  async init() {
    const { createClient } = await import(CDN.supabase);
    sb = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  },

  // ---------- Auth ----------
  async getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw friendly(error);
    const u = data.session?.user;
    if (!u) return null;
    return { user: { id: u.id, email: (u.email || '').toLowerCase(), name: u.user_metadata?.full_name || u.user_metadata?.name || '', avatar: u.user_metadata?.avatar_url || '' } };
  },
  onAuthChange(cb) { sb.auth.onAuthStateChange((event) => cb(event)); },
  async signInWithGoogle() {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) throw friendly(error);
  },
  async signOut() { await sb.auth.signOut(); },

  /** Returns { member, company } for the signed-in Gmail, or null. */
  async loadMembership(email) {
    const rows = await run(sb.from('members').select('*').eq('active', true));
    const member = rows.find(m => String(m.email || '').toLowerCase() === email) || null;
    if (!member) return null;
    const company = await run(sb.from('companies').select('*').eq('id', member.company_id).maybeSingle());
    if (!company) return null;
    companyId = company.id;
    return { member, company };
  },
  companyId: () => companyId,

  // ---------- CRUD primitives ----------
  async list(table, { eq, order, asc = false, select = '*' } = {}) {
    const out = []; const page = 1000;
    for (let from = 0; ; from += page) {
      let q = sb.from(table).select(select);
      if (eq) for (const [k, v] of Object.entries(eq)) q = v === null ? q.is(k, null) : q.eq(k, v);
      if (order) q = q.order(order, { ascending: asc, nullsFirst: false });
      q = q.order('id', { ascending: true }).range(from, from + page - 1);
      const rows = await run(q);
      out.push(...rows);
      if (rows.length < page) break;
    }
    return out;
  },
  async get(table, id) { return run(sb.from(table).select('*').eq('id', id).maybeSingle()); },
  async insert(table, row) {
    return run(sb.from(table).insert({ company_id: companyId, ...row }).select().single());
  },
  async insertMany(table, rows) {
    if (!rows.length) return [];
    return run(sb.from(table).insert(rows.map(r => ({ company_id: companyId, ...r }))).select());
  },
  async update(table, id, patch) { return run(sb.from(table).update(patch).eq('id', id).select().single()); },
  async remove(table, id) { await run(sb.from(table).delete().eq('id', id)); },
  async removeWhere(table, col, val) { await run(sb.from(table).delete().eq(col, val)); },
  async rpc(name, args = {}) { return run(sb.rpc(name, args)); },

  async updateCompany(patch) { return run(sb.from('companies').update(patch).eq('id', companyId).select().single()); },

  // ---------- Storage (private bucket "logos") ----------
  async uploadLogo(file) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${companyId}/logo.${ext}`;
    const { error } = await sb.storage.from('logos').upload(path, file, { upsert: true, contentType: file.type || 'image/png', cacheControl: '60' });
    if (error) throw friendly(error);
    return path;
  },
  async logoUrl(path) {
    if (!path) return null;
    // Public bucket → stable public URL (no expiry, CORS-safe) so the logo embeds in PDFs and shows
    // on the no-login invoice page. The ?v= busts the CDN cache after a logo is replaced.
    const { data } = sb.storage.from('logos').getPublicUrl(path);
    return data?.publicUrl ? data.publicUrl + '?v=' + Date.now() : null;
  },

  // ---------- Payment QR (public bucket "payqr") ----------
  // Stored public so it can be shown on the no-login invoice page and in PDFs. Returns a stable
  // public URL (with a cache-busting ?v= so a replaced QR shows immediately).
  async uploadPayQr(file) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${companyId}/qr.${ext}`;
    const { error } = await sb.storage.from('payqr').upload(path, file, { upsert: true, contentType: file.type || 'image/png', cacheControl: '60' });
    if (error) throw friendly(error);
    const { data } = sb.storage.from('payqr').getPublicUrl(path);
    return (data?.publicUrl || '') + '?v=' + Date.now();
  },
  async removePayQr(url) {
    if (!url) return;
    const path = url.split('/payqr/')[1]?.split('?')[0];
    if (path) { try { await sb.storage.from('payqr').remove([path]); } catch { /* best effort */ } }
  },
};

export default api;
