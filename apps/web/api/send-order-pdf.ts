// pages/api/send-order-pdf.ts
// Простейший заглушечный endpoint (Next.js Pages Router):
// Принимает POST, ничего не делает и возвращает 200.
// Это уберёт 404 и позволит вам позже внедрить отправку в Telegram/Email.

import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: {
    bodyParser: false, // мы принимаем FormData (multipart), поэтому отключаем встроенный парсер
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }
  try {
    // Здесь можно распарсить FormData с помощью busboy/formidable и выполнить отправку письма/в TG.
    // Сейчас — просто OK.
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    console.error(e);
    return res.status(500).send("Server error");
  }
}
