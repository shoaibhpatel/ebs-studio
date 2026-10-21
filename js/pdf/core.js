// Shared PDF theme (pdfmake) — light cream/gold, A4. Used by invoice, quotation, receipt and ledger PDFs.
import { CDN } from '../config.js';
import { state, gstOn } from '../store.js';
import { money, initials, fmtDate, round2, currencySymbol, isHeader } from '../util.js';

export const C = {
  ink: '#1d1b17', text: '#3d3a33', muted: '#8a8478', gold: '#b8913f', goldD: '#8c6a26', goldL: '#e8d6a6',
  cream: '#fbf7ee', line: '#ece4d2', soft: '#f6f0e2', zebra: '#fdfbf6', green: '#2e7a4e', red: '#a53a2e', grand: '#f3e8cc',
};
export const PAGE = { w: 595.28, h: 841.89, mx: 36 };
export const CONTENT_W = PAGE.w - PAGE.mx * 2;

// ---------- loading ----------
let loading = null;
export let serifOk = false;
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}
function toB64(buf) {
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function fetchFirst(urls) {
  for (const u of urls) {
    try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) return { buf: await r.arrayBuffer(), ext: u.split('.').pop() }; } catch { /* try next */ }
  }
  return null;
}
export function loadPdfMake() {
  if (!loading) {
    loading = (async () => {
      if (!window.pdfMake) await loadScript(CDN.pdfmake);
      await loadScript(CDN.pdfmakeVfs); // registers Roboto into pdfmake's virtual file system
      const pm = window.pdfMake;
      if (!pm) throw new Error('PDF library failed to load');
      const vfs = {}; const fam = {};
      try {
        const [n, b, i] = await Promise.all([fetchFirst(CDN.serifFonts.normal), fetchFirst(CDN.serifFonts.bold), fetchFirst(CDN.serifFonts.italics)]);
        if (n) {
          vfs['Serif-Regular.' + n.ext] = toB64(n.buf); fam.normal = 'Serif-Regular.' + n.ext;
          if (b) { vfs['Serif-Bold.' + b.ext] = toB64(b.buf); fam.bold = 'Serif-Bold.' + b.ext; } else fam.bold = fam.normal;
          if (i) { vfs['Serif-Italic.' + i.ext] = toB64(i.buf); fam.italics = 'Serif-Italic.' + i.ext; } else fam.italics = fam.normal;
          fam.bolditalics = fam.italics;
          serifOk = true;
        }
      } catch { serifOk = false; }
      const roboto = { normal: 'Roboto-Regular.ttf', bold: 'Roboto-Medium.ttf', italics: 'Roboto-Italic.ttf', bolditalics: 'Roboto-MediumItalic.ttf' };
      const fonts = { Roboto: roboto, Serif: serifOk ? fam : roboto };
      if (serifOk) {
        if (typeof pm.addVirtualFileSystem === 'function') pm.addVirtualFileSystem(vfs);
        else pm.vfs = Object.assign(pm.vfs || {}, vfs);
      }
      if (typeof pm.addFonts === 'function') pm.addFonts(fonts); else pm.fonts = Object.assign(pm.fonts || {}, fonts);
      return pm;
    })().catch(e => { loading = null; throw e; });
  }
  return loading;
}

// ---------- images (canvas → PNG data URLs) ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
export function monogram(text) {
  const S = 240; const [c, g] = canvas(S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 10, S / 2, S / 2, S / 2); grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, C.cream);
  g.fillStyle = grd; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = C.gold; g.stroke();
  g.fillStyle = C.goldD; g.font = '700 88px "Playfair Display", Georgia, "Times New Roman", serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, S / 2, S / 2 + 4);
  return c.toDataURL('image/png');
}
export function seal(status, sub) {
  const S = 300; const [c, g] = canvas(S, S);
  g.translate(S / 2, S / 2); g.rotate(-12 * Math.PI / 180);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(0, 0, S / 2 - 8, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = C.gold; g.stroke();
  g.setLineDash([9, 7]); g.lineWidth = 3; g.beginPath(); g.arc(0, 0, S / 2 - 26, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
  g.fillStyle = C.goldD; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 22px "Segoe UI", Arial, sans-serif'; spaced(g, 'STATUS', 0, -48, 5);
  const big = String(status).toUpperCase();
  g.font = `700 ${big.length > 7 ? 38 : 46}px "Segoe UI", Arial, sans-serif`; spaced(g, big, 0, 2, 3);
  if (sub) { g.font = '600 22px "Segoe UI", Arial, sans-serif'; g.fillText(sub, 0, 50); }
  return c.toDataURL('image/png');
}
function spaced(g, text, x, y, sp) {
  const w = [...text].reduce((s, ch) => s + g.measureText(ch).width + sp, -sp);
  let cx = x - w / 2; g.textAlign = 'left';
  for (const ch of text) { g.fillText(ch, cx, y); cx += g.measureText(ch).width + sp; }
  g.textAlign = 'center';
}
let logoCache = { url: null, data: null };
export async function logoImage() {
  const url = state.logoUrl;
  if (url && logoCache.url === url) return logoCache.data;
  let data = null;
  if (url) {
    try {
      const blob = await (await fetch(url, { mode: 'cors' })).blob();
      const bmp = await createImageBitmap(blob);
      const max = 360; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const [c, g] = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
      g.drawImage(bmp, 0, 0, c.width, c.height);
      data = c.toDataURL('image/png');
    } catch { data = null; }
  }
  logoCache = { url, data };
  return data;
}

// Uploaded merchant payment QR (GPay/Paytm/PhonePe). Fetched + rasterized to a data URL so pdfmake
// can embed it. primePayQr() must be awaited by a builder before it calls payBox() (which reads the
// cached value synchronously). This is the reliable "scan to pay" image — a merchant-signed QR that
// works in every app, unlike a generated upi:// link.
let payQrCache = { url: null, data: null };
export async function primePayQr() {
  const url = (state.settings || {}).pay_qr_url || null;
  if (!url) { payQrCache = { url: null, data: null }; return null; }
  if (payQrCache.url === url) return payQrCache.data;
  let data = null;
  try {
    const blob = await (await fetch(url, { mode: 'cors' })).blob();
    const bmp = await createImageBitmap(blob);
    const max = 600; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const [c, g] = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    g.drawImage(bmp, 0, 0, c.width, c.height);
    data = c.toDataURL('image/png');
  } catch { data = null; }
  payQrCache = { url, data };
  return data;
}
export const payQrData = () => payQrCache.data;

// ---------- building blocks ----------
const s = () => state.settings || {};
export const R = (n) => money(n); // money with ₹ (Roboto has the rupee glyph)
/** Money for serif text: the display font lacks ₹, so render the symbol in Roboto. */
export function RS(n) {
  const s = money(n); const sym = currencySymbol(); const i = s.indexOf(sym);
  if (i < 0) return s;
  return [s.slice(0, i), { text: sym, font: 'Roboto', bold: false }, s.slice(i + sym.length)].filter(x => x !== '');
}

export function companyLines() {
  const st = s();
  const contact = [st.mobile, st.email, st.website].filter(Boolean).join('  ·  ');
  const tax = [gstOn() && st.gst_number ? `GSTIN ${st.gst_number}` : null, st.pan ? `PAN ${st.pan}` : null].filter(Boolean).join('  ·  ');
  return [st.address, contact, tax].filter(Boolean);
}

/** Page-1 header: logo + company block | status seal | title + number badge. */
export async function header({ title, number, sealStatus, sealSub }) {
  const co = state.company || {};
  const logo = (await logoImage()) || monogram(initials(co.name, 'S'));
  const name = String(co.name || 'Studio').toUpperCase();
  const st = s();
  return {
    columns: [
      { width: 52, stack: [{ image: logo, fit: [50, 50], margin: [0, 2, 0, 0] }] },
      {
        width: '*', margin: [10, 0, 0, 0], stack: [
          { text: name, font: 'Serif', fontSize: name.length > 22 ? 13 : 16, characterSpacing: name.length > 22 ? 1.5 : 3.2, color: C.ink, bold: true },
          st.tagline ? { text: String(st.tagline).toUpperCase(), fontSize: 6.6, characterSpacing: 2, color: C.goldD, margin: [0, 2, 0, 0] } : null,
          { text: companyLines().join('\n'), fontSize: 7.4, color: C.muted, lineHeight: 1.35, margin: [0, 4, 0, 0] },
        ].filter(Boolean),
      },
      sealStatus ? { width: 70, stack: [{ image: seal(sealStatus, sealSub), fit: [66, 66], margin: [0, -4, 0, 0] }] } : { width: 0, text: '' },
      {
        width: 'auto', stack: [
          { text: title, font: 'Serif', italics: true, fontSize: title.length > 13 ? 21 : 25, noWrap: true, color: C.ink, lineHeight: 1, alignment: 'right' },
          {
            margin: [0, 6, 0, 0], columns: [{ width: '*', text: '' }, {
              width: 'auto', table: { body: [[{ text: 'No. ' + number, bold: true, fontSize: 8, color: C.ink, characterSpacing: 0.5, margin: [3, 0, 3, 0] }]] },
              layout: boxLayout(C.cream),
            }],
          },
        ],
      },
    ],
    columnGap: 6,
  };
}
// Right-align the number badge table
export function boxLayout(fill, line = C.line) {
  return {
    hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => line, vLineColor: () => line,
    fillColor: () => fill, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 5, paddingBottom: () => 5,
  };
}

export const lbl = (t, extra = {}) => ({ text: String(t).toUpperCase(), fontSize: 6.3, characterSpacing: 1.6, color: C.goldD, bold: true, margin: [0, 0, 0, 3], ...extra });

/** Row of equal-height info boxes. boxes: array of arrays of nodes; widths optional. */
export function infoStrip(boxes, widths) {
  const row = []; const w = [];
  boxes.forEach((b, i) => {
    if (i) { row.push({ text: '', border: [false, false, false, false] }); w.push(8); }
    row.push({ stack: b, fillColor: C.cream, border: [true, true, true, true], margin: [3, 3, 3, 2] });
    w.push(widths?.[i] || '*');
  });
  return {
    margin: [0, 14, 0, 12],
    table: { widths: w, body: [row] },
    layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => C.line, vLineColor: () => C.line, paddingLeft: () => 7, paddingRight: () => 7, paddingTop: () => 6, paddingBottom: () => 6 },
  };
}
export function kv(pairs) {
  return {
    table: { widths: ['auto', '*'], body: pairs.filter(Boolean).map(([k, v, opt = {}]) => [{ text: k, color: C.muted, fontSize: 7.6 }, { text: v ?? '—', alignment: 'right', bold: true, color: C.ink, fontSize: 7.8, ...opt }]) },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: (i) => (i === 0 ? 8 : 0), paddingTop: () => 1.2, paddingBottom: () => 1.2 },
  };
}
export function partyBox(label, name, lines) {
  return [lbl(label), { text: name || '—', font: 'Serif', bold: true, fontSize: 9.8, color: C.ink, margin: [0, 0, 0, 2] }, { text: lines.filter(Boolean).join('\n'), fontSize: 7.6, lineHeight: 1.35 }];
}

/** Item table (header repeats on each page, zebra rows, rows never split). */
export function itemsTable(items, { sac = gstOn() } = {}) {
  const head = ['#', 'Service / Item', ...(sac ? ['SAC'] : []), 'Qty', 'Rate', 'Amount'].map((t, i, a) => ({
    text: t.toUpperCase(), fontSize: 6.6, characterSpacing: 1.2, bold: true, color: C.goldD,
    alignment: i === 0 ? 'center' : i >= a.length - 3 ? 'right' : 'left',
  }));
  const body = [head];
  const ncol = sac ? 6 : 5;
  const headerRows = new Set();
  let n = 0;
  items.forEach((it) => {
    if (isHeader(it)) {
      // Section heading row (e.g. "Day 1 · Haldi") spanning the whole table.
      headerRows.add(body.length);
      body.push([{
        colSpan: ncol, margin: [0, 2, 0, 0],
        text: String(it.description || '').toUpperCase(), bold: true, color: C.goldD, characterSpacing: 1.1, fontSize: 7.4,
      }, ...Array(ncol - 1).fill({})]);
      return;
    }
    n += 1;
    body.push([
      { text: String(n), alignment: 'center', color: C.goldD, bold: true },
      { text: [{ text: it.description || '', bold: true, color: C.ink }, it.detail ? { text: '   ' + it.detail, color: C.muted, fontSize: 7.2 } : ''] },
      ...(sac ? [{ text: it.sac || '', color: C.muted, fontSize: 7.2 }] : []),
      { text: fmtQty(it.qty), alignment: 'right' },
      { text: R(it.rate), alignment: 'right', noWrap: true },
      { text: R(round2(Number(it.qty) * Number(it.rate))), alignment: 'right', bold: true, color: C.ink, noWrap: true },
    ]);
  });
  if (items.length === 0) body.push([{ text: 'No items', colSpan: sac ? 6 : 5, color: C.muted, alignment: 'center' }, ...Array(sac ? 5 : 4).fill({})]);
  return {
    table: { headerRows: 1, dontBreakRows: true, widths: [18, '*', ...(sac ? [42] : []), 30, 62, 70], body },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === 1 ? 1 : i === node.table.body.length ? 0.8 : headerRows.has(i) || headerRows.has(i - 1) ? 0.6 : 0.4),
      hLineColor: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? C.gold : headerRows.has(i) || headerRows.has(i - 1) ? C.goldL : C.line),
      vLineWidth: () => 0,
      fillColor: (row) => (row === 0 ? C.cream : headerRows.has(row) ? C.soft : row % 2 === 0 ? C.zebra : null),
      paddingLeft: () => 5, paddingRight: () => 5,
      paddingTop: (i) => (i === 0 ? 5 : 3.6), paddingBottom: (i) => (i === 0 ? 5 : 3.6),
    },
  };
}
function fmtQty(q) { const n = Number(q) || 0; return Number.isInteger(n) ? String(n) : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }

/** Totals box rows: [label, value, style] ; style: 'grand' | 'green' | 'red' */
export function totalsBox(rows) {
  const body = rows.filter(Boolean).map(([k, v, style]) => {
    if (style === 'grand') return [
      { text: k.toUpperCase(), fontSize: 6.8, characterSpacing: 1.6, bold: true, color: C.goldD, fillColor: C.grand, margin: [0, 4, 0, 3] },
      { text: typeof v === 'number' ? RS(v) : v, font: 'Serif', bold: true, fontSize: 15, color: C.ink, alignment: 'right', fillColor: C.grand, noWrap: true },
    ];
    return [
      { text: k, color: style === 'red' ? C.ink : C.text, bold: style === 'red' },
      { text: v, alignment: 'right', bold: true, noWrap: true, color: style === 'green' ? C.green : style === 'red' ? C.red : C.ink, fontSize: style === 'red' ? 10 : 8.6 },
    ];
  });
  const grandIdx = rows.filter(Boolean).findIndex(r => r[2] === 'grand');
  return {
    table: { widths: ['*', 'auto'], body },
    layout: {
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.6 : i === grandIdx || i === grandIdx + 1 ? 1 : 0.4),
      hLineColor: (i, node) => (i === grandIdx || i === grandIdx + 1) && i !== 0 && i !== node.table.body.length ? C.gold : C.line,
      vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.6 : 0),
      vLineColor: () => C.line,
      paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 4, paddingBottom: () => 4,
    },
  };
}

/** Standard tax rows for a document. */
export function taxRows(doc) {
  const rows = [['Subtotal', R(doc.subtotal)]];
  if (Number(doc.discount_amount) > 0) rows.push(['Discount', '– ' + R(doc.discount_amount)]);
  const tax = Number(doc.tax_amount) || 0; const pct = Number(doc.tax_percent) || 0;
  if (gstOn() && tax > 0) {
    rows.push(['Taxable value', R(round2(doc.subtotal - doc.discount_amount))]);
    const half = round2(tax / 2); const p2 = trimPct(pct / 2);
    rows.push([`CGST @ ${p2}%`, R(half)], [`SGST @ ${p2}%`, R(round2(tax - half))]);
  } else if (tax > 0) rows.push([`Tax @ ${trimPct(pct)}%`, R(tax)]);
  return rows;
}
const trimPct = p => (Math.round(p * 100) / 100).toString();

/**
 * Build a `upi://pay?...` deep link. amount is the figure to charge (callers pass the balance when one exists, else the total).
 * pa = UPI id (company settings), pn = company name, am = amount (2dp), cu = INR, tn = note (invoice no. + party name).
 * NOTE: tapping a link embedded in a PDF is unreliable across viewers — the WhatsApp text link (share.js) and the
 * in-app "Pay" / "Copy UPI pay link" buttons (invoice drawer) are the reliable ways to open GPay / PhonePe prefilled.
 */
export function upiString(amount, note) {
  const st = s(); if (!st.upi) return null;
  const p = new URLSearchParams({ pa: st.upi, pn: state.company?.name || '', am: round2(amount).toFixed(2), cu: 'INR', tn: note || '' });
  return 'upi://pay?' + p.toString().replace(/\+/g, '%20');
}

/**
 * Build an https:// link to the site's own pay.html landing page (same UPI params as a upi:// link).
 * The PDF "TAP TO PAY" button uses THIS (not raw upi://) because mobile PDF viewers such as Google
 * Drive open https:// links but silently ignore custom schemes like upi://. pay.html then launches
 * the UPI app and shows a QR + manual buttons as a fallback. Returns null when there is no UPI id.
 */
export function payPageUrl(amount, note) {
  const st = s(); if (!st.upi) return null;
  // Resolve pay.html next to the currently-served page (works on GitHub Pages sub-paths, custom
  // domains and local dev). Falls back to a relative URL if location/URL isn't available.
  let base = 'pay.html';
  try { base = new URL('pay.html', location.href).href; } catch { /* keep relative */ }
  const p = new URLSearchParams({ pa: st.upi, pn: state.company?.name || '', am: round2(amount).toFixed(2), cu: 'INR', tn: note || '' });
  return base + '?' + p.toString().replace(/\+/g, '%20');
}
/**
 * Tappable "Pay" button for the PDF. On a phone the UPI deep link opens GPay / PhonePe / Paytm
 * prefilled with the amount. On desktop viewers that ignore upi:// links, the big QR right above
 * remains the fallback — so the customer always has a way to pay.
 */
export function payButton(amount, link, width = 300) {
  if (!link) return null;
  // Tappable gold "button": a single-cell fixed-width table. The fill is set on the CELL (fillColor)
  // with the padding provided by the cell's margin; the https:// link on the cell text makes the whole
  // bar tappable. The link is an https:// pay-page URL (not raw upi://) so mobile PDF viewers such as
  // Google Drive actually open it; pay.html then launches the UPI app. This form renders reliably in
  // pdfmake 0.3.x when the button is a direct child of a stack (not nested inside a narrow column).
  return {
    margin: [0, 8, 0, 0],
    table: {
      widths: [width],
      body: [[{
        text: [{ text: 'TAP TO PAY ' }, { text: R(amount) }, { text: '    ·    GPay / PhonePe / Paytm', fontSize: 7.5 }],
        link, bold: true, fontSize: 9.5, characterSpacing: 0.4, color: '#ffffff', fillColor: C.goldD,
        alignment: 'center', margin: [8, 7, 8, 7],
      }]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  };
}

/**
 * QR + bank details box. Prefers the uploaded MERCHANT QR image (payQrData — a real GPay/Paytm/
 * PhonePe QR that reliably accepts payments in every app). Only if no QR image is uploaded does it
 * fall back to a generated upi:// QR. Call `await primePayQr()` before building so the image is ready.
 */
export function payBox(amount, note, { showQr = true } = {}) {
  const st = s();
  const wantQr = showQr && amount > 0;
  const qrImg = wantQr ? payQrData() : null;                 // uploaded merchant QR (preferred)
  const upi = wantQr && !qrImg ? upiString(amount, note) : null; // generated fallback only
  const pairs = [st.upi && ['UPI', st.upi], st.bank_name && ['Bank', st.bank_name], st.account_number && ['A/C No.', st.account_number],
    st.ifsc && ['IFSC', st.ifsc], st.account_holder && ['A/C Name', st.account_holder]].filter(Boolean);
  const hasQr = !!(qrImg || upi);
  if (!hasQr && !pairs.length) return null;
  const details = {
    width: '*', stack: [lbl(hasQr ? 'Scan & Pay · Bank Details' : 'Bank Details'),
      { table: { widths: ['auto', '*'], body: pairs.map(([k, v]) => [{ text: k, color: C.muted, fontSize: 7.4 }, { text: v, bold: true, color: C.ink, fontSize: 7.6 }]) }, layout: 'noBorders' }].filter(Boolean),
  };
  // QR column: the uploaded merchant QR image if present, else the generated upi:// QR.
  const qrNode = qrImg
    ? { image: qrImg, fit: [116, 116], margin: [0, 0, 0, 0] }
    : { qr: upi, fit: 116, eccLevel: 'M', margin: [0, 0, 0, 0] };
  const qrCol = hasQr ? {
    width: 132,
    stack: [
      { table: { body: [[qrNode]] }, layout: boxLayout('#ffffff', C.gold) },
      { text: `Scan to pay ${R(amount)}`, fontSize: 8.4, bold: true, color: C.goldD, alignment: 'center', margin: [0, 4, 0, 0] },
      { text: 'GPay · PhonePe · Paytm · any UPI app', fontSize: 6.6, color: C.muted, alignment: 'center', margin: [0, 1, 0, 0] },
    ],
  } : null;
  const cols = qrCol ? [qrCol, details] : [details];
  const box = { table: { widths: ['*'], body: [[{ columns: cols, columnGap: 12 }]] }, layout: boxLayout('#ffffff') };
  // The QR above is the reliable way to pay. The tappable "Pay" bar uses a upi:// intent link which
  // some apps (GPay/PhonePe) REJECT for merchant UPI ids ("receiver not accepting on this UPI ID") —
  // so it is OPTIONAL and OFF by default. The owner can enable it in Settings (upi_button_enabled).
  const showBtn = wantQr && st.upi && st.upi_button_enabled === true;
  const btn = showBtn ? payButton(amount, payPageUrl(amount, note)) : null;
  return btn ? { stack: [box, btn] } : box;
}

export function termsAndSign(termsText) {
  const lines = String(termsText || '').split(/\r?\n/).map(x => x.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').trim()).filter(Boolean);
  const co = state.company?.name || 'Studio';
  return {
    unbreakable: true, margin: [0, 14, 0, 0], columns: [
      { width: '*', stack: lines.length ? [lbl('Terms & Conditions'), { ol: lines, fontSize: 7, color: C.muted, lineHeight: 1.3, markerColor: C.goldD }] : [{ text: '' }] },
      {
        width: 150, stack: [
          { text: co, font: 'Serif', italics: true, fontSize: 14, color: C.ink, alignment: 'center', margin: [0, 18, 0, 2] },
          { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 150, y2: 0, lineWidth: 0.8, lineColor: C.gold }] },
          { text: 'AUTHORISED SIGNATORY', fontSize: 6.5, characterSpacing: 1.6, color: C.muted, alignment: 'center', margin: [0, 3, 0, 0] },
        ],
      },
    ], columnGap: 24,
  };
}
export function thankYou(text = 'Thank you for letting us tell your story.') {
  return { text, font: 'Serif', italics: true, fontSize: 10.5, color: C.goldD, alignment: 'center', margin: [0, 18, 0, 0] };
}
export function notesBlock(notes) {
  if (!notes) return null;
  return { margin: [0, 10, 0, 0], unbreakable: true, stack: [lbl('Notes'), { text: notes, fontSize: 7.6, color: C.text }] };
}

/** Wrap content into a full doc definition with background, running header (page 2+) and footer. */
export function docDefinition({ title, number, content, info }) {
  const st = s(); const co = state.company?.name || 'Studio';
  const contact = [st.mobile, st.email, st.website].filter(Boolean).join('   ·   ');
  return {
    pageSize: 'A4', pageMargins: [PAGE.mx, 46, PAGE.mx, 50],
    info: { title: `${title} ${number}`, author: co, creator: 'Studio Manager', ...info },
    defaultStyle: { font: 'Roboto', fontSize: 8.6, color: C.text, lineHeight: 1.18 },
    background: (page, size) => ({
      canvas: [
        { type: 'rect', x: 0, y: 0, w: size.width, h: 3.4, linearGradient: [C.goldD, C.gold, C.goldL, C.gold, C.goldD] },
        { type: 'rect', x: 14, y: 14, w: size.width - 28, h: size.height - 28, lineWidth: 0.9, lineColor: C.goldL },
      ],
    }),
    header: (page) => page === 1 ? null : {
      margin: [PAGE.mx, 24, PAGE.mx, 0],
      columns: [
        { text: co.toUpperCase(), font: 'Serif', bold: true, fontSize: 9, characterSpacing: 2, color: C.ink },
        { text: `${title} · No. ${number} · continued`, alignment: 'right', fontSize: 7.4, color: C.muted },
      ],
    },
    footer: (page, pages) => ({
      margin: [PAGE.mx, 14, PAGE.mx, 0],
      columns: [
        { width: 60, text: '' },
        { width: '*', text: contact.toUpperCase(), alignment: 'center', fontSize: 6.4, characterSpacing: 1, color: C.muted },
        { width: 60, text: `Page ${page} of ${pages}`, alignment: 'right', fontSize: 6.6, color: C.muted },
      ],
    }),
    content,
  };
}

/** Create an output wrapper: { fileName, download(), blob(), base64() } */
export async function output(dd, fileName) {
  const pm = await loadPdfMake();
  const doc = pm.createPdf(dd);
  const call = (m, ...args) => new Promise((res, rej) => {
    try { const r = doc[m](...args, res); if (r && typeof r.then === 'function') r.then(res, rej); } catch (e) { rej(e); }
  });
  return {
    fileName,
    download: () => new Promise((res, rej) => { try { const r = doc.download(fileName); if (r && r.then) r.then(res, rej); else setTimeout(res, 300); } catch (e) { rej(e); } }),
    blob: () => call('getBlob'),
    base64: () => call('getBase64'),
  };
}
export { fmtDate };
