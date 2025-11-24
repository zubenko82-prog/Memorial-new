import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  if (!host) return res.status(500).send('Host header missing');

  const url = `${proto}://${host}/catalogs/carvings.json`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      return res.status(r.status).send(text || 'Upstream error');
    }
    const data = await r.json();
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (e) {
    console.error('carvings api failed', e);
    return res.status(500).send('Failed to load carvings');
  }
}
