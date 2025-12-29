// apps/web/api/catalogs/carvings.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  // 1) Самый надёжный источник — текущий deployment URL
  const deploymentUrl =
    (req.headers['x-vercel-deployment-url'] as string) ||
    process.env.VERCEL_URL ||
    (req.headers['x-forwarded-host'] as string) ||
    req.headers.host ||
    '';

  if (!deploymentUrl) return res.status(500).send('Deployment URL missing');

  // 2) Протокол: https по умолчанию; http для локалки
  const isLocal =
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(deploymentUrl) ||
    /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ''));
  const proto =
    (req.headers['x-forwarded-proto'] as string) ||
    (isLocal ? 'http' : 'https');

  const base = `${proto}://${deploymentUrl}`;
  const url = new URL('/catalogs/carvings.json', base).toString();

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
