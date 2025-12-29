// apps/web/api/catalogs/carvings.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).send('Method Not Allowed');

  const deploymentUrl =
    (req.headers['x-vercel-deployment-url'] as string) ||
    process.env.VERCEL_URL ||
    (req.headers['x-forwarded-host'] as string) ||
    req.headers.host ||
    '';

  if (!deploymentUrl) return res.status(500).send('Deployment URL missing');

  const isLocal = /^localhost(:\d+)?$/.test(deploymentUrl) || /^localhost(:\d+)?$/.test(String(req.headers.host || ''));
  const proto = (req.headers['x-forwarded-proto'] as string) || (isLocal ? 'http' : 'https');

  const url = `${proto}://${deploymentUrl}/catalogs/carvings.json`;

  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return res.status(r.status).send(await r.text().catch(() => 'Upstream error'));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=86400');
    return res.status(200).json(await r.json());
  } catch (e) {
    return res.status(500).send('Failed to load carvings');
  }
}
