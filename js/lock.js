// App lock (PIN) — per device + company. Stored in localStorage as { v, salt, hash, len, idle } where
// hash = SHA-256(salt + ":" + pin) in hex and salt = 16 random bytes. The PIN itself is never stored.
// This is a convenience screen lock for a shared device; it is not encryption (data access is still protected by RLS).
import { h, mount, ic, btn } from './dom.js';
import { initials } from './util.js';

export const IDLE_CHOICES = [5, 15, 30, 60];
const KEY = companyId => 'sm_pin_' + (companyId || 'none');
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

export const validPin = pin => /^\d{4,6}$/.test(String(pin || ''));
export async function hashPin(pin, salt) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`))); }
export function newSalt() { const a = new Uint8Array(16); crypto.getRandomValues(a); return hex(a); }

/** Build the stored record (no plain PIN inside). */
export async function makePinRecord(pin, idle = 15) {
  if (!validPin(pin)) throw new Error('PIN must be 4 to 6 digits.');
  const salt = newSalt();
  return { v: 1, salt, hash: await hashPin(pin, salt), len: String(pin).length, idle: IDLE_CHOICES.includes(Number(idle)) ? Number(idle) : 15 };
}
/** Constant-time-ish compare of the computed hash with the stored one. */
export async function verifyPin(rec, pin) {
  if (!rec || !rec.salt || !rec.hash || !validPin(pin)) return false;
  const got = await hashPin(pin, rec.salt);
  let diff = got.length ^ rec.hash.length;
  for (let i = 0; i < Math.min(got.length, rec.hash.length); i++) diff |= got.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

export function getPin(companyId) {
  try { const r = JSON.parse(localStorage.getItem(KEY(companyId)) || 'null'); return r && r.hash && r.salt ? r : null; } catch { return null; }
}
export async function setPin(companyId, pin, idle) { const rec = await makePinRecord(pin, idle); localStorage.setItem(KEY(companyId), JSON.stringify(rec)); return rec; }
export function setIdle(companyId, idle) { const r = getPin(companyId); if (r) { r.idle = Number(idle); localStorage.setItem(KEY(companyId), JSON.stringify(r)); } }
export function clearPin(companyId) { try { localStorage.removeItem(KEY(companyId)); } catch { /* ignore */ } }
/** Sign-out clears every lock on this device. */
export function clearAllPins() { try { Object.keys(localStorage).filter(k => k.startsWith('sm_pin_')).forEach(k => localStorage.removeItem(k)); } catch { /* ignore */ } }

// ---------- lock screen ----------
let ctx = null; // { companyId, name, onForgot, locked, el, last, timer }
const ACT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];
function touch() { if (ctx && !ctx.locked) ctx.last = Date.now(); }

/** Start the lock for this company: locks immediately (app open) when a PIN is set, then after N idle minutes. */
export function initLock({ companyId, name, onForgot, lockNow = true }) {
  ctx = { companyId, name, onForgot, locked: false, el: null, last: Date.now(), timer: null };
  ACT_EVENTS.forEach(e => window.addEventListener(e, touch, { passive: true, capture: true }));
  const check = () => {
    const rec = getPin(ctx.companyId);
    if (!rec || ctx.locked) return;
    if (Date.now() - ctx.last >= rec.idle * 60000) lock();
  };
  ctx.timer = setInterval(check, 15000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  if (lockNow && getPin(companyId)) lock();
}
export const isLocked = () => !!ctx?.locked;

export function lock() {
  if (!ctx || ctx.locked || !getPin(ctx.companyId)) return;
  ctx.locked = true;
  const rec = getPin(ctx.companyId);
  const prevFocus = document.activeElement;
  const dots = h('div', { class: 'pin-dots', 'aria-hidden': 'true' });
  const msg = h('p', { class: 'pin-msg', role: 'alert', 'aria-live': 'assertive' });
  const inp = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '6', pattern: '[0-9]*', class: 'inp pin-inp', 'aria-label': `Enter your ${rec.len || 4}-digit PIN`, id: 'pin-inp' });
  let fails = 0; let waitUntil = 0; let checking = false;
  const drawDots = () => mount(dots, Array.from({ length: rec.len || 4 }, (_, i) => h('i', { class: i < inp.value.length ? 'on' : '' })));
  async function attempt() {
    if (checking) return;
    const v = inp.value.replace(/\D/g, '');
    if (Date.now() < waitUntil) { msg.textContent = `Too many tries. Wait ${Math.ceil((waitUntil - Date.now()) / 1000)} s.`; return; }
    if (!validPin(v)) { msg.textContent = 'Enter 4 to 6 digits.'; return; }
    checking = true;
    const ok = await verifyPin(getPin(ctx.companyId), v);
    checking = false;
    if (ok) { unlock(); if (prevFocus?.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); return; }
    fails++; inp.value = ''; drawDots();
    el.querySelector('.pin-card').classList.remove('shake'); void el.offsetWidth; el.querySelector('.pin-card').classList.add('shake');
    if (fails >= 5) { waitUntil = Date.now() + 30000; fails = 0; msg.textContent = 'Wrong PIN 5 times. Try again in 30 s, or use Forgot PIN.'; }
    else msg.textContent = `Wrong PIN. ${5 - fails} ${5 - fails === 1 ? 'try' : 'tries'} left before a short wait.`;
    inp.focus();
  }
  inp.addEventListener('input', () => {
    inp.value = inp.value.replace(/\D/g, '').slice(0, 6); drawDots(); msg.textContent = '';
    if (rec.len && inp.value.length === rec.len) attempt();
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } e.stopPropagation(); });
  const key = (label, fn, aria) => h('button', { type: 'button', class: 'pin-key', 'aria-label': aria || label, onclick: () => { fn(); inp.focus({ preventScroll: true }); } }, label);
  const press = d => { if (inp.value.length < 6) { inp.value += d; inp.dispatchEvent(new Event('input')); } };
  const pad = h('div', { class: 'pin-pad' },
    ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => key(d, () => press(d))),
    h('span'), key('0', () => press('0')),
    h('button', { type: 'button', class: 'pin-key pin-del', 'aria-label': 'Delete last digit', onclick: () => { inp.value = inp.value.slice(0, -1); drawDots(); inp.focus({ preventScroll: true }); } }, ic('chevronLeft', 18)));
  const forgot = h('button', { type: 'button', class: 'lnk pin-forgot', onclick: async () => {
    const { confirmDialog } = await import('./ui.js');
    if (!(await confirmDialog('Forgot your PIN? You will be signed out and the lock is removed from this device. Sign in again with Google to continue.', { title: 'Forgot PIN', okText: 'Sign out', danger: true }))) return;
    clearPin(ctx.companyId); ctx.onForgot && ctx.onForgot();
  } }, 'Forgot PIN? Sign out');
  const el = h('div', { class: 'lock-screen', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lock-t' },
    h('div', { class: 'pin-card' },
      h('div', { class: 'logo', 'aria-hidden': 'true' }, ic('lock', 22)),
      h('h1', { id: 'lock-t' }, 'Studio locked'),
      h('p', { class: 'pin-co' }, h('span', { class: 'mini-av sm', 'aria-hidden': 'true' }, initials(ctx.name, 'SM')), ctx.name || 'Studio Manager'),
      h('label', { for: 'pin-inp', class: 'pin-lbl' }, `Enter your ${rec.len || 4}-digit PIN`),
      dots, inp, msg, pad,
      btn('Unlock', attempt, { cls: 'gold pin-go', icon: 'check' }),
      forgot));
  // Keep keyboard focus inside the lock screen.
  el.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...el.querySelectorAll('button,input')]; const i = f.indexOf(document.activeElement);
    e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  });
  document.body.appendChild(el);
  document.body.classList.add('locked');
  drawDots();
  ctx.el = el;
  setTimeout(() => inp.focus(), 30);
}
export function unlock() {
  if (!ctx?.locked) return;
  ctx.el?.remove(); ctx.el = null; ctx.locked = false; ctx.last = Date.now();
  document.body.classList.remove('locked');
}
