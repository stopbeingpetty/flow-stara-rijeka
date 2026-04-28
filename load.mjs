import { getStore } from '@netlify/blobs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * GET /api/load
 * Returns the full cashflow data blob.
 * If no data exists yet (fresh deploy), returns the seed data.
 * Public read access — no PIN required.
 */
export default async (req, context) => {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const store = getStore('cashflow');
    let data = await store.get('data', { type: 'json' });

    // First-load fallback: serve seed data if blob is empty
    if (!data) {
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        // Try multiple possible locations for the seed file
        const seedCandidates = [
          join(__dirname, '../../seed-data.json'),
          join(__dirname, '../../../seed-data.json'),
          join(process.cwd(), 'seed-data.json'),
        ];
        let seedRaw = null;
        for (const path of seedCandidates) {
          try {
            seedRaw = await readFile(path, 'utf-8');
            break;
          } catch {}
        }
        if (seedRaw) {
          data = JSON.parse(seedRaw);
        } else {
          // Last resort: empty skeleton
          data = {
            version: 1,
            year: new Date().getFullYear(),
            company: { name: 'Stara Rijeka d.o.o.', founded: 1998, limit_racuna: 30000 },
            settings: { workers: [] },
            trx: {},
            sto: {},
            hours: {},
          };
        }
      } catch (err) {
        console.error('Seed load failed:', err);
        return new Response(JSON.stringify({ error: 'No data and seed missing' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (err) {
    console.error('Load error:', err);
    return new Response(JSON.stringify({ error: 'Internal error', detail: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
