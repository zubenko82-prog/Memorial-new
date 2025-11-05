// src/lib/intro.ts
export type Intro = {
  customerName: string;
  customerPhone: string;
  customerNotes?: string;
};

export type IntroState = {
  intro: Intro | null;
  orderNumber: string | null;
  locked: boolean; // если true — «знакомство» уже пройдено и повторно не спрашиваем
};

export const LS_INTRO_KEY = "memorial.intro.v1";
export const LS_ORDER_KEY = "memorial.orderNo.v1";
export const LS_LOCK_KEY = "memorial.intro.locked.v1";

export function formatOrderNumber(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}-${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
}

export function phoneDigits(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

// Валидируем телефон: допускаем 10 цифр (без кода страны) или 11, начинающийся с 7/8
export function isPhoneValid(phone: string): boolean {
  const d = phoneDigits(phone);
  if (d.length === 10) return true;
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) return true;
  return false;
}

export function isIntroValid(intro: Intro | null): boolean {
  if (!intro) return false;
  const nameOk = (intro.customerName || "").trim().length > 1;
  return nameOk && isPhoneValid(intro.customerPhone || "");
}

export function loadIntroState(): IntroState {
  try {
    const raw = localStorage.getItem(LS_INTRO_KEY);
    const intro = raw ? (JSON.parse(raw) as Intro) : null;
    const orderNumber = localStorage.getItem(LS_ORDER_KEY) || null;
    const locked = localStorage.getItem(LS_LOCK_KEY) === "1";
    return { intro, orderNumber, locked };
  } catch {
    return { intro: null, orderNumber: null, locked: false };
  }
}

/**
 * Сохраняем контакты. Если opts.lock=true и контакты валидны — фиксируем один раз:
 * присваиваем номер заказа (если его ещё нет) и ставим locked=1.
 */
export function saveIntro(intro: Intro, opts?: { lock?: boolean }): IntroState {
  const clean: Intro = {
    customerName: (intro.customerName || "").trim(),
    customerPhone: (intro.customerPhone || "").trim(),
    customerNotes: intro.customerNotes?.trim() || undefined
  };
  localStorage.setItem(LS_INTRO_KEY, JSON.stringify(clean));

  let orderNumber = localStorage.getItem(LS_ORDER_KEY);
  let locked = localStorage.getItem(LS_LOCK_KEY) === "1";

  if (opts?.lock && !locked && isIntroValid(clean)) {
    if (!orderNumber) {
      orderNumber = formatOrderNumber(new Date());
      localStorage.setItem(LS_ORDER_KEY, orderNumber);
    }
    localStorage.setItem(LS_LOCK_KEY, "1");
    locked = true;
  }

  return { intro: clean, orderNumber: orderNumber || null, locked };
}

/**
 * Если контакты валидны, но ещё не зафиксированы, — фиксируем сейчас
 * (назначаем номер заказа и ставим locked=1). Возвращаем актуальное состояние.
 */
export function ensureLockedIfValid(): IntroState {
  const st = loadIntroState();
  if (!st.locked && isIntroValid(st.intro) && st.intro) {
    return saveIntro(st.intro, { lock: true });
  }
  return st;
}
// src/lib/intro.ts
// Добавьте эту функцию в конец файла (рядом с остальными экспортами).
export function clearIntroAll(): void {
  try {
    localStorage.removeItem(LS_INTRO_KEY);
    localStorage.removeItem(LS_ORDER_KEY);
    localStorage.removeItem(LS_LOCK_KEY);
  } catch {}
}
