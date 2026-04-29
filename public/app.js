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
function modal(html, opts = {}) {
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
function computeCashflowSummary() {
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
  // Total worker payout for cashflow = Σ Sveukupno za sve radnike
  const stats = computeWorkerStats(monthKey);
  return stats.reduce((a, s) => a + (s.sveukupno || 0), 0);
}

function computeWorkerStats(monthKey) {
  const h = state.hours[monthKey];
  if (!h || !h.days) return [];
  return state.settings.workers.map(w => {
    let totalHours = 0, totalMarenda = 0, daysWorked = 0;
    for (const d of h.days) {
      const wd = d.workers && d.workers[w.name];
      if (wd && wd.hours > 0) {
        totalHours += wd.hours;
        totalMarenda += wd.marenda || 0;
        daysWorked++;
      }
    }
    const zaradaSati = totalHours * w.satnica;
    // Auto-formula: ako radnik ima satnicu > 0 → Dodatno = Zarada + Marenda − Fiksno
    //               ako satnica = 0 (npr. Dragan) → Dodatno je uvijek ručni unos
    const isAutoCalculated = w.satnica > 0;
    const autoDodatno = isAutoCalculated ? (zaradaSati + totalMarenda - w.fiksno) : 0;
    // Manual override is stored in extras[name]. Special object shape: { override: number } means user manually set it.
    // For backward compat / non-auto workers, plain number in extras means manual.
    const extra = h.extras && h.extras[w.name];
    let dodatno, isOverridden = false;
    if (extra !== null && extra !== undefined && typeof extra === 'object' && 'override' in extra) {
      dodatno = Number(extra.override) || 0;
      isOverridden = isAutoCalculated && Math.abs(dodatno - autoDodatno) > 0.005;
    } else if (typeof extra === 'number') {
      // For non-auto worker (Dragan): plain number = manual unos
      // For auto worker: legacy plain number — treat as override only if it differs from auto
      if (isAutoCalculated) {
        dodatno = extra;
        isOverridden = Math.abs(dodatno - autoDodatno) > 0.005;
      } else {
        dodatno = extra;
        isOverridden = false;
      }
    } else {
      dodatno = autoDodatno;
    }
    // Sveukupno = Dodatno + Fiksno + Prijevoz + Stan
    const sveukupno = dodatno + w.fiksno + w.prijevoz + w.stan;
    return {
      name: w.name,
      satnica: w.satnica,
      totalHours,
      totalMarenda,
      daysWorked,
      zaradaSati,
      prijevoz: w.prijevoz,
      stan: w.stan,
      fiksno: w.fiksno,
      dodatno,
      autoDodatno,
      isOverridden,
      isAutoCalculated,
      sveukupno,
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
  else if (activeTab === 'hours') renderHours();
  else if (activeTab === 'trx') renderTrx();
  else if (activeTab === 'sto') renderSto();
  else if (activeTab === 'settings') renderSettings();
}

/* ============================================================
   MONTH PICKER
   ============================================================ */
function buildMonthPicker(currentKey, _onChange, options = {}) {
  // Returns HTML only. Use bindMonthPicker(panel, ...) after innerHTML.
  const months = options.months || allMonths();
  if (!months.includes(currentKey)) {
    if (months.length) currentKey = months[months.length - 1];
  }
  const idx = months.indexOf(currentKey);
  return `
    <div class="month-picker" data-month="${currentKey}">
      <button data-act="prev" ${idx <= 0 ? 'disabled' : ''} aria-label="Prethodni">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="month-label">${monthLabel(currentKey)}</span>
      <button data-act="next" ${idx === months.length - 1 ? 'disabled' : ''} aria-label="Sljedeći">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      ${options.allowAdd && isAdmin ? `<button data-act="add" title="Dodaj mjesec" aria-label="Dodaj">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>` : ''}
    </div>
  `;
}

function bindMonthPicker(panel, currentKey, onChange, options = {}) {
  const months = options.months || allMonths();
  const idx = months.indexOf(currentKey);
  const root = panel.querySelector('.month-picker');
  if (!root) return;
  root.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'prev' && idx > 0) onChange(months[idx - 1]);
    else if (act === 'next' && idx < months.length - 1) onChange(months[idx + 1]);
    else if (act === 'add') addNewMonth(onChange);
  });
}

function addNewMonth(onChange) {
  const months = allMonths();
  const last = months[months.length - 1] || '2026-01';
  const [y, m] = last.split('-').map(Number);
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny++; }
  const newKey = `${ny}-${String(nm).padStart(2, '0')}`;
  if (months.includes(newKey)) {
    toast('Mjesec već postoji', 'error');
    return;
  }
  ensureMonth(newKey);
  saveData().then(() => {
    activeMonth = newKey;
    onChange(newKey);
    toast(`Dodan mjesec ${monthLabel(newKey)}`, 'success');
  });
}

/* ============================================================
   SAVE WRAPPER
   ============================================================ */
async function saveData() {
  try {
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
      <div class="table-scroll">
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
    </div>
  `;

  // Click row → switch to Trx tab
  panel.querySelectorAll('tbody tr[data-month]').forEach(tr => {
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
  const today = new Date().toISOString().slice(0, 10);
  const workers = state.settings.workers;

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

    <div class="card" style="margin-bottom: 24px;">
      <div class="card-head">
        <div>
          <div class="card-title">Dnevni unos sati</div>
          <div class="card-sub">${isAdmin ? 'Klikni red dana za brzi unos · Tab za navigaciju · Cmd+← / Cmd+→ za prethodni/sljedeći dan' : 'Pregled · za izmjene aktiviraj admin mod'}</div>
        </div>
      </div>
      <div class="hours-table-wrap">
        <div class="hours-scroll">
          <table class="hours-table hours-table-v2">
            <thead>
              <tr>
                <th>Datum</th>
                ${workers.map(w => `<th class="worker-col">${escapeHtml(w.name)}</th>`).join('')}
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

    <div class="card">
      <div class="card-head">
        <div>
          <div class="card-title">Sažetak isplate · ${monthLabelShort(activeMonth)}</div>
          <div class="card-sub">Po radniku · <span style="font-style: italic;">Dodatno = Zarada + Marenda − Fiksno</span></div>
        </div>
        <div class="page-actions">
          <span class="pill green">Σ Sveukupno: <strong style="margin-left: 4px;">${eur(stats.reduce((a, s) => a + s.sveukupno, 0), 0)}</strong></span>
        </div>
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Radnik</th>
              <th class="text-right">Satnica</th>
              <th class="text-right">Sati</th>
              <th class="text-right">Zarada (sati)</th>
              <th class="text-right">Marenda</th>
              <th class="text-right">Prijevoz</th>
              <th class="text-right">Stan</th>
              <th class="text-right">Fiksno/mj.</th>
              <th class="text-right">Dodatno (isplata)</th>
              <th class="text-right">Sveukupno</th>
            </tr>
          </thead>
          <tbody>
            ${stats.map(s => {
              return `
              <tr>
                <td><strong>${escapeHtml(s.name)}</strong></td>
                <td class="num text-right">${eur(s.satnica, 2)}</td>
                <td class="num text-right">${s.totalHours}</td>
                <td class="num text-right">${eur(s.zaradaSati, 2)}</td>
                <td class="num text-right">${eur(s.totalMarenda, 0)}</td>
                <td class="num text-right">${eur(s.prijevoz, 0)}</td>
                <td class="num text-right">${eur(s.stan, 0)}</td>
                <td class="num text-right">${eur(s.fiksno, 0)}</td>
                <td class="num text-right">
                  ${(() => {
                    if (!s.isAutoCalculated) {
                      // Dragan-style: pure manual
                      return isAdmin
                        ? `<input class="input cell-edit" type="number" step="any" value="${s.dodatno}" data-extra-worker="${escapeHtml(s.name)}" data-extra-mode="manual" style="width: 100px; margin-left: auto;">`
                        : `<strong>${eur(s.dodatno, 0)}</strong>`;
                    }
                    // Auto-calculated worker
                    if (isAdmin) {
                      const tooltipText = s.isOverridden
                        ? `Auto bi bilo: ${eur(s.autoDodatno, 2)} · klikni × za reset`
                        : `Auto: Zarada + Marenda − Fiksno · klikni za ručnu izmjenu`;
                      return `<div class="dodatno-cell ${s.isOverridden ? 'overridden' : ''}" title="${escapeHtml(tooltipText)}">
                        ${s.isOverridden ? `<button class="dodatno-reset" data-reset-worker="${escapeHtml(s.name)}" title="Vrati na auto (${eur(s.autoDodatno, 2)})" aria-label="Reset">×</button>` : ''}
                        <input class="input cell-edit dodatno-input" type="number" step="any" value="${s.dodatno}" data-extra-worker="${escapeHtml(s.name)}" data-extra-mode="auto" data-auto-value="${s.autoDodatno}" style="width: 100px;">
                        ${s.isOverridden ? `<span class="dodatno-mark" title="Ručno postavljeno">✎</span>` : ''}
                      </div>`;
                    }
                    return `<strong>${eur(s.dodatno, 2)}</strong>${s.isOverridden ? ` <span class="dodatno-mark-readonly" title="Ručno postavljeno">✎</span>` : ''}`;
                  })()}
                </td>
                <td class="num text-right" style="background: var(--positive-soft); color: var(--positive); font-weight: 700;">${eur(s.sveukupno, 2)}</td>
              </tr>
            `;}).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td>UKUPNO</td>
              <td></td>
              <td class="num text-right"><strong>${stats.reduce((a, s) => a + s.totalHours, 0)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.zaradaSati, 0), 2)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.totalMarenda, 0), 0)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.prijevoz, 0), 0)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.stan, 0), 0)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.fiksno, 0), 0)}</strong></td>
              <td class="num text-right"><strong>${eur(stats.reduce((a, s) => a + s.dodatno, 0), 2)}</strong></td>
              <td class="num text-right" style="background: var(--positive-soft); color: var(--positive);"><strong>${eur(stats.reduce((a, s) => a + s.sveukupno, 0), 2)}</strong></td>
            </tr>
          </tfoot>
        </table>
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
    panel.querySelectorAll('input[data-extra-worker]').forEach(inp => {
      inp.addEventListener('change', async () => {
        const w = inp.dataset.extraWorker;
        const mode = inp.dataset.extraMode;
        ensureMonth(activeMonth);
        if (!state.hours[activeMonth].extras) state.hours[activeMonth].extras = {};
        const newVal = parseFloat(inp.value) || 0;

        if (mode === 'auto') {
          // Auto-calculated worker: only store override if value differs from auto
          const autoVal = parseFloat(inp.dataset.autoValue) || 0;
          if (Math.abs(newVal - autoVal) < 0.005) {
            // Reverted to auto value → remove override
            delete state.hours[activeMonth].extras[w];
          } else {
            state.hours[activeMonth].extras[w] = { override: newVal };
          }
        } else {
          // Manual worker (Dragan): store as plain number
          state.hours[activeMonth].extras[w] = newVal;
        }
        if (await saveData()) renderHours();
      });
    });
    // Reset override → delete extras[w]
    panel.querySelectorAll('button[data-reset-worker]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const w = btn.dataset.resetWorker;
        ensureMonth(activeMonth);
        if (state.hours[activeMonth].extras && w in state.hours[activeMonth].extras) {
          delete state.hours[activeMonth].extras[w];
          if (await saveData()) renderHours();
        }
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
  const workers = state.settings.workers;

  // Find day or create skeleton
  let day = state.hours[activeMonth].days.find(d => d.date === dateStr);
  if (!day) {
    const dn = DAY_NAMES_HR[new Date(dateStr).getDay()];
    day = { date: dateStr, day_name: dn, note: '', workers: {} };
  }

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
              <div class="dw-name">${escapeHtml(w.name)}</div>
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
                  <td><strong>${escapeHtml(t.partner)}</strong></td>
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

function trxModal(idx = null) {
  ensureMonth(activeMonth);
  const t = idx !== null ? state.trx[activeMonth][idx] : { date: new Date().toISOString().slice(0, 10), type: 'Trošak', partner: '', amount: 0, category: '', group: 'Tekući' };
  const partners = Array.from(new Set(allMonths().flatMap(k => (state.trx[k] || []).map(x => x.partner)).filter(Boolean))).sort();
  const cats = Array.from(new Set([...TRX_CATEGORIES, ...allMonths().flatMap(k => (state.trx[k] || []).map(x => x.category)).filter(Boolean)])).sort();
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} transakciju</div>
    <div class="modal-sub">${monthLabel(activeMonth)}</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="t-date" type="date" value="${t.date}"></div>
      <div class="field"><label class="field-label">Tip</label>
        <select class="select" id="t-type">${TRX_TYPES.map(x => `<option ${x === t.type ? 'selected' : ''}>${x}</option>`).join('')}</select>
      </div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Partner</label>
        <input class="input" id="t-partner" list="t-partners" value="${escapeHtml(t.partner)}" placeholder="Npr. Hrvatski Telekom">
        <datalist id="t-partners">${partners.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
      </div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input" id="t-amount" type="number" step="0.01" value="${t.amount}"></div>
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
      const date = m.root.querySelector('#t-date').value;
      const newT = {
        date,
        type: m.root.querySelector('#t-type').value,
        partner: m.root.querySelector('#t-partner').value.trim(),
        amount: parseFloat(m.root.querySelector('#t-amount').value) || 0,
        category: m.root.querySelector('#t-category').value.trim(),
        group: m.root.querySelector('#t-group').value,
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
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">STO Gmbh · ${monthLabel(activeMonth)}</div>
        <h1 class="page-title"><strong>STO</strong> <em>materijal</em></h1>
      </div>
      <div class="page-actions">
        <div class="toggle">
          <button class="${stoView === 'month' ? 'active' : ''}" data-view="month">Mjesec</button>
          <button class="${stoView === 'year' ? 'active' : ''}" data-view="year">Godišnji</button>
        </div>
        ${buildMonthPicker(activeMonth, null, { allowAdd: true })}
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
              return `
                <tr>
                  <td class="col-date num">${formatDate(t.date)}</td>
                  <td class="num text-right" style="font-weight: 600;">${eur(t.amount, 2)}</td>
                  <td><strong>${escapeHtml(t.project || '—')}</strong></td>
                  <td style="color: var(--muted);">${escapeHtml(t.note || '')}</td>
                  ${isAdmin ? `<td class="text-right">
                    <button class="btn btn-ghost btn-sm" data-act="edit-sto" data-i="${idx}" title="Uredi">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="btn btn-ghost btn-sm btn-danger" data-act="del-sto" data-i="${idx}" title="Obriši">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/></svg>
                    </button>
                  </td>` : ''}
                </tr>
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

  // View toggle
  panel.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => {
    stoView = b.dataset.view;
    renderSto();
  }));

  if (isAdmin) {
    panel.querySelector('#sto-add')?.addEventListener('click', () => stoModal());
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
    <div class="page-head">
      <div class="page-title-block">
        <div class="page-eyebrow">STO Gmbh · Godišnji pregled 2026</div>
        <h1 class="page-title"><strong>STO</strong> <em>· godišnji</em></h1>
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
  const projects = Array.from(new Set(allMonths().flatMap(k => (state.sto[k] || []).map(x => x.project)).filter(Boolean))).sort();
  const html = `
    <div class="modal-title">${idx !== null ? 'Uredi' : 'Nova'} STO stavku</div>
    <div class="modal-sub">${monthLabel(activeMonth)}</div>
    <div class="grid grid-2" style="gap: 14px;">
      <div class="field"><label class="field-label">Datum</label><input class="input" id="s-date" type="date" value="${t.date}"></div>
      <div class="field"><label class="field-label">Iznos (€)</label><input class="input" id="s-amount" type="number" step="0.01" value="${t.amount}"></div>
      <div class="field" style="grid-column: 1 / -1;">
        <label class="field-label">Projekt</label>
        <input class="input" id="s-project" list="s-projs" value="${escapeHtml(t.project)}" placeholder="Npr. Grižane">
        <datalist id="s-projs">${projects.map(p => `<option value="${escapeHtml(p)}"></option>`).join('')}</datalist>
      </div>
      <div class="field" style="grid-column: 1 / -1;"><label class="field-label">Napomena (opcionalno)</label><input class="input" id="s-note" value="${escapeHtml(t.note || '')}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn" data-act="cancel">Odustani</button>
      ${idx !== null ? '<button class="btn btn-danger" data-act="del">Obriši</button>' : ''}
      <button class="btn btn-primary" data-act="save">${idx !== null ? 'Spremi' : 'Dodaj'}</button>
    </div>
  `;
  const m = modal(html);
  m.root.addEventListener('click', async e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    if (btn.dataset.act === 'cancel') m.close();
    else if (btn.dataset.act === 'del') {
      if (confirm('Obrisati?')) {
        state.sto[activeMonth].splice(idx, 1);
        if (await saveData()) { m.close(); renderSto(); }
      }
    } else if (btn.dataset.act === 'save') {
      const date = m.root.querySelector('#s-date').value;
      const newT = {
        date,
        amount: parseFloat(m.root.querySelector('#s-amount').value) || 0,
        project: m.root.querySelector('#s-project').value.trim(),
        note: m.root.querySelector('#s-note').value.trim(),
      };
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
   RENDER: SETTINGS
   ============================================================ */
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
            <input class="input" id="set-limit" type="number" step="100" value="${state.company?.limit_racuna || 30000}" ${isAdmin ? '' : 'disabled'}>
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
          <div class="card-sub">Satnice, marenda, prijevoz, stan, fiksno · ovi parametri se koriste za obračun</div>
        </div>
        ${isAdmin ? `<button class="btn btn-primary admin-only" id="add-worker">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Novi radnik
        </button>` : ''}
      </div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th>Radnik</th>
              <th class="text-right">Satnica (€/h)</th>
              <th class="text-right">Marenda/dan (€)</th>
              <th class="text-right">Prijevoz/mj. (€)</th>
              <th class="text-right">Stan/mj. (€)</th>
              <th class="text-right">Fiksno/mj. (€)</th>
              ${isAdmin ? '<th class="text-right">Akcije</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${state.settings.workers.map((w, i) => `
              <tr>
                <td>${isAdmin
                  ? `<input class="input" value="${escapeHtml(w.name)}" data-w="${i}" data-f="name" style="max-width: 180px;">`
                  : `<strong>${escapeHtml(w.name)}</strong>`}</td>
                ${['satnica','marenda','prijevoz','stan','fiksno'].map(f => `
                  <td class="text-right">${isAdmin
                    ? `<input class="input num" type="number" step="0.5" value="${w[f]}" data-w="${i}" data-f="${f}" style="max-width: 100px; margin-left: auto; text-align: right;">`
                    : `<span class="num">${eur(w[f], f === 'satnica' ? 2 : 0)}</span>`}</td>
                `).join('')}
                ${isAdmin ? `<td class="text-right">
                  <button class="btn btn-ghost btn-sm btn-danger" data-act="del-worker" data-i="${i}" title="Obriši">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  </button>
                </td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${isAdmin ? '<div style="margin-top: 16px;"><button class="btn btn-primary" id="save-workers">Spremi promjene radnika</button></div>' : ''}
    </div>

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
  panel.querySelector('#dl-json')?.addEventListener('click', downloadJson);
  panel.querySelector('#dl-xlsx')?.addEventListener('click', downloadXlsx);
  panel.querySelector('#toggle-admin')?.addEventListener('click', showPinModal);
  panel.querySelector('#clear-cache')?.addEventListener('click', () => {
    if (confirm('Obrisati lokalni cache backup?')) {
      localStorage.removeItem('sr_data_backup');
      renderSettings();
      toast('Lokalni cache obrisan');
    }
  });
  if (isAdmin) {
    panel.querySelector('#save-general')?.addEventListener('click', async () => {
      const limit = parseFloat(panel.querySelector('#set-limit').value) || 30000;
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
      state.settings.workers.push({ name: 'Novi radnik', satnica: 0, marenda: 4, prijevoz: 70, stan: 0, fiksno: 1100 });
      if (await saveData()) renderSettings();
    });
    panel.querySelectorAll('[data-act="del-worker"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Obrisati radnika? Postojeći zapisi sati će ostati.')) return;
      state.settings.workers.splice(parseInt(b.dataset.i), 1);
      if (await saveData()) renderSettings();
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
  const setRows = [['Radnik', 'Satnica', 'Marenda', 'Prijevoz', 'Stan', 'Fiksno']];
  for (const w of state.settings.workers) {
    setRows.push([w.name, w.satnica, w.marenda, w.prijevoz, w.stan, w.fiksno]);
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

  // Hours per month
  for (const k of Object.keys(state.hours || {})) {
    const h = state.hours[k];
    if (!h?.days?.length) continue;
    const workers = state.settings.workers.map(w => w.name);
    const rows = [['Datum', 'Dan', ...workers.flatMap(n => [n + ' Sati', n + ' Mar.'])]];
    for (const d of h.days) {
      rows.push([d.date, d.day_name, ...workers.flatMap(n => [d.workers?.[n]?.hours || 0, d.workers?.[n]?.marenda || 0])]);
    }
    // Compute proper Dodatno (auto + override) for each worker
    const monthStats = computeWorkerStats(k);
    rows.push(['Dodatno', '', ...workers.flatMap(n => {
      const s = monthStats.find(x => x.name === n);
      return [s ? s.dodatno : 0, ''];
    })]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), `Sati ${monthLabelShort(k)}`);
  }

  XLSX.writeFile(wb, `stara-rijeka-cashflow-${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('Excel preuzet', 'success');
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot() {
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

  // Default activeMonth = latest available
  const months = allMonths();
  if (months.length) activeMonth = months[months.length - 1];

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
