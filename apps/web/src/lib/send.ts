// src/lib/send.ts
import { loadOrderDraft } from "./order";

export type Extras = { base?: boolean; headstonePlate?: boolean; flowerbed?: boolean };

export async function sendOrderEmailAndNotifyTg(extras?: Extras): Promise<void> {
  const draft = loadOrderDraft();
  const res = await fetch("/api/send-order-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft, extras })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Не удалось отправить заказ (${res.status}): ${text || "unknown error"}`);
  }
}
