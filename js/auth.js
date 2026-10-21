// Google sign-in, session handling, membership gate.
import { h, mount, btn } from './dom.js';
import { api, state, setCompany, DEMO } from './store.js';
import { toast, errMsg, busy } from './ui.js';
import { clearAllPins } from './lock.js';

function gate(...children) { return h('div', { class: 'gate' }, h('div', { class: 'login' }, ...children)); }
const brandLogo = (txt = 'SM') => h('div', { class: 'logo', 'aria-hidden': 'true' }, txt);

export function renderLogin(root, error) {
  const go = btn('', async () => {
    await busy(go, async () => {
      try { await api.signInWithGoogle(); } catch (e) { toast(errMsg(e), 'error'); }
    });
  }, { cls: 'gbtn' });
  go.className = 'gbtn';
  go.replaceChildren(h('i', { 'aria-hidden': 'true' }), 'Continue with Google');
  mount(root, gate(
    brandLogo(),
    h('h1', { style: { fontSize: '18px', marginBottom: '6px' } }, 'Studio Manager'),
    h('p', null, 'Sign in with your Gmail to manage projects, invoices and payments.'),
    error ? h('div', { class: 'form-error', role: 'alert', style: { marginBottom: '14px' } }, error) : null,
    go,
    h('small', null, 'Only Gmail accounts added by the studio owner can sign in. Your data is private to your studio.'),
  ));
}

export function renderNotAdded(root, email) {
  mount(root, gate(
    brandLogo('!'),
    h('h1', { style: { fontSize: '18px', marginBottom: '6px' } }, 'Not added yet'),
    h('p', null, 'Your Gmail ', h('b', null, email || ''), ' is not added to any company. Ask the owner to add you, then sign in again.'),
    btn('Sign out', () => api.signOut().then(() => location.reload()), { cls: 'gold' }),
  ));
}

/** Returns true when signed in and a membership is loaded into `state`. Otherwise renders a gate screen. */
export async function authenticate(root) {
  // OAuth errors come back in the URL (query or hash)
  const qs = new URLSearchParams(location.search);
  const hs = new URLSearchParams(location.hash.replace(/^#/, ''));
  const oauthErr = qs.get('error_description') || hs.get('error_description');

  const session = await api.getSession();
  if (!session) { renderLogin(root, oauthErr); return false; }
  state.session = session;

  // Clean the ?code= left by the PKCE redirect
  if (qs.has('code')) { qs.delete('code'); history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash); }

  const ms = await api.loadMembership(session.user.email);
  if (!ms) { renderNotAdded(root, session.user.email); return false; }
  state.member = ms.member;
  setCompany(ms.company);
  if (!DEMO) api.onAuthChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
  return true;
}

export async function signOut() {
  clearAllPins(); // signing out always removes the app lock on this device
  try { await api.signOut(); } finally { if (!DEMO) location.reload(); }
}
