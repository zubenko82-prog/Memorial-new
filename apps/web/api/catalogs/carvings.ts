import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  // Собираем базовый URL текущего деплоя
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  if (!host) return res.status(500).send('Host header missing');

  const url = `${proto}://${host}/catalogs/carvings.json`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return res.status(r.status).send(await r.text().catch(() => ''));
    const data = await r.json();
    // Кэш для CDN, чтобы не бить функцию лишний раз
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    res.status(200).json(data);
  } catch (e: any) {
    console.error('carvings api failed', e);
    res.status(500).send('Failed to load carvings');
  }
}
