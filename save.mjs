import { getStore } from '@netlify/blobs';

/**
 * POST /api/save
 * Saves the full cashflow data blob.
 * Requires X-Admin-Pin header that matches process.env.ADMIN_PIN.
 *
 * Special header: X-Verify-Only: 1 → just checks PIN, doesn't save.
 * Used by client to verify PIN entry without committing data.
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

    const store = getStore('cashflow');
    await store.setJSON('data', data);

    return new Response(JSON.stringify({ ok: true, savedAt: data._lastSavedAt }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Save error:', err);
    return new Response(JSON.stringify({ error: 'Spremanje nije uspjelo', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
