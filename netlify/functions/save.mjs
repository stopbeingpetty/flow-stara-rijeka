import { getStore } from '@netlify/blobs';

/**
 * POST /api/save
 * Saves the full cashflow data blob.
 * Requires X-Admin-Pin header that matches process.env.ADMIN_PIN.
 *
 * Special header: X-Verify-Only: 1 → just checks PIN, doesn't save.
 * Used by client to verify PIN entry without committing data.
 *
 * NAKON spremanja u Netlify Blobs, podaci se automatski backupiraju u
 * privatni GitHub repo (ako su postavljene GitHub env varijable).
 * Svaka izmjena = novi commit = nova verzija u povijesti.
 */

// Constant-time comparison to prevent timing attacks
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Backup u GitHub preko Contents API-ja.
 * Trazi env varijable: GITHUB_TOKEN, GITHUB_REPO (npr. "korisnik/repo"),
 *                      GITHUB_BACKUP_PATH (opcionalno, default "backups/data.json"),
 *                      GITHUB_BRANCH (opcionalno, default "main").
 * Ako bilo koja kljucna varijabla fali, tiho preskace (ne ruši spremanje).
 */
async function backupToGitHub(data) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO; // "username/repo-name"
  const branch = process.env.GITHUB_BRANCH || 'main';
  const path = process.env.GITHUB_BACKUP_PATH || 'backups/data.json';

  if (!token || !repo) {
    // GitHub backup nije konfiguriran — preskoči bez greške
    return { ok: false, skipped: true, reason: 'GitHub env varijable nisu postavljene' };
  }

  const apiBase = `https://api.github.com/repos/${repo}/contents/${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'stara-rijeka-cashflow-backup',
  };

  try {
    // 1) Dohvati trenutni SHA datoteke (treba za update postojeće datoteke)
    let sha = undefined;
    const getRes = await fetch(`${apiBase}?ref=${encodeURIComponent(branch)}`, { headers });
    if (getRes.status === 200) {
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      // 404 = datoteka još ne postoji (prvi backup) — to je OK.
      // Bilo koji drugi status je problem.
      const txt = await getRes.text();
      return { ok: false, error: `GitHub GET ${getRes.status}: ${txt.slice(0, 200)}` };
    }

    // 2) Pripremi sadržaj (Base64-encoded JSON)
    const pretty = JSON.stringify(data, null, 2);
    // Base64 encode koji ispravno hvata UTF-8 (č, ć, ž, š, đ)
    const contentB64 = Buffer.from(pretty, 'utf-8').toString('base64');

    const now = new Date();
    const stamp = now.toISOString().replace('T', ' ').slice(0, 19);
    const commitMessage = `Auto-backup ${stamp} UTC`;

    // 3) PUT — kreiraj ili ažuriraj datoteku (ovo stvara commit = verzija)
    const body = {
      message: commitMessage,
      content: contentB64,
      branch: branch,
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    });

    if (putRes.status === 200 || putRes.status === 201) {
      const result = await putRes.json();
      return { ok: true, commit: result.commit?.sha?.slice(0, 7) || null };
    } else {
      const txt = await putRes.text();
      return { ok: false, error: `GitHub PUT ${putRes.status}: ${txt.slice(0, 200)}` };
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // PIN check
  const submittedPin = req.headers.get('x-admin-pin') || '';
  const expectedPin = process.env.ADMIN_PIN || '';

  if (!expectedPin) {
    return new Response(
      JSON.stringify({ error: 'Server nije konfiguriran (ADMIN_PIN nije postavljen)' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!safeEqual(submittedPin, expectedPin)) {
    return new Response(JSON.stringify({ error: 'Pogrešan PIN' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify-only mode (used by client to validate PIN)
  if (req.headers.get('x-verify-only') === '1') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse and save
  try {
    const data = await req.json();

    // Basic shape validation
    if (!data || typeof data !== 'object') {
      return new Response(JSON.stringify({ error: 'Invalid data' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Stamp save metadata
    data._lastSavedAt = new Date().toISOString();

    // 1) Primarno spremanje u Netlify Blobs (ovo MORA uspjeti)
    const store = getStore('cashflow');
    await store.setJSON('data', data);

    // 2) Sekundarni backup u GitHub (best-effort — ne ruši spremanje ako padne)
    let githubResult = null;
    try {
      githubResult = await backupToGitHub(data);
      if (githubResult && githubResult.ok) {
        console.log('GitHub backup OK, commit:', githubResult.commit);
      } else if (githubResult && !githubResult.skipped) {
        console.warn('GitHub backup nije uspio:', githubResult.error);
      }
    } catch (ghErr) {
      console.warn('GitHub backup iznimka:', ghErr.message);
      githubResult = { ok: false, error: ghErr.message };
    }

    return new Response(
      JSON.stringify({
        ok: true,
        savedAt: data._lastSavedAt,
        github: githubResult, // { ok, commit } ili { ok:false, ... } ili { skipped:true }
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (err) {
    console.error('Save error:', err);
    return new Response(JSON.stringify({ error: 'Spremanje nije uspjelo', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
