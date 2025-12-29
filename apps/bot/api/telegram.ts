// apps/bot/api/telegram.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import bot from '../src/bot';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  try {
    await bot.handleUpdate(req.body as any);
    res.status(200).send('OK');
  } catch (err) {
    console.error('[bot] handleUpdate error:', err);
    res.status(500).send('ERROR');
  }
}
