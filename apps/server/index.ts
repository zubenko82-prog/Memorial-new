// server/index.ts
import express from 'express';

const app = express();
app.use(express.json({ limit: '8mb' }));

app.get('/health', (_req, res) => res.status(200).send('OK'));

app.post('/api/send-order-email', (req, res) => {
  // Временно просто логируем и отвечаем 200 — для проверки прокси/связки
  console.log('[send-order-email] payload:', {
    hasDraft: !!req.body?.draft,
    extras: req.body?.extras || null
  });
  return res.status(200).json({ ok: true });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
