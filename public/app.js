/* ============================================================
   STARA RIJEKA · CASHFLOW · CLIENT
   ============================================================ */
(() => {
'use strict';

/* ---------- CONSTANTS ---------- */
const MONTH_NAMES_HR = ['Siječanj','Veljača','Ožujak','Travanj','Svibanj','Lipanj','Srpanj','Kolovoz','Rujan','Listopad','Studeni','Prosinac'];
const DAY_NAMES_HR = ['Ned','Pon','Uto','Sri','Čet','Pet','Sub'];
const FMT = new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_INT = new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 0 });
const FMT_PCT = new Intl.NumberFormat('hr-HR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

const TRX_GROUPS = ['Tekući', 'Nepredviđeni', 'Prihodi', 'Isključi'];
const TRX_TYPES = ['Trošak', 'Prihod', 'Pozajmnica'];
const TRX_CATEGORIES = ['Knjigovodstvo','Smještaj','Komunalije','Bankovne naknade','Materijal','Leasing','Porez','Pozajmica','Adria Oil','Ostalo','Polo','Pondi','Auto Klub','Mobitel','Osiguranje','e-poslovanje','Liječnički','Prijevoz','Gorivo'];

/* Project palette for STO + projects */
const PROJECT_PALETTE = [
  '#1e3a5f','#7c2d3a','#2c5f5d','#b8860b','#5a4a8a','#1f6b3a','#8a4a2c','#2c4a8a','#b85d6e','#4a8a2c'
];

/* ---------- STATE ---------- */
let state = null;        // canonical data
let isAdmin = false;
let activeTab = 'cashflow';
let activeMonth = '2026-04';   // current default
let stoView = 'month';   // 'month' | 'year'
let activeProject = null;       // null = pregled svih, string = detalj projekta
let projectsGroup = null;       // null = odabir grupe, 'tekuci' | 'zavrseni' = lista projekata grupe
let projectsFilter = 'aktivni'; // 'aktivni' | 'svi'
let trxView = 'month';   // 'month' | 'year'
const charts = {};       // Chart.js instances (so we can destroy)

/* ---------- API CLIENT ---------- */
const API = {
  pin: localStorage.getItem('sr_pin') || null,

  async load() {
    setConnDot('syncing');
    try {
      const r = await fetch('/api/load', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      setConnDot('online');
      return data;
    } catch (e) {
      console.error('Load failed:', e);
      setConnDot('offline');
      // Try local backup
      const local = localStorage.getItem('sr_data_backup');
      if (local) {
        toast('Server nedostupan, koristim lokalni backup', 'error');
        return JSON.parse(local);
      }
      throw e;
    }
  },

  async save(data) {
    if (!this.pin) throw new Error('Nije unesen admin PIN');
    setConnDot('syncing');
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': this.pin },
      body: JSON.stringify(data),
    });
    if (r.status === 401) {
      setConnDot('online');
      this.pin = null;
      localStorage.removeItem('sr_pin');
      isAdmin = false;
      document.body.classList.remove('admin-mode');
      updateAdminButton();
      throw new Error('Pogrešan PIN');
    }
    if (!r.ok) {
      setConnDot('offline');
      throw new Error('Spremanje nije uspjelo (HTTP ' + r.status + ')');
    }
    setConnDot('online');
    localStorage.setItem('sr_data_backup', JSON.stringify(data));
    return await r.json();
  },

  async verifyPin(pin) {
    const r = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': pin, 'X-Verify-Only': '1' },
      body: '{}',
    });
    return r.status === 200;
  },
};

function setConnDot(state) {
  const el = document.getElementById('connDot');
  el.className = 'connection-dot ' + state;
  el.title = state === 'online' ? 'Spojeno' : state === 'syncing' ? 'Sinkronizacija…' : 'Offline';
}

/* ---------- TOAST ---------- */
function toast(msg, type = '', duration = 2500) {
  const wrap = document.getElementById('toastMount');
  const el = document.createElement('div');
  el.className = 'toast' + (type ? ' ' + type : '');
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastIn 0.25s var(--ease) reverse';
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ---------- MODAL HELPER ---------- */
function modalV3(html, opts = {}) {
  const mount = document.getElementById('modalMount');
  mount.innerHTML = `<div class="modal-backdrop"><div class="modal ${opts.wide ? 'modal-wide' : ''}">${html}</div></div>`;
  const backdrop = mount.querySelector('.modal-backdrop');
  const close = () => { mount.innerHTML = ''; if (opts.onClose) opts.onClose(); };
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
  });
  return { close, root: backdrop };
}

/* ---------- PIN MODAL ---------- */
function showPinModal() {
  if (isAdmin) {
    // logout
    isAdmin = false;
    API.pin = null;
    localStorage.removeItem('sr_pin');
    document.body.classList.remove('admin-mode');
    updateAdminButton();
    toast('Odjavljen iz admin moda');
    rerenderActive();
    return;
  }

  let pin = '';
  const html = `
    <div class="modal-title">Admin pristup</div>
    <div class="modal-sub">Unesi 4-znamenkasti PIN za izmjenu podataka.</div>
    <div class="pin-display">
      <div class="pin-dot" data-i="0"></div>
      <div class="pin-dot" data-i="1"></div>
      <div class="pin-dot" data-i="2"></div>
      <div class="pin-dot" data-i="3"></div>
    </div>
    <div class="pin-pad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="pin-key" data-n="${n}">${n}</button>`).join('')}
      <button class="pin-key special" data-action="clear">Briši</button>
      <button class="pin-key" data-n="0">0</button>
      <button class="pin-key special" data-action="cancel">Odustani</button>
    </div>
  `;
  const m = modal(html);
  const dots = m.root.querySelectorAll('.pin-dot');
  const updateDots = () => {
    dots.forEach((d, i) => {
      d.classList.toggle('filled', i < pin.length);
      d.classList.remove('error');
    });
  };
  const submit = async () => {
    try {
      const ok = await API.verifyPin(pin);
      if (ok) {
        API.pin = pin;
        localStorage.setItem('sr_pin', pin);
        isAdmin = true;
        document.body.classList.add('admin-mode');
        updateAdminButton();
        m.close();
        toast('Admin mod aktiviran', 'success');
        rerenderActive();
      } else {
        dots.forEach(d => d.classList.add('error'));
        setTimeout(() => { pin = ''; updateDots(); }, 600);
      }
    } catch (e) {
      toast('Greška pri provjeri PIN-a', 'error');
    }
  };

  m.root.addEventListener('click', e => {
    const key = e.target.closest('.pin-key');
    if (!key) return;
    if (key.dataset.action === 'cancel') { m.close(); return; }
    if (key.dataset.action === 'clear') { pin = pin.slice(0, -1); updateDots(); return; }
    if (pin.length < 4) {
      pin += key.dataset.n;
      updateDots();
      if (pin.length === 4) setTimeout(submit, 200);
    }
  });

  // Keyboard support
  const keyHandler = (e) => {
    if (!document.querySelector('.modal-backdrop')) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.key >= '0' && e.key <= '9' && pin.length < 4) {
      pin += e.key; updateDots();
      if (pin.length === 4) setTimeout(submit, 200);
    } else if (e.key === 'Backspace') {
      pin = pin.slice(0, -1); updateDots();
    } else if (e.key === 'Enter' && pin.length === 4) {
      submit();
    }
  };
  document.addEventListener('keydown', keyHandler);
}

function updateAdminButton() {
  const btn = document.getElementById('adminBtn');
  btn.classList.toggle('active', isAdmin);
  btn.title = isAdmin ? 'Odjavi se iz admin moda' : 'Admin pristup';
  // Swap lock icon
  btn.innerHTML = isAdmin
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V8a5 5 0 019.5-2" />
      </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0110 0v4" />
      </svg>`;
}

/* ---------- HELPERS ---------- */
const eur = (n, dec = 2) => {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const fmt = dec === 0 ? FMT_INT : FMT;
  return fmt.format(n) + ' €';
};
const eurShort = (n) => {
  if (!n) return '0 €';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M €';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'k €';
  return Math.round(n) + ' €';
};
const fmtQty = (n) => new Intl.NumberFormat('hr-HR', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const grossFromNet = (net, vat) => round2((Number(net) || 0) * (1 + (Number(vat) || 0) / 100));
const isMobileView = () => {
  try {
    if (window.matchMedia && window.matchMedia('(max-width: 719px)').matches) return true;
  } catch (e) {}
  return (window.innerWidth || 1024) <= 719;
};
/* Aktivne osobe s fiksnim mjesečnim troškom rada (Postavke → Fiksni rad) */
const getFixedLabor = () => (state && state.settings && Array.isArray(state.settings.fixedLabor))
  ? state.settings.fixedLabor.filter(f => f && f.active !== false && (Number(f.amount) || 0) > 0)
  : [];
/* Dodatni CSS (mobilne kartice za uvoz/stavke) — ubacuje se iz app.js da deploy ostane jedan file */
function injectExtraCss() {
  if (document.getElementById('sr-extra-css')) return;
  const st = document.createElement('style');
  st.id = 'sr-extra-css';
  st.textContent = `
    .ir-card { border: 1px solid var(--line); border-radius: 12px; padding: 12px; margin-bottom: 10px; background: var(--surface); }
    .ir-head-row { display: flex; gap: 8px; align-items: center; }
    .ir-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; margin-top: 8px; }
    .ir-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
    .ir-mini-label { font-size: 10px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: 3px; font-weight: 600; }
    @media (max-width: 719px) {
      .mat-stavke-table th:nth-child(4), .mat-stavke-table td:nth-child(4) { display: none; }
      .modal.modal-wide { max-width: 100%; }
      tr[data-items-for] table { font-size: 12px; }
    }
    /* STO stanje (vrh STO taba) */
    .sto-stanje { margin: 0 0 40px; }
    .sto-stanje > .eyebrow { margin-bottom: 14px; }
    .sto-stanje .flourish-stat { margin-bottom: 16px; }
    .sto-formula { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; font-family: var(--font-mono); font-size: 12px; color: var(--muted); position: relative; }
    .sto-formula .seg { display: inline-flex; gap: 8px; align-items: baseline; white-space: nowrap; }
    .sto-formula .seg .val { color: var(--ink); font-weight: 500; font-variant-numeric: tabular-nums; }
    .sto-formula .op { color: var(--muted-2); margin-right: 2px; }
    .sto-formula .sto-ios-link { margin-left: auto; }
    .sto-formula .link { font: inherit; color: var(--ink); text-decoration: underline; text-decoration-color: #e8c200; text-decoration-thickness: 2px; text-underline-offset: 3px; cursor: pointer; padding: 0; }
    .sto-uplate { margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--line); position: relative; }
    .sto-uplate-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-bottom: 4px; }
    .sto-uplate-head .eyebrow { margin: 0; white-space: nowrap; }
    .sto-uplate-head .sum { font-family: var(--font-mono); font-size: 12px; color: var(--muted); white-space: nowrap; }
    .sto-uplate-empty { font-size: 13px; color: var(--muted); padding: 8px 0 2px; }
    .sto-uplate-more { font-family: var(--font-mono); font-size: 11px; color: var(--muted-2); padding: 10px 0 0; }
    .sto-ledger-row { display: grid; grid-template-columns: 104px 120px 1fr auto; grid-template-areas: "d a n act"; gap: 18px; align-items: center; padding: 11px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
    .sto-ledger-row:last-child { border-bottom: none; padding-bottom: 2px; }
    .sto-ledger-row .d { grid-area: d; font-family: var(--font-mono); font-size: 13px; color: var(--muted); }
    .sto-ledger-row .a { grid-area: a; font-family: var(--font-mono); font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .sto-ledger-row .n { grid-area: n; color: var(--ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sto-ledger-row .n .none { color: var(--muted-2); }
    .sto-ledger-row .n .pill { margin-right: 8px; vertical-align: middle; }
    .sto-ledger-row .act { grid-area: act; display: flex; gap: 2px; justify-self: end; }
    .sto-ledger-row.before-ios .d, .sto-ledger-row.before-ios .a { color: var(--muted-2); font-weight: 500; }
    .sto-section-head { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 16px; margin: 0 0 24px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
    .sto-section-head .eyebrow { margin-bottom: 8px; }
    .sto-section-head .section-title { font-family: var(--font-display); font-weight: 500; font-size: 24px; letter-spacing: -0.02em; line-height: 1.1; }
    .sto-section-head .section-title em { font-style: italic; font-weight: 400; color: var(--muted); }
    .sto-ios-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 2px dashed var(--line); border-radius: 12px; padding: 28px 16px; cursor: pointer; text-align: center; color: var(--muted); transition: border-color .15s; }
    @media (max-width: 760px) {
      .sto-stanje { margin-bottom: 32px; }
      .sto-formula { flex-direction: column; align-items: flex-start; gap: 4px; }
      .sto-formula .sto-ios-link { margin-left: 0; margin-top: 6px; }
      .sto-uplate-head .sum { display: none; }
      .sto-ledger-row { grid-template-columns: auto 1fr auto; grid-template-areas: "d a act" "n n n"; gap: 6px 14px; }
      .sto-ledger-row .n { font-size: 13px; white-space: normal; }
    }
  `;
  document.head.appendChild(st);
}

/* CSS za obračun projekata (lista-odabir + detalj) — iz app.js da deploy ostane jedan file */
function injectObracunCss() {
  if (document.getElementById('sr-obracun-css')) return;
  const st = document.createElement('style');
  st.id = 'sr-obracun-css';
  st.textContent = `
    .pick-h { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); margin: 26px 0 8px; }
    .pick-list { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--shadow-sm); }
    .pick-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 17px 20px; border-bottom: 1px solid var(--line); cursor: pointer; transition: background .15s var(--ease-snap); }
    .pick-row:last-child { border-bottom: none; }
    .pick-row:hover { background: var(--surface-2); }
    .pick-row .nm { font-family: var(--font-display); font-size: 18px; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pick-row .side { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
    .pick-row .chev { color: var(--muted-2); font-size: 18px; }
    .pick-row.done .nm { color: var(--muted); font-weight: 500; }
    .pill.brown { background: var(--acc-projects-soft); color: var(--acc-projects); }
    .ob-bar { display: flex; height: 34px; border-radius: 10px; overflow: hidden; margin-bottom: 16px; background: var(--surface-2); }
    .ob-bar span { display: flex; align-items: center; justify-content: center; color: #fff; font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; }
    .ob-legend-row { display: grid; grid-template-columns: 14px 1fr auto 62px; gap: 12px; align-items: center; padding: 11px 2px; border-bottom: 1px solid var(--line); font-size: 14px; }
    .ob-legend-row:last-child { border-bottom: none; }
    .ob-legend-row .sw { width: 12px; height: 12px; border-radius: 4px; }
    .ob-legend-row .amt { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .ob-legend-row .pct { font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); text-align: right; }
    .ob-cmp-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: baseline; padding: 11px 2px; border-bottom: 1px solid var(--line); font-size: 14px; }
    .ob-cmp-row:last-child { border-bottom: none; }
    .ob-cmp-row .v { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .delta-chip { display: inline-block; padding: 2px 8px; border-radius: 5px; font-family: var(--font-mono); font-size: 11.5px; font-weight: 600; }
    .delta-chip.up { background: var(--positive-soft); color: var(--positive); }
    .delta-chip.down { background: var(--negative-soft); color: var(--negative); }
    .up-row { display: grid; grid-template-columns: 100px 120px 1fr auto; gap: 16px; align-items: center; padding: 11px 2px; border-bottom: 1px solid var(--line); font-size: 14px; }
    .up-row[data-ob-up-edit] { cursor: pointer; }
    .up-row[data-ob-up-edit]:hover { background: var(--surface-2); }
    .up-row .d { font-family: var(--font-mono); font-size: 12.5px; color: var(--muted); }
    .up-row .a { font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
    .up-row .n { color: var(--ink-2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .up-row .x { color: var(--muted-2); font-size: 16px; cursor: pointer; padding: 0 4px; }
    .up-row .x:hover { color: var(--negative); }
    .up-total { display: flex; justify-content: space-between; padding: 13px 2px 2px; font-weight: 650; border-top: 1px solid var(--line-strong); margin-top: 2px; font-variant-numeric: tabular-nums; }
    .ob-drop { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; border: 2px dashed var(--line-strong); border-radius: 12px; padding: 22px 16px; text-align: center; color: var(--muted); font-size: 13px; cursor: pointer; transition: border-color .15s; }
    .ob-drop:hover { border-color: var(--acc-projects); }
    .ob-drop strong { color: var(--ink); font-size: 14px; }
    .proj-removed-row { margin-top: 24px; width: 100%; display: flex; align-items: center; gap: 10px; padding: 13px 16px; border: 1px dashed var(--line-strong); border-radius: var(--radius-md); background: none; color: var(--muted); font-size: 13.5px; font-family: inherit; cursor: pointer; text-align: left; }
    .proj-removed-row:hover { background: var(--surface); }
    .proj-removed-row .chev2 { display: inline-flex; transition: transform .2s var(--ease-snap); font-size: 15px; color: var(--muted-2); }
    .proj-removed-row.open .chev2 { transform: rotate(90deg); }
    .proj-removed-row .sp { flex: 1; }
    .proj-removed-list { display: none; }
    .proj-removed-list.open { display: block; }
    #panel-projects.swiping { transition: none !important; }
    @media (max-width: 719px) {
      .pick-row { padding: 15px 16px; }
      .pick-row .nm { font-size: 16.5px; }
      .up-row { grid-template-columns: 1fr auto auto; grid-template-areas: "n a x" "d a x"; row-gap: 2px; gap: 6px 14px; }
      .up-row .d { grid-area: d; }
      .up-row .a { grid-area: a; }
      .up-row .x { grid-area: x; }
      .up-row .n { grid-area: n; white-space: normal; }
      .ob-bar span { font-size: 10px; }
      .ob-legend-row { grid-template-columns: 14px 1fr auto 52px; gap: 8px; }
    }
  `;
  document.head.appendChild(st);
}
const monthLabel = (key) => {
  const [y, m] = key.split('-');
  return `${MONTH_NAMES_HR[parseInt(m, 10) - 1]} ${y}`;
};
const monthLabelShort = (key) => {
  const [, m] = key.split('-');
  return MONTH_NAMES_HR[parseInt(m, 10) - 1];
};
const allMonths = () => {
  const set = new Set([
    ...Object.keys(state.trx || {}),
    ...Object.keys(state.sto || {}),
    ...Object.keys(state.hours || {}),
  ]);
  return Array.from(set).sort();
};
const ensureMonth = (key) => {
  if (!state.trx[key]) state.trx[key] = [];
  if (!state.sto[key]) state.sto[key] = [];
  if (!state.hours[key]) state.hours[key] = { days: [], extras: {} };
};
const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- EU FORMAT HELPERS (DD/MM/YYYY · 10.000,00) ---------- */
function isoToEU(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}
function euToISO(eu) {
  if (!eu) return '';
  const dig = String(eu).replace(/\D/g, '');
  if (dig.length !== 8) return '';
  const d = dig.slice(0, 2), m = dig.slice(2, 4), y = dig.slice(4, 8);
  const dn = +d, mn = +m, yn = +y;
  if (mn < 1 || mn > 12 || dn < 1 || dn > 31 || yn < 2000 || yn > 2100) return '';
  const obj = new Date(yn, mn - 1, dn);
  if (obj.getFullYear() !== yn || obj.getMonth() !== mn - 1 || obj.getDate() !== dn) return '';
  return `${y}-${m}-${d}`;
}
function attachEUDateMask(input) {
  if (!input) return;
  // Pratimo prethodnu vrijednost i poziciju kareta da bismo mogli odbiti
  // unose koji nisu brojke ili '/' bez da bacimo postojeći sadržaj.
  let lastValue = input.value;
  let lastSelStart = input.selectionStart || 0;

  // Snapshot prije svake izmjene
  input.addEventListener('keydown', () => {
    lastValue = input.value;
    lastSelStart = input.selectionStart || 0;
  });

  input.addEventListener('input', (e) => {
    const el = e.target;
    const inputType = e.inputType || '';
    const isDelete = inputType.startsWith('delete');
    let v = el.value;
    let pos = el.selectionStart || 0;

    el.classList.remove('invalid');

    // BRISANJE → samo ograniči duljinu i pusti korisnika.
    // NE preformatiraj — tako "18/05/2026" - "8" postaje "1/05/2026" (ne "10/52/026").
    if (isDelete) {
      if (v.length > 10) v = v.slice(0, 10);
      el.value = v;
      try { el.setSelectionRange(pos, pos); } catch {}
      lastValue = v;
      lastSelStart = pos;
      return;
    }

    // PASTE → preformatiraj agresivno iz samih brojki
    if (inputType === 'insertFromPaste') {
      const digits = v.replace(/\D/g, '').slice(0, 8);
      let out = digits;
      if (digits.length >= 5) out = digits.slice(0, 2) + '/' + digits.slice(2, 4) + '/' + digits.slice(4);
      else if (digits.length >= 3) out = digits.slice(0, 2) + '/' + digits.slice(2);
      el.value = out;
      try { el.setSelectionRange(out.length, out.length); } catch {}
      lastValue = out;
      lastSelStart = out.length;
      return;
    }

    // OBIČNO TIPKANJE — odbij sve što nije brojka ili '/'
    const lastChar = v.charAt(pos - 1);
    if (lastChar && !/[\d/]/.test(lastChar)) {
      el.value = lastValue;
      try { el.setSelectionRange(lastSelStart, lastSelStart); } catch {}
      return;
    }

    // Limitiraj na max 10 znakova (DD/MM/YYYY)
    if (v.length > 10) v = v.slice(0, 10);

    // Auto-insert '/' na granicama 2 i 5 dok korisnik dodaje brojke na kraj
    if ((pos === 2 || pos === 5) && /\d/.test(lastChar) && v.charAt(pos) !== '/' && v.length === pos) {
      v = v + '/';
      pos = pos + 1;
    }

    el.value = v;
    try { el.setSelectionRange(pos, pos); } catch {}
    lastValue = v;
    lastSelStart = pos;
  });

  input.addEventListener('blur', e => {
    const v = e.target.value.trim();
    if (v && !euToISO(v)) e.target.classList.add('invalid');
    else e.target.classList.remove('invalid');
  });
}

/* Parsira EU iznose: "10.000,50" → 10000.5; toleria i "10000", "10.000", "10000,5", "10,000.50" itd. */
function parseEUAmount(str) {
  if (str === null || str === undefined) return 0;
  if (typeof str === 'number') return str;
  let s = String(str).trim().replace(/[\s€]/g, '');
  if (!s) return 0;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Vodeći separator je onaj koji se pojavljuje zadnji → decimala
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > lastDot) {
      // EU format: 10.000,50
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 10,000.50
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    s = s.replace(',', '.');
  } else if (hasDot) {
    // Više točaka → tisućice. Jedna točka + 3 znamenke iza → tisućice. Inače decimala.
    const parts = s.split('.');
    if (parts.length > 2) s = parts.join('');
    else if (parts.length === 2 && parts[1].length === 3 && parts[0].length > 0) s = parts.join('');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
function formatEUAmount(n) {
  if (n === null || n === undefined || isNaN(n) || n === '') return '';
  return FMT.format(Number(n));
}
function attachEUAmountMask(input, opts = {}) {
  if (!input) return;
  const initial = parseEUAmount(input.value);
  if (!isNaN(initial) && input.value !== '') {
    input.value = formatEUAmount(initial);
  }
  input.addEventListener('focus', e => {
    const n = parseEUAmount(e.target.value);
    if (n || e.target.value.trim()) {
      // Plain EU prikaz bez tisućica radi lakšeg uređivanja
      const fixed = (Math.round(n * 100) / 100);
      const str = (fixed === Math.floor(fixed)) ? String(fixed) : fixed.toFixed(2);
      e.target.value = str.replace('.', ',');
    }
    setTimeout(() => e.target.select?.(), 0);
  });
  input.addEventListener('input', e => {
    // Dopusti samo brojke, jednu zarezu, jednu točku, minus na početku
    let v = e.target.value;
    v = v.replace(/[^\d,\.\-]/g, '');
    // Minus samo na poziciji 0
    v = v.replace(/(?!^)-/g, '');
    // Maks jedan zarez
    const ci = v.indexOf(',');
    if (ci >= 0) v = v.slice(0, ci + 1) + v.slice(ci + 1).replace(/,/g, '');
    e.target.value = v;
  });
  input.addEventListener('blur', e => {
    const n = parseEUAmount(e.target.value);
    e.target.value = (n || e.target.value.trim()) ? formatEUAmount(n) : '';
  });
}

/* ---------- MONTH ARITHMETIC + PRUNE ---------- */
function addCalendarMonths(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function isMonthEmpty(key) {
  const trxEmpty = !state.trx[key] || state.trx[key].length === 0;
  const stoEmpty = !state.sto[key] || state.sto[key].length === 0;
  const h = state.hours[key];
  const hoursDayDataEmpty = !h || !h.days || h.days.length === 0 ||
    h.days.every(d => !d.workers || Object.keys(d.workers).every(n => {
      const w = d.workers[n];
      return !w || (!w.hours && !w.marenda);
    }));
  const extrasEmpty = !h || !h.extras || Object.keys(h.extras).length === 0;
  return trxEmpty && stoEmpty && hoursDayDataEmpty && extrasEmpty;
}
function pruneEmptyMonths() {
  const keys = new Set([
    ...Object.keys(state.trx || {}),
    ...Object.keys(state.sto || {}),
    ...Object.keys(state.hours || {}),
  ]);
  // Sačuvaj barem aktivni mjesec (da se ne sruši UI ako je trenutno otvoren prazan mjesec)
  for (const k of keys) {
    if (k === activeMonth) continue;
    if (isMonthEmpty(k)) {
      delete state.trx[k];
      delete state.sto[k];
      delete state.hours[k];
    }
  }
}


/* Build day list for a given month */
function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const date = new Date(y, m - 1, d);
    days.push({
      date: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      day: d,
      dayName: DAY_NAMES_HR[date.getDay()],
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }
  return days;
}

/* ---------- COMPUTATIONS ---------- */
function computeCashflowSummaryV3() {
  const months = allMonths();
  const summary = {};
  for (const key of months) {
    summary[key] = {
      prihodi: 0,
      tekuci: 0,
      nepredvideni: 0,
      pozajmica: 0,
    };
    for (const t of (state.trx[key] || [])) {
      if (t.group === 'Prihodi') summary[key].prihodi += t.amount;
      else if (t.group === 'Tekući') summary[key].tekuci += t.amount;
      else if (t.group === 'Nepredviđeni') summary[key].nepredvideni += t.amount;
    }
    summary[key].sto = (state.sto[key] || []).reduce((a, t) => a + t.amount, 0);
    summary[key].radnici = computeWorkersTotal(key);
    summary[key].troskoviUkupno = summary[key].tekuci + summary[key].nepredvideni + summary[key].sto + summary[key].radnici;
    summary[key].neto = summary[key].prihodi - summary[key].troskoviUkupno;
  }
  return summary;
}

function computeWorkersTotal(monthKey) {
  // Ukupni trošak rada za cashflow = Σ Mjesečni trošak svih radnika
  // + fiksne osobe (Postavke → Fiksni rad: Boris, Tata) — svaki mjesec.
  const stats = computeWorkerStats(monthKey);
  const fixedTotal = getFixedLabor().reduce((a, f) => a + (Number(f.amount) || 0), 0);
  return stats.reduce((a, s) => a + (s.mjesecniTrosak || 0), 0) + fixedTotal;
}

/* Vrati fiksno za radnika za zadani mjesec (YYYY-MM), uvažavajući povijest promjena.
   w.fiksnoHistory = [{ from: 'YYYY-MM', amount: number }, ...] (opcionalno).
   Ako nema povijesti, koristi se w.fiksno kao i dosad.
   Prikaz u tablici ostaje JEDNA brojka — povijest se rješava u pozadini. */
function fiksnoForMonth(w, monthKey) {
  const base = Number(w.fiksno) || 0;
  const hist = Array.isArray(w.fiksnoHistory) ? w.fiksnoHistory : null;
  if (!hist || hist.length === 0) return base;
  // Sortiraj po datumu uzlazno, nađi zadnji unos čiji 'from' <= monthKey
  const sorted = hist.slice().filter(e => e && e.from).sort((a, b) => a.from.localeCompare(b.from));
  let val = base;
  let matched = false;
  for (const e of sorted) {
    if (e.from <= monthKey) { val = Number(e.amount) || 0; matched = true; }
    else break;
  }
  // Ako nijedan 'from' nije <= monthKey, ostaje base (vrijednost prije prve promjene)
  return matched ? val : base;
}

/* ============================================================
   PERIOD RADA RADNIKA (Postavke › Radnici)
   w.zaposlenje = [{ od: 'YYYY-MM-DD' | '', do: 'YYYY-MM-DD' | '', puniMjesecOd?: true, puniMjesecDo?: true }]
   Bez polja = radnik je u timu od početka evidencije i dalje (stari podaci ostaju isti).
   Prazan 'od' = od početka evidencije; prazan 'do' = i dalje radi.
   Radnik se ne briše: izvan perioda rada ne ulazi u unos sati, isplatu, cashflow
   ni obračun projekata, a sva povijest ostaje. U mjesecu dolaska ili odlaska
   fiksno, prijevoz, stan i fiksna isplata idu razmjerno radnim danima (pon-pet)
   u periodu rada, osim ako je za taj rub odabran puni mjesec.
   ============================================================ */
const MONTH_GEN_HR = ['siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja', 'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca'];
const monthGenHr = (key) => MONTH_GEN_HR[parseInt(key.split('-')[1], 10) - 1];
const monthAccHr = (key) => { const i = parseInt(key.split('-')[1], 10) - 1; return i === 1 ? 'veljaču' : MONTH_NAMES_HR[i].toLowerCase(); };
const isoDateLocal = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const localTodayISO = () => isoDateLocal(new Date());
const addDaysISO = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); return isoDateLocal(new Date(y, m - 1, d + n)); };
const dmEU = (iso) => isoToEU(iso).slice(0, 5);
const monthBounds = (key) => {
  const [y, m] = key.split('-').map(Number);
  return { start: `${key}-01`, end: `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` };
};
const hrRadnihDana = (n) => (n % 10 === 1 && n % 100 !== 11) ? 'radni dan' : ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) ? 'radna dana' : 'radnih dana';
const WP_ICON_ODJAVA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';
const WP_ICON_VRATI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>';
const WP_ICON_INFO = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink: 0;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';

function workerPeriods(w) {
  const list = (w && Array.isArray(w.zaposlenje)) ? w.zaposlenje.filter(p => p && typeof p === 'object') : [];
  return list.length ? list : null;
}
/* Zadnji (tekući) period rada: onaj s najkasnijim početkom */
function workerLastPeriod(w) {
  const per = workerPeriods(w);
  if (!per) return null;
  return per.slice().sort((a, b) => (a.od || '').localeCompare(b.od || ''))[per.length - 1];
}
function workerActiveOn(w, iso) {
  const per = workerPeriods(w);
  if (!per) return true;
  return per.some(p => (!p.od || p.od <= iso) && (!p.do || iso <= p.do));
}
function workerActiveInRange(w, a, b) {
  const per = workerPeriods(w);
  if (!per) return true;
  return per.some(p => (!p.od || p.od <= b) && (!p.do || p.do >= a));
}
const workerActiveInMonth = (w, key) => { const { start, end } = monthBounds(key); return workerActiveInRange(w, start, end); };
/* Radnici koji ulaze u isplatu i troškove mjeseca */
const workersInMonth = (key) => (state.settings.workers || []).filter(w => workerActiveInMonth(w, key));
/* Radnici u prikazu Evidencije: oni u periodu rada i oni koji u mjesecu imaju upisane sate (ništa upisano ne nestaje s ekrana) */
function workersForMonthView(key) {
  const h = state.hours[key];
  const withData = new Set();
  if (h && Array.isArray(h.days)) {
    for (const d of h.days) {
      for (const [n, e] of Object.entries(d.workers || {})) {
        if (e && ((e.hours || 0) > 0 || (e.marenda || 0) > 0)) withData.add(n);
      }
    }
  }
  return (state.settings.workers || []).filter(w => workerActiveInMonth(w, key) || withData.has(w.name));
}
/* Udio mjeseca za fiksne iznose: radni dani u periodu rada ÷ radni dani mjeseca */
function workerMonthShare(w, key) {
  const ukupno = workdaysInMonth(key);
  const per = workerPeriods(w);
  if (!per || !ukupno) return { udio: 1, dana: ukupno, ukupno };
  const { start, end } = monthBounds(key);
  let dana = 0;
  for (const p of per) {
    let a = (p.od && p.od > start) ? p.od : start;
    let b = (p.do && p.do < end) ? p.do : end;
    if (p.puniMjesecOd && p.od && p.od > start && p.od <= end) a = start;
    if (p.puniMjesecDo && p.do && p.do >= start && p.do < end) b = end;
    if (a <= b) dana += radnihDana(a, b);
  }
  dana = Math.min(dana, ukupno);
  return { udio: dana / ukupno, dana, ukupno };
}
/* Dolazak ili odlazak unutar mjeseca (oznake "od 15/10" i "do 20/09") */
function workerMonthEdges(w, key) {
  const out = { od: '', do: '' };
  const per = workerPeriods(w);
  if (!per) return out;
  const { start, end } = monthBounds(key);
  for (const p of per) {
    if (p.od && p.od >= start && p.od <= end) out.od = p.od;
    if (p.do && p.do >= start && p.do <= end) out.do = p.do;
  }
  return out;
}
function workerYearEdges(w, year) {
  const out = { od: '', do: '' };
  const per = workerPeriods(w);
  if (!per) return out;
  const y = String(year);
  for (const p of per) {
    if (p.od && p.od.slice(0, 4) === y) out.od = p.od;
    if (p.do && p.do.slice(0, 4) === y) out.do = p.do;
  }
  return out;
}
const wpEdgeText = (e) => [e.od ? `od ${dmEU(e.od)}` : '', e.do ? `do ${dmEU(e.do)}` : ''].filter(Boolean).join(' ');
/* Tekući mjesec: dio perioda rada u mjesecu koji je već prošao (raspodjela troška po projektima) */
function workerElapsedShare(w, key, todayIso) {
  const { start, end } = monthBounds(key);
  let uMjesecu = 0, proslo = 0;
  for (const p of (workerPeriods(w) || [{ od: '', do: '' }])) {
    const a = (p.od && p.od > start) ? p.od : start;
    const b = (p.do && p.do < end) ? p.do : end;
    if (a > b) continue;
    uMjesecu += radnihDana(a, b);
    const b2 = b < todayIso ? b : todayIso;
    if (a <= b2) proslo += radnihDana(a, b2);
  }
  if (!uMjesecu) return 1;
  return Math.min(1, Math.max(proslo, 1) / uMjesecu);
}
/* Kapacitet sati mjeseca: radnici sa satnicom × radni dani u periodu rada × 8 h (do zadanog dana) */
function capacityHoursInMonth(key, upToISO) {
  const { start, end } = monthBounds(key);
  const last = (upToISO && upToISO < end) ? upToISO : end;
  let h = 0;
  for (const w of (state.settings.workers || [])) {
    if (!(Number(w.satnica) > 0)) continue;
    for (const p of (workerPeriods(w) || [{ od: '', do: '' }])) {
      const a = (p.od && p.od > start) ? p.od : start;
      const b = (p.do && p.do < last) ? p.do : last;
      if (a <= b) h += radnihDana(a, b) * 8;
    }
  }
  return h;
}
function workerIsFormer(w, todayIso) {
  const per = workerPeriods(w);
  return !!per && per.every(p => p.do && p.do < todayIso);
}
/* Ima li radnik ikakav upis (sati, godišnji, dug): takav se ne briše, nego odjavljuje */
function workerHasHistory(w) {
  const name = w && w.name;
  for (const k of Object.keys(state.hours || {})) {
    for (const d of ((state.hours[k] || {}).days || [])) {
      const e = (d.workers || {})[name];
      if (e && ((e.hours || 0) > 0 || (e.marenda || 0) > 0)) return true;
    }
  }
  const g = state.registar && state.registar.godisnji && state.registar.godisnji[name];
  if (g && (((g.periodi || []).length) || Number(g.ukupno) > 0)) return true;
  return (Number(w && w.dug) || 0) > 0;
}
function workerLastHoursDate(name) {
  let last = '';
  for (const k of Object.keys(state.hours || {})) {
    for (const d of ((state.hours[k] || {}).days || [])) {
      const e = (d.workers || {})[name];
      if (e && (e.hours || 0) > 0 && d.date > last) last = d.date;
    }
  }
  return last;
}
function workerHoursDaysAfter(name, iso) {
  let n = 0;
  for (const k of Object.keys(state.hours || {})) {
    for (const d of ((state.hours[k] || {}).days || [])) {
      const e = (d.workers || {})[name];
      if (e && (e.hours || 0) > 0 && d.date > iso) n++;
    }
  }
  return n;
}
function workerPeriodText(w) {
  const lp = workerLastPeriod(w);
  if (!lp) return 'od početka';
  const parts = [lp.od ? `od ${isoToEU(lp.od)}` : 'od početka'];
  if (lp.do) parts.push(`do ${isoToEU(lp.do)}`);
  return parts.join(' · ');
}
/* Iznos u Sažetku isplate koji je razmjeran periodu rada: točkasto podcrtan, puni iznos u opisu */
function wpProrata(txt, s, punoTxt) {
  if (!s || !(s.udio < 1)) return txt;
  return `<span class="wp-prorata" title="Razmjerno: ${s.radnihUPeriodu}/${s.radnihUMjesecu} radnih dana · puni iznos ${punoTxt}">${txt}</span>`;
}
function wpThSub(w, key) {
  const t = wpEdgeText(workerMonthEdges(w, key));
  if (t) return `<div class="wp-th-sub">${t}</div>`;
  if (!workerActiveInMonth(w, key)) return '<div class="wp-th-sub">van perioda</div>';
  return '';
}

function computeWorkerStats(monthKey) {
  const h = state.hours[monthKey];
  if (!h || !h.days) return [];
  return workersInMonth(monthKey).map(w => {
    let autoTotalHours = 0, totalMarenda = 0, daysWorked = 0;
    for (const d of h.days) {
      const wd = d.workers && d.workers[w.name];
      if (wd && wd.hours > 0 && workerActiveOn(w, d.date)) {
        autoTotalHours += wd.hours;
        totalMarenda += wd.marenda || 0;
        daysWorked++;
      }
    }
    // Sati override: stored as { hoursOverride: number } in extras[name]
    const extra = h.extras && h.extras[w.name];
    let totalHours = autoTotalHours;
    let isHoursOverridden = false;
    if (extra !== null && extra !== undefined && typeof extra === 'object' && 'hoursOverride' in extra) {
      totalHours = Number(extra.hoursOverride) || 0;
      isHoursOverridden = Math.abs(totalHours - autoTotalHours) > 0.005;
    }

    // Fiksno za OVAJ mjesec (uvažava povijest promjena)
    const fiksnoPuno = fiksnoForMonth(w, monthKey);
    // Period rada: u mjesecu dolaska ili odlaska fiksni iznosi idu razmjerno radnim danima u periodu
    const share = workerMonthShare(w, monthKey);
    const pr = (v) => share.udio < 1 ? round2((Number(v) || 0) * share.udio) : (Number(v) || 0);
    const fiksno = pr(fiksnoPuno);
    const prijevoz = pr(w.prijevoz);
    const stan = pr(w.stan);
    const edges = workerMonthEdges(w, monthKey);

    const zaradaSati = totalHours * w.satnica;
    // Auto-formula: ako radnik ima satnicu > 0 → Dodatno = Zarada + Marenda − Fiksno
    //               ako satnica = 0 (npr. Dragan) → Dodatno je ručni unos (legacy plain number u extras)
    const isAutoCalculated = w.satnica > 0;
    let dodatno;
    if (isAutoCalculated) {
      dodatno = zaradaSati + totalMarenda - fiksno;
    } else if (typeof extra === 'number') {
      dodatno = extra;
    } else if (extra && typeof extra === 'object' && 'manual' in extra) {
      dodatno = Number(extra.manual) || 0;
    } else {
      dodatno = 0;
    }
    // Fiksna isplata (npr. Dragan): ako je postavljena (> 0) u Postavke → Radnici,
    // radnik SVAKI mjesec ima točno taj iznos za isplatu. Sati, marenda i prijevoz
    // tada ne ulaze u obračun keš isplate (sve je uključeno u fiksni iznos).
    const isFixedPayout = (Number(w.fiksnaIsplata) || 0) > 0;
    const fiksnaIsplata = pr(w.fiksnaIsplata);
    // Za isplatu = Dodatno + Prijevoz (Marenda je već u Dodatno; Stan ide preko firme, NE ovdje).
    // Nikad ispod 0: radnik ne može biti dužan firmi kroz isplatu.
    const zaIsplatuRaw = isFixedPayout ? fiksnaIsplata : (dodatno + prijevoz);
    const zaIsplatu = Math.max(0, zaIsplatuRaw);
    // Mjesečni trošak (ukupni izdatak firme) = Za isplatu + Fiksno + Stan
    const mjesecniTrosak = zaIsplatu + fiksno + stan;
    // Dug radnika (ako postoji) — ne utječe na izračune, samo prikaz
    const dug = Number(w.dug) || 0;
    return {
      name: w.name,
      satnica: w.satnica,
      totalHours,
      autoTotalHours,
      isHoursOverridden,
      totalMarenda,
      daysWorked,
      zaradaSati,
      prijevoz,
      stan,
      fiksno,
      dodatno,
      isAutoCalculated,
      mjesecniTrosak,
      zaIsplatu,
      zaIsplatuRaw,
      isFixedPayout,
      fiksnaIsplata,
      dug,
      udio: share.udio,
      radnihUPeriodu: share.dana,
      radnihUMjesecu: share.ukupno,
      fiksnoPuno,
      prijevozPuno: Number(w.prijevoz) || 0,
      stanPuno: Number(w.stan) || 0,
      fiksnaIsplataPuno: Number(w.fiksnaIsplata) || 0,
      radiOd: edges.od,
      radiDo: edges.do,
    };
  });
}

function computeAccountBalance() {
  const limit = state.company?.limit_racuna || 30000;
  let saldo = 0;
  const months = allMonths();
  for (const key of months) {
    for (const t of (state.trx[key] || [])) {
      if (t.group === 'Isključi') continue;
      if (t.type === 'Prihod') saldo += t.amount;
      else if (t.type === 'Trošak') saldo -= t.amount;
    }
    saldo -= (state.sto[key] || []).reduce((a, t) => a + t.amount, 0);
    saldo -= computeWorkersTotal(key);
  }
  return { limit, saldo, dostupno: limit + saldo };
}

/* ============================================================
   TAB ROUTING
   ============================================================ */
function setTab(tab) {
  activeTab = tab;
  document.body.dataset.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  // Destroy all charts to avoid memory leak
  Object.values(charts).forEach(c => c?.destroy?.());
  Object.keys(charts).forEach(k => delete charts[k]);
  rerenderActive();
}

function rerenderActive() {
  if (activeTab === 'cashflow') renderCashflow();
  else if (activeTab === 'forecast') renderForecast();
  else if (activeTab === 'hours') renderHours();
  else if (activeTab === 'trx') renderTrx();
  else if (activeTab === 'sto') renderSto();
  else if (activeTab === 'projects') renderProjects();
  else if (activeTab === 'raspored') renderRaspored();
  else if (activeTab === 'registar') renderRegistar();
  else if (activeTab === 'settings') renderSettings();
}

/* ============================================================
   MONTH PICKER
   ============================================================ */
function buildMonthPicker(currentKey, _onChange, options = {}) {
  // Returns HTML only. Use bindMonthPicker(panel, ...) after innerHTML.
  // Navigacija ide po kalendaru (±1 mjesec), neovisno o tome postoje li podaci.
  return `
    <div class="month-picker" data-month="${currentKey}">
      <button data-act="prev" aria-label="Prethodni">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="month-label">${monthLabel(currentKey)}</span>
      <button data-act="next" aria-label="Sljedeći">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      ${options.allowAdd && isAdmin ? `<button data-act="add" title="Skok na sljedeći nepostojeći mjesec" aria-label="Dodaj">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>` : ''}
    </div>
  `;
}

function bindMonthPicker(panel, currentKey, onChange, options = {}) {
  const root = panel.querySelector('.month-picker');
  if (!root) return;
  root.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'prev') onChange(addCalendarMonths(currentKey, -1));
    else if (act === 'next') onChange(addCalendarMonths(currentKey, 1));
    else if (act === 'add') addNewMonth(onChange);
  });
}

function addNewMonth(onChange) {
  // Skok na sljedeći mjesec koji nema podataka — koristan za eksplicitno otvaranje budućeg mjeseca
  const months = allMonths();
  const last = months.length ? months[months.length - 1] : '2026-01';
  const newKey = addCalendarMonths(last, 1);
  ensureMonth(newKey);
  activeMonth = newKey;
  onChange(newKey);
  toast(`Otvoren mjesec ${monthLabel(newKey)}`, 'success');
}

/* ============================================================
   SAVE WRAPPER
   ============================================================ */
async function saveData() {
  try {
    if (!state.forecast) state.forecast = [];
    if (!state.raspored) state.raspored = [];
    if (!state.obracun || typeof state.obracun !== 'object' || Array.isArray(state.obracun)) state.obracun = {};
    ensureStoStanje();
    pruneEmptyMonths();
    await API.save(state);
    toast('Spremljeno', 'success', 1500);
    return true;
  } catch (e) {
    toast(e.message || 'Spremanje nije uspjelo', 'error');
    return false;
  }
}

/* ============================================================
   RENDER: CASHFLOW
   ============================================================ */
function renderCashflow() {
  const summary = computeCashflowSummary();
  const months = allMonths();

  // YTD totals (used in tablica footer only)
  const ytd = months.reduce((a, k) => ({
    prihodi: a.prihodi + summary[k].prihodi,
    tekuci: a.tekuci + summary[k].tekuci,
    nepredvideni: a.nepredvideni + summary[k].nepredvideni,
    sto: a.sto + summary[k].sto,
    radnici: a.radnici + summary[k].radnici,
    troskovi: a.troskovi + summary[k].troskoviUkupno,
    neto: a.neto + summary[k].neto,
  }), { prihodi: 0, tekuci: 0, nepredvideni: 0, sto: 0, radnici: 0, troskovi: 0, neto: 0 });

  const panel = document.getElementById('panel-cashflow');
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">YTD · Godina 2026</div>
        <h1 class="page-title">Cashflow <em>sažetak</em></h1>
      </div>
    </div>

    <div class="grid grid-cf" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Mjesečni pregled</div>
            <div class="card-sub">Prihodi vs. troškovi po mjesecu</div>
          </div>
        </div>
        <div class="chart-box tall"><canvas id="cf-chart-monthly"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Struktura troškova</div>
            <div class="card-sub">YTD raspodjela</div>
          </div>
        </div>
        <div class="chart-box tall"><canvas id="cf-chart-donut"></canvas></div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Mjesečna razrada</div>
          <div class="card-sub">Klikni mjesec za detaljan pregled u Trx tabu</div>
        </div>
      </div>
      <div class="cf-mcards mob-only">
        ${months.map(k => {
          const s = summary[k];
          const total = s.prihodi + s.troskoviUkupno;
          const pctIn = total > 0 ? (s.prihodi / total) * 100 : 0;
          const netoColor = s.neto < 0 ? 'var(--negative)' : s.neto > 0 ? 'var(--positive)' : 'var(--muted)';
          return `
          <div class="cf-mcard" data-month="${k}">
            <div class="cf-mcard-head">
              <span class="cf-mcard-month">${monthLabelShort(k)}</span>
              <span class="cf-mcard-neto" style="color: ${netoColor};">${s.neto >= 0 ? '+' : ''}${eur(s.neto, 0)}</span>
            </div>
            <div class="cf-mcard-line">
              <span>Prihodi <span class="num" style="color: var(--positive);">${FMT_INT.format(s.prihodi)}</span></span>
              <span>Troškovi <span class="num" style="color: var(--negative);">${FMT_INT.format(s.troskoviUkupno)}</span></span>
            </div>
            <div class="cf-mcard-bar">
              <div class="in" style="width: ${pctIn.toFixed(1)}%;"></div>
              <div class="out" style="width: ${(100 - pctIn).toFixed(1)}%;"></div>
            </div>
            <div class="cf-mcard-breakdown">Tekući ${FMT_INT.format(s.tekuci)} · Nepr. ${FMT_INT.format(s.nepredvideni)} · STO ${FMT_INT.format(s.sto)} · Radnici ${FMT_INT.format(s.radnici)}</div>
          </div>`;
        }).join('')}
        <div class="cf-mcard ytd">
          <span class="cf-mcard-month">YTD ukupno</span>
          <span class="cf-mcard-neto" style="color: var(--${ytd.neto < 0 ? 'negative' : 'positive'});">${ytd.neto >= 0 ? '+' : ''}${eur(ytd.neto, 0)}</span>
        </div>
      </div>
      <div class="table-scroll desk-only">
        <table class="table">
          <thead>
            <tr>
              <th>Mjesec</th>
              <th class="text-right">Prihodi</th>
              <th class="text-right">Tekući</th>
              <th class="text-right">Nepredv.</th>
              <th class="text-right">STO</th>
              <th class="text-right">Radnici</th>
              <th class="text-right">Troškovi</th>
              <th class="text-right">Neto</th>
            </tr>
          </thead>
          <tbody>
            ${months.map(k => {
              const s = summary[k];
              const cls = s.neto < 0 ? 'negative' : s.neto > 0 ? 'positive' : 'muted';
              return `
                <tr style="cursor: pointer;" data-month="${k}">
                  <td><strong>${monthLabel(k)}</strong></td>
                  <td class="num text-right">${eur(s.prihodi, 0)}</td>
                  <td class="num text-right">${eur(s.tekuci, 0)}</td>
                  <td class="num text-right">${eur(s.nepredvideni, 0)}</td>
                  <td class="num text-right">${eur(s.sto, 0)}</td>
                  <td class="num text-right">${eur(s.radnici, 0)}</td>
                  <td class="num text-right">${eur(s.troskoviUkupno, 0)}</td>
                  <td class="num text-right" style="color: var(--${cls === 'negative' ? 'negative' : cls === 'positive' ? 'positive' : 'muted'}); font-weight: 600;">${eur(s.neto, 0)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>YTD</td>
              <td class="num text-right">${eur(ytd.prihodi, 0)}</td>
              <td class="num text-right">${eur(ytd.tekuci, 0)}</td>
              <td class="num text-right">${eur(ytd.nepredvideni, 0)}</td>
              <td class="num text-right">${eur(ytd.sto, 0)}</td>
              <td class="num text-right">${eur(ytd.radnici, 0)}</td>
              <td class="num text-right">${eur(ytd.troskovi, 0)}</td>
              <td class="num text-right" style="color: var(--${ytd.neto < 0 ? 'negative' : 'positive'});">${eur(ytd.neto, 0)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${cashflowPlaceNapomenaHtml(summary, months)}
    </div>
  `;

  // Click row → switch to Trx tab
  panel.querySelectorAll('tbody tr[data-month], .cf-mcard[data-month]').forEach(tr => {
    tr.addEventListener('click', () => {
      activeMonth = tr.dataset.month;
      setTab('trx');
    });
  });

  // CHART: monthly bars
  const ctx1 = document.getElementById('cf-chart-monthly');
  charts.cfMonthly = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: months.map(monthLabelShort),
      datasets: [
        { label: 'Prihodi', data: months.map(k => summary[k].prihodi), backgroundColor: cssVar('--positive') + 'cc', borderRadius: 6 },
        { label: 'Troškovi', data: months.map(k => summary[k].troskoviUkupno), backgroundColor: cssVar('--negative') + 'cc', borderRadius: 6 },
        { type: 'line', label: 'Neto', data: months.map(k => summary[k].neto), borderColor: cssVar('--acc-cashflow'), backgroundColor: cssVar('--acc-cashflow'), tension: 0.3, pointRadius: 4, pointHoverRadius: 6, borderWidth: 2 },
      ],
    },
    options: chartOpts({
      legend: true,
      money: true,
    }),
  });

  // CHART: donut
  const ctx2 = document.getElementById('cf-chart-donut');
  charts.cfDonut = new Chart(ctx2, {
    type: 'doughnut',
    data: {
      labels: ['Tekući', 'Nepredviđeni', 'STO materijal', 'Radnici'],
      datasets: [{
        data: [ytd.tekuci, ytd.nepredvideni, ytd.sto, ytd.radnici],
        backgroundColor: [cssVar('--acc-cashflow'), cssVar('--acc-trx'), cssVar('--acc-sto'), cssVar('--acc-hours')],
        borderWidth: 2,
        borderColor: cssVar('--surface'),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: cssVar('--font-body'), size: 12 }, padding: 14, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: { callbacks: { label: c => c.label + ': ' + eur(c.raw, 0) } },
      },
    },
  });
}

/* Shared chart options */
function chartOpts(opts = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: opts.legend ? { position: 'top', align: 'end', labels: { font: { family: cssVar('--font-body'), size: 12 }, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } } : { display: false },
      tooltip: {
        backgroundColor: cssVar('--ink'),
        padding: 12,
        titleFont: { family: cssVar('--font-body'), weight: 600, size: 13 },
        bodyFont: { family: cssVar('--font-mono'), size: 12 },
        callbacks: {
          label: c => {
            const lbl = c.dataset.label ? c.dataset.label + ': ' : '';
            return lbl + (opts.money ? eur(c.raw, 0) : c.raw);
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { family: cssVar('--font-body'), size: 11 }, color: cssVar('--muted') } },
      y: {
        grid: { color: cssVar('--line'), drawBorder: false },
        ticks: { font: { family: cssVar('--font-mono'), size: 11 }, color: cssVar('--muted'), callback: v => opts.money ? eurShort(v) : v },
      },
    },
  };
}

/* ============================================================
   RENDER: HOURS (evidencija sati) — kompletni redizajn
   ============================================================ */
function renderHours() {
  const months = allMonths().filter(m => state.hours[m]);
  if (!months.includes(activeMonth)) {
    activeMonth = months[months.length - 1] || activeMonth;
    ensureMonth(activeMonth);
  }
  const days = daysInMonth(activeMonth);
  const h = state.hours[activeMonth] || { days: [], extras: {} };
  const stats = computeWorkerStats(activeMonth);
  const fixed = getFixedLabor();
  const fixedTotal = fixed.reduce((a, f) => a + (Number(f.amount) || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const workers = workersForMonthView(activeMonth);

  const panel = document.getElementById('panel-hours');
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">${monthLabel(activeMonth)}</div>
        <h1 class="page-title">Evidencija <em>sati</em></h1>
      </div>
      <div class="page-actions">
        ${buildMonthPicker(activeMonth, null, { allowAdd: true })}
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Sažetak isplate · ${monthLabelShort(activeMonth)}</div>
          <div class="card-sub">Po radniku · fiksne osobe (Postavke → Fiksni rad) ulaze u Mj. trošak, bez sati i bez keš isplate</div>
        </div>
        <div class="page-actions">
          <span class="pill green">Σ Za isplatu: <strong style="margin-left: 4px;">${eur(stats.reduce((a, s) => a + s.zaIsplatu, 0), 0)}</strong></span>
          <span class="pill gray">Σ Mj. trošak: <strong style="margin-left: 4px;">${eur(stats.reduce((a, s) => a + s.mjesecniTrosak, 0) + fixedTotal, 0)}</strong></span>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table payroll-table">
          <thead>
            <tr>
              <th>Radnik</th>
              <th class="text-right">Sati</th>
              <th class="text-right">Satnica</th>
              <th class="text-right">Zarada</th>
              <th class="text-right zone-kes zone-kes-first">Marenda</th>
              <th class="text-right zone-kes">Prijevoz</th>
              <th class="text-right zone-kes zone-kes-total">Za isplatu</th>
              <th class="text-right zone-firma zone-firma-first">Fiksno</th>
              <th class="text-right zone-firma">Stan</th>
              <th class="text-right">Mj. trošak</th>
            </tr>
          </thead>
          <tbody>
            ${stats.map(s => {
              return `
              <tr>
                <td>
                  <strong>${escapeHtml(s.name)}</strong>
                  ${(s.radiOd || s.radiDo) ? `<span class="pill amber" style="margin-left: 6px;" title="Period rada${s.radiOd ? ' · prvi radni dan ' + isoToEU(s.radiOd) : ''}${s.radiDo ? ' · zadnji radni dan ' + isoToEU(s.radiDo) : ''}">${wpEdgeText({ od: s.radiOd, do: s.radiDo })}</span>` : ''}
                  ${s.isFixedPayout ? `<span class="pill gray" style="margin-left: 6px;" title="Fiksna isplata: uvijek ${eur(s.fiksnaIsplataPuno, 0)} svaki mjesec">fiksno</span>` : ''}
                  ${s.dug > 0
                    ? `<span class="dug-badge ${isAdmin ? 'editable' : ''}" data-dug-worker="${escapeHtml(s.name)}" title="${isAdmin ? 'Klikni za izmjenu duga' : 'Dug radnika'}">dug ${eur(s.dug, 0)}</span>`
                    : (isAdmin ? `<span class="dug-badge add editable" data-dug-worker="${escapeHtml(s.name)}" title="Dodaj dug">+ dug</span>` : '')}
                  ${s.udio < 1 ? `<span class="wp-caption">${s.isFixedPayout ? 'fiksna isplata, ' : ''}fiksno, prijevoz i stan · ${s.radnihUPeriodu}/${s.radnihUMjesecu} radnih dana</span>` : ''}
                </td>
                <td class="num text-right">
                  ${(() => {
                    if (!isAdmin) {
                      return `<strong>${s.totalHours}</strong>${s.isHoursOverridden ? ` <span class="dodatno-mark-readonly" title="Ručno postavljeno · auto bi bilo ${s.autoTotalHours}">✎</span>` : ''}`;
                    }
                    const tooltipText = s.isHoursOverridden
                      ? `Auto bi bilo: ${s.autoTotalHours} · klikni × za reset`
                      : `Auto: zbroj iz dnevne tablice · klikni za ručnu izmjenu`;
                    return `<div class="dodatno-cell ${s.isHoursOverridden ? 'overridden' : ''}" title="${escapeHtml(tooltipText)}">
                      ${s.isHoursOverridden ? `<button class="dodatno-reset" data-reset-hours="${escapeHtml(s.name)}" title="Vrati na auto (${s.autoTotalHours})" aria-label="Reset">×</button>` : ''}
                      <input class="input cell-edit hours-input" type="number" step="0.5" value="${s.totalHours}" data-hours-worker="${escapeHtml(s.name)}" data-auto-hours="${s.autoTotalHours}" style="width: 72px;">
                      ${s.isHoursOverridden ? `<span class="dodatno-mark" title="Ručno postavljeno">✎</span>` : ''}
                    </div>`;
                  })()}
                </td>
                <td class="num text-right muted-cell">${s.isFixedPayout ? '—' : eur(s.satnica, 2)}</td>
                <td class="num text-right${s.isFixedPayout ? ' muted-cell' : ''}">${s.isFixedPayout ? '—' : eur(s.zaradaSati, 2)}</td>
                <td class="num text-right zone-kes zone-kes-first${s.isFixedPayout ? ' muted-cell' : ''}">${s.isFixedPayout ? '—' : eur(s.totalMarenda, 0)}</td>
                <td class="num text-right zone-kes${s.isFixedPayout ? ' muted-cell' : ''}">${s.isFixedPayout ? '—' : wpProrata(eur(s.prijevoz, 0), s, eur(s.prijevozPuno, 0))}</td>
                <td class="num text-right zone-kes zone-kes-total">${
                  s.isFixedPayout
                    ? (s.udio < 1 ? wpProrata(eur(s.zaIsplatu, 2), s, eur(s.fiksnaIsplataPuno, 2)) : `<span title="Fiksna isplata: uvijek isti iznos, svaki mjesec (Postavke → Radnici)">${eur(s.zaIsplatu, 2)}</span>`)
                    : (s.zaIsplatuRaw < 0
                        ? `<span class="zero-clamp" title="Izračun bi bio ${eur(s.zaIsplatuRaw, 2)} · isplata ne može biti negativna, pa je 0. Razlika se ne prenosi.">${eur(0, 2)}</span>`
                        : eur(s.zaIsplatu, 2))
                }</td>
                <td class="num text-right zone-firma zone-firma-first">${wpProrata(eur(s.fiksno, 0), s, eur(s.fiksnoPuno, 0))}</td>
                <td class="num text-right zone-firma" style="${s.stan > 0 ? '' : 'color: var(--muted-2);'}">${s.stan > 0 ? wpProrata(eur(s.stan, 0), s, eur(s.stanPuno, 0)) : eur(s.stan, 0)}</td>
                <td class="num text-right" style="font-weight: 600;">${eur(s.mjesecniTrosak, 2)}</td>
              </tr>
            `;}).join('')}
              ${fixed.map(f => `
              <tr style="background: var(--surface-2);">
                <td><strong>${escapeHtml(f.name)}</strong> <span class="pill gray" style="margin-left: 6px;">fiksno</span></td>
                <td class="num text-right muted-cell">—</td>
                <td class="num text-right muted-cell">—</td>
                <td class="num text-right muted-cell">—</td>
                <td class="num text-right zone-kes zone-kes-first muted-cell">—</td>
                <td class="num text-right zone-kes muted-cell">—</td>
                <td class="num text-right zone-kes zone-kes-total muted-cell">—</td>
                <td class="num text-right zone-firma zone-firma-first">${eur(f.amount, 0)}</td>
                <td class="num text-right zone-firma muted-cell">—</td>
                <td class="num text-right" style="font-weight: 600;">${eur(f.amount, 2)}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>UKUPNO</td>
              <td class="num text-right"><strong>${stats.reduce((a, s) => a + s.totalHours, 0)}</strong></td>
              <td></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + (s.isFixedPayout ? 0 : s.zaradaSati), 0), 2)}</strong></td>
              <td class="num text-right zone-kes zone-kes-first"><strong>${eur(stats.reduce((a, s) => a + (s.isFixedPayout ? 0 : s.totalMarenda), 0), 0)}</strong></td>
              <td class="num text-right zone-kes"><strong>${eur(stats.reduce((a, s) => a + (s.isFixedPayout ? 0 : s.prijevoz), 0), 0)}</strong></td>
              <td class="num text-right zone-kes zone-kes-total"><strong>${eur(stats.reduce((a, s) => a + s.zaIsplatu, 0), 2)}</strong></td>
              <td class="num text-right zone-firma zone-firma-first"><strong>${eur(stats.reduce((a, s) => a + s.fiksno, 0) + fixedTotal, 0)}</strong></td>
              <td class="num text-right zone-firma"><strong>${eur(stats.reduce((a, s) => a + s.stan, 0), 0)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.mjesecniTrosak, 0) + fixedTotal, 2)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="payroll-formula">
        Zarada = Sati × Satnica&nbsp;&nbsp;·&nbsp;&nbsp;<span style="color: var(--positive);">Za isplatu = Zarada + Marenda + Prijevoz − Fiksno</span> (nikad ispod 0)&nbsp;&nbsp;·&nbsp;&nbsp;Mj. trošak = Za isplatu + Fiksno + Stan&nbsp;&nbsp;·&nbsp;&nbsp;Radnici s oznakom „fiksno": uvijek isti iznos za isplatu, svaki mjesec (Postavke → Radnici → Fiksna isplata)&nbsp;&nbsp;·&nbsp;&nbsp;Fiksne osobe: Mj. trošak = fiksni iznos (Postavke → Fiksni rad)&nbsp;&nbsp;·&nbsp;&nbsp;Mjesec dolaska ili odlaska: fiksno, prijevoz i stan razmjerno radnim danima u periodu rada (Postavke → Radnici → Period rada)
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Dnevni unos sati</div>
          <div class="card-sub">${isAdmin ? 'Klikni red dana za brzi unos · Tab za navigaciju · Cmd+← / Cmd+→ za prethodni/sljedeći dan' : 'Pregled · za izmjene aktiviraj admin mod'}</div>
        </div>
      </div>
      <div class="hrs-mcards mob-only">
        ${days.map(d => {
          const dayData = h.days.find(x => x.date === d.date);
          const isToday = d.date === today;
          const note = dayData?.note || '';
          let sum = 0;
          const chips = workers.map(w => {
            const wd = (dayData?.workers || {})[w.name];
            if (!wd || !(wd.hours > 0)) return '';
            if (!workerActiveOn(w, d.date)) return `<span class="hrs-chip wp-off" title="${escapeHtml(w.name)} tog dana nije u periodu rada · sati se ne računaju">${escapeHtml(w.name)} ${wd.hours}</span>`;
            sum += wd.hours;
            return `<span class="hrs-chip">${escapeHtml(w.name)} ${wd.hours}</span>`;
          }).join('');
          const isEmpty = sum === 0 && !note;
          if (isEmpty) {
            return `
            <div class="hrs-mcard empty ${isAdmin ? 'clickable' : ''}" data-mdate="${d.date}">
              <div class="hrs-mcard-head">
                <span class="hrs-mday"><strong>${d.day}.</strong> ${d.dayName}</span>
                <span style="font-size: 12px; color: var(--muted-2);">—</span>
              </div>
            </div>`;
          }
          return `
          <div class="hrs-mcard ${isToday ? 'today' : ''} ${isAdmin ? 'clickable' : ''}" data-mdate="${d.date}">
            <div class="hrs-mcard-head">
              <span class="hrs-mday"><strong>${d.day}.</strong> <span style="color: var(--muted);">${d.dayName}</span>${isToday ? '<span class="hrs-today-pill">danas</span>' : ''}</span>
              <span class="hrs-msum">${sum} h</span>
            </div>
            ${chips ? `<div class="hrs-chips">${chips}</div>` : ''}
            ${note ? `<div class="hrs-mnote">📝 ${escapeHtml(note)}</div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <div class="hours-table-wrap desk-only">
        <div class="hours-scroll">
          <table class="hours-table hours-table-v2">
            <thead>
              <tr>
                <th>Datum</th>
                ${workers.map(w => `<th class="worker-col">${escapeHtml(w.name)}${wpThSub(w, activeMonth)}</th>`).join('')}
                <th>Σ Dan</th>
              </tr>
            </thead>
            <tbody>
              ${days.map(d => {
                const dayData = h.days.find(x => x.date === d.date);
                const isWk = d.isWeekend;
                const isToday = d.date === today;
                const note = dayData?.note || '';
                let dailySum = 0;
                const cells = workers.map(w => {
                  const wd = (dayData?.workers || {})[w.name] || { hours: 0, marenda: 0, project: '' };
                  if (!workerActiveOn(w, d.date)) {
                    return `<td class="hcell wp-off" title="${escapeHtml(w.name)} tog dana nije u periodu rada${wd.hours > 0 ? ' · upisani sati se ne računaju' : ''}">${wd.hours > 0 ? `<div class="hc-top"><span class="hc-hours">${wd.hours}</span><span class="hc-mar">${wd.marenda || 0}</span></div>` : ''}</td>`;
                  }
                  if (wd.hours > 0) dailySum += wd.hours;
                  if (wd.hours === 0 && !wd.project) {
                    return `<td class="hcell empty"><span class="hc-dash">—</span></td>`;
                  }
                  return `
                    <td class="hcell ${wd.hours > 0 ? 'has-hours' : ''}">
                      <div class="hc-top">
                        <span class="hc-hours">${wd.hours || 0}</span>
                        <span class="hc-mar">${wd.marenda || 0}</span>
                      </div>
                      ${wd.project ? `<div class="hc-proj">${escapeHtml(wd.project)}</div>` : ''}
                    </td>
                  `;
                }).join('');
                return `
                  <tr class="day-row ${isWk ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isAdmin ? 'clickable' : ''}" data-date="${d.date}">
                    <td class="day-cell">
                      <div class="day-head">
                        <span class="day-num">${d.day}.</span>
                        <span class="day-name">${d.dayName}</span>
                      </div>
                      ${note ? `<div class="day-note" title="${escapeHtml(note)}">📝 ${escapeHtml(note)}</div>` : (isAdmin ? `<div class="day-note empty">+ napomena</div>` : '')}
                    </td>
                    ${cells}
                    <td class="hcell sum"><strong>${dailySum > 0 ? dailySum : ''}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>Ukupno</td>
                ${workers.map(w => {
                  const s = stats.find(x => x.name === w.name);
                  return `<td class="hcell sum">
                    <div class="hc-top"><strong>${s?.totalHours || 0}</strong><span class="hc-mar">${s?.totalMarenda || 0}</span></div>
                  </td>`;
                }).join('')}
                <td class="hcell sum"><strong>${stats.reduce((a, s) => a + s.totalHours, 0)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>

    <div class="grid grid-cf" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Sati po radniku</div>
            <div class="card-sub">${monthLabelShort(activeMonth)} · ukupno odrađenih sati</div>
          </div>
        </div>
        <div class="chart-box"><canvas id="hr-chart-bars"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Dnevna dinamika</div>
            <div class="card-sub">Ukupno sati svih radnika po danu</div>
          </div>
        </div>
        <div class="chart-box"><canvas id="hr-chart-daily"></canvas></div>
      </div>
    </div>
  `;

  // Click row → open day modal (admin only)
  if (isAdmin) {
    panel.querySelectorAll('.day-row.clickable').forEach(tr => {
      tr.addEventListener('click', (e) => {
        // Don't open if user clicked on something interactive
        if (e.target.closest('input, button, select')) return;
        openDayModal(tr.dataset.date);
      });
    });
    panel.querySelectorAll('.hrs-mcard.clickable').forEach(c => {
      c.addEventListener('click', () => openDayModal(c.dataset.mdate));
    });
    // Sati override handler
    panel.querySelectorAll('input[data-hours-worker]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const w = inp.dataset.hoursWorker;
        const autoVal = parseFloat(inp.dataset.autoHours) || 0;
        const newVal = parseFloat(inp.value) || 0;
        ensureMonth(activeMonth);
        if (!state.hours[activeMonth].extras) state.hours[activeMonth].extras = {};
        const cur = state.hours[activeMonth].extras[w];

        if (Math.abs(newVal - autoVal) < 0.005) {
          // Reverted to auto → remove hoursOverride
          if (cur && typeof cur === 'object') {
            delete cur.hoursOverride;
            if (Object.keys(cur).length === 0) delete state.hours[activeMonth].extras[w];
          }
        } else {
          // Set override, preserve other keys (e.g. manual for Dragan if exists)
          if (cur && typeof cur === 'object') {
            cur.hoursOverride = newVal;
          } else if (typeof cur === 'number') {
            // Dragan legacy: was plain number → wrap into object
            state.hours[activeMonth].extras[w] = { manual: cur, hoursOverride: newVal };
          } else {
            state.hours[activeMonth].extras[w] = { hoursOverride: newVal };
          }
        }
        if (await saveData()) renderHours();
      });
    });
    // Reset hours override
    panel.querySelectorAll('button[data-reset-hours]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const w = btn.dataset.resetHours;
        ensureMonth(activeMonth);
        const cur = state.hours[activeMonth].extras?.[w];
        if (cur && typeof cur === 'object' && 'hoursOverride' in cur) {
          delete cur.hoursOverride;
          if (Object.keys(cur).length === 0) delete state.hours[activeMonth].extras[w];
          if (await saveData()) renderHours();
        }
      });
    });
    // Dug badge: click to edit
    panel.querySelectorAll('.dug-badge.editable').forEach(badge => {
      badge.addEventListener('click', () => {
        const wName = badge.dataset.dugWorker;
        openDugModal(wName);
      });
    });
  }

  bindMonthPicker(panel, activeMonth, (m) => { activeMonth = m; ensureMonth(m); renderHours(); }, { allowAdd: true });

  // CHART: bars
  const ctx1 = document.getElementById('hr-chart-bars');
  charts.hrBars = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: stats.map(s => s.name),
      datasets: [{
        label: 'Sati',
        data: stats.map(s => s.totalHours),
        backgroundColor: stats.map((_, i) => PROJECT_PALETTE[i % PROJECT_PALETTE.length]),
        borderRadius: 6,
      }],
    },
    options: chartOpts({ legend: false, money: false }),
  });

  // CHART: daily line
  const ctx2 = document.getElementById('hr-chart-daily');
  const dailyTotals = days.map(d => {
    const dd = h.days.find(x => x.date === d.date);
    if (!dd) return 0;
    return Object.values(dd.workers || {}).reduce((a, w) => a + (w.hours || 0), 0);
  });
  charts.hrDaily = new Chart(ctx2, {
    type: 'line',
    data: {
      labels: days.map(d => d.day),
      datasets: [{
        label: 'Ukupno sati',
        data: dailyTotals,
        borderColor: cssVar('--acc-hours'),
        backgroundColor: cssVar('--acc-hours') + '20',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 6,
        borderWidth: 2,
      }],
    },
    options: chartOpts({ legend: false, money: false }),
  });
}

/* ============================================================
   DAY MODAL — brzi unos cijelog dana
   ============================================================ */
function openDayModal(dateStr) {
  ensureMonth(activeMonth);
  let workers = state.settings.workers;

  // Find day or create skeleton
  let day = state.hours[activeMonth].days.find(d => d.date === dateStr);
  if (!day) {
    const dn = DAY_NAMES_HR[new Date(dateStr).getDay()];
    day = { date: dateStr, day_name: dn, note: '', workers: {} };
  }

  // Period rada: na popisu su radnici koji taj dan rade i oni koji za taj dan već imaju upisane sate
  const dmHasEntry = (w) => { const e = (day.workers || {})[w.name]; return !!e && ((e.hours || 0) > 0 || (e.marenda || 0) > 0); };
  const dmOff = new Set(workers.filter(w => !workerActiveOn(w, dateStr) && dmHasEntry(w)).map(w => w.name));
  workers = workers.filter(w => workerActiveOn(w, dateStr) || dmHasEntry(w));
  const dmNotes = state.settings.workers.filter(w => !workers.includes(w)).map(w => {
    const e = workerMonthEdges(w, dateStr.slice(0, 7));
    if (e.do && e.do < dateStr) return `${escapeHtml(w.name)} nije na popisu · zadnji radni dan ${isoToEU(e.do)}`;
    if (e.od && e.od > dateStr) return `${escapeHtml(w.name)} nije na popisu · počinje ${isoToEU(e.od)}`;
    return '';
  }).filter(Boolean);

  // Auto-suggest projects from previous day
  const allDays = state.hours[activeMonth].days.slice().sort((a, b) => a.date.localeCompare(b.date));
  const dayIdx = daysInMonth(activeMonth).findIndex(d => d.date === dateStr);
  const prevDateStr = dayIdx > 0 ? daysInMonth(activeMonth)[dayIdx - 1].date : null;
  const prevDay = prevDateStr ? allDays.find(d => d.date === prevDateStr) : null;

  // All known projects (for datalist)
  const knownProjects = Array.from(new Set(
    state.hours[activeMonth].days.flatMap(d =>
      Object.values(d.workers || {}).map(w => w.project)
    ).filter(Boolean)
  )).sort();

  // Date display
  const dt = new Date(dateStr);
  const dayName = DAY_NAMES_HR[dt.getDay()];
  const dateLabel = `${dt.getDate()}. ${MONTH_NAMES_HR[dt.getMonth()]} ${dt.getFullYear()}`;

  // Adjacent dates for nav
  const monthDays = daysInMonth(activeMonth);
  const curIdx = monthDays.findIndex(d => d.date === dateStr);
  const prevDate = curIdx > 0 ? monthDays[curIdx - 1].date : null;
  const nextDate = curIdx < monthDays.length - 1 ? monthDays[curIdx + 1].date : null;

  const html = `
    <div class="modal-title">${dateLabel} · <em style="color: var(--muted); font-style: italic; font-weight: 400;">${dayName}</em></div>
    <div class="modal-sub">Tab za navigaciju · ⌘+←/→ za prethodni/sljedeći dan · Esc za zatvaranje</div>

    <div class="day-modal-grid">
      <div class="field" style="grid-column: 1 / -1; margin-bottom: 8px;">
        <label class="field-label">Napomena za dan (opcionalno)</label>
        <input class="input" id="day-note" value="${escapeHtml(day.note || '')}" placeholder="Npr. Uskrs, Hasan - MUP, Roky trbuh…" tabindex="1">
      </div>

      <div class="day-workers-grid">
        <div class="day-worker-head">
          <div>Radnik</div>
          <div>Projekt</div>
          <div>Sati</div>
          <div>Mar.</div>
        </div>
        ${workers.map((w, i) => {
          const wd = day.workers[w.name] || { project: '', hours: 0, marenda: 0 };
          // Auto-suggest projekt iz prethodnog dana ako prazan i nemamo unos
          const suggestedProj = wd.project || (prevDay?.workers?.[w.name]?.project) || '';
          const isSuggestion = !wd.project && suggestedProj;
          return `
            <div class="day-worker-row">
              <div class="dw-name">${escapeHtml(w.name)}${dmOff.has(w.name) ? '<span class="wp-caption">van perioda rada</span>' : ''}</div>
              <input class="input dw-proj ${isSuggestion ? 'is-suggestion' : ''}" list="day-projects"
                     data-w="${escapeHtml(w.name)}" data-f="project"
                     value="${escapeHtml(suggestedProj)}"
                     placeholder="Projekt"
                     tabindex="${2 + i * 3}">
              <input class="input dw-hours" type="number" step="0.5" inputmode="decimal"
                     data-w="${escapeHtml(w.name)}" data-f="hours"
                     value="${wd.hours || ''}"
                     placeholder="0"
                     tabindex="${3 + i * 3}">
              <input class="input dw-mar" type="number" step="0.5" inputmode="decimal"
                     data-w="${escapeHtml(w.name)}" data-f="marenda"
                     value="${wd.marenda || ''}"
                     placeholder="0"
                     tabindex="${4 + i * 3}">
            </div>
          `;
        }).join('')}
      </div>
      ${dmNotes.map(t => `<div class="wp-dm-note">${WP_ICON_INFO}<span>${t}</span></div>`).join('')}
      <datalist id="day-projects">
        ${knownProjects.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}
      </datalist>
    </div>

    <div class="modal-actions" style="justify-content: space-between;">
      <div style="display: flex; gap: 6px;">
        <button class="btn" data-act="prev-day" ${!prevDate ? 'disabled' : ''} title="Prethodni dan (⌘+←)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Prethodni
        </button>
        <button class="btn" data-act="next-day" ${!nextDate ? 'disabled' : ''} title="Sljedeći dan (⌘+→)">
          Sljedeći
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div style="display: flex; gap: 8px;">
        <button class="btn" data-act="cancel">Odustani</button>
        <button class="btn btn-primary" data-act="save">Spremi</button>
      </div>
    </div>
  `;

  const m = modal(html, { wide: true });

  // Auto-fokus prvi sati input
  const firstHours = m.root.querySelector('.dw-hours');
  if (firstHours) setTimeout(() => firstHours.focus(), 50);

  // Auto-fill marenda kad sati > 0 i marenda prazna
  m.root.querySelectorAll('.dw-hours').forEach(inp => {
    inp.addEventListener('change', () => {
      const wName = inp.dataset.w;
      const w = workers.find(x => x.name === wName);
      const marInp = m.root.querySelector(`input.dw-mar[data-w="${CSS.escape(wName)}"]`);
      const v = parseFloat(inp.value);
      if (v > 0 && marInp && !marInp.value && w) {
        marInp.value = w.marenda || 0;
      } else if (!v && marInp) {
        marInp.value = '';
      }
    });
  });

  // Suggestion class drops on input (no longer suggestion once edited)
  m.root.querySelectorAll('.dw-proj.is-suggestion').forEach(inp => {
    inp.addEventListener('input', () => inp.classList.remove('is-suggestion'), { once: true });
  });

  const collect = () => {
    const newDay = {
      date: dateStr,
      day_name: dayName,
      note: m.root.querySelector('#day-note').value.trim(),
      workers: {}
    };
    workers.forEach(w => {
      const projInp = m.root.querySelector(`input.dw-proj[data-w="${CSS.escape(w.name)}"]`);
      const hInp = m.root.querySelector(`input.dw-hours[data-w="${CSS.escape(w.name)}"]`);
      const mInp = m.root.querySelector(`input.dw-mar[data-w="${CSS.escape(w.name)}"]`);
      newDay.workers[w.name] = {
        project: (projInp.value || '').trim(),
        hours: parseFloat(hInp.value) || 0,
        marenda: parseFloat(mInp.value) || 0,
      };
    });
    // Upisi radnika koji nisu na popisu (van perioda rada ili više nisu u Postavkama) ostaju netaknuti
    for (const [n, e] of Object.entries(day.workers || {})) {
      if (!(n in newDay.workers)) newDay.workers[n] = e;
    }
    return newDay;
  };

  const save = async (afterSave) => {
    const newDay = collect();
    ensureMonth(activeMonth);
    const idx = state.hours[activeMonth].days.findIndex(d => d.date === dateStr);
    if (idx >= 0) state.hours[activeMonth].days[idx] = newDay;
    else {
      state.hours[activeMonth].days.push(newDay);
      state.hours[activeMonth].days.sort((a, b) => a.date.localeCompare(b.date));
    }
    if (await saveData()) {
      renderHours();
      if (afterSave) afterSave();
      else m.close();
    }
  };

  const moveTo = async (newDate) => {
    if (!newDate) return;
    await save(() => {
      m.close();
      setTimeout(() => openDayModal(newDate), 50);
    });
  };

  // Click handlers
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'save') save();
    else if (btn.dataset.act === 'prev-day') moveTo(prevDate);
    else if (btn.dataset.act === 'next-day') moveTo(nextDate);
  });

  // Keyboard shortcuts
  const keyHandler = (e) => {
    if (!m.root.isConnected) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') {
      e.preventDefault(); moveTo(prevDate);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') {
      e.preventDefault(); moveTo(nextDate);
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault(); save();
    }
  };
  document.addEventListener('keydown', keyHandler);
}

/* ============================================================
   DUG MODAL — uređivanje duga radnika
   ============================================================ */
function openDugModal(workerName) {
  const wIdx = state.settings.workers.findIndex(x => x.name === workerName);
  if (wIdx < 0) return;
  const w = state.settings.workers[wIdx];
  const curDug = Number(w.dug) || 0;

  const html = `
    <div class="modal-title">Dug · ${escapeHtml(workerName)}</div>
    <div class="modal-sub">Iznos koji radnik duguje firmi (informativno, ne utječe na obračun)</div>
    <div class="field">
      <label class="field-label">Iznos duga (€)</label>
      <input class="input" id="dug-input" type="number" step="0.01" value="${curDug}" placeholder="0">
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${curDug > 0 ? '<button class="btn btn-danger" data-act="clear">Obriši dug</button>' : ''}
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html);
  setTimeout(() => m.root.querySelector('#dug-input')?.focus(), 50);

  const save = async (newVal) => {
    state.settings.workers[wIdx].dug = newVal;
    if (await saveData()) {
      m.close();
      renderHours();
    }
  };

  m.root.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'clear') save(0);
    else if (btn.dataset.act === 'save') {
      const v = parseFloat(m.root.querySelector('#dug-input').value) || 0;
      save(v);
    }
  });
  m.root.querySelector('#dug-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = parseFloat(e.target.value) || 0;
      save(v);
    }
  });
}


/* ============================================================
   RENDER: TRX
   ============================================================ */
function renderTrx() {
  if (trxView === 'year') return renderTrxYear();

  ensureMonth(activeMonth);
  const items = (state.trx[activeMonth] || []).slice().sort((a, b) => a.date.localeCompare(b.date));

  const byGroup = items.reduce((a, t) => { a[t.group || 'Ostalo'] = (a[t.group || 'Ostalo'] || 0) + t.amount; return a; }, {});
  const byCat = items.filter(t => t.group !== 'Prihodi' && t.group !== 'Isključi').reduce((a, t) => { a[t.category || 'Ostalo'] = (a[t.category || 'Ostalo'] || 0) + t.amount; return a; }, {});

  const totalTroskovi = (byGroup['Tekući'] || 0) + (byGroup['Nepredviđeni'] || 0);
  const totalPrihodi = byGroup['Prihodi'] || 0;
  const neto = totalPrihodi - totalTroskovi;

  const panel = document.getElementById('panel-trx');
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">${monthLabel(activeMonth)}</div>
        <h1 class="page-title">Troškovi <em>· transakcije</em></h1>
      </div>
      <div class="page-actions">
        <div class="toggle">
          <button class="active" data-view="month">Mjesec</button>
          <button data-view="year">Godišnji</button>
        </div>
        ${buildMonthPicker(activeMonth, null, { allowAdd: true })}
        <button class="btn btn-primary admin-only" id="trx-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Dodaj transakciju
        </button>
      </div>
    </div>

    <div class="kpi-row" style="margin-bottom: 24px;">
      <div class="kpi-cell">
        <div class="stat-label">Prihodi</div>
        <div class="stat-value positive">${eur(totalPrihodi, 0)}</div>
        <div class="stat-sub">${items.filter(t => t.group === 'Prihodi').length} transakcija</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Tekući</div>
        <div class="stat-value">${eur(byGroup['Tekući'] || 0, 0)}</div>
        <div class="stat-sub">${items.filter(t => t.group === 'Tekući').length} transakcija</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Nepredviđeni</div>
        <div class="stat-value">${eur(byGroup['Nepredviđeni'] || 0, 0)}</div>
        <div class="stat-sub">${items.filter(t => t.group === 'Nepredviđeni').length} transakcija</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Neto (ovaj mj.)</div>
        <div class="stat-value ${neto < 0 ? 'negative' : 'positive'}">${eur(neto, 0)}</div>
        <div class="stat-sub">prihodi − troškovi</div>
      </div>
    </div>

    <div class="grid grid-cf" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Po kategoriji</div>
            <div class="card-sub">Samo troškovi (bez prihoda i isključenih)</div>
          </div>
        </div>
        <div class="chart-box"><canvas id="trx-chart-cat"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Po grupi</div>
            <div class="card-sub">Tekući vs. nepredviđeni vs. prihodi</div>
          </div>
        </div>
        <div class="chart-box"><canvas id="trx-chart-grp"></canvas></div>
      </div>
    </div>

    ${v4PonavljajuciHtml(activeMonth)}

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Sve transakcije · ${monthLabelShort(activeMonth)}</div>
          <div class="card-sub">${items.length} stavki</div>
        </div>
      </div>
      ${items.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12h8M8 8h8M8 16h5"/></svg>
          </div>
          Nema transakcija u ovom mjesecu.<br>
          ${isAdmin ? 'Klikni „Dodaj transakciju" za prvi unos.' : 'Aktiviraj admin mod za unos.'}
        </div>
      ` : `
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Datum</th>
              <th>Tip</th>
              <th>Partner</th>
              <th class="text-right">Iznos</th>
              <th>Kategorija</th>
              <th>Grupa</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${items.map((t, i) => {
              const idx = (state.trx[activeMonth] || []).indexOf(t);
              return `
                <tr>
                  <td class="col-date num">${formatDate(t.date)}</td>
                  <td>${typePill(t.type)}</td>
                  <td><strong${t.group === 'Isključi' ? ' style="text-decoration: line-through; color: var(--muted);"' : ''}>${escapeHtml(t.partner)}</strong>${trxChipsHtml(t)}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(t.amount, 2)}</td>
                  <td><span class="pill gray">${escapeHtml(t.category || '—')}</span></td>
                  <td>${groupPill(t.group)}</td>
                  ${isAdmin ? `<td class="text-right">
                    <button class="btn btn-ghost btn-sm" data-act="edit-trx" data-i="${idx}" title="Uredi">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm btn-danger" data-act="del-trx" data-i="${idx}" title="Obriši">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                    </button>
                  </td>` : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>
  `;

  // Bind month picker
  bindMonthPicker(panel, activeMonth, (m) => { activeMonth = m; renderTrx(); }, { allowAdd: true });

  // View toggle
  panel.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    trxView = b.dataset.view;
    renderTrx();
  }));

  if (isAdmin) {
    panel.querySelector('#trx-add')?.addEventListener('click', () => trxModal());
    panel.querySelectorAll('[data-act="edit-trx"]').forEach(b => b.addEventListener('click', () => trxModal(parseInt(b.dataset.i))));
    panel.querySelectorAll('[data-act="del-trx"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Obrisati ovu transakciju?')) return;
      state.trx[activeMonth].splice(parseInt(b.dataset.i), 1);
      if (await saveData()) renderTrx();
    }));
  }

  // CHART: by category (donut)
  const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const ctx1 = document.getElementById('trx-chart-cat');
  if (catEntries.length) {
    charts.trxCat = new Chart(ctx1, {
      type: 'doughnut',
      data: {
        labels: catEntries.map(e => e[0]),
        datasets: [{
          data: catEntries.map(e => e[1]),
          backgroundColor: catEntries.map((_, i) => PROJECT_PALETTE[i % PROJECT_PALETTE.length]),
          borderWidth: 2,
          borderColor: cssVar('--surface'),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { font: { family: cssVar('--font-body'), size: 11 }, padding: 8, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: { callbacks: { label: c => c.label + ': ' + eur(c.raw, 0) } },
        },
      },
    });
  }

  // CHART: by group (horizontal bar)
  const grpEntries = Object.entries(byGroup).filter(([k]) => k !== 'Isključi').sort((a, b) => b[1] - a[1]);
  const ctx2 = document.getElementById('trx-chart-grp');
  if (grpEntries.length) {
    charts.trxGrp = new Chart(ctx2, {
      type: 'bar',
      data: {
        labels: grpEntries.map(e => e[0]),
        datasets: [{
          label: 'Iznos',
          data: grpEntries.map(e => e[1]),
          backgroundColor: grpEntries.map(e => {
            return e[0] === 'Prihodi' ? cssVar('--positive')
              : e[0] === 'Tekući' ? cssVar('--acc-cashflow')
              : cssVar('--acc-trx');
          }),
          borderRadius: 6,
        }],
      },
      options: { ...chartOpts({ legend: false, money: true }), indexAxis: 'y' },
    });
  }
}

function renderTrxYear() {
  const months = allMonths();
  // Build category × month matrix (only Tekući + Nepredviđeni)
  const categories = Array.from(new Set(months.flatMap(k => (state.trx[k] || []).filter(t => t.group === 'Tekući' || t.group === 'Nepredviđeni').map(t => t.category || 'Bez kategorije')))).sort();
  const matrix = categories.map(c => {
    const row = { category: c, byMonth: {}, total: 0 };
    for (const k of months) {
      const sum = (state.trx[k] || []).filter(t => (t.category || 'Bez kategorije') === c && (t.group === 'Tekući' || t.group === 'Nepredviđeni')).reduce((a, t) => a + t.amount, 0);
      row.byMonth[k] = sum;
      row.total += sum;
    }
    return row;
  }).filter(r => r.total > 0).sort((a, b) => b.total - a.total);

  const grandTroskovi = matrix.reduce((a, r) => a + r.total, 0);
  const grandPrihodi = months.reduce((a, k) => a + (state.trx[k] || []).filter(t => t.group === 'Prihodi').reduce((s, t) => s + t.amount, 0), 0);
  const monthlyTotals = months.reduce((a, k) => { a[k] = matrix.reduce((s, r) => s + r.byMonth[k], 0); return a; }, {});
  const monthlyPrihodi = months.reduce((a, k) => { a[k] = (state.trx[k] || []).filter(t => t.group === 'Prihodi').reduce((s, t) => s + t.amount, 0); return a; }, {});
  const grandTrxCount = months.reduce((a, k) => a + (state.trx[k]?.length || 0), 0);

  const panel = document.getElementById('panel-trx');
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">YTD · Godina 2026</div>
        <h1 class="page-title">Troškovi <em>· godišnji</em></h1>
      </div>
      <div class="page-actions">
        <div class="toggle">
          <button data-view="month">Mjesec</button>
          <button class="active" data-view="year">Godišnji</button>
        </div>
      </div>
    </div>

    <div class="kpi-row" style="margin-bottom: 24px;">
      <div class="kpi-cell">
        <div class="stat-label">Prihodi YTD</div>
        <div class="stat-value positive">${eur(grandPrihodi, 0)}</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Troškovi YTD</div>
        <div class="stat-value">${eur(grandTroskovi, 0)}</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Neto YTD</div>
        <div class="stat-value ${grandPrihodi - grandTroskovi < 0 ? 'negative' : 'positive'}">${eur(grandPrihodi - grandTroskovi, 0)}</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Ukupno transakcija</div>
        <div class="stat-value">${grandTrxCount}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Distribucija po kategoriji</div>
          <div class="card-sub">YTD ukupno · samo troškovi</div>
        </div>
      </div>
      <div class="chart-box tall"><canvas id="trx-y-chart"></canvas></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Matrica · kategorija × mjesec</div>
          <div class="card-sub">€ po kategoriji po mjesecu (Tekući + Nepredviđeni)</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Kategorija</th>
              ${months.map(k => `<th class="text-right">${monthLabelShort(k)}</th>`).join('')}
              <th class="text-right">UKUPNO</th>
            </tr>
          </thead>
          <tbody>
            ${matrix.map((r, i) => `
              <tr>
                <td>
                  <span class="project-swatch" style="background: ${PROJECT_PALETTE[i % PROJECT_PALETTE.length]}; display: inline-block; vertical-align: middle; margin-right: 8px;"></span>
                  <strong>${escapeHtml(r.category)}</strong>
                </td>
                ${months.map(k => `<td class="num text-right" style="${r.byMonth[k] === 0 ? 'color: var(--muted-2);' : ''}">${r.byMonth[k] === 0 ? '—' : eur(r.byMonth[k], 0)}</td>`).join('')}
                <td class="num text-right" style="font-weight: 600;">${eur(r.total, 0)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>TROŠKOVI UKUPNO</td>
              ${months.map(k => `<td class="num text-right">${eur(monthlyTotals[k], 0)}</td>`).join('')}
              <td class="num text-right"><strong>${eur(grandTroskovi, 0)}</strong></td>
            </tr>
            <tr>
              <td style="color: var(--positive);">PRIHODI</td>
              ${months.map(k => `<td class="num text-right" style="color: var(--positive);">${eur(monthlyPrihodi[k], 0)}</td>`).join('')}
              <td class="num text-right" style="color: var(--positive);"><strong>${eur(grandPrihodi, 0)}</strong></td>
            </tr>
            <tr>
              <td>NETO</td>
              ${months.map(k => {
                const neto = (monthlyPrihodi[k] || 0) - (monthlyTotals[k] || 0);
                return `<td class="num text-right" style="color: var(--${neto < 0 ? 'negative' : 'positive'});"><strong>${eur(neto, 0)}</strong></td>`;
              }).join('')}
              <td class="num text-right" style="color: var(--${grandPrihodi - grandTroskovi < 0 ? 'negative' : 'positive'});"><strong>${eur(grandPrihodi - grandTroskovi, 0)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  // View toggle
  panel.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    trxView = b.dataset.view;
    renderTrx();
  }));

  // Donut by category YTD
  if (matrix.length) {
    const ctx = document.getElementById('trx-y-chart');
    charts.trxYear = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: matrix.map(r => r.category),
        datasets: [{
          data: matrix.map(r => r.total),
          backgroundColor: matrix.map((_, i) => PROJECT_PALETTE[i % PROJECT_PALETTE.length]),
          borderWidth: 2,
          borderColor: cssVar('--surface'),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { font: { family: cssVar('--font-body'), size: 12 }, padding: 10, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } },
          tooltip: { callbacks: { label: c => c.label + ': ' + eur(c.raw, 0) } },
        },
      },
    });
  }
}

function formatDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-');
  return `${d}.${m}.`;
}

function typePill(t) {
  if (t === 'Prihod') return `<span class="pill green">Prihod</span>`;
  if (t === 'Pozajmnica') return `<span class="pill purple">Pozajmnica</span>`;
  return `<span class="pill red">Trošak</span>`;
}
function groupPill(g) {
  if (g === 'Prihodi') return `<span class="pill green">${g}</span>`;
  if (g === 'Tekući') return `<span class="pill blue">${g}</span>`;
  if (g === 'Nepredviđeni') return `<span class="pill red">${g}</span>`;
  if (g === 'Isključi') return `<span class="pill gray">${g}</span>`;
  return `<span class="pill gray">${g || '—'}</span>`;
}

function trxModalV3(idx = null) {
  ensureMonth(activeMonth);
  const t = idx !== null ? state.trx[activeMonth][idx] : { date: new Date().toISOString().slice(0, 10), type: 'Trošak', partner: '', amount: 0, category: '', group: 'Tekući' };
  const partners = Array.from(new Set(allMonths().flatMap(k => (state.trx[k] || []).map(x => x.partner)).filter(Boolean))).sort();
  const cats = Array.from(new Set([...TRX_CATEGORIES, ...allMonths().flatMap(k => (state.trx[k] || []).map(x => x.category)).filter(Boolean)])).sort();
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} transakciju</div>
    <div class="modal-sub">${monthLabel(activeMonth)}</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="t-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(t.date)}"></div>
      <div class="field"><label class="field-label">Tip</label>
        <select class="select" id="t-type">${TRX_TYPES.map(x => `<option ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Partner</label>
        <input class="input" id="t-partner" list="t-partners" value="${escapeHtml(t.partner)}" placeholder="Npr. Hrvatski Telekom">
        <datalist id="t-partners">${partners.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
      </div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input num" id="t-amount" type="text" inputmode="decimal" placeholder="0,00" value="${formatEUAmount(t.amount)}"></div>
      <div class="field"><label class="field-label">Grupa</label>
        <select class="select" id="t-group">${TRX_GROUPS.map(x => `<option ${x === t.group ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Kategorija</label>
        <input class="input" id="t-category" list="t-cats" value="${escapeHtml(t.category)}" placeholder="Npr. Knjigovodstvo">
        <datalist id="t-cats">${cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  attachEUDateMask(m.root.querySelector('#t-date'));
  attachEUAmountMask(m.root.querySelector('#t-amount'));

  // Auto-postavi grupu na "Prihodi" kad je tip "Prihod"; ako se mijenja sa Prihod na nešto drugo, vrati na Tekući
  const typeSel = m.root.querySelector('#t-type');
  const groupSel = m.root.querySelector('#t-group');
  typeSel.addEventListener('change', () => {
    if (typeSel.value === 'Prihod') groupSel.value = 'Prihodi';
    else if (groupSel.value === 'Prihodi') groupSel.value = 'Tekući';
  });

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati ovu transakciju?')) {
        state.trx[activeMonth].splice(idx, 1);
        if (await saveData()) { m.close(); renderTrx(); }
      }
    } else if (btn.dataset.act === 'save') {
      const dateEU = m.root.querySelector('#t-date').value.trim();
      const date = euToISO(dateEU);
      if (!date) {
        toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
        m.root.querySelector('#t-date').classList.add('invalid');
        m.root.querySelector('#t-date').focus();
        return;
      }
      const newT = {
        date,
        type: typeSel.value,
        partner: m.root.querySelector('#t-partner').value.trim(),
        amount: parseEUAmount(m.root.querySelector('#t-amount').value),
        category: m.root.querySelector('#t-category').value.trim(),
        group: groupSel.value,
      };
      if (!newT.partner) { toast('Unesi partnera', 'error'); return; }
      if (!newT.amount) { toast('Unesi iznos', 'error'); return; }
      // Move to correct month based on date
      const targetMonth = date.slice(0, 7);
      ensureMonth(targetMonth);
      if (idx !== null) {
        if (targetMonth !== activeMonth) {
          state.trx[activeMonth].splice(idx, 1);
          state.trx[targetMonth].push(newT);
        } else {
          state.trx[activeMonth][idx] = newT;
        }
      } else {
        state.trx[targetMonth].push(newT);
      }
      if (await saveData()) {
        m.close();
        if (targetMonth !== activeMonth) {
          activeMonth = targetMonth;
          toast(`Transakcija u ${monthLabel(targetMonth)}`, 'success');
        }
        renderTrx();
      }
    }
  });
}

/* ============================================================
   RENDER: STO
   ============================================================ */
function renderSto() {
  if (stoView === 'year') return renderStoYear();

  ensureMonth(activeMonth);
  const items = (state.sto[activeMonth] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  const total = items.reduce((a, t) => a + t.amount, 0);
  const projects = items.reduce((a, t) => { a[t.project || 'Bez projekta'] = (a[t.project || 'Bez projekta'] || 0) + t.amount; return a; }, {});
  const projEntries = Object.entries(projects).sort((a, b) => b[1] - a[1]);

  // YTD by project
  const ytdProj = {};
  for (const k of allMonths()) {
    for (const t of (state.sto[k] || [])) {
      ytdProj[t.project || 'Bez projekta'] = (ytdProj[t.project || 'Bez projekta'] || 0) + t.amount;
    }
  }
  const ytdTotal = Object.values(ytdProj).reduce((a, b) => a + b, 0);

  const panel = document.getElementById('panel-sto');
  panel.innerHTML = `
    ${buildStoStanjeHtml()}

    <div class="sto-section-head">
      <div>
        <div class="eyebrow">Mjesečni pregled</div>
        <div class="section-title">Materijal <em>· ${monthLabel(activeMonth)}</em></div>
      </div>
      <div class="page-actions">
        <div class="toggle">
          <button class="${stoView === 'month' ? 'active' : ''}" data-view="month">Mjesec</button>
          <button class="${stoView === 'year' ? 'active' : ''}" data-view="year">Godišnji</button>
        </div>
        ${buildMonthPicker(activeMonth, null, { allowAdd: true })}
        <button class="btn admin-only" id="sto-import" title="Uvezi stavke iz PDF računa i rasporedi ih po projektima">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
          Uvoz računa
        </button>
        <button class="btn btn-primary admin-only" id="sto-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Dodaj
        </button>
      </div>
    </div>

    <div class="kpi-row" style="margin-bottom: 24px;">
      <div class="kpi-cell">
        <div class="stat-label">Ukupno · ${monthLabelShort(activeMonth)}</div>
        <div class="stat-value">${eur(total, 0)}</div>
        <div class="stat-sub">${items.length} stavki</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Prosječna stavka</div>
        <div class="stat-value">${items.length ? eur(total / items.length, 0) : '—'}</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Aktivnih projekata</div>
        <div class="stat-value">${projEntries.length}</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">YTD ukupno</div>
        <div class="stat-value">${eur(ytdTotal, 0)}</div>
      </div>
    </div>

    <div class="grid grid-cf" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Mjesečni trend</div>
            <div class="card-sub">STO troškovi po mjesecu (YTD)</div>
          </div>
        </div>
        <div class="chart-box"><canvas id="sto-chart-trend"></canvas></div>
      </div>
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Po projektu · ${monthLabelShort(activeMonth)}</div>
            <div class="card-sub">Raspodjela troškova</div>
          </div>
        </div>
        ${projEntries.length ? `
          <div class="project-list">
            ${projEntries.map(([name, val], i) => {
              const pct = total > 0 ? (val / total) * 100 : 0;
              const color = PROJECT_PALETTE[i % PROJECT_PALETTE.length];
              return `
                <div class="project-row">
                  <div class="project-name"><span class="project-swatch" style="background:${color}"></span>${escapeHtml(name)}</div>
                  <div class="project-amount">${eur(val, 0)}<span style="color: var(--muted); margin-left: 8px;">${pct.toFixed(1)}%</span></div>
                  <div class="project-bar"><div class="project-bar-fill" style="width: ${pct}%; background: ${color};"></div></div>
                </div>
              `;
            }).join('')}
          </div>
        ` : `<div class="empty">Nema podataka</div>`}
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Sve stavke · ${monthLabelShort(activeMonth)}</div>
          <div class="card-sub">${items.length} unosa</div>
        </div>
      </div>
      ${items.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          Nema stavki za ${monthLabel(activeMonth)}.
        </div>
      ` : `
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Datum</th>
              <th class="text-right">Iznos</th>
              <th>Projekt</th>
              <th>Napomena</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${items.map(t => {
              const idx = state.sto[activeMonth].indexOf(t);
              const nItems = (t.items || []).length;
              const itemsBadge = nItems ? `<button class="pill blue" type="button" data-act="toggle-items" data-i="${idx}" style="border: none; cursor: pointer; margin-right: 6px; font-family: inherit;" title="Prikaži stavke materijala">${nItems} ${nItems === 1 ? 'stavka' : nItems <= 4 ? 'stavke' : 'stavki'} ▾</button>` : '';
              const detailRow = nItems ? `
                <tr data-items-for="${idx}" style="display: none;">
                  <td colspan="${isAdmin ? 5 : 4}" style="background: var(--surface-2); padding: 10px 14px 12px;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                      ${t.items.map(it => `
                        <tr>
                          <td style="padding: 3px 10px 3px 0; color: var(--ink-2);">${escapeHtml(it.name || '')}</td>
                          <td class="num" style="padding: 3px 10px; text-align: right; white-space: nowrap; color: var(--muted);">${it.qty ? fmtQty(it.qty) + (it.unit ? ' ' + escapeHtml(it.unit) : '') : ''}</td>
                          <td class="num" style="padding: 3px 0 3px 10px; text-align: right; white-space: nowrap; font-weight: 600; width: 110px;">${eur(it.amount, 2)}</td>
                        </tr>`).join('')}
                    </table>
                  </td>
                </tr>` : '';
              return `
                <tr>
                  <td class="col-date num">${formatDate(t.date)}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(t.amount, 2)}</td>
                  <td><strong>${escapeHtml(t.project || '—')}</strong></td>
                  <td style="color: var(--muted);">${itemsBadge}${escapeHtml(t.note || '')}</td>
                  ${isAdmin ? `<td class="text-right">
                    <button class="btn btn-ghost btn-sm" data-act="edit-sto" data-i="${idx}" title="Uredi">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm btn-danger" data-act="del-sto" data-i="${idx}" title="Obriši">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/></svg>
                    </button>
                  </td>` : ''}
                </tr>
                ${detailRow}
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>UKUPNO</td>
              <td class="num text-right"><strong>${eur(total, 2)}</strong></td>
              <td colspan="${isAdmin ? 3 : 2}"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      `}
    </div>
  `;

  // Bind month picker
  bindMonthPicker(panel, activeMonth, (m) => { activeMonth = m; renderSto(); }, { allowAdd: true });
  bindStoStanje(panel);

  // View toggle
  panel.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    stoView = b.dataset.view;
    renderSto();
  }));

  // Razrada stavki materijala — otvaranje/zatvaranje (dostupno i bez admina, samo pregled)
  panel.querySelectorAll('[data-act="toggle-items"]').forEach(b => b.addEventListener('click', () => {
    const row = panel.querySelector(`tr[data-items-for="${b.dataset.i}"]`);
    if (!row) return;
    const open = row.style.display !== 'none';
    row.style.display = open ? 'none' : '';
    b.innerHTML = open ? b.innerHTML.replace('▴', '▾') : b.innerHTML.replace('▾', '▴');
  }));

  if (isAdmin) {
    panel.querySelector('#sto-add')?.addEventListener('click', () => stoModal());
    panel.querySelector('#sto-import')?.addEventListener('click', () => stoImportModal());
    panel.querySelectorAll('[data-act="edit-sto"]').forEach(b => b.addEventListener('click', () => stoModal(parseInt(b.dataset.i))));
    panel.querySelectorAll('[data-act="del-sto"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Obrisati ovu stavku?')) return;
      state.sto[activeMonth].splice(parseInt(b.dataset.i), 1);
      if (await saveData()) renderSto();
    }));
  }

  // Trend chart
  const months = allMonths();
  const monthlyTotals = months.map(k => (state.sto[k] || []).reduce((a, t) => a + t.amount, 0));
  const ctx1 = document.getElementById('sto-chart-trend');
  charts.stoTrend = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: months.map(monthLabelShort),
      datasets: [{
        label: 'Ukupno mjesečno',
        data: monthlyTotals,
        backgroundColor: months.map(m => m === activeMonth ? cssVar('--acc-sto-ink') : cssVar('--acc-sto')),
        borderRadius: 6,
        borderColor: cssVar('--ink'),
        borderWidth: months.map(m => m === activeMonth ? 0 : 1.5),
      }],
    },
    options: chartOpts({ legend: false, money: true }),
  });
}

function renderStoYear() {
  const projects = Array.from(new Set(allMonths().flatMap(k => (state.sto[k] || []).map(t => t.project || 'Bez projekta')))).sort();
  const months = allMonths();
  // Build matrix
  const matrix = projects.map(p => {
    const row = { project: p, byMonth: {}, total: 0 };
    for (const k of months) {
      const sum = (state.sto[k] || []).filter(t => (t.project || 'Bez projekta') === p).reduce((a, t) => a + t.amount, 0);
      row.byMonth[k] = sum;
      row.total += sum;
    }
    return row;
  });
  matrix.sort((a, b) => b.total - a.total);
  const grandTotal = matrix.reduce((a, r) => a + r.total, 0);
  const monthlyTotals = months.reduce((a, k) => { a[k] = matrix.reduce((s, r) => s + r.byMonth[k], 0); return a; }, {});

  const panel = document.getElementById('panel-sto');
  panel.innerHTML = `
    ${buildStoStanjeHtml()}

    <div class="sto-section-head">
      <div>
        <div class="eyebrow">Godišnji pregled</div>
        <div class="section-title">Materijal <em>· 2026</em></div>
      </div>
      <div class="page-actions">
        <div class="toggle">
          <button data-view="month">Mjesec</button>
          <button class="active" data-view="year">Godišnji</button>
        </div>
      </div>
    </div>

    <div class="flourish">
      <div class="flourish-grid">
        <div>
          <div class="eyebrow" style="margin-bottom: 12px;">YTD UKUPNO · STO MATERIJAL</div>
          <div class="flourish-stat" style="color: var(--ink);">
            <span class="currency">€</span>${FMT_INT.format(Math.floor(grandTotal))}<em>,${(grandTotal % 1).toFixed(2).slice(2)}</em>
          </div>
        </div>
        <div class="flourish-side">
          <div><span class="label">Projekata</span><span class="value">${matrix.length}</span></div>
          <div><span class="label">Mjeseci</span><span class="value">${months.length}</span></div>
          <div><span class="label">Stavki</span><span class="value">${months.reduce((a, k) => a + (state.sto[k]?.length || 0), 0)}</span></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin: 24px 0;">
      <div class="card-head">
        <div>
          <div class="card-title">Distribucija po projektu</div>
          <div class="card-sub">YTD ukupno</div>
        </div>
      </div>
      <div class="chart-box tall"><canvas id="sto-y-chart"></canvas></div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Matrica · projekt × mjesec</div>
          <div class="card-sub">€ po projektu po mjesecu</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Projekt</th>
              ${months.map(k => `<th class="text-right">${monthLabelShort(k)}</th>`).join('')}
              <th class="text-right">UKUPNO</th>
            </tr>
          </thead>
          <tbody>
            ${matrix.map((r, i) => `
              <tr>
                <td>
                  <span class="project-swatch" style="background: ${PROJECT_PALETTE[i % PROJECT_PALETTE.length]}; display: inline-block; vertical-align: middle; margin-right: 8px;"></span>
                  <strong>${escapeHtml(r.project)}</strong>
                </td>
                ${months.map(k => `<td class="num text-right" style="${r.byMonth[k] === 0 ? 'color: var(--muted-2);' : ''}">${r.byMonth[k] === 0 ? '—' : eur(r.byMonth[k], 0)}</td>`).join('')}
                <td class="num text-right" style="font-weight: 600;">${eur(r.total, 0)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>UKUPNO</td>
              ${months.map(k => `<td class="num text-right">${eur(monthlyTotals[k], 0)}</td>`).join('')}
              <td class="num text-right"><strong>${eur(grandTotal, 0)}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  panel.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    stoView = b.dataset.view;
    renderSto();
  }));
  bindStoStanje(panel);

  // Donut by project YTD
  const ctx = document.getElementById('sto-y-chart');
  charts.stoYear = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: matrix.map(r => r.project),
      datasets: [{
        data: matrix.map(r => r.total),
        backgroundColor: matrix.map((_, i) => PROJECT_PALETTE[i % PROJECT_PALETTE.length]),
        borderWidth: 2,
        borderColor: cssVar('--surface'),
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { position: 'right', labels: { font: { family: cssVar('--font-body'), size: 12 }, padding: 10, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded' } },
        tooltip: { callbacks: { label: c => c.label + ': ' + eur(c.raw, 0) } },
      },
    },
  });
}

function stoModal(idx = null) {
  ensureMonth(activeMonth);
  const t = idx !== null ? state.sto[activeMonth][idx] : { date: new Date().toISOString().slice(0, 10), amount: 0, project: '', note: '' };
  // Radna kopija stavki materijala — original se ne dira dok se ne klikne Spremi
  const workItems = (t.items || []).map(x => ({ ...x }));
  const projects = Array.from(new Set(allMonths().flatMap(k => (state.sto[k] || []).map(x => x.project)).filter(Boolean))).sort();
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} STO stavku</div>
    <div class="modal-sub">${monthLabel(activeMonth)}</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="s-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(t.date)}"></div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input num" id="s-amount" type="text" inputmode="decimal" placeholder="0,00" value="${formatEUAmount(t.amount)}"></div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Projekt</label>
        <input class="input" id="s-project" list="s-projs" value="${escapeHtml(t.project)}" placeholder="Npr. Grižane">
        <datalist id="s-projs">${projects.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
      </div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Napomena (opcionalno)</label><input class="input" id="s-note" value="${escapeHtml(t.note || '')}"></div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Stavke materijala (opcionalno · vidljive u razradi projekta)</label>
        <div id="s-items" style="overflow-x: auto;"></div>
        <div style="display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap;">
          <button type="button" class="btn btn-sm" data-act="add-item">+ Dodaj stavku</button>
          <span id="s-items-sum" class="field-hint" style="margin-top: 0;"></span>
        </div>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  attachEUDateMask(m.root.querySelector('#s-date'));
  attachEUAmountMask(m.root.querySelector('#s-amount'));

  const itemsBox = m.root.querySelector('#s-items');
  const sumEl = m.root.querySelector('#s-items-sum');
  const itemsSum = () => round2(workItems.reduce((a, it) => a + (Number(it.amount) || 0), 0));
  const updateItemsSum = () => {
    if (!workItems.length) { sumEl.innerHTML = ''; return; }
    const s = itemsSum();
    const cur = parseEUAmount(m.root.querySelector('#s-amount').value);
    sumEl.innerHTML = `Zbroj stavki: <strong>${eur(s, 2)}</strong>` +
      (Math.abs(s - cur) > 0.005
        ? ` · <a href="#" data-act="use-sum" style="color: var(--acc);">postavi kao iznos</a>`
        : ' · odgovara iznosu ✓');
  };
  const renderItems = () => {
    if (!workItems.length) {
      itemsBox.innerHTML = `<div class="field-hint" style="margin-top: 0;">Nema stavki. Za automatsko čitanje iz PDF-a koristi „Uvoz računa" u STO tabu.</div>`;
      updateItemsSum();
      return;
    }
    if (isMobileView()) {
      itemsBox.innerHTML = workItems.map((it, i) => `
      <div class="ir-card" style="padding: 10px;">
        <div class="ir-head-row">
          <input class="input" data-it="${i}" data-f="name" value="${escapeHtml(it.name || '')}" placeholder="Naziv artikla" style="flex: 1;">
          <button type="button" class="btn btn-ghost btn-sm btn-danger" data-del-item="${i}" title="Ukloni stavku">×</button>
        </div>
        <div class="ir-grid-3">
          <div><div class="ir-mini-label">Količina</div><input class="input num" data-it="${i}" data-f="qty" type="text" inputmode="decimal" value="${it.qty ? String(it.qty).replace('.', ',') : ''}" style="width: 100%; text-align: right;"></div>
          <div><div class="ir-mini-label">Jed.</div><input class="input" data-it="${i}" data-f="unit" value="${escapeHtml(it.unit || '')}" style="width: 100%;"></div>
          <div><div class="ir-mini-label">€ s PDV</div><input class="input num" data-it="${i}" data-f="amount" type="text" inputmode="decimal" value="${formatEUAmount(it.amount)}" style="width: 100%; text-align: right; font-weight: 600;"></div>
        </div>
      </div>`).join('');
    } else {
      itemsBox.innerHTML = workItems.map((it, i) => `
      <div style="display: grid; grid-template-columns: minmax(130px, 1fr) 58px 46px 92px 28px; gap: 6px; margin-bottom: 6px; align-items: center; min-width: 380px;">
        <input class="input" data-it="${i}" data-f="name" value="${escapeHtml(it.name || '')}" placeholder="Naziv artikla">
        <input class="input num" data-it="${i}" data-f="qty" type="text" inputmode="decimal" value="${it.qty ? String(it.qty).replace('.', ',') : ''}" placeholder="Kol." style="text-align: right; padding: 10px 8px;">
        <input class="input" data-it="${i}" data-f="unit" value="${escapeHtml(it.unit || '')}" placeholder="Jed." style="padding: 10px 8px;">
        <input class="input num" data-it="${i}" data-f="amount" type="text" inputmode="decimal" value="${formatEUAmount(it.amount)}" placeholder="€ s PDV" style="text-align: right; padding: 10px 8px;">
        <button type="button" class="btn btn-ghost btn-sm btn-danger" data-del-item="${i}" title="Ukloni stavku" style="padding: 6px 4px;">×</button>
      </div>`).join('');
    }
    updateItemsSum();
  };
  renderItems();

  itemsBox.addEventListener('input', e => {
    const inp = e.target.closest('input[data-it]');
    if (!inp) return;
    const it = workItems[+inp.dataset.it];
    if (!it) return;
    const f = inp.dataset.f;
    if (f === 'qty' || f === 'amount') it[f] = parseEUAmount(inp.value);
    else it[f] = inp.value;
    updateItemsSum();
  });
  itemsBox.addEventListener('focusout', e => {
    const inp = e.target.closest('input[data-it]');
    if (!inp) return;
    const it = workItems[+inp.dataset.it];
    if (!it) return;
    if (inp.dataset.f === 'amount') inp.value = formatEUAmount(it.amount);
    if (inp.dataset.f === 'qty') inp.value = it.qty ? String(it.qty).replace('.', ',') : '';
  });
  m.root.querySelector('#s-amount').addEventListener('input', updateItemsSum);

  m.root.addEventListener('click', async e => {
    const sumLink = e.target.closest('a[data-act="use-sum"]');
    if (sumLink) {
      e.preventDefault();
      m.root.querySelector('#s-amount').value = formatEUAmount(itemsSum());
      updateItemsSum();
      return;
    }
    const delItem = e.target.closest('button[data-del-item]');
    if (delItem) {
      workItems.splice(+delItem.dataset.delItem, 1);
      renderItems();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add-item') {
      workItems.push({ name: '', qty: 0, unit: '', vatPct: 25, amount: 0 });
      renderItems();
      itemsBox.querySelector(`input[data-it="${workItems.length - 1}"][data-f="name"]`)?.focus();
      return;
    }
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati?')) {
        state.sto[activeMonth].splice(idx, 1);
        if (await saveData()) { m.close(); renderSto(); }
      }
    } else if (btn.dataset.act === 'save') {
      const dateEU = m.root.querySelector('#s-date').value.trim();
      const date = euToISO(dateEU);
      if (!date) {
        toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
        m.root.querySelector('#s-date').classList.add('invalid');
        m.root.querySelector('#s-date').focus();
        return;
      }
      // ...t na početku čuva SVA postojeća i buduća polja zapisa (npr. items)
      const newT = {
        ...t,
        date,
        amount: parseEUAmount(m.root.querySelector('#s-amount').value),
        project: m.root.querySelector('#s-project').value.trim(),
        note: m.root.querySelector('#s-note').value.trim(),
      };
      const cleanItems = workItems
        .map(x => ({ ...x, name: (x.name || '').trim(), unit: (x.unit || '').trim() }))
        .filter(x => x.name || (Number(x.amount) || 0) > 0);
      if (cleanItems.length) {
        newT.items = cleanItems.map(x => {
          const it = { name: x.name || 'Stavka', qty: Number(x.qty) || 0, unit: x.unit, amount: round2(Number(x.amount) || 0) };
          if (x.vatPct !== undefined && x.vatPct !== null) it.vatPct = Number(x.vatPct) || 0;
          if (x.net !== undefined && x.net !== null) it.net = round2(Number(x.net) || 0);
          if (x.code) it.code = x.code;
          if (x.unitPrice) it.unitPrice = Number(x.unitPrice) || 0;
          return it;
        });
      } else {
        delete newT.items;
      }
      if (!newT.amount) { toast('Unesi iznos', 'error'); return; }
      const targetMonth = date.slice(0, 7);
      ensureMonth(targetMonth);
      if (idx !== null) {
        if (targetMonth !== activeMonth) {
          state.sto[activeMonth].splice(idx, 1);
          state.sto[targetMonth].push(newT);
        } else {
          state.sto[activeMonth][idx] = newT;
        }
      } else {
        state.sto[targetMonth].push(newT);
      }
      if (await saveData()) {
        m.close();
        if (targetMonth !== activeMonth) {
          activeMonth = targetMonth;
          toast(`Stavka u ${monthLabel(targetMonth)}`, 'success');
        }
        renderSto();
      }
    }
  });
}

/* ============================================================
   STO · UVOZ RAČUNA
   PDF računa (STO Gmbh) → deterministički parser → pregled →
   spremanje kao STO zapisi grupirani po projektu, s razradom
   stavki materijala. Iznosi se u aplikaciju spremaju S PDV-om.
   Ništa se ne sprema automatski — sve prolazi kroz pregled.
   ============================================================ */
let pdfJsPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    s.onload = () => {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      } catch (err) { reject(err); }
    };
    s.onerror = () => { pdfJsPromise = null; reject(new Error('Ne mogu učitati PDF modul — provjeri internetsku vezu')); };
    document.head.appendChild(s);
  });
  return pdfJsPromise;
}

/* Rekonstrukcija vizualnih redaka: grupiranje po Y koordinati, sortiranje po X */
async function extractPdfRows(file) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const rows = [], pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const lines = [];
    for (const it of tc.items) {
      const str = (it.str || '').trim();
      if (!str) continue;
      const x = it.transform[4], y = it.transform[5];
      let row = lines.find(r => Math.abs(r.y - y) <= 2.5);
      if (!row) { row = { y, parts: [] }; lines.push(row); }
      row.parts.push({ x, str });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const r of lines) {
      r.parts.sort((a, b) => a.x - b.x);
      rows.push(r.parts.map(pt => pt.str).join(' '));
      pages.push(p);
    }
  }
  rows.pages = pages;   // stranica svakog retka: STO parser ne spaja nastavak naziva preko granice stranice
  return rows;
}

/* SR-IMPORT-PARSER-START */
/* STO račun (PDF iz sustava STO-a). Redak artikla:
   "00714-030 StoLevell Novo 240 3,600.00 kg 0,49 25,00 1.764,00"
   šifra · naziv · broj pakiranja · količina + jedinica · cijena · [rabat %] · PDV % · iznos bez PDV-a
   Količina je u engleskom zapisu (3,600.00), iznosi u hrvatskom (1.764,00).
   Ispod retka artikla može doći nastavak naziva i veličina pakiranja ("15 kg").
   Zaglavlje: "Broj Broj kupca Datum Mjesec Strana", ispod vrijednosti; broj računa
   od 5 znamenki prelomi se u dva retka ("12729-01-" pa "91").
   Redak se čita s desna (iznosi su najpouzdaniji) i provjerava se:
   količina × cijena × (1 − rabat) ≈ iznos. Ništa se ne preskače potiho: redak koji
   počinje šifrom artikla, a ne da se pročitati, ide u pregled označen za provjeru. */
const INV_UNIT_RE = /^(m2|m3|mm|cm|m|kom|kg|g|t|l|lit|pal|kpl|set|par|h)$/i;
const INV_MONEY_RE = /^-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/;
const INV_SKIP_RE = /^(Broj\b|Naziv artikla|pakir\.|Račun\b|OIB kupca|Sto Ges|STARA RIJEKA|Mavrinci|Ulica |Telefon|www\.|info\.|HR - |Oznaka operatera|Sjedište|Trgovack|Trgovačk|MBS|IBAN|Poziv na broj|Po otpremnici|Sredstvo|Valuta|Obrada dokumenta|Mjesto i datum|Voditelj|Temeljni|Molimo|Poštovani|godine|U slučaju|Hvala|Stranica|Zagreb|\d{5} )/;
const INV_NET_RE = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/;            // iznos: 1.764,00 · 240,00
const INV_EU_NUM_RE = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,4})?$/;   // cijena, rabat, PDV: 0,48 · 25,00
const INV_US_NUM_RE = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?$/;   // količina: 3,600.00 · 500.00
const INV_UNIT_TOKEN_RE = /^[A-Za-zČĆŽŠĐčćžšđ]{1,5}[123²³]?\.?$/;
const INV_QTY_UNIT_RE = /^(-?[\d.,]*\d)([A-Za-zČĆŽŠĐčćžšđ]{1,5}[123²³]?)$/;   // "500.00m" zalijepljeno
const INV_PACK_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d{1,3})?$/;
const INV_CODE_RE = /^((?:HR\s+)?\d{4,7}(?:-\d{1,4}){0,2}-?)(?=\s|$)/;
const INV_ITEM_START_RE = /^(?:HR\s+)?\d{4,7}-\d{2,4}\b/;             // redak počinje šifrom artikla
const INV_NO_FULL_RE = /^\d{3,7}-\d{2}-\d{2}$/;                        // 12729-01-91 · 9094-01-91
const INV_DATE_TOKEN_RE = /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/;
const INV_MONEY_G_RE = /-?\d{1,3}(?:\.\d{3})*,\d{2}\b/g;

function invParseDate(s) {
  const m = String(s || '').match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (!m) return '';
  let y = m[3];
  if (y.length === 2) y = '20' + y;
  return euToISO(`${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${y}`);
}
function invNum(tok, fmt) {
  const s = String(tok || '');
  if (fmt === 'us') return INV_US_NUM_RE.test(s) ? parseFloat(s.replace(/,/g, '')) : null;
  return INV_EU_NUM_RE.test(s) ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : null;
}
/* Provjera retka; tolerancija raste s količinom jer je cijena na računu zaokružena na cente */
function invCheck(qty, price, rabatPct, net, priceTok) {
  if (!(Math.abs(qty) > 0) || price === null) return false;
  const f = 1 - (Number(rabatPct) || 0) / 100;
  const dm = String(priceTok || '').match(/,(\d+)$/);
  const dec = Math.max(dm ? dm[1].length : 0, 2);
  const tol = 0.011 + Math.abs(qty) * 0.5 * Math.pow(10, -dec) * Math.abs(f);
  return Math.abs(qty * price * f - net) <= tol;
}
/* Stavka bez prave šifre i naziva (npr. kad se redak PDF-a raspadne na dva) */
function invWeakIdentity(it) {
  return !!it && !INV_ITEM_START_RE.test(it.code || '') && /^[\d.,\s-]*$/.test(it.name || '');
}
function invApplyHead(it, headLine) {
  const cm = headLine.match(INV_CODE_RE);
  it.code = cm ? cm[1].trim() : it.code;
  it.name = ((cm ? headLine.slice(cm[0].length) : headLine).trim() || it.code || 'Stavka').slice(0, 160);
}

/* Redak artikla → stavka ili null. Tumačenja (sa ili bez rabata, format količine) biraju se provjerom. */
function tryParseInvoiceItemRow(line) {
  const toks = String(line || '').replace(/\s+/g, ' ').trim().split(' ');
  const n = toks.length;
  if (n < 5) return null;
  const netStrict = INV_NET_RE.test(toks[n - 1]);
  if (!netStrict && !INV_EU_NUM_RE.test(toks[n - 1])) return null;
  const net = invNum(toks[n - 1], 'eu');
  const vatPct = invNum(toks[n - 2], 'eu');
  if (vatPct === null || vatPct < 0 || vatPct > 30) return null;
  const variants = [{ priceAt: n - 3, rabatAt: -1 }];
  if (n >= 6 && INV_EU_NUM_RE.test(toks[n - 4]) && INV_EU_NUM_RE.test(toks[n - 3])) variants.push({ priceAt: n - 4, rabatAt: n - 3 });
  let best = null;
  for (const v of variants) {
    const price = invNum(toks[v.priceAt], 'eu');
    if (price === null) continue;
    const rabatPct = v.rabatAt >= 0 ? invNum(toks[v.rabatAt], 'eu') : null;
    if (rabatPct !== null && (rabatPct < 0 || rabatPct > 100)) continue;
    let i = v.priceAt - 1;
    if (i < 0) continue;
    let unit = '', qtyTok;
    const glued = toks[i].match(INV_QTY_UNIT_RE);
    if (i >= 1 && INV_UNIT_TOKEN_RE.test(toks[i])) { unit = toks[i].replace(/\.$/, ''); i--; qtyTok = toks[i]; }
    else if (glued) { qtyTok = glued[1]; unit = glued[2]; }
    else qtyTok = toks[i];
    const cands = [];
    const qUS = invNum(qtyTok, 'us'), qEU = invNum(qtyTok, 'eu');
    if (qUS !== null) cands.push(qUS);
    if (qEU !== null && qEU !== qUS) cands.push(qEU);
    if (!cands.length) continue;
    let qty = cands.find(q => invCheck(q, price, rabatPct, net, toks[v.priceAt]));
    const ok = qty !== undefined;
    if (!ok) qty = cands[0];
    i--;
    if (i >= 1 && INV_PACK_RE.test(toks[i])) i--;   // broj pakiranja
    const prefix = toks.slice(0, i + 1).join(' ').trim();
    const codeM = prefix.match(INV_CODE_RE);
    const code = codeM ? codeM[1].trim() : '';
    const name = (codeM ? prefix.slice(codeM[0].length) : prefix).trim();
    if (!code && !name) continue;
    if (!code && !unit && !ok) continue;
    if (!netStrict && !ok) continue;
    const cand = { code, name: name || code || 'Stavka', qty, unit, unitPrice: price, rabatPct, vatPct, net, ok };
    if (!best || (ok && !best.ok)) best = cand;
    if (ok) break;
  }
  if (!best) return null;
  const item = { code: best.code, name: best.name, qty: best.qty, unit: best.unit, unitPrice: best.unitPrice, rabatPct: best.rabatPct, vatPct: best.vatPct, net: best.net };
  if (!best.ok) item.warn = 'Količina × cijena ne daje iznos s računa. Provjeri količinu i iznos.';
  return item;
}

/* Redak počinje šifrom artikla, ali nije potpuna stavka: uzmi što se može i označi za provjeru */
function invFallbackItem(line) {
  const toks = String(line || '').replace(/\s+/g, ' ').trim().split(' ');
  const n = toks.length;
  if (n < 2 || !INV_NET_RE.test(toks[n - 1])) return null;
  const net = invNum(toks[n - 1], 'eu');
  const vatCand = n >= 3 ? invNum(toks[n - 2], 'eu') : null;
  const hasVat = vatCand !== null && vatCand >= 0 && vatCand <= 30 && /,\d{2}$/.test(toks[n - 2]);
  const codeM = line.match(INV_CODE_RE);
  const code = codeM ? codeM[1].trim() : '';
  const nameToks = [];
  for (const t of (codeM ? line.slice(codeM[0].length) : line).trim().split(' ')) {
    if (/^-?[\d.,]+$/.test(t)) break;
    nameToks.push(t);
  }
  return {
    code,
    name: nameToks.join(' ') || code || 'Stavka',
    qty: 0,
    unit: '',
    unitPrice: 0,
    rabatPct: null,
    vatPct: hasVat ? vatCand : 25,
    net,
    warn: 'Redak nije potpuno pročitan. Provjeri naziv, količinu, PDV i iznos.',
  };
}

/* Iznosi s PDV-om po stavci; razlika zaokruživanja do iznosa računa raspoređuje se po centima */
function invReconcileGross(items, totalGross) {
  const base = items.map(it => grossFromNet(it.net, it.vatPct));
  if (totalGross === null || totalGross === undefined) return base;
  const sum = round2(base.reduce((a, b) => a + b, 0));
  const diffC = Math.round((totalGross - sum) * 100);
  if (diffC === 0 || Math.abs(diffC) > items.length) return base;
  const order = items
    .map((it, i) => ({ i, r: (Number(it.net) || 0) * (1 + (Number(it.vatPct) || 0) / 100) - base[i] }))
    .sort((a, b) => diffC > 0 ? b.r - a.r : a.r - b.r);
  const out = base.slice();
  const step = diffC > 0 ? 0.01 : -0.01;
  for (let k = 0; k < Math.abs(diffC); k++) out[order[k].i] = round2(out[order[k].i] + step);
  return out;
}

/* Zaglavlje: broj računa (i kad je prelomljen u dva retka) i datum računa */
function invParseHeader(lines, out) {
  const takeNo = (first, idx) => {
    let no = first;
    for (let j = idx + 1; j <= idx + 2 && j < lines.length && !INV_NO_FULL_RE.test(no); j++) {
      const nx = lines[j];
      if (!/^-?\d{1,4}(?:-\d{1,4})*-?$/.test(nx)) break;
      if (/-$/.test(no) || /^-/.test(nx)) no = no + nx;
      else if (INV_NO_FULL_RE.test(no + '-' + nx)) no = no + '-' + nx;
      else no = no + nx;
    }
    return no.replace(/-+$/, '');
  };
  for (let i = 0; i < lines.length && !out.invoiceNo; i++) {
    if (!/^Broj\s+Broj kupca\s+Datum\b/i.test(lines[i])) continue;
    for (let j = i + 1; j <= i + 2 && j < lines.length; j++) {
      const v = lines[j].match(/^(\d{3,7}(?:-\d{1,4}){0,2}-?)\s+\d{1,8}\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/);
      if (v) { out.invoiceNo = takeNo(v[1], j); out.date = invParseDate(v[2]); break; }
    }
  }
  if (!out.invoiceNo) {
    for (let i = 0; i < lines.length; i++) {
      const v = lines[i].match(/\b(\d{3,7}-\d{2}-(?:\d{2})?)\s+\d{1,8}\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/);
      if (v) { out.invoiceNo = takeNo(v[1], i); if (!out.date) out.date = invParseDate(v[2]); break; }
    }
  }
  if (!out.date) {
    for (const l of lines) {
      const d = l.match(/^Mjesto i datum:.*?(\d{1,2}\.\d{1,2}\.\d{4})/);
      if (d) { out.date = invParseDate(d[1]); break; }
    }
  }
}

function parseStoInvoiceRows(rows) {
  const out = { invoiceNo: '', date: '', items: [], totalNet: null, totalGross: null, unparsed: [] };
  const pages = rows && Array.isArray(rows.pages) ? rows.pages : null;
  const lines = [], linePage = [];
  Array.from(rows || []).forEach((raw, i) => {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!line) return;
    lines.push(line);
    linePage.push(pages ? pages[i] : 1);
  });
  invParseHeader(lines, out);
  const hasTableHead = lines.some(l => /^Broj artikla\b/.test(l));

  let current = null, contCount = 0, inItems = !hasTableHead, pendingHead = null;
  const flushHead = () => { if (pendingHead) { out.unparsed.push(pendingHead); pendingHead = null; } };
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (li > 0 && linePage[li] !== linePage[li - 1]) current = null;   // nastavak naziva ne prelazi na drugu stranicu
    if (/^Broj artikla\b/.test(line)) { inItems = true; current = null; continue; }
    if (/UKUPNO ZA PLATITI/i.test(line)) {
      const nums = line.match(INV_MONEY_G_RE);
      if (nums) out.totalGross = parseEUAmount(nums[nums.length - 1]);
      flushHead(); current = null; inItems = !hasTableHead; continue;
    }
    if (/^Ukupno:/.test(line)) {
      const nums = line.match(INV_MONEY_G_RE);
      if (nums) out.totalNet = parseEUAmount(nums[nums.length - 1]);
      flushHead(); current = null; continue;
    }
    if (/^(Osnovica za PDV|PDV \d)/.test(line)) { current = null; continue; }
    const item = inItems ? tryParseInvoiceItemRow(line) : null;
    if (item) {
      if (pendingHead && invWeakIdentity(item)) { invApplyHead(item, pendingHead); pendingHead = null; }
      flushHead();
      out.items.push(item); current = item; contCount = 0; continue;
    }
    if (inItems && INV_ITEM_START_RE.test(line) && !INV_DATE_TOKEN_RE.test(line)) {
      const fb = invFallbackItem(line);
      if (fb) { flushHead(); out.items.push(fb); current = fb; contCount = 0; }
      else if (current && invWeakIdentity(current)) { invApplyHead(current, line); contCount = 0; }
      else { flushHead(); pendingHead = line; current = null; }
      continue;
    }
    // Nastavak naziva artikla (drugi red naziva ili veličina pakiranja)
    const moneyCount = (line.match(INV_MONEY_G_RE) || []).length;
    const lastTok = line.split(' ').pop();
    if (current && contCount < 3 && line.length <= 90 && !INV_SKIP_RE.test(line)
        && !INV_DATE_TOKEN_RE.test(line) && moneyCount < 2 && !INV_NET_RE.test(lastTok)
        && !/:\s*(?:-?\d|$)/.test(line)) {
      let cont = line;
      if (/-$/.test(current.code || '')) {
        const cm = cont.match(/^(\d{1,4})\b\s*/);
        if (cm) { current.code += cm[1]; cont = cont.slice(cm[0].length); }
      }
      if (cont) current.name = (current.name + ' ' + cont).trim().slice(0, 160);
      contCount++;
      continue;
    }
    // Redak među stavkama s iznosima, a nije ni stavka ni zbroj: prikaži ga u pregledu
    if (inItems && hasTableHead && moneyCount >= 2 && !INV_SKIP_RE.test(line)) out.unparsed.push(line);
    current = null;
  }
  flushHead();
  if (out.items.length) {
    const sumNet = round2(out.items.reduce((a, it) => a + (Number(it.net) || 0), 0));
    const netOk = out.totalNet !== null && Math.abs(sumNet - out.totalNet) < 0.005;
    const g = invReconcileGross(out.items, netOk ? out.totalGross : null);
    out.items.forEach((it, i) => { it.gross = g[i]; });
  }
  return out;
}
/* SR-IMPORT-PARSER-END */

/* Korak 1: odabir PDF-a (ili tekst / ručni unos) */
function stoImportModal() {
  const html = `
    <div class="modal-title">Uvoz STO računa</div>
    <div class="modal-sub">Ubaci PDF računa — stavke se automatski iščitaju, ti ih pregledaš i rasporediš po projektima. Iznosi se spremaju s PDV-om.</div>
    <label id="imp-drop" style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; border: 2px dashed var(--line); border-radius: 12px; padding: 28px 16px; cursor: pointer; text-align: center; color: var(--muted); transition: border-color .15s;">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
      <span><strong style="color: var(--ink);">Odaberi PDF računa</strong> ili ga dovuci ovdje</span>
      <span style="font-size: 12px;">Radi sa STO računima (tekstualni PDF, ne skenirana slika)</span>
      <input type="file" id="imp-file" accept="application/pdf,.pdf" style="display: none;">
    </label>
    <div id="imp-status" class="field-hint" style="min-height: 16px; margin-top: 10px;"></div>
    <div class="field" style="margin-top: 6px;">
      <label class="field-label">…ili zalijepi tekst računa</label>
      <textarea class="input" id="imp-text" rows="4" placeholder="Kopiraj retke artikala iz PDF preglednika i zalijepi ovdje" style="resize: vertical; min-height: 70px; font-family: inherit;"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn" data-act="manual">Ručni unos stavki</button>
      <button class="btn btn-primary" data-act="parse-text">Parsiraj tekst</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  const status = (msg) => { const el = m.root.querySelector('#imp-status'); if (el) el.textContent = msg; };

  const handleFile = async (file) => {
    if (!file) return;
    if (!/pdf$/i.test(file.type || '') && !/\.pdf$/i.test(file.name || '')) {
      toast('Odaberi PDF datoteku', 'error');
      return;
    }
    try {
      status('Učitavam PDF modul…');
      await loadPdfJs();
      status(`Čitam ${file.name}…`);
      const rows = await extractPdfRows(file);
      const parsed = parseStoInvoiceRows(rows);
      if (!parsed.items.length) {
        status('');
        toast('U PDF-u nisam prepoznao nijednu stavku. Ako je skenirana slika, koristi ručni unos.', 'error', 4200);
        return;
      }
      m.close();
      setTimeout(() => stoImportReview(parsed), 30);
    } catch (err) {
      console.error('PDF import:', err);
      status('');
      toast('Greška pri čitanju PDF-a: ' + (err.message || err), 'error', 4000);
    }
  };

  const drop = m.root.querySelector('#imp-drop');
  const fileInp = m.root.querySelector('#imp-file');
  fileInp.addEventListener('change', () => handleFile(fileInp.files && fileInp.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--acc)'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--line)'; });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.style.borderColor = 'var(--line)';
    handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  m.root.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'manual') {
      m.close();
      setTimeout(() => stoImportReview({ invoiceNo: '', date: '', items: [], totalNet: null, totalGross: null, manual: true }), 30);
    } else if (btn.dataset.act === 'parse-text') {
      const txt = m.root.querySelector('#imp-text').value;
      if (!txt.trim()) { toast('Zalijepi tekst računa ili odaberi PDF', 'error'); return; }
      const parsed = parseStoInvoiceRows(txt.split(/\r?\n/));
      if (!parsed.items.length) {
        toast('Iz teksta nisam prepoznao nijednu stavku. Probaj PDF ili ručni unos.', 'error', 4000);
        return;
      }
      m.close();
      setTimeout(() => stoImportReview(parsed), 30);
    }
  });
}

/* Usporedba zbroja stavki s računom (bez PDV-a i s PDV-om) */
function stoImportTotalsCheck(parsed, totNet, totGross) {
  const hasNet = !!parsed && parsed.totalNet !== null && parsed.totalNet !== undefined;
  const hasGross = !!parsed && parsed.totalGross !== null && parsed.totalGross !== undefined;
  if (!hasNet && !hasGross) return { ok: null, html: '', text: '' };
  if (hasNet && Math.abs(totNet - parsed.totalNet) >= 0.005) {
    return {
      ok: false,
      text: `Račun kaže ${eur(parsed.totalNet, 2)} bez PDV-a, a stavke daju ${eur(totNet, 2)}.`,
      html: `<span style="color: var(--negative);">⚠ račun kaže ${eur(parsed.totalNet, 2)} bez PDV-a, ovdje je ${eur(totNet, 2)}</span>`,
    };
  }
  if (hasGross && Math.abs(totGross - parsed.totalGross) >= 0.005) {
    return {
      ok: false,
      text: `Račun kaže ${eur(parsed.totalGross, 2)} s PDV-om, a stavke daju ${eur(totGross, 2)}.`,
      html: `<span style="color: var(--negative);">⚠ račun kaže ${eur(parsed.totalGross, 2)} s PDV-om, ovdje je ${eur(totGross, 2)}</span>`,
    };
  }
  return {
    ok: true,
    text: '',
    html: `<span style="color: var(--positive);">✓ ${hasNet && hasGross ? 'odgovara računu, bez PDV-a i s PDV-om' : hasNet ? 'zbroj bez PDV-a odgovara računu' : 'zbroj s PDV-om odgovara računu'}</span>`,
  };
}
/* Je li račun već u napomeni zapisa ("Račun 12729-01-91"); 2729-01-91 nije isto što i 12729-01-91 */
function stoNoteHasInvoice(note, invNo) {
  if (!invNo) return false;
  const esc = String(invNo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^\\d-])' + esc + '(?![\\d-])').test(String(note || ''));
}

/* Korak 2: pregled stavki, dodjela projekata, spremanje */
function stoImportReview(parsed) {
  const blankRow = () => ({ code: '', name: '', qty: 0, unit: '', unitPrice: 0, vatPct: 25, net: 0, gross: 0, project: '' });
  const rows = parsed.items.length
    ? parsed.items.map(it => ({
        code: it.code || '',
        name: it.name || '',
        qty: Number(it.qty) || 0,
        unit: it.unit || '',
        unitPrice: Number(it.unitPrice) || 0,
        vatPct: (it.vatPct === 0 || it.vatPct) ? Number(it.vatPct) : 25,
        net: round2(Number(it.net) || 0),
        gross: (typeof it.gross === 'number' && isFinite(it.gross)) ? round2(it.gross) : grossFromNet(it.net, (it.vatPct === 0 || it.vatPct) ? it.vatPct : 25),
        project: '',
        warn: it.warn || '',
      }))
    : [blankRow(), blankRow(), blankRow()];

  const knownProjects = Array.from(new Set([
    ...allMonths().flatMap(k => (state.sto[k] || []).map(x => x.project)),
    ...allMonths().flatMap(k => ((state.hours[k] || {}).days || []).flatMap(d => Object.values(d.workers || {}).map(w => w.project))),
  ].filter(Boolean).map(s => String(s).trim()).filter(Boolean))).sort();

  const mobile = isMobileView();
  const dateMissing = !parsed.date && !parsed.manual;

  const html = `
    <div class="modal-title">${parsed.manual ? 'Ručni unos stavki materijala' : 'Pregled računa' + (parsed.invoiceNo ? ' · ' + escapeHtml(parsed.invoiceNo) : '')}</div>
    <div class="modal-sub">Provjeri stavke i svakoj dodijeli projekt — jedan račun smije ići na više projekata. Iznos s PDV-om se računa automatski.</div>
    <div class="grid grid-2" style="gap: 14px; margin-bottom: 14px;">
      <div class="field"><label class="field-label">Datum računa</label><input class="input${dateMissing ? ' invalid' : ''}" id="ir-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${parsed.date ? isoToEU(parsed.date) : (parsed.manual ? isoToEU(new Date().toISOString().slice(0, 10)) : '')}">${dateMissing ? '<div class="field-hint" style="color: var(--negative);">Datum nije pročitan s računa. Upiši ga.</div>' : ''}</div>
      <div class="field"><label class="field-label">Broj računa</label><input class="input" id="ir-no" value="${escapeHtml(parsed.invoiceNo || '')}" placeholder="Npr. 9094-01-91"></div>
    </div>
    <div class="field" style="margin-bottom: 14px;">
      <label class="field-label">Projekt za sve stavke</label>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        <input class="input" id="ir-all-proj" list="ir-projs" placeholder="Npr. Kostrena" style="flex: 1; min-width: 160px;">
        <button type="button" class="btn" data-act="apply-all">Primijeni na sve</button>
      </div>
      <div class="field-hint">Upiši projekt, primijeni na sve, pa pojedinim stavkama po potrebi promijeni projekt.</div>
      <datalist id="ir-projs">${knownProjects.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
    </div>
    ${mobile ? `
    <div id="ir-rows" style="max-height: 46vh; overflow-y: auto; padding: 2px;"></div>
    ` : `
    <div class="table-scroll" style="max-height: 44vh; overflow: auto; border: 1px solid var(--line); border-radius: 10px;">
      <table class="table" style="min-width: 760px;">
        <thead>
          <tr>
            <th>Artikl</th>
            <th class="text-right">Kol.</th>
            <th>Jed.</th>
            <th class="text-right">Bez PDV</th>
            <th class="text-right">PDV %</th>
            <th class="text-right">S PDV</th>
            <th>Projekt</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="ir-rows"></tbody>
      </table>
    </div>`}
    <div id="ir-summary" style="margin-top: 12px; font-size: 13px; line-height: 1.7;"></div>
    <div class="modal-actions" style="flex-wrap: wrap;">
      <button class="btn" data-act="back">Natrag</button>
      <button type="button" class="btn" data-act="add-row">+ Dodaj red</button>
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  if (!mobile) m.root.querySelector('.modal').style.maxWidth = 'min(1060px, 96vw)';
  attachEUDateMask(m.root.querySelector('#ir-date'));

  const listEl = m.root.querySelector('#ir-rows');
  const summaryEl = m.root.querySelector('#ir-summary');

  const updateSummary = () => {
    const valid = rows.filter(r => (r.name || '').trim() || (Number(r.gross) || 0) > 0);
    const totNet = round2(valid.reduce((a, r) => a + (Number(r.net) || 0), 0));
    const totGross = round2(valid.reduce((a, r) => a + (Number(r.gross) || 0), 0));
    const byProj = {};
    valid.forEach(r => {
      const p = (r.project || '').trim() || 'bez projekta';
      byProj[p] = round2((byProj[p] || 0) + (Number(r.gross) || 0));
    });
    const projLine = Object.entries(byProj).map(([p, v]) =>
      `<span class="pill ${p === 'bez projekta' ? 'red' : 'gray'}" style="margin: 2px 6px 2px 0;">${escapeHtml(p)}: <strong style="margin-left: 4px;">${eur(v, 2)}</strong></span>`
    ).join('');
    const check = stoImportTotalsCheck(parsed, totNet, totGross).html;
    const nWarn = rows.filter(r => r.warn).length;
    const notes = [];
    if (nWarn) {
      const w = (nWarn % 10 === 1 && nWarn % 100 !== 11) ? 'stavka traži' : ([2, 3, 4].includes(nWarn % 10) && ![12, 13, 14].includes(nWarn % 100)) ? 'stavke traže' : 'stavki traži';
      notes.push(`⚠ ${nWarn} ${w} provjeru (naziv je označen crveno)`);
    }
    (parsed.unparsed || []).slice(0, 3).forEach(l => notes.push(`⚠ redak s računa nije pročitan: „${escapeHtml(l.length > 90 ? l.slice(0, 90) + '…' : l)}"`));
    summaryEl.innerHTML = `<div>${projLine || '<span style="color: var(--muted);">Još nijedna stavka nema projekt.</span>'}</div>` +
      `<div style="color: var(--ink-2);">Ukupno: <strong>${eur(totGross, 2)}</strong> s PDV-om · ${eur(totNet, 2)} bez PDV-a${check ? ' · ' + check : ''}</div>` +
      (notes.length ? `<div style="color: var(--negative);">${notes.join('<br>')}</div>` : '');
  };

  const renderRows = () => {
    if (mobile) {
      listEl.innerHTML = rows.map((r, i) => `
      <div class="ir-card">
        <div class="ir-head-row">
          <input class="input${r.warn ? ' invalid' : ''}" data-i="${i}" data-f="name"${r.warn ? ` title="${escapeHtml(r.warn)}"` : ''} value="${escapeHtml(r.name || '')}" placeholder="Naziv artikla" style="flex: 1;">
          <button type="button" class="btn btn-ghost btn-sm btn-danger" data-del-row="${i}" title="Ukloni red">×</button>
        </div>
        <div class="ir-grid-3">
          <div><div class="ir-mini-label">Količina</div><input class="input num" data-i="${i}" data-f="qty" type="text" inputmode="decimal" value="${r.qty ? String(r.qty).replace('.', ',') : ''}" style="width: 100%; text-align: right;"></div>
          <div><div class="ir-mini-label">Jed.</div><input class="input" data-i="${i}" data-f="unit" value="${escapeHtml(r.unit || '')}" style="width: 100%;"></div>
          <div><div class="ir-mini-label">PDV %</div><input class="input num" data-i="${i}" data-f="vatPct" type="text" inputmode="decimal" value="${String(r.vatPct).replace('.', ',')}" style="width: 100%; text-align: right;"></div>
        </div>
        <div class="ir-grid-2">
          <div><div class="ir-mini-label">Bez PDV</div><input class="input num" data-i="${i}" data-f="net" type="text" inputmode="decimal" value="${formatEUAmount(r.net)}" style="width: 100%; text-align: right;"></div>
          <div><div class="ir-mini-label">S PDV</div><input class="input num" data-i="${i}" data-f="gross" type="text" inputmode="decimal" value="${formatEUAmount(r.gross)}" style="width: 100%; text-align: right; font-weight: 600;"></div>
        </div>
        <div style="margin-top: 8px;">
          <div class="ir-mini-label">Projekt</div>
          <input class="input" data-i="${i}" data-f="project" list="ir-projs" value="${escapeHtml(r.project || '')}" placeholder="Projekt" style="width: 100%;">
        </div>
      </div>`).join('');
    } else {
      listEl.innerHTML = rows.map((r, i) => `
      <tr>
        <td style="min-width: 220px;"><input class="input${r.warn ? ' invalid' : ''}" data-i="${i}" data-f="name"${r.warn ? ` title="${escapeHtml(r.warn)}"` : ''} value="${escapeHtml(r.name || '')}" placeholder="Naziv artikla" style="width: 100%; min-width: 210px;"></td>
        <td><input class="input num" data-i="${i}" data-f="qty" type="text" inputmode="decimal" value="${r.qty ? String(r.qty).replace('.', ',') : ''}" style="width: 66px; text-align: right; padding: 10px 8px;"></td>
        <td><input class="input" data-i="${i}" data-f="unit" value="${escapeHtml(r.unit || '')}" style="width: 52px; padding: 10px 8px;"></td>
        <td><input class="input num" data-i="${i}" data-f="net" type="text" inputmode="decimal" value="${formatEUAmount(r.net)}" style="width: 92px; text-align: right; padding: 10px 8px;"></td>
        <td><input class="input num" data-i="${i}" data-f="vatPct" type="text" inputmode="decimal" value="${String(r.vatPct).replace('.', ',')}" style="width: 56px; text-align: right; padding: 10px 8px;"></td>
        <td><input class="input num" data-i="${i}" data-f="gross" type="text" inputmode="decimal" value="${formatEUAmount(r.gross)}" style="width: 96px; text-align: right; font-weight: 600; padding: 10px 8px;"></td>
        <td><input class="input" data-i="${i}" data-f="project" list="ir-projs" value="${escapeHtml(r.project || '')}" placeholder="Projekt" style="width: 134px;"></td>
        <td style="text-align: right;"><button type="button" class="btn btn-ghost btn-sm btn-danger" data-del-row="${i}" title="Ukloni red">×</button></td>
      </tr>`).join('');
    }
    updateSummary();
  };
  renderRows();

  listEl.addEventListener('input', e => {
    const inp = e.target.closest('input[data-i]');
    if (!inp) return;
    const i = +inp.dataset.i, f = inp.dataset.f;
    const r = rows[i];
    if (!r) return;
    if (r.warn && f !== 'project') {
      r.warn = '';
      const nm = listEl.querySelector(`input[data-i="${i}"][data-f="name"]`);
      if (nm) { nm.classList.remove('invalid'); nm.removeAttribute('title'); }
    }
    if (f === 'net' || f === 'gross' || f === 'vatPct' || f === 'qty') {
      r[f] = parseEUAmount(inp.value);
      if (f === 'net' || f === 'vatPct') {
        r.gross = grossFromNet(r.net, r.vatPct);
        const g = listEl.querySelector(`input[data-i="${i}"][data-f="gross"]`);
        if (g && g !== inp) g.value = formatEUAmount(r.gross);
      } else if (f === 'gross') {
        r.net = round2((Number(r.gross) || 0) / (1 + (Number(r.vatPct) || 0) / 100));
        const n = listEl.querySelector(`input[data-i="${i}"][data-f="net"]`);
        if (n && n !== inp) n.value = formatEUAmount(r.net);
      }
    } else {
      r[f] = inp.value;
    }
    updateSummary();
  });
  listEl.addEventListener('focusout', e => {
    const inp = e.target.closest('input[data-i]');
    if (!inp) return;
    const r = rows[+inp.dataset.i];
    if (!r) return;
    const f = inp.dataset.f;
    if (f === 'net' || f === 'gross') inp.value = formatEUAmount(r[f]);
    if (f === 'qty') inp.value = r.qty ? String(r.qty).replace('.', ',') : '';
  });

  const doSave = async () => {
    const dateEU = m.root.querySelector('#ir-date').value.trim();
    const date = euToISO(dateEU);
    if (!date) {
      toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
      m.root.querySelector('#ir-date').classList.add('invalid');
      m.root.querySelector('#ir-date').focus();
      return;
    }
    const invNo = m.root.querySelector('#ir-no').value.trim();
    const clean = rows
      .map(r => ({ ...r, name: (r.name || '').trim(), unit: (r.unit || '').trim(), project: (r.project || '').trim() }))
      .filter(r => r.name || (Number(r.gross) || 0) > 0);
    if (!clean.length) { toast('Nema stavki za spremanje', 'error'); return; }
    for (const r of clean) {
      if (!r.name) { toast('Svaka stavka mora imati naziv', 'error'); return; }
      if (!(Number(r.gross) > 0)) { toast(`Stavka „${r.name}" nema iznos`, 'error'); return; }
      if (!r.project) { toast(`Stavka „${r.name}" nema dodijeljen projekt`, 'error'); return; }
    }
    const tc = stoImportTotalsCheck(parsed,
      round2(clean.reduce((a, r) => a + (Number(r.net) || 0), 0)),
      round2(clean.reduce((a, r) => a + (Number(r.gross) || 0), 0)));
    if (tc.ok === false && !confirm(`${tc.text} Svejedno spremiti?`)) return;
    if (invNo) {
      let dup = 0;
      for (const k of allMonths()) {
        for (const t of (state.sto[k] || [])) {
          if (stoNoteHasInvoice(t.note, invNo)) dup++;
        }
      }
      if (dup && !confirm(`Račun ${invNo} već postoji u aplikaciji (${dup} ${dup === 1 ? 'zapis' : 'zapisa'}). Svejedno spremiti ponovno?`)) return;
    }
    const targetMonth = date.slice(0, 7);
    ensureMonth(targetMonth);
    const byProj = {};
    clean.forEach(r => { (byProj[r.project] = byProj[r.project] || []).push(r); });
    const projNames = Object.keys(byProj);
    // Snapshot za rollback ako spremanje na server ne uspije
    const snapshot = JSON.stringify(state.sto[targetMonth]);
    for (const proj of projNames) {
      const list = byProj[proj];
      state.sto[targetMonth].push({
        date,
        amount: round2(list.reduce((a, r) => a + (Number(r.gross) || 0), 0)),
        project: proj,
        note: invNo ? `Račun ${invNo}` : '',
        items: list.map(r => {
          const it = { name: r.name, qty: Number(r.qty) || 0, unit: r.unit, vatPct: Number(r.vatPct) || 0, net: round2(Number(r.net) || 0), amount: round2(Number(r.gross) || 0) };
          if (r.code) it.code = r.code;
          if (r.unitPrice) it.unitPrice = Number(r.unitPrice) || 0;
          return it;
        }),
      });
    }
    if (await saveData()) {
      m.close();
      activeMonth = targetMonth;
      stoView = 'month';
      toast(`Uvezeno: ${clean.length} ${clean.length === 1 ? 'stavka' : 'stavki'} → ${projNames.length} ${projNames.length === 1 ? 'projekt' : 'projekta'}`, 'success', 3200);
      renderSto();
    } else {
      state.sto[targetMonth] = JSON.parse(snapshot);
    }
  };

  m.root.addEventListener('click', e => {
    const delBtn = e.target.closest('button[data-del-row]');
    if (delBtn) {
      rows.splice(+delBtn.dataset.delRow, 1);
      renderRows();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'back') {
      m.close();
      setTimeout(() => stoImportModal(), 30);
    } else if (btn.dataset.act === 'add-row') {
      rows.push(blankRow());
      renderRows();
      listEl.querySelector(`input[data-i="${rows.length - 1}"][data-f="name"]`)?.focus();
    } else if (btn.dataset.act === 'apply-all') {
      const p = m.root.querySelector('#ir-all-proj').value.trim();
      if (!p) { toast('Upiši naziv projekta', 'error'); return; }
      rows.forEach(r => { r.project = p; });
      renderRows();
      toast(`Projekt „${p}" postavljen na sve stavke`, 'success', 1800);
    } else if (btn.dataset.act === 'save') {
      doSave();
    }
  });
}

/* ============================================================
   STO · STANJE (otvoreni dug prema STO Gmbh)
   Stanje = početno stanje iz IOS-a (Izvod otvorenih stavki)
            + STO računi s datumom nakon IOS-a (iz state.sto, s PDV-om;
              odobrenja su negativni iznosi i sama umanjuju stanje)
            − uplate STO-u s datumom nakon IOS-a (state.stoStanje.uplate)
   Novi IOS se učita iz PDF-a: aplikacija ga usporedi sa svojim
   stanjem na taj dan i tek na potvrdu ga preuzme; stari IOS ide u
   iosHistory (ništa se ne briše). Ako state nema stoStanje (stari
   podaci), seeda se IOS od 26.08.2026 i u Blob se sprema tek pri
   prvoj admin izmjeni, kao i ostali seedovi.
   ============================================================ */
const DEFAULT_STO_IOS_SEED = {
  datum: '2026-08-26',
  iznos: 23161.40,
  izvor: 'IOS STO Gmbh 26.08.2026',
  stavke: [
    { datum: '2026-06-17', broj: '7658-01-91', valuta: '2026-08-01', iznos: 5179.68, otvoreno: 3391.53 },
    { datum: '2026-06-18', broj: '7722-01-91', valuta: '2026-08-02', iznos: 680.44, otvoreno: 680.44 },
    { datum: '2026-06-19', broj: '7863-01-91', valuta: '2026-08-03', iznos: 95.00, otvoreno: 95.00 },
    { datum: '2026-06-23', broj: '7899-01-91', valuta: '2026-08-07', iznos: 2123.10, otvoreno: 2123.10 },
    { datum: '2026-06-26', broj: '8141-01-91', valuta: '2026-08-10', iznos: 475.00, otvoreno: 475.00 },
    { datum: '2026-06-29', broj: '8216-01-91', valuta: '2026-08-13', iznos: 237.50, otvoreno: 237.50 },
    { datum: '2026-06-30', broj: '8302-01-91', valuta: '2026-08-14', iznos: 190.00, otvoreno: 190.00 },
    { datum: '2026-07-02', broj: '8494-01-91', valuta: '2026-08-16', iznos: 440.00, otvoreno: 440.00 },
    { datum: '2026-07-02', broj: '8506-01-91', valuta: '2026-08-16', iznos: 2841.38, otvoreno: 2841.38 },
    { datum: '2026-07-06', broj: '8615-01-91', valuta: '2026-08-20', iznos: 2032.75, otvoreno: 2032.75 },
    { datum: '2026-07-08', broj: '8774-01-91', valuta: '2026-08-22', iznos: 67.93, otvoreno: 67.93 },
    { datum: '2026-07-09', broj: '8924-01-91', valuta: '2026-08-23', iznos: 1790.63, otvoreno: 1790.63 },
    { datum: '2026-07-09', broj: '8926-01-91', valuta: '2026-08-23', iznos: 1812.50, otvoreno: 1812.50 },
    { datum: '2026-07-13', broj: '9054-01-91', valuta: '2026-08-23', iznos: 817.65, otvoreno: 817.65 },
    { datum: '2026-07-13', broj: '9055-01-91', valuta: '2026-08-27', iznos: 257.94, otvoreno: 257.94 },
    { datum: '2026-07-14', broj: '9094-01-91', valuta: '2026-08-28', iznos: 1359.03, otvoreno: 1359.03 },
    { datum: '2026-07-17', broj: '9322-01-91', valuta: '2026-08-31', iznos: 657.88, otvoreno: 657.88 },
    { datum: '2026-07-21', broj: '9509-01-91', valuta: '2026-09-04', iznos: 1214.38, otvoreno: 1214.38 },
    { datum: '2026-07-22', broj: '9621-01-91', valuta: '2026-09-05', iznos: 237.50, otvoreno: 237.50 },
    { datum: '2026-07-23', broj: '9640-01-91', valuta: '2026-09-05', iznos: 235.88, otvoreno: 235.88 },
    { datum: '2026-07-29', broj: '9944-01-91', valuta: '2026-09-11', iznos: 140.88, otvoreno: 140.88 },
    { datum: '2026-08-14', broj: '10532-01-91', valuta: '2026-09-28', iznos: 2016.25, otvoreno: 2016.25 },
    { datum: '2026-08-24', broj: '10833-01-91', valuta: '2026-10-08', iznos: 46.25, otvoreno: 46.25 },
  ],
};

const STO_INV_NO_RE = /Račun\s+(\d{1,6}-\d{2}-\d{2})/;
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowISO = () => new Date().toISOString();   // created / ucitano: puni timestamp, da se uplata unesena prije učitavanja IOS-a razlikuje od one nakon

function ensureStoStanje() {
  if (!state) return;
  if (!state.stoStanje || typeof state.stoStanje !== 'object') state.stoStanje = {};
  const s = state.stoStanje;
  if (!s.ios || typeof s.ios !== 'object' || !s.ios.datum) {
    s.ios = JSON.parse(JSON.stringify(DEFAULT_STO_IOS_SEED));
    s.ios.ucitano = nowISO();
  }
  if (!Array.isArray(s.iosHistory)) s.iosHistory = [];
  if (!Array.isArray(s.uplate)) s.uplate = [];
}

/* Stanje prema STO-u. untilISO = izračun na određeni dan (za usklađenje s novim IOS-om). */
function computeStoStanje(untilISO = null) {
  ensureStoStanje();
  const ios = state.stoStanje.ios;
  const od = ios.datum;
  const inRange = (d) => !!d && d > od && (!untilISO || d <= untilISO);
  let racuni = 0;
  const invoiceKeys = new Set();
  for (const k of allMonths()) {
    const list = (state.sto || {})[k] || [];
    list.forEach((t, i) => {
      if (!inRange(t.date)) return;
      racuni += Number(t.amount) || 0;
      const m = String(t.note || '').match(STO_INV_NO_RE);
      invoiceKeys.add(m ? 'inv:' + m[1] : `rec:${k}:${i}`);
    });
  }
  let uplate = 0, uplateN = 0;
  for (const u of state.stoStanje.uplate) {
    if (!inRange(u.date)) continue;
    uplate += Number(u.amount) || 0;
    uplateN++;
  }
  racuni = round2(racuni);
  uplate = round2(uplate);
  const pocetno = round2(Number(ios.iznos) || 0);
  return { ios, pocetno, racuni, racuniN: invoiceKeys.size, uplate, uplateN, stanje: round2(pocetno + racuni - uplate) };
}

function stoStanjeBigHtml(n) {
  const neg = n < 0;
  const cents = Math.round(Math.abs(n) * 100);
  const int = Math.floor(cents / 100), dec = String(cents % 100).padStart(2, '0');
  return `<span class="currency">${neg ? '−€' : '€'}</span>${FMT_INT.format(int)}<em>,${dec}</em>`;
}

const STO_EDIT_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const STO_DEL_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/></svg>';

/* HTML bloka na vrhu STO taba (mjesečni i godišnji prikaz). */
function buildStoStanjeHtml() {
  const c = computeStoStanje();
  const ios = c.ios;
  const ucitano = ios.ucitano || '';
  const all = state.stoStanje.uplate.map((u, i) => ({ ...u, _idx: i }));
  // Prikazuju se uplate nakon IOS-a + one s datumom prije IOS-a unesene nakon što je ovaj IOS učitan
  // (vjerojatno krivi datum, pa se vide s oznakom). Starije, već obuhvaćene IOS-om, ostaju u podacima.
  const visible = all
    .filter(u => u.date > ios.datum || (u.created || '') >= ucitano)
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b._idx - a._idx);
  const hiddenN = all.length - visible.length;
  const nakon = visible.filter(u => u.date > ios.datum);
  const nakonSum = round2(nakon.reduce((a, u) => a + (Number(u.amount) || 0), 0));
  const plural = (n) => n === 1 ? 'uplata' : (n >= 2 && n <= 4) ? 'uplate' : 'uplata';
  return `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">STO Gmbh</div>
        <h1 class="page-title"><strong>STO</strong> <em>stanje</em></h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary admin-only" id="sto-uplata-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova uplata
        </button>
      </div>
    </div>

    <div class="flourish sto-stanje">
      <div class="eyebrow">Otvoreni dug prema STO-u${c.stanje < 0 ? ' · pretplata' : ''}</div>
      <div class="flourish-stat${c.stanje < 0 ? ' positive' : ''}" id="sto-stanje-big">${stoStanjeBigHtml(c.stanje)}</div>
      <div class="sto-formula">
        <span class="seg"><span>IOS ${isoToEU(ios.datum)}</span><span class="val">${FMT.format(c.pocetno)}</span></span>
        <span class="seg"><span class="op">+</span><span>računi nakon IOS-a · ${c.racuniN}</span><span class="val">${FMT.format(c.racuni)}</span></span>
        <span class="seg"><span class="op">−</span><span>uplate nakon IOS-a · ${c.uplateN}</span><span class="val">${FMT.format(c.uplate)}</span></span>
        <span class="seg sto-ios-link admin-only"><button type="button" class="link" id="sto-ios-load">Učitaj novi IOS</button></span>
      </div>
      <div class="sto-uplate">
        <div class="sto-uplate-head">
          <div class="eyebrow">Uplate nakon IOS-a</div>
          ${nakon.length ? `<div class="sum">${nakon.length} ${plural(nakon.length)} · ${eur(nakonSum, 2)}</div>` : ''}
        </div>
        ${visible.length === 0 ? `<div class="sto-uplate-empty">Nema uplata nakon ${isoToEU(ios.datum)}.</div>` : visible.map(u => {
          const nakonIosa = u.date > ios.datum;
          return `
          <div class="sto-ledger-row${nakonIosa ? '' : ' before-ios'}">
            <span class="d">${isoToEU(u.date)}</span>
            <span class="a">${eur(u.amount, 2)}</span>
            <span class="n">${nakonIosa ? '' : '<span class="pill gray">prije IOS-a · ne ulazi u stanje</span>'}${u.note ? escapeHtml(u.note) : '<span class="none">bez napomene</span>'}</span>
            <span class="act">${isAdmin ? `
              <button class="btn btn-ghost btn-sm" data-act="edit-uplata" data-i="${u._idx}" title="Uredi">${STO_EDIT_ICON}</button>
              <button class="btn btn-ghost btn-sm btn-danger" data-act="del-uplata" data-i="${u._idx}" title="Obriši">${STO_DEL_ICON}</button>` : ''}</span>
          </div>`;
        }).join('')}
        ${hiddenN ? `<div class="sto-uplate-more">Još ${hiddenN} ${plural(hiddenN)} prije IOS-a · ${hiddenN === 1 ? 'obuhvaćena' : 'obuhvaćene'} početnim stanjem</div>` : ''}
      </div>
    </div>
  `;
}

function bindStoStanje(panel) {
  if (!isAdmin) return;
  panel.querySelector('#sto-uplata-add')?.addEventListener('click', () => stoUplataModal());
  panel.querySelector('#sto-ios-load')?.addEventListener('click', () => stoIosModal());
  panel.querySelectorAll('[data-act="edit-uplata"]').forEach(b => b.addEventListener('click', () => stoUplataModal(parseInt(b.dataset.i))));
  panel.querySelectorAll('[data-act="del-uplata"]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Obrisati ovu uplatu?')) return;
    const snapshot = JSON.stringify(state.stoStanje.uplate);
    state.stoStanje.uplate.splice(parseInt(b.dataset.i), 1);
    if (await saveData()) renderSto();
    else state.stoStanje.uplate = JSON.parse(snapshot);
  }));
}

/* Nova / uredi uplata STO-u */
function stoUplataModal(idx = null) {
  ensureStoStanje();
  const list = state.stoStanje.uplate;
  const u = idx !== null ? list[idx] : { date: todayISO(), amount: 0, note: '' };
  if (!u) return;
  const c = computeStoStanje();
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi uplatu' : 'Nova uplata STO-u'}</div>
    <div class="modal-sub">Iznos koji je otišao s računa prema STO Gmbh. Umanjuje stanje.</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="su-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(u.date)}"></div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input num" id="su-amount" type="text" inputmode="decimal" placeholder="0,00" value="${u.amount ? formatEUAmount(u.amount) : ''}"></div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Napomena (opcionalno)</label><input class="input" id="su-note" value="${escapeHtml(u.note || '')}" placeholder="Npr. Izvod 210"></div>
    </div>
    <div class="field-hint" id="su-hint" style="margin-top: 12px; min-height: 16px;"></div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  const dateInp = m.root.querySelector('#su-date');
  const amountInp = m.root.querySelector('#su-amount');
  attachEUDateMask(dateInp);
  attachEUAmountMask(amountInp);

  const hint = () => {
    const el = m.root.querySelector('#su-hint');
    const a = parseEUAmount(amountInp.value);
    const d = euToISO(dateInp.value.trim());
    if (!(a > 0)) { el.innerHTML = ''; return; }
    if (d && d <= c.ios.datum) {
      el.innerHTML = `Datum je prije IOS-a (${isoToEU(c.ios.datum)}): uplata je već u početnom stanju i ne mijenja iznos.`;
      return;
    }
    // Kod uređivanja se stari iznos vrati pa se oduzme novi
    const base = round2(c.stanje + ((idx !== null && u.date > c.ios.datum) ? (Number(u.amount) || 0) : 0));
    el.innerHTML = `Nakon spremanja: stanje ${FMT.format(base)} → <strong>${eur(round2(base - a), 2)}</strong>`;
  };
  amountInp.addEventListener('input', hint);
  dateInp.addEventListener('input', hint);
  hint();
  if (idx === null) setTimeout(() => amountInp.focus(), 50);

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'del') {
      if (!confirm('Obrisati ovu uplatu?')) return;
      const snapshot = JSON.stringify(list);
      list.splice(idx, 1);
      if (await saveData()) { m.close(); renderSto(); }
      else state.stoStanje.uplate = JSON.parse(snapshot);
      return;
    }
    if (btn.dataset.act === 'save') {
      const date = euToISO(dateInp.value.trim());
      if (!date) {
        toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
        dateInp.classList.add('invalid');
        dateInp.focus();
        return;
      }
      const amount = round2(parseEUAmount(amountInp.value));
      if (!(amount > 0)) { toast('Unesi iznos uplate', 'error'); amountInp.focus(); return; }
      const newU = { ...u, date, amount, note: m.root.querySelector('#su-note').value.trim() };
      if (!newU.created) newU.created = nowISO();
      const snapshot = JSON.stringify(list);
      if (idx !== null) list[idx] = newU; else list.push(newU);
      if (await saveData()) { m.close(); renderSto(); }
      else state.stoStanje.uplate = JSON.parse(snapshot);
    }
  });
}

/* SR-IOS-PARSER-START */
/* IOS (Izvod otvorenih stavki, STO Gmbh) · redak stavke:
   "17.06.2026 7658-01-91 512172 IFAN Izl.rn. 7658-01-91 01.08.2026 5.179,68 3.391,53 3.391,53"
   Datum · Vezni dok. · Lok.dok. · Kl.dok. · Opis · Valuta · Iznos · Otvoreno · Saldo */
const IOS_MONEY_SRC = '(-?\\d{1,3}(?:\\.\\d{3})*,\\d{2})';
const IOS_ROW_RE = new RegExp('^(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(\\S+)\\s+\\S+\\s+\\S+\\s+Izl\\.rn\\.\\s+\\S+\\s+(\\d{2}\\.\\d{2}\\.\\d{4})\\s+' + IOS_MONEY_SRC + '\\s+' + IOS_MONEY_SRC + '\\s+' + IOS_MONEY_SRC + '$');
const IOS_TOTAL_RE = new RegExp('^' + IOS_MONEY_SRC + '\\s+' + IOS_MONEY_SRC + '\\s+' + IOS_MONEY_SRC + '$');
const IOS_HEAD_RE = /Izvod otvorenih stavki.*?na dan\s+(\d{2}\.\d{2}\.\d{4})/i;
function iosDateToISO(s) {
  const m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
}
function parseStoIosRows(rows) {
  const out = { datum: '', stavke: [], total: null, sumOtvoreno: 0 };
  for (const raw of rows) {
    const line = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    if (!out.datum) {
      const h = line.match(IOS_HEAD_RE);
      if (h) out.datum = iosDateToISO(h[1]);
    }
    let m = line.match(IOS_ROW_RE);
    if (m) {
      out.stavke.push({ datum: iosDateToISO(m[1]), broj: m[2], valuta: iosDateToISO(m[3]), iznos: parseEUAmount(m[4]), otvoreno: parseEUAmount(m[5]) });
      continue;
    }
    m = line.match(IOS_TOTAL_RE);
    if (m && out.stavke.length && out.total === null) out.total = { iznos: parseEUAmount(m[1]), otvoreno: parseEUAmount(m[2]) };
  }
  out.sumOtvoreno = round2(out.stavke.reduce((a, s) => a + (Number(s.otvoreno) || 0), 0));
  return out;
}
/* SR-IOS-PARSER-END */

/* Korak 1: PDF IOS-a (ili ručni unos datuma i iznosa) */
function stoIosModal() {
  ensureStoStanje();
  const cur = state.stoStanje.ios;
  const html = `
    <div class="modal-title">Novi IOS</div>
    <div class="modal-sub">Ubaci PDF „Izvod otvorenih stavki" koji pošalje STO. Aplikacija ga pročita, usporedi sa svojim stanjem na taj dan i tek na tvoju potvrdu preuzme kao novo početno stanje. Trenutni IOS (${isoToEU(cur.datum)} · ${eur(cur.iznos, 2)}) ostaje arhiviran.</div>
    <label id="ios-drop" class="sto-ios-drop">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 12 15 15"/></svg>
      <span><strong style="color: var(--ink);">Odaberi PDF IOS-a</strong> ili ga dovuci ovdje</span>
      <span style="font-size: 12px;">Tekstualni PDF kakav šalje STO, ne skenirana slika</span>
      <input type="file" id="ios-file" accept="application/pdf,.pdf" style="display: none;">
    </label>
    <div id="ios-status" class="field-hint" style="min-height: 16px; margin-top: 10px;"></div>
    <div class="field" style="margin-top: 10px;">
      <label class="field-label">…ili upiši ručno</label>
      <div class="grid grid-2" style="gap: 10px;">
        <input class="input" id="ios-date" type="text" inputmode="numeric" placeholder="Datum IOS-a · DD/MM/YYYY" maxlength="10">
        <input class="input num" id="ios-amount" type="text" inputmode="decimal" placeholder="Otvoreno · 0,00">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="manual">Dalje</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  attachEUDateMask(m.root.querySelector('#ios-date'));
  attachEUAmountMask(m.root.querySelector('#ios-amount'));
  const status = (msg) => { const el = m.root.querySelector('#ios-status'); if (el) el.textContent = msg; };

  const handleFile = async (file) => {
    if (!file) return;
    if (!/pdf$/i.test(file.type || '') && !/\.pdf$/i.test(file.name || '')) {
      toast('Odaberi PDF datoteku', 'error');
      return;
    }
    try {
      status('Učitavam PDF modul…');
      await loadPdfJs();
      status(`Čitam ${file.name}…`);
      const rows = await extractPdfRows(file);
      const parsed = parseStoIosRows(rows);
      if (!parsed.datum || (!parsed.total && !parsed.stavke.length)) {
        status('');
        toast('Ovo ne izgleda kao STO IOS (nema datuma ili stavki). Provjeri PDF ili upiši ručno.', 'error', 4200);
        return;
      }
      m.close();
      setTimeout(() => stoIosReview(parsed), 30);
    } catch (err) {
      console.error('IOS import:', err);
      status('');
      toast('Greška pri čitanju PDF-a: ' + (err.message || err), 'error', 4000);
    }
  };

  const drop = m.root.querySelector('#ios-drop');
  const fileInp = m.root.querySelector('#ios-file');
  fileInp.addEventListener('change', () => handleFile(fileInp.files && fileInp.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.style.borderColor = 'var(--acc)'; });
  drop.addEventListener('dragleave', () => { drop.style.borderColor = 'var(--line)'; });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.style.borderColor = 'var(--line)';
    handleFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  m.root.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'manual') {
      const dateInp = m.root.querySelector('#ios-date');
      const datum = euToISO(dateInp.value.trim());
      const iznos = round2(parseEUAmount(m.root.querySelector('#ios-amount').value));
      if (!datum) { toast('Upiši datum IOS-a (DD/MM/YYYY) ili odaberi PDF', 'error'); dateInp.classList.add('invalid'); dateInp.focus(); return; }
      if (!(Math.abs(iznos) > 0)) { toast('Upiši otvoreni iznos iz IOS-a', 'error'); m.root.querySelector('#ios-amount').focus(); return; }
      m.close();
      setTimeout(() => stoIosReview({ datum, stavke: [], total: { iznos: iznos, otvoreno: iznos }, sumOtvoreno: iznos, manual: true }), 30);
    }
  });
}

/* Korak 2: usklađenje (STO vs aplikacija na taj dan) i preuzimanje kao početno stanje */
function stoIosReview(parsed) {
  ensureStoStanje();
  const cur = state.stoStanje.ios;
  const datum = parsed.datum;
  const stoIznos = round2(parsed.total ? (Number(parsed.total.otvoreno) || 0) : parsed.sumOtvoreno);
  const stavkeMismatch = !!(parsed.total && parsed.stavke.length && Math.abs(round2(parsed.total.otvoreno) - parsed.sumOtvoreno) >= 0.005);
  const stariji = datum < cur.datum;
  const c = computeStoStanje(datum);
  const appIznos = stariji ? null : c.stanje;
  const razlika = appIznos === null ? null : round2(stoIznos - appIznos);
  const ok = razlika !== null && Math.abs(razlika) < 0.005;
  const isti = datum === cur.datum && Math.abs(stoIznos - (Number(cur.iznos) || 0)) < 0.005;

  let hint;
  if (stariji) hint = `Ovaj IOS (${isoToEU(datum)}) je stariji od trenutnog početnog stanja (${isoToEU(cur.datum)}), pa ga ne mogu usporediti s aplikacijom. Preuzmi ga samo ako si siguran.`;
  else if (ok) hint = 'Aplikacija i STO se slažu na cent. Preuzimanjem ovaj IOS postaje novo početno stanje, a računi i uplate do tog datuma više ne ulaze u izračun (već su u njemu).';
  else hint = `Razlika ${eur(razlika, 2)}: ${razlika > 0 ? 'STO ima više otvorenog nego aplikacija, pa u aplikaciji vjerojatno fali račun ili je viška uplata.' : 'Aplikacija ima više otvorenog nego STO, pa vjerojatno fali odobrenje ili uplata, ili je račun unesen dvaput.'} Provjeri prije preuzimanja; možeš i svejedno preuzeti IOS, STO-ov iznos tada postaje početno stanje.`;

  const html = `
    <div class="modal-title">Novi IOS · usklađenje</div>
    <div class="modal-sub">${parsed.manual ? 'Ručni unos.' : `Pročitano iz PDF-a: ${parsed.stavke.length} ${parsed.stavke.length === 1 ? 'stavka' : (parsed.stavke.length >= 2 && parsed.stavke.length <= 4) ? 'stavke' : 'stavki'}.`} Usporedba stanja STO-a i aplikacije na dan ${isoToEU(datum)}.</div>
    <div class="kpi-row" style="margin-bottom: 16px; grid-template-columns: 1fr 1fr;">
      <div class="kpi-cell"><div class="stat-label">IOS na dan</div><div class="stat-value" style="font-size: 22px;">${isoToEU(datum)}</div><div class="stat-sub">${parsed.manual ? 'ručni unos' : 'pročitano iz PDF-a'}</div></div>
      <div class="kpi-cell"><div class="stat-label">STO kaže otvoreno</div><div class="stat-value" style="font-size: 22px;">${eur(stoIznos, 2)}</div>${stavkeMismatch ? `<div class="stat-sub" style="color: var(--negative);">zbroj stavki ${eur(parsed.sumOtvoreno, 2)} ≠ ukupno</div>` : ''}</div>
      <div class="kpi-cell"><div class="stat-label">Aplikacija na taj dan</div><div class="stat-value" style="font-size: 22px;">${appIznos === null ? '—' : eur(appIznos, 2)}</div>${appIznos === null ? '' : `<div class="stat-sub">IOS ${isoToEU(cur.datum)} + računi − uplate do ${isoToEU(datum)}</div>`}</div>
      <div class="kpi-cell"><div class="stat-label">Razlika</div><div class="stat-value ${razlika === null ? 'muted' : ok ? 'positive' : 'negative'}" style="font-size: 22px;">${razlika === null ? '—' : eur(razlika, 2)}</div>${ok ? '<div class="stat-sub" style="color: var(--positive);">✓ usklađeno</div>' : ''}</div>
    </div>
    <div class="field-hint" style="font-style: normal; font-size: 12px; line-height: 1.6;">${hint}</div>
    <div class="modal-actions">
      <button class="btn" data-act="back">Natrag</button>
      <button class="btn btn-primary" data-act="confirm">${isti ? 'Osvježi početno stanje' : 'Preuzmi kao početno stanje'}</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'back') {
      m.close();
      setTimeout(() => stoIosModal(), 30);
      return;
    }
    if (btn.dataset.act === 'confirm') {
      if (!ok && !confirm(`Stanje nije usklađeno (razlika ${razlika === null ? 'nepoznata' : eur(razlika, 2)}). Svejedno preuzeti IOS ${isoToEU(datum)} kao početno stanje?`)) return;
      const snapshot = JSON.stringify(state.stoStanje);
      state.stoStanje.iosHistory.push({ ...cur, zamijenjeno: todayISO(), appNaDan: appIznos, razlika });
      state.stoStanje.ios = {
        datum,
        iznos: stoIznos,
        izvor: parsed.manual ? 'ručni unos' : 'IOS PDF',
        stavke: parsed.stavke.map(s => ({ ...s })),
        ucitano: nowISO(),
      };
      if (await saveData()) {
        m.close();
        toast(`Početno stanje: IOS ${isoToEU(datum)} · ${eur(stoIznos, 2)}`, 'success', 3200);
        renderSto();
      } else {
        state.stoStanje = JSON.parse(snapshot);
      }
    }
  });
}

/* ============================================================
   RENDER: PROJEKTI
   Materijal (STO) + rad (sati × satnica + marenda, po danu)
   spojeni po nazivu projekta. Radnici sa satnicom 0 (npr.
   Dragan) ne ulaze u obračun rada. Čisto izračunato iz
   postojećih podataka — ništa se ne sprema.
   ============================================================ */
const PROJ_NONE = '__bez_projekta__';
const PROJ_GODISNJI = '__godisnji__';

/* Radni dani (pon-pet) u mjesecu; opcionalno samo do zadanog ISO datuma (ukljucivo) */
function workdaysInMonth(key, upToISO) {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return 0;
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d++) {
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (upToISO && iso > upToISO) break;
    const dow = new Date(y, m - 1, d).getDay();
    if (dow >= 1 && dow <= 5) n++;
  }
  return n;
}

/* Sati godisnjeg u mjesecu (radni dani pon-pet x 8 h), iz Registra, samo radnici sa satnicom.
   Broje se iskljucivo periodi s upisanim datumima od-do. */
function godisnjiHoursInMonth(key, upToISO) {
  const god = state.registar && state.registar.godisnji;
  if (!god) return 0;
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return 0;
  const mStart = `${key}-01`;
  const mEnd = `${key}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`;
  let hours = 0;
  for (const w of state.settings.workers) {
    if (!(w.satnica > 0)) continue;
    const g = god[w.name];
    if (!g || !Array.isArray(g.periodi)) continue;
    for (const p of g.periodi) {
      if (!p.od || !p.do) continue;
      let a = p.od > mStart ? p.od : mStart;
      let b = p.do < mEnd ? p.do : mEnd;
      if (upToISO && b > upToISO) b = upToISO;
      if (a > b) continue;
      const cur = new Date(a + 'T12:00:00');
      const end = new Date(b + 'T12:00:00');
      while (cur <= end) {
        const dow = cur.getDay();
        if (dow >= 1 && dow <= 5 && workerActiveOn(w, isoDateLocal(cur))) hours += 8;
        cur.setDate(cur.getDate() + 1);
      }
    }
  }
  return hours;
}

/* Stvarni trosak mjeseca, podijeljen na dva dijela:
   - radnici: ukupni mjesecni trosak firme za radnike sa satnicom (fiksno + isplata + prijevoz + stan)
   - rezija:  fiksne osobe (bez duplikata s radnicima) + radnici bez satnice + tekuci troskovi bez placa
   Za tekuci kalendarski mjesec fiksni dio se razmjerno smanjuje na protekle radne dane. */
function computeMonthCostsV3(key) {
  const stats = computeWorkerStats(key) || [];
  const satnicaOf = {};
  for (const w of state.settings.workers) satnicaOf[w.name] = Number(w.satnica) || 0;
  const today = todayISO();
  const inProgress = key === today.slice(0, 7);
  let frac = 1;
  if (inProgress) {
    const total = workdaysInMonth(key);
    const done = workdaysInMonth(key, today);
    frac = total > 0 ? Math.max(done, 1) / total : 1;
  }
  // Tekući mjesec: svaki radnik nosi dio troška koji odgovara proteklom dijelu njegovog perioda rada
  // (bez perioda rada to je isti udio kao frac, pa se za stare podatke ništa ne mijenja)
  let radnici = 0, rezOsobe = 0;
  for (const st of stats) {
    const w = state.settings.workers.find(x => x.name === st.name);
    const f = inProgress ? workerElapsedShare(w, key, today) : 1;
    if ((satnicaOf[st.name] || 0) > 0) radnici += st.mjesecniTrosak * f;
    else rezOsobe += st.mjesecniTrosak * f;
  }
  const wNames = new Set(state.settings.workers.map(w => (w.name || '').trim().toLowerCase()));
  for (const f of getFixedLabor()) {
    if (!wNames.has((f.name || '').trim().toLowerCase())) rezOsobe += (Number(f.amount) || 0) * frac;
  }
  let tekuci = 0;
  for (const t of (state.trx[key] || [])) {
    if (t.type === 'Trošak' && t.group === 'Tekući' && t.category !== 'Plaće') tekuci += t.amount;
  }
  return { radnici, rezija: rezOsobe + tekuci, frac, inProgress };
}

function computeProjectsDataV3() {
  const map = {};
  const ensure = (name) => {
    if (!map[name]) map[name] = { name, materijal: 0, rad: 0, rez: 0, radIsplata: 0, sati: 0, months: {}, workers: {}, stoCount: 0, lastActivity: '', daysSet: new Set(), nepotpunSet: new Set(), inProgressSet: new Set() };
    return map[name];
  };
  const mEnsure = (p, k) => {
    if (!p.months[k]) p.months[k] = { materijal: 0, rad: 0, rez: 0, sati: 0, udio: 0 };
    return p.months[k];
  };
  const months = allMonths();
  const nSatnica = state.settings.workers.filter(w => Number(w.satnica) > 0).length;
  const today = todayISO();

  for (const k of months) {
    for (const t of (state.sto[k] || [])) {
      const name = (t.project || '').trim() || PROJ_NONE;
      const p = ensure(name);
      p.materijal += t.amount;
      p.stoCount++;
      mEnsure(p, k).materijal += t.amount;
      if (k > p.lastActivity) p.lastActivity = k;
    }

    /* Sati po projektu i radniku u ovom mjesecu (samo radnici sa satnicom) */
    const projH = {};   // ime -> sati
    const projW = {};   // ime -> { radnik -> { sati, dani:Set } }
    let satiOdradeni = 0;
    const h = state.hours[k];
    if (h && h.days) {
      for (const d of h.days) {
        for (const wName of Object.keys(d.workers || {})) {
          const wd = d.workers[wName];
          if (!wd || !(wd.hours > 0)) continue;
          const wAct = state.settings.workers.find(x => x.name === wName);
          if (wAct && !workerActiveOn(wAct, d.date)) continue;   // izvan perioda rada: ne računa se
          const name = (wd.project || '').trim() || PROJ_NONE;
          const pd = ensure(name);
          if (d.date) pd.daysSet.add(d.date);
          if (k > pd.lastActivity) pd.lastActivity = k;
          const w = state.settings.workers.find(x => x.name === wName);
          if (!w || !(w.satnica > 0)) continue;
          satiOdradeni += wd.hours;
          projH[name] = (projH[name] || 0) + wd.hours;
          if (!projW[name]) projW[name] = {};
          if (!projW[name][wName]) projW[name][wName] = { sati: 0, dani: new Set() };
          projW[name][wName].sati += wd.hours;
          if (d.date) projW[name][wName].dani.add(d.date);
          pd.radIsplata += wd.hours * w.satnica + (wd.marenda || 0);
        }
      }
    }

    /* Stvarni trosak mjeseca i njegova raspodjela po udjelu sati */
    const c = computeMonthCosts(k);
    const godH = godisnjiHoursInMonth(k, c.inProgress ? today : null);
    const satiUk = satiOdradeni + godH;
    const rRad = satiUk > 0 ? c.radnici / satiUk : 0;
    const rRez = satiUk > 0 ? c.rezija / satiUk : 0;
    const kapacitet = capacityHoursInMonth(k, c.inProgress ? today : null);   // po periodu rada svakog radnika (prije: nSatnica × radni dani × 8)
    const nepotpun = !c.inProgress && kapacitet > 0 && satiUk < 0.5 * kapacitet && (c.radnici + c.rezija) > 0.005;

    for (const name of Object.keys(projH)) {
      const hh = projH[name];
      const p = ensure(name);
      const rad = hh * rRad, rz = hh * rRez;
      p.rad += rad; p.rez += rz; p.sati += hh;
      const mm = mEnsure(p, k);
      mm.rad += rad; mm.rez += rz; mm.sati += hh;
      mm.udio = satiUk > 0 ? (hh / satiUk) * 100 : 0;
      if (nepotpun) p.nepotpunSet.add(k);
      if (c.inProgress) p.inProgressSet.add(k);
      for (const wName of Object.keys(projW[name] || {})) {
        const src = projW[name][wName];
        if (!p.workers[wName]) p.workers[wName] = { sati: 0, rad: 0, rez: 0, dani: 0 };
        p.workers[wName].sati += src.sati;
        p.workers[wName].rad += src.sati * rRad;
        p.workers[wName].rez += src.sati * rRez;
        p.workers[wName].dani += src.dani.size;
      }
    }

    /* Godisnji odmor kao vlastita kosara — preuzima svoj udio troska mjeseca */
    if (godH > 0.005) {
      const g = ensure(PROJ_GODISNJI);
      g.sati += godH;
      g.rad += godH * rRad;
      g.rez += godH * rRez;
      const gm = mEnsure(g, k);
      gm.sati += godH; gm.rad += godH * rRad; gm.rez += godH * rRez;
      gm.udio = satiUk > 0 ? (godH / satiUk) * 100 : 0;
      if (k > g.lastActivity) g.lastActivity = k;
    }

    /* Mjesec bez ijednog evidentiranog sata: cijeli trosak ide u "Bez projekta" */
    if (satiUk <= 0 && (c.radnici + c.rezija) > 0.005) {
      const n = ensure(PROJ_NONE);
      n.rad += c.radnici; n.rez += c.rezija;
      const nm = mEnsure(n, k);
      nm.rad += c.radnici; nm.rez += c.rezija; nm.udio = 100;
      n.nepotpunSet.add(k);
      if (k > n.lastActivity) n.lastActivity = k;
    }
  }

  const list = Object.values(map);
  const lastKey = months.length ? months[months.length - 1] : null;
  const prevKey = lastKey ? addCalendarMonths(lastKey, -1) : null;
  for (const p of list) {
    p.ukupno = p.materijal + p.rad + p.rez;
    p.isActive = !!lastKey && (p.lastActivity === lastKey || p.lastActivity === prevKey);
    p.monthCount = Object.keys(p.months).length;
    p.workerCount = Object.keys(p.workers).length;
    /* Obracun: kalendarski raspon + dani s evidencijom + rucno uneseni podaci */
    p.dani = p.daysSet ? p.daysSet.size : 0;
    const dates = p.daysSet ? Array.from(p.daysSet).sort() : [];
    p.prviDan = dates.length ? dates[0] : null;
    p.zadnjiDan = dates.length ? dates[dates.length - 1] : null;
    p.kalDana = (p.prviDan && p.zadnjiDan)
      ? Math.round((new Date(p.zadnjiDan) - new Date(p.prviDan)) / 86400000) + 1
      : 0;
    delete p.daysSet;
    p.nepotpunMonths = Array.from(p.nepotpunSet).sort();
    delete p.nepotpunSet;
    p.inProgressMonths = Array.from(p.inProgressSet).sort();
    delete p.inProgressSet;
    const ob = (state.obracun && typeof state.obracun === 'object') ? state.obracun[p.name] : null;
    p.uplate = (ob && Array.isArray(ob.uplate)) ? ob.uplate : [];
    p.naplaceno = round2(p.uplate.reduce((a, u) => a + (Number(u.amount) || 0), 0));
    p.ponuda = (ob && Number(ob.ponuda) > 0) ? round2(Number(ob.ponuda)) : null;
    p.ponudaStavke = (ob && Array.isArray(ob.ponudaStavke)) ? ob.ponudaStavke : [];
    p.zakljucen = !!(ob && ob.zakljucen);
    p.troskoviRucni = (ob && Array.isArray(ob.troskovi)) ? ob.troskovi : [];
    p.trosakRucni = round2(p.troskoviRucni.reduce((a, t) => a + (Number(t.amount) || 0), 0));
    p.materijalBezPdv = round2(p.materijal / 1.25);
    p.trosak = round2(p.materijalBezPdv + p.rad + p.rez + p.trosakRucni);
    /* Zarada se ne prikazuje dok projekt dodiruje mjesec s nepotpunom evidencijom */
    p.zaradaBlocked = p.nepotpunMonths.length > 0 && p.name !== PROJ_NONE;
    p.zarada = (p.naplaceno > 0 && !p.zaradaBlocked) ? round2(p.naplaceno - p.trosak) : null;
    p.marza = (p.zarada !== null && p.naplaceno > 0) ? (p.zarada / p.naplaceno) * 100 : null;
    /* Naplaceno veliko, a rad + rezija zanemarivi: sati ocito nisu upisani */
    p.warnEvidencija = p.naplaceno > 0 && !p.zaradaBlocked && (p.rad + p.rez) < 0.10 * p.naplaceno;
  }
  return list;
}

/* Povratak povlacenjem s lijevog ruba (detalj -> lista -> grupe), samo touch */
let __projSwipeInit = false;
function initProjectsSwipe() {
  if (__projSwipeInit) return;
  const panel = document.getElementById('panel-projects');
  if (!panel) return;
  __projSwipeInit = true;
  let sx = 0, sy = 0, dx = 0, on = false, w = 0, t0 = 0;
  panel.addEventListener('touchstart', (e) => {
    if (activeTab !== 'projects') return;
    if (activeProject === null && projectsGroup === null) return;
    const t = e.touches[0];
    if (t.clientX - panel.getBoundingClientRect().left > 30) return;
    sx = t.clientX; sy = t.clientY; dx = 0; on = true; t0 = Date.now();
    w = panel.getBoundingClientRect().width;
    panel.classList.add('swiping');
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (!on) return;
    const t = e.touches[0];
    const dy = Math.abs(t.clientY - sy);
    dx = Math.max(0, t.clientX - sx);
    if (dy > 30 && dx < dy) { on = false; panel.classList.remove('swiping'); panel.style.transform = ''; return; }
    panel.style.transform = 'translateX(' + dx + 'px)';
  }, { passive: true });
  const fin = () => {
    if (!on) return;
    on = false;
    panel.classList.remove('swiping');
    panel.style.transform = '';
    const brzo = dx / Math.max(1, Date.now() - t0) > 0.5;
    if (dx > w * 0.28 || (brzo && dx > 40)) {
      if (activeProject !== null) activeProject = null;
      else projectsGroup = null;
      renderProjects();
      window.scrollTo(0, 0);
    }
  };
  panel.addEventListener('touchend', fin);
  panel.addEventListener('touchcancel', fin);
}

function renderProjects() {
  initProjectsSwipe();
  const all = computeProjectsData();
  if (activeProject !== null) {
    const p = all.find(x => x.name === activeProject);
    if (p) return renderProjectDetail(p);
    activeProject = null;
  }

  const panel = document.getElementById('panel-projects');
  const hiddenSet = new Set(state.hiddenProjects || []);
  const realAll = all.filter(p => p.name !== PROJ_NONE && p.name !== PROJ_GODISNJI);
  const god = all.find(p => p.name === PROJ_GODISNJI);
  const real = realAll.filter(p => !hiddenSet.has(p.name));
  const removed = realAll.filter(p => hiddenSet.has(p.name)).sort((a, b) => b.ukupno - a.ukupno);
  const removedTotal = removed.reduce((a, p) => a + p.ukupno, 0);
  const none = all.find(p => p.name === PROJ_NONE);

  const byActivity = (a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || '') || a.name.localeCompare(b.name, 'hr');
  const tekuci = real.filter(p => !p.zakljucen).sort(byActivity);
  const zavrseni = real.filter(p => p.zakljucen).sort(byActivity);

  /* ---- Razina 2: lista projekata odabrane grupe ---- */
  if (projectsGroup === 'tekuci' || projectsGroup === 'zavrseni') {
    const isTek = projectsGroup === 'tekuci';
    const group = isTek ? tekuci : zavrseni;
    const pickRow = (p) => `
      <div class="pick-row${p.zakljucen ? ' done' : ''}" data-proj="${escapeHtml(p.name)}">
        <span class="nm">${escapeHtml(p.name)}</span>
        <span class="side">
          ${!p.zakljucen && p.isActive ? '<span class="pill brown">aktivan</span>' : ''}
          <span class="chev">›</span>
        </span>
      </div>`;

    panel.innerHTML = `
      <div class="page-head">
        <div class="page-title-block">
          <button class="proj-back" id="grp-back">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            Projekti
          </button>
          <h1 class="page-title">${isTek ? 'Tekući' : 'Završeni'} <em>· ${group.length} ${hrPlural(group.length, 'projekt', 'projekta', 'projekata')}</em></h1>
        </div>
      </div>
      ${group.length
        ? `<div class="pick-list">${group.map(pickRow).join('')}</div>`
        : `<div class="empty" style="padding: 20px; text-align: left;">${isTek ? 'Nema tekućih projekata.' : 'Još nijedan projekt nije zaključen.'}</div>`}
    `;

    panel.querySelector('#grp-back').addEventListener('click', () => {
      projectsGroup = null;
      renderProjects();
    });
    panel.querySelectorAll('.pick-row[data-proj]').forEach(row => row.addEventListener('click', () => {
      activeProject = row.dataset.proj;
      renderProjects();
    }));
    return;
  }

  /* ---- Razina 1: odabir grupe ---- */
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">Obračun · troškovi · zarada</div>
        <h1 class="page-title">Projekti</h1>
      </div>
    </div>
    ${renderProjektiPregledHtml(all)}
    <div style="font-size: 13.5px; color: var(--muted); margin: -12px 0 14px;">Odaberi grupu, zatim projekt</div>

    <div class="pick-list">
      <div class="pick-row" data-group="tekuci">
        <span class="nm">Tekući</span>
        <span class="side"><span class="pill brown">${tekuci.length}</span><span class="chev">›</span></span>
      </div>
      <div class="pick-row" data-group="zavrseni">
        <span class="nm">Završeni</span>
        <span class="side"><span class="pill gray">${zavrseni.length}</span><span class="chev">›</span></span>
      </div>
    </div>

    ${(none || god) ? `
    <div class="pick-h">Neraspoređeno</div>
    <div class="pick-list">
      ${none ? `
      <div class="pick-row done" data-proj="${PROJ_NONE}">
        <span class="nm" style="font-size: 16px;">Bez projekta</span>
        <span class="side"><span class="pill gray">${eur(none.materijalBezPdv + none.rad + none.rez, 0)}</span><span class="chev">›</span></span>
      </div>` : ''}
      ${god ? `
      <div class="pick-row done" style="cursor: default;">
        <span class="nm" style="font-size: 16px;">Godišnji odmor</span>
        <span class="side"><span class="pill gray">${FMT_INT.format(god.sati)} h · ${eur(god.rad + god.rez, 0)}</span></span>
      </div>` : ''}
    </div>` : ''}

    ${removed.length ? `
    <button class="proj-removed-row" id="proj-removed-toggle" type="button">
      <span class="chev2">›</span>
      Uklonjeni projekti (${removed.length})
      <span class="sp"></span>
      <span style="font-family: var(--font-mono); font-size: 12.5px;">${eur(removedTotal, 0)}</span>
    </button>
    <div class="proj-removed-list" id="proj-removed-list">
      <div class="pick-list" style="margin-top: 8px;">
        ${removed.map(p => `
        <div class="pick-row done" style="cursor: default;">
          <span class="nm" style="font-size: 15px;">${escapeHtml(p.name)}</span>
          <span class="side">
            <span style="font-family: var(--font-mono); font-size: 12.5px; color: var(--muted);">${eur(p.ukupno, 0)}</span>
            ${isAdmin ? `<button class="btn btn-sm" data-restore-proj="${escapeHtml(p.name)}">Vrati</button>` : ''}
          </span>
        </div>`).join('')}
      </div>
    </div>
    ` : ''}
  `;

  panel.querySelectorAll('.pick-row[data-group]').forEach(row => row.addEventListener('click', () => {
    projectsGroup = row.dataset.group;
    renderProjects();
  }));
  bindProjektiPregled(panel, all);
  panel.querySelectorAll('.pick-row[data-proj]').forEach(row => row.addEventListener('click', () => {
    activeProject = row.dataset.proj;
    renderProjects();
  }));
  const remTgl = panel.querySelector('#proj-removed-toggle');
  remTgl?.addEventListener('click', () => {
    remTgl.classList.toggle('open');
    panel.querySelector('#proj-removed-list')?.classList.toggle('open');
  });
  panel.querySelectorAll('[data-restore-proj]').forEach(b => b.addEventListener('click', async () => {
    const name = b.dataset.restoreProj;
    state.hiddenProjects = (state.hiddenProjects || []).filter(n => n !== name);
    if (await saveData()) {
      toast(`Projekt „${name}" vraćen na pregled`, 'success');
      renderProjects();
    }
  }));
}

/* Dvostruka potvrda uklanjanja projekta s pregleda */
function removeProjectModal(name) {
  const step1 = `
    <div class="modal-title">Ukloniti projekt?</div>
    <div class="modal-sub">Jesi li siguran da želiš ukloniti projekt <strong>„${escapeHtml(name)}"</strong> s pregleda?</div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="next">Nastavi</button>
    </div>
  `;
  const m = modal(step1);
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'next') {
      m.root.querySelector('.modal').innerHTML = `
        <div class="modal-title">Posljednja potvrda</div>
        <div class="modal-sub">Ovim klikom ćeš ukloniti projekt <strong>„${escapeHtml(name)}"</strong> s pregleda.<br><br>
        STO stavke i evidentirani sati ostaju netaknuti — projekt se samo skriva i možeš ga bilo kad vratiti iz sekcije „Uklonjeni projekti" na dnu pregleda.</div>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">Odustani</button>
          <button class="btn btn-danger" data-act="confirm">Ukloni projekt „${escapeHtml(name)}"</button>
        </div>
      `;
    } else if (btn.dataset.act === 'confirm') {
      if (!Array.isArray(state.hiddenProjects)) state.hiddenProjects = [];
      if (!state.hiddenProjects.includes(name)) state.hiddenProjects.push(name);
      if (await saveData()) {
        m.close();
        activeProject = null;
        toast(`Projekt „${name}" uklonjen s pregleda`, 'success');
        renderProjects();
      }
    }
  });
}


/* ============================================================
   OBRAČUN PROJEKTA
   Ručno uneseni podaci po projektu: ponuda (bez PDV, sa
   stavkama), uplate investitora i status zaključen/tekući.
   Sve se sprema u state.obracun[imeProjekta] — postojeći
   podaci (STO, sati) se nikad ne diraju.
   ============================================================ */
const hrPlural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const pct1 = (x) => (Math.round((Number(x) || 0) * 10) / 10).toFixed(1).replace('.', ',') + ' %';

function ensureObracunRec(name) {
  if (!state.obracun || typeof state.obracun !== 'object' || Array.isArray(state.obracun)) state.obracun = {};
  if (!state.obracun[name] || typeof state.obracun[name] !== 'object') {
    state.obracun[name] = { ponuda: null, ponudaStavke: [], uplate: [], zakljucen: false };
  }
  const rec = state.obracun[name];
  if (!Array.isArray(rec.uplate)) rec.uplate = [];
  if (!Array.isArray(rec.ponudaStavke)) rec.ponudaStavke = [];
  if (!Array.isArray(rec.troskovi)) rec.troskovi = [];
  return rec;
}

/* Zaključi / ponovno otvori projekt (soft status, ništa se ne briše) */
function toggleProjZakljucen(projName, isZakljucen) {
  const rec = ensureObracunRec(projName);
  const html = isZakljucen ? `
    <div class="modal-title">Ponovno otvoriti projekt?</div>
    <div class="modal-sub">Projekt <strong>„${escapeHtml(projName)}"</strong> se vraća među tekuće projekte. Svi podaci ostaju kakvi jesu.</div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="confirm">↺ Ponovno otvori</button>
    </div>` : `
    <div class="modal-title">Zaključiti projekt?</div>
    <div class="modal-sub">Projekt <strong>„${escapeHtml(projName)}"</strong> prelazi među završene projekte na listi. Ništa se ne briše — možeš ga bilo kad ponovno otvoriti.</div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="confirm">✓ Zaključi projekt</button>
    </div>`;
  const m = modal(html);
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'confirm') {
      const prev = { zakljucen: rec.zakljucen, zakljucenAt: rec.zakljucenAt };
      rec.zakljucen = !isZakljucen;
      if (rec.zakljucen) rec.zakljucenAt = todayISO(); else delete rec.zakljucenAt;
      if (await saveData()) {
        m.close();
        toast(rec.zakljucen ? `Projekt „${projName}" zaključen` : `Projekt „${projName}" ponovno otvoren`, 'success');
        renderProjects();
      } else {
        rec.zakljucen = prev.zakljucen;
        if (prev.zakljucenAt) rec.zakljucenAt = prev.zakljucenAt; else delete rec.zakljucenAt;
      }
    }
  });
}

/* Nova / uredi uplata za projekt */
function obUplataModalV3(projName, idx = null) {
  const rec = ensureObracunRec(projName);
  const list = rec.uplate;
  const u = idx !== null ? list[idx] : { date: todayISO(), amount: 0, note: '' };
  if (!u) return;
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi uplatu' : 'Nova uplata'} · ${escapeHtml(projName)}</div>
    <div class="modal-sub">Iznos koji je investitor platio za ovaj projekt. Zbroj svih uplata je „Naplaćeno" u obračunu.</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="ou-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(u.date)}"></div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input num" id="ou-amount" type="text" inputmode="decimal" placeholder="0,00" value="${u.amount ? formatEUAmount(u.amount) : ''}"></div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Opis (opcionalno)</label><input class="input" id="ou-note" value="${escapeHtml(u.note || '')}" placeholder="Npr. Avans, 1. situacija, dodatni radovi"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  const dateInp = m.root.querySelector('#ou-date');
  const amountInp = m.root.querySelector('#ou-amount');
  attachEUDateMask(dateInp);
  attachEUAmountMask(amountInp);
  if (idx === null) setTimeout(() => amountInp.focus(), 50);

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'del') {
      if (!confirm('Obrisati ovu uplatu?')) return;
      const snapshot = JSON.stringify(list);
      list.splice(idx, 1);
      if (await saveData()) { m.close(); renderProjects(); }
      else rec.uplate = JSON.parse(snapshot);
      return;
    }
    if (btn.dataset.act === 'save') {
      const date = euToISO(dateInp.value.trim());
      if (!date) {
        toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
        dateInp.classList.add('invalid');
        dateInp.focus();
        return;
      }
      const amount = round2(parseEUAmount(amountInp.value));
      if (!(amount > 0)) { toast('Unesi iznos uplate', 'error'); amountInp.focus(); return; }
      const newU = { ...u, date, amount, note: m.root.querySelector('#ou-note').value.trim() };
      if (!newU.created) newU.created = nowISO();
      const snapshot = JSON.stringify(list);
      if (idx !== null) list[idx] = newU; else list.push(newU);
      if (await saveData()) { m.close(); renderProjects(); }
      else rec.uplate = JSON.parse(snapshot);
    }
  });
}

/* Novi / uredi ručni trošak projekta (podizvođači, najam, kontejner…) */
function obTrosakModalV3(projName, idx = null) {
  const rec = ensureObracunRec(projName);
  const list = rec.troskovi;
  const t = idx !== null ? list[idx] : { date: todayISO(), amount: 0, note: '' };
  if (!t) return;
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi trošak' : 'Novi trošak'} · ${escapeHtml(projName)}</div>
    <div class="modal-sub">Trošak koji nije pokriven STO materijalom ni satima — podizvođač, najam, kontejner, gorivo… Ulazi u „Trošak ukupno" i smanjuje zaradu.</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="ot-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(t.date)}"></div>
      <div class="field"><label class="field-label">Iznos (€ bez PDV)</label><input class="input num" id="ot-amount" type="text" inputmode="decimal" placeholder="0,00" value="${t.amount ? formatEUAmount(t.amount) : ''}"></div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Opis</label><input class="input" id="ot-note" value="${escapeHtml(t.note || '')}" placeholder="Npr. Podizvođač — knauf stropovi, najam skele, kontejner"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  const dateInp = m.root.querySelector('#ot-date');
  const amountInp = m.root.querySelector('#ot-amount');
  attachEUDateMask(dateInp);
  attachEUAmountMask(amountInp);
  if (idx === null) setTimeout(() => amountInp.focus(), 50);

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'del') {
      if (!confirm('Obrisati ovaj trošak?')) return;
      const snapshot = JSON.stringify(list);
      list.splice(idx, 1);
      if (await saveData()) { m.close(); renderProjects(); }
      else rec.troskovi = JSON.parse(snapshot);
      return;
    }
    if (btn.dataset.act === 'save') {
      const date = euToISO(dateInp.value.trim());
      if (!date) {
        toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
        dateInp.classList.add('invalid');
        dateInp.focus();
        return;
      }
      const amount = round2(parseEUAmount(amountInp.value));
      if (!(amount > 0)) { toast('Unesi iznos troška', 'error'); amountInp.focus(); return; }
      const newT = { ...t, date, amount, note: m.root.querySelector('#ot-note').value.trim() };
      if (!newT.created) newT.created = nowISO();
      const snapshot = JSON.stringify(list);
      if (idx !== null) list[idx] = newT; else list.push(newT);
      if (await saveData()) { m.close(); renderProjects(); }
      else rec.troskovi = JSON.parse(snapshot);
    }
  });
}

/* Ponuda: ručni unos iznosa + opcionalne stavke (isti editor kao STO stavke) */
function obPonudaModal(projName, prefill = null) {
  const rec = ensureObracunRec(projName);
  const workStavke = (prefill ? (prefill.stavke || []) : rec.ponudaStavke)
    .map(it => ({ name: it.name || '', qty: (Number(it.qty) > 0 ? Number(it.qty) : null), unit: it.unit || '', amount: Number(it.amount) || 0 }));
  const initAmount = prefill ? (Number(prefill.amount) || 0) : (Number(rec.ponuda) || 0);

  const html = `
    <div class="modal-title">${rec.ponuda && !prefill ? 'Uredi ponudu' : 'Ponuda'} · ${escapeHtml(projName)}</div>
    <div class="modal-sub">Iznos ponude bez PDV-a. Stavke su opcionalne — služe da se zna što je ponudom obuhvaćeno.</div>
    <div class="field" style="max-width: 240px;">
      <label class="field-label">Iznos ponude (€ bez PDV)</label>
      <input class="input num" id="op-amount" type="text" inputmode="decimal" placeholder="0,00" value="${initAmount ? formatEUAmount(initAmount) : ''}">
    </div>
    <div class="field" style="margin-top: 14px;">
      <label class="field-label">Stavke ponude (opcionalno)</label>
      <div id="op-items" style="overflow-x: auto;"></div>
      <div style="display: flex; gap: 10px; align-items: center; margin-top: 8px; flex-wrap: wrap;">
        <button type="button" class="btn btn-sm" data-act="add-item">+ Dodaj stavku</button>
        <span id="op-items-sum" class="field-hint" style="margin-top: 0;"></span>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${(!prefill && rec.ponuda) ? '<button class="btn btn-danger" data-act="del">Obriši ponudu</button>' : ''}
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  const amountInp = m.root.querySelector('#op-amount');
  attachEUAmountMask(amountInp);
  const itemsBox = m.root.querySelector('#op-items');
  const sumEl = m.root.querySelector('#op-items-sum');
  const itemsSum = () => round2(workStavke.reduce((a, it) => a + (Number(it.amount) || 0), 0));
  const updateItemsSum = () => {
    if (!workStavke.length) { sumEl.innerHTML = ''; return; }
    const sum = itemsSum();
    const cur = parseEUAmount(amountInp.value);
    sumEl.innerHTML = `Zbroj stavki: <strong>${eur(sum, 2)}</strong>` +
      (Math.abs(sum - cur) > 0.005
        ? ` · <a href="#" data-act="use-sum" style="color: var(--acc);">postavi kao iznos ponude</a>`
        : ' · odgovara iznosu ✓');
  };
  const renderItems = () => {
    if (!workStavke.length) {
      itemsBox.innerHTML = `<div class="field-hint" style="margin-top: 0;">Nema stavki. Možeš ih dodati ručno ili ubaciti datoteku ponude kroz karticu „Ponuda".</div>`;
      updateItemsSum();
      return;
    }
    if (isMobileView()) {
      itemsBox.innerHTML = workStavke.map((it, i) => `
      <div class="ir-card" style="padding: 10px;">
        <div class="ir-head-row">
          <input class="input" data-it="${i}" data-f="name" value="${escapeHtml(it.name || '')}" placeholder="Opis stavke" style="flex: 1;">
          <button type="button" class="btn btn-ghost btn-sm btn-danger" data-del-item="${i}" title="Ukloni stavku">×</button>
        </div>
        <div class="ir-grid-3">
          <div><div class="ir-mini-label">Količina</div><input class="input num" data-it="${i}" data-f="qty" type="text" inputmode="decimal" value="${it.qty ? String(it.qty).replace('.', ',') : ''}" style="width: 100%; text-align: right;"></div>
          <div><div class="ir-mini-label">Jed.</div><input class="input" data-it="${i}" data-f="unit" value="${escapeHtml(it.unit || '')}" style="width: 100%;"></div>
          <div><div class="ir-mini-label">€ bez PDV</div><input class="input num" data-it="${i}" data-f="amount" type="text" inputmode="decimal" value="${formatEUAmount(it.amount)}" style="width: 100%; text-align: right; font-weight: 600;"></div>
        </div>
      </div>`).join('');
    } else {
      itemsBox.innerHTML = workStavke.map((it, i) => `
      <div style="display: grid; grid-template-columns: minmax(150px, 1fr) 58px 46px 100px 28px; gap: 6px; margin-bottom: 6px; align-items: center; min-width: 400px;">
        <input class="input" data-it="${i}" data-f="name" value="${escapeHtml(it.name || '')}" placeholder="Opis stavke">
        <input class="input num" data-it="${i}" data-f="qty" type="text" inputmode="decimal" value="${it.qty ? String(it.qty).replace('.', ',') : ''}" placeholder="Kol." style="text-align: right; padding: 10px 8px;">
        <input class="input" data-it="${i}" data-f="unit" value="${escapeHtml(it.unit || '')}" placeholder="Jed." style="padding: 10px 8px;">
        <input class="input num" data-it="${i}" data-f="amount" type="text" inputmode="decimal" value="${formatEUAmount(it.amount)}" placeholder="€ bez PDV" style="text-align: right; padding: 10px 8px;">
        <button type="button" class="btn btn-ghost btn-sm btn-danger" data-del-item="${i}" title="Ukloni stavku" style="padding: 6px 4px;">×</button>
      </div>`).join('');
    }
    updateItemsSum();
  };
  renderItems();

  itemsBox.addEventListener('input', e => {
    const inp = e.target.closest('input[data-it]');
    if (!inp) return;
    const it = workStavke[+inp.dataset.it];
    if (!it) return;
    const f = inp.dataset.f;
    if (f === 'qty' || f === 'amount') it[f] = parseEUAmount(inp.value);
    else it[f] = inp.value;
    updateItemsSum();
  });
  itemsBox.addEventListener('focusout', e => {
    const inp = e.target.closest('input[data-it]');
    if (!inp) return;
    const it = workStavke[+inp.dataset.it];
    if (!it) return;
    if (inp.dataset.f === 'amount') inp.value = formatEUAmount(it.amount);
    if (inp.dataset.f === 'qty') inp.value = it.qty ? String(it.qty).replace('.', ',') : '';
  });
  amountInp.addEventListener('input', updateItemsSum);

  m.root.addEventListener('click', async e => {
    const useSum = e.target.closest('[data-act="use-sum"]');
    if (useSum) {
      e.preventDefault();
      amountInp.value = formatEUAmount(itemsSum());
      updateItemsSum();
      return;
    }
    const delItem = e.target.closest('button[data-del-item]');
    if (delItem) {
      workStavke.splice(+delItem.dataset.delItem, 1);
      renderItems();
      return;
    }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'add-item') {
      workStavke.push({ name: '', qty: null, unit: '', amount: 0 });
      renderItems();
    } else if (btn.dataset.act === 'cancel') {
      m.close();
    } else if (btn.dataset.act === 'del') {
      if (!confirm('Obrisati ponudu za ovaj projekt? Uplate i svi ostali podaci ostaju.')) return;
      const snapshot = JSON.stringify({ ponuda: rec.ponuda, ponudaStavke: rec.ponudaStavke });
      rec.ponuda = null;
      rec.ponudaStavke = [];
      if (await saveData()) { m.close(); toast('Ponuda obrisana', 'success'); renderProjects(); }
      else { const prev = JSON.parse(snapshot); rec.ponuda = prev.ponuda; rec.ponudaStavke = prev.ponudaStavke; }
    } else if (btn.dataset.act === 'save') {
      const amount = round2(parseEUAmount(amountInp.value));
      if (!(amount > 0)) { toast('Unesi iznos ponude', 'error'); amountInp.focus(); return; }
      const clean = workStavke
        .map(it => ({ name: (it.name || '').trim(), qty: Number(it.qty) > 0 ? Number(it.qty) : null, unit: (it.unit || '').trim(), amount: round2(Number(it.amount) || 0) }))
        .filter(it => it.name || it.amount > 0);
      const snapshot = JSON.stringify({ ponuda: rec.ponuda, ponudaStavke: rec.ponudaStavke });
      rec.ponuda = amount;
      rec.ponudaStavke = clean;
      if (await saveData()) { m.close(); toast('Ponuda spremljena', 'success'); renderProjects(); }
      else { const prev = JSON.parse(snapshot); rec.ponuda = prev.ponuda; rec.ponudaStavke = prev.ponudaStavke; }
    }
  });
}

/* Lazy-load SheetJS (za čitanje XLSX/CSV ponuda) */
let sheetJsPromise = null;
function loadSheetJs() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (sheetJsPromise) return sheetJsPromise;
  sheetJsPromise = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    sc.onload = () => resolve(window.XLSX);
    sc.onerror = () => { sheetJsPromise = null; reject(new Error('Ne mogu učitati Excel modul — provjeri internetsku vezu')); };
    document.head.appendChild(sc);
  });
  return sheetJsPromise;
}

/* Čitanje ponude iz PDF / XLSX / CSV — heuristika: redak s opisom i iznosom.
   Redovi „UKUPNO / TOTAL" postaju prijedlog iznosa ponude, PDV/rabat redovi se preskaču.
   Sve prolazi kroz pregled u obPonudaModal — ništa se ne sprema automatski. */
async function parsePonudaFile(file) {
  const fname = (file.name || '').toLowerCase();
  const TOTAL_RE = /\b(ukupno|sveukupno|total)\b/i;
  const SKIP_RE = /\b(pdv|porez|rabat|popust|iban|oib)\b/i;
  const MONEY_STR_RE = /^-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$/;
  const stavke = [];
  let total = null;

  if (fname.endsWith('.pdf')) {
    const rows = await extractPdfRows(file);
    const LINE_RE = /^(.*?)[\s·:]+(-?\d{1,3}(?:\.\d{3})*(?:,\d{2}))(?:\s*(?:€|eur))?\s*$/i;
    for (const raw of rows) {
      const line = String(raw || '').trim();
      const mm = line.match(LINE_RE);
      if (!mm) continue;
      const label = mm[1].trim().replace(/[.·\s]+$/, '');
      const amount = parseEUAmount(mm[2]);
      if (!(amount > 0)) continue;
      if (TOTAL_RE.test(label)) { if (!SKIP_RE.test(label)) total = round2(amount); continue; }
      if (SKIP_RE.test(label) || label.length < 2) continue;
      stavke.push({ name: label, qty: null, unit: '', amount: round2(amount) });
      if (stavke.length >= 200) break;
    }
  } else {
    const XLSXlib = await loadSheetJs();
    const buf = await file.arrayBuffer();
    const wb = XLSXlib.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('Datoteka nema čitljivih listova');
    const rows = XLSXlib.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const nums = [];
      const texts = [];
      for (const c of r) {
        if (typeof c === 'number' && isFinite(c)) { if (c !== 0) nums.push(round2(c)); continue; }
        if (typeof c === 'string') {
          const t = c.trim();
          if (!t) continue;
          if (MONEY_STR_RE.test(t)) {
            const v = parseEUAmount(t);
            if (v) nums.push(round2(v));
          } else texts.push(t);
        }
      }
      if (!texts.length || !nums.length) continue;
      const label = texts.join(' ').replace(/\s+/g, ' ').trim();
      const amount = nums[nums.length - 1];
      if (!(amount > 0)) continue;
      if (TOTAL_RE.test(label)) { if (!SKIP_RE.test(label)) total = amount; continue; }
      if (SKIP_RE.test(label) || label.length < 2) continue;
      stavke.push({ name: label, qty: null, unit: '', amount });
      if (stavke.length >= 200) break;
    }
  }
  if (total === null && stavke.length) total = round2(stavke.reduce((a, it) => a + (Number(it.amount) || 0), 0));
  return { stavke, total };
}

async function obPonudaUploadFlow(projName, file) {
  try {
    toast('Čitam ponudu…', '', 2000);
    const res = await parsePonudaFile(file);
    if (!res.stavke.length && !(res.total > 0)) {
      toast('Iz datoteke nisam uspio iščitati stavke — unesi ponudu ručno', 'error', 3200);
      obPonudaModal(projName);
      return;
    }
    toast(`Iščitano: ${res.stavke.length} ${hrPlural(res.stavke.length, 'stavka', 'stavke', 'stavki')} — pregledaj i potvrdi`, 'success', 3000);
    obPonudaModal(projName, { amount: res.total, stavke: res.stavke });
  } catch (err) {
    console.error('Ponuda parse failed:', err);
    toast('Ne mogu pročitati datoteku: ' + (err && err.message ? err.message : err), 'error', 3500);
    obPonudaModal(projName);
  }
}

/* Event bindings za obračun blokove u detalju projekta */
function bindObracunDetail(panel, p) {
  panel.querySelector('#ob-status')?.addEventListener('click', () => toggleProjZakljucen(p.name, p.zakljucen));
  panel.querySelector('#ob-uplata-add')?.addEventListener('click', () => obUplataModal(p.name));
  panel.querySelectorAll('[data-ob-up-edit]').forEach(el => el.addEventListener('click', () => obUplataModal(p.name, parseInt(el.dataset.obUpEdit))));
  panel.querySelectorAll('[data-ob-up-del]').forEach(el => el.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Obrisati ovu uplatu?')) return;
    const rec = ensureObracunRec(p.name);
    const snapshot = JSON.stringify(rec.uplate);
    rec.uplate.splice(parseInt(el.dataset.obUpDel), 1);
    if (await saveData()) renderProjects();
    else rec.uplate = JSON.parse(snapshot);
  }));
  panel.querySelector('#ob-trosak-add')?.addEventListener('click', () => obTrosakModal(p.name));
  panel.querySelectorAll('[data-ob-tr-edit]').forEach(el => el.addEventListener('click', () => obTrosakModal(p.name, parseInt(el.dataset.obTrEdit))));
  panel.querySelectorAll('[data-ob-tr-del]').forEach(el => el.addEventListener('click', async e => {
    e.stopPropagation();
    if (!confirm('Obrisati ovaj trošak?')) return;
    const rec = ensureObracunRec(p.name);
    const snapshot = JSON.stringify(rec.troskovi);
    rec.troskovi.splice(parseInt(el.dataset.obTrDel), 1);
    if (await saveData()) renderProjects();
    else rec.troskovi = JSON.parse(snapshot);
  }));
  panel.querySelector('#ob-ponuda-edit')?.addEventListener('click', () => obPonudaModal(p.name));
  panel.querySelector('#ob-ponuda-manual')?.addEventListener('click', () => obPonudaModal(p.name));
  const drop = panel.querySelector('#ob-ponuda-drop');
  const fileInp = panel.querySelector('#ob-ponuda-file');
  if (drop && fileInp) {
    drop.addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', () => {
      const f = fileInp.files && fileInp.files[0];
      if (f) obPonudaUploadFlow(p.name, f);
      fileInp.value = '';
    });
    drop.addEventListener('dragover', e => e.preventDefault());
    drop.addEventListener('drop', e => {
      e.preventDefault();
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) obPonudaUploadFlow(p.name, f);
    });
  }
  panel.querySelector('#ob-stavke-toggle')?.addEventListener('click', () => {
    const box = panel.querySelector('#ob-stavke-box');
    if (box) box.style.display = box.style.display === 'none' ? '' : 'none';
  });
}

function renderProjectDetailV3(p) {
  const panel = document.getElementById('panel-projects');
  const isNone = p.name === PROJ_NONE;
  const displayName = isNone ? 'Bez projekta' : p.name;
  const mKeys = Object.keys(p.months).sort();
  const workers = Object.entries(p.workers)
    .map(([name, w]) => ({ name, ...w }))
    .sort((a, b) => (b.rad + b.rez) - (a.rad + a.rez));

  // Razrada materijala po stavkama (iz uvezenih STO računa)
  const matMap = {};
  let itemizedTotal = 0;
  for (const k of allMonths()) {
    for (const t of (state.sto[k] || [])) {
      const nm = (t.project || '').trim() || PROJ_NONE;
      if (nm !== p.name) continue;
      if (!t.items || !t.items.length) continue;
      itemizedTotal += t.amount;
      for (const it of t.items) {
        const key = (it.name || 'Stavka') + '\u00a6' + (it.unit || '');
        if (!matMap[key]) matMap[key] = { name: it.name || 'Stavka', unit: it.unit || '', qty: 0, amount: 0 };
        matMap[key].qty += Number(it.qty) || 0;
        matMap[key].amount += Number(it.amount) || 0;
      }
    }
  }
  const matRows = Object.values(matMap).sort((a, b) => b.amount - a.amount);
  const matTotal = round2(matRows.reduce((a, r) => a + r.amount, 0));
  const nonItemized = Math.max(0, round2(p.materijal - itemizedTotal));

  /* ---- Obračun (mockup v3): izračuni za KPI, raspodjelu, ponudu i uplate ---- */
  projectsGroup = isNone ? null : (p.zakljucen ? 'zavrseni' : 'tekuci');
  const uplateSorted = (p.uplate || []).map((u, i) => ({ ...u, __i: i })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const troskoviSorted = (p.troskoviRucni || []).map((t, i) => ({ ...t, __i: i })).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const hasNapl = p.naplaceno > 0;
  const hasPonuda = p.ponuda !== null && p.ponuda !== undefined;
  const razlika = (hasPonuda && hasNapl) ? round2(p.naplaceno - p.ponuda) : null;
  const razlikaPct = (razlika !== null && p.ponuda > 0) ? (razlika / p.ponuda) * 100 : null;
  const planMarza = hasPonuda ? round2(p.ponuda - p.trosak) : null;
  const planMarzaPct = (planMarza !== null && p.ponuda > 0) ? (planMarza / p.ponuda) * 100 : null;
  const gubitak = hasNapl && p.zarada !== null && p.zarada < 0;
  const signEur = (n, dec = 2) => (n >= 0 ? '+' : '−') + eur(Math.abs(n), dec);
  const signPct = (x) => (x >= 0 ? '+' : '−') + pct1(Math.abs(x));

  const periodStr = mKeys.length === 0 ? '—' : (mKeys.length === 1 ? monthLabel(mKeys[0]) : monthLabelShort(mKeys[0]) + ' – ' + monthLabel(mKeys[mKeys.length - 1]));
  const statusPill = isNone ? '' : (p.zakljucen
    ? '<span class="pill gray" style="vertical-align: middle;">✓ završen</span>'
    : '<span class="pill brown" style="vertical-align: middle;">tekući</span>');
  const subline = isNone
    ? 'STO stavke bez naziva projekta, sati bez upisanog projekta i mjeseci bez evidencije'
    : (p.prviDan && p.zadnjiDan
      ? `${isoToEU(p.prviDan)} – ${isoToEU(p.zadnjiDan)} · ${p.kalDana} ${hrPlural(p.kalDana, 'kalendarski dan', 'kalendarska dana', 'kalendarskih dana')} · ${p.dani} ${hrPlural(p.dani, 'dan s evidencijom', 'dana s evidencijom', 'dana s evidencijom')} · ${FMT_INT.format(p.sati)} h`
      : `${periodStr} · ${FMT_INT.format(p.sati)} h`);
  const nepotpunLbl = p.nepotpunMonths && p.nepotpunMonths.length
    ? p.nepotpunMonths.map(monthLabelShort).join(', ')
    : '';

  const obKpiHtml = isNone ? '' : `
    <div class="kpi-row" style="margin-bottom: 24px;">
      <div class="kpi-cell">
        <div class="stat-label">Naplaćeno</div>
        <div class="stat-value"${hasNapl ? '' : ' style="color: var(--muted-2);"'}>${hasNapl ? eur(p.naplaceno, 0) : '—'}</div>
        <div class="stat-sub">${uplateSorted.length ? `${uplateSorted.length} ${hrPlural(uplateSorted.length, 'uplata', 'uplate', 'uplata')}` : 'još nema uplata'}</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Trošak ukupno</div>
        <div class="stat-value">${eur(p.trosak, 0)}</div>
        <div class="stat-sub">materijal neto + rad + režija${p.trosakRucni > 0 ? ' + ostalo' : ''}</div>
      </div>
      ${p.zaradaBlocked ? `
      <div class="kpi-cell" style="background: var(--warning-soft, #f6eeda);">
        <div class="stat-label">Zarada</div>
        <div class="stat-value" style="color: var(--muted);">—</div>
        <div class="stat-sub">čeka evidenciju: ${nepotpunLbl}</div>
      </div>` : hasNapl ? `
      <div class="kpi-cell" style="background: var(${gubitak ? '--negative-soft' : '--positive-soft'});">
        <div class="stat-label" style="color: var(${gubitak ? '--negative' : '--positive'});">Zarada</div>
        <div class="stat-value" style="color: var(${gubitak ? '--negative' : '--positive'});">${signEur(p.zarada, 0)}</div>
        <div class="stat-sub" style="color: var(${gubitak ? '--negative' : '--positive'});">marža ${signPct(p.marza)}${p.warnEvidencija ? ' · <span class="pill amber">evidencija sati nepotpuna</span>' : ''}</div>
      </div>` : `
      <div class="kpi-cell">
        <div class="stat-label">Zarada</div>
        <div class="stat-value" style="color: var(--muted-2);">—</div>
        <div class="stat-sub">čeka prvu uplatu</div>
      </div>`}
      <div class="kpi-cell">
        <div class="stat-label">Rad i režija</div>
        <div class="stat-value">${eur(p.rad + p.rez, 0)}</div>
        <div class="stat-sub">rad ${eur(p.rad, 0)} + režija ${eur(p.rez, 0)}</div>
      </div>
    </div>`;

  let raspodjelaHtml = '';
  const REZ_COLOR = '#6f8196';
  if (!isNone && hasNapl && !p.zaradaBlocked) {
    const segLbl = (w) => w >= 9 ? pct1(w) : '';
    const ostaloLegend = (base) => p.trosakRucni > 0 ? `
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--muted);"></span>
        <span>Ostali troškovi <span style="color: var(--muted); font-size: 12.5px;">(ručni unos)</span></span>
        <span class="amt">${eur(p.trosakRucni, 0)}</span>
        <span class="pct">${pct1((p.trosakRucni / base) * 100)}</span>
      </div>` : '';
    if (!gubitak) {
      const wMat = (p.materijalBezPdv / p.naplaceno) * 100;
      const wRad = (p.rad / p.naplaceno) * 100;
      const wRez = (p.rez / p.naplaceno) * 100;
      const wOst = (p.trosakRucni / p.naplaceno) * 100;
      const wZar = Math.max(0, 100 - wMat - wRad - wRez - wOst);
      raspodjelaHtml = `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Raspodjela naplaćenog</div>
          <div class="card-sub">Na što je otišao svaki euro</div>
        </div>
      </div>
      <div class="ob-bar">
        ${wMat > 0.05 ? `<span style="width: ${wMat.toFixed(2)}%; background: var(--acc-projects);" title="Materijal ${pct1(wMat)}">${segLbl(wMat)}</span>` : ''}
        ${wRad > 0.05 ? `<span style="width: ${wRad.toFixed(2)}%; background: var(--acc-cashflow);" title="Rad ${pct1(wRad)}">${segLbl(wRad)}</span>` : ''}
        ${wRez > 0.05 ? `<span style="width: ${wRez.toFixed(2)}%; background: ${REZ_COLOR};" title="Režija ${pct1(wRez)}">${segLbl(wRez)}</span>` : ''}
        ${wOst > 0.05 ? `<span style="width: ${wOst.toFixed(2)}%; background: var(--muted);" title="Ostali troškovi ${pct1(wOst)}">${segLbl(wOst)}</span>` : ''}
        ${wZar > 0.05 ? `<span style="width: ${wZar.toFixed(2)}%; background: var(--positive);" title="Zarada ${pct1(wZar)}">${segLbl(wZar)}</span>` : ''}
      </div>
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--acc-projects);"></span>
        <span>Materijal <span style="color: var(--muted); font-size: 12.5px;">(bez PDV)</span></span>
        <span class="amt">${eur(p.materijalBezPdv, 0)}</span>
        <span class="pct">${pct1(wMat)}</span>
      </div>
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--acc-cashflow);"></span>
        <span>Rad <span style="color: var(--muted); font-size: 12.5px;">(udio u stvarnom trošku radnika po mjesecu · ${FMT_INT.format(p.sati)} h)</span></span>
        <span class="amt">${eur(p.rad, 0)}</span>
        <span class="pct">${pct1(wRad)}</span>
      </div>
      <div class="ob-legend-row">
        <span class="sw" style="background: ${REZ_COLOR};"></span>
        <span>Režija <span style="color: var(--muted); font-size: 12.5px;">(isti udio u stvarnoj režiji po mjesecu)</span></span>
        <span class="amt">${eur(p.rez, 0)}</span>
        <span class="pct">${pct1(wRez)}</span>
      </div>
      ${ostaloLegend(p.naplaceno)}
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--positive);"></span>
        <span><strong>Zarada</strong></span>
        <span class="amt" style="color: var(--positive);">${eur(p.zarada, 0)}</span>
        <span class="pct">${pct1(wZar)}</span>
      </div>
    </div>`;
    } else {
      const base = p.trosak > 0 ? p.trosak : 1;
      const wMat = (p.materijalBezPdv / base) * 100;
      const wRad = (p.rad / base) * 100;
      const wRez = (p.rez / base) * 100;
      const wOst = Math.max(0, 100 - wMat - wRad - wRez);
      raspodjelaHtml = `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Raspodjela troška</div>
          <div class="card-sub" style="color: var(--negative);">Trošak premašuje naplaćeno — projekt je trenutno u minusu ${eur(Math.abs(p.zarada), 0)}</div>
        </div>
      </div>
      <div class="ob-bar">
        ${wMat > 0.05 ? `<span style="width: ${wMat.toFixed(2)}%; background: var(--acc-projects);" title="Materijal ${pct1(wMat)}">${segLbl(wMat)}</span>` : ''}
        ${wRad > 0.05 ? `<span style="width: ${wRad.toFixed(2)}%; background: var(--acc-cashflow);" title="Rad ${pct1(wRad)}">${segLbl(wRad)}</span>` : ''}
        ${wRez > 0.05 ? `<span style="width: ${wRez.toFixed(2)}%; background: ${REZ_COLOR};" title="Režija ${pct1(wRez)}">${segLbl(wRez)}</span>` : ''}
        ${p.trosakRucni > 0 && wOst > 0.05 ? `<span style="width: ${wOst.toFixed(2)}%; background: var(--muted);" title="Ostali troškovi ${pct1(wOst)}">${segLbl(wOst)}</span>` : ''}
      </div>
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--acc-projects);"></span>
        <span>Materijal <span style="color: var(--muted); font-size: 12.5px;">(bez PDV · udio u trošku)</span></span>
        <span class="amt">${eur(p.materijalBezPdv, 0)}</span>
        <span class="pct">${pct1(wMat)}</span>
      </div>
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--acc-cashflow);"></span>
        <span>Rad <span style="color: var(--muted); font-size: 12.5px;">(udio u stvarnom trošku radnika po mjesecu · ${FMT_INT.format(p.sati)} h)</span></span>
        <span class="amt">${eur(p.rad, 0)}</span>
        <span class="pct">${pct1(wRad)}</span>
      </div>
      <div class="ob-legend-row">
        <span class="sw" style="background: ${REZ_COLOR};"></span>
        <span>Režija <span style="color: var(--muted); font-size: 12.5px;">(isti udio u stvarnoj režiji po mjesecu)</span></span>
        <span class="amt">${eur(p.rez, 0)}</span>
        <span class="pct">${pct1(wRez)}</span>
      </div>
      ${ostaloLegend(base)}
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--negative);"></span>
        <span><strong>Gubitak</strong> <span style="color: var(--muted); font-size: 12.5px;">(naplaćeno − trošak)</span></span>
        <span class="amt" style="color: var(--negative);">−${eur(Math.abs(p.zarada), 0)}</span>
        <span class="pct">—</span>
      </div>
    </div>`;
    }
  }

  let ponudaUplateHtml = '';
  let uplateCardHtml = '';
  if (!isNone) {
    const ponudaInner = hasPonuda ? `
        <div class="ob-cmp-row"><span>Ponuda (bez PDV)</span><span class="v">${eur(p.ponuda, 2)}</span></div>
        <div class="ob-cmp-row"><span>Naplaćeno</span><span class="v">${hasNapl ? eur(p.naplaceno, 2) : '<span style="color: var(--muted-2);">—</span>'}</span></div>
        ${razlika !== null ? `
        <div class="ob-cmp-row">
          <span><strong>Razlika</strong> <span style="color: var(--muted); font-size: 12.5px;">(dodatni radovi / gratis)</span></span>
          <span class="v" style="color: var(${razlika >= 0 ? '--positive' : '--negative'});">${signEur(razlika, 2)}${Math.abs(razlika) >= 0.005 && razlikaPct !== null ? ` <span class="delta-chip ${razlika >= 0 ? 'up' : 'down'}">${signPct(razlikaPct)}</span>` : ''}</span>
        </div>` : ''}
        ${planMarza !== null ? `
        <div class="ob-cmp-row">
          <span>Planirana marža po ponudi <span style="color: var(--muted); font-size: 12.5px;">(ponuda − trošak)</span></span>
          <span class="v">${signEur(planMarza, 2)}${planMarzaPct !== null ? ' · ' + signPct(planMarzaPct) : ''}</span>
        </div>` : ''}
        ${p.ponudaStavke.length ? `
        <div style="margin-top: 12px;">
          <button class="pill blue" type="button" id="ob-stavke-toggle" style="border: none; cursor: pointer; font-family: inherit;">${p.ponudaStavke.length} ${hrPlural(p.ponudaStavke.length, 'stavka', 'stavke', 'stavki')} ponude ▾</button>
          <div id="ob-stavke-box" style="display: none; margin-top: 10px;">
            <div class="table-scroll">
              <table class="table" style="font-size: 13px;">
                <tbody>
                  ${p.ponudaStavke.map(it => `
                  <tr>
                    <td>${escapeHtml(it.name || 'Stavka')}</td>
                    <td class="num text-right" style="color: var(--muted); white-space: nowrap;">${it.qty ? fmtQty(it.qty) + (it.unit ? ' ' + escapeHtml(it.unit) : '') : ''}</td>
                    <td class="num text-right" style="font-weight: 600;">${eur(Number(it.amount) || 0, 2)}</td>
                  </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>` : ''}`
      : (isAdmin ? `
        <div class="ob-drop" id="ob-ponuda-drop">
          <strong>Ubaci ponudu — PDF · XLSX · CSV</strong>
          <span>Stavke se iščitaju, pregledaš i potvrdiš ukupni iznos.<br>Sprema se iznos + stavke, ne datoteka.</span>
        </div>
        <input type="file" id="ob-ponuda-file" accept=".pdf,.xlsx,.xls,.csv" style="display: none;">
        <div style="text-align: center; margin-top: 10px;"><button class="btn btn-sm" id="ob-ponuda-manual">ili unesi iznos ručno</button></div>`
      : '<div class="empty">Ponuda još nije unesena.</div>');

    const upRow = (u) => isAdmin ? `
        <div class="up-row" data-ob-up-edit="${u.__i}" title="Klik za uređivanje">
          <span class="d">${isoToEU(u.date)}</span>
          <span class="a">${eur(Number(u.amount) || 0, 2)}</span>
          <span class="n">${u.note ? escapeHtml(u.note) : '<span style="color: var(--muted-2);">bez opisa</span>'}</span>
          <span class="x" data-ob-up-del="${u.__i}" title="Obriši uplatu">×</span>
        </div>` : `
        <div class="up-row">
          <span class="d">${isoToEU(u.date)}</span>
          <span class="a">${eur(Number(u.amount) || 0, 2)}</span>
          <span class="n">${u.note ? escapeHtml(u.note) : '<span style="color: var(--muted-2);">bez opisa</span>'}</span>
          <span></span>
        </div>`;

    uplateCardHtml = `
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Uplate</div>
            <div class="card-sub">Zbroj = „Naplaćeno" u cijelom obračunu</div>
          </div>
          ${isAdmin ? '<button class="btn btn-primary btn-sm" id="ob-uplata-add">+ Dodaj uplatu</button>' : ''}
        </div>
        ${uplateSorted.length === 0 ? '<div class="empty">Još nema evidentiranih uplata za ovaj projekt.</div>' : `
        ${uplateSorted.map(upRow).join('')}
        <div class="up-total"><span>NAPLAĆENO UKUPNO</span><span class="num">${eur(p.naplaceno, 2)}</span></div>`}
      </div>`;
    ponudaUplateHtml = `
    <div class="card" style="margin-top: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title" style="font-size: 17px; color: var(--muted);">Ponuda <span style="font-weight: 400;">· referenca</span></div>
          <div class="card-sub">${hasPonuda ? 'Ne ulazi u obračun zarade — služi samo za usporedbu s naplaćenim' : 'Ručni unos ili upload — PDF, Excel ili CSV'}</div>
        </div>
        ${hasPonuda && isAdmin ? '<button class="btn btn-sm" id="ob-ponuda-edit">Uredi</button>' : ''}
      </div>
      ${ponudaInner}
    </div>`;
  }

  const trosakAutoHtml = `
    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Trošak</div>
          <div class="card-sub">Materijal, rad i režija automatski iz STO taba, Evidencije sati i Troškova · ostalo dodaješ sam</div>
        </div>
        ${isAdmin && !isNone ? '<button class="btn btn-sm" id="ob-trosak-add">+ Dodaj trošak</button>' : ''}
      </div>
      <table class="table">
        <tbody>
          <tr><td>Materijal s PDV <span style="color: var(--muted-2); font-size: 12px;">(STO · ${p.stoCount} ${hrPlural(p.stoCount, 'stavka', 'stavke', 'stavki')})</span></td><td class="num text-right">${eur(p.materijal, 2)}</td></tr>
          <tr><td><strong>Materijal bez PDV</strong> <span style="color: var(--muted-2); font-size: 12px;">(÷ 1,25)</span></td><td class="num text-right"><strong>${eur(p.materijalBezPdv, 2)}</strong></td></tr>
          <tr><td><strong>Rad</strong> <span style="color: var(--muted-2); font-size: 12px;">(udio u trošku radnika po mjesecu)</span></td><td class="num text-right"><strong>${eur(p.rad, 2)}</strong></td></tr>
          <tr><td><strong>Režija</strong> <span style="color: var(--muted-2); font-size: 12px;">(isti udio u režiji po mjesecu)</span></td><td class="num text-right"><strong>${eur(p.rez, 2)}</strong></td></tr>
          <tr><td>Sati ukupno</td><td class="num text-right">${FMT_INT.format(p.sati)} h</td></tr>
          <tr><td>Dani s evidencijom</td><td class="num text-right">${p.dani}</td></tr>
          ${p.dani > 0 ? `<tr><td>Prosjek troška po danu</td><td class="num text-right">${eur(p.trosak / p.dani, 2)}</td></tr>` : ''}
          ${troskoviSorted.length ? `
          <tr><td colspan="2" style="padding-top: 16px; border-bottom: none;"><span class="stat-label">Ostali troškovi · ručni unos</span></td></tr>
          ${troskoviSorted.map(t => `
          <tr${isAdmin ? ` data-ob-tr-edit="${t.__i}" style="cursor: pointer;" title="Klik za uređivanje"` : ''}>
            <td>${escapeHtml(t.note || 'Trošak')} <span style="color: var(--muted-2); font-size: 12px; white-space: nowrap;">${isoToEU(t.date)}</span></td>
            <td class="num text-right" style="white-space: nowrap;"><strong>${eur(Number(t.amount) || 0, 2)}</strong>${isAdmin ? ` <span data-ob-tr-del="${t.__i}" title="Obriši trošak" style="color: var(--muted-2); cursor: pointer; padding: 0 2px 0 8px; font-size: 15px;">×</span>` : ''}</td>
          </tr>`).join('')}
          <tr><td style="color: var(--muted);">Σ ostali troškovi</td><td class="num text-right" style="color: var(--muted);">${eur(p.trosakRucni, 2)}</td></tr>` : ''}
        </tbody>
        <tfoot>
          <tr><td>TROŠAK UKUPNO</td><td class="num text-right">${eur(p.trosak, 2)}</td></tr>
        </tfoot>
      </table>
    </div>`;

  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <button class="proj-back" id="proj-back">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Svi projekti
        </button>
        <h1 class="page-title">${escapeHtml(displayName)} ${statusPill}</h1>
        <div class="card-sub" style="margin-top: 4px;">${subline}</div>
      </div>
      ${isAdmin && !isNone ? `
      <div class="page-actions">
        <button class="btn" id="ob-status">${p.zakljucen ? '↺ Ponovno otvori' : '✓ Zaključi projekt'}</button>
        <button class="btn btn-danger" id="proj-remove">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          Ukloni s pregleda
        </button>
      </div>` : ''}
    </div>

    ${obKpiHtml}
    ${raspodjelaHtml}
    ${isNone ? `<div style="margin-bottom: 24px;">${trosakAutoHtml}</div>` : `
    <div class="grid grid-cf" style="margin-bottom: 24px;">
      ${uplateCardHtml}
      ${trosakAutoHtml}
    </div>`}

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Trošak po mjesecima</div>
          <div class="card-sub">Materijal i rad kroz vrijeme</div>
        </div>
      </div>
      <div class="chart-box"><canvas id="proj-chart-months"></canvas></div>
    </div>

    <div class="grid grid-cf" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Po mjesecima</div>
            <div class="card-sub">Udio mjeseca = sati projekta ÷ svi sati firme u mjesecu (uklj. godišnji)</div>
          </div>
        </div>
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Mjesec</th>
                <th class="text-right">Sati</th>
                <th class="text-right">Udio mj.</th>
                <th class="text-right">Materijal</th>
                <th class="text-right">Rad</th>
                <th class="text-right">Režija</th>
                <th class="text-right">Ukupno</th>
              </tr>
            </thead>
            <tbody>
              ${mKeys.map(k => {
                const m = p.months[k];
                return `
                <tr>
                  <td><strong>${monthLabel(k)}</strong></td>
                  <td class="num text-right">${m.sati ? FMT_INT.format(m.sati) : '—'}</td>
                  <td class="num text-right" style="color: var(--muted);">${m.udio ? pct1(m.udio) : '—'}</td>
                  <td class="num text-right">${m.materijal ? eur(m.materijal, 0) : '—'}</td>
                  <td class="num text-right">${m.rad ? eur(m.rad, 0) : '—'}</td>
                  <td class="num text-right">${m.rez ? eur(m.rez, 0) : '—'}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(m.materijal + m.rad + m.rez, 0)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>UKUPNO</td>
                <td class="num text-right"><strong>${FMT_INT.format(p.sati)}</strong></td>
                <td></td>
                <td class="num text-right"><strong>${eur(p.materijal, 0)}</strong></td>
                <td class="num text-right"><strong>${eur(p.rad, 0)}</strong></td>
                <td class="num text-right"><strong>${eur(p.rez, 0)}</strong></td>
                <td class="num text-right"><strong>${eur(p.ukupno, 0)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Rad po radniku</div>
            <div class="card-sub">Svaki sat nosi trošak mjeseca u kojem je odrađen</div>
          </div>
        </div>
        ${workers.length === 0 ? `<div class="empty">Nema evidentiranih sati za ovaj projekt.</div>` : `
        <div class="table-scroll">
          <table class="table">
            <thead>
              <tr>
                <th>Radnik</th>
                <th class="text-right">Sati</th>
                <th class="text-right">Dana</th>
                <th class="text-right">Rad</th>
                <th class="text-right">Režija</th>
                <th class="text-right">Ukupno</th>
              </tr>
            </thead>
            <tbody>
              ${workers.map(w => `
                <tr>
                  <td><strong>${escapeHtml(w.name)}</strong></td>
                  <td class="num text-right">${FMT_INT.format(w.sati)}</td>
                  <td class="num text-right">${w.dani || '—'}</td>
                  <td class="num text-right">${eur(w.rad, 0)}</td>
                  <td class="num text-right">${eur(w.rez, 0)}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(w.rad + w.rez, 0)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td>UKUPNO</td>
                <td class="num text-right"><strong>${FMT_INT.format(p.sati)}</strong></td>
                <td></td>
                <td class="num text-right"><strong>${eur(p.rad, 0)}</strong></td>
                <td class="num text-right"><strong>${eur(p.rez, 0)}</strong></td>
                <td class="num text-right"><strong>${eur(p.rad + p.rez, 0)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>`}
        <div class="proj-formula">Udio mjeseca = sati projekta ÷ svi sati firme u mjesecu (uklj. godišnji). Rad = udio × stvarni trošak radnika tog mjeseca (fiksno + isplata + prijevoz + stan). Režija = udio × (fiksne osobe + radnici bez satnice + tekući troškovi bez plaća) tog mjeseca. Ništa nije prosjek — svaki mjesec nosi svoj stvarni trošak, pa kišni i prazni dani poskupljuju sat mjeseca u kojem su se dogodili. Isplaćeno radnicima po satnici za ove sate: ${eur(p.radIsplata, 0)}.</div>
      </div>
    </div>

    <div class="card" style="margin-top: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Materijal po stavkama</div>
          <div class="card-sub">Što je točno potrošeno na projekt · iz uvezenih STO računa · iznosi s PDV-om</div>
        </div>
      </div>
      ${matRows.length === 0 ? `<div class="empty">Još nema razrade po stavkama za ovaj projekt.<br>Nove račune ubacuj kroz „Uvoz računa" u STO tabu i stavke će se ovdje same zbrajati.</div>` : `
      <div class="table-scroll">
        <table class="table mat-stavke-table">
          <thead>
            <tr>
              <th>Artikl</th>
              <th class="text-right">Ukupna količina</th>
              <th class="text-right">Iznos (s PDV)</th>
              <th class="text-right">Udio u materijalu</th>
            </tr>
          </thead>
          <tbody>
            ${matRows.map(r => `
              <tr>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td class="num text-right">${r.qty ? fmtQty(r.qty) + (r.unit ? ' ' + escapeHtml(r.unit) : '') : '—'}</td>
                <td class="num text-right" style="font-weight: 600;">${eur(r.amount, 2)}</td>
                <td class="num text-right" style="color: var(--muted);">${p.materijal > 0 ? ((r.amount / p.materijal) * 100).toFixed(1).replace('.', ',') + ' %' : '—'}</td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>Σ razrađeno po stavkama</td>
              <td></td>
              <td class="num text-right"><strong>${eur(matTotal, 2)}</strong></td>
              <td></td>
            </tr>
            ${nonItemized > 0.005 ? `
            <tr>
              <td style="color: var(--muted);">Materijal bez razrade (unosi bez stavki)</td>
              <td></td>
              <td class="num text-right" style="color: var(--muted);">${eur(nonItemized, 2)}</td>
              <td></td>
            </tr>` : ''}
          </tfoot>
        </table>
      </div>`}
    </div>

    ${ponudaUplateHtml}
  `;

  panel.querySelector('#proj-back').addEventListener('click', () => {
    activeProject = null;
    renderProjects();
  });
  panel.querySelector('#proj-remove')?.addEventListener('click', () => removeProjectModal(p.name));
  bindObracunDetail(panel, p);

  // CHART: stacked bar po mjesecima
  charts.projMonths?.destroy?.();
  const ctx = document.getElementById('proj-chart-months');
  charts.projMonths = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: mKeys.map(monthLabelShort),
      datasets: [
        { label: 'Materijal', data: mKeys.map(k => p.months[k].materijal), backgroundColor: cssVar('--acc-sto'), borderRadius: 6, stack: 's' },
        { label: 'Rad', data: mKeys.map(k => p.months[k].rad), backgroundColor: cssVar('--acc-hours'), borderRadius: 6, stack: 's' },
        { label: 'Režija', data: mKeys.map(k => p.months[k].rez), backgroundColor: '#6f8196', borderRadius: 6, stack: 's' },
      ],
    },
    options: {
      ...chartOpts({ legend: true, money: true }),
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { family: cssVar('--font-body'), size: 11 }, color: cssVar('--muted') } },
        y: { stacked: true, grid: { color: cssVar('--line'), drawBorder: false }, ticks: { font: { family: cssVar('--font-mono'), size: 11 }, color: cssVar('--muted'), callback: v => eurShort(v) } },
      },
    },
  });
}

/* ============================================================
   RENDER: SETTINGS
   ============================================================ */
function fiksnoHistoryModal(workerIdx) {
  const w = state.settings.workers[workerIdx];
  if (!w) return;
  if (!Array.isArray(w.fiksnoHistory)) w.fiksnoHistory = [];

  const renderRows = () => {
    const hist = (w.fiksnoHistory || []).slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''));
    if (hist.length === 0) {
      return `<div style="padding: 16px; text-align: center; color: var(--muted); font-size: 13px;">Nema promjena. Bazno fiksno (${eur(w.fiksno, 0)}) vrijedi za sve mjesece.</div>`;
    }
    return hist.map((e, idx) => `
      <div style="display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line);">
        <input class="input" type="month" value="${e.from || ''}" data-fh-from="${idx}" style="flex: 0 0 150px;">
        <span style="color: var(--muted); font-size: 13px;">→</span>
        <input class="input num" type="number" step="0.5" value="${e.amount ?? ''}" data-fh-amount="${idx}" placeholder="iznos €" style="flex: 1; text-align: right;">
        <button class="btn btn-ghost btn-sm btn-danger" data-fh-del="${idx}" title="Obriši" style="padding: 4px;">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
        </button>
      </div>
    `).join('');
  };

  const html = `
    <div class="modal-title">Fiksno kroz vrijeme · ${escapeHtml(w.name)}</div>
    <div class="modal-sub">Bazno fiksno je ${eur(w.fiksno, 0)}. Dodaj promjenu samo ako se fiksno mijenja od nekog mjeseca nadalje — raniji mjeseci ostaju na baznom iznosu.</div>
    <div id="fh-rows" style="margin: 8px 0 4px;">${renderRows()}</div>
    <div style="margin-top: 12px;">
      <button class="btn" data-act="add-change">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Dodaj promjenu
      </button>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html);
  const rowsEl = m.root.querySelector('#fh-rows');

  const syncFromInputs = () => {
    m.root.querySelectorAll('[data-fh-from]').forEach(inp => {
      const idx = parseInt(inp.dataset.fhFrom);
      if (w.fiksnoHistory[idx]) w.fiksnoHistory[idx].from = inp.value;
    });
    m.root.querySelectorAll('[data-fh-amount]').forEach(inp => {
      const idx = parseInt(inp.dataset.fhAmount);
      if (w.fiksnoHistory[idx]) w.fiksnoHistory[idx].amount = parseFloat(inp.value) || 0;
    });
  };
  const redraw = () => { rowsEl.innerHTML = renderRows(); };

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act], button[data-fh-del]');
    if (!btn) return;
    if (btn.dataset.fhDel !== undefined) {
      syncFromInputs();
      w.fiksnoHistory.splice(parseInt(btn.dataset.fhDel), 1);
      redraw();
      return;
    }
    if (btn.dataset.act === 'add-change') {
      syncFromInputs();
      const next = activeMonth || (new Date().toISOString().slice(0, 7));
      w.fiksnoHistory.push({ from: next, amount: w.fiksno });
      redraw();
    } else if (btn.dataset.act === 'cancel') {
      m.close();
    } else if (btn.dataset.act === 'save') {
      syncFromInputs();
      // Očisti prazne/nevaljane unose
      w.fiksnoHistory = (w.fiksnoHistory || []).filter(x => x && x.from && !isNaN(x.amount));
      if (w.fiksnoHistory.length === 0) delete w.fiksnoHistory;
      if (await saveData()) {
        m.close();
        renderSettings();
        toast('Fiksno povijest spremljena', 'success');
      }
    }
  });
}

/* ============================================================
   POSTAVKE › RADNICI · period rada, odjava, bivši radnici
   ============================================================ */
let wpBivsiOpen = false;   // "Bivši radnici" je jedan sklopljeni redak dok se ne otvori

function settingsWorkersSplit() {
  const today = localTodayISO();
  const all = (state.settings.workers || []).map((w, i) => ({ w, i }));
  return {
    aktivni: all.filter(x => !workerIsFormer(x.w, today)),
    bivsi: all.filter(x => workerIsFormer(x.w, today)),
  };
}

function settingsFormerRowsHtml() {
  const { bivsi } = settingsWorkersSplit();
  if (!bivsi.length) return '';
  const nCols = isAdmin ? 9 : 8;
  const money = (v, dec) => `<span class="num">${eur(Number(v) || 0, dec)}</span>`;
  return `
    <tr class="wp-group-row"><td colspan="${nCols}">
      <button type="button" class="wp-group-btn${wpBivsiOpen ? ' open' : ''}" id="wp-bivsi-toggle" aria-expanded="${wpBivsiOpen ? 'true' : 'false'}">
        <span class="chev2">›</span><strong>Bivši radnici</strong><span class="cnt">· ${bivsi.length}</span>
        <span class="hint">U povijesti ostaje sve: sati, projekti, isplate, godišnji, dug</span>
      </button>
    </td></tr>
    ${bivsi.map(({ w, i }) => {
      const lp = workerLastPeriod(w);
      const dug = Number(w.dug) || 0;
      return `
      <tr class="wp-former"${wpBivsiOpen ? '' : ' hidden'}>
        <td><strong>${escapeHtml(w.name)}</strong>${dug > 0 ? `<span class="dug-badge" title="Dug radnika">dug ${eur(dug, 0)}</span>` : ''}</td>
        <td class="text-right">${money(w.satnica, 2)}</td>
        <td class="text-right">${money(w.marenda, 0)}</td>
        <td class="text-right">${money(w.prijevoz, 0)}</td>
        <td class="text-right">${money(w.stan, 0)}</td>
        <td class="text-right">${money(fiksnoForMonth(w, lp.do.slice(0, 7)), 0)}</td>
        <td class="text-right">${money(w.fiksnaIsplata, 0)}</td>
        <td><span class="pill amber">do ${isoToEU(lp.do)}</span></td>
        ${isAdmin ? `<td class="text-right"><button type="button" class="btn btn-sm wp-ico-btn" data-act="vrati-worker" data-i="${i}" title="Poništi odjavu ili vrati radnika od novog datuma">${WP_ICON_VRATI}Vrati</button></td>` : ''}
      </tr>`;
    }).join('')}`;
}

/* Kopija perioda s drugim zadnjim danom (za pregled prije spremanja) */
function wpPeriodsWithEnd(w, endIso) {
  const per = workerPeriods(w);
  if (!per) return [{ od: '', do: endIso }];
  const lp = workerLastPeriod(w);
  return per.map(p => p === lp ? { od: p.od || '', do: endIso } : { ...p });
}

/* Odjava: zadnji radni dan, razmjerni ili puni fiksni iznosi za mjesec odlaska */
function workerOdjavaModal(idx) {
  const w = state.settings.workers[idx];
  if (!w) return;
  const lp0 = workerLastPeriod(w);
  const lastH = workerLastHoursDate(w.name);
  const def = (lp0 && lp0.do) || ((lastH && !(lp0 && lp0.od && lastH < lp0.od)) ? lastH : '') || localTodayISO();
  let puni = !!(lp0 && lp0.puniMjesecDo);
  const html = `
    <div class="modal-title">Odjava radnika · ${escapeHtml(w.name)}</div>
    <div class="modal-sub">${escapeHtml(w.name)} ostaje u svim podacima do zadnjeg radnog dana. Nakon toga nije u unosu sati, isplati ni troškovima.</div>
    <div class="field">
      <label class="field-label" for="wo-date">Zadnji radni dan</label>
      <input class="input" id="wo-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(def)}">
      <div class="field-hint" id="wo-hint"></div>
    </div>
    <div class="field" id="wo-mode-wrap" style="margin-top: 16px;">
      <div class="field-label" id="wo-mode-label"></div>
      <div class="toggle" role="group" aria-labelledby="wo-mode-label" style="align-self: flex-start;">
        <button type="button" data-mode="razmjerno" id="wo-mode-r">Razmjerno</button>
        <button type="button" data-mode="puni">Puni mjesec</button>
      </div>
    </div>
    <div class="wp-preview" id="wo-preview" style="margin-top: 16px;"></div>
    <div class="wp-warn" id="wo-warn"></div>
    <div class="wp-lists" id="wo-lists" style="margin-top: 16px;"></div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">${WP_ICON_ODJAVA}Odjavi radnika</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  m.root.querySelector('.modal').classList.add('wp-modal');
  const dateInp = m.root.querySelector('#wo-date');
  attachEUDateMask(dateInp);

  const update = () => {
    const iso = euToISO(dateInp.value.trim());
    const hint = m.root.querySelector('#wo-hint');
    const prev = m.root.querySelector('#wo-preview');
    const warn = m.root.querySelector('#wo-warn');
    const lists = m.root.querySelector('#wo-lists');
    const modeWrap = m.root.querySelector('#wo-mode-wrap');
    if (!iso) {
      hint.textContent = 'Upiši datum u formatu DD/MM/YYYY.';
      prev.hidden = true; modeWrap.hidden = true; warn.textContent = ''; lists.innerHTML = '';
      return;
    }
    const key = iso.slice(0, 7);
    const next = addDaysISO(iso, 1);
    hint.textContent = `Od ${isoToEU(next)} više ne ulazi u evidenciju.`;
    const share = workerMonthShare({ ...w, zaposlenje: wpPeriodsWithEnd(w, iso) }, key);
    const partial = share.udio < 1;
    modeWrap.hidden = !partial;
    m.root.querySelector('#wo-mode-label').textContent = `Fiksni iznosi za ${monthAccHr(key)} (fiksno, prijevoz, stan)`;
    m.root.querySelector('#wo-mode-r').textContent = `Razmjerno · ${share.dana} od ${share.ukupno} ${hrRadnihDana(share.ukupno)}`;
    m.root.querySelectorAll('#wo-mode-wrap [data-mode]').forEach(b => b.classList.toggle('active', (b.dataset.mode === 'puni') === puni));
    const f = (partial && !puni) ? share.udio : 1;
    const items = [['Fiksno', fiksnoForMonth(w, key)], ['Prijevoz', Number(w.prijevoz) || 0], ['Stan', Number(w.stan) || 0]];
    if ((Number(w.fiksnaIsplata) || 0) > 0) items.push(['Fiksna isplata', Number(w.fiksnaIsplata) || 0]);
    prev.hidden = false;
    prev.innerHTML = `
      <div class="eyebrow">${monthLabel(key)} · ${escapeHtml(w.name)}</div>
      <div class="wp-preview-grid">${items.map(([lbl, v]) => {
        const nv = f < 1 ? round2(v * f) : v;
        const ch = Math.abs(nv - v) > 0.004;
        return `<span>${lbl}</span><span class="was${ch ? ' changed' : ''}">${eur(v, 2)}</span><span class="arr">${ch ? '→' : ''}</span><span class="now">${ch ? eur(nv, 2) : 'puni iznos'}</span>`;
      }).join('')}</div>
      <div class="wp-preview-note">Zarada i marenda idu iz unesenih sati do ${dmEU(iso)}, kao i dosad.</div>`;
    const after = workerHoursDaysAfter(w.name, iso);
    warn.textContent = after
      ? `⚠ Nakon ${isoToEU(iso)} ${after === 1 ? 'postoji 1 dan' : (after % 10 >= 2 && after % 10 <= 4 && !(after % 100 >= 12 && after % 100 <= 14)) ? `postoje ${after} dana` : `postoji ${after} dana`} s unesenim satima. Ti se sati neće računati.`
      : '';
    lists.innerHTML = `
      <div>
        <div class="eyebrow" style="margin-bottom: 8px;">Mijenja se</div>
        <ul>
          <li>Od ${dmEU(next)} nije u dnevnom unosu sati</li>
          <li>Od ${monthGenHr(addCalendarMonths(key, 1))} ne ulazi u Sažetak isplate, Cashflow ni obračun projekata</li>
          <li>Ne ulazi u kapacitet firme kod provjere evidencije</li>
        </ul>
      </div>
      <div>
        <div class="eyebrow" style="margin-bottom: 8px;">Ostaje</div>
        <ul>
          <li>Svi sati i projekti do ${dmEU(iso)}</li>
          <li>Trošak rada za mjesece u periodu rada</li>
          <li>Godišnji u Registru i dug</li>
        </ul>
      </div>`;
  };
  dateInp.addEventListener('input', update);
  dateInp.addEventListener('blur', update);
  update();
  setTimeout(() => dateInp.focus(), 50);

  m.root.addEventListener('click', async e => {
    const modeBtn = e.target.closest('#wo-mode-wrap [data-mode]');
    if (modeBtn) { puni = modeBtn.dataset.mode === 'puni'; update(); return; }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act !== 'save') return;
    const iso = euToISO(dateInp.value.trim());
    if (!iso) {
      toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
      dateInp.classList.add('invalid');
      dateInp.focus();
      return;
    }
    const lp = workerLastPeriod(w);
    if (lp && lp.od && iso < lp.od) { toast(`Zadnji radni dan ne može biti prije početka rada (${isoToEU(lp.od)})`, 'error'); return; }
    const partial = workerMonthShare({ ...w, zaposlenje: wpPeriodsWithEnd(w, iso) }, iso.slice(0, 7)).udio < 1;
    const snapshot = JSON.stringify(Array.isArray(w.zaposlenje) ? w.zaposlenje : null);
    if (!workerPeriods(w)) w.zaposlenje = [{ od: '', do: iso }];
    else lp.do = iso;
    const cur = workerLastPeriod(w);
    if (puni && partial) cur.puniMjesecDo = true;
    else delete cur.puniMjesecDo;
    if (await saveData()) {
      m.close();
      renderSettings();
      toast(`${w.name} · zadnji radni dan ${isoToEU(iso)}`, 'success', 2600);
    } else {
      const s = JSON.parse(snapshot);
      if (s === null) delete w.zaposlenje; else w.zaposlenje = s;
    }
  });
}

/* Bivši radnik: poništi odjavu (greška) ili novi period rada od datuma */
function workerVratiModal(idx) {
  const w = state.settings.workers[idx];
  const lp0 = w ? workerLastPeriod(w) : null;
  if (!w || !lp0 || !lp0.do) return;
  const today = localTodayISO();
  const defNew = today > lp0.do ? today : addDaysISO(lp0.do, 1);
  let mode = 'ponisti';
  const html = `
    <div class="modal-title">Vrati radnika · ${escapeHtml(w.name)}</div>
    <div class="modal-sub">Zadnji radni dan: ${isoToEU(lp0.do)}. Odaberi što se dogodilo.</div>
    <div style="display: flex; flex-direction: column; gap: 10px;">
      <label class="wp-radio on"><input type="radio" name="wv-mode" value="ponisti" checked><span><strong>Odjava je bila greška</strong><span class="wp-caption">Radi bez prekida, kao da odjave nije bilo.</span></span></label>
      <label class="wp-radio"><input type="radio" name="wv-mode" value="novi"><span><strong>Vraća se na posao</strong><span class="wp-caption">Novi period rada od upisanog datuma. Razdoblje između ne ulazi u isplatu ni troškove, a stari period ostaje.</span></span></label>
    </div>
    <div class="field" id="wv-date-wrap" style="margin-top: 14px;" hidden>
      <label class="field-label" for="wv-date">Ponovno radi od</label>
      <input class="input" id="wv-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(defNew)}">
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html);
  m.root.querySelector('.modal').classList.add('wp-modal');
  const dateInp = m.root.querySelector('#wv-date');
  attachEUDateMask(dateInp);
  m.root.querySelectorAll('input[name="wv-mode"]').forEach(r => r.addEventListener('change', () => {
    mode = r.value;
    m.root.querySelectorAll('.wp-radio').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    m.root.querySelector('#wv-date-wrap').hidden = mode !== 'novi';
    if (mode === 'novi') setTimeout(() => dateInp.focus(), 30);
  }));
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act !== 'save') return;
    const snapshot = JSON.stringify(w.zaposlenje);
    const lp = workerLastPeriod(w);
    let msg;
    if (mode === 'novi') {
      const od = euToISO(dateInp.value.trim());
      if (!od) { toast('Datum mora biti u formatu DD/MM/YYYY', 'error'); dateInp.classList.add('invalid'); dateInp.focus(); return; }
      if (od <= lp.do) { toast(`Novi period mora početi nakon ${isoToEU(lp.do)}`, 'error'); dateInp.focus(); return; }
      w.zaposlenje.push({ od, do: '' });
      msg = `${w.name} ponovno radi od ${isoToEU(od)}`;
    } else {
      lp.do = '';
      delete lp.puniMjesecDo;
      const per = workerPeriods(w);
      if (per.length === 1 && !per[0].od && !per[0].do && !per[0].puniMjesecOd) delete w.zaposlenje;
      msg = `Odjava poništena · ${w.name} radi bez prekida`;
    }
    if (await saveData()) {
      m.close();
      renderSettings();
      toast(msg, 'success', 2600);
    } else {
      w.zaposlenje = JSON.parse(snapshot);
    }
  });
}

/* Početak rada (tekući period); kraj se upisuje preko Odjave */
function workerPeriodModal(idx) {
  const w = state.settings.workers[idx];
  if (!w) return;
  const lp0 = workerLastPeriod(w);
  const earlier = (workerPeriods(w) || []).filter(p => p !== lp0).sort((a, b) => (a.od || '').localeCompare(b.od || ''));
  let puni = !!(lp0 && lp0.puniMjesecOd);
  const html = `
    <div class="modal-title">Period rada · ${escapeHtml(w.name)}</div>
    <div class="modal-sub">Od kojeg dana radnik ulazi u unos sati, isplatu i troškove. Prazno znači od početka evidencije.</div>
    <div class="field">
      <label class="field-label" for="wpm-od">Radi od</label>
      <input class="input" id="wpm-od" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${lp0 && lp0.od ? isoToEU(lp0.od) : ''}">
      <div class="field-hint">${lp0 && lp0.do ? `Zadnji radni dan: ${isoToEU(lp0.do)}. Mijenja se preko „Odjavi".` : 'Kraj rada upisuje se preko „Odjavi".'}</div>
    </div>
    <div class="field" id="wpm-mode-wrap" style="margin-top: 16px;">
      <div class="field-label" id="wpm-mode-label"></div>
      <div class="toggle" role="group" aria-labelledby="wpm-mode-label" style="align-self: flex-start;">
        <button type="button" data-mode="razmjerno" id="wpm-mode-r">Razmjerno</button>
        <button type="button" data-mode="puni">Puni mjesec</button>
      </div>
    </div>
    ${earlier.length ? `<div class="field-label" style="margin-top: 16px;">Raniji periodi</div><div style="margin-top: 6px;">${earlier.map(p => `<span class="per-chip">${p.od ? isoToEU(p.od) : 'od početka'} – ${p.do ? isoToEU(p.do) : 'danas'}</span>`).join('')}</div>` : ''}
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html);
  m.root.querySelector('.modal').classList.add('wp-modal');
  const odInp = m.root.querySelector('#wpm-od');
  attachEUDateMask(odInp);
  const update = () => {
    const od = euToISO(odInp.value.trim());
    const wrap = m.root.querySelector('#wpm-mode-wrap');
    if (!od) { wrap.hidden = true; return; }
    const key = od.slice(0, 7);
    const sim = { ...w, zaposlenje: [{ od, do: (lp0 && lp0.do) || '' }] };
    const share = workerMonthShare(sim, key);
    wrap.hidden = !(share.udio < 1);
    m.root.querySelector('#wpm-mode-label').textContent = `Fiksni iznosi za ${monthAccHr(key)} (fiksno, prijevoz, stan)`;
    m.root.querySelector('#wpm-mode-r').textContent = `Razmjerno · ${share.dana} od ${share.ukupno} ${hrRadnihDana(share.ukupno)}`;
    wrap.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', (b.dataset.mode === 'puni') === puni));
  };
  odInp.addEventListener('input', update);
  odInp.addEventListener('blur', update);
  update();

  m.root.addEventListener('click', async e => {
    const modeBtn = e.target.closest('#wpm-mode-wrap [data-mode]');
    if (modeBtn) { puni = modeBtn.dataset.mode === 'puni'; update(); return; }
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act !== 'save') return;
    const raw = odInp.value.trim();
    const od = raw ? euToISO(raw) : '';
    if (raw && !od) { toast('Datum mora biti u formatu DD/MM/YYYY', 'error'); odInp.classList.add('invalid'); odInp.focus(); return; }
    if (od && lp0 && lp0.do && od > lp0.do) { toast(`Početak ne može biti nakon zadnjeg radnog dana (${isoToEU(lp0.do)})`, 'error'); return; }
    const prevEnd = earlier.reduce((a, p) => (p.do && p.do > a ? p.do : a), '');
    if (earlier.length && (!od || od <= prevEnd)) { toast(`Početak mora biti nakon ranijeg perioda (${isoToEU(prevEnd)})`, 'error'); return; }
    const snapshot = JSON.stringify(Array.isArray(w.zaposlenje) ? w.zaposlenje : null);
    if (!workerPeriods(w)) {
      if (od) w.zaposlenje = [{ od, do: '' }];
    } else {
      lp0.od = od;
    }
    const cur = workerLastPeriod(w);
    if (cur) {
      const partial = od && workerMonthShare({ ...w, zaposlenje: [{ od, do: cur.do || '' }] }, od.slice(0, 7)).udio < 1;
      if (puni && partial) cur.puniMjesecOd = true; else delete cur.puniMjesecOd;
      const per = workerPeriods(w);
      if (per.length === 1 && !per[0].od && !per[0].do && !per[0].puniMjesecDo) delete w.zaposlenje;
    }
    if (await saveData()) {
      m.close();
      renderSettings();
      toast(od ? `${w.name} radi od ${isoToEU(od)}` : `${w.name} · od početka evidencije`, 'success', 2200);
    } else {
      const s = JSON.parse(snapshot);
      if (s === null) delete w.zaposlenje; else w.zaposlenje = s;
    }
  });
}

/* CSS za period rada (Postavke, Evidencija, modali), iz app.js da deploy ostane jedan file */
function injectWorkerPeriodCss() {
  if (document.getElementById('sr-wp-css')) return;
  const st = document.createElement('style');
  st.id = 'sr-wp-css';
  st.textContent = `
    .wp-caption { display: block; font-size: 11px; font-weight: 400; color: var(--muted); margin-top: 3px; letter-spacing: 0; text-transform: none; }
    .wp-prorata { border-bottom: 1px dotted currentColor; cursor: help; }
    .hours-table th.worker-col .wp-th-sub { font-family: var(--font-mono); font-size: 10px; font-weight: 500; color: #8a6a15; margin-top: 2px; }
    .hours-table-v2 td.hcell.wp-off { background: repeating-linear-gradient(135deg, var(--surface-2) 0 6px, #eae8e0 6px 12px); }
    .hours-table-v2 td.hcell.wp-off .hc-top { opacity: .55; text-decoration: line-through; }
    .hrs-chip.wp-off { opacity: .55; text-decoration: line-through; }
    .wp-period-btn { font: inherit; font-size: 13px; color: var(--muted); background: none; border: 0; padding: 4px 0; cursor: pointer; white-space: nowrap; text-decoration: underline dotted; text-underline-offset: 3px; }
    .wp-period-btn:hover { color: var(--ink); }
    .wp-period-text { font-size: 13px; color: var(--muted); white-space: nowrap; }
    tr.wp-group-row td { padding: 0 !important; background: var(--surface-2); }
    .table tr.wp-group-row:hover td { background: var(--surface-2); }
    .wp-group-btn { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 16px; font: inherit; font-size: 13px; color: var(--ink-2); background: none; border: 0; cursor: pointer; text-align: left; }
    .wp-group-btn .chev2 { display: inline-flex; transition: transform .2s var(--ease-snap); color: var(--muted-2); font-size: 15px; }
    .wp-group-btn.open .chev2 { transform: rotate(90deg); }
    .wp-group-btn .cnt { color: var(--muted); }
    .wp-group-btn .hint { margin-left: auto; font-size: 12px; color: var(--muted); }
    tr.wp-former td { color: var(--muted); }
    tr.wp-former td strong { color: var(--ink-2); }
    .wp-preview { background: var(--surface-2); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
    .wp-preview-grid { display: grid; grid-template-columns: minmax(0, 1fr) auto 24px auto; gap: 6px 12px; align-items: baseline; font-size: 13px; }
    .wp-preview-grid .was { font-family: var(--font-mono); color: var(--muted-2); text-align: right; }
    .wp-preview-grid .was.changed { text-decoration: line-through; }
    .wp-preview-grid .arr { text-align: center; color: var(--muted-2); }
    .wp-preview-grid .now { font-family: var(--font-mono); font-weight: 600; text-align: right; }
    .wp-preview-note { font-size: 12px; color: var(--muted); border-top: 1px dashed var(--line-strong); padding-top: 8px; }
    .wp-warn { font-size: 12px; color: var(--negative); margin-top: 10px; }
    .wp-warn:empty { display: none; }
    .wp-lists { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .wp-lists ul { margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.55; color: var(--ink-2); }
    .wp-radio { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; font-size: 14px; }
    .wp-radio input { margin-top: 3px; accent-color: var(--acc); }
    .wp-radio.on { border-color: var(--acc); box-shadow: 0 0 0 3px var(--acc-soft); }
    .wp-dm-note { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); margin-top: 10px; }
    .wp-ico-btn svg { width: 14px; height: 14px; flex: none; }
    .wp-workers-table th, .wp-workers-table td { padding-left: 10px; padding-right: 10px; }
    .wp-workers-table input.input.num { min-width: 72px; }
    .wp-workers-table input.input[data-f="name"] { min-width: 96px; }
    .modal.wp-modal { max-height: calc(100vh - 40px); max-height: calc(100dvh - 40px); overflow-y: auto; overscroll-behavior: contain; }
    @media (max-width: 640px) {
      .wp-lists { grid-template-columns: 1fr; }
      .wp-group-btn .hint { display: none; }
    }
  `;
  document.head.appendChild(st);
}

function renderSettings() {
  const panel = document.getElementById('panel-settings');
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">Konfiguracija</div>
        <h1 class="page-title">Postavke <em>i backup</em></h1>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Općenito</div>
            <div class="card-sub">Limit računa i osnovne info</div>
          </div>
        </div>
        <div class="grid grid-2" style="gap: 14px;">
          <div class="field">
            <label class="field-label">Limit računa (€)</label>
            <input class="input num" id="set-limit" type="text" inputmode="decimal" placeholder="0,00" value="${formatEUAmount(state.company?.limit_racuna || 30000)}" ${isAdmin ? '' : 'disabled'}>
          </div>
          <div class="field">
            <label class="field-label">Naziv firme</label>
            <input class="input" value="${escapeHtml(state.company?.name || 'Stara Rijeka d.o.o.')}" disabled>
          </div>
        </div>
        ${isAdmin ? `<div style="margin-top: 16px;"><button class="btn btn-primary" id="save-general">Spremi promjene</button></div>` : ''}
      </div>

      <div class="card">
        <div class="card-head">
          <div>
            <div class="card-title">Backup i izvoz</div>
            <div class="card-sub">Dvostruka sigurnost podataka</div>
          </div>
        </div>
        <p style="font-size: 13px; color: var(--muted); margin-bottom: 16px;">
          Preuzmi backup periodički (preporuka: 1× mjesečno).
          Lokalni backup u browseru se sprema automatski pri svakoj izmjeni.
        </p>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="btn" id="dl-json">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Backup .json
          </button>
          <button class="btn" id="dl-xlsx">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="19"/><line x1="15" y1="13" x2="9" y2="19"/></svg>
            Excel .xlsx
          </button>
          ${isAdmin ? `<button class="btn admin-only" id="upload-json" style="display:inline-flex;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Vrati iz .json
          </button>
          <input type="file" id="upload-json-input" accept=".json" style="display:none;">` : ''}
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Radnici</div>
          <div class="card-sub">Satnice, marenda, prijevoz, stan, fiksno · Fiksna isplata: ako je > 0, radnik ima točno taj iznos za isplatu svaki mjesec (npr. Dragan 900), bez obzira na sate i marendu · Period rada: od kada do kada radnik ulazi u unos sati, isplatu i troškove</div>
        </div>
        ${isAdmin ? `<button class="btn btn-primary admin-only" id="add-worker">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Novi radnik
        </button>` : ''}
      </div>
      <div class="table-scroll">
        <table class="table wp-workers-table">
          <thead>
            <tr>
              <th>Radnik</th>
              <th class="text-right">Satnica (€/h)</th>
              <th class="text-right">Marenda/dan (€)</th>
              <th class="text-right">Prijevoz/mj. (€)</th>
              <th class="text-right">Stan/mj. (€)</th>
              <th class="text-right">Fiksno/mj. (€)</th>
              <th class="text-right">Fiksna isplata/mj. (€)</th>
              <th>Period rada</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${settingsWorkersSplit().aktivni.map(({ w, i }) => `
              <tr>
                <td>${isAdmin
                  ? `<input class="input" value="${escapeHtml(w.name)}" data-w="${i}" data-f="name" style="max-width: 180px;">`
                  : `<strong>${escapeHtml(w.name)}</strong>`}</td>
                ${['satnica','marenda','prijevoz','stan','fiksno','fiksnaIsplata'].map(f => {
                  const histCount = (f === 'fiksno' && Array.isArray(w.fiksnoHistory)) ? w.fiksnoHistory.filter(e => e && e.from).length : 0;
                  if (f === 'fiksno' && isAdmin) {
                    return `<td class="text-right">
                      <div style="display: inline-flex; align-items: center; gap: 4px; justify-content: flex-end;">
                        <button class="btn btn-ghost btn-sm fiksno-hist-btn" data-fiksno-hist="${i}" title="Fiksno kroz vrijeme${histCount ? ' (' + histCount + ' promjena)' : ''}" style="padding: 4px;">
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
                        </button>
                        ${histCount ? `<span class="fiksno-hist-dot" title="${histCount} promjena kroz vrijeme"></span>` : ''}
                        <input class="input num" type="number" step="0.5" value="${w[f]}" data-w="${i}" data-f="${f}" style="max-width: 90px; text-align: right;">
                      </div>
                    </td>`;
                  }
                  return `<td class="text-right">${isAdmin
                    ? `<input class="input num" type="number" step="0.5" value="${Number(w[f]) || 0}" data-w="${i}" data-f="${f}" style="max-width: 100px; margin-left: auto; text-align: right;">`
                    : `<span class="num">${eur(Number(w[f]) || 0, f === 'satnica' ? 2 : 0)}</span>`}</td>`;
                }).join('')}
                <td>${isAdmin
                  ? `<button type="button" class="wp-period-btn" data-act="period-worker" data-i="${i}" title="Uredi početak rada">${escapeHtml(workerPeriodText(w))}</button>`
                  : `<span class="wp-period-text">${escapeHtml(workerPeriodText(w))}</span>`}</td>
                ${isAdmin ? `<td class="text-right" style="white-space: nowrap;">
                  <button type="button" class="btn btn-sm wp-ico-btn" data-act="odjavi-worker" data-i="${i}" title="Zadnji radni dan · radnik ostaje u povijesti">${WP_ICON_ODJAVA}Odjavi</button>
                  ${workerHasHistory(w) ? '' : `<button class="btn btn-ghost btn-sm btn-danger" data-act="del-worker" data-i="${i}" title="Obriši (radnik još nema nijedan upis)">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  </button>`}
                </td>` : ''}
              </tr>
            `).join('')}
            ${settingsFormerRowsHtml()}
          </tbody>
        </table>
      </div>
      ${isAdmin ? '<div style="margin-top: 16px;"><button class="btn btn-primary" id="save-workers">Spremi promjene radnika</button></div>' : ''}
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Fiksni rad · mjesečno</div>
          <div class="card-sub">Osobe s fiksnim mjesečnim troškom rada, bez satnice i bez dnevne evidencije (Boris, Tata). Svaki mjesec ulaze u Sažetak isplate (Evidencija sati) i u Cashflow stupac Radnici. VAŽNO: radnici koji već postoje u Evidenciji (npr. Dragan) tu NE idu — njima se fiksni dio upisuje u polje Fiksno u tablici Radnici iznad, da se ništa ne broji duplo.</div>
        </div>
        ${isAdmin ? `<button class="btn btn-primary admin-only" id="add-fixed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova osoba
        </button>` : ''}
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Ime</th>
              <th class="text-right">Iznos/mj. (€)</th>
              <th>Aktivno</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${(state.settings.fixedLabor || []).map((f, i) => `
              <tr style="opacity: ${f.active === false ? 0.55 : 1};">
                <td>${isAdmin
                  ? `<input class="input" value="${escapeHtml(f.name || '')}" data-fl="${i}" data-f="name" style="max-width: 180px;">`
                  : `<strong>${escapeHtml(f.name || '')}</strong>`}</td>
                <td class="text-right">${isAdmin
                  ? `<input class="input num" type="number" step="10" value="${Number(f.amount) || 0}" data-fl="${i}" data-f="amount" style="max-width: 110px; margin-left: auto; text-align: right;">`
                  : `<span class="num">${eur(f.amount, 0)}</span>`}</td>
                <td>${isAdmin
                  ? `<input type="checkbox" ${f.active !== false ? 'checked' : ''} data-fl="${i}" data-f="active" style="width: 18px; height: 18px;">`
                  : (f.active !== false ? '<span class="pill green">aktivno</span>' : '<span class="pill gray">isključeno</span>')}</td>
                ${isAdmin ? `<td class="text-right">
                  <button class="btn btn-ghost btn-sm btn-danger" data-act="del-fixed" data-i="${i}" title="Obriši">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  </button>
                </td>` : ''}
              </tr>`).join('')}
            ${(state.settings.fixedLabor || []).length === 0 ? `<tr><td colspan="${isAdmin ? 4 : 3}" style="text-align: center; color: var(--muted); padding: 24px;">Nema fiksnih osoba.</td></tr>` : ''}
          </tbody>
          <tfoot>
            <tr>
              <td>Σ aktivno mjesečno</td>
              <td class="num text-right"><strong>${eur(getFixedLabor().reduce((a, f) => a + (Number(f.amount) || 0), 0), 0)}</strong></td>
              <td colspan="${isAdmin ? 2 : 1}"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      ${isAdmin ? '<div style="margin-top: 16px;"><button class="btn btn-primary" id="save-fixed">Spremi fiksni rad</button></div>' : ''}
    </div>

    ${v4PravilaCardHtml()}

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Sigurnost</div>
          <div class="card-sub">Admin pristup i lokalni cache</div>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; gap: 12px; font-size: 14px;">
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--surface-2); border-radius: 10px;">
          <div>
            <div style="font-weight: 500;">Admin status</div>
            <div style="color: var(--muted); font-size: 12px; margin-top: 2px;">${isAdmin ? 'Možeš dodavati i mijenjati podatke' : 'Pregled · za izmjene unesi PIN'}</div>
          </div>
          <button class="btn ${isAdmin ? '' : 'btn-primary'}" id="toggle-admin">${isAdmin ? 'Odjavi se' : 'Aktiviraj admin'}</button>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: var(--surface-2); border-radius: 10px;">
          <div>
            <div style="font-weight: 500;">Lokalni backup</div>
            <div style="color: var(--muted); font-size: 12px; margin-top: 2px;">${localStorage.getItem('sr_data_backup') ? 'Postoji u browseru · služi kao fallback' : 'Nema lokalnog backupa'}</div>
          </div>
          <button class="btn" id="clear-cache">Obriši cache</button>
        </div>
      </div>
    </div>
  `;

  // Wire up
  attachEUAmountMask(panel.querySelector('#set-limit'));
  panel.querySelector('#dl-json')?.addEventListener('click', downloadJson);
  panel.querySelector('#dl-xlsx')?.addEventListener('click', downloadXlsx);
  panel.querySelector('#wp-bivsi-toggle')?.addEventListener('click', (e) => {
    wpBivsiOpen = !wpBivsiOpen;
    const b = e.currentTarget;
    b.classList.toggle('open', wpBivsiOpen);
    b.setAttribute('aria-expanded', wpBivsiOpen ? 'true' : 'false');
    panel.querySelectorAll('tr.wp-former').forEach(tr => { tr.hidden = !wpBivsiOpen; });
  });
  panel.querySelector('#toggle-admin')?.addEventListener('click', showPinModal);
  panel.querySelector('#clear-cache')?.addEventListener('click', () => {
    if (confirm('Obrisati lokalni cache backup?')) {
      localStorage.removeItem('sr_data_backup');
      renderSettings();
      toast('Lokalni cache obrisan');
    }
  });
  bindPravilaCard(panel);
  if (isAdmin) {
    panel.querySelector('#save-general')?.addEventListener('click', async () => {
      const limit = parseEUAmount(panel.querySelector('#set-limit').value) || 30000;
      state.company.limit_racuna = limit;
      if (await saveData()) renderSettings();
    });
    panel.querySelector('#save-workers')?.addEventListener('click', async () => {
      panel.querySelectorAll('input[data-w]').forEach(inp => {
        const i = parseInt(inp.dataset.w);
        const f = inp.dataset.f;
        const val = f === 'name' ? inp.value : (parseFloat(inp.value) || 0);
        if (state.settings.workers[i]) state.settings.workers[i][f] = val;
      });
      if (await saveData()) {
        renderSettings();
        toast('Radnici ažurirani', 'success');
      }
    });
    panel.querySelector('#add-worker')?.addEventListener('click', async () => {
      state.settings.workers.push({ name: 'Novi radnik', satnica: 0, marenda: 4, prijevoz: 70, stan: 0, fiksno: 1100, fiksnaIsplata: 0, zaposlenje: [{ od: localTodayISO(), do: '' }] });
      if (await saveData()) renderSettings();
    });
    panel.querySelectorAll('[data-act="del-worker"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Obrisati radnika? Postojeći zapisi sati će ostati.')) return;
      state.settings.workers.splice(parseInt(b.dataset.i), 1);
      if (await saveData()) renderSettings();
    }));
    panel.querySelectorAll('[data-act="odjavi-worker"]').forEach(b => b.addEventListener('click', () => workerOdjavaModal(parseInt(b.dataset.i))));
    panel.querySelectorAll('[data-act="vrati-worker"]').forEach(b => b.addEventListener('click', () => workerVratiModal(parseInt(b.dataset.i))));
    panel.querySelectorAll('[data-act="period-worker"]').forEach(b => b.addEventListener('click', () => workerPeriodModal(parseInt(b.dataset.i))));
    panel.querySelector('#save-fixed')?.addEventListener('click', async () => {
      const list = (state.settings.fixedLabor || []).map(f => ({ ...f }));
      panel.querySelectorAll('[data-fl]').forEach(inp => {
        const i = parseInt(inp.dataset.fl);
        const f = inp.dataset.f;
        if (!list[i]) return;
        if (f === 'active') list[i].active = inp.checked;
        else if (f === 'amount') list[i].amount = parseFloat(inp.value) || 0;
        else list[i][f] = inp.value.trim();
      });
      state.settings.fixedLabor = list;
      if (await saveData()) {
        renderSettings();
        toast('Fiksni rad ažuriran', 'success');
      }
    });
    panel.querySelector('#add-fixed')?.addEventListener('click', async () => {
      if (!Array.isArray(state.settings.fixedLabor)) state.settings.fixedLabor = [];
      state.settings.fixedLabor.push({ name: 'Nova osoba', amount: 0, active: true });
      if (await saveData()) renderSettings();
    });
    panel.querySelectorAll('[data-act="del-fixed"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Obrisati osobu iz fiksnog rada? Ovo ne dira nikakve druge podatke.')) return;
      state.settings.fixedLabor.splice(parseInt(b.dataset.i), 1);
      if (await saveData()) renderSettings();
    }));
    panel.querySelectorAll('[data-fiksno-hist]').forEach(b => b.addEventListener('click', () => {
      fiksnoHistoryModal(parseInt(b.dataset.fiksnoHist));
    }));
    panel.querySelector('#upload-json')?.addEventListener('click', () => panel.querySelector('#upload-json-input').click());
    panel.querySelector('#upload-json-input')?.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!confirm(`Vratit će se podaci iz "${f.name}". Trenutni podaci će biti zamijenjeni. Nastaviti?`)) return;
      try {
        const text = await f.text();
        const newData = JSON.parse(text);
        state = newData;
        if (await saveData()) {
          toast('Podaci uspješno vraćeni', 'success');
          rerenderActive();
        }
      } catch (err) {
        toast('Greška u datoteci: ' + err.message, 'error');
      }
    });
  }
}

/* ============================================================
   EXPORT FUNCTIONS
   ============================================================ */
function downloadJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `stara-rijeka-cashflow-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup preuzet', 'success');
}

function downloadXlsx() {
  // Lazy-load SheetJS
  if (typeof XLSX === 'undefined') {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    script.onload = downloadXlsx;
    document.head.appendChild(script);
    toast('Učitavam Excel modul…');
    return;
  }

  const wb = XLSX.utils.book_new();

  // CASHFLOW summary sheet
  const summary = computeCashflowSummary();
  const months = allMonths();
  const cfRows = [
    ['Stara Rijeka d.o.o. · Cashflow ' + new Date().toISOString().slice(0,10)],
    [],
    ['Mjesec', 'Prihodi', 'Tekući', 'Nepredv.', 'STO', 'Radnici', 'Troškovi UK', 'Neto'],
  ];
  for (const k of months) {
    const s = summary[k];
    cfRows.push([monthLabel(k), s.prihodi, s.tekuci, s.nepredvideni, s.sto, s.radnici, s.troskoviUkupno, s.neto]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cfRows), 'CASHFLOW');

  // Settings
  const setRows = [['Radnik', 'Satnica', 'Marenda', 'Prijevoz', 'Stan', 'Fiksno', 'Fiksna isplata', 'Radi od', 'Radi do']];
  for (const w of state.settings.workers) {
    const lp = workerLastPeriod(w);
    setRows.push([w.name, w.satnica, w.marenda, w.prijevoz, w.stan, w.fiksno, Number(w.fiksnaIsplata) || 0, lp && lp.od ? isoToEU(lp.od) : '', lp && lp.do ? isoToEU(lp.do) : '']);
  }
  if ((state.settings.fixedLabor || []).length) {
    setRows.push([]);
    setRows.push(['Fiksni rad (mjesečno)', 'Iznos', 'Aktivno']);
    for (const f of state.settings.fixedLabor) {
      setRows.push([f.name || '', Number(f.amount) || 0, f.active === false ? 'ne' : 'da']);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(setRows), 'Postavke');

  // TRX per month
  for (const k of months) {
    const items = (state.trx[k] || []);
    if (!items.length) continue;
    const rows = [['Datum', 'Tip', 'Partner', 'Iznos', 'Kategorija', 'Grupa']];
    for (const t of items) rows.push([t.date, t.type, t.partner, t.amount, t.category, t.group]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Trx ${monthLabelShort(k)}`);
  }

  // STO per month
  for (const k of months) {
    const items = (state.sto[k] || []);
    if (!items.length) continue;
    const rows = [['Datum', 'Iznos', 'Projekt', 'Napomena']];
    for (const t of items) rows.push([t.date, t.amount, t.project, t.note]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `STO ${monthLabelShort(k)}`);
  }

  // STO stavke — razrada materijala iz uvezenih računa (svi mjeseci)
  const stavkeRows = [['Mjesec', 'Datum', 'Projekt', 'Napomena', 'Artikl', 'Šifra', 'Količina', 'Jedinica', 'PDV %', 'Iznos bez PDV', 'Iznos s PDV']];
  for (const k of months) {
    for (const t of (state.sto[k] || [])) {
      for (const it of (t.items || [])) {
        stavkeRows.push([monthLabel(k), t.date, t.project || '', t.note || '', it.name || '', it.code || '', Number(it.qty) || 0, it.unit || '', (it.vatPct === 0 || it.vatPct) ? it.vatPct : '', (it.net === 0 || it.net) ? it.net : '', Number(it.amount) || 0]);
      }
    }
  }
  if (stavkeRows.length > 1) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stavkeRows), 'STO stavke');
  }

  // Hours per month
  for (const k of Object.keys(state.hours || {})) {
    const h = state.hours[k];
    if (!h?.days?.length) continue;
    const workers = workersForMonthView(k).map(w => w.name);
    const rows = [['Datum', 'Dan', ...workers.flatMap(n => [n + ' Sati', n + ' Mar.'])]];
    for (const d of h.days) {
      rows.push([d.date, d.day_name, ...workers.flatMap(n => [d.workers?.[n]?.hours || 0, d.workers?.[n]?.marenda || 0])]);
    }
    // Za isplatu po radniku (auto + override + fiksna isplata, nikad ispod 0)
    const monthStats = computeWorkerStats(k);
    rows.push(['Za isplatu', '', ...workers.flatMap(n => {
      const s = monthStats.find(x => x.name === n);
      return [s ? s.zaIsplatu : 0, ''];
    })]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Sati ${monthLabelShort(k)}`);
  }

  // Registar: rokovi + godišnji
  if (state.registar && ((state.registar.rokovi || []).length || Object.keys(state.registar.godisnji || {}).length)) {
    const regRows = [['ROKOVI I PODSJETNICI'], ['Stavka', 'Kategorija', 'Zadnje obavljeno', 'Sljedeći rok', 'Napomena']];
    for (const r of (state.registar.rokovi || [])) {
      regRows.push([r.naziv || '', r.kategorija || '', r.zadnje || '', r.rok || '', r.note || '']);
    }
    regRows.push([]);
    regRows.push(['GODIŠNJI ODMORI']);
    regRows.push(['Radnik', 'Ukupno dana', 'Iskorišteno (svi periodi)', 'Periodi']);
    for (const [name, g] of Object.entries(state.registar.godisnji || {})) {
      const per = (g.periodi || []).map(p => p.od ? `${isoToEU(p.od)}-${isoToEU(p.do)} (${p.dana} d)` : `${p.dana} d (bez datuma${p.godina ? ', ' + p.godina : ''})`).join('; ');
      regRows.push([name, Number(g.ukupno) || 0, (g.periodi || []).reduce((a, p) => a + (Number(p.dana) || 0), 0), per]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(regRows), 'Registar');
  }

  XLSX.writeFile(wb, `stara-rijeka-cashflow-${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel preuzet', 'success');
}

/* ============================================================
   RENDER: PROGNOZA
   ============================================================ */

/* Kategorije za prognozu (slično TRX_CATEGORIES, prilagođeno za tekuće troškove) */
const FORECAST_CATEGORIES = [
  'Leasing','Smještaj','Komunalije','Telekomunikacije','Knjigovodstvo','Bankovne naknade',
  'Gorivo','Osiguranje','Plaće','Doprinosi','Porez','e-poslovanje','Najam','Ostalo'
];

/* Default seed za prognozu — koristi se prvi put kad korisnikov state nema forecast polje.
   Korisnik može uređivati (dodati / promijeniti / obrisati) preko UI. Promjene se spremaju u Blob. */
const DEFAULT_FORECAST_SEED = [
  { label: 'Porsche Leasing (aktualno vozilo)', category: 'Leasing', amount: 1666.76, validFrom: '2026-05', validTo: '', note: 'Mjesečna rata leasinga novog vozila — od 5. mjeseca', active: true },
  { label: 'Porsche Leasing (prethodno vozilo)', category: 'Leasing', amount: 1329.54, validFrom: '2026-02', validTo: '2026-04', note: 'Staro vozilo — vidi se u Trx za Veljaču-Travanj', active: true },
  { label: 'Stan — najam', category: 'Smještaj', amount: 2500.00, validFrom: '2026-02', validTo: '', note: 'Mjesečno (kombinirana stavka)', active: true },
  { label: 'Adria Oil — gorivo (procjena)', category: 'Gorivo', amount: 1000.00, validFrom: '2026-02', validTo: '', note: 'Prosjek 2 punjenja mjesečno · varira', active: true },
  { label: 'Hrvatski Telekom (stari operater)', category: 'Telekomunikacije', amount: 385.00, validFrom: '2026-02', validTo: '2026-04', note: 'Prosjek viđenih računa · prešli na A1', active: true },
  { label: 'A1 telekomunikacije', category: 'Telekomunikacije', amount: 0.00, validFrom: '2026-05', validTo: '', note: 'UNESI STVARAN IZNOS čim stigne prvi račun', active: true },
  { label: 'Knjigovodstvo (Jojo)', category: 'Knjigovodstvo', amount: 300.00, validFrom: '2026-02', validTo: '', note: 'Mjesečna naknada za knjigovodstvo', active: true },
  { label: 'PBZ — bankovne naknade', category: 'Bankovne naknade', amount: 40.00, validFrom: '2026-02', validTo: '', note: 'Mjesečno održavanje računa. Veće naknade su nepredviđene.', active: true },
  { label: 'HRT pristojba', category: 'Komunalije', amount: 10.62, validFrom: '2026-02', validTo: '', note: '', active: true },
  { label: 'Pondi e-poslovanje', category: 'e-poslovanje', amount: 5.00, validFrom: '2026-02', validTo: '', note: '', active: true },
];

let forecastView = 'month';  // 'month' | 'year'
let forecastYear = 2026;     // godina za year view

function ensureForecast() {
  if (!state.forecast) state.forecast = [];
}

/* Da li je item aktivan u danom mjesecu (YYYY-MM) */
function forecastItemActiveIn(item, monthKey) {
  if (!item) return false;
  if (item.active === false) return false;
  if (item.validFrom && monthKey < item.validFrom) return false;
  if (item.validTo && monthKey > item.validTo) return false;
  return true;
}

/* Vrati listu aktivnih items za mjesec, sortirano po kategoriji i nazivu */
function forecastItemsForMonth(monthKey) {
  ensureForecast();
  return state.forecast
    .filter(it => forecastItemActiveIn(it, monthKey))
    .slice()
    .sort((a, b) => (a.category || '').localeCompare(b.category || '') || (a.label || '').localeCompare(b.label || ''));
}

function forecastMonthTotal(monthKey) {
  return forecastItemsForMonth(monthKey).reduce((s, it) => s + (Number(it.amount) || 0), 0);
}

/* Stvarni tekući troškovi za mjesec (za usporedbu) */
function actualTekuciForMonth(monthKey) {
  return (state.trx[monthKey] || [])
    .filter(t => t.group === 'Tekući' && t.type !== 'Prihod')
    .reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

function renderForecast() {
  ensureForecast();
  const panel = document.getElementById('panel-forecast');
  if (forecastView === 'year') return renderForecastYear(panel);

  const items = forecastItemsForMonth(activeMonth);
  const total = forecastMonthTotal(activeMonth);
  const actual = actualTekuciForMonth(activeMonth);
  const delta = actual - total;
  const allItems = state.forecast || [];
  const inactiveCount = allItems.filter(it => !forecastItemActiveIn(it, activeMonth)).length;

  // Grupiraj po kategoriji
  const byCat = {};
  for (const it of items) {
    const c = it.category || 'Ostalo';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(it);
  }
  const catKeys = Object.keys(byCat).sort();

  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">Planirani tekući troškovi · ${monthLabel(activeMonth)}</div>
        <h1 class="page-title">Prognoza <em>troškova</em></h1>
      </div>
      <div class="page-actions">
        <div class="view-toggle" role="tablist">
          <button class="view-toggle-btn active" data-view="month">Mjesec</button>
          <button class="view-toggle-btn" data-view="year">Godina</button>
        </div>
        ${buildMonthPicker(activeMonth, null, { allowAdd: false })}
        ${isAdmin ? `<button class="btn btn-primary" id="new-forecast">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova stavka
        </button>` : ''}
      </div>
    </div>

    <div class="grid grid-3" style="margin-bottom: 24px;">
      <div class="stat-card">
        <div class="stat-label">Prognoza za mjesec</div>
        <div class="stat-value">${eur(total, 0)}</div>
        <div class="stat-sub">${items.length} stavki · ${monthLabelShort(activeMonth)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stvarno (Tekući)</div>
        <div class="stat-value">${actual ? eur(actual, 0) : '—'}</div>
        <div class="stat-sub">${actual ? 'iz Trx tab-a' : 'nema unesenih'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Odstupanje</div>
        <div class="stat-value ${delta > 0 ? 'negative' : delta < 0 ? 'positive' : ''}">${actual ? (delta >= 0 ? '+' : '') + eur(delta, 0) : '—'}</div>
        <div class="stat-sub">${actual ? (delta > 0 ? 'iznad prognoze' : delta < 0 ? 'ispod prognoze' : 'po prognozi') : '—'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Tekući troškovi koje očekujemo</div>
          <div class="card-sub">${items.length} aktivnih · ${inactiveCount} neaktivnih izvan ovog mjeseca</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Kategorija</th>
              <th>Stavka</th>
              <th class="text-right">Iznos (€)</th>
              <th>Vrijedi od</th>
              <th>Vrijedi do</th>
              <th>Napomena</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${items.length === 0 ? `<tr><td colspan="${isAdmin ? 7 : 6}" style="text-align: center; padding: 36px 12px; color: var(--muted);">
              ${isAdmin ? 'Nema prognoziranih stavki za ovaj mjesec. Klikni „Nova stavka" za dodavanje.' : 'Admin još nije unio prognozu za ovaj mjesec.'}
            </td></tr>` : catKeys.map(cat => {
              const list = byCat[cat];
              const subTotal = list.reduce((s, it) => s + (Number(it.amount) || 0), 0);
              return list.map((it, j) => {
                const realIdx = state.forecast.indexOf(it);
                return `
                <tr ${isAdmin ? `class="clickable" data-idx="${realIdx}"` : ''}>
                  ${j === 0 ? `<td rowspan="${list.length}" style="vertical-align: top; font-weight: 600; color: var(--acc); border-right: 1px solid var(--line);">${escapeHtml(cat)}</td>` : ''}
                  <td>${escapeHtml(it.label || '')}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(it.amount)}</td>
                  <td class="col-date">${it.validFrom ? monthLabel(it.validFrom) : '—'}</td>
                  <td class="col-date">${it.validTo ? monthLabel(it.validTo) : '<span style="color: var(--muted-2);">otvoreno</span>'}</td>
                  <td style="color: var(--muted); font-size: 13px;">${escapeHtml(it.note || '')}</td>
                  ${isAdmin ? `<td class="text-right">
                    <button class="btn btn-ghost btn-sm" data-edit-fc="${realIdx}" title="Uredi">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                  </td>` : ''}
                </tr>`;
              }).join('') + `
                <tr class="subtotal-row" style="background: var(--surface-2);">
                  <td></td>
                  <td style="font-weight: 600; color: var(--muted);">Σ ${escapeHtml(cat)}</td>
                  <td class="num text-right" style="font-weight: 700;">${eur(subTotal)}</td>
                  <td colspan="${isAdmin ? 4 : 3}"></td>
                </tr>
              `;
            }).join('')}
          </tbody>
          ${items.length > 0 ? `<tfoot>
            <tr>
              <td colspan="2" style="font-weight: 700;">Ukupna prognoza za ${monthLabel(activeMonth)}</td>
              <td class="num text-right" style="font-weight: 700; font-size: 16px;">${eur(total)}</td>
              <td colspan="${isAdmin ? 4 : 3}"></td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    </div>

    ${isAdmin && allItems.length > 0 ? `
    <div class="card" style="margin-top: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Sve prognozne stavke (cijeli registar)</div>
          <div class="card-sub">Uključujući one koje ne vrijede u ${monthLabelShort(activeMonth)} ${activeMonth.slice(0,4)}</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Kategorija</th>
              <th>Stavka</th>
              <th class="text-right">Iznos (€)</th>
              <th>Razdoblje</th>
              <th class="text-right">Akcije</th>
            </tr>
          </thead>
          <tbody>
            ${allItems.map((it, i) => {
              const isActive = forecastItemActiveIn(it, activeMonth);
              const period = (it.validFrom ? monthLabel(it.validFrom) : 'oduvijek') + ' → ' + (it.validTo ? monthLabel(it.validTo) : 'otvoreno');
              return `
              <tr class="clickable" data-idx="${i}" style="opacity: ${isActive ? 1 : 0.55};">
                <td>${isActive ? '<span class="pill green">aktivno</span>' : '<span class="pill gray">izvan razdoblja</span>'}</td>
                <td style="color: var(--acc);">${escapeHtml(it.category || '—')}</td>
                <td>${escapeHtml(it.label || '')}</td>
                <td class="num text-right">${eur(it.amount)}</td>
                <td class="col-date" style="font-size: 12px;">${period}</td>
                <td class="text-right">
                  <button class="btn btn-ghost btn-sm" data-edit-fc="${i}" title="Uredi">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  `;

  bindMonthPicker(panel, activeMonth, (m) => { activeMonth = m; ensureMonth(m); renderForecast(); }, { allowAdd: false });

  panel.querySelectorAll('.view-toggle-btn').forEach(b => b.addEventListener('click', () => {
    forecastView = b.dataset.view;
    renderForecast();
  }));

  if (isAdmin) {
    panel.querySelector('#new-forecast')?.addEventListener('click', () => forecastModal(null));
    panel.querySelectorAll('[data-edit-fc]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      forecastModal(parseInt(b.dataset.editFc));
    }));
    panel.querySelectorAll('tr.clickable[data-idx]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      forecastModal(parseInt(tr.dataset.idx));
    }));
  }
}

function renderForecastYear(panel) {
  ensureForecast();
  const year = forecastYear;
  const months = [];
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, '0')}`);
  }

  // Skup svih item-a koji su barem u jednom mjesecu te godine aktivni
  const itemsInYear = (state.forecast || []).filter(it => months.some(mk => forecastItemActiveIn(it, mk)));
  // Grupiraj po kategoriji
  const byCat = {};
  for (const it of itemsInYear) {
    const c = it.category || 'Ostalo';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(it);
  }
  const catKeys = Object.keys(byCat).sort();

  // Mjesečne sume
  const monthlyTotals = months.map(mk => forecastMonthTotal(mk));
  const yearTotal = monthlyTotals.reduce((s, x) => s + x, 0);
  const actualByMonth = months.map(mk => actualTekuciForMonth(mk));
  const actualYearTotal = actualByMonth.reduce((s, x) => s + x, 0);

  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">Godišnji pregled · ${year}</div>
        <h1 class="page-title">Prognoza <em>${year}</em></h1>
      </div>
      <div class="page-actions">
        <div class="view-toggle" role="tablist">
          <button class="view-toggle-btn" data-view="month">Mjesec</button>
          <button class="view-toggle-btn active" data-view="year">Godina</button>
        </div>
        <div class="month-picker" data-year="${year}">
          <button data-act="year-prev" aria-label="Prethodna godina"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
          <span class="month-label">${year}</span>
          <button data-act="year-next" aria-label="Sljedeća godina"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
        </div>
        ${isAdmin ? `<button class="btn btn-primary" id="new-forecast-y">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Nova stavka
        </button>` : ''}
      </div>
    </div>

    <div class="grid grid-3" style="margin-bottom: 24px;">
      <div class="stat-card">
        <div class="stat-label">Prognoza godina ${year}</div>
        <div class="stat-value">${eur(yearTotal, 0)}</div>
        <div class="stat-sub">${itemsInYear.length} stavki</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Stvarno YTD (Tekući)</div>
        <div class="stat-value">${actualYearTotal ? eur(actualYearTotal, 0) : '—'}</div>
        <div class="stat-sub">${actualYearTotal ? 'iz Trx tab-a' : 'nema podataka'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Mjesečni prosjek</div>
        <div class="stat-value">${eur(yearTotal / 12, 0)}</div>
        <div class="stat-sub">prognoza ÷ 12</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Pregled po mjesecima</div>
          <div class="card-sub">Iznos po stavki u svakom mjesecu — prazno = nije aktivno</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table table-compact">
          <thead>
            <tr>
              <th style="position: sticky; left: 0; background: var(--surface); z-index: 2;">Stavka</th>
              ${months.map(mk => `<th class="text-right">${monthLabelShort(mk).slice(0,3)}</th>`).join('')}
              <th class="text-right" style="background: var(--acc-soft); color: var(--acc);">Ukupno</th>
            </tr>
          </thead>
          <tbody>
            ${catKeys.length === 0 ? `<tr><td colspan="14" style="text-align: center; padding: 36px 12px; color: var(--muted);">Nema prognoziranih stavki za ${year}.</td></tr>` : catKeys.map(cat => {
              const list = byCat[cat];
              return `
                <tr class="cat-row">
                  <td colspan="14" style="background: var(--surface-2); font-weight: 700; color: var(--acc); padding: 8px 14px;">${escapeHtml(cat)}</td>
                </tr>
                ${list.map(it => {
                  const realIdx = state.forecast.indexOf(it);
                  const itemTotal = months.reduce((s, mk) => s + (forecastItemActiveIn(it, mk) ? (Number(it.amount) || 0) : 0), 0);
                  return `
                  <tr ${isAdmin ? `class="clickable" data-idx="${realIdx}"` : ''}>
                    <td style="position: sticky; left: 0; background: var(--surface); z-index: 1;">${escapeHtml(it.label || '')}</td>
                    ${months.map(mk => {
                      const active = forecastItemActiveIn(it, mk);
                      return `<td class="num text-right" style="color: ${active ? 'var(--ink)' : 'var(--muted-2)'};">${active ? eur(it.amount, 0) : '—'}</td>`;
                    }).join('')}
                    <td class="num text-right" style="background: var(--acc-soft); color: var(--acc); font-weight: 700;">${eur(itemTotal, 0)}</td>
                  </tr>`;
                }).join('')}
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td style="position: sticky; left: 0; background: var(--surface); font-weight: 700;">Ukupno prognoza</td>
              ${monthlyTotals.map(t => `<td class="num text-right" style="font-weight: 700;">${t ? eur(t, 0) : '—'}</td>`).join('')}
              <td class="num text-right" style="background: var(--acc); color: var(--acc-ink); font-weight: 700;">${eur(yearTotal, 0)}</td>
            </tr>
            <tr style="opacity: 0.85;">
              <td style="position: sticky; left: 0; background: var(--surface); color: var(--muted);">Stvarno (Tekući)</td>
              ${actualByMonth.map(a => `<td class="num text-right" style="color: var(--muted);">${a ? eur(a, 0) : '—'}</td>`).join('')}
              <td class="num text-right" style="color: var(--muted); font-weight: 600;">${actualYearTotal ? eur(actualYearTotal, 0) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;

  panel.querySelectorAll('.view-toggle-btn').forEach(b => b.addEventListener('click', () => {
    forecastView = b.dataset.view;
    renderForecast();
  }));
  panel.querySelector('[data-act="year-prev"]')?.addEventListener('click', () => { forecastYear--; renderForecast(); });
  panel.querySelector('[data-act="year-next"]')?.addEventListener('click', () => { forecastYear++; renderForecast(); });

  if (isAdmin) {
    panel.querySelector('#new-forecast-y')?.addEventListener('click', () => forecastModal(null));
    panel.querySelectorAll('tr.clickable[data-idx]').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      forecastModal(parseInt(tr.dataset.idx));
    }));
  }
}

function forecastModalV3(idx = null) {
  ensureForecast();
  const it = idx !== null ? state.forecast[idx] : { label: '', category: 'Ostalo', amount: 0, validFrom: activeMonth, validTo: '', note: '', active: true };
  const allCats = Array.from(new Set([...FORECAST_CATEGORIES, ...(state.forecast || []).map(x => x.category).filter(Boolean)])).sort();
  const allLabels = Array.from(new Set((state.forecast || []).map(x => x.label).filter(Boolean))).sort();

  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} prognozu</div>
    <div class="modal-sub">Tekući trošak koji se ponavlja</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Naziv stavke</label>
        <input class="input" id="fc-label" list="fc-labels" value="${escapeHtml(it.label || '')}" placeholder="Npr. Porsche Leasing">
        <datalist id="fc-labels">${allLabels.map(l => `<option value="${escapeHtml(l)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">Kategorija</label>
        <input class="input" id="fc-category" list="fc-cats" value="${escapeHtml(it.category || '')}" placeholder="Npr. Leasing">
        <datalist id="fc-cats">${allCats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">Iznos mjesečno (€)</label>
        <input class="input num" id="fc-amount" type="text" inputmode="decimal" placeholder="0,00" value="${formatEUAmount(it.amount)}">
      </div>
      <div class="field">
        <label class="field-label">Vrijedi od (mjesec)</label>
        <input class="input" id="fc-from" type="month" value="${it.validFrom || ''}">
        <div class="field-hint">YYYY-MM. Prazno = oduvijek.</div>
      </div>
      <div class="field">
        <label class="field-label">Vrijedi do (mjesec)</label>
        <input class="input" id="fc-to" type="month" value="${it.validTo || ''}">
        <div class="field-hint">YYYY-MM. Prazno = otvoreno (neograničeno).</div>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Napomena (opcionalno)</label>
        <input class="input" id="fc-note" value="${escapeHtml(it.note || '')}" placeholder="Npr. Aneks ugovora od 1.10.2026.">
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
          <input type="checkbox" id="fc-active" ${it.active !== false ? 'checked' : ''} style="width: 18px; height: 18px;">
          <span>Stavka je aktivna (uključi u izračune)</span>
        </label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  attachEUAmountMask(m.root.querySelector('#fc-amount'));

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati ovu prognoznu stavku?')) {
        state.forecast.splice(idx, 1);
        if (await saveData()) { m.close(); renderForecast(); }
      }
    } else if (btn.dataset.act === 'save') {
      const label = m.root.querySelector('#fc-label').value.trim();
      const amount = parseEUAmount(m.root.querySelector('#fc-amount').value);
      if (!label) { toast('Unesi naziv stavke', 'error'); return; }
      if (!amount) { toast('Unesi iznos', 'error'); return; }
      const validFrom = m.root.querySelector('#fc-from').value || '';
      const validTo = m.root.querySelector('#fc-to').value || '';
      if (validFrom && validTo && validFrom > validTo) {
        toast('„Vrijedi od" mora biti prije „Vrijedi do"', 'error');
        return;
      }
      const newIt = {
        label,
        category: m.root.querySelector('#fc-category').value.trim() || 'Ostalo',
        amount,
        validFrom,
        validTo,
        note: m.root.querySelector('#fc-note').value.trim(),
        active: m.root.querySelector('#fc-active').checked,
      };
      if (idx !== null) state.forecast[idx] = newIt;
      else state.forecast.push(newIt);
      if (await saveData()) {
        m.close();
        renderForecast();
        toast(idx !== null ? 'Stavka ažurirana' : 'Stavka dodana', 'success');
      }
    }
  });
}

/* ============================================================
   BOOT
   ============================================================ */
/* ============================================================
   RENDER: RASPORED (plan tekucih i buducih projekata)
   ============================================================ */
let rasporedShowDone = false;

function rspDM(iso) {
  if (!iso) return '';
  const p = iso.split('-');
  if (p.length !== 3) return '';
  return `${+p[2]}.${+p[1]}.`;
}
function rspMonthLabel(iso, refYear) {
  const [y, m] = iso.split('-').map(Number);
  const lbl = MONTH_NAMES_HR[m - 1] || '';
  return (y !== refYear) ? `${lbl} ${y}` : lbl;
}
function rspStatus(it, todayISO) {
  if (!it.start && !it.end) return 'queued'; // bez termina — čeka slobodan termin
  if (it.end && it.end < todayISO) return 'done';
  if (it.start && it.start > todayISO) return 'upcoming';
  return 'active';
}

function renderRaspored() {
  const panel = document.getElementById('panel-raspored');
  if (!Array.isArray(state.raspored)) state.raspored = [];
  const items = state.raspored.slice();
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const refYear = now.getFullYear();

  const active = items.filter(it => rspStatus(it, todayISO) === 'active').sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const upcoming = items.filter(it => rspStatus(it, todayISO) === 'upcoming').sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const done = items.filter(it => rspStatus(it, todayISO) === 'done').sort((a, b) => (b.end || '').localeCompare(a.end || ''));
  const queued = items.filter(it => rspStatus(it, todayISO) === 'queued');

  const cardHTML = (it) => {
    const idx = state.raspored.indexOf(it);
    const st = rspStatus(it, todayISO);
    const dateText = st === 'active' ? `do ${rspDM(it.end)}` : `${rspDM(it.start)} – ${rspDM(it.end)}`;
    let chip = '';
    if (st === 'active') chip = '<span class="rsp-chip">u tijeku</span>';
    else if (it.confirmed === false) chip = '<span class="rsp-chip-o">okvirno</span>';
    else if (st === 'done') chip = '<span class="rsp-chip-o">završeno</span>';
    let prog = '';
    if (st === 'active' && it.start && it.end) {
      const s = new Date(it.start), e = new Date(it.end);
      let pct = (e > s) ? Math.round(((now - s) / (e - s)) * 100) : 100;
      pct = Math.max(0, Math.min(100, pct));
      prog = `<div class="rsp-prog"><span style="width:${pct}%"></span></div>`;
    }
    return `
      <div class="rsp-card ${st === 'active' ? 'active' : ''} ${isAdmin ? 'clickable' : ''}" ${isAdmin ? `data-idx="${idx}"` : ''}>
        <div>
          <span class="rsp-name">${escapeHtml(it.project || '')}</span>${it.desc ? `<span class="rsp-desc"> · ${escapeHtml(it.desc)}</span>` : ''}
          ${prog}
        </div>
        <div class="rsp-right">
          <span class="rsp-date">${dateText}</span>
          ${chip}
        </div>
      </div>`;
  };

  let body = '';
  if (active.length) {
    body += '<div class="rsp-sec">U tijeku</div>' + active.map(cardHTML).join('');
  }
  if (upcoming.length) {
    const monthSet = new Set();
    for (const it of upcoming) {
      if (!it.start || !it.end) continue;
      let [yy, mm] = it.start.split('-').map(Number);
      const endKey = it.end.slice(0, 7);
      for (let guard = 0; guard < 240; guard++) {
        const key = `${yy}-${String(mm).padStart(2, '0')}`;
        monthSet.add(key);
        if (key >= endKey) break;
        mm++; if (mm > 12) { mm = 1; yy++; }
      }
    }
    for (const mk of Array.from(monthSet).sort()) {
      const inMonth = upcoming
        .filter(it => it.start && it.end && it.start.slice(0, 7) <= mk && it.end.slice(0, 7) >= mk)
        .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      if (!inMonth.length) continue;
      body += `<div class="rsp-sec">${rspMonthLabel(mk + '-01', refYear)}</div>`;
      body += inMonth.map(cardHTML).join('');
    }
  }
  if (!active.length && !upcoming.length) {
    if (queued.length) {
      body += `<div class="rsp-empty">Nema projekata s terminom.${isAdmin ? ' Dodijeli termin projektu s liste „Za ubaciti" ili dodaj novi.' : ''}</div>`;
    } else {
      body += `<div class="rsp-empty">${isAdmin ? 'Još nema planiranih projekata. Klikni „Dodaj projekt" za prvi unos.' : 'Još nema planiranih projekata.'}</div>`;
    }
  }
  if (done.length) {
    const pts = rasporedShowDone ? '18 15 12 9 6 15' : '6 9 12 15 18 9';
    body += `<button class="rsp-done-toggle" id="rsp-done-toggle">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${pts}"/></svg>
      Završeni projekti (${done.length})
    </button>`;
    if (rasporedShowDone) body += done.map(cardHTML).join('');
  }

  // ----- "Za ubaciti" — projekti bez termina (popunjavanje rupa u rasporedu) -----
  const queuedCardHTML = (it) => {
    const idx = state.raspored.indexOf(it);
    return `
      <div class="rsp-card rsp-queued ${isAdmin ? 'clickable' : ''}" ${isAdmin ? `data-idx="${idx}"` : ''}>
        <div>
          <span class="rsp-name">${escapeHtml(it.project || '')}</span>${it.desc ? `<span class="rsp-desc"> · ${escapeHtml(it.desc)}</span>` : ''}
        </div>
        <div class="rsp-right">
          ${it.confirmed === false ? '<span class="rsp-chip-o">okvirno</span>' : ''}
          <span class="rsp-chip-q">čeka termin</span>
        </div>
      </div>`;
  };

  const showAside = queued.length > 0 || isAdmin;
  const asideHTML = showAside ? `
    <aside class="rsp-aside">
      <div class="rsp-aside-card">
        <div class="rsp-aside-title">
          <span>Za ubaciti</span>
          <button class="rsp-aside-add admin-only" id="rsp-add-queued" title="Dodaj projekt bez termina" aria-label="Dodaj projekt bez termina">+</button>
        </div>
        ${queued.length
          ? queued.map(queuedCardHTML).join('')
          : `<div class="rsp-aside-empty">Nema projekata na čekanju.</div>`}
        <div class="rsp-aside-hint">Projekti bez datuma — ubaci ih kad se otvori rupa u rasporedu.</div>
      </div>
    </aside>` : '';

  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">Plan radova</div>
        <h1 class="page-title">Raspored <em>projekata</em></h1>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary admin-only" id="rsp-add">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Dodaj projekt
        </button>
      </div>
    </div>
    ${showAside ? `<div class="rsp-layout"><div class="rsp-main">${body}</div>${asideHTML}</div>` : body}
  `;

  panel.querySelector('#rsp-done-toggle')?.addEventListener('click', () => { rasporedShowDone = !rasporedShowDone; renderRaspored(); });
  if (isAdmin) {
    panel.querySelector('#rsp-add')?.addEventListener('click', () => rasporedModal(null));
    panel.querySelector('#rsp-add-queued')?.addEventListener('click', () => rasporedModal(null, 'queued'));
    panel.querySelectorAll('.rsp-card.clickable[data-idx]').forEach(c => c.addEventListener('click', () => rasporedModal(parseInt(c.dataset.idx))));
  }
}

function rasporedModal(idx = null, presetMode = null) {
  if (!Array.isArray(state.raspored)) state.raspored = [];
  const it = idx !== null ? state.raspored[idx] : { project: '', desc: '', start: '', end: '', confirmed: true };
  // 'dated' = ima termin · 'queued' = bez termina (lista "Za ubaciti")
  let mode = (presetMode === 'queued' || (idx !== null && !it.start && !it.end)) ? 'queued' : 'dated';
  const names = Array.from(new Set([
    ...allMonths().flatMap(k => (state.sto[k] || []).map(x => x.project)),
    ...allMonths().flatMap(k => (state.hours[k]?.days || []).flatMap(d => Object.values(d.workers || {}).map(w => w.project))),
    ...(state.raspored || []).map(x => x.project),
  ].filter(Boolean).map(s => String(s).trim()))).sort();

  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Novi'} projekt</div>
    <div class="modal-sub">Planirani termin radova</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Naziv projekta</label>
        <input class="input" id="r-name" list="r-names" value="${escapeHtml(it.project || '')}" placeholder="Npr. Bivio">
        <datalist id="r-names">${names.map(n => `<option value="${escapeHtml(n)}"></option>`).join('')}</datalist>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Opis posla (opcionalno)</label>
        <input class="input" id="r-desc" value="${escapeHtml(it.desc || '')}" placeholder="Npr. fasada, knauf, adaptacija">
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Termin</label>
        <div class="toggle" id="r-mode" style="align-self: flex-start;">
          <button type="button" data-mode="dated" class="${mode === 'dated' ? 'active' : ''}">S terminom</button>
          <button type="button" data-mode="queued" class="${mode === 'queued' ? 'active' : ''}">Bez termina · za ubaciti</button>
        </div>
        <div class="field-hint" id="r-mode-hint" ${mode === 'dated' ? 'hidden' : ''}>Projekt ide na listu „Za ubaciti" — termin dodijeliš kasnije klikom na projekt.</div>
      </div>
      <div class="field r-date-field" ${mode === 'queued' ? 'hidden' : ''}><label class="field-label">Planirani početak</label><input class="input" id="r-start" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(it.start)}"></div>
      <div class="field r-date-field" ${mode === 'queued' ? 'hidden' : ''}><label class="field-label">Planirani kraj</label><input class="input" id="r-end" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(it.end)}"></div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Status</label>
        <select class="select" id="r-status">
          <option value="potvrdeno" ${it.confirmed !== false ? 'selected' : ''}>Potvrđeno</option>
          <option value="okvirno" ${it.confirmed === false ? 'selected' : ''}>Okvirno</option>
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);

  // EU maska za datume (DD/MM/YYYY)
  attachEUDateMask(m.root.querySelector('#r-start'));
  attachEUDateMask(m.root.querySelector('#r-end'));

  // Toggle: s terminom / bez termina
  m.root.querySelectorAll('#r-mode button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    m.root.querySelectorAll('#r-mode button').forEach(x => x.classList.toggle('active', x === b));
    m.root.querySelectorAll('.r-date-field').forEach(f => { f.hidden = (mode === 'queued'); });
    const hint = m.root.querySelector('#r-mode-hint');
    if (hint) hint.hidden = (mode === 'dated');
  }));

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati ovaj projekt iz rasporeda?')) {
        state.raspored.splice(idx, 1);
        if (await saveData()) { m.close(); renderRaspored(); }
      }
    } else if (btn.dataset.act === 'save') {
      const project = m.root.querySelector('#r-name').value.trim();
      if (!project) { toast('Unesi naziv projekta', 'error'); return; }
      let start = '', end = '';
      if (mode === 'dated') {
        const startEl = m.root.querySelector('#r-start');
        const endEl = m.root.querySelector('#r-end');
        start = euToISO(startEl.value.trim());
        end = euToISO(endEl.value.trim());
        if (!start) { toast('Unesi datum početka (DD/MM/YYYY)', 'error'); startEl.classList.add('invalid'); startEl.focus(); return; }
        if (!end) { toast('Unesi datum kraja (DD/MM/YYYY)', 'error'); endEl.classList.add('invalid'); endEl.focus(); return; }
        if (start > end) { toast('Početak mora biti prije kraja', 'error'); return; }
      }
      const wasQueued = idx !== null && !it.start && !it.end;
      const newIt = {
        project,
        desc: m.root.querySelector('#r-desc').value.trim(),
        start, end,
        confirmed: m.root.querySelector('#r-status').value !== 'okvirno',
      };
      if (idx !== null) state.raspored[idx] = newIt;
      else state.raspored.push(newIt);
      if (await saveData()) {
        m.close();
        renderRaspored();
        if (idx === null && mode === 'queued') toast('Projekt dodan na listu „Za ubaciti"', 'success');
        else if (wasQueued && mode === 'dated') toast('Projekt uvršten u raspored', 'success');
        else toast(idx !== null ? 'Projekt ažuriran' : 'Projekt dodan', 'success');
      }
    }
  });
}

/* ============================================================
   RENDER: REGISTAR · evidencija firme
   Godišnji odmori + rokovi i podsjetnici (tehnički, liječnički…)
   ============================================================ */
let registarYear = new Date().getFullYear();

const REGISTAR_KATEGORIJE = ['Vozila', 'Liječnički', 'Zaštita na radu', 'Atesti i certifikati', 'Servis opreme', 'Osiguranje', 'Ugovori', 'Ostalo'];

function ensureRegistar() {
  if (!state.registar || typeof state.registar !== 'object') state.registar = {};
  if (!state.registar.godisnji || typeof state.registar.godisnji !== 'object') state.registar.godisnji = {};
  if (!Array.isArray(state.registar.rokovi)) state.registar.rokovi = [];
}

/* Broj dana do ISO datuma. Danas = 0, sutra = 1, jučer = -1. */
function daysUntilISO(iso) {
  if (!iso) return null;
  const p = String(iso).split('-').map(Number);
  if (p.length !== 3 || !p[0] || !p[1] || !p[2]) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(p[0], p[1] - 1, p[2]);
  return Math.round((b - a) / 86400000);
}

/* Broj radnih dana (pon-pet) između dva ISO datuma, uključivo. */
function radnihDana(odISO, doISO) {
  const p1 = String(odISO || '').split('-').map(Number);
  const p2 = String(doISO || '').split('-').map(Number);
  if (p1.length !== 3 || p2.length !== 3 || !p1[0] || !p2[0]) return 0;
  const a = new Date(p1[0], p1[1] - 1, p1[2]);
  const b = new Date(p2[0], p2[1] - 1, p2[2]);
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return 0;
  let n = 0;
  const cur = new Date(a);
  while (cur <= b) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) n++;
    cur.setDate(cur.getDate() + 1);
  }
  return n;
}

/* Status roka: isteklo / uskoro (unutar 30 dana) / ok / bez roka */
function rokStatus(item) {
  const du = daysUntilISO(item.rok);
  if (du === null) return { key: 'none', order: 3, du: null, pill: '<span class="pill gray">bez roka</span>' };
  if (du < 0) return { key: 'late', order: 0, du, pill: `<span class="pill red">isteklo prije ${Math.abs(du)} d</span>` };
  if (du === 0) return { key: 'soon', order: 1, du, pill: '<span class="pill amber">danas</span>' };
  if (du <= 30) return { key: 'soon', order: 1, du, pill: `<span class="pill amber">za ${du} d</span>` };
  return { key: 'ok', order: 2, du, pill: `<span class="pill green">za ${du} d</span>` };
}

function renderRegistar() {
  ensureRegistar();
  const gYearW = String(registarYear);
  const workers = (state.settings.workers || []).filter(w => {
    if (workerActiveInRange(w, `${gYearW}-01-01`, `${gYearW}-12-31`)) return true;
    const g = state.registar.godisnji[w.name];
    return !!g && (g.periodi || []).some(p => (p.od ? p.od.slice(0, 4) === gYearW : String(p.godina || '') === gYearW));
  });
  const rokovi = state.registar.rokovi.map((r, i) => ({ ...r, _idx: i }));
  const sorted = rokovi.slice().sort((a, b) => {
    const sa = rokStatus(a), sb = rokStatus(b);
    if (sa.order !== sb.order) return sa.order - sb.order;
    return (a.rok || '9999-12-31').localeCompare(b.rok || '9999-12-31');
  });
  const nSoon = rokovi.filter(r => rokStatus(r).key === 'soon').length;
  const next = sorted.find(r => r.rok && rokStatus(r).key !== 'late');

  // Godišnji za odabranu godinu (period se broji u godinu u kojoj počinje)
  const gYear = String(registarYear);
  const gRows = workers.map(w => {
    const g = state.registar.godisnji[w.name] || { ukupno: 0, periodi: [] };
    const periodi = (g.periodi || [])
      .filter(p => p.od ? p.od.slice(0, 4) === gYear : String(p.godina || '') === gYear)
      .slice().sort((a, b) => (a.od || `${a.godina || '0000'}-00-00`).localeCompare(b.od || `${b.godina || '0000'}-00-00`));
    const iskoristeno = periodi.reduce((a, p) => a + (Number(p.dana) || 0), 0);
    const ukupno = Number(g.ukupno) || 0;
    return { name: w.name, ukupno, iskoristeno, preostalo: ukupno - iskoristeno, periodi, rub: workerYearEdges(w, gYear) };
  });

  const panel = document.getElementById('panel-registar');
  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">Evidencija firme · rokovi i godišnji</div>
        <h1 class="page-title">Registar <em>firme</em></h1>
      </div>
      <div class="page-actions">
        ${isAdmin ? `<button class="btn btn-primary" id="reg-add-rok">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Novi rok
        </button>` : ''}
      </div>
    </div>

    <div class="kpi-row" style="margin-bottom: 24px;">
      <div class="kpi-cell">
        <div class="stat-label">Unutar 30 dana</div>
        <div class="stat-value">${nSoon}</div>
        <div class="stat-sub">uskoro na redu</div>
      </div>
      <div class="kpi-cell">
        <div class="stat-label">Sljedeći rok</div>
        <div class="stat-value">${next ? isoToEU(next.rok) : '—'}</div>
        <div class="stat-sub">${next ? escapeHtml(next.naziv || '') : 'ništa na čekanju'}</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Rokovi i podsjetnici</div>
          <div class="card-sub">Tehnički pregledi, liječnički, atesti, servisi, osiguranja i sve što ističe · crveno = isteklo, žuto = unutar 30 dana${isAdmin ? ' · klikni red za uređivanje' : ''}</div>
        </div>
      </div>
      ${rokovi.length === 0 ? `
        <div class="empty">
          <div class="empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          Još nema unesenih rokova.<br>
          ${isAdmin ? 'Klikni „Novi rok" i dodaj npr. tehnički pregled, liječnički, atest skele…' : 'Admin ih dodaje preko gumba „Novi rok".'}
        </div>
      ` : `
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Stavka</th>
              <th>Kategorija</th>
              <th>Zadnje obavljeno</th>
              <th>Sljedeći rok</th>
              <th>Napomena</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${sorted.map(r => {
              const st = rokStatus(r);
              return `
              <tr class="rok-row ${isAdmin ? 'clickable' : ''}" data-idx="${r._idx}">
                <td>${st.pill}</td>
                <td><strong>${escapeHtml(r.naziv || '')}</strong></td>
                <td>${r.kategorija ? `<span class="pill gray">${escapeHtml(r.kategorija)}</span>` : '<span style="color: var(--muted-2);">—</span>'}</td>
                <td class="col-date num">${r.zadnje ? isoToEU(r.zadnje) : '<span style="color: var(--muted-2);">—</span>'}</td>
                <td class="col-date num" style="font-weight: 600;">${r.rok ? isoToEU(r.rok) : '<span style="color: var(--muted-2);">—</span>'}</td>
                <td style="color: var(--muted); font-size: 13px;">${escapeHtml(r.note || '')}</td>
                ${isAdmin ? `<td class="text-right">
                  <button class="btn btn-ghost btn-sm" data-edit-rok="${r._idx}" title="Uredi">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                </td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      `}
    </div>

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Godišnji odmori · ${registarYear}</div>
          <div class="card-sub">Iskorišteno se zbraja iz perioda koji počinju u ${registarYear}.${isAdmin ? ' · klikni radnika za kvotu i periode' : ''}</div>
        </div>
        <div class="page-actions">
          <span class="pill gray">Iskorišteno: <strong style="margin-left: 4px;">${gRows.reduce((a, r) => a + r.iskoristeno, 0)} / ${gRows.reduce((a, r) => a + r.ukupno, 0)} dana</strong></span>
          <div class="month-picker">
            <button data-act="reg-year-prev" aria-label="Prethodna godina">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span class="month-label">${registarYear}</span>
            <button data-act="reg-year-next" aria-label="Sljedeća godina">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Radnik</th>
              <th class="text-right">Ukupno dana</th>
              <th class="text-right">Iskorišteno</th>
              <th class="text-right">Preostalo</th>
              <th>Periodi</th>
            </tr>
          </thead>
          <tbody>
            ${gRows.length === 0 ? `<tr><td colspan="5" style="text-align: center; padding: 32px 12px; color: var(--muted);">Nema radnika u Postavkama.</td></tr>` : gRows.map(r => `
              <tr class="god-row ${isAdmin ? 'clickable' : ''}" data-worker="${escapeHtml(r.name)}">
                <td><strong>${escapeHtml(r.name)}</strong>${(r.rub.od || r.rub.do) ? `<span class="pill amber" style="margin-left: 8px;">${[r.rub.od ? 'od ' + isoToEU(r.rub.od) : '', r.rub.do ? 'do ' + isoToEU(r.rub.do) : ''].filter(Boolean).join(' ')}</span>` : ''}</td>
                <td class="num text-right">${r.ukupno ? r.ukupno : '<span style="color: var(--muted-2);">—</span>'}</td>
                <td class="num text-right" style="font-weight: 600;">${r.iskoristeno}</td>
                <td class="num text-right" style="font-weight: 600; color: ${r.ukupno ? (r.preostalo < 0 ? 'var(--negative)' : 'var(--positive)') : 'var(--muted-2)'};">${r.ukupno ? r.preostalo : '—'}</td>
                <td>${r.periodi.length
                  ? r.periodi.map(p => `<span class="per-chip" title="${escapeHtml(p.note || '')}">${p.od ? `${isoToEU(p.od).slice(0, 5)}–${isoToEU(p.do).slice(0, 5)} · ` : ''}${p.dana} d${p.note ? ' · ' + escapeHtml(p.note) : ''}</span>`).join('')
                  : '<span style="color: var(--muted-2); font-size: 12px;">bez unosa</span>'}</td>
              </tr>`).join('')}
          </tbody>
          ${gRows.length ? `<tfoot>
            <tr>
              <td>UKUPNO</td>
              <td class="num text-right"><strong>${gRows.reduce((a, r) => a + r.ukupno, 0)}</strong></td>
              <td class="num text-right"><strong>${gRows.reduce((a, r) => a + r.iskoristeno, 0)}</strong></td>
              <td class="num text-right"><strong>${gRows.reduce((a, r) => a + (r.ukupno ? r.preostalo : 0), 0)}</strong></td>
              <td></td>
            </tr>
          </tfoot>` : ''}
        </table>
      </div>
    </div>
  `;

  panel.querySelector('[data-act="reg-year-prev"]')?.addEventListener('click', () => { registarYear--; renderRegistar(); });
  panel.querySelector('[data-act="reg-year-next"]')?.addEventListener('click', () => { registarYear++; renderRegistar(); });

  if (isAdmin) {
    panel.querySelector('#reg-add-rok')?.addEventListener('click', () => rokModal(null));
    panel.querySelectorAll('[data-edit-rok]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      rokModal(parseInt(b.dataset.editRok));
    }));
    panel.querySelectorAll('tr.rok-row.clickable').forEach(tr => tr.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      rokModal(parseInt(tr.dataset.idx));
    }));
    panel.querySelectorAll('tr.god-row.clickable').forEach(tr => tr.addEventListener('click', () => {
      godisnjiModal(tr.dataset.worker);
    }));
  }
}

/* Modal: rok / podsjetnik */
function rokModal(idx = null) {
  ensureRegistar();
  const r = idx !== null ? state.registar.rokovi[idx] : { naziv: '', kategorija: '', zadnje: '', rok: '', note: '' };
  if (!r) return;
  const cats = Array.from(new Set([...REGISTAR_KATEGORIJE, ...state.registar.rokovi.map(x => x.kategorija).filter(Boolean)])).sort();
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Novi'} rok</div>
    <div class="modal-sub">Npr. tehnički pregled za vozilo, liječnički, atest, servis, polica osiguranja…</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Naziv stavke</label>
        <input class="input" id="rk-naziv" value="${escapeHtml(r.naziv || '')}" placeholder="Npr. Tehnički pregled · Caddy">
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Kategorija</label>
        <input class="input" id="rk-kat" list="rk-cats" value="${escapeHtml(r.kategorija || '')}" placeholder="Npr. Vozila">
        <datalist id="rk-cats">${cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">Zadnje obavljeno</label>
        <input class="input" id="rk-zadnje" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(r.zadnje || '')}">
        <div class="field-hint">Opcionalno.</div>
      </div>
      <div class="field">
        <label class="field-label">Sljedeći rok</label>
        <input class="input" id="rk-rok" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(r.rok || '')}">
        <div class="field-hint">Datum do kojeg treba obaviti.</div>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Napomena (opcionalno)</label>
        <input class="input" id="rk-note" value="${escapeHtml(r.note || '')}" placeholder="Npr. registracija, ime doktora, broj police…">
      </div>
    </div>
    <div class="modal-actions" style="justify-content: space-between;">
      <button class="btn" data-act="done-today" title="Upiši današnji datum u Zadnje obavljeno">Obavljeno danas</button>
      <div style="display: flex; gap: 8px;">
        <button class="btn" data-act="cancel">Odustani</button>
        ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
        <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
      </div>
    </div>
  `;
  const m = modal(html);
  attachEUDateMask(m.root.querySelector('#rk-zadnje'));
  attachEUDateMask(m.root.querySelector('#rk-rok'));
  setTimeout(() => m.root.querySelector('#rk-naziv')?.focus(), 50);

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'done-today') {
      const t = new Date();
      const eu = `${String(t.getDate()).padStart(2, '0')}/${String(t.getMonth() + 1).padStart(2, '0')}/${t.getFullYear()}`;
      const inp = m.root.querySelector('#rk-zadnje');
      inp.value = eu;
      inp.classList.remove('invalid');
      toast('Upisano: obavljeno danas · upiši još novi „Sljedeći rok"', '', 3000);
    }
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati ovaj rok iz registra?')) {
        state.registar.rokovi.splice(idx, 1);
        if (await saveData()) { m.close(); renderRegistar(); }
      }
    } else if (btn.dataset.act === 'save') {
      const naziv = m.root.querySelector('#rk-naziv').value.trim();
      if (!naziv) { toast('Unesi naziv stavke', 'error'); return; }
      const zadnjeEU = m.root.querySelector('#rk-zadnje').value.trim();
      const rokEU = m.root.querySelector('#rk-rok').value.trim();
      const zadnje = zadnjeEU ? euToISO(zadnjeEU) : '';
      const rok = rokEU ? euToISO(rokEU) : '';
      if (zadnjeEU && !zadnje) { toast('„Zadnje obavljeno" mora biti DD/MM/YYYY', 'error'); return; }
      if (rokEU && !rok) { toast('„Sljedeći rok" mora biti DD/MM/YYYY', 'error'); return; }
      const newR = {
        naziv,
        kategorija: m.root.querySelector('#rk-kat').value.trim(),
        zadnje,
        rok,
        note: m.root.querySelector('#rk-note').value.trim(),
      };
      if (idx !== null) state.registar.rokovi[idx] = newR;
      else state.registar.rokovi.push(newR);
      if (await saveData()) {
        m.close();
        renderRegistar();
        toast(idx !== null ? 'Rok ažuriran' : 'Rok dodan', 'success');
      }
    }
  });
}

/* Modal: godišnji odmor radnika (kvota + periodi) */
function godisnjiModal(workerName) {
  ensureRegistar();
  const cur = state.registar.godisnji[workerName] || { ukupno: 0, periodi: [] };
  const draft = (cur.periodi || []).map(p => ({ ...p }));

  const rowHTML = (p) => `
    <div class="god-period-row" data-godina="${p.godina || ''}">
      <input class="input gp-od" type="text" inputmode="numeric" placeholder="Od DD/MM/YYYY" maxlength="10" value="${isoToEU(p.od || '')}">
      <input class="input gp-do" type="text" inputmode="numeric" placeholder="Do DD/MM/YYYY" maxlength="10" value="${isoToEU(p.do || '')}">
      <input class="input gp-dana num" type="number" step="0.5" min="0" placeholder="Dana" value="${p.dana ?? ''}" title="Broj dana godišnjeg · auto se popuni kao radni dani (pon-pet), možeš ručno ispraviti">
      <input class="input gp-note" value="${escapeHtml(p.note || '')}" placeholder="Napomena (opcionalno)">
      <button class="btn btn-ghost btn-sm btn-danger gp-del" title="Obriši period" aria-label="Obriši period">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
      </button>
    </div>`;

  const html = `
    <div class="modal-title">Godišnji · ${escapeHtml(workerName)}</div>
    <div class="modal-sub">Kvota i periodi. Datumi su opcionalni: možeš unijeti i samo broj dana bez perioda, takav unos se broji u ${registarYear}. Kad upišeš raspon, „Dana" se sam izračuna kao radni dani (pon-pet) i možeš ga ručno ispraviti.</div>
    <div class="field" style="max-width: 240px;">
      <label class="field-label">Ukupno dana godišnje (kvota)</label>
      <input class="input num" id="god-ukupno" type="number" step="1" min="0" value="${Number(cur.ukupno) || 0}">
    </div>
    <div class="field-label" style="margin: 16px 0 8px;">Periodi godišnjeg</div>
    <div id="god-rows">${draft.map(rowHTML).join('')}</div>
    ${draft.length === 0 ? '<div id="god-empty" style="font-size: 13px; color: var(--muted); margin: 4px 0 8px;">Još nema unesenih perioda.</div>' : ''}
    <button class="btn" id="god-add" style="margin-top: 8px;">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Dodaj period
    </button>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  setTimeout(() => m.root.querySelector('#god-ukupno')?.focus(), 50);

  const wireRow = (row) => {
    const od = row.querySelector('.gp-od');
    const doInp = row.querySelector('.gp-do');
    const dana = row.querySelector('.gp-dana');
    attachEUDateMask(od);
    attachEUDateMask(doInp);
    const autoDana = () => {
      const a = euToISO(od.value.trim());
      const b = euToISO(doInp.value.trim());
      if (a && b && !dana.value) {
        const n = radnihDana(a, b);
        if (n > 0) dana.value = n;
      }
    };
    od.addEventListener('blur', autoDana);
    doInp.addEventListener('blur', autoDana);
    row.querySelector('.gp-del').addEventListener('click', () => row.remove());
  };
  m.root.querySelectorAll('.god-period-row').forEach(wireRow);

  m.root.querySelector('#god-add').addEventListener('click', () => {
    m.root.querySelector('#god-empty')?.remove();
    const wrap = m.root.querySelector('#god-rows');
    const holder = document.createElement('div');
    holder.innerHTML = rowHTML({ od: '', do: '', dana: '', note: '' });
    const row = holder.firstElementChild;
    wrap.appendChild(row);
    wireRow(row);
    row.querySelector('.gp-od').focus();
  });

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'save') {
      const rows = Array.from(m.root.querySelectorAll('.god-period-row'));
      const periodi = [];
      for (const row of rows) {
        const odEU = row.querySelector('.gp-od').value.trim();
        const doEU = row.querySelector('.gp-do').value.trim();
        const note = row.querySelector('.gp-note').value.trim();
        const danaVal = parseFloat(row.querySelector('.gp-dana').value);
        if (!odEU && !doEU && !note && !(danaVal > 0)) continue;
        if (!odEU && !doEU) {
          // Unos bez perioda: samo broj dana (+ opcionalna napomena), broji se u odabranu godinu
          if (!(danaVal > 0)) { toast('Unos bez datuma treba broj dana veći od 0', 'error'); return; }
          const godina = parseInt(row.dataset.godina) || registarYear;
          periodi.push({ od: '', do: '', dana: danaVal, note, godina });
          continue;
        }
        const od = euToISO(odEU);
        const doISO = euToISO(doEU);
        if (!od || !doISO) { toast('Period treba i „Od" i „Do" (DD/MM/YYYY), ili oba prazna uz samo broj dana', 'error'); return; }
        if (doISO < od) { toast('„Do" ne može biti prije „Od"', 'error'); return; }
        const dana = danaVal > 0 ? danaVal : radnihDana(od, doISO);
        periodi.push({ od, do: doISO, dana, note });
      }
      periodi.sort((a, b) => (a.od || `${a.godina || '0000'}-00-00`).localeCompare(b.od || `${b.godina || '0000'}-00-00`));
      state.registar.godisnji[workerName] = {
        ukupno: parseFloat(m.root.querySelector('#god-ukupno').value) || 0,
        periodi,
      };
      if (await saveData()) {
        m.close();
        renderRegistar();
        toast('Godišnji ažuriran', 'success');
      }
    }
  });
}


/* Modal (v4): kao modalV3, uz opts.xl (široki pregled) i opts.sticky (klik izvan ne zatvara,
   Escape pita prije zatvaranja). Zatvoren modal više ne sluša Escape. */
function modal(html, opts = {}) {
  const mount = document.getElementById('modalMount');
  mount.innerHTML = `<div class="modal-backdrop"><div class="modal ${opts.xl ? 'modal-xl' : (opts.wide ? 'modal-wide' : '')}">${html}</div></div>`;
  const backdrop = mount.querySelector('.modal-backdrop');
  let open = true;
  const esc = (e) => {
    if (e.key !== 'Escape' || !open) return;
    if (opts.sticky && !confirm('Zatvoriti bez spremanja?')) return;
    close();
  };
  const close = () => {
    if (!open) return;
    open = false;
    document.removeEventListener('keydown', esc);
    if (mount.contains(backdrop)) mount.innerHTML = '';
    if (opts.onClose) opts.onClose();
  };
  backdrop.addEventListener('click', e => { if (e.target === backdrop && !opts.sticky) close(); });
  document.addEventListener('keydown', esc);
  return { close, root: backdrop };
}

/* CSS za v4 (PDV na projektima, troškovi firme, ponavljajući troškovi) · iz app.js da deploy ostane jedan file */
function injectV4Css() {
  if (document.getElementById('sr-v4-css')) return;
  const st = document.createElement('style');
  st.id = 'sr-v4-css';
  st.textContent = `
    .modal-backdrop { overflow-y: auto; grid-template-columns: minmax(0, 1fr); }
    #panel-projects .grid > * { min-width: 0; }
    .modal-actions { flex-wrap: wrap; }
    .modal.modal-xl { max-width: 1180px; }
    .v4-eyebrow { font-size: 11px; font-weight: 500; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
    .v4-sub { font-size: 12px; color: var(--muted); margin-top: 2px; font-weight: 400; font-family: var(--font-body); white-space: normal; }
    .v4-note { font-size: 13.5px; color: var(--ink-2); background: var(--surface-2); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
    .pill.pdv25 { background: var(--acc-cashflow-soft); color: var(--acc-cashflow); }
    .pill.ppo { background: var(--acc-forecast-soft); color: var(--acc-forecast); }

    /* PDV na uplatama (detalj projekta) */
    .v4-pdv { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-lg); padding: 18px 22px; margin-bottom: 20px; }
    .v4-pdv.treba { background: #fbf6e8; border-color: #e3d3a4; }
    .v4-pdv.treba .v4-eyebrow { color: #7a5c10; }
    .v4-pdv-txt { min-width: 0; flex: 1 1 320px; }
    .v4-pdv-sub { font-size: 14px; color: var(--ink-2); margin-top: 4px; }
    .toggle.v4-toggle { flex-wrap: wrap; }
    .toggle.v4-toggle button { min-height: 44px; padding: 10px 18px; font-size: 13.5px; }
    .toggle.v4-toggle button:disabled { cursor: default; }
    .kpi-cell.v4-amber { background: #fbf6e8; }
    .kpi-cell.v4-amber .stat-label, .kpi-cell.v4-amber .stat-value, .kpi-cell.v4-amber .stat-sub { color: #7a5c10; }
    .kpi-cell.v4-kpi-green { background: var(--positive-soft); }
    .kpi-cell.v4-kpi-green .stat-label, .kpi-cell.v4-kpi-green .stat-value, .kpi-cell.v4-kpi-green .stat-sub { color: var(--positive); }
    .kpi-cell.v4-kpi-red { background: var(--negative-soft); }
    .kpi-cell.v4-kpi-red .stat-label, .kpi-cell.v4-kpi-red .stat-value, .kpi-cell.v4-kpi-red .stat-sub { color: var(--negative); }

    /* Od prihoda do zarade, PDV na projektu */
    .v4-casc-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: baseline; padding: 11px 2px; border-bottom: 1px solid var(--line); font-size: 14px; }
    .v4-casc-row .v { font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; font-weight: 500; }
    .v4-casc-sub { display: block; color: var(--muted); font-size: 12.5px; margin-top: 2px; }
    .v4-casc-row.hl { padding: 13px 12px; margin: 4px 0; background: var(--surface-2); border-radius: 10px; border-bottom: none; font-size: 15px; font-weight: 600; }
    .v4-casc-row.hl .v { font-weight: 600; }
    .v4-casc-row.hl.pos { background: var(--positive-soft); color: var(--positive); }
    .v4-casc-row.hl.neg { background: var(--negative-soft); color: var(--negative); }
    .v4-casc-row.hl.amber { background: #fbf6e8; color: #7a5c10; }
    .v4-casc-row.hl.amber .v4-casc-sub { color: #7a5c10; }
    .v4-casc-row.tot { font-weight: 600; border-bottom: none; border-top: 2px solid var(--line-strong); padding-top: 13px; margin-top: 2px; }
    .v4-casc-row.tot .v { font-weight: 600; }

    /* Scenariji PDV-a */
    .card.v4-scen { display: flex; flex-direction: column; gap: 2px; }
    .v4-scen-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 6px 0; border-bottom: 1px solid var(--line); }
    .v4-scen-row .v { font-family: var(--font-mono); font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .v4-scen-note { font-size: 13px; padding-top: 8px; }
    .v4-scen-note.neg { color: var(--negative); }
    .v4-scen-note.pos { color: var(--positive); }
    .v4-hint { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; color: var(--ink-2); }
    .v4-hint:last-child { border-bottom: none; }
    .v4-hint .no { font-family: var(--font-mono); font-size: 12px; font-weight: 600; color: var(--muted); padding-top: 1px; }

    /* Tablice v4 */
    .table.v4-tbl th { padding: 10px 12px; }
    .table.v4-tbl td { padding: 11px 12px; vertical-align: top; }
    .table.v4-tbl td.num, #panel-projects .table td.num { white-space: nowrap; }
    .table.v4-tbl.v4-tight th, .table.v4-tbl.v4-tight td { padding-left: 8px; padding-right: 8px; }
    .table.v4-tbl.v4-tight td.num { font-size: 13px; }
    .table.v4-tbl.v4-tight td:first-child { min-width: 130px; }
    .v4-two { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; margin-bottom: 24px; }
    .v4-two > .card { min-width: 0; }
    .v4-two > .card:first-child { flex: 1.3 1 560px; }
    .v4-two > .card:last-child { flex: 1 1 420px; }
    .v4-x { color: var(--muted-2); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px; }
    .v4-x:hover { color: var(--negative); }
    .v4-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }

    /* Modali: radio kartice, izračun */
    .v4-opts { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
    .v4-opt { display: flex; align-items: flex-start; gap: 12px; width: 100%; min-height: 44px; padding: 11px 14px; text-align: left; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; cursor: pointer; font-family: inherit; transition: border-color .15s, background .15s; }
    .v4-opt:hover { border-color: var(--line-strong); }
    .v4-opt.on { border-color: var(--ink-2); background: var(--surface-2); }
    .v4-radio { width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--line-strong); flex-shrink: 0; margin-top: 2px; background: var(--surface); }
    .v4-opt.on .v4-radio { border: 5px solid var(--ink-2); }
    .v4-opt-txt { display: flex; flex-direction: column; min-width: 0; }
    .v4-opt-txt .t { font-size: 14px; font-weight: 500; color: var(--ink); }
    .v4-opt-txt .s { font-size: 12.5px; color: var(--muted); margin-top: 1px; }
    .v4-sum { margin-top: 14px; background: var(--surface-2); border-radius: 12px; padding: 12px 14px; }
    .v4-sum-row { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; padding: 4px 0; }
    .v4-sum-row > span:last-child { font-family: var(--font-mono); font-weight: 600; white-space: nowrap; }
    .v4-sum-row em { font-style: normal; color: var(--muted); }
    .v4-sum-row.tot { border-top: 1px solid var(--line-strong); margin-top: 4px; padding-top: 8px; font-weight: 600; }
    .v4-sum-note { font-size: 12.5px; color: var(--muted); border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; }
    .v4-pdvrow { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; margin-top: 16px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; }
    .v4-effect { margin-top: 14px; padding: 12px 14px; border-radius: 12px; font-size: 13.5px; background: var(--surface-2); color: var(--ink-2); }
    .v4-effect .t { font-weight: 600; margin-bottom: 2px; color: var(--ink); }
    .v4-effect.ok { background: var(--positive-soft); }
    .v4-effect.ok .t { color: var(--positive); }
    .v4-effect.warn { background: #fbf6e8; }
    .v4-effect.warn .t { color: #7a5c10; }

    /* Projekti · pregled */
    .v4-warn { background: #fbf6e8; border: 1px solid #e3d3a4; border-radius: var(--radius-lg); padding: 4px 18px; margin-bottom: 24px; }
    .v4-warn-row { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 12px 0; border-bottom: 1px solid #ecdfb8; font-size: 14px; color: var(--ink-2); }
    .v4-warn-row:last-child { border-bottom: none; }
    .v4-warn-row .btn { flex-shrink: 0; background: var(--surface); }
    .v4-ne { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
    .v4-ne > div { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
    .v4-ne strong { display: block; font-size: 14px; font-weight: 600; }
    .v4-ne span { display: block; font-size: 12.5px; color: var(--muted); margin-top: 3px; }

    @media (max-width: 760px) {
      .modal.modal-xl { padding: 20px 14px; max-width: 100%; }
      .v4-pdv { padding: 16px; }
      .toggle.v4-toggle { width: 100%; }
      .toggle.v4-toggle button { flex: 1 1 auto; padding: 10px 12px; }
      .v4-warn-row { flex-direction: column; align-items: flex-start; }
    }
  `;
  document.head.appendChild(st);
}

/* ============================================================
   v4 · PDV, TROŠKOVI FIRME, UVOZ IZVODA, PONAVLJAJUĆI TROŠKOVI
   Sve je dodano uz postojeće podatke. Nova polja su opcionalna
   (stari zapisi bez njih rade kao i prije) i ništa se ne briše.
   ============================================================ */

/* ---------- PDV na računima: iste opcije svuda u aplikaciji ---------- */
const PDV_PRESETS = {
  bez:  { stopa: 0,  odbitak: 0,   naziv: 'Bez PDV-a', kratko: 'bez PDV-a', vraca: 'ništa', sub: 'Podizvođač s prijenosom porezne obveze, banka, osiguranje, privatni najam', note: 'Na računu nema PDV-a, pa je cijeli iznos trošak.' },
  p25:  { stopa: 25, odbitak: 100, naziv: 'PDV 25 % · vraća se sve', kratko: '25 % · sve', vraca: 'sve', sub: 'Materijal, alat, usluge, telekom, Caddy (teretno vozilo N1)', note: 'Trošak = iznos ÷ 1,25. Cijeli PDV firma odbija od PDV-a koji duguje.' },
  p25h: { stopa: 25, odbitak: 50,  naziv: 'PDV 25 % · vraća se pola', kratko: '25 % · pola', vraca: 'pola', sub: 'Osobni automobil: gorivo, servis, gume, najam', note: 'Za osobne automobile zakon dopušta odbitak samo 50 % PDV-a. Trošak = iznos × 0,90.' },
  p13:  { stopa: 13, odbitak: 100, naziv: 'PDV 13 % · vraća se sve', kratko: '13 % · sve', vraca: 'sve', sub: 'Smještaj radnika u hotelu ili apartmanu, račun na firmu', note: 'Trošak = iznos ÷ 1,13.' },
  p0:   { stopa: 25, odbitak: 0,   naziv: 'PDV 25 % · ne vraća se', kratko: '25 % · ništa', vraca: 'ništa', sub: 'Reprezentacija (ručak, poklon), račun bez OIB-a firme', note: 'PDV je plaćen, ali se ne smije odbiti, pa je cijeli iznos trošak.' },
};
const PDV_ORDER = ['bez', 'p25', 'p25h', 'p13', 'p0'];
/* Račun (ukupno za platiti) → PDV na računu, koliko se vraća firmi i stvarni trošak */
function pdvSplit(gross, mode) {
  const P = PDV_PRESETS[mode] || PDV_PRESETS.bez;
  const a = Number(gross) || 0;
  const pdvRac = round2(a * P.stopa / (100 + P.stopa));
  const vraca = round2(pdvRac * P.odbitak / 100);
  return { racun: round2(a), pdvRac, vraca, trosak: round2(a - vraca) };
}

/* ---------- Normalizacija naziva (bez dijakritike, mala slova) ---------- */
const srNorm = (s) => String(s ?? '').toLowerCase().replace(/đ/g, 'd').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const srEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* Token: običan tekst traži se kao dio naziva; '=' ili kratki token (do 3 znaka) traži se kao cijela riječ */
function srMatchToken(normText, token) {
  let t = srNorm(token);
  if (!t || !normText) return false;
  let whole = false;
  if (t[0] === '=') { whole = true; t = t.slice(1).trim(); }
  if (!t) return false;
  if (whole || t.replace(/[^a-z0-9]/g, '').length <= 3) {
    return new RegExp('(^|[^a-z0-9])' + srEsc(t) + '($|[^a-z0-9])').test(normText);
  }
  return normText.includes(t);
}
const SR_STOP = new Set(['doo', 'd.o.o', 'dd', 'd.d', 'za', 'vl', 'obrt', 'usluge', 'usluga', 'trgovinu', 'trgovina', 'proizvodnju', 'gradenje', 'gradevinarstvo', 'drustvo', 'ograni', 'ogranicenom', 'odgovornoscu', 'rijeka', 'zagreb', 'zgrada', 'kartica', 'the', 'and']);
/* ---------- PDV pravila po partneru (Postavke) ----------
   match: tekstovi po kojima se partner prepoznaje u Troškovima
   pdv:   bez · p25 · p25h · p13 · p0 (vidi PDV_PRESETS)
   kamo:  rezija · projekt · ulaganje · ne (ne ide u projekte)
   partner: uobičajeni naziv partnera u Troškovima (ako je zadan)
   Sprema se u state.pdvPravila tek kad se prvi put nešto promijeni. */
const DEFAULT_PDV_PRAVILA = [
  { id: 'a1kontrol', naziv: 'A1 Kontrol Centar', sto: 'Procjena rizika', match: ['a1 kontrol'], pdv: 'p25', kamo: 'rezija', kat: 'Procjena rizika', grupa: 'Nepredviđeni', status: 'provjeriti', napomena: '1.018,75 € = 815,00 € + 25 %', vrsta: 'nepredvideni' },
  { id: 'pia', naziv: 'Porsche Inter Auto', sto: 'Servis vozila', match: ['porsche inter auto', 'pia rijeka'], pdv: 'p25h', kamo: 'rezija', kat: 'Servis vozila', grupa: 'Nepredviđeni', partner: 'Porsche Inter Auto', status: 'odluceno', napomena: 'Kao gorivo: pola za sve račune', vrsta: 'nepredvideni' },
  { id: 'porsche', naziv: 'Porsche Leasing', sto: 'Rata leasinga', match: ['porsche'], pdv: 'bez', kamo: 'rezija', kat: 'Leasing', grupa: 'Tekući', partner: 'Porsche', status: 'odluceno', napomena: 'Rata financijskog leasinga nema PDV-a. Učešće i otkup vozila su ulaganje.', vrsta: 'tekuci' },
  { id: 'adria', naziv: 'Adria Oil', sto: 'Gorivo', match: ['adria oil'], pdv: 'p25h', kamo: 'rezija', kat: 'Gorivo', grupa: 'Tekući', partner: 'Adria Oil', status: 'odluceno', napomena: 'Pola za sve račune, bez podjele po vozilu', vrsta: 'tekuci' },
  { id: 'stan', naziv: 'Stan · najam', sto: 'Smještaj radnika', match: ['=stan', 'rozic', 'zmaric'], pdv: 'bez', kamo: 'rezija', kat: 'Smještaj', grupa: 'Tekući', partner: 'Stan', status: 'zakon', napomena: 'Privatni najmodavci, plaća se početkom mjeseca za taj mjesec', vrsta: 'tekuci' },
  { id: 'jojo', naziv: 'Invoice, vl. Josip Bičanić (Jojo)', sto: 'Knjigovodstvo', match: ['jojo', 'invoice'], pdv: 'bez', kamo: 'rezija', kat: 'Knjigovodstvo', grupa: 'Tekući', partner: 'Jojo', status: 'provjeriti', napomena: 'Obrt, račun za prethodni mjesec. Ako se na računu pojavi PDV, pravilo je 25 % · sve', vrsta: 'tekuci' },
  { id: 'a1', naziv: 'A1 Hrvatska', sto: 'Telekom', match: ['=a1', 'a1 hrvatska'], pdv: 'p25', kamo: 'rezija', kat: 'Komunalije', grupa: 'Tekući', partner: 'A1', status: 'provjeriti', napomena: 'Račun glasi na firmu', vrsta: 'tekuci' },
  { id: 'ht', naziv: 'Hrvatski Telekom', sto: 'Telekom', match: ['hrvatski telekom', '=ht', '328,41'], pdv: 'p25', kamo: 'rezija', kat: 'Komunalije', grupa: 'Tekući', partner: 'Hrvatski Telekom', status: 'provjeriti', napomena: 'Do svibnja 2026, zatim A1', vrsta: 'tekuci' },
  { id: 'pondi', naziv: 'Pondi', sto: 'e-poslovanje', match: ['pondi'], pdv: 'p25', kamo: 'rezija', kat: 'e-poslovanje', grupa: 'Tekući', partner: 'Pondi', status: 'provjeriti', napomena: '5,00 € mjesečno', vrsta: 'tekuci' },
  { id: 'hrt', naziv: 'HRT', sto: 'Pristojba', match: ['=hrt'], pdv: 'bez', kamo: 'rezija', kat: 'Komunalije', grupa: 'Tekući', partner: 'HRT', status: 'zakon', napomena: 'Pristojba nema PDV-a', vrsta: 'tekuci' },
  { id: 'generali', naziv: 'Generali Osiguranje', sto: 'Osiguranje', match: ['generali'], pdv: 'bez', kamo: 'rezija', kat: 'Osiguranje', grupa: 'Tekući', partner: 'Generali Osiguranje', status: 'zakon', napomena: 'Osiguranje je oslobođeno PDV-a', vrsta: 'tekuci' },
  { id: 'pbz', naziv: 'PBZ', sto: 'Kamate i naknade', match: ['=pbz', 'privredna banka'], pdv: 'bez', kamo: 'rezija', kat: 'Bankovne naknade', grupa: 'Tekući', partner: 'PBZ', status: 'zakon', napomena: 'Bankovne usluge oslobođene su PDV-a. Rata kredita ne ulazi u režiju.', vrsta: 'tekuci' },
  { id: 'porezna', naziv: 'Porezna uprava', sto: 'PDV, porez na dobit', match: ['porezna', 'ministarstvo financija'], pdv: 'bez', kamo: 'ne', kat: 'Porez', grupa: 'Tekući', partner: 'Porezna uprava', status: 'zakon', napomena: 'Uplata PDV-a i akontacija poreza na dobit ne ulaze u režiju', vrsta: 'tekuci' },
  { id: 'operor', naziv: 'Operor Gradnja d.o.o.', sto: 'Podizvođač', match: ['operor'], pdv: 'bez', kamo: 'projekt', kat: 'Podizvođač', grupa: 'Nepredviđeni', partner: 'Operor Gradnja d.o.o.', status: 'odluceno', napomena: 'Prijenos porezne obveze. Ide na projekt na kojem je radio.', vrsta: 'nepredvideni' },
  { id: 'materijal', naziv: 'B.C. Commerce, Malin Promet, Jadran-Impex, Förch, Semmler, Oling, Vulkal', sto: 'Materijal', match: ['b.c. commerce', 'bc commerce', 'malin promet', 'jadran-impex', 'jadran impex', 'jadramp', 'forch', 'semmler', '=oling', '=orling', 'vulkal'], pdv: 'p25', kamo: 'rezija', kat: 'Materijal', grupa: 'Nepredviđeni', status: 'provjeriti', napomena: 'Na projekt kad je za jedno gradilište, inače režija', vrsta: 'nepredvideni' },
  { id: 'autoklub', naziv: 'Autoklub Rijeka, Auto Klub', sto: 'Tehnički pregled', match: ['auto klub', 'autoklub', 'akri stp', 'akr stp'], pdv: 'p25h', kamo: 'rezija', kat: 'Tehnički pregled', grupa: 'Nepredviđeni', status: 'provjeriti', napomena: 'Pristojbe na istom računu nemaju PDV', vrsta: 'nepredvideni' },
  { id: 'odvjetnik', naziv: 'Odvjetnik Toni Primorac', sto: 'Pravne usluge', match: ['primorac'], pdv: 'p25', kamo: 'rezija', kat: 'Pravne usluge', grupa: 'Nepredviđeni', status: 'provjeriti', napomena: '1.031,25 € = 825,00 € + 25 %', vrsta: 'nepredvideni' },
  { id: 'lijecnicki', naziv: 'PRO Vita, NZZJZ PGŽ', sto: 'Liječnički pregledi', match: ['pro vita', 'zavod za javno zdravstvo', 'nzzjz', 'zdravstvenu skrb'], pdv: 'bez', kamo: 'rezija', kat: 'Liječnički', grupa: 'Nepredviđeni', status: 'zakon', napomena: 'Zdravstvene usluge oslobođene su PDV-a', vrsta: 'nepredvideni' },
  { id: 'pristojbe', naziv: 'Državni proračun · pristojbe', sto: 'Dozvole, pristojbe', match: ['drzavni proracun'], pdv: 'bez', kamo: 'rezija', kat: 'Pristojbe', grupa: 'Nepredviđeni', partner: 'Državni proračun', status: 'zakon', napomena: 'Dozvole za boravak i rad, sudske pristojbe', vrsta: 'nepredvideni' },
];
const PRAVILO_STATUS = {
  odluceno: { naziv: 'Odlučeno', cls: 'green' },
  zakon: { naziv: 'Po zakonu', cls: 'gray' },
  provjeriti: { naziv: 'Provjeriti na računu', cls: 'amber' },
  odaberi: { naziv: 'Odaberi', cls: 'red' },
};
const KAMO_NAZIV = { rezija: 'režija', projekt: 'na projekt', ulaganje: 'ulaganje', ne: 'ne ide u projekte' };
function pdvPravila() {
  return (state && Array.isArray(state.pdvPravila) && state.pdvPravila.length) ? state.pdvPravila : DEFAULT_PDV_PRAVILA;
}
function praviloZaNaziv(name) {
  const n = srNorm(name);
  if (!n) return null;
  for (const r of pdvPravila()) {
    if (!r || r.active === false) continue;
    if ((r.match || []).some(tok => srMatchToken(n, tok))) return r;
  }
  return null;
}

/* ---------- Transakcija: PDV na računu i kamo ide trošak ---------- */
const TRX_NE_KATEGORIJE = new Set(['place', 'placa', 'pdv', 'porez', 'kredit', 'pozajmica', 'davanja', 'doprinosi', 'storno']);
function trxPdvMode(t) {
  if (t && PDV_PRESETS[t.pdv]) return { mode: t.pdv, izvor: 'racun' };
  const r = praviloZaNaziv(t && t.partner);
  if (r && PDV_PRESETS[r.pdv]) return { mode: r.pdv, izvor: 'pravilo', pravilo: r };
  return { mode: 'bez', izvor: 'nema' };
}
/* dest: rezija · projekt · projekt-bez (ide na projekt, ali projekt nije odabran) · ulaganje · ne · null (nije trošak) */
function trxDestInfo(t) {
  if (!t || t.type !== 'Trošak') return { dest: null };
  if (t.group !== 'Tekući' && t.group !== 'Nepredviđeni') return { dest: null };
  if (t.dest === 'projekt') return { dest: t.proj ? 'projekt' : 'projekt-bez', izvor: 'rucno' };
  if (t.dest === 'rezija' || t.dest === 'ulaganje' || t.dest === 'ne') return { dest: t.dest, izvor: 'rucno' };
  if (TRX_NE_KATEGORIJE.has(srNorm(t.category))) return { dest: 'ne', izvor: 'kategorija' };
  const r = praviloZaNaziv(t.partner);
  if (r && r.kamo) return { dest: r.kamo === 'projekt' ? 'projekt-bez' : r.kamo, izvor: 'pravilo', pravilo: r };
  return { dest: 'rezija', izvor: 'grupa' };
}
const monthIdx = (key) => { const [y, m] = String(key).split('-').map(Number); return y * 12 + (m - 1); };
const dayDiff = (a, b) => Math.round((new Date(a + 'T12:00:00') - new Date(b + 'T12:00:00')) / 86400000);

/* ---------- Ponavljajući troškovi iz Prognoze: plaćeno / očekivano / procjena ----------
   Ništa se ne upisuje samo od sebe: stavka iz Prognoze je "plaćena" kad u Troškovima
   tog mjeseca postoji transakcija istog partnera. */
function prognozaJePlaca(it) { return /plac|doprinos/.test(srNorm((it.category || '') + ' ' + (it.label || ''))); }
function prognozaJeProcjena(it) {
  const s = srNorm((it.category || '') + ' ' + (it.label || '') + ' ' + (it.note || ''));
  return /gorivo|telekom|bankovn|plac|doprinos|procjen|varira/.test(s);
}
function prognozaTokens(it) {
  if (it.partner && String(it.partner).trim()) return String(it.partner).split(',').map(s => s.trim()).filter(Boolean);
  const l = srNorm((it.label || '') + ' ' + (it.category || ''));
  const out = [];
  if (/porsche/.test(l)) out.push('porsche');
  if (/\bstan\b|smjestaj|najam/.test(l)) out.push('=stan', 'rozic', 'zmaric');
  if (/adria/.test(l)) out.push('adria oil');
  if (/hrvatski telekom|\bht\b/.test(l)) out.push('hrvatski telekom', '=ht', '328,41');
  if (/\ba1\b/.test(l)) out.push('=a1', 'a1 hrvatska');
  if (/jojo|knjigovod|invoice/.test(l)) out.push('jojo', 'invoice');
  if (/\bpbz\b/.test(l)) out.push('=pbz');
  if (/\bhrt\b/.test(l)) out.push('=hrt');
  if (/pondi/.test(l)) out.push('pondi');
  if (/generali|osiguran/.test(l)) out.push('generali');
  return out;
}
/* Pravilo koje odgovara stavci Prognoze (za PDV i za sparivanje s Troškovima) */
function prognozaPravilo(it) {
  const toks = prognozaTokens(it);
  for (const r of pdvPravila()) {
    if (!r || r.active === false) continue;
    if (toks.some(tok => (r.match || []).some(m => srNorm(m).replace(/^=/, '') === srNorm(tok).replace(/^=/, '')))) return r;
  }
  return null;
}
function prognozaStatusZaMjesec(key) {
  const items = forecastItemsForMonth(key);
  const curKey = todayISO().slice(0, 7);
  const trx = (state.trx[key] || []).filter(t => t && t.type === 'Trošak' && t.group !== 'Isključi');
  const used = new Set();
  const stavke = [];
  const placaItems = items.filter(prognozaJePlaca);
  for (const it of items.filter(x => !prognozaJePlaca(x))) {
    const toks = prognozaTokens(it);
    const pr = it.partner ? null : prognozaPravilo(it);
    const matched = trx.filter(t => {
      if (used.has(t)) return false;
      if (srNorm(t.category) === 'kredit') return false;
      if (pr) { const tr = praviloZaNaziv(t.partner); return !!tr && tr.id === pr.id; }
      const n = srNorm(t.partner);
      return toks.some(tok => srMatchToken(n, tok));
    });
    matched.forEach(t => used.add(t));
    const placeno = round2(matched.reduce((a, t) => a + (Number(t.amount) || 0), 0));
    const status = matched.length ? 'placeno' : (key < curKey ? 'nema' : (prognozaJeProcjena(it) ? 'procjena' : 'ocekivano'));
    stavke.push({ it, matched, placeno, iznos: round2(Number(it.amount) || 0), status, pravilo: pr || praviloZaNaziv(it.label), placa: false, nepoznato: !toks.length });
  }
  if (placaItems.length) {
    const matched = trx.filter(trxJePlaca);
    const placeno = round2(matched.reduce((a, t) => a + (Number(t.amount) || 0), 0));
    const iznos = round2(placaItems.reduce((a, it) => a + (Number(it.amount) || 0), 0));
    const status = matched.length ? 'placeno' : (key < curKey ? 'nema' : 'procjena');
    stavke.push({ it: { label: 'Plaće i davanja', category: 'Plaće' }, items: placaItems, matched, placeno, iznos, status, pravilo: null, placa: true });
  }
  return { stavke, key };
}

/* ---------- Plaće za mjesec rada ----------
   Keš dio: „Za isplatu" iz Evidencije sati i stan, po radniku.
   Službeni dio (neto i davanja): Plaće iz Troškova (kategorija Plaće) upisane sljedeći mjesec,
   kad se isplaćuju; npr. isplata 11/08 je plaća za srpanj. Dok nisu upisane, uzimaju se stavke
   plaća iz Prognoze, a bez njih fiksno radnika i fiksni rad iz Postavki. */
const trxJePlaca = (t) => !!t && t.type === 'Trošak' && /^(place|placa|davanja|doprinosi)$/.test(srNorm(t.category));
function placeIzTroskova(key) {
  const list = (state.trx[addCalendarMonths(key, 1)] || []).filter(t => trxJePlaca(t) && t.group !== 'Isključi');
  return list.length ? round2(list.reduce((a, t) => a + (Number(t.amount) || 0), 0)) : null;
}
/* razmjerno: tekući mjesec ide razmjerno proteklim radnim danima (projekti); Cashflow uzima cijeli mjesec */
function placeZaMjesec(key, razmjerno = false) {
  const stats = computeWorkerStats(key) || [];
  const workers = state.settings.workers || [];
  const today = todayISO();
  const inProgress = key === today.slice(0, 7);
  let frac = 1;
  if (inProgress && razmjerno) {
    const total = workdaysInMonth(key);
    const done = workdaysInMonth(key, today);
    frac = total > 0 ? Math.max(done, 1) / total : 1;
  }
  let kes = 0, fiksno = 0;
  for (const st of stats) {
    const w = workers.find(x => x.name === st.name);
    const f = (inProgress && razmjerno) ? workerElapsedShare(w, key, today) : 1;
    kes += ((Number(st.zaIsplatu) || 0) + (Number(st.stan) || 0)) * f;
    fiksno += (Number(st.fiksno) || 0) * f;
  }
  let sluzbeno = inProgress ? null : placeIzTroskova(key);
  let izvor = 'troskovi';
  if (sluzbeno === null) {
    const fc = forecastItemsForMonth(key).filter(prognozaJePlaca);
    if (fc.length) {
      sluzbeno = fc.reduce((a, it) => a + (Number(it.amount) || 0), 0) * frac;
      izvor = 'prognoza';
    } else {
      const wNames = new Set(workers.map(w => srNorm(w.name)));
      const fiksniRad = getFixedLabor().filter(f => !wNames.has(srNorm(f.name))).reduce((a, f) => a + (Number(f.amount) || 0), 0);
      sluzbeno = fiksno + fiksniRad * frac;
      izvor = 'postavke';
    }
  }
  return { kes, sluzbeno, izvor, rad: kes + sluzbeno, frac, inProgress };
}

/* ---------- Režija mjeseca: fiksni troškovi bez plaća, bez PDV-a koji se vraća ---------- */
function rezijaZaMjesec(key) {
  const out = { bruto: 0, vraca: 0, stavke: [], ulaganja: 0, ulaganjaStavke: [], ocekivanoBruto: 0, ocekivanoVraca: 0, ocekivanoStavke: [] };
  for (const t of (state.trx[key] || [])) {
    if (trxDestInfo(t).dest !== 'rezija') continue;
    const pm = trxPdvMode(t);
    const s = pdvSplit(t.amount, pm.mode);
    out.bruto += s.racun; out.vraca += s.vraca;
    out.stavke.push({ t, ...s, mode: pm.mode });
  }
  const ki = monthIdx(key);
  for (const mk of Object.keys(state.trx || {})) {
    for (const t of (state.trx[mk] || [])) {
      if (trxDestInfo(t).dest !== 'ulaganje') continue;
      const n = Math.max(1, Math.round(Number(t.ulaganjeMj) || 60));
      const diff = ki - monthIdx(String(t.date || mk).slice(0, 7));
      if (diff < 0 || diff >= n) continue;
      const s = pdvSplit(t.amount, trxPdvMode(t).mode);
      out.ulaganja += s.trosak / n;
      out.ulaganjaStavke.push({ t, mjesecno: round2(s.trosak / n), n });
    }
  }
  if (key === todayISO().slice(0, 7)) {
    for (const x of prognozaStatusZaMjesec(key).stavke) {
      if (x.status === 'placeno' || x.placa || x.nepoznato) continue;
      const r = x.pravilo;
      if (r && r.kamo && r.kamo !== 'rezija') continue;
      const s = pdvSplit(x.iznos, r && PDV_PRESETS[r.pdv] ? r.pdv : 'bez');
      out.ocekivanoBruto += s.racun; out.ocekivanoVraca += s.vraca;
      out.ocekivanoStavke.push({ ...x, ...s });
    }
  }
  out.bruto = round2(out.bruto); out.vraca = round2(out.vraca); out.ulaganja = round2(out.ulaganja);
  out.ocekivanoBruto = round2(out.ocekivanoBruto); out.ocekivanoVraca = round2(out.ocekivanoVraca);
  out.ukBruto = round2(out.bruto + out.ulaganja + out.ocekivanoBruto);
  out.ukVraca = round2(out.vraca + out.ocekivanoVraca);
  out.neto = round2(out.ukBruto - out.ukVraca);
  return out;
}

/* Stvarni trošak mjeseca (v4):
   rad    = plaće za mjesec rada: keš isplate iz Evidencije i službene plaće (neto i davanja)
   režija = Tekući i Nepredviđeni troškovi koji nisu plaće, PDV, porez, kredit, pozajmica,
            ulaganje ni trošak projekta, umanjeni za PDV koji se vraća; ulaganja po mjesecima.
   Tekući kalendarski mjesec ide razmjerno proteklim radnim danima. */
function computeMonthCosts(key) {
  const pl = placeZaMjesec(key, true);
  const rz = rezijaZaMjesec(key);
  const frac = pl.frac;
  return {
    kes: pl.kes, sluzbeno: pl.sluzbeno, sluzbenoIzvor: pl.izvor, rad: pl.rad,
    rezBruto: rz.ukBruto * frac, rezVraca: rz.ukVraca * frac, rezija: rz.neto * frac,
    rez: rz, frac, inProgress: pl.inProgress,
  };
}

/* ---------- Cashflow: plaće se broje jednom ----------
   Stupac Radnici = plaće po mjesecu rada (keš isplate iz Evidencije i službene plaće).
   Plaće upisane u Troškovima su službeni dio tih istih plaća, pa se ne zbrajaju još jednom u Tekuće. */
function computeCashflowSummary() {
  const months = allMonths();
  const summary = {};
  for (const key of months) {
    const s = { prihodi: 0, tekuci: 0, nepredvideni: 0, pozajmica: 0, placeUTroskovima: 0 };
    for (const t of (state.trx[key] || [])) {
      if (t.group === 'Prihodi') s.prihodi += t.amount;
      else if (t.group === 'Tekući' || t.group === 'Nepredviđeni') {
        if (trxJePlaca(t)) { s.placeUTroskovima += Number(t.amount) || 0; continue; }
        if (t.group === 'Tekući') s.tekuci += t.amount;
        else s.nepredvideni += t.amount;
      }
    }
    s.sto = (state.sto[key] || []).reduce((a, t) => a + t.amount, 0);
    const pl = placeZaMjesec(key);
    s.radnici = pl.rad;
    s.radniciRazrada = pl;
    s.troskoviUkupno = s.tekuci + s.nepredvideni + s.sto + s.radnici;
    s.neto = s.prihodi - s.troskoviUkupno;
    summary[key] = s;
  }
  return summary;
}
function cashflowPlaceNapomenaHtml(summary, months) {
  const nabroji = (l) => l.length > 1 ? l.slice(0, -1).join(', ') + ' i ' + l[l.length - 1] : (l[0] || '');
  const mj = (l) => nabroji(l.map(k => monthLabelShort(k).toLowerCase()));
  const izv = (k) => (summary[k].radniciRazrada || {}).izvor;
  const prog = months.filter(k => izv(k) === 'prognoza');
  const post = months.filter(k => izv(k) === 'postavke');
  const dio = ['Radnici = plaće po mjesecu rada: keš isplate iz Evidencije sati i službene plaće (neto i davanja).',
    'Službene plaće uzimaju se iz Troškova (kategorija Plaće) upisanih sljedeći mjesec, kad se isplaćuju, pa se ne zbrajaju još jednom u Tekuće.'];
  if (prog.length) dio.push(`Za ${mj(prog)} plaće još nisu upisane, pa je uzet iznos plaća iz Prognoze.`);
  if (post.length) dio.push(`Za ${mj(post)} nema ni Prognoze, pa je uzeto fiksno radnika i fiksni rad iz Postavki.`);
  return `<div style="font-size: 12.5px; color: var(--muted); margin-top: 12px;">${escapeHtml(dio.join(' '))}</div>`;
}

/* ---------- Projekti: troškovi iz Troškova koji su stavljeni na projekt ---------- */
function trxNaProjektima() {
  const map = {};
  for (const mk of Object.keys(state.trx || {})) {
    (state.trx[mk] || []).forEach((t, i) => {
      if (trxDestInfo(t).dest !== 'projekt') return;
      (map[t.proj] = map[t.proj] || []).push({ t, mk, i });
    });
  }
  return map;
}
const srPrvaRijec = (name) => {
  const toks = srNorm(name).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !SR_STOP.has(w));
  return toks[0] || '';
};
/* Ručni trošak projekta (obračun): stari zapisi imaju samo iznos bez PDV-a */
function rucniTrosakInfo(r) {
  const mode = PDV_PRESETS[r.pdv] ? r.pdv : null;
  const trosak = round2(Number(r.amount) || 0);
  if (!mode) return { racun: trosak, vraca: 0, trosak, mode: null };
  const racun = round2(Number(r.iznosRacuna) || 0);
  const s = pdvSplit(racun, mode);
  return { racun, vraca: s.vraca, trosak, mode };
}
/* Uplata investitora: PDV na uplati (vlastiti izbor ili postavka projekta) */
function uplataInfo(u, rezimProjekta) {
  const vlastiti = (u.pdv === 'pdv25' || u.pdv === 'ppo') ? u.pdv : null;
  const mode = vlastiti || rezimProjekta || null;
  const a = round2(Number(u.amount) || 0);
  const osn = mode === 'pdv25' ? round2(a / 1.25) : (mode === 'ppo' ? a : null);
  return { amount: a, mode, vlastiti: !!vlastiti, osn, pdv: osn === null ? null : round2(a - osn) };
}

function computeProjectsData() {
  const map = {};
  const ensure = (name) => {
    if (!map[name]) map[name] = { name, materijal: 0, rad: 0, rez: 0, radKes: 0, radSluzbeno: 0, rezBruto: 0, rezVraca: 0, radIsplata: 0, sati: 0, months: {}, workers: {}, stoCount: 0, lastActivity: '', daysSet: new Set(), nepotpunSet: new Set(), inProgressSet: new Set(), procjenaSet: new Set() };
    return map[name];
  };
  const mEnsure = (p, k) => {
    if (!p.months[k]) p.months[k] = { materijal: 0, rad: 0, rez: 0, sati: 0, udio: 0 };
    return p.months[k];
  };
  const months = allMonths();
  const today = todayISO();
  const firma = {};

  for (const k of months) {
    for (const t of (state.sto[k] || [])) {
      const name = (t.project || '').trim() || PROJ_NONE;
      const p = ensure(name);
      p.materijal += t.amount;
      p.stoCount++;
      mEnsure(p, k).materijal += t.amount;
      if (k > p.lastActivity) p.lastActivity = k;
    }

    const projH = {};
    const projW = {};
    let satiOdradeni = 0;
    const h = state.hours[k];
    if (h && h.days) {
      for (const d of h.days) {
        for (const wName of Object.keys(d.workers || {})) {
          const wd = d.workers[wName];
          if (!wd || !(wd.hours > 0)) continue;
          const wAct = state.settings.workers.find(x => x.name === wName);
          if (wAct && !workerActiveOn(wAct, d.date)) continue;
          const name = (wd.project || '').trim() || PROJ_NONE;
          const pd = ensure(name);
          if (d.date) pd.daysSet.add(d.date);
          if (k > pd.lastActivity) pd.lastActivity = k;
          const w = state.settings.workers.find(x => x.name === wName);
          if (!w || !(w.satnica > 0)) continue;
          satiOdradeni += wd.hours;
          projH[name] = (projH[name] || 0) + wd.hours;
          if (!projW[name]) projW[name] = {};
          if (!projW[name][wName]) projW[name][wName] = { sati: 0, dani: new Set() };
          projW[name][wName].sati += wd.hours;
          if (d.date) projW[name][wName].dani.add(d.date);
          pd.radIsplata += wd.hours * w.satnica + (wd.marenda || 0);
        }
      }
    }

    const c = computeMonthCosts(k);
    const godH = godisnjiHoursInMonth(k, c.inProgress ? today : null);
    const satiUk = satiOdradeni + godH;
    const per = (v) => satiUk > 0 ? v / satiUk : 0;
    const rRad = per(c.rad), rRez = per(c.rezija);
    const rKes = per(c.kes), rSl = per(c.sluzbeno);
    const rRezBruto = per(c.rezBruto), rRezVraca = per(c.rezVraca);
    const kapacitet = capacityHoursInMonth(k, c.inProgress ? today : null);
    const nepotpun = !c.inProgress && kapacitet > 0 && satiUk < 0.5 * kapacitet && (c.rad + c.rezija) > 0.005;
    const procjena = c.sluzbenoIzvor !== 'troskovi' || c.inProgress;
    firma[k] = { ...c, satiOdradeni, godH, satiUk, kapacitet, nepotpun, procjena };

    const dodaj = (p, hh) => {
      p.rad += hh * rRad; p.rez += hh * rRez; p.sati += hh;
      p.radKes += hh * rKes; p.radSluzbeno += hh * rSl;
      p.rezBruto += hh * rRezBruto; p.rezVraca += hh * rRezVraca;
      const mm = mEnsure(p, k);
      mm.rad += hh * rRad; mm.rez += hh * rRez; mm.sati += hh;
      mm.udio = satiUk > 0 ? (hh / satiUk) * 100 : 0;
      if (nepotpun) p.nepotpunSet.add(k);
      if (c.inProgress) p.inProgressSet.add(k);
      if (procjena) p.procjenaSet.add(k);
    };
    for (const name of Object.keys(projH)) {
      const hh = projH[name];
      const p = ensure(name);
      dodaj(p, hh);
      for (const wName of Object.keys(projW[name] || {})) {
        const src = projW[name][wName];
        if (!p.workers[wName]) p.workers[wName] = { sati: 0, rad: 0, rez: 0, dani: 0 };
        p.workers[wName].sati += src.sati;
        p.workers[wName].rad += src.sati * rRad;
        p.workers[wName].rez += src.sati * rRez;
        p.workers[wName].dani += src.dani.size;
      }
    }
    if (godH > 0.005) {
      const g = ensure(PROJ_GODISNJI);
      dodaj(g, godH);
      if (k > g.lastActivity) g.lastActivity = k;
    }
    if (satiUk <= 0 && (c.rad + c.rezija) > 0.005) {
      const n = ensure(PROJ_NONE);
      n.rad += c.rad; n.rez += c.rezija;
      n.radKes += c.kes; n.radSluzbeno += c.sluzbeno;
      n.rezBruto += c.rezBruto; n.rezVraca += c.rezVraca;
      const nm = mEnsure(n, k);
      nm.rad += c.rad; nm.rez += c.rezija; nm.udio = 100;
      n.nepotpunSet.add(k);
      if (k > n.lastActivity) n.lastActivity = k;
    }
  }

  const trxProj = trxNaProjektima();
  const list = Object.values(map);
  const lastKey = months.length ? months[months.length - 1] : null;
  const prevKey = lastKey ? addCalendarMonths(lastKey, -1) : null;
  for (const p of list) {
    p.ukupno = p.materijal + p.rad + p.rez;
    p.isActive = !!lastKey && (p.lastActivity === lastKey || p.lastActivity === prevKey);
    p.monthCount = Object.keys(p.months).length;
    p.workerCount = Object.keys(p.workers).length;
    p.dani = p.daysSet ? p.daysSet.size : 0;
    const dates = p.daysSet ? Array.from(p.daysSet).sort() : [];
    p.prviDan = dates.length ? dates[0] : null;
    p.zadnjiDan = dates.length ? dates[dates.length - 1] : null;
    p.kalDana = (p.prviDan && p.zadnjiDan) ? Math.round((new Date(p.zadnjiDan) - new Date(p.prviDan)) / 86400000) + 1 : 0;
    delete p.daysSet;
    p.nepotpunMonths = Array.from(p.nepotpunSet).sort(); delete p.nepotpunSet;
    p.inProgressMonths = Array.from(p.inProgressSet).sort(); delete p.inProgressSet;
    p.procjenaMonths = Array.from(p.procjenaSet).sort(); delete p.procjenaSet;
    for (const f of ['rad', 'rez', 'radKes', 'radSluzbeno', 'rezBruto', 'rezVraca']) p[f] = round2(p[f]);

    const ob = (state.obracun && typeof state.obracun === 'object') ? state.obracun[p.name] : null;
    p.uplate = (ob && Array.isArray(ob.uplate)) ? ob.uplate : [];
    p.naplaceno = round2(p.uplate.reduce((a, u) => a + (Number(u.amount) || 0), 0));
    p.ponuda = (ob && Number(ob.ponuda) > 0) ? round2(Number(ob.ponuda)) : null;
    p.ponudaStavke = (ob && Array.isArray(ob.ponudaStavke)) ? ob.ponudaStavke : [];
    p.zakljucen = !!(ob && ob.zakljucen);
    p.troskoviRucni = (ob && Array.isArray(ob.troskovi)) ? ob.troskovi : [];

    /* PDV na uplatama */
    p.pdvRezim = (ob && (ob.pdvRezim === 'pdv25' || ob.pdvRezim === 'ppo')) ? ob.pdvRezim : null;
    p.uplateInfo = p.uplate.map((u, i) => ({ u, i, ...uplataInfo(u, p.pdvRezim) }));
    p.pdvNijeOdabran = p.uplateInfo.some(x => !x.mode);
    const prihodZa = (pret) => round2(p.uplateInfo.reduce((a, x) => a + (x.mode ? x.osn : (pret === 'pdv25' ? round2(x.amount / 1.25) : x.amount)), 0));
    p.prihod = p.pdvNijeOdabran ? null : prihodZa(null);
    p.pdvUplate = p.prihod === null ? null : round2(p.naplaceno - p.prihod);

    /* Materijal (STO, PDV 25 % vraća se sav) */
    p.materijalBezPdv = round2(p.materijal / 1.25);
    p.materijalPdv = round2(p.materijal - p.materijalBezPdv);

    /* Ostali troškovi: ručni unos na projektu + transakcije iz Troškova stavljene na projekt */
    const rucni = p.troskoviRucni.map((r, i) => ({ tip: 'rucno', r, i, ...rucniTrosakInfo(r), pokrivene: [] }));
    const izTrx = [];
    for (const x of (trxProj[p.name] || [])) {
      const rijec = srPrvaRijec(x.t.partner);
      const pokriva = rijec ? rucni.find(rr => srNorm(rr.r.note).includes(rijec)) : null;
      if (pokriva) { pokriva.pokrivene.push(x); continue; }
      const s = pdvSplit(x.t.amount, trxPdvMode(x.t).mode);
      izTrx.push({ tip: 'trx', ...x, racun: s.racun, vraca: s.vraca, trosak: s.trosak, mode: trxPdvMode(x.t).mode });
    }
    p.ostaloStavke = [...rucni, ...izTrx];
    p.ostalo = round2(p.ostaloStavke.reduce((a, x) => a + x.trosak, 0));
    p.ostaloRacun = round2(p.ostaloStavke.reduce((a, x) => a + x.racun, 0));
    p.ostaloVraca = round2(p.ostaloStavke.reduce((a, x) => a + x.vraca, 0));
    p.trosakRucni = p.ostalo;

    p.trosak = round2(p.materijalBezPdv + p.ostalo + p.rad + p.rez);
    p.zaradaBlocked = p.nepotpunMonths.length > 0 && p.name !== PROJ_NONE;
    const zaPrihod = (prihod) => {
      const nakonMR = round2(prihod - p.materijalBezPdv - p.ostalo - p.rad);
      const zarada = round2(nakonMR - p.rez);
      return { prihod, nakonMR, zarada, marza: prihod > 0 ? (zarada / prihod) * 100 : null };
    };
    p.scen = p.uplateInfo.length ? { pdv25: zaPrihod(prihodZa('pdv25')), ppo: zaPrihod(prihodZa('ppo')) } : null;
    const real = p.prihod !== null ? zaPrihod(p.prihod) : null;
    p.nakonMR = real ? real.nakonMR : null;
    p.zarada = (p.naplaceno > 0 && !p.zaradaBlocked && real) ? real.zarada : null;
    p.marza = (p.zarada !== null && p.prihod > 0) ? (p.zarada / p.prihod) * 100 : null;
    p.pretporez = round2(p.materijalPdv + p.ostaloVraca + p.rezVraca);
    p.pdvNeto = p.pdvUplate !== null ? round2(p.pdvUplate - p.pretporez) : null;
    p.warnEvidencija = p.naplaceno > 0 && !p.zaradaBlocked && (p.rad + p.rez) < 0.10 * p.naplaceno;
    p.mjeseciRada = Object.keys(p.months).filter(k => p.months[k].sati > 0).sort();
  }
  list.firma = firma;
  return list;
}

/* ---------- Uplate kupaca u Troškovima koje nisu ni na jednom projektu ---------- */
function prihodiBezProjekta() {
  const ob = state.obracun || {};
  const upl = [];
  for (const [name, rec] of Object.entries(ob)) for (const u of ((rec && rec.uplate) || [])) upl.push({ name, u });
  const used = new Set();
  const out = [];
  for (const mk of Object.keys(state.trx || {}).sort()) {
    (state.trx[mk] || []).forEach((t, i) => {
      if (!t || t.type !== 'Prihod' || t.group !== 'Prihodi') return;
      if (t.proj) return;
      const a = Number(t.amount) || 0;
      const hit = upl.find(x => !used.has(x) && Math.abs((Number(x.u.amount) || 0) - a) < 0.011 && x.u.date && t.date && Math.abs(dayDiff(x.u.date, t.date)) <= 10);
      if (hit) { used.add(hit); return; }
      out.push({ t, mk, i });
    });
  }
  return out;
}
/* Troškovi koji idu na projekt (npr. podizvođač), a projekt još nije odabran */
function troskoviBezProjekta() {
  const out = [];
  for (const mk of Object.keys(state.trx || {}).sort()) {
    (state.trx[mk] || []).forEach((t, i) => { if (trxDestInfo(t).dest === 'projekt-bez') out.push({ t, mk, i }); });
  }
  return out;
}
/* Imena projekata za odabir (evidencija sati, STO, obračun) */
function projektImena() {
  const set = new Set();
  for (const k of Object.keys(state.hours || {})) for (const d of ((state.hours[k] || {}).days || [])) for (const e of Object.values(d.workers || {})) { const n = (e && e.project || '').trim(); if (n) set.add(n); }
  for (const k of Object.keys(state.sto || {})) for (const t of (state.sto[k] || [])) { const n = (t.project || '').trim(); if (n && n !== 'Ostalo') set.add(n); }
  for (const n of Object.keys(state.obracun || {})) set.add(n);
  const hidden = new Set(state.hiddenProjects || []);
  return Array.from(set).filter(n => !hidden.has(n)).sort((a, b) => a.localeCompare(b, 'hr'));
}

/* ============================================================
   v4 · DETALJ PROJEKTA: PDV na uplatama, od prihoda do zarade
   ============================================================ */
const v4SignEur = (n, dec = 2) => (n >= 0 ? '+' : '−') + eur(Math.abs(n), dec);
const v4Minus = (n, dec = 2) => (Math.abs(n) < 0.005 ? eur(0, dec) : '−' + eur(Math.abs(n), dec));
const v4SignPct = (x) => (x >= 0 ? '+' : '−') + pct1(Math.abs(x));
const v4PdvPill = (mode, vlastiti) => {
  if (mode === 'pdv25') return `<span class="pill pdv25"${vlastiti ? ' title="PDV postavljen na ovoj uplati"' : ''}>PDV 25 %${vlastiti ? ' ·' : ''}</span>`;
  if (mode === 'ppo') return `<span class="pill ppo"${vlastiti ? ' title="PDV postavljen na ovoj uplati"' : ''}>Prijenos${vlastiti ? ' ·' : ''}</span>`;
  return '<span class="pill red">nije odabrano</span>';
};
const v4NaziviMjeseci = (keys) => {
  const k = keys.slice().sort();
  if (!k.length) return '';
  if (k.length === 1) return monthGenHr(k[0]);
  return k.map(x => monthLabelShort(x).toLowerCase()).join(', ');
};

function v4PdvSectionHtml(p) {
  const odabrano = p.pdvRezim;
  const treba = p.pdvNijeOdabran && p.uplateInfo.length > 0;
  const btn = (val, lbl) => `<button type="button" class="${odabrano === val ? 'active' : ''}" data-pdv-rezim="${val}" aria-pressed="${odabrano === val ? 'true' : 'false'}"${isAdmin ? '' : ' disabled'}>${lbl}</button>`;
  return `
    <div class="v4-pdv${treba ? ' treba' : ''}">
      <div class="v4-pdv-txt">
        <div class="v4-eyebrow">${treba ? 'PDV na uplatama · nije odabrano' : 'PDV na uplatama'}</div>
        <div class="v4-pdv-sub">${treba
          ? 'Što piše na računima investitoru: PDV 25 % kao zaseban iznos ili „prijenos porezne obveze"? Dok se ne odabere, zarada se ne prikazuje.'
          : 'Kako su izdani računi investitoru. Iznimku za jednu uplatu postaviš na samoj uplati.'}</div>
      </div>
      <div class="toggle v4-toggle" role="group" aria-label="PDV na uplatama">${btn('pdv25', 'PDV 25 %')}${btn('ppo', 'Prijenos porezne obveze')}</div>
    </div>`;
}

function v4KpiHtml(p) {
  const hasNapl = p.naplaceno > 0;
  const nepotpunLbl = (p.nepotpunMonths || []).map(monthLabelShort).join(', ');
  let prihodCell;
  if (p.pdvNijeOdabran && p.uplateInfo.length) {
    prihodCell = `<div class="kpi-cell"><div class="stat-label">Uplaćeno</div><div class="stat-value">${eur(p.naplaceno, 0)}</div><div class="stat-sub">${p.uplateInfo.length} ${hrPlural(p.uplateInfo.length, 'uplata', 'uplate', 'uplata')} · s PDV-om ili bez?</div></div>`;
  } else if (hasNapl) {
    const sub = p.pdvUplate > 0.005 ? `uplaćeno ${eur(p.naplaceno, 0)} − PDV ${eur(p.pdvUplate, 0)}` : `uplaćeno ${eur(p.naplaceno, 0)} · računi bez PDV-a`;
    prihodCell = `<div class="kpi-cell"><div class="stat-label">Prihod bez PDV-a</div><div class="stat-value">${eur(p.prihod, 0)}</div><div class="stat-sub">${sub}</div></div>`;
  } else {
    prihodCell = `<div class="kpi-cell"><div class="stat-label">Prihod bez PDV-a</div><div class="stat-value" style="color: var(--muted-2);">0 €</div><div class="stat-sub">još nema uplata</div></div>`;
  }
  let zaradaCell;
  if (p.pdvNijeOdabran && p.uplateInfo.length) {
    zaradaCell = `<div class="kpi-cell v4-amber"><div class="stat-label">Zarada</div><div class="stat-value">?</div><div class="stat-sub">čeka PDV na uplatama</div></div>`;
  } else if (p.zaradaBlocked && hasNapl) {
    zaradaCell = `<div class="kpi-cell v4-amber"><div class="stat-label">Zarada</div><div class="stat-value">?</div><div class="stat-sub">čeka evidenciju: ${escapeHtml(nepotpunLbl)}</div></div>`;
  } else if (!hasNapl) {
    zaradaCell = `<div class="kpi-cell"><div class="stat-label">Zarada</div><div class="stat-value" style="color: var(--muted-2);">?</div><div class="stat-sub">čeka prvu uplatu</div></div>`;
  } else {
    const gub = p.zarada < 0;
    const proc = (p.procjenaMonths || []).length ? ` · <span class="pill amber" title="Plaće za ${escapeHtml(v4NaziviMjeseci(p.procjenaMonths))} još nisu upisane u Troškovima, uzeta je procjena">dio je procjena</span>` : '';
    zaradaCell = `<div class="kpi-cell" style="background: var(${gub ? '--negative-soft' : '--positive-soft'});"><div class="stat-label" style="color: var(${gub ? '--negative' : '--positive'});">Zarada</div><div class="stat-value" style="color: var(${gub ? '--negative' : '--positive'});">${v4SignEur(p.zarada, 0)}</div><div class="stat-sub" style="color: var(${gub ? '--negative' : '--positive'});">marža ${p.marza !== null ? v4SignPct(p.marza) : '?'} prihoda${proc}</div></div>`;
  }
  return `
    <div class="kpi-row" style="margin-bottom: 24px;">
      ${prihodCell}
      <div class="kpi-cell"><div class="stat-label">Trošak ukupno</div><div class="stat-value">${eur(p.trosak, 0)}</div><div class="stat-sub">sve bez PDV-a koji se vraća</div></div>
      ${zaradaCell}
      <div class="kpi-cell"><div class="stat-label">Rad i režija</div><div class="stat-value">${eur(p.rad + p.rez, 0)}</div><div class="stat-sub">rad ${eur(p.rad, 0)} + režija ${eur(p.rez, 0)}</div></div>
    </div>`;
}

function v4RezijaSub(p) {
  const mj = (p.mjeseciRada || []);
  const parts = [`fiksni troškovi ${mj.length ? v4NaziviMjeseci(mj) : ''} ${eur(p.rezBruto, 2)}`.replace(/\s+/g, ' ')];
  if (p.rezVraca > 0.005) parts.push(`PDV koji se vraća ${v4Minus(p.rezVraca)}`);
  if (mj.length === 1 && p.months[mj[0]]) parts.push(`udio ${monthGenHr(mj[0])} ${pct1(p.months[mj[0]].udio)}`);
  return parts.join(' · ');
}
function v4OstaloNaziv(p) {
  const n = p.ostaloStavke.map(x => x.tip === 'rucno' ? (x.r.note || 'ručni unos') : (x.t.partner || 'iz Troškova'));
  if (!n.length) return 'nema';
  return n.length <= 2 ? n.join(', ') : n.slice(0, 2).join(', ') + ` i još ${n.length - 2}`;
}

function v4KaskadaHtml(p) {
  const blokZarada = p.zaradaBlocked;
  const row = (lbl, sub, val, cls = '') => `<div class="v4-casc-row${cls}"><span>${lbl}${sub ? `<span class="v4-casc-sub">${sub}</span>` : ''}</span><span class="v">${val}</span></div>`;
  return `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head"><div><div class="card-title">Od prihoda do zarade</div><div class="card-sub">Prvo troškovi samog projekta, zatim udio fiksnih troškova firme</div></div></div>
      ${row('Prihod bez PDV-a', '', eur(p.prihod, 2))}
      ${row('− Materijal', 'STO, bez PDV-a', v4Minus(p.materijalBezPdv))}
      ${row('− Podizvođači i ostali troškovi', escapeHtml(v4OstaloNaziv(p)), v4Minus(p.ostalo))}
      ${row('− Rad · sve plaće', `keš isplate ${eur(p.radKes, 2)} · službene plaće, neto i davanja ${eur(p.radSluzbeno, 2)}`, v4Minus(p.rad))}
      ${row('Zarada nakon materijala i rada', '', v4SignEur(p.nakonMR), ' hl')}
      ${row('− Režija · fiksni troškovi bez plaća', escapeHtml(v4RezijaSub(p)), v4Minus(p.rez))}
      ${blokZarada
        ? row('Zarada', 'čeka evidenciju: ' + escapeHtml((p.nepotpunMonths || []).map(monthLabelShort).join(', ')), '?', ' hl amber')
        : row('Zarada', '', v4SignEur(p.zarada), p.zarada < 0 ? ' hl neg' : ' hl pos')}
    </div>`;
}

function v4TrakaHtml(p) {
  if (p.zaradaBlocked) return '';
  const pdv = Math.max(0, p.pdvUplate || 0);
  const gub = p.zarada < 0;
  const base = gub ? (pdv + p.trosak) : p.naplaceno;
  if (!(base > 0)) return '';
  const seg = [
    { k: 'pdv', lbl: 'PDV', sub: 'ide državi, nije ni trošak ni zarada', v: pdv, bg: 'repeating-linear-gradient(135deg, #bdbab1 0 6px, #d6d3ca 6px 12px)', fg: '#2c2c2a', sw: 'repeating-linear-gradient(135deg, #bdbab1 0 3px, #d6d3ca 3px 6px)' },
    { k: 'mat', lbl: 'Materijal', sub: 'bez PDV-a', v: p.materijalBezPdv, bg: 'var(--acc-projects)' },
    { k: 'ost', lbl: 'Podizvođači i ostali troškovi', sub: 'bez PDV-a koji se vraća', v: p.ostalo, bg: '#5f5e5a' },
    { k: 'rad', lbl: 'Rad', sub: 'sve plaće i davanja', v: p.rad, bg: 'var(--acc-cashflow)' },
    { k: 'rez', lbl: 'Režija', sub: 'fiksni troškovi bez plaća', v: p.rez, bg: '#6f8196' },
  ];
  if (!gub) seg.push({ k: 'zar', lbl: 'Zarada', sub: '', v: Math.max(0, p.zarada), bg: 'var(--positive)' });
  const w = (v) => (v / base) * 100;
  const pctOf = (v) => pct1((v / p.naplaceno) * 100);
  return `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head"><div><div class="card-title">Kamo je otišao uplaćeni novac</div><div class="card-sub">Uplaćeno ${eur(p.naplaceno, 2)} · udio svakog dijela u uplaćenom${gub ? ` · <span style="color: var(--negative);">trošak je veći od prihoda za ${eur(Math.abs(p.zarada), 2)}</span>` : ''}</div></div></div>
      <div class="ob-bar">${seg.filter(s => w(s.v) > 0.05).map(s => `<span style="width: ${w(s.v).toFixed(3)}%; background: ${s.bg};${s.fg ? ' color: ' + s.fg + ';' : ''}" title="${s.lbl} ${pct1(w(s.v))}">${w(s.v) >= 9 ? pct1(w(s.v)) : ''}</span>`).join('')}</div>
      ${seg.map(s => `
      <div class="ob-legend-row">
        <span class="sw" style="background: ${s.sw || s.bg};"></span>
        <span>${s.k === 'zar' ? '<strong>Zarada</strong>' : s.lbl}${s.sub ? ` <span style="color: var(--muted); font-size: 12.5px;">· ${s.sub}</span>` : ''}</span>
        <span class="amt"${s.k === 'zar' ? ' style="color: var(--positive);"' : ''}>${eur(s.v, 2)}</span>
        <span class="pct">${pctOf(s.v)}</span>
      </div>`).join('')}
      ${gub ? `
      <div class="ob-legend-row">
        <span class="sw" style="background: var(--negative);"></span>
        <span><strong>Gubitak</strong> <span style="color: var(--muted); font-size: 12.5px;">· prihod − trošak</span></span>
        <span class="amt" style="color: var(--negative);">${v4Minus(p.zarada)}</span>
        <span class="pct"></span>
      </div>` : ''}
    </div>`;
}

function v4ScenarijiHtml(p) {
  const s = p.scen;
  if (!s) return '';
  const card = (key, naslov, pdvLbl) => {
    const x = s[key];
    const pdvIznos = round2(p.naplaceno - x.prihod);
    let note = '';
    if (p.ponuda) {
      const razl = round2(x.prihod - p.ponuda);
      if (razl < -0.005) note = `<div class="v4-scen-note neg">Do ponude nedostaje ${eur(Math.abs(razl), 2)} bez PDV-a${key === 'pdv25' ? `, odnosno ${eur(Math.abs(razl) * 1.25, 2)} uplate` : ''}.</div>`;
      else if (razl > 0.005) note = `<div class="v4-scen-note pos">Naplaćeno ${eur(razl, 2)} više od ponude (dodatni radovi?).</div>`;
      else note = `<div class="v4-scen-note pos">Naplaćeno točno koliko je ponuda.</div>`;
    }
    return `
      <div class="card v4-scen">
        <div class="card-title" style="margin-bottom: 8px;">${naslov}</div>
        <div class="v4-scen-row"><span>Prihod bez PDV-a</span><span class="v">${eur(x.prihod, 2)}</span></div>
        <div class="v4-scen-row"><span>PDV na uplatama · ${pdvLbl}</span><span class="v">${eur(pdvIznos, 2)}</span></div>
        <div class="v4-scen-row"><span>Zarada nakon materijala i rada</span><span class="v">${v4SignEur(x.nakonMR)}</span></div>
        <div class="v4-scen-row"><span>Zarada · marža ${x.marza !== null ? v4SignPct(x.marza) : '?'}</span><span class="v" style="color: var(${x.zarada < 0 ? '--negative' : '--positive'});">${p.zaradaBlocked ? '?' : v4SignEur(x.zarada)}</span></div>
        ${p.ponuda ? `<div class="v4-scen-row"><span>Ponuda bez PDV-a</span><span class="v">${eur(p.ponuda, 2)}</span></div>` : ''}
        ${note}
        ${isAdmin ? `<button type="button" class="btn" data-pdv-rezim="${key}" style="align-self: flex-start; margin-top: 12px;">Odaberi ${key === 'pdv25' ? 'PDV 25 %' : 'prijenos porezne obveze'}</button>` : ''}
      </div>`;
  };
  const hint3 = p.ponuda
    ? `<div class="v4-hint"><span class="no">3</span><span>Ako je ugovoreno ${eur(p.ponuda, 2)} bez PDV-a, uz PDV 25 % investitor ukupno plaća ${eur(round2(p.ponuda * 1.25), 2)}, a uz prijenos ${eur(p.ponuda, 2)}. Do sada je uplaćeno ${eur(p.naplaceno, 2)}.</span></div>`
    : '';
  return `
    <div class="grid grid-2" style="margin-bottom: 16px;">
      ${card('pdv25', 'Ako su računi s PDV-om 25 %', 'ide državi')}
      ${card('ppo', 'Ako je prijenos porezne obveze', 'obračunava investitor')}
    </div>
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-title" style="margin-bottom: 4px;">Kako provjeriti</div>
      <div class="v4-hint"><span class="no">1</span><span>Na računu: ako je prijenos, piše „prijenos porezne obveze" i PDV nije izračunat; ako je PDV, ispod osnovice stoji PDV 25 % kao zaseban iznos.</span></div>
      <div class="v4-hint"><span class="no">2</span><span>Za građevinske radove između dviju firmi u sustavu PDV-a zakon propisuje prijenos porezne obveze. Građanima, zgradama i firmama izvan sustava PDV-a račun ide s PDV-om 25 %.</span></div>
      ${hint3}
    </div>`;
}

function v4UplateCardHtml(p) {
  const rows = p.uplateInfo.slice().sort((a, b) => (a.u.date || '').localeCompare(b.u.date || ''));
  const osnT = round2(rows.reduce((a, x) => a + (x.osn || 0), 0));
  const pdvT = round2(rows.reduce((a, x) => a + (x.pdv || 0), 0));
  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Uplate</div><div class="card-sub">Upisuje se iznos koji je stigao na račun. Osnovica i PDV računaju se sami.</div></div>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="ob-uplata-add">+ Dodaj uplatu</button>' : ''}
      </div>
      ${rows.length === 0 ? '<div class="empty">Još nema evidentiranih uplata za ovaj projekt.</div>' : `
      <div class="table-scroll">
        <table class="table v4-tbl">
          <thead><tr><th>Datum</th><th class="text-right">Uplaćeno</th><th>PDV</th><th class="text-right">Osnovica</th><th class="text-right">PDV iznos</th>${isAdmin ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${rows.map(x => `
            <tr${isAdmin ? ` data-ob-up-edit="${x.i}" style="cursor: pointer;" title="${escapeHtml(x.u.note || 'Klik za uređivanje')}"` : (x.u.note ? ` title="${escapeHtml(x.u.note)}"` : '')}>
              <td class="col-date num">${isoToEU(x.u.date)}</td>
              <td class="num text-right" style="font-weight: 600;">${eur(x.amount, 2)}</td>
              <td>${v4PdvPill(x.mode, x.vlastiti)}</td>
              <td class="num text-right">${x.osn === null ? '?' : eur(x.osn, 2)}</td>
              <td class="num text-right" style="color: var(--muted);">${x.pdv === null ? '?' : eur(x.pdv, 2)}</td>
              ${isAdmin ? `<td class="text-right"><span class="v4-x" data-ob-up-del="${x.i}" title="Obriši uplatu">×</span></td>` : ''}
            </tr>`).join('')}
          </tbody>
          <tfoot><tr><td>UKUPNO</td><td class="num text-right">${eur(p.naplaceno, 2)}</td><td></td><td class="num text-right">${p.pdvNijeOdabran ? '?' : eur(osnT, 2)}</td><td class="num text-right">${p.pdvNijeOdabran ? '?' : eur(pdvT, 2)}</td>${isAdmin ? '<td></td>' : ''}</tr></tfoot>
        </table>
      </div>`}
    </div>`;
}

function v4TrosakCardHtml(p, isNone) {
  const modeLbl = (m) => m ? (PDV_PRESETS[m] ? PDV_PRESETS[m].kratko : '') : 'bez PDV-a';
  const ost = p.ostaloStavke.map(x => {
    if (x.tip === 'rucno') {
      const pok = x.pokrivene.length ? `<div class="v4-sub">iz Troškova: ${x.pokrivene.map(y => `${dmEU(y.t.date)} ${eur(Number(y.t.amount) || 0, 2)}`).join(' · ')}</div>` : '';
      return `
        <tr${isAdmin ? ` data-ob-tr-edit="${x.i}" style="cursor: pointer;" title="Klik za uređivanje"` : ''}>
          <td>${escapeHtml(x.r.note || 'Trošak')}<div class="v4-sub">${isoToEU(x.r.date)} · ${escapeHtml(modeLbl(x.mode))}</div>${pok}</td>
          <td class="num text-right">${eur(x.racun, 2)}</td>
          <td class="num text-right" style="color: var(--muted);">${v4Minus(x.vraca)}</td>
          <td class="num text-right" style="font-weight: 600; white-space: nowrap;">${eur(x.trosak, 2)}${isAdmin ? ` <span class="v4-x" data-ob-tr-del="${x.i}" title="Obriši trošak">×</span>` : ''}</td>
        </tr>`;
    }
    return `
        <tr data-trx-open="${x.mk}|${x.i}" style="cursor: pointer;" title="Otvori u Troškovima">
          <td>${escapeHtml(x.t.partner || 'Trošak')}<div class="v4-sub">${isoToEU(x.t.date)} · iz Troškova · ${escapeHtml(modeLbl(x.mode))}</div></td>
          <td class="num text-right">${eur(x.racun, 2)}</td>
          <td class="num text-right" style="color: var(--muted);">${v4Minus(x.vraca)}</td>
          <td class="num text-right" style="font-weight: 600;">${eur(x.trosak, 2)}</td>
        </tr>`;
  }).join('');
  const mj = p.mjeseciRada || [];
  return `
    <div class="card">
      <div class="card-head">
        <div><div class="card-title">Trošak</div><div class="card-sub">Iznos računa, PDV koji firma vraća i stvarni trošak</div></div>
        ${isAdmin && !isNone ? '<button class="btn btn-sm" id="ob-trosak-add">+ Dodaj trošak</button>' : ''}
      </div>
      <div class="table-scroll">
        <table class="table v4-tbl v4-tight">
          <thead><tr><th>Stavka</th><th class="text-right">Račun</th><th class="text-right">Vraća se</th><th class="text-right">Trošak</th></tr></thead>
          <tbody>
            <tr><td>Materijal · STO<div class="v4-sub">${p.stoCount} ${hrPlural(p.stoCount, 'račun', 'računa', 'računa')} · PDV 25 %</div></td><td class="num text-right">${eur(p.materijal, 2)}</td><td class="num text-right" style="color: var(--muted);">${v4Minus(p.materijalPdv)}</td><td class="num text-right" style="font-weight: 600;">${eur(p.materijalBezPdv, 2)}</td></tr>
            ${ost}
            <tr><td>Rad · sve plaće<div class="v4-sub">${FMT_INT.format(p.sati)} h · keš isplate i službene plaće</div></td><td></td><td></td><td class="num text-right" style="font-weight: 600;">${eur(p.rad, 2)}</td></tr>
            <tr><td>Režija<div class="v4-sub">${mj.length === 1 && p.months[mj[0]] ? `${pct1(p.months[mj[0]].udio)} ${monthGenHr(mj[0])}` : (mj.length ? escapeHtml(v4NaziviMjeseci(mj)) : 'mjeseci bez evidencije')} · iz Troškova</div></td><td class="num text-right">${eur(p.rezBruto, 2)}</td><td class="num text-right" style="color: var(--muted);">${v4Minus(p.rezVraca)}</td><td class="num text-right" style="font-weight: 600;">${eur(p.rez, 2)}</td></tr>
          </tbody>
          <tfoot><tr><td>TROŠAK UKUPNO</td><td></td><td></td><td class="num text-right">${eur(p.trosak, 2)}</td></tr></tfoot>
        </table>
      </div>
    </div>`;
}

function v4PdvCardHtml(p) {
  const row = (lbl, sub, val, strong) => `<div class="v4-casc-row${strong ? ' tot' : ''}"><span>${lbl}${sub ? ` <span style="color: var(--muted); font-size: 12.5px;">· ${sub}</span>` : ''}</span><span class="v">${val}</span></div>`;
  const svi = p.uplateInfo.every(x => x.mode === 'pdv25');
  const nijedan = p.uplateInfo.every(x => x.mode === 'ppo');
  const subUpl = svi ? '25 % sadržan u svakoj uplati' : (nijedan ? 'prijenos porezne obveze: PDV obračunava investitor' : 'dio uplata s PDV-om, dio s prijenosom');
  const neto = p.pdvNeto;
  return `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head"><div><div class="card-title">PDV na projektu</div><div class="card-sub">Prolazi kroz firmu prema Poreznoj. Nije ni prihod ni trošak, zato ne mijenja zaradu.</div></div></div>
      ${row('PDV na uplatama', subUpl, eur(p.pdvUplate, 2))}
      ${row('PDV na materijalu', 'vraća se firmi', v4Minus(p.materijalPdv))}
      ${p.ostaloVraca > 0.005 ? row('PDV na ostalim troškovima', 'vraća se firmi', v4Minus(p.ostaloVraca)) : ''}
      ${row('PDV u režiji', 'vraća se firmi, udio projekta', v4Minus(p.rezVraca))}
      ${row(neto >= 0 ? 'PDV za platiti zbog ovog projekta' : 'Pretplata · firma ima više PDV-a za odbiti', '', eur(Math.abs(neto), 2), true)}
      <div style="font-size: 12.5px; color: var(--muted); margin-top: 14px;">Poreznoj se PDV plaća jednom mjesečno, za sve projekte zajedno. U Troškovima je to zasebna stavka „PDV" i ne ulazi u režiju.</div>
    </div>`;
}

/* Detalj otvoren s prvog ekrana Projekata (usporedba, upozorenja) vraća se na taj ekran */
let v4Detalj = { proj: null, pregled: false };
function renderProjectDetail(p) {
  if (v4Detalj.proj !== p.name) v4Detalj = { proj: p.name, pregled: projectsGroup === null };
  const panel = document.getElementById('panel-projects');
  const isNone = p.name === PROJ_NONE;
  const displayName = isNone ? 'Bez projekta' : p.name;
  const mKeys = Object.keys(p.months).sort();
  const workers = Object.entries(p.workers).map(([name, w]) => ({ name, ...w })).sort((a, b) => (b.rad + b.rez) - (a.rad + a.rez));

  const matMap = {};
  let itemizedTotal = 0;
  for (const k of allMonths()) {
    for (const t of (state.sto[k] || [])) {
      const nm = (t.project || '').trim() || PROJ_NONE;
      if (nm !== p.name || !t.items || !t.items.length) continue;
      itemizedTotal += t.amount;
      for (const it of t.items) {
        const key = (it.name || 'Stavka') + '¦' + (it.unit || '');
        if (!matMap[key]) matMap[key] = { name: it.name || 'Stavka', unit: it.unit || '', qty: 0, amount: 0 };
        matMap[key].qty += Number(it.qty) || 0;
        matMap[key].amount += Number(it.amount) || 0;
      }
    }
  }
  const matRows = Object.values(matMap).sort((a, b) => b.amount - a.amount);
  const matTotal = round2(matRows.reduce((a, r) => a + r.amount, 0));
  const nonItemized = Math.max(0, round2(p.materijal - itemizedTotal));

  projectsGroup = isNone ? null : (p.zakljucen ? 'zavrseni' : 'tekuci');
  const hasNapl = p.naplaceno > 0;
  const hasPonuda = p.ponuda !== null && p.ponuda !== undefined;
  const periodStr = mKeys.length === 0 ? 'bez mjeseci' : (mKeys.length === 1 ? monthLabel(mKeys[0]) : monthLabelShort(mKeys[0]) + ' – ' + monthLabel(mKeys[mKeys.length - 1]));
  const statusPill = isNone ? '' : (p.zakljucen ? '<span class="pill gray" style="vertical-align: middle;">✓ završen</span>' : '<span class="pill brown" style="vertical-align: middle;">tekući</span>');
  const subline = isNone
    ? 'STO stavke bez naziva projekta, sati bez upisanog projekta i mjeseci bez evidencije'
    : (p.prviDan && p.zadnjiDan
      ? `${isoToEU(p.prviDan)} – ${isoToEU(p.zadnjiDan)} · ${p.kalDana} ${hrPlural(p.kalDana, 'kalendarski dan', 'kalendarska dana', 'kalendarskih dana')} · ${p.dani} ${hrPlural(p.dani, 'dan s evidencijom', 'dana s evidencijom', 'dana s evidencijom')} · ${FMT_INT.format(p.sati)} h`
      : `${periodStr} · ${FMT_INT.format(p.sati)} h`);

  let srednjiHtml = '';
  if (!isNone && p.uplateInfo.length) {
    srednjiHtml = p.pdvNijeOdabran ? v4ScenarijiHtml(p) : (v4KaskadaHtml(p) + v4TrakaHtml(p));
  }

  const noneKpi = `
    <div class="kpi-row" style="margin-bottom: 24px;">
      <div class="kpi-cell"><div class="stat-label">Trošak ukupno</div><div class="stat-value">${eur(p.trosak, 0)}</div><div class="stat-sub">materijal bez PDV-a + rad + režija</div></div>
      <div class="kpi-cell"><div class="stat-label">Rad i režija</div><div class="stat-value">${eur(p.rad + p.rez, 0)}</div><div class="stat-sub">rad ${eur(p.rad, 0)} + režija ${eur(p.rez, 0)}</div></div>
    </div>`;

  /* Ponuda · referenca (uspoređuje se s prihodom bez PDV-a) */
  let ponudaHtml = '';
  if (!isNone) {
    const usp = p.prihod !== null ? p.prihod : null;
    const razlika = (hasPonuda && usp !== null && hasNapl) ? round2(usp - p.ponuda) : null;
    const razlikaPct = (razlika !== null && p.ponuda > 0) ? (razlika / p.ponuda) * 100 : null;
    const planMarza = hasPonuda ? round2(p.ponuda - p.trosak) : null;
    const planMarzaPct = (planMarza !== null && p.ponuda > 0) ? (planMarza / p.ponuda) * 100 : null;
    const ponudaInner = hasPonuda ? `
        <div class="ob-cmp-row"><span>Ponuda (bez PDV-a)</span><span class="v">${eur(p.ponuda, 2)}</span></div>
        <div class="ob-cmp-row"><span>Prihod bez PDV-a</span><span class="v">${usp !== null ? eur(usp, 2) : '<span style="color: var(--muted-2);">čeka PDV na uplatama</span>'}</span></div>
        ${razlika !== null ? `
        <div class="ob-cmp-row">
          <span><strong>Razlika</strong> <span style="color: var(--muted); font-size: 12.5px;">(dodatni radovi / gratis)</span></span>
          <span class="v" style="color: var(${razlika >= 0 ? '--positive' : '--negative'});">${v4SignEur(razlika, 2)}${Math.abs(razlika) >= 0.005 && razlikaPct !== null ? ` <span class="delta-chip ${razlika >= 0 ? 'up' : 'down'}">${v4SignPct(razlikaPct)}</span>` : ''}</span>
        </div>` : ''}
        ${planMarza !== null ? `
        <div class="ob-cmp-row">
          <span>Planirana marža po ponudi <span style="color: var(--muted); font-size: 12.5px;">(ponuda − trošak)</span></span>
          <span class="v">${v4SignEur(planMarza, 2)}${planMarzaPct !== null ? ' · ' + v4SignPct(planMarzaPct) : ''}</span>
        </div>` : ''}
        ${p.ponudaStavke.length ? `
        <div style="margin-top: 12px;">
          <button class="pill blue" type="button" id="ob-stavke-toggle" style="border: none; cursor: pointer; font-family: inherit;">${p.ponudaStavke.length} ${hrPlural(p.ponudaStavke.length, 'stavka', 'stavke', 'stavki')} ponude ▾</button>
          <div id="ob-stavke-box" style="display: none; margin-top: 10px;">
            <div class="table-scroll"><table class="table" style="font-size: 13px;"><tbody>
              ${p.ponudaStavke.map(it => `<tr><td>${escapeHtml(it.name || 'Stavka')}</td><td class="num text-right" style="color: var(--muted); white-space: nowrap;">${it.qty ? fmtQty(it.qty) + (it.unit ? ' ' + escapeHtml(it.unit) : '') : ''}</td><td class="num text-right" style="font-weight: 600;">${eur(Number(it.amount) || 0, 2)}</td></tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>` : ''}`
      : (isAdmin ? `
        <div class="ob-drop" id="ob-ponuda-drop">
          <strong>Ubaci ponudu · PDF, XLSX ili CSV</strong>
          <span>Stavke se iščitaju, pregledaš i potvrdiš ukupni iznos.<br>Sprema se iznos i stavke, ne datoteka.</span>
        </div>
        <input type="file" id="ob-ponuda-file" accept=".pdf,.xlsx,.xls,.csv" style="display: none;">
        <div style="text-align: center; margin-top: 10px;"><button class="btn btn-sm" id="ob-ponuda-manual">ili unesi iznos ručno</button></div>`
        : '<div class="empty">Ponuda još nije unesena.</div>');
    ponudaHtml = `
    <div class="card" style="margin-top: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title" style="font-size: 17px; color: var(--muted);">Ponuda <span style="font-weight: 400;">· referenca</span></div>
          <div class="card-sub">${hasPonuda ? 'Ne ulazi u obračun zarade, služi samo za usporedbu s prihodom' : 'Ručni unos ili upload: PDF, Excel ili CSV'}</div>
        </div>
        ${hasPonuda && isAdmin ? '<button class="btn btn-sm" id="ob-ponuda-edit">Uredi</button>' : ''}
      </div>
      ${ponudaInner}
    </div>`;
  }

  panel.innerHTML = `
    <div class="page-head">
      <div class="page-title-block">
        <button class="proj-back" id="proj-back">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          Svi projekti
        </button>
        <h1 class="page-title">${escapeHtml(displayName)} ${statusPill}</h1>
        <div class="card-sub" style="margin-top: 4px;">${subline}</div>
      </div>
      ${isAdmin && !isNone ? `
      <div class="page-actions">
        <button class="btn" id="ob-status">${p.zakljucen ? '↺ Ponovno otvori' : '✓ Zaključi projekt'}</button>
        <button class="btn btn-danger" id="proj-remove">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          Ukloni s pregleda
        </button>
      </div>` : ''}
    </div>

    ${isNone ? '' : v4PdvSectionHtml(p)}
    ${isNone ? noneKpi : v4KpiHtml(p)}
    ${srednjiHtml}
    ${isNone ? `<div style="margin-bottom: 24px;">${v4TrosakCardHtml(p, true)}</div>` : `
    <div class="v4-two">
      ${v4UplateCardHtml(p)}
      ${v4TrosakCardHtml(p, false)}
    </div>`}
    ${(!isNone && hasNapl && !p.pdvNijeOdabran) ? v4PdvCardHtml(p) : ''}
    ${isNone ? '' : `<p class="proj-formula" style="margin: 0 0 24px;">Prihod = uplaćeno − PDV na uplatama (PDV 25 %: uplata ÷ 1,25; prijenos porezne obveze: cijela uplata). Rad = sve plaće za mjesec rada: keš isplate iz Evidencije sati i službene plaće (neto i davanja) iz Troškova, u udjelu mjeseca prema satima projekta. Režija = fiksni troškovi bez plaća iz Troškova (tekući i nepredviđeni koji nisu na projektu), bez PDV-a koji se vraća, u istom udjelu. Zarada nakon materijala i rada = prihod − materijal − ostali troškovi − rad. Zarada = zarada nakon materijala i rada − režija. Marža = zarada ÷ prihod.</p>`}

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head"><div><div class="card-title">Trošak po mjesecima</div><div class="card-sub">Materijal bez PDV-a, rad i režija kroz vrijeme</div></div></div>
      <div class="chart-box"><canvas id="proj-chart-months"></canvas></div>
    </div>

    <div class="grid grid-cf" style="margin-bottom: 24px;">
      <div class="card">
        <div class="card-head"><div><div class="card-title">Po mjesecima</div><div class="card-sub">Udio mjeseca = sati projekta ÷ svi sati firme u mjesecu (uklj. godišnji)</div></div></div>
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Mjesec</th><th class="text-right">Sati</th><th class="text-right">Udio mj.</th><th class="text-right">Materijal</th><th class="text-right">Rad</th><th class="text-right">Režija</th><th class="text-right">Ukupno</th></tr></thead>
            <tbody>
              ${mKeys.map(k => {
                const m = p.months[k];
                const mat = round2(m.materijal / 1.25);
                return `
                <tr>
                  <td><strong>${monthLabel(k)}</strong>${(p.procjenaMonths || []).includes(k) ? ' <span class="pill amber" title="Plaće za taj mjesec još nisu upisane u Troškovima">procjena</span>' : ''}</td>
                  <td class="num text-right">${m.sati ? FMT_INT.format(m.sati) : '0'}</td>
                  <td class="num text-right" style="color: var(--muted);">${m.udio ? pct1(m.udio) : '0 %'}</td>
                  <td class="num text-right">${eur(mat, 0)}</td>
                  <td class="num text-right">${eur(m.rad, 0)}</td>
                  <td class="num text-right">${eur(m.rez, 0)}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(mat + m.rad + m.rez, 0)}</td>
                </tr>`;
              }).join('')}
            </tbody>
            <tfoot><tr><td>UKUPNO</td><td class="num text-right"><strong>${FMT_INT.format(p.sati)}</strong></td><td></td><td class="num text-right"><strong>${eur(p.materijalBezPdv, 0)}</strong></td><td class="num text-right"><strong>${eur(p.rad, 0)}</strong></td><td class="num text-right"><strong>${eur(p.rez, 0)}</strong></td><td class="num text-right"><strong>${eur(p.materijalBezPdv + p.rad + p.rez, 0)}</strong></td></tr></tfoot>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-head"><div><div class="card-title">Rad po radniku</div><div class="card-sub">Svaki sat nosi trošak mjeseca u kojem je odrađen</div></div></div>
        ${workers.length === 0 ? `<div class="empty">Nema evidentiranih sati za ovaj projekt.</div>` : `
        <div class="table-scroll">
          <table class="table">
            <thead><tr><th>Radnik</th><th class="text-right">Sati</th><th class="text-right">Dana</th><th class="text-right">Rad</th><th class="text-right">Režija</th><th class="text-right">Ukupno</th></tr></thead>
            <tbody>
              ${workers.map(w => `<tr><td><strong>${escapeHtml(w.name)}</strong></td><td class="num text-right">${FMT_INT.format(w.sati)}</td><td class="num text-right">${w.dani || 0}</td><td class="num text-right">${eur(w.rad, 0)}</td><td class="num text-right">${eur(w.rez, 0)}</td><td class="num text-right" style="font-weight: 600;">${eur(w.rad + w.rez, 0)}</td></tr>`).join('')}
            </tbody>
            <tfoot><tr><td>UKUPNO</td><td class="num text-right"><strong>${FMT_INT.format(p.sati)}</strong></td><td></td><td class="num text-right"><strong>${eur(p.rad, 0)}</strong></td><td class="num text-right"><strong>${eur(p.rez, 0)}</strong></td><td class="num text-right"><strong>${eur(p.rad + p.rez, 0)}</strong></td></tr></tfoot>
          </table>
        </div>`}
        <div class="proj-formula">Rad = udio × sve plaće tog mjeseca (keš isplate i službene plaće). Režija = udio × fiksni troškovi bez plaća tog mjeseca, bez PDV-a koji se vraća. Ništa nije prosjek: svaki mjesec nosi svoj stvarni trošak, pa kišni i prazni dani poskupljuju sat mjeseca u kojem su se dogodili. Isplaćeno radnicima po satnici za ove sate: ${eur(p.radIsplata, 0)}.</div>
      </div>
    </div>

    <div class="card" style="margin-top: 24px;">
      <div class="card-head"><div><div class="card-title">Materijal po stavkama</div><div class="card-sub">Što je točno potrošeno na projekt · iz uvezenih STO računa · iznosi s PDV-om</div></div></div>
      ${matRows.length === 0 ? `<div class="empty">Još nema razrade po stavkama za ovaj projekt.<br>Nove račune ubacuj kroz „Uvoz računa" u STO tabu i stavke će se ovdje same zbrajati.</div>` : `
      <div class="table-scroll">
        <table class="table mat-stavke-table">
          <thead><tr><th>Artikl</th><th class="text-right">Ukupna količina</th><th class="text-right">Iznos (s PDV)</th><th class="text-right">Udio u materijalu</th></tr></thead>
          <tbody>
            ${matRows.map(r => `<tr><td><strong>${escapeHtml(r.name)}</strong></td><td class="num text-right">${r.qty ? fmtQty(r.qty) + (r.unit ? ' ' + escapeHtml(r.unit) : '') : ''}</td><td class="num text-right" style="font-weight: 600;">${eur(r.amount, 2)}</td><td class="num text-right" style="color: var(--muted);">${p.materijal > 0 ? ((r.amount / p.materijal) * 100).toFixed(1).replace('.', ',') + ' %' : ''}</td></tr>`).join('')}
          </tbody>
          <tfoot>
            <tr><td>Σ razrađeno po stavkama</td><td></td><td class="num text-right"><strong>${eur(matTotal, 2)}</strong></td><td></td></tr>
            ${nonItemized > 0.005 ? `<tr><td style="color: var(--muted);">Materijal bez razrade (unosi bez stavki)</td><td></td><td class="num text-right" style="color: var(--muted);">${eur(nonItemized, 2)}</td><td></td></tr>` : ''}
          </tfoot>
        </table>
      </div>`}
    </div>

    ${ponudaHtml}
  `;

  panel.querySelector('#proj-back').addEventListener('click', () => {
    activeProject = null;
    if (v4Detalj.pregled) projectsGroup = null;
    v4Detalj = { proj: null, pregled: false };
    renderProjects();
  });
  panel.querySelector('#proj-remove')?.addEventListener('click', () => removeProjectModal(p.name));
  bindObracunDetail(panel, p);
  panel.querySelectorAll('[data-pdv-rezim]').forEach(b => b.addEventListener('click', async () => {
    if (!isAdmin) return;
    const val = b.dataset.pdvRezim;
    if (val !== 'pdv25' && val !== 'ppo') return;
    const rec = ensureObracunRec(p.name);
    const had = Object.prototype.hasOwnProperty.call(rec, 'pdvRezim');
    const prev = rec.pdvRezim;
    if (prev === val) return;
    rec.pdvRezim = val;
    if (await saveData()) {
      toast(val === 'pdv25' ? 'Uplate projekta: PDV 25 %' : 'Uplate projekta: prijenos porezne obveze', 'success');
      renderProjects();
    } else if (had) rec.pdvRezim = prev; else delete rec.pdvRezim;
  }));
  panel.querySelectorAll('[data-trx-open]').forEach(el => el.addEventListener('click', () => {
    const [mk, i] = el.dataset.trxOpen.split('|');
    activeMonth = mk;
    setTab('trx');
    if (isAdmin) trxModal(parseInt(i, 10));
  }));

  charts.projMonths?.destroy?.();
  const ctx = document.getElementById('proj-chart-months');
  if (ctx && typeof Chart !== 'undefined') {
    charts.projMonths = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: mKeys.map(monthLabelShort),
        datasets: [
          { label: 'Materijal', data: mKeys.map(k => round2(p.months[k].materijal / 1.25)), backgroundColor: cssVar('--acc-sto'), borderRadius: 6, stack: 's' },
          { label: 'Rad', data: mKeys.map(k => p.months[k].rad), backgroundColor: cssVar('--acc-hours'), borderRadius: 6, stack: 's' },
          { label: 'Režija', data: mKeys.map(k => p.months[k].rez), backgroundColor: '#6f8196', borderRadius: 6, stack: 's' },
        ],
      },
      options: {
        ...chartOpts({ legend: true, money: true }),
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { family: cssVar('--font-body'), size: 11 }, color: cssVar('--muted') } },
          y: { stacked: true, grid: { color: cssVar('--line'), drawBorder: false }, ticks: { font: { family: cssVar('--font-mono'), size: 11 }, color: cssVar('--muted'), callback: v => eurShort(v) } },
        },
      },
    });
  }
}

/* ---------- Modali: radio-kartice ---------- */
function v4OptsHtml(opts, cur) {
  return opts.map(([id, t, s]) => `
    <button type="button" class="v4-opt${cur === id ? ' on' : ''}" data-opt="${id}" aria-pressed="${cur === id ? 'true' : 'false'}">
      <span class="v4-radio"></span>
      <span class="v4-opt-txt"><span class="t">${t}</span>${s ? `<span class="s">${escapeHtml(s)}</span>` : ''}</span>
    </button>`).join('');
}

/* Nova / uredi uplata za projekt · s PDV-om na uplati */
function obUplataModal(projName, idx = null) {
  const rec = ensureObracunRec(projName);
  const list = rec.uplate;
  const u = idx !== null ? list[idx] : { date: todayISO(), amount: 0, note: '' };
  if (!u) return;
  const rezim = (rec.pdvRezim === 'pdv25' || rec.pdvRezim === 'ppo') ? rec.pdvRezim : null;
  let mode = (u.pdv === 'pdv25' || u.pdv === 'ppo') ? u.pdv : 'projekt';
  const opts = [
    ['projekt', 'Kao projekt', rezim ? `${rezim === 'pdv25' ? 'PDV 25 %' : 'Prijenos porezne obveze'} · postavka projekta ${projName}` : 'Projekt još nema odabran PDV na uplatama'],
    ['pdv25', 'PDV 25 %', 'Građanin, zgrada ili firma izvan sustava PDV-a'],
    ['ppo', 'Prijenos porezne obveze', 'Firma u sustavu PDV-a, građevinski radovi'],
  ];
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi uplatu' : 'Nova uplata'} · ${escapeHtml(projName)}</div>
    <div class="modal-sub">Upiši iznos koji je stigao na račun. Osnovicu i PDV aplikacija računa sama.</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label" for="ou-date">Datum</label><input class="input" id="ou-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(u.date)}"></div>
      <div class="field"><label class="field-label" for="ou-amount">Uplaćeno na račun (€)</label><input class="input num" id="ou-amount" type="text" inputmode="decimal" placeholder="0,00" value="${u.amount ? formatEUAmount(u.amount) : ''}"></div>
    </div>
    <div class="field" style="margin-top: 16px;"><span class="field-label">PDV na ovoj uplati</span><div class="v4-opts" id="ou-opts"></div></div>
    <div class="v4-sum" id="ou-sum"></div>
    <div class="field" style="margin-top: 14px;"><label class="field-label" for="ou-note">Opis (opcionalno)</label><input class="input" id="ou-note" value="${escapeHtml(u.note || '')}" placeholder="Npr. avans, 1. situacija, dodatni radovi"></div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>`;
  const m = modal(html, { wide: true });
  const dateInp = m.root.querySelector('#ou-date');
  const amountInp = m.root.querySelector('#ou-amount');
  const optsBox = m.root.querySelector('#ou-opts');
  const sumBox = m.root.querySelector('#ou-sum');
  attachEUDateMask(dateInp);
  attachEUAmountMask(amountInp);
  const renderOpts = () => { optsBox.innerHTML = v4OptsHtml(opts, mode); };
  const renderSum = () => {
    const a = round2(parseEUAmount(amountInp.value));
    const eff = mode === 'projekt' ? rezim : mode;
    if (!(a > 0)) { sumBox.innerHTML = '<div class="v4-sum-note" style="border: none; padding: 0;">Upiši iznos uplate, npr. 36.486,25</div>'; return; }
    if (!eff) { sumBox.innerHTML = '<div class="v4-sum-row"><span>Osnovica <em>· prihod projekta</em></span><span>?</span></div><div class="v4-sum-note">Odaberi PDV na ovoj uplati ili na projektu.</div>'; return; }
    const osn = eff === 'pdv25' ? round2(a / 1.25) : a;
    sumBox.innerHTML = `
      <div class="v4-sum-row"><span>Osnovica <em>· prihod projekta</em></span><span>${eur(osn, 2)}</span></div>
      <div class="v4-sum-row"><span>PDV <em>· ide državi</em></span><span>${eur(round2(a - osn), 2)}</span></div>
      <div class="v4-sum-note">${eff === 'pdv25' ? 'Osnovica = uplata ÷ 1,25 · PDV = uplata − osnovica' : 'Cijela uplata je prihod · PDV obračunava investitor kod sebe'}</div>`;
  };
  renderOpts(); renderSum();
  if (idx === null) setTimeout(() => amountInp.focus(), 50);
  amountInp.addEventListener('input', renderSum);
  amountInp.addEventListener('blur', renderSum);
  optsBox.addEventListener('click', e => {
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    mode = b.dataset.opt; renderOpts(); renderSum();
  });
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'del') {
      if (!confirm('Obrisati ovu uplatu?')) return;
      const snapshot = JSON.stringify(list);
      list.splice(idx, 1);
      if (await saveData()) { m.close(); renderProjects(); } else rec.uplate = JSON.parse(snapshot);
      return;
    }
    if (btn.dataset.act === 'save') {
      const date = euToISO(dateInp.value.trim());
      if (!date) { toast('Datum mora biti u formatu DD/MM/YYYY', 'error'); dateInp.classList.add('invalid'); dateInp.focus(); return; }
      const amount = round2(parseEUAmount(amountInp.value));
      if (!(amount > 0)) { toast('Unesi iznos uplate', 'error'); amountInp.focus(); return; }
      const newU = { ...u, date, amount, note: m.root.querySelector('#ou-note').value.trim() };
      if (mode === 'projekt') delete newU.pdv; else newU.pdv = mode;
      if (!newU.created) newU.created = nowISO();
      const snapshot = JSON.stringify(list);
      if (idx !== null) list[idx] = newU; else list.push(newU);
      if (await saveData()) { m.close(); renderProjects(); } else rec.uplate = JSON.parse(snapshot);
    }
  });
}

/* Novi / uredi ručni trošak projekta · iznos računa i PDV na računu */
function obTrosakModal(projName, idx = null) {
  const rec = ensureObracunRec(projName);
  const list = rec.troskovi;
  const t = idx !== null ? list[idx] : { date: todayISO(), amount: 0, note: '' };
  if (!t) return;
  let mode = PDV_PRESETS[t.pdv] ? t.pdv : (idx !== null ? 'bez' : 'p25');
  const racun0 = PDV_PRESETS[t.pdv] ? (Number(t.iznosRacuna) || 0) : (Number(t.amount) || 0);
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi trošak' : 'Novi trošak'} · ${escapeHtml(projName)}</div>
    <div class="modal-sub">Upiši ukupan iznos s računa i odaberi kakav je PDV na njemu. Trošak projekta aplikacija računa sama.</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label" for="ot-date">Datum računa</label><input class="input" id="ot-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(t.date)}"></div>
      <div class="field"><label class="field-label" for="ot-amount">Iznos računa · ukupno za platiti (€)</label><input class="input num" id="ot-amount" type="text" inputmode="decimal" placeholder="0,00" value="${racun0 ? formatEUAmount(racun0) : ''}"></div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label" for="ot-note">Dobavljač i opis</label><input class="input" id="ot-note" value="${escapeHtml(t.note || '')}" placeholder="Npr. podizvođač za knauf, najam skele, kontejner"></div>
    </div>
    <div class="field" style="margin-top: 16px;"><span class="field-label">PDV na računu</span><div class="v4-opts" id="ot-opts"></div></div>
    <div class="v4-sum" id="ot-sum"></div>
    <div style="font-size: 12.5px; color: var(--muted); margin-top: 10px;">PDV se vraća samo s računa koji glasi na Staru Rijeku (naziv i OIB firme). Na računu bez PDV-a nema se što vratiti.</div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>`;
  const m = modal(html, { wide: true });
  const dateInp = m.root.querySelector('#ot-date');
  const amountInp = m.root.querySelector('#ot-amount');
  const optsBox = m.root.querySelector('#ot-opts');
  const sumBox = m.root.querySelector('#ot-sum');
  attachEUDateMask(dateInp);
  attachEUAmountMask(amountInp);
  const opts = PDV_ORDER.map(id => [id, PDV_PRESETS[id].naziv, PDV_PRESETS[id].sub]);
  const renderOpts = () => { optsBox.innerHTML = v4OptsHtml(opts, mode); };
  const renderSum = () => {
    const a = round2(parseEUAmount(amountInp.value));
    if (!(a > 0)) { sumBox.innerHTML = '<div class="v4-sum-note" style="border: none; padding: 0;">Upiši iznos s računa, npr. 1.250,00</div>'; return; }
    const s = pdvSplit(a, mode);
    sumBox.innerHTML = `
      <div class="v4-sum-row"><span>PDV na računu</span><span>${eur(s.pdvRac, 2)}</span></div>
      <div class="v4-sum-row"><span>Vraća se firmi <em>· pretporez</em></span><span>${eur(s.vraca, 2)}</span></div>
      <div class="v4-sum-row tot"><span>Trošak projekta</span><span>${eur(s.trosak, 2)}</span></div>
      <div class="v4-sum-note">${PDV_PRESETS[mode].note}</div>`;
  };
  renderOpts(); renderSum();
  if (idx === null) setTimeout(() => amountInp.focus(), 50);
  amountInp.addEventListener('input', renderSum);
  amountInp.addEventListener('blur', renderSum);
  optsBox.addEventListener('click', e => {
    const b = e.target.closest('[data-opt]');
    if (!b) return;
    mode = b.dataset.opt; renderOpts(); renderSum();
  });
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    if (btn.dataset.act === 'del') {
      if (!confirm('Obrisati ovaj trošak?')) return;
      const snapshot = JSON.stringify(list);
      list.splice(idx, 1);
      if (await saveData()) { m.close(); renderProjects(); } else rec.troskovi = JSON.parse(snapshot);
      return;
    }
    if (btn.dataset.act === 'save') {
      const date = euToISO(dateInp.value.trim());
      if (!date) { toast('Datum mora biti u formatu DD/MM/YYYY', 'error'); dateInp.classList.add('invalid'); dateInp.focus(); return; }
      const racun = round2(parseEUAmount(amountInp.value));
      if (!(racun > 0)) { toast('Unesi iznos računa', 'error'); amountInp.focus(); return; }
      const s = pdvSplit(racun, mode);
      const newT = { ...t, date, iznosRacuna: racun, pdv: mode, amount: s.trosak, note: m.root.querySelector('#ot-note').value.trim() };
      if (!newT.created) newT.created = nowISO();
      const snapshot = JSON.stringify(list);
      if (idx !== null) list[idx] = newT; else list.push(newT);
      if (await saveData()) { m.close(); renderProjects(); } else rec.troskovi = JSON.parse(snapshot);
    }
  });
}

/* ============================================================
   v4 · TROŠKOVI: transakcija (PDV na računu, kamo ide trošak),
   oznake u tablici, ponavljajući troškovi iz Prognoze
   ============================================================ */
const KAMO_OPCIJE = [
  ['projekt', 'Na projekt', 'Materijal, podizvođač ili najam za jedno gradilište'],
  ['rezija', 'Režija', 'Dijeli se na projekte mjeseca prema satima'],
  ['ulaganje', 'Ulaganje', 'Vozilo, stroj ili alat: raspodijeli se na mjesece'],
  ['ne', 'Ne ide u projekte', 'Uplata PDV-a, pozajmica, kredit, plaće koje su već u radu'],
];

function trxChipsHtml(t) {
  const out = [];
  if (t.type === 'Trošak') {
    const d = trxDestInfo(t);
    if (d.dest === 'projekt') out.push(`<span class="pill brown">→ ${escapeHtml(t.proj)}</span>`);
    else if (d.dest === 'projekt-bez') out.push('<span class="pill red" title="Trošak ide na projekt, a projekt nije odabran">projekt?</span>');
    else if (d.dest === 'ulaganje') out.push(`<span class="pill purple">ulaganje · ${Math.max(1, Math.round(Number(t.ulaganjeMj) || 60))} mj.</span>`);
    else if (t.dest === 'ne') out.push('<span class="pill gray">ne ide u projekte</span>');
    if (PDV_PRESETS[t.pdv]) out.push(`<span class="pill gray" title="PDV odabran za ovaj račun">${PDV_PRESETS[t.pdv].kratko}</span>`);
  } else if (t.type === 'Prihod' && t.proj) {
    out.push(t.proj === '__ne__' ? '<span class="pill gray">nije za projekt</span>' : `<span class="pill brown">→ ${escapeHtml(t.proj)}</span>`);
  }
  return out.length ? `<div class="v4-chips">${out.join('')}</div>` : '';
}

/* Ponavljajući troškovi iz Prognoze za mjesec (kartica u Troškovima) */
function v4PonavljajuciHtml(key) {
  const st = prognozaStatusZaMjesec(key);
  if (!st.stavke.length) return '';
  const zbroj = (s) => round2(st.stavke.filter(x => x.status === s).reduce((a, x) => a + (s === 'placeno' ? x.placeno : x.iznos), 0));
  const PILL = {
    placeno: '<span class="pill green">Plaćeno</span>',
    ocekivano: '<span class="pill purple">Očekivano</span>',
    procjena: '<span class="pill amber">Procjena</span>',
    nema: '<span class="pill red">Nema u Troškovima</span>',
  };
  const sum = [['placeno', 'plaćeno'], ['ocekivano', 'očekivano'], ['procjena', 'procjena'], ['nema', 'nema u Troškovima']]
    .filter(([s]) => st.stavke.some(x => x.status === s))
    .map(([s, l]) => `${l} <strong>${eur(zbroj(s), 2)}</strong>`).join(' · ');
  const rows = st.stavke.map(x => {
    const partneri = Array.from(new Set(x.matched.map(t => t.partner))).join(', ');
    const datumi = x.matched.map(t => dmEU(t.date)).join(', ');
    return `
      <tr>
        <td><strong>${escapeHtml(x.it.label || '')}</strong>${x.placa && x.items ? `<div class="v4-sub">${x.items.map(i => escapeHtml(i.label)).join(' · ')}</div>` : ''}</td>
        <td>${partneri ? escapeHtml(partneri) : '<span style="color: var(--muted-2);">nema</span>'}</td>
        <td class="num text-right" style="font-weight: 600;">${eur(x.status === 'placeno' ? x.placeno : x.iznos, 2)}${x.status === 'placeno' && Math.abs(x.placeno - x.iznos) > 0.5 ? `<div class="v4-sub">u Prognozi ${eur(x.iznos, 2)}</div>` : ''}</td>
        <td>${PILL[x.status] || ''}</td>
        <td class="col-date num">${datumi}</td>
      </tr>`;
  }).join('');
  return `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Ponavljajući troškovi · ${monthLabel(key)}</div>
          <div class="card-sub">Iz Prognoze. Stavka je plaćena kad u Troškovima tog mjeseca postoji transakcija istog partnera · ${sum}</div>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table v4-tbl">
          <thead><tr><th>Stavka</th><th>Partner u Troškovima</th><th class="text-right">Iznos</th><th>Status</th><th>Datum</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* Učinak odluke "kamo ide trošak" za transakciju (tekst u modalu) */
function v4KamoUcinak(t, destEff, proj, ulMj, mode) {
  const s = pdvSplit(t.amount, mode);
  const mk = String(t.date || activeMonth).slice(0, 7);
  if (!(s.racun > 0)) return { cls: 'neutral', title: 'Upiši iznos', text: 'Učinak se računa iz iznosa računa i PDV-a.' };
  if (destEff === 'projekt') {
    if (!proj) return { cls: 'warn', title: 'Odaberi projekt', text: 'Dok se ne odabere projekt, trošak ne ulazi ni u jedan projekt ni u režiju, a na Pregledu projekata stoji upozorenje.' };
    const ob = state.obracun && state.obracun[proj];
    const rijec = srPrvaRijec(t.partner);
    const pok = (ob && Array.isArray(ob.troskovi) && rijec) ? ob.troskovi.find(r => srNorm(r.note).includes(rijec)) : null;
    if (pok) return { cls: 'ok', title: `Ide na projekt ${proj}`, text: `Projekt već ima ručni trošak „${pok.note}" ${eur(Number(pok.amount) || 0, 2)}. Ova transakcija se vodi kao njegov dio i ne broji se dvaput.` };
    return { cls: 'ok', title: `Ide na projekt ${proj}`, text: `${proj} nosi cijeli trošak: ${eur(s.trosak, 2)} bez PDV-a. Režija ${monthGenHr(mk)} manja je za isti iznos, pa svim projektima tog mjeseca pada udio režije.` };
  }
  if (destEff === 'ulaganje') {
    const n = Math.max(1, Math.round(Number(ulMj) || 60));
    return { cls: 'neutral', title: `Raspodijeljeno na ${n} mjeseci`, text: `${eur(round2(s.trosak / n), 2)} mjesečno ide u režiju, od ${monthGenHr(mk)} ${mk.slice(0, 4)}.` };
  }
  if (destEff === 'ne') return { cls: 'neutral', title: 'Ne ide u projekte', text: 'Vidi se samo u Cashflowu. Na zaradu projekata ne utječe.' };
  if (destEff === 'rezija') {
    let detalj = '';
    try {
      const all = computeProjectsData();
      const f = all.firma[mk];
      if (f && f.satiUk > 0) {
        const dijelovi = all.filter(p => p.months[mk] && p.months[mk].sati > 0 && p.name !== PROJ_GODISNJI)
          .map(p => ({ n: p.name === PROJ_NONE ? 'sati bez projekta' : p.name, h: p.months[mk].sati }))
          .sort((a, b) => b.h - a.h);
        const top = dijelovi.slice(0, 2).map(d => `${d.n} ${eur(round2(s.trosak * d.h / f.satiUk), 2)} (${pct1(d.h / f.satiUk * 100)})`);
        const ostH = dijelovi.slice(2).reduce((a, d) => a + d.h, 0) + (f.godH || 0);
        if (ostH > 0) top.push(`ostali ${eur(round2(s.trosak * ostH / f.satiUk), 2)}`);
        detalj = ` dijeli se prema satima ${monthGenHr(mk)} (${FMT_INT.format(f.satiUk)} h): ${top.join(', ')}.`;
      } else detalj = ` dijeli se na projekte ${monthGenHr(mk)} prema satima.`;
    } catch (e) { detalj = ` dijeli se na projekte ${monthGenHr(mk)} prema satima.`; }
    return { cls: 'neutral', title: `Ide u režiju ${monthGenHr(mk)}`, text: `${eur(s.trosak, 2)} bez PDV-a${detalj}` };
  }
  return { cls: 'neutral', title: 'Nije trošak', text: 'Prihodi i isključene stavke ne ulaze u režiju ni u projekte.' };
}

function trxModal(idx = null) {
  ensureMonth(activeMonth);
  const t0 = idx !== null ? state.trx[activeMonth][idx] : { date: localTodayISO(), type: 'Trošak', partner: '', amount: 0, category: '', group: 'Tekući' };
  if (!t0) return;
  const partners = Array.from(new Set(allMonths().flatMap(k => (state.trx[k] || []).map(x => x.partner)).filter(Boolean))).sort();
  const cats = Array.from(new Set([...TRX_CATEGORIES, ...allMonths().flatMap(k => (state.trx[k] || []).map(x => x.category)).filter(Boolean)])).sort();
  const projekti = projektImena();
  let pdvOverride = PDV_PRESETS[t0.pdv] ? t0.pdv : '';
  let dest = t0.dest || '';
  let destTouched = false;
  let proj = (t0.proj && t0.proj !== '__ne__') ? t0.proj : '';
  let ulMj = Math.max(1, Math.round(Number(t0.ulaganjeMj) || 60));
  let pdvOpen = !!pdvOverride;
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} transakciju</div>
    <div class="modal-sub">${monthLabel(activeMonth)}</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="t-date" type="text" inputmode="numeric" placeholder="DD/MM/YYYY" maxlength="10" value="${isoToEU(t0.date)}"></div>
      <div class="field"><label class="field-label">Tip</label>
        <select class="select" id="t-type">${TRX_TYPES.map(x => `<option ${x === t0.type ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Partner</label>
        <input class="input" id="t-partner" list="t-partners" value="${escapeHtml(t0.partner)}" placeholder="Npr. Hrvatski Telekom">
        <datalist id="t-partners">${partners.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
      </div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input num" id="t-amount" type="text" inputmode="decimal" placeholder="0,00" value="${formatEUAmount(t0.amount)}"></div>
      <div class="field"><label class="field-label">Grupa</label>
        <select class="select" id="t-group">${TRX_GROUPS.map(x => `<option ${x === t0.group ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Kategorija</label>
        <input class="input" id="t-category" list="t-cats" value="${escapeHtml(t0.category)}" placeholder="Npr. Knjigovodstvo">
        <datalist id="t-cats">${cats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
    </div>
    <div id="t-v4"></div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html, { wide: true });
  attachEUDateMask(m.root.querySelector('#t-date'));
  attachEUAmountMask(m.root.querySelector('#t-amount'));
  const typeSel = m.root.querySelector('#t-type');
  const groupSel = m.root.querySelector('#t-group');
  const box = m.root.querySelector('#t-v4');
  const cur = () => ({
    ...t0,
    type: typeSel.value,
    group: groupSel.value,
    partner: m.root.querySelector('#t-partner').value.trim(),
    amount: round2(parseEUAmount(m.root.querySelector('#t-amount').value)),
    category: m.root.querySelector('#t-category').value.trim(),
    date: euToISO(m.root.querySelector('#t-date').value.trim()) || t0.date,
    pdv: pdvOverride || undefined,
    dest: dest || undefined,
    proj: dest === 'projekt' ? proj : undefined,
  });
  let prihodProj = t0.proj || '';
  let prihodPdv = '';
  const renderV4 = () => {
    const t = cur();
    if (t.type === 'Trošak' && (t.group === 'Tekući' || t.group === 'Nepredviđeni')) {
      const pm = trxPdvMode({ ...t, pdv: pdvOverride || undefined });
      const P = PDV_PRESETS[pm.mode];
      const izvorTxt = pm.izvor === 'racun' ? 'odabrano za ovaj račun' : (pm.izvor === 'pravilo' ? `pravilo partnera: ${pm.pravilo.naziv}` : 'nema pravila za partnera: ništa se ne vraća');
      const tAuto = { ...t, dest: undefined, proj: undefined };
      const auto = trxDestInfo(tAuto);
      const destEff = dest || (auto.dest === 'projekt-bez' ? 'projekt' : auto.dest);
      const autoTxt = !dest ? (auto.izvor === 'pravilo' ? `prema pravilu partnera (${auto.pravilo.naziv})` : (auto.izvor === 'kategorija' ? `prema kategoriji ${t.category}` : 'tekući i nepredviđeni troškovi idu u režiju')) : 'odabrano za ovu transakciju';
      const uc = v4KamoUcinak(t, destEff, proj, ulMj, pm.mode);
      box.innerHTML = `
        <div class="v4-pdvrow">
          <div style="min-width: 0;">
            <div class="field-label">PDV na računu</div>
            <div style="margin-top: 3px;"><span class="pill pdv25">${P.naziv}</span> <span style="font-size: 12.5px; color: var(--muted);">${escapeHtml(izvorTxt)}</span></div>
            <div class="mono" style="font-size: 12.5px; color: var(--ink-2); margin-top: 4px;">${t.amount > 0 ? `PDV na računu ${eur(pdvSplit(t.amount, pm.mode).pdvRac, 2)} · vraća se ${eur(pdvSplit(t.amount, pm.mode).vraca, 2)} · trošak ${eur(pdvSplit(t.amount, pm.mode).trosak, 2)}` : ''}</div>
          </div>
          <button type="button" class="btn btn-sm" data-v4="pdv-open">${pdvOpen ? 'Sakrij' : 'Promijeni za ovaj račun'}</button>
        </div>
        ${pdvOpen ? `<div class="field" style="margin-top: 8px;"><select class="select" id="t-pdv"><option value="">Prema pravilu partnera</option>${PDV_ORDER.map(id => `<option value="${id}" ${pdvOverride === id ? 'selected' : ''}>${PDV_PRESETS[id].naziv}</option>`).join('')}</select></div>` : ''}
        <div class="field" style="margin-top: 16px;">
          <span class="field-label">Kamo ide trošak <span style="font-weight: 400;">· ${escapeHtml(autoTxt)}</span></span>
          <div class="v4-opts">${v4OptsHtml(KAMO_OPCIJE.slice(0, 1), destEff)}
            <div class="field" style="padding: 0 0 4px 44px;"><select class="select" id="t-proj"><option value="">Odaberi projekt</option>${projekti.map(n => `<option value="${escapeHtml(n)}" ${proj === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}</select></div>
            ${v4OptsHtml(KAMO_OPCIJE.slice(1, 3), destEff)}
            ${destEff === 'ulaganje' ? `<div class="field" style="padding: 0 0 4px 44px; max-width: 280px;"><label class="field-label">Broj mjeseci</label><input class="input num" id="t-ulmj" type="number" min="1" max="240" step="1" value="${ulMj}"></div>` : ''}
            ${v4OptsHtml(KAMO_OPCIJE.slice(3), destEff)}
          </div>
        </div>
        <div class="v4-effect ${uc.cls}"><div class="t">${escapeHtml(uc.title)}</div><div>${escapeHtml(uc.text)}</div></div>`;
    } else if (t.type === 'Prihod') {
      const ime = prihodProj && prihodProj !== '__ne__' ? prihodProj : '';
      const ob = ime && state.obracun ? state.obracun[ime] : null;
      const postoji = ob && Array.isArray(ob.uplate) ? ob.uplate.find(u => Math.abs((Number(u.amount) || 0) - t.amount) < 0.011 && u.date && Math.abs(dayDiff(u.date, t.date)) <= 10) : null;
      box.innerHTML = `
        <div class="grid grid-2" style="gap: 14px; margin-top: 16px;">
          <div class="field"><label class="field-label">Uplata za projekt</label>
            <select class="select" id="t-pproj"><option value="">Nije raspoređeno</option>${projekti.map(n => `<option value="${escapeHtml(n)}" ${prihodProj === n ? 'selected' : ''}>${escapeHtml(n)}</option>`).join('')}<option value="__ne__" ${prihodProj === '__ne__' ? 'selected' : ''}>Nije za projekt</option></select>
          </div>
          ${ime && !postoji && ime !== (t0.proj || '') ? `<div class="field"><label class="field-label">PDV na uplati</label><select class="select" id="t-ppdv"><option value="">Kao projekt</option><option value="pdv25" ${prihodPdv === 'pdv25' ? 'selected' : ''}>PDV 25 %</option><option value="ppo" ${prihodPdv === 'ppo' ? 'selected' : ''}>Prijenos porezne obveze</option></select></div>` : ''}
        </div>
        <div class="v4-effect neutral"><div>${ime
          ? (postoji ? `Uplata je već upisana na projektu ${escapeHtml(ime)} (${isoToEU(postoji.date)}).` : (ime === (t0.proj || '') ? `Uplata je raspoređena na projekt ${escapeHtml(ime)}.` : `Spremanjem se uplata dodaje na projekt ${escapeHtml(ime)}.`))
          : (prihodProj === '__ne__' ? 'Nije prihod projekta (npr. povrat, odšteta, prodaja vozila).' : 'Uplata još nije ni na jednom projektu. Prihod projekta računa se iz uplata na projektu.')}</div></div>`;
    } else {
      box.innerHTML = '';
    }
  };
  renderV4();
  typeSel.addEventListener('change', () => {
    if (typeSel.value === 'Prihod') groupSel.value = 'Prihodi';
    else if (groupSel.value === 'Prihodi') groupSel.value = 'Tekući';
    renderV4();
  });
  groupSel.addEventListener('change', renderV4);
  m.root.querySelector('#t-partner').addEventListener('change', renderV4);
  m.root.querySelector('#t-amount').addEventListener('blur', renderV4);
  m.root.querySelector('#t-category').addEventListener('change', renderV4);
  m.root.querySelector('#t-date').addEventListener('blur', renderV4);
  box.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 't-pdv') { pdvOverride = el.value; renderV4(); }
    else if (el.id === 't-proj') { proj = el.value; dest = 'projekt'; destTouched = true; renderV4(); }
    else if (el.id === 't-ulmj') { ulMj = Math.max(1, Math.round(Number(el.value) || 60)); renderV4(); }
    else if (el.id === 't-pproj') { prihodProj = el.value; renderV4(); }
    else if (el.id === 't-ppdv') { prihodPdv = el.value; }
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-opt]');
    if (b) { dest = b.dataset.opt; destTouched = true; renderV4(); return; }
    const p = e.target.closest('[data-v4="pdv-open"]');
    if (p) { pdvOpen = !pdvOpen; renderV4(); }
  });

  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati ovu transakciju?')) {
        const snapDel = JSON.stringify(state);
        state.trx[activeMonth].splice(idx, 1);
        if (await saveData()) { m.close(); renderTrx(); }
        else state = JSON.parse(snapDel);
      }
    } else if (btn.dataset.act === 'save') {
      const dateEU = m.root.querySelector('#t-date').value.trim();
      const date = euToISO(dateEU);
      if (!date) {
        toast('Datum mora biti u formatu DD/MM/YYYY', 'error');
        m.root.querySelector('#t-date').classList.add('invalid');
        m.root.querySelector('#t-date').focus();
        return;
      }
      const newT = {
        ...t0,
        date,
        type: typeSel.value,
        partner: m.root.querySelector('#t-partner').value.trim(),
        amount: parseEUAmount(m.root.querySelector('#t-amount').value),
        category: m.root.querySelector('#t-category').value.trim(),
        group: groupSel.value,
      };
      if (!newT.partner) { toast('Unesi partnera', 'error'); return; }
      if (!newT.amount) { toast('Unesi iznos', 'error'); return; }
      const snap = JSON.stringify(state);
      if (newT.type === 'Trošak') {
        if (pdvOverride) newT.pdv = pdvOverride; else delete newT.pdv;
        if (destTouched) {
          if (dest === 'projekt' && !proj) { toast('Odaberi projekt ili drugo odredište', 'error'); return; }
          newT.dest = dest;
          if (dest === 'projekt') newT.proj = proj; else delete newT.proj;
          if (dest === 'ulaganje') newT.ulaganjeMj = ulMj; else delete newT.ulaganjeMj;
        }
      } else if (newT.type === 'Prihod') {
        const prev = t0.proj || '';
        if (prihodProj !== prev) {
          if (!prihodProj) delete newT.proj;
          else if (prihodProj === '__ne__') newT.proj = '__ne__';
          else {
            newT.proj = prihodProj;
            const rec = ensureObracunRec(prihodProj);
            const postoji = rec.uplate.find(u => Math.abs((Number(u.amount) || 0) - newT.amount) < 0.011 && u.date && Math.abs(dayDiff(u.date, date)) <= 10);
            if (!postoji) {
              const u = { date, amount: round2(newT.amount), note: newT.partner, created: nowISO(), izTroskova: true };
              if (prihodPdv) u.pdv = prihodPdv;
              rec.uplate.push(u);
            }
          }
        }
      }
      const targetMonth = date.slice(0, 7);
      ensureMonth(targetMonth);
      if (idx !== null) {
        if (targetMonth !== activeMonth) {
          state.trx[activeMonth].splice(idx, 1);
          state.trx[targetMonth].push(newT);
        } else {
          state.trx[activeMonth][idx] = newT;
        }
      } else {
        state.trx[targetMonth].push(newT);
      }
      if (await saveData()) {
        m.close();
        if (targetMonth !== activeMonth) {
          activeMonth = targetMonth;
          toast(`Transakcija u ${monthLabel(targetMonth)}`, 'success');
        }
        rerenderActive();
      } else {
        state = JSON.parse(snap);
      }
    }
  });
}

/* ============================================================
   v4 · PROJEKTI · PREGLED (upozorenja, firma mjesečno, usporedba)
   ============================================================ */
function v4Upozorenja(all) {
  const out = [];
  const pb = prihodiBezProjekta();
  if (pb.length) {
    const sum = round2(pb.reduce((a, x) => a + (Number(x.t.amount) || 0), 0));
    const top = pb.slice().sort((a, b) => (Number(b.t.amount) || 0) - (Number(a.t.amount) || 0)).slice(0, 2).map(x => `${escapeHtml(x.t.partner)} ${eur(Number(x.t.amount) || 0, 2)} (${isoToEU(x.t.date)})`);
    out.push({ k: 'uplate', html: `<strong>Uplate bez projekta:</strong> ${pb.length} ${hrPlural(pb.length, 'uplata', 'uplate', 'uplata')} · ${eur(sum, 2)}${top.length ? ' · najveće: ' + top.join(', ') : ''}`, btn: 'Rasporedi' });
  }
  const tb = troskoviBezProjekta();
  if (tb.length) {
    const lst = tb.slice(0, 3).map(x => `${escapeHtml(x.t.partner)} ${eur(Number(x.t.amount) || 0, 2)} (${isoToEU(x.t.date)})`).join(', ');
    out.push({ k: 'troskovi', html: `<strong>Trošak za projekt, a projekt nije odabran:</strong> ${lst}${tb.length > 3 ? ` i još ${tb.length - 3}` : ''}`, btn: 'Rasporedi' });
  }
  const hidden = new Set(state.hiddenProjects || []);
  const bezPdv = all.filter(p => p.name !== PROJ_NONE && p.name !== PROJ_GODISNJI && !hidden.has(p.name) && p.pdvNijeOdabran && p.uplateInfo.length);
  if (bezPdv.length) out.push({ k: 'pdv', html: `<strong>PDV na uplatama nije odabran:</strong> ${bezPdv.map(p => escapeHtml(p.name)).join(', ')}. Zarada se ne prikazuje dok se ne odabere je li račun s PDV-om ili s prijenosom porezne obveze.`, btn: 'Odaberi', proj: bezPdv[0].name });
  const nep = Object.keys(all.firma || {}).filter(k => all.firma[k].nepotpun && all.firma[k].satiOdradeni > 0).sort();
  if (nep.length) out.push({ k: 'nepotpun', html: `<strong>${nep.map(monthLabel).join(', ')}:</strong> u evidenciji je manje od pola mogućih sati, pa zarada projekata iz ${nep.length === 1 ? 'tog mjeseca' : 'tih mjeseci'} čeka. Ako je bio godišnji, upiši datume u Registar.`, btn: 'Otvori Registar' });
  const velike = [];
  for (const mk of Object.keys(state.trx || {}).sort()) (state.trx[mk] || []).forEach((t, i) => { if (!t.dest && Number(t.amount) >= 10000 && trxDestInfo(t).dest === 'rezija') velike.push({ t, mk, i }); });
  if (velike.length) {
    const v = velike[0];
    out.push({ k: 'velika', html: `<strong>Velika stavka u režiji:</strong> ${escapeHtml(v.t.partner)} ${eur(Number(v.t.amount) || 0, 2)} (${isoToEU(v.t.date)})${velike.length > 1 ? ` i još ${velike.length - 1}` : ''}. Diže trošak firme za ${monthAccHr(v.mk)}; ako je to vozilo ili stroj, označi je kao ulaganje, a ako nije plaćeno s računa firme, isključi je.`, btn: 'Uredi', ref: { mk: v.mk, i: v.i } });
  }
  return out;
}

function v4FirmaHtml(all) {
  const f = all.firma || {};
  const keys = Object.keys(f).filter(k => f[k].satiUk > 0 && !f[k].inProgress).sort();
  if (!keys.length) return '';
  const n = keys.length;
  const avg = (fn) => keys.reduce((a, k) => a + fn(f[k]), 0) / n;
  const place = avg(x => x.rad), fiksni = avg(x => x.rezija), uk = place + fiksni;
  const totC = keys.reduce((a, k) => a + f[k].rad + f[k].rezija, 0);
  const totH = keys.reduce((a, k) => a + f[k].satiUk, 0);
  const poSatu = totH > 0 ? totC / totH : 0;
  // Fiksni troškovi po vrsti (bruto) za podnaslov
  const grupe = { najam: 0, leasing: 0, gorivo: 0, ostalo: 0 };
  let vracaUk = 0;
  for (const k of keys) {
    const rz = f[k].rez;
    for (const s of rz.stavke) {
      const r = praviloZaNaziv(s.t.partner);
      const g = r && r.id === 'stan' ? 'najam' : r && r.id === 'porsche' ? 'leasing' : r && r.id === 'adria' ? 'gorivo' : 'ostalo';
      grupe[g] += s.racun;
    }
    grupe.ostalo += rz.ulaganja + rz.ocekivanoBruto;
    vracaUk += rz.ukVraca;
  }
  const sub2 = [['najam', grupe.najam], ['leasing', grupe.leasing], ['gorivo', grupe.gorivo], ['ostalo', grupe.ostalo]]
    .filter(x => x[1] > 0.5).map(([l, v]) => `${l} ${FMT_INT.format(v / n)}`).concat(vracaUk > 0.5 ? [`PDV −${FMT_INT.format(vracaUk / n)}`] : []).join(' · ');
  const raspon = keys.length === 1 ? monthLabel(keys[0]) : `${monthLabelShort(keys[0]).toLowerCase()} – ${monthLabel(keys[keys.length - 1]).toLowerCase()}`;
  const imaProcjenu = keys.some(k => f[k].procjena);
  const rows = keys.map(k => {
    const x = f[k];
    const chips = [x.nepotpun ? '<span class="pill amber" title="Manje od pola mogućih sati">manje od pola sati</span>' : '', x.procjena ? '<span class="pill amber" title="Plaće za taj mjesec još nisu upisane u Troškovima">procjena</span>' : ''].filter(Boolean).join(' ');
    return `<tr><td>${monthLabelShort(k)} ${chips}</td><td class="num text-right">${eur(x.rad, 2)}</td><td class="num text-right">${eur(x.rezija, 2)}</td><td class="num text-right" style="font-weight: 600;">${eur(x.rad + x.rezija, 2)}</td><td class="num text-right">${fmtQty(x.satiUk)}</td></tr>`;
  }).join('');
  return `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head"><div><div class="card-title">Firma mjesečno</div><div class="card-sub">Prosjek ${raspon} · bez materijala i podizvođača · fiksni troškovi iz Troškova</div></div></div>
      <div class="kpi-row" style="margin-bottom: 16px;">
        <div class="kpi-cell"><div class="stat-label">Plaće</div><div class="stat-value">${eur(place, 0)}</div><div class="stat-sub">keš isplate ${FMT_INT.format(avg(x => x.kes))} · službene plaće ${FMT_INT.format(avg(x => x.sluzbeno))}</div></div>
        <div class="kpi-cell"><div class="stat-label">Fiksni troškovi bez plaća</div><div class="stat-value">${eur(fiksni, 0)}</div><div class="stat-sub">${sub2}</div></div>
        <div class="kpi-cell" style="background: var(--acc-projects-soft);"><div class="stat-label" style="color: var(--acc-projects);">Ukupno mjesečno</div><div class="stat-value" style="color: #5e3019;">${eur(uk, 0)}</div><div class="stat-sub" style="color: #5e3019;">prag koji projekti moraju pokriti</div></div>
      </div>
      <div class="v4-note">Da firma ne bude u minusu, projekti mjesečno trebaju donijeti <strong>${eur(uk, 0)}</strong> nakon materijala i podizvođača, odnosno <strong>${eur(poSatu, 2)}</strong> za svaki sat rada.</div>
      <div class="table-scroll">
        <table class="table v4-tbl" style="min-width: 560px;">
          <thead><tr><th>Mjesec</th><th class="text-right">Plaće</th><th class="text-right">Fiksni bez plaća</th><th class="text-right">Ukupno</th><th class="text-right">Sati</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>PROSJEK</td><td class="num text-right">${eur(place, 2)}</td><td class="num text-right">${eur(fiksni, 2)}</td><td class="num text-right">${eur(uk, 2)}</td><td class="num text-right">${fmtQty(totH / n)}</td></tr></tfoot>
        </table>
      </div>
      <div style="font-size: 12px; color: var(--muted); margin-top: 10px;">Plaće po mjesecu rada: keš isplate iz Evidencije sati i službene plaće (neto i davanja) iz Troškova, upisane sljedeći mjesec kad se isplaćuju. Fiksni troškovi: Troškovi po mjesecu plaćanja, bez PDV-a koji se vraća, bez kredita, uplata PDV-a, pozajmica i troškova projekata; ulaganja raspoređena po mjesecima.${imaProcjenu ? ' „Procjena": plaće za taj mjesec još nisu upisane u Troškovima, uzet je iznos iz Prognoze.' : ''}</div>
    </div>`;
}

function v4UsporedbaHtml(all) {
  const hidden = new Set(state.hiddenProjects || []);
  const real = all.filter(p => p.name !== PROJ_NONE && p.name !== PROJ_GODISNJI && !hidden.has(p.name));
  const byAct = (a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || '') || a.name.localeCompare(b.name, 'hr');
  const s = real.filter(p => p.uplateInfo.length || p.pdvRezim).sort(byAct);
  const bez = real.filter(p => !(p.uplateInfo.length || p.pdvRezim)).sort((a, b) => b.sati - a.sati);
  if (!s.length && !bez.length) return '';
  const pill = (p) => p.pdvRezim === 'pdv25' ? '<span class="pill pdv25">PDV 25 %</span>' : p.pdvRezim === 'ppo' ? '<span class="pill ppo">Prijenos</span>' : '<span class="pill red">nije odabrano</span>';
  const rows = s.map(p => {
    let prihod, nakon = '', zarada = '';
    if (!p.uplateInfo.length) prihod = '<span style="color: var(--muted);">nema uplata</span>';
    else if (p.pdvNijeOdabran) { prihod = `<span style="color: var(--muted);">${FMT_INT.format(p.naplaceno)} uplaćeno</span>`; nakon = '<span style="color: #7a5c10;">čeka PDV</span>'; zarada = nakon; }
    else {
      prihod = FMT_INT.format(p.prihod);
      nakon = FMT_INT.format(p.nakonMR);
      zarada = p.zaradaBlocked ? '<span style="color: #7a5c10;">čeka evidenciju</span>' : `<span style="font-weight: 600; color: var(${p.zarada < 0 ? '--negative' : '--positive'});">${p.zarada >= 0 ? '+' : '−'}${FMT_INT.format(Math.abs(p.zarada))}</span>`;
      if (p.zaradaBlocked) nakon = '<span style="color: #7a5c10;">čeka evidenciju</span>';
    }
    return `<tr data-proj="${escapeHtml(p.name)}" style="cursor: pointer;"><td style="font-weight: 600;">${escapeHtml(p.name)}</td><td>${p.zakljucen ? '<span class="pill gray">završen</span>' : '<span class="pill brown">tekući</span>'}</td><td>${pill(p)}</td><td class="num text-right">${prihod}</td><td class="num text-right">${nakon}</td><td class="num text-right">${zarada}</td><td class="num text-right">${fmtQty(p.sati)}</td></tr>`;
  }).join('');
  const top = bez.filter(p => p.sati > 0).slice(0, 3).map(p => `${escapeHtml(p.name)} ${fmtQty(p.sati)} h`);
  return `
    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head"><div><div class="card-title">Usporedba projekata</div><div class="card-sub">Sve bez PDV-a · zarada nakon materijala i rada, pa nakon režije · klik na projekt otvara detalj</div></div></div>
      ${s.length ? `
      <div class="table-scroll">
        <table class="table v4-tbl" style="min-width: 820px;">
          <thead><tr><th>Projekt</th><th>Status</th><th>PDV na uplatama</th><th class="text-right">Prihod</th><th class="text-right">Nakon materijala i rada</th><th class="text-right">Zarada</th><th class="text-right">Sati</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : ''}
      ${bez.length ? `<div style="font-size: 13px; color: var(--ink-2); margin-top: 12px;">Još ${bez.length} ${hrPlural(bez.length, 'projekt', 'projekta', 'projekata')} bez uplata${top.length ? ', među njima ' + top.join(', ').replace(/, ([^,]*)$/, ' i $1') : ''}.</div>` : ''}
    </div>`;
}

function renderProjektiPregledHtml(all) {
  const upoz = v4Upozorenja(all);
  const warnHtml = upoz.length ? `
    <div class="v4-warn">
      ${upoz.map((w, i) => `<div class="v4-warn-row"><span>${w.html}</span>${w.btn ? `<button type="button" class="btn btn-sm" data-upoz="${i}">${w.btn}</button>` : ''}</div>`).join('')}
    </div>` : '';
  return warnHtml + v4FirmaHtml(all) + v4UsporedbaHtml(all);
}

function bindProjektiPregled(panel, all) {
  const upoz = v4Upozorenja(all);
  panel.querySelectorAll('[data-upoz]').forEach(b => b.addEventListener('click', () => {
    const w = upoz[parseInt(b.dataset.upoz, 10)];
    if (!w) return;
    if (w.k === 'uplate') rasporediUplateModal();
    else if (w.k === 'troskovi') rasporediTroskoveModal();
    else if (w.k === 'pdv') { activeProject = w.proj; renderProjects(); window.scrollTo(0, 0); }
    else if (w.k === 'nepotpun') setTab('registar');
    else if (w.k === 'velika' && w.ref) { activeMonth = w.ref.mk; setTab('trx'); if (isAdmin) trxModal(w.ref.i); }
  }));
  panel.querySelectorAll('tr[data-proj]').forEach(tr => tr.addEventListener('click', () => {
    activeProject = tr.dataset.proj;
    renderProjects();
    window.scrollTo(0, 0);
  }));
}

/* ---------- Rasporedi uplate kupaca na projekte ---------- */
function rasporediUplateModal() {
  if (!isAdmin) { toast('Za raspoređivanje aktiviraj admin mod', 'error'); return; }
  const list = prihodiBezProjekta();
  if (!list.length) { toast('Sve uplate su raspoređene', 'success'); return; }
  const imena = projektImena();
  const html = `
    <div class="modal-title">Uplate bez projekta</div>
    <div class="modal-sub">Uplate kupaca iz Troškova koje nisu ni na jednom projektu. Odabrani projekt dobiva uplatu, a „Nije za projekt" je za povrate, odštete i prodaju imovine. Što ne odabereš, ostaje kako je.</div>
    <div class="table-scroll">
      <table class="table v4-tbl" style="min-width: 760px;">
        <thead><tr><th>Datum</th><th>Partner</th><th class="text-right">Iznos</th><th>Projekt</th><th>PDV na uplati</th></tr></thead>
        <tbody>
          ${list.map((x, n) => `
          <tr>
            <td class="col-date num">${isoToEU(x.t.date)}</td>
            <td><strong>${escapeHtml(x.t.partner)}</strong>${x.t.category ? `<div class="v4-sub">${escapeHtml(x.t.category)}</div>` : ''}</td>
            <td class="num text-right" style="font-weight: 600;">${eur(Number(x.t.amount) || 0, 2)}</td>
            <td><select class="select" data-r-proj="${n}" style="min-width: 180px;"><option value="">Ostavi</option>${imena.map(nm => `<option value="${escapeHtml(nm)}">${escapeHtml(nm)}</option>`).join('')}<option value="__ne__">Nije za projekt</option></select></td>
            <td><select class="select" data-r-pdv="${n}"><option value="">Kao projekt</option><option value="pdv25">PDV 25 %</option><option value="ppo">Prijenos porezne obveze</option></select></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi raspored</button>
    </div>`;
  const m = modal(html, { xl: true });
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    const snap = JSON.stringify(state);
    let n = 0;
    list.forEach((x, k) => {
      const v = m.root.querySelector(`[data-r-proj="${k}"]`).value;
      if (!v) return;
      n++;
      if (v === '__ne__') { x.t.proj = '__ne__'; return; }
      const pdv = m.root.querySelector(`[data-r-pdv="${k}"]`).value;
      const rec = ensureObracunRec(v);
      const u = { date: x.t.date, amount: round2(Number(x.t.amount) || 0), note: x.t.partner, created: nowISO(), izTroskova: true };
      if (pdv) u.pdv = pdv;
      rec.uplate.push(u);
      x.t.proj = v;
    });
    if (!n) { m.close(); return; }
    if (await saveData()) { m.close(); toast(`Raspoređeno: ${n} ${hrPlural(n, 'uplata', 'uplate', 'uplata')}`, 'success'); rerenderActive(); }
    else state = JSON.parse(snap);
  });
}

/* ---------- Rasporedi troškove koji idu na projekt ---------- */
function rasporediTroskoveModal() {
  if (!isAdmin) { toast('Za raspoređivanje aktiviraj admin mod', 'error'); return; }
  const list = troskoviBezProjekta();
  if (!list.length) { toast('Svi troškovi su raspoređeni', 'success'); return; }
  const imena = projektImena();
  const html = `
    <div class="modal-title">Troškovi za projekt</div>
    <div class="modal-sub">Podizvođači i slični troškovi idu na projekt na kojem su radili. Ako projekt već ima ručno upisan isti trošak, ne broji se dvaput.</div>
    <div class="table-scroll">
      <table class="table v4-tbl" style="min-width: 640px;">
        <thead><tr><th>Datum</th><th>Partner</th><th class="text-right">Iznos</th><th>Kamo ide</th></tr></thead>
        <tbody>
          ${list.map((x, n) => `
          <tr>
            <td class="col-date num">${isoToEU(x.t.date)}</td>
            <td><strong>${escapeHtml(x.t.partner)}</strong></td>
            <td class="num text-right" style="font-weight: 600;">${eur(Number(x.t.amount) || 0, 2)}</td>
            <td><select class="select" data-r-dest="${n}" style="min-width: 200px;"><option value="">Ostavi</option>${imena.map(nm => `<option value="p:${escapeHtml(nm)}">${escapeHtml(nm)}</option>`).join('')}<option value="rezija">Režija</option><option value="ne">Ne ide u projekte</option></select></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi raspored</button>
    </div>`;
  const m = modal(html, { xl: true });
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    const snap = JSON.stringify(state);
    let n = 0;
    list.forEach((x, k) => {
      const v = m.root.querySelector(`[data-r-dest="${k}"]`).value;
      if (!v) return;
      n++;
      if (v.startsWith('p:')) { x.t.dest = 'projekt'; x.t.proj = v.slice(2); }
      else { x.t.dest = v; delete x.t.proj; }
    });
    if (!n) { m.close(); return; }
    if (await saveData()) { m.close(); toast(`Raspoređeno: ${n} ${hrPlural(n, 'trošak', 'troška', 'troškova')}`, 'success'); rerenderActive(); }
    else state = JSON.parse(snap);
  });
}

/* ---------- Prognoza: stavka s partnerom po kojem se prepoznaje u Troškovima ---------- */
function forecastModal(idx = null) {
  ensureForecast();
  const it = idx !== null ? state.forecast[idx] : { label: '', category: 'Ostalo', amount: 0, validFrom: activeMonth, validTo: '', note: '', active: true };
  if (!it) return;
  const allCats = Array.from(new Set([...FORECAST_CATEGORIES, ...(state.forecast || []).map(x => x.category).filter(Boolean)])).sort();
  const allLabels = Array.from(new Set((state.forecast || []).map(x => x.label).filter(Boolean))).sort();
  const autoTok = prognozaTokens({ ...it, partner: '' }).filter(x => x[0] !== '=').join(', ');
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} prognozu</div>
    <div class="modal-sub">Tekući trošak koji se ponavlja</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Naziv stavke</label>
        <input class="input" id="fc-label" list="fc-labels" value="${escapeHtml(it.label || '')}" placeholder="Npr. Porsche Leasing">
        <datalist id="fc-labels">${allLabels.map(l => `<option value="${escapeHtml(l)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">Kategorija</label>
        <input class="input" id="fc-category" list="fc-cats" value="${escapeHtml(it.category || '')}" placeholder="Npr. Leasing">
        <datalist id="fc-cats">${allCats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      </div>
      <div class="field">
        <label class="field-label">Iznos mjesečno (€)</label>
        <input class="input num" id="fc-amount" type="text" inputmode="decimal" placeholder="0,00" value="${formatEUAmount(it.amount)}">
      </div>
      <div class="field">
        <label class="field-label">Vrijedi od (mjesec)</label>
        <input class="input" id="fc-from" type="month" value="${it.validFrom || ''}">
        <div class="field-hint">YYYY-MM. Prazno = oduvijek.</div>
      </div>
      <div class="field">
        <label class="field-label">Vrijedi do (mjesec)</label>
        <input class="input" id="fc-to" type="month" value="${it.validTo || ''}">
        <div class="field-hint">YYYY-MM. Prazno = otvoreno (neograničeno).</div>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Prepoznaj u Troškovima po partneru (opcionalno)</label>
        <input class="input" id="fc-partner" value="${escapeHtml(it.partner || '')}" placeholder="${escapeHtml(autoTok || 'Npr. Rozic, Zmaric')}">
        <div class="field-hint">Dijelovi naziva partnera, odvojeni zarezom. Prazno: aplikacija prepozna sama po nazivu stavke${autoTok ? ' (' + escapeHtml(autoTok) + ')' : ''}.</div>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Napomena (opcionalno)</label>
        <input class="input" id="fc-note" value="${escapeHtml(it.note || '')}" placeholder="Npr. Aneks ugovora od 1.10.2026.">
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
          <input type="checkbox" id="fc-active" ${it.active !== false ? 'checked' : ''} style="width: 18px; height: 18px;">
          <span>Stavka je aktivna (uključi u izračune)</span>
        </label>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  attachEUAmountMask(m.root.querySelector('#fc-amount'));
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati ovu prognoznu stavku?')) {
        state.forecast.splice(idx, 1);
        if (await saveData()) { m.close(); renderForecast(); }
      }
    } else if (btn.dataset.act === 'save') {
      const label = m.root.querySelector('#fc-label').value.trim();
      const amount = parseEUAmount(m.root.querySelector('#fc-amount').value);
      if (!label) { toast('Unesi naziv stavke', 'error'); return; }
      if (!amount) { toast('Unesi iznos', 'error'); return; }
      const validFrom = m.root.querySelector('#fc-from').value || '';
      const validTo = m.root.querySelector('#fc-to').value || '';
      if (validFrom && validTo && validFrom > validTo) { toast('„Vrijedi od" mora biti prije „Vrijedi do"', 'error'); return; }
      const newIt = {
        ...it,
        label,
        category: m.root.querySelector('#fc-category').value.trim() || 'Ostalo',
        amount,
        validFrom,
        validTo,
        note: m.root.querySelector('#fc-note').value.trim(),
        active: m.root.querySelector('#fc-active').checked,
      };
      const partner = m.root.querySelector('#fc-partner').value.trim();
      if (partner) newIt.partner = partner; else delete newIt.partner;
      if (idx !== null) state.forecast[idx] = newIt; else state.forecast.push(newIt);
      if (await saveData()) {
        m.close();
        renderForecast();
        toast(idx !== null ? 'Stavka ažurirana' : 'Stavka dodana', 'success');
      }
    }
  });
}

/* ============================================================
   v4 · POSTAVKE · PDV PRAVILA ZA TROŠKOVE
   ============================================================ */
function v4PravilaCardHtml() {
  const cur = todayISO().slice(0, 7);
  const months = allMonths().filter(k => k < cur && (state.trx[k] || []).length);
  let bruto = 0, vraca = 0, ulag = 0;
  const grupe = {};
  for (const k of months) {
    const rz = rezijaZaMjesec(k);
    bruto += rz.bruto; vraca += rz.vraca; ulag += rz.ulaganja;
    for (const s of rz.stavke) {
      const r = praviloZaNaziv(s.t.partner);
      const key = r ? 'r:' + r.id : 'k:' + (s.t.category || 'Ostalo');
      if (!grupe[key]) grupe[key] = { naziv: r ? r.naziv : (s.t.category || 'Ostalo') + ' · bez pravila', bruto: 0, vraca: 0, pdv: r ? r.pdv : 'bez', r };
      grupe[key].bruto += s.racun; grupe[key].vraca += s.vraca;
    }
  }
  if (ulag > 0.005) grupe['ulag'] = { naziv: 'Ulaganja · raspoređeno po mjesecima', bruto: ulag, vraca: 0, pdv: null };
  const n = Math.max(1, months.length);
  const raspon = months.length ? (months.length === 1 ? monthLabel(months[0]) : `${monthLabelShort(months[0]).toLowerCase()} – ${monthLabel(months[months.length - 1]).toLowerCase()}`) : '';
  const ukBruto = round2(bruto + ulag);
  const vrsteRows = Object.values(grupe).sort((a, b) => b.bruto - a.bruto).map(g => `
    <tr><td><strong>${escapeHtml(g.naziv)}</strong></td><td class="num text-right">${eur(g.bruto, 2)}</td><td class="num text-right">${eur(g.bruto / n, 0)}</td><td>${g.pdv === null ? '' : (g.vraca > 0.005 ? `${PDV_PRESETS[g.pdv] ? PDV_PRESETS[g.pdv].vraca : ''} · ${v4Minus(g.vraca)}` : 'ništa')}</td></tr>`).join('');
  const sekcija = (vrsta, naslov, sub) => {
    const rules = pdvPravila().map((r, i) => ({ r, i })).filter(x => (x.r.vrsta || 'tekuci') === vrsta);
    if (!rules.length) return '';
    return `
      <div class="pick-h" style="margin-top: 22px;">${naslov} <span style="text-transform: none; letter-spacing: 0;">· ${sub}</span></div>
      <div class="table-scroll">
        <table class="table v4-tbl" style="min-width: 900px;">
          <thead><tr><th>Partner</th><th>Što je</th><th>PDV na računu</th><th>Vraća se</th><th>Kamo ide</th><th>Napomena</th><th>Status</th></tr></thead>
          <tbody>
            ${rules.map(({ r, i }) => {
              const P = PDV_PRESETS[r.pdv] || PDV_PRESETS.bez;
              const st = PRAVILO_STATUS[r.status] || PRAVILO_STATUS.provjeriti;
              return `<tr${isAdmin ? ` data-pravilo="${i}" style="cursor: pointer;${r.active === false ? ' opacity: .5;' : ''}" title="Klik za uređivanje"` : (r.active === false ? ' style="opacity: .5;"' : '')}><td style="font-weight: 600;">${escapeHtml(r.naziv)}</td><td>${escapeHtml(r.sto || '')}</td><td>${P.stopa ? P.stopa + ' %' : 'bez PDV-a'}</td><td>${P.vraca}</td><td>${KAMO_NAZIV[r.kamo] || 'režija'}</td><td style="color: var(--ink-2);">${escapeHtml(r.napomena || '')}</td><td><span class="pill ${st.cls}">${st.naziv}</span></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  };
  return `
    <div class="card" style="margin-bottom: 24px;" id="v4-pravila">
      <div class="card-head">
        <div>
          <div class="card-title">PDV pravila za troškove</div>
          <div class="card-sub">Za svakog partnera jednom se zapiše kakav je PDV na njegovim računima i kamo ide trošak. Iz toga aplikacija računa koliko PDV-a firma vraća i za toliko umanjuje režiju.</div>
        </div>
        ${isAdmin ? '<button class="btn btn-primary btn-sm" id="pravilo-add">+ Novo pravilo</button>' : ''}
      </div>
      ${months.length ? `
      <div class="kpi-row" style="margin-bottom: 10px;">
        <div class="kpi-cell"><div class="stat-label">Fiksni troškovi bez plaća · ${escapeHtml(raspon)}</div><div class="stat-value">${eur(ukBruto, 2)}</div><div class="stat-sub">iz Troškova · ${months.length} ${hrPlural(months.length, 'mjesec', 'mjeseca', 'mjeseci')}</div></div>
        <div class="kpi-cell"><div class="stat-label">PDV koji se vraća</div><div class="stat-value">${v4Minus(vraca)}</div><div class="stat-sub">prema pravilima partnera</div></div>
        <div class="kpi-cell"><div class="stat-label">U režiju</div><div class="stat-value">${eur(round2(ukBruto - vraca), 2)}</div><div class="stat-sub">mjesečno ${eur((ukBruto - vraca) / n, 0)}</div></div>
      </div>
      <div style="font-size: 12.5px; color: var(--muted); margin-bottom: 8px;">Bez plaća, kredita, uplata PDV-a, poreza na dobit, pozajmica i troškova stavljenih na projekt. Partneri bez pravila računaju se s PDV-om koji se ne vraća.</div>
      <div class="table-scroll">
        <table class="table v4-tbl" style="min-width: 700px;">
          <thead><tr><th>Vrsta</th><th class="text-right">${escapeHtml(raspon)}</th><th class="text-right">Mjesečno</th><th>PDV se vraća</th></tr></thead>
          <tbody>${vrsteRows}</tbody>
          <tfoot>
            <tr><td>Ukupno s PDV-om</td><td class="num text-right">${eur(ukBruto, 2)}</td><td class="num text-right">${eur(ukBruto / n, 0)}</td><td></td></tr>
            <tr><td>PDV koji se vraća</td><td class="num text-right">${v4Minus(vraca)}</td><td class="num text-right">${v4Minus(vraca / n, 0)}</td><td></td></tr>
            <tr><td>U režiju</td><td class="num text-right">${eur(round2(ukBruto - vraca), 2)}</td><td class="num text-right">${eur((ukBruto - vraca) / n, 0)}</td><td></td></tr>
          </tfoot>
        </table>
      </div>` : ''}
      ${sekcija('tekuci', 'Tekući troškovi', 'pravilo vrijedi za svaki račun tog partnera')}
      ${sekcija('nepredvideni', 'Nepredviđeni troškovi', 'idu u režiju, osim ako se stave na projekt ili u ulaganje')}
      <div class="pick-h" style="margin-top: 22px;">Ne ulazi u režiju</div>
      <div class="v4-ne">
        <div><strong>Uplata PDV-a i akontacija poreza na dobit</strong><span>PDV je već oduzet od uplata investitora, a porez na dobit plaća se iz zarade.</span></div>
        <div><strong>Plaće i davanja</strong><span>U rad idu iz Evidencije sati i plaća upisanih u Troškovima (kategorija Plaće), za mjesec za koji je plaća.</span></div>
        <div><strong>Kredit</strong><span>Glavnica nije trošak, nego vraćanje posuđenog novca. Kamate na prekoračenje i naknade banke jesu režija.</span></div>
        <div><strong>Pozajmice</strong><span>Posuđeni i vraćeni novac. U Cashflowu da, u projektima ne.</span></div>
        <div><strong>Podizvođači i troškovi na projektu</strong><span>Idu na projekt na kojem su radili, ne u režiju.</span></div>
        <div><strong>Ulaganja · vozilo, stroj</strong><span>Ne idu odjednom, nego se raspodijele na mjesece korištenja.</span></div>
        <div><strong>Uplate STO-u</strong><span>Materijal ide na projekte iz STO računa. Uplata samo smanjuje dug u STO stanju.</span></div>
      </div>
    </div>`;
}

function bindPravilaCard(panel) {
  if (!isAdmin) return;
  panel.querySelector('#pravilo-add')?.addEventListener('click', () => praviloModal(null));
  panel.querySelectorAll('[data-pravilo]').forEach(tr => tr.addEventListener('click', () => praviloModal(parseInt(tr.dataset.pravilo, 10))));
}

function praviloModal(idx) {
  const lista = pdvPravila();
  const r = idx !== null ? lista[idx] : { id: 'p' + Date.now().toString(36), naziv: '', sto: '', match: [], pdv: 'p25', kamo: 'rezija', kat: '', grupa: 'Nepredviđeni', status: 'provjeriti', napomena: '', vrsta: 'nepredvideni' };
  if (!r) return;
  const sel = (id, opts, cur) => `<select class="select" id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi pravilo' : 'Novo pravilo'}</div>
    <div class="modal-sub">Vrijedi za svaku transakciju partnera čiji naziv sadrži neki od upisanih tekstova.</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Partner (naziv za prikaz)</label><input class="input" id="pr-naziv" value="${escapeHtml(r.naziv || '')}" placeholder="Npr. Adria Oil"></div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Prepoznaj po (dijelovi naziva, odvojeni zarezom)</label><input class="input" id="pr-match" value="${escapeHtml((r.match || []).join(', '))}" placeholder="Npr. adria oil"><div class="field-hint">Mala i velika slova i kvačice nisu važne. Kratki tekst (do 3 slova) ili tekst s „=" na početku traži se kao cijela riječ.</div></div>
      <div class="field"><label class="field-label">Što je</label><input class="input" id="pr-sto" value="${escapeHtml(r.sto || '')}" placeholder="Npr. Gorivo"></div>
      <div class="field"><label class="field-label">Kategorija u Troškovima</label><input class="input" id="pr-kat" value="${escapeHtml(r.kat || '')}" placeholder="Npr. Gorivo"></div>
      <div class="field"><label class="field-label">PDV na računu</label>${sel('pr-pdv', PDV_ORDER.map(id => [id, PDV_PRESETS[id].naziv]), r.pdv)}</div>
      <div class="field"><label class="field-label">Kamo ide trošak</label>${sel('pr-kamo', [['rezija', 'Režija'], ['projekt', 'Na projekt'], ['ulaganje', 'Ulaganje'], ['ne', 'Ne ide u projekte']], r.kamo)}</div>
      <div class="field"><label class="field-label">Vrsta troška</label>${sel('pr-grupa', [['Tekući', 'Tekući'], ['Nepredviđeni', 'Nepredviđeni']], r.grupa)}</div>
      <div class="field"><label class="field-label">Status</label>${sel('pr-status', Object.entries(PRAVILO_STATUS).map(([k, v]) => [k, v.naziv]), r.status)}</div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Napomena</label><input class="input" id="pr-napomena" value="${escapeHtml(r.napomena || '')}"></div>
      <div class="field" style="grid-column: 1 / -1;"><label style="display: flex; align-items: center; gap: 10px; cursor: pointer;"><input type="checkbox" id="pr-active" ${r.active !== false ? 'checked' : ''} style="width: 18px; height: 18px;"><span>Pravilo je aktivno</span></label></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      <button class="btn btn-primary" data-act="save">Spremi</button>
    </div>`;
  const m = modal(html, { wide: true });
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') { m.close(); return; }
    const naziv = m.root.querySelector('#pr-naziv').value.trim();
    const match = m.root.querySelector('#pr-match').value.split(',').map(s => s.trim()).filter(Boolean);
    if (!naziv) { toast('Upiši naziv partnera', 'error'); return; }
    if (!match.length) { toast('Upiši barem jedan tekst za prepoznavanje', 'error'); return; }
    const snap = JSON.stringify(state.pdvPravila === undefined ? null : state.pdvPravila);
    if (!Array.isArray(state.pdvPravila) || !state.pdvPravila.length) state.pdvPravila = DEFAULT_PDV_PRAVILA.map(x => ({ ...x, match: (x.match || []).slice() }));
    const novo = {
      ...r,
      naziv, match,
      sto: m.root.querySelector('#pr-sto').value.trim(),
      kat: m.root.querySelector('#pr-kat').value.trim(),
      pdv: m.root.querySelector('#pr-pdv').value,
      kamo: m.root.querySelector('#pr-kamo').value,
      grupa: m.root.querySelector('#pr-grupa').value,
      status: m.root.querySelector('#pr-status').value,
      napomena: m.root.querySelector('#pr-napomena').value.trim(),
      active: m.root.querySelector('#pr-active').checked,
    };
    novo.vrsta = novo.grupa === 'Tekući' ? 'tekuci' : 'nepredvideni';
    if (idx !== null) state.pdvPravila[idx] = novo; else state.pdvPravila.push(novo);
    if (await saveData()) { m.close(); toast('Pravilo spremljeno', 'success'); renderSettings(); }
    else state.pdvPravila = JSON.parse(snap) || undefined;
  });
}

async function boot() {
  injectExtraCss();
  injectObracunCss();
  injectWorkerPeriodCss();
  injectV4Css();
  // Restore admin from localStorage if exists
  if (API.pin) {
    try {
      const ok = await API.verifyPin(API.pin);
      if (ok) {
        isAdmin = true;
        document.body.classList.add('admin-mode');
      } else {
        API.pin = null;
        localStorage.removeItem('sr_pin');
      }
    } catch (e) {}
  }
  updateAdminButton();

  try {
    state = await API.load();
    if (!state || !state.settings) throw new Error('Invalid state');
  } catch (e) {
    console.error('Boot failed', e);
    document.getElementById('boot').innerHTML = `
      <div class="boot-inner">
        <div class="boot-mark" style="background: var(--negative);">!</div>
        <div class="boot-text" style="max-width: 320px;">
          Ne mogu učitati podatke.<br>
          ${e.message || 'Provjeri internetsku vezu.'}
        </div>
        <button class="btn btn-primary" style="margin-top: 16px;" onclick="location.reload()">Pokušaj ponovno</button>
      </div>
    `;
    return;
  }

  // Osiguraj forecast field u stateu + napuni default ako prazan
  if (!state.raspored || !Array.isArray(state.raspored)) state.raspored = [];
  if (!state.forecast || !Array.isArray(state.forecast)) state.forecast = [];
  if (!state.obracun || typeof state.obracun !== 'object' || Array.isArray(state.obracun)) state.obracun = {};
  if (state.forecast.length === 0) {
    state.forecast = DEFAULT_FORECAST_SEED.map(x => ({ ...x }));
    // NAPOMENA: nije pozvan saveData() — popunjavanje se sprema tek nakon prve admin izmjene
  }

  // Fiksni rad (mjesečni, bez satnice i bez dnevne evidencije): Boris i Tata.
  // Dragan NIJE ovdje — on je radnik u Evidenciji (cash mjesečno), pa mu se
  // fiksnih 1.100 upisuje u Postavke → Radnici → Fiksno (cash + 1.100 = ~2.000).
  // Kao i forecast seed — u Blob se sprema tek pri prvoj admin izmjeni.
  if (!Array.isArray(state.settings.fixedLabor)) {
    state.settings.fixedLabor = [
      { name: 'Boris', amount: 1100, active: true },
      { name: 'Tata', amount: 1300, active: true },
    ];
  }

  // Fiksna isplata po radniku: ako je > 0, radnik SVAKI mjesec ima točno taj iznos
  // za isplatu (keš), bez obzira na sate i marendu. Jednokratni seed za Dragana
  // (900 €, njegov dogovor); kasnije se uređuje u Postavke → Radnici.
  // Kao i ostali seedovi: u Blob se sprema tek pri prvoj admin izmjeni.
  for (const w of (state.settings.workers || [])) {
    if (w && (w.fiksnaIsplata === undefined || w.fiksnaIsplata === null)) {
      w.fiksnaIsplata = (w.name === 'Dragan') ? 900 : 0;
    }
  }

  // Registar (godišnji odmori + rokovi i podsjetnici)
  ensureRegistar();

  // STO stanje (IOS + uplate); seed iz IOS-a 26.08.2026 ako još ne postoji
  ensureStoStanje();

  // Defaultiraj na trenutni kalendarski mjesec (a ne na zadnji mjesec u podacima),
  // tako da ako je netko slučajno otvorio buduće mjesece, navigacija počinje "danas"
  const today = new Date();
  const currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const months = allMonths();
  if (months.includes(currentKey)) activeMonth = currentKey;
  else if (months.length) {
    // Ako trenutni mjesec još nema podataka, idi na najnoviji koji ih ima
    activeMonth = months[months.length - 1];
  } else {
    activeMonth = currentKey;
    ensureMonth(currentKey);
  }

  // Wire tabs
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // Wire admin button
  document.getElementById('adminBtn').addEventListener('click', showPinModal);

  // Hide boot
  setTimeout(() => document.getElementById('boot').classList.add('hidden'), 200);

  // Initial render
  rerenderActive();
}

document.addEventListener('DOMContentLoaded', boot);

})();
