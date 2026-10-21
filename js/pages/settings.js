import { h, mount, card, field, input, textarea, btn, iconBtn, toggle, select, ic } from '../dom.js';
import { toast, errMsg, busy, confirmDialog } from '../ui.js';
import { api, state, saveCompany, refreshLogo, DEMO, createCompany } from '../store.js';
import { getPin, setPin, setIdle, clearPin, verifyPin, validPin, lock, IDLE_CHOICES } from '../lock.js';
import { DEFAULT_PROJECT_TYPES, SHORTCUTS, SHORTCUTS_EXTRA } from '../config.js';
import { initials, money } from '../util.js';
import { refreshBrand } from '../app.js';
import { pageHead } from './common.js';
import { packagesCard } from './packages.js';

const MAX_LOGO = 2 * 1024 * 1024;

// ---------- App lock (PIN) card ----------
function pinCard() {
  const host = h('div');
  const cid = state.company?.id;
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const idleSel = () => {
    const rec = getPin(cid);
    const s = select(IDLE_CHOICES.map(n => [String(n), `${n} minutes`]), String(rec?.idle || 15), { 'aria-label': 'Lock after idle time' });
    return s;
  };
  function form(change) {
    const p1 = input({ type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-lpignore': 'true', maxlength: '6', placeholder: '4–6 digits', class: 'inp pin-field' });
    const p2 = input({ type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-lpignore': 'true', maxlength: '6', placeholder: 'Repeat PIN', class: 'inp pin-field' });
    [p1, p2].forEach(x => x.addEventListener('input', () => { x.value = x.value.replace(/\D/g, '').slice(0, 6); }));
    const idle = idleSel();
    const go = btn(change ? 'Save new PIN' : 'Turn on app lock', async () => {
      errBox.textContent = '';
      if (!validPin(p1.value)) { errBox.textContent = 'PIN must be 4 to 6 digits.'; p1.focus(); return; }
      if (p1.value !== p2.value) { errBox.textContent = 'The two PINs do not match.'; p2.focus(); return; }
      await busy(go, async () => {
        try { await setPin(cid, p1.value, Number(idle.value)); p1.value = p2.value = ''; toast(change ? 'PIN changed' : 'App lock is on for this device', 'success'); draw(); }
        catch (e) { errBox.textContent = errMsg(e); }
      });
    }, { cls: 'gold', icon: 'lock' });
    return [h('div', { class: 'form-grid g3' }, field(change ? 'New PIN' : 'PIN', p1), field('Confirm PIN', p2), field('Lock after', idle, { hint: 'Idle time' })),
      h('div', { class: 'btns', style: { marginTop: '12px' } }, go, change ? btn('Cancel', () => draw(), { cls: 'ghost' }) : null)];
  }
  function draw(mode) {
    errBox.textContent = '';
    const rec = getPin(cid);
    if (!rec || mode === 'change') {
      mount(host, h('p', { class: 'dim small', style: { marginBottom: '12px' } }, rec ? 'Enter a new PIN for this device.' : 'Ask for a PIN when the app opens on this device and after it sits idle. Handy on a shared studio computer or phone.'), errBox, form(!!rec));
      return;
    }
    const idle = idleSel();
    idle.addEventListener('change', () => { setIdle(cid, Number(idle.value)); toast(`Locks after ${idle.value} minutes idle`, 'success'); });
    const offPin = input({ type: 'text', inputmode: 'numeric', autocomplete: 'off', 'data-lpignore': 'true', maxlength: '6', placeholder: 'Current PIN', class: 'inp pin-field', 'aria-label': 'Current PIN to turn off the lock' });
    offPin.addEventListener('input', () => { offPin.value = offPin.value.replace(/\D/g, '').slice(0, 6); });
    const off = btn('Turn off', async () => {
      errBox.textContent = '';
      if (!(await verifyPin(getPin(cid), offPin.value))) { errBox.textContent = 'That PIN is not correct.'; offPin.focus(); return; }
      clearPin(cid); toast('App lock turned off', 'success'); draw();
    }, { cls: 'ghost danger' });
    mount(host,
      h('div', { class: 'pin-on' }, h('span', { class: 'pin-ic', 'aria-hidden': 'true' }, ic('lock', 16)), h('div', null, h('b', null, 'App lock is on for this device'), h('small', null, `${rec.len}-digit PIN · stored only as a salted SHA-256 hash`))),
      errBox,
      h('div', { class: 'form-grid', style: { marginTop: '12px' } }, field('Lock after', idle, { hint: 'Idle time before the lock screen shows' }),
        h('div', { class: 'field' }, h('span', { class: 'flbl' }, 'Turn off'), h('div', { class: 'with-btn' }, offPin, off))),
      h('div', { class: 'btns', style: { marginTop: '12px' } }, btn('Lock now', () => lock(), { icon: 'lock' }), btn('Change PIN', () => draw('change'), { cls: 'ghost' })));
  }
  draw();
  return [host, h('p', { class: 'dim small', style: { marginTop: '10px' } }, 'Forgot the PIN? Use “Forgot PIN” on the lock screen — it signs you out and removes the lock. Signing out always removes it. The PIN is per device and never leaves it.')];
}

// ---------- New company card ----------
function newCompanyCard() {
  const name = input({ placeholder: 'e.g. Second Studio', autocomplete: 'off' });
  const email = input({ type: 'email', inputmode: 'email', placeholder: 'owner@gmail.com', autocomplete: 'off' });
  const errBox = h('div', { class: 'form-error', role: 'alert' });
  const done = h('div', { class: 'info-box', hidden: true, role: 'status' });
  const go = btn('Create company', async () => {
    errBox.textContent = ''; done.hidden = true;
    const n = name.value.trim(); const em = email.value.trim().toLowerCase();
    if (!n) { errBox.textContent = 'Enter the new company name.'; name.focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { errBox.textContent = 'Enter the owner’s Gmail address.'; email.focus(); return; }
    if (em === String(state.member?.email || '').toLowerCase()) { errBox.textContent = 'This Gmail already belongs to this company. Use the new owner’s Gmail.'; email.focus(); return; }
    const ok = await confirmDialog(`Create “${n}” with owner ${em}? This creates a completely separate company. You will not be able to see its data; the owner logs in with this Gmail.`, { title: 'Create a separate company?', okText: 'Create company', danger: true });
    if (!ok) return;
    await busy(go, async () => {
      try {
        await createCompany(n, em);
        done.hidden = false; mount(done, ic('check', 14), ' ', h('b', null, n), ` created. Ask ${em} to open this app and continue with Google.`);
        name.value = ''; email.value = '';
        toast('Company created', 'success');
      } catch (e) { errBox.textContent = errMsg(e); }
    });
  }, { cls: 'gold', icon: 'building' });
  return [
    h('div', { class: 'warn-box', role: 'note' }, ic('alert', 15), h('span', null, h('b', null, 'Separate company. '), 'This creates a completely separate company. You will not be able to see its data; the owner logs in with this Gmail.')),
    errBox, done,
    h('div', { class: 'form-grid', style: { marginTop: '12px' } }, field('Company name', name), field('Owner Gmail', email, { hint: 'One Gmail can belong to only one company' })),
    h('div', { class: 'btns', style: { marginTop: '12px' } }, go)];
}

// ---------- Keyboard shortcuts card ----------
// Lists every single-key shortcut (from the central SHORTCUTS list in config.js) plus the
// fixed search/close keys, so the docs here always match what app.js actually handles.
function shortcutsCard() {
  const row = (kbd, label) => h('div', { class: 'kbd-row', style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 0', borderBottom: '1px solid var(--line3)' } },
    h('kbd', { style: { minWidth: '44px', textAlign: 'center' } }, kbd),
    h('span', { class: 'dim small' }, label));
  return [
    h('p', { class: 'dim small', style: { marginBottom: '8px' } }, 'Press a key anywhere in the app (not while typing in a box, and not when a dialog is open) to jump straight to a new form.'),
    h('div', null,
      SHORTCUTS.map(s => row(s.kbd, s.label)),
      row('N', 'New invoice (also works)'),
      SHORTCUTS_EXTRA.map(s => row(s.kbd, s.label))),
  ];
}

export async function render({ query = {} } = {}) {
  const co = state.company; const s0 = structuredClone(co.settings || {});
  const F = (key, attrs = {}) => input({ value: s0[key] ?? '', ...attrs });
  const name = input({ value: co.name || '' });
  const f = {
    address: textarea({ value: s0.address || '', rows: 2 }),
    mobile: F('mobile', { type: 'tel' }), whatsapp: F('whatsapp', { type: 'tel' }), email: F('email', { type: 'email' }), website: F('website'),
    tagline: F('tagline', { placeholder: 'e.g. Photography · Films · Albums' }), pan: F('pan', { autocapitalize: 'characters' }),
    gst_number: F('gst_number', { autocapitalize: 'characters', placeholder: '15-character GSTIN' }),
    default_tax_percent: input({ type: 'number', min: '0', max: '100', step: 'any', class: 'inp num', value: s0.default_tax_percent ?? 18 }),
    bank_name: F('bank_name'), account_holder: F('account_holder'), account_number: F('account_number', { inputmode: 'numeric' }), ifsc: F('ifsc', { autocapitalize: 'characters' }),
    upi: F('upi', { placeholder: 'name@bank' }),
    currency: F('currency', { placeholder: '₹ or INR' }),
    invoice_prefix: F('invoice_prefix', { placeholder: 'INV' }), quotation_prefix: F('quotation_prefix', { placeholder: 'QT' }), receipt_prefix: F('receipt_prefix', { placeholder: 'RC' }),
    terms: textarea({ value: s0.terms || '', rows: 5, placeholder: 'One term per line' }),
  };
  const gst = toggle('GST enabled (Tax Invoice with CGST/SGST)', !!s0.gst_enabled);
  const gstBox = h('div', { class: 'form-grid', style: { marginTop: '12px' } }, field('GST number (GSTIN)', f.gst_number), field('Default GST %', f.default_tax_percent, { hint: 'Split into CGST + SGST halves on PDFs' }));
  gstBox.hidden = !gst.input.checked;
  gst.input.addEventListener('change', () => (gstBox.hidden = !gst.input.checked));
  const albumT = toggle('Album & printing module', !!s0.album_module);
  // Tap-to-pay button toggle. The Payment QR is the reliable way to pay; this tappable "Pay" button
  // uses a upi:// intent link that GPay/PhonePe often REJECT for merchant UPI ids, so it is OFF by
  // default. Turn it on only if your customers' apps accept it.
  const upiBtnT = toggle('Show tap-to-pay button (UPI link — often rejected, off by default)', s0.upi_button_enabled === true);

  // ----- project types -----
  const types = (s0.project_types?.length ? s0.project_types : DEFAULT_PROJECT_TYPES).slice();
  const typesHost = h('div', { class: 'chips', style: { marginBottom: '10px' } });
  const newType = input({ placeholder: 'Add a project type', 'aria-label': 'New project type' });
  const drawTypes = () => mount(typesHost, types.map((t, i) => h('span', { class: 'chip on' }, t,
    h('button', { type: 'button', class: 'x', 'aria-label': `Remove ${t}`, onclick: () => { types.splice(i, 1); drawTypes(); } }, '×'))));
  const addType = () => { const v = newType.value.trim(); if (v && !types.some(t => t.toLowerCase() === v.toLowerCase())) types.push(v); newType.value = ''; drawTypes(); newType.focus(); };
  newType.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addType(); } });
  drawTypes();

  // ----- quick items -----
  const quick = (s0.quick_items || []).map(q => ({ desc: q.desc || '', rate: q.rate ?? '', sac: q.sac || '' }));
  const quickHost = h('div');
  const drawQuick = () => mount(quickHost, quick.length ? quick.map((q, i) => {
    const d = input({ value: q.desc, placeholder: 'Description', 'aria-label': `Quick item ${i + 1} description` });
    const r = input({ type: 'number', min: '0', step: 'any', class: 'inp num', value: String(q.rate), placeholder: 'Rate', 'aria-label': `Quick item ${i + 1} rate`, style: { width: '130px' } });
    d.addEventListener('input', () => (q.desc = d.value)); r.addEventListener('input', () => (q.rate = r.value));
    return h('div', { class: 'with-btn', style: { marginBottom: '6px' } }, d, r,
      iconBtn('chevronLeft', `Move quick item ${i + 1} up`, () => { if (i) { [quick[i - 1], quick[i]] = [quick[i], quick[i - 1]]; drawQuick(); } }),
      iconBtn('x', `Remove quick item ${i + 1}`, () => { quick.splice(i, 1); drawQuick(); }, 'danger'));
  }) : h('p', { class: 'dim small' }, 'No saved items yet. They are suggested first when you type an item in the invoice editor.'));
  drawQuick();

  // ----- logo -----
  const logoBox = h('div', { class: 'logo', style: { width: '72px', height: '72px', borderRadius: '14px', fontSize: '22px' }, 'aria-hidden': 'true' });
  const drawLogo = () => mount(logoBox, state.logoUrl ? h('img', { src: state.logoUrl, alt: '' }) : initials(co.name, 'SM'));
  drawLogo();
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr-only', id: 'logo-file' });
  const upBtn = btn(state.logoUrl ? 'Replace logo' : 'Upload logo', () => file.click(), { icon: 'plus' });
  file.addEventListener('change', async () => {
    const fl = file.files?.[0]; file.value = '';
    if (!fl) return;
    if (!/^image\/(png|jpeg|webp)$/.test(fl.type)) { toast('Use a PNG, JPG or WebP image.', 'error'); return; }
    if (fl.size > MAX_LOGO) { toast('Logo must be under 2 MB.', 'error'); return; }
    await busy(upBtn, async () => {
      try {
        const path = await api.uploadLogo(fl);
        await saveCompany({ logo_path: path });
        await refreshLogo(); drawLogo(); refreshBrand();
        toast('Logo updated', 'success');
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  });
  const rmBtn = btn('Remove', async () => {
    if (!(await confirmDialog('Remove the logo? PDFs will use your initials instead.', { okText: 'Remove' }))) return;
    try { await saveCompany({ logo_path: null }); await refreshLogo(); drawLogo(); refreshBrand(); toast('Logo removed', 'success'); } catch (e) { toast(errMsg(e), 'error'); }
  }, { cls: 'ghost' });

  // ----- Payment QR (your real GPay/Paytm/PhonePe merchant QR image) -----
  // Customers scan THIS to pay — it's the merchant-signed QR that always works, unlike a generated
  // upi:// link. Shown on invoice PDFs and the online invoice page. Stored in a public bucket.
  let payQrUrl = s0.pay_qr_url || '';
  const qrBox = h('div', { style: { width: '120px', height: '120px', borderRadius: '12px', border: '1px solid var(--line3)', display: 'grid', placeItems: 'center', overflow: 'hidden', background: '#fff' } });
  const drawQr = () => mount(qrBox, payQrUrl ? h('img', { src: payQrUrl, alt: 'Payment QR', style: { width: '100%', height: '100%', objectFit: 'contain' } }) : h('span', { class: 'dim small', style: { padding: '8px', textAlign: 'center' } }, 'No QR yet'));
  drawQr();
  const qrFile = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'sr-only', id: 'payqr-file' });
  const qrUpBtn = btn(payQrUrl ? 'Replace QR' : 'Upload payment QR', () => qrFile.click(), { icon: 'plus' });
  qrFile.addEventListener('change', async () => {
    const fl = qrFile.files?.[0]; qrFile.value = '';
    if (!fl) return;
    if (!/^image\/(png|jpeg|webp)$/.test(fl.type)) { toast('Use a PNG, JPG or WebP image.', 'error'); return; }
    if (fl.size > MAX_LOGO) { toast('QR image must be under 2 MB.', 'error'); return; }
    await busy(qrUpBtn, async () => {
      try {
        const url = await api.uploadPayQr(fl);
        payQrUrl = url;
        await saveCompany({ settings: { ...state.settings, pay_qr_url: url } });
        drawQr(); qrRmBtn.hidden = false; qrUpBtn.textContent = 'Replace QR';
        toast('Payment QR updated', 'success');
      } catch (e) { toast(errMsg(e), 'error'); }
    });
  });
  const qrRmBtn = btn('Remove', async () => {
    if (!(await confirmDialog('Remove the payment QR? Invoices will show the UPI id and bank details only.', { okText: 'Remove' }))) return;
    try { await api.removePayQr(payQrUrl); payQrUrl = ''; await saveCompany({ settings: { ...state.settings, pay_qr_url: '' } }); drawQr(); qrRmBtn.hidden = true; qrUpBtn.textContent = 'Upload payment QR'; toast('Payment QR removed', 'success'); }
    catch (e) { toast(errMsg(e), 'error'); }
  }, { cls: 'ghost' });
  qrRmBtn.hidden = !payQrUrl;

  const errBox = h('div', { class: 'form-error', role: 'alert' });
  async function save(b) {
    errBox.textContent = '';
    if (!name.value.trim()) { errBox.textContent = 'Company name is required.'; name.focus(); return; }
    const gstin = f.gst_number.value.trim().toUpperCase();
    if (gst.input.checked && gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) { errBox.textContent = 'GSTIN should be 15 characters (e.g. 27AAAAA0000A1Z5).'; f.gst_number.focus(); return; }
    const tax = Number(f.default_tax_percent.value);
    if (!(tax >= 0 && tax <= 100)) { errBox.textContent = 'Default GST % must be between 0 and 100.'; return; }
    const val = k => f[k].value.trim();
    const settings = {
      ...s0,
      address: val('address'), mobile: val('mobile'), whatsapp: val('whatsapp'), email: val('email'), website: val('website'), tagline: val('tagline'),
      pan: val('pan').toUpperCase(), gst_enabled: gst.input.checked, album_module: albumT.input.checked, gst_number: gstin, default_tax_percent: tax,
      bank_name: val('bank_name'), account_holder: val('account_holder'), account_number: val('account_number'), ifsc: val('ifsc').toUpperCase(), upi: val('upi'),
      upi_button_enabled: upiBtnT.input.checked,
      pay_qr_url: payQrUrl,
      currency: val('currency') || '₹',
      invoice_prefix: val('invoice_prefix').toUpperCase() || 'INV', quotation_prefix: val('quotation_prefix').toUpperCase() || 'QT', receipt_prefix: val('receipt_prefix').toUpperCase() || 'RC',
      terms: f.terms.value.trim(),
      project_types: types.filter(Boolean),
      quick_items: quick.filter(q => q.desc.trim()).map(q => ({ desc: q.desc.trim(), rate: Number(q.rate) || 0, ...(q.sac ? { sac: q.sac } : {}) })),
    };
    await busy(b, async () => {
      try { await saveCompany({ name: name.value.trim(), settings }); refreshBrand(); toast('Settings saved', 'success'); }
      catch (e) { errBox.textContent = errMsg(e); }
    });
  }
  const saveBtn = btn('Save settings', e => save(e.currentTarget), { cls: 'gold' });
  const saveBtn2 = btn('Save settings', e => save(e.currentTarget), { cls: 'gold' });

  if (query.section) setTimeout(() => document.getElementById('set-' + query.section)?.scrollIntoView({ block: 'start' }), 80);
  return h('div', null,
    pageHead('Settings', 'Company details appear on every invoice, quotation and receipt.', [saveBtn]),
    errBox,
    h('div', { class: 'cols', style: { marginTop: '12px' } },
      h('div', null,
        card('Company', h('div', { class: 'form-grid' },
          field('Company name', name, { required: true, cls: 'full' }), field('Tagline', f.tagline, { cls: 'full', hint: 'Small line under your name on PDFs' }),
          field('Address', f.address, { cls: 'full' }),
          field('Mobile', f.mobile), field('WhatsApp', f.whatsapp), field('Email', f.email), field('Website', f.website), field('PAN', f.pan))),
        card('Logo', h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' } }, logoBox,
          h('div', null, h('div', { class: 'btns' }, upBtn, state.company.logo_path ? rmBtn : null, file),
            h('p', { class: 'dim small', style: { marginTop: '8px' } }, DEMO ? 'Demo mode: the logo stays in this browser tab only.' : 'PNG/JPG/WebP up to 2 MB. Stored privately; shown with a signed link.')))),
        card('Tax', [gst.el, gstBox, h('p', { class: 'dim small', style: { marginTop: '10px' } }, 'When GST is off, documents are titled “Invoice” and GSTIN / SAC / CGST / SGST are hidden.')]),
        card('Terms & conditions', field('Default terms', f.terms, { hint: 'Used for new invoices and quotations. One per line.' })),
        card('Album & printing', [albumT.el, h('p', { class: 'dim small', style: { marginTop: '10px' } }, 'Shows “Albums in production” on the dashboard (counts per stage, overdue). The Albums and Vendors pages are always available. Save settings to apply.')]),
        h('section', { class: 'card', id: 'set-shortcuts' }, h('div', { class: 'ch' }, h('h3', null, 'Keyboard shortcuts')), shortcutsCard()),
        h('section', { class: 'card', id: 'set-pin' }, h('div', { class: 'ch' }, h('h3', null, 'App lock (PIN)')), pinCard()),
        h('section', { class: 'card', id: 'set-company' }, h('div', { class: 'ch' }, h('h3', null, 'New company')), newCompanyCard())),
      h('div', null,
        card('Bank & UPI', [h('div', { class: 'form-grid' },
          field('UPI ID', f.upi, { cls: 'full', hint: 'Shown as text on invoices so customers can also pay manually.' }),
          field('Bank name', f.bank_name), field('Account holder', f.account_holder), field('Account number', f.account_number), field('IFSC', f.ifsc)),
          h('div', { style: { marginTop: '12px' } }, upiBtnT.el),
          h('p', { class: 'dim small', style: { marginTop: '8px' } }, 'Keep the tap-to-pay button OFF if GPay/PhonePe reject the “Pay” link — the Payment QR below is the reliable way to get paid.')]),
        card('Payment QR', [h('div', { style: { display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' } }, qrBox,
          h('div', null, h('div', { class: 'btns' }, qrUpBtn, qrRmBtn, qrFile))),
          h('p', { class: 'dim small', style: { marginTop: '10px' } }, DEMO ? 'Demo mode: the QR stays in this browser tab only.' : 'Upload your real GPay / Paytm / PhonePe merchant QR (the one customers already scan to pay you). It is shown on invoices and the online invoice page so customers can scan and pay reliably. The amount is written on the invoice; customers enter it after scanning.')]),
        card('Numbering & currency', h('div', { class: 'form-grid g3' },
          field('Invoice prefix', f.invoice_prefix), field('Quotation prefix', f.quotation_prefix), field('Receipt prefix', f.receipt_prefix),
          field('Currency', f.currency, { hint: 'Symbol or code' }),
          h('p', { class: 'dim small full' }, 'Numbers are assigned by the server, e.g. INV-0012. Changing a prefix applies to new documents.'))),
        card('Packages', packagesCard()),
        card('Project types', [typesHost, h('div', { class: 'with-btn' }, newType, btn('Add', addType, { cls: 'sm' }))]),
        card('Saved items', [quickHost, btn('Add saved item', () => { quick.push({ desc: '', rate: '' }); drawQuick(); quickHost.querySelectorAll('input')[quick.length * 2 - 2]?.focus(); }, { cls: 'sm' }),
          h('p', { class: 'dim small', style: { marginTop: '8px' } }, `Rate 0 means “type the price later”. Example: Candid Photography · ${money(15000)}`)]),
        h('div', { class: 'btns', style: { justifyContent: 'flex-end', marginTop: '16px' } }, saveBtn2))));
}
