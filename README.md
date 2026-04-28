# Stara Rijeka · Cashflow 2026

Cashflow evidencija za **Stara Rijeka d.o.o.** — single-page web aplikacija s adminskim PIN-om za izmjene i pregledom otvorenim za sve s linkom.

Zamjenjuje Excel `Stara_Rijeka_-_Cashflow_2026.xlsx` i radi na svim uređajima (desktop, iPhone, iPad).

---

## ✨ Što sve radi

- **5 tabova** s vlastitim akcentnim bojama:
  - 🔵 **Cashflow** — sažetak, KPI-evi, mjesečni pregled, struktura troškova
  - ⚫ **Evidencija sati** — dnevni unos po radniku, satnice, marenda, dodatci za isplatu
  - 🍷 **Troškovi (Trx)** — sve transakcije po mjesecu, kategoriji, grupi
  - 🟡 **STO troškovi** — STO Gmbh materijal po projektu i mjesecu, plus godišnji pregled
  - 🟢 **Postavke** — radnici, limit računa, backup
- **Admin PIN** (4 znamenke) — tek nakon unosa može se uređivati
- **Pregled bez PIN-a** — bilo tko s linkom može vidjeti podatke
- **Auto-backup** u browseru (localStorage) na svaki spremanje
- **Ručni backup** — preuzimanje u `.json` i `.xlsx` formatu kad god želiš
- **Dodavanje novih mjeseci** kroz UI (gumb „+" u month picker-u)
- Mobile-friendly, sticky tabovi, glatke animacije

---

## 🚀 Deploy upute (korak po korak)

### 1. Pripremi GitHub repo

```bash
# U folderu gdje je ova aplikacija:
git init
git add .
git commit -m "Initial commit: Stara Rijeka Cashflow"

# Napravi novi repo na GitHubu (npr. "stara-rijeka-cashflow"), pa:
git remote add origin https://github.com/TVOJ-USERNAME/stara-rijeka-cashflow.git
git branch -M main
git push -u origin main
```

### 2. Spoji Netlify na GitHub

1. Idi na **https://app.netlify.com**
2. **Add new site** → **Import an existing project** → **GitHub**
3. Odaberi repo `stara-rijeka-cashflow`
4. Build settings:
   - Build command: ostavi prazno (nema buildanja)
   - Publish directory: `public`
   - Functions directory: `netlify/functions` (Netlify će sam pronaći iz `netlify.toml`)
5. **Deploy site**

### 3. Postavi PIN (kritično!)

Bez ovoga aplikacija **neće** dozvoliti spremanje podataka.

1. U Netlify dashboard-u → **Site configuration** → **Environment variables**
2. **Add a variable**:
   - Key: `ADMIN_PIN`
   - Value: `1998` (ili koji god 4-znamenkasti PIN želiš — preporuka: ne koristiti 1234 ili godinu rođenja)
   - Scope: **Functions** (može biti i All scopes)
3. **Save**
4. **Deploys** → **Trigger deploy** → **Deploy site** (da nova env varijabla povuče se)

### 4. Provjeri da Blobs rade

Netlify Blobs su **automatski** uključeni — ne treba ništa dodatno aktivirati.

Nakon prvog deploya, otvori site URL. Aplikacija će:
- Učitati `seed-data.json` (svi podaci iz tvog Excela su već unutra) prvi put kad se otvori
- Spremiti ih u Netlify Blob čim klikneš lock ikonu, uneseš PIN i napraviš prvu izmjenu

> ⚠️ **Važno:** dok ne napraviš prvu izmjenu kao admin, podaci žive samo u kodu (seed file). Čim spremiš nešto, prelaze u Blob storage. Najbolje da odmah nakon deploya:
> 1. Klikneš na **lock ikonu** gore desno
> 2. Uneseš svoj PIN
> 3. U **Postavke** → **Backup .json** preuzmeš trenutno stanje
> 4. Onda obaveznoga preuzmi backup nakon svake veće izmjene

### 5. Custom domena (opcionalno)

U Netlify dashboard-u → **Domain management** → **Add custom domain**.

Slično kao za stararijeka.hr (CARNET / domene.hr CNAME ili A zapis prema Netlify-ju).

### 6. Logoi (opcionalno, ali lijepo)

Aplikacija sada koristi tekstualni "SR" placeholder. Ako želiš pravi logo:

1. Stavi svoj logo kao `assets/logo-stara-rijeka.svg` (ili `.png`)
2. Otvori `public/index.html` i nađi `<div id="brandMark" class="brand-mark">SR</div>`
3. Zamijeni s:
   ```html
   <div id="brandMark" class="brand-mark has-img" style="--brand-mark-img: url('/assets/logo-stara-rijeka.svg');"></div>
   ```
   ili još jednostavnije, samo:
   ```html
   <div id="brandMark" class="brand-mark"><img src="/assets/logo-stara-rijeka.svg" alt="" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;"></div>
   ```
4. Premjesti `assets/` folder u `public/assets/` (da Netlify servira fajlove)

---

## 🔐 Sigurnost

- **PIN provjera** se događa server-side u Netlify Functions, koristeći constant-time comparison (zaštita od timing napada).
- PIN se **nikad ne sprema u kodu** — samo u Netlify env varijabli (`ADMIN_PIN`).
- Klijent sprema PIN u `localStorage` da ne moraš unositi svaki put — ako PIN promijeniš na serveru, klijent automatski pita za novi.
- Netlify Blobs su privatni za tvoj site — nitko izvana ih ne može direktno čitati osim kroz tvoju funkciju.

> **Što ako netko slučajno dobije PIN?**
> Promijeni `ADMIN_PIN` u Netlify env varijablama i triggeraj redeploy. Stari PIN više neće raditi.

---

## 💾 Backup strategija (3 razine sigurnosti)

1. **Netlify Blobs** — primarni storage, automatski replicirano kod Netlify-ja
2. **localStorage** — auto-backup u browseru, služi kao offline fallback ako server padne
3. **Ručni backup `.json`** — **PREPORUKA: skini 1× mjesečno** u Postavke → Backup .json
   - Spremaj u Google Drive, Dropbox ili sl.
   - Ako Netlify nestane, samo otvoriš svježu instalaciju i klikneš „Vrati iz .json"

Plus: aplikacija nudi **`.xlsx` izvoz** — generira Excel u istom formatu kao tvoj originalni, koristan za knjigovođu ili printanje.

---

## 🛠 Razvoj lokalno (opcionalno)

```bash
# Instaliraj Netlify CLI (jednom)
npm install -g netlify-cli

# U folderu projekta:
npm install
netlify dev

# Otvori http://localhost:8888
# Postavi lokalni PIN u .env:
echo "ADMIN_PIN=1998" > .env
```

---

## 📝 Struktura projekta

```
stara-rijeka-cashflow/
├── public/
│   ├── index.html        ← cijela aplikacija (jedan file, ~33 KB)
│   └── app.js            ← klijentska logika (~80 KB)
├── netlify/
│   └── functions/
│       ├── load.mjs      ← GET /api/load (javno)
│       └── save.mjs      ← POST /api/save (zahtijeva PIN)
├── assets/               ← logoi i statika (opcionalno)
├── seed-data.json        ← početni podaci iz Excela (Veljača-Travanj 2026)
├── netlify.toml          ← Netlify konfiguracija
├── package.json
└── README.md             ← ova datoteka
```

---

## 🎨 Tehnologija

- **Frontend:** vanilla JS + custom CSS (bez build koraka, bez frameworka)
- **Charts:** Chart.js v4 (CDN)
- **Excel export:** SheetJS (lazy-loaded samo kad treba)
- **Fonts:** Fraunces (display), Geist (UI), JetBrains Mono (brojke)
- **Backend:** Netlify Functions (Node 18+, ES modules)
- **Storage:** Netlify Blobs

---

## 📞 Brzi tehnički pomoć

**„Spremanje ne radi, dobivam 401"**
→ PIN nije postavljen u Netlify env varijablama, ili je krivo unesen. Provjeri **Site configuration → Environment variables → ADMIN_PIN**.

**„Učitavanje ne radi, vidim crveni „!""**
→ Provjeri Netlify **Functions log** u dashboard-u. Najčešće se radi o tome da `seed-data.json` nije ušao u bundle. `netlify.toml` ima `included_files = ["seed-data.json"]` — provjeri da je tu.

**„Promijenio sam podatke ali ne vidim ih na drugom uređaju"**
→ Pull-to-refresh na mobilu, ili Ctrl+Shift+R na desktopu. App ne kešira podatke nego ih svaki put svježe povlači.

**„Excel ima drugačiju strukturu nego prošli mjesec"**
→ Aplikacija je dizajnirana fleksibilno — možeš dodati nove kategorije i partnere kroz UI, novi mjesec se dodaje gumbom „+" u month picker-u.

---

**Dizajn i razvoj:** David Atlija · 2026
