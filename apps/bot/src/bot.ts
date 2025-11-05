import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Telegraf, Markup } from "telegraf";

const token = process.env.TGBOT_TOKEN;
if (!token) {
  console.error("[bot] Missing TGBOT_TOKEN in .env");
  process.exit(1);
}

const WEBAPP_URL = process.env.WEBAPP_URL || "https://example.com";
const bot = new Telegraf(token);

bot.start((ctx) => {
  const kb = Markup.keyboard([
    [Markup.button.webApp("Заполнить заказ", WEBAPP_URL)]
  ]).resize();
  ctx.reply("Добро пожаловать в Memorial! Заполните заказ для просчета и изготовления памятника:", kb);
});

bot.command("web", (ctx) => {
  const kb = Markup.inlineKeyboard([
    Markup.button.webApp("Заполнить заказ", WEBAPP_URL)
  ]);
  ctx.reply("Заполните заказ в мини‑приложении:", kb);
});

bot.on("message", (ctx) => {
  ctx.reply("Я бот проекта Memorial. Используйте /start или кнопку WebApp.");
});

bot.launch().then(() => {
  console.log("[bot] Launched. Press Ctrl+C to stop.");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
