// src/lib/tg.ts
type TgWebApp = {
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  onEvent?: (eventType: string, cb: (...args: any[]) => void) => void;
  offEvent?: (eventType: string, cb: (...args: any[]) => void) => void;
  initDataUnsafe?: any;
  themeParams?: any;
  viewportHeight?: number;
  isExpanded?: boolean;
};

export function getTgWebApp(): TgWebApp | null {
  try {
    const w = window as any;
    return w?.Telegram?.WebApp ?? null;
  } catch {
    return null;
  }
}

export function tgSafeInit() {
  const tg = getTgWebApp();
  if (!tg) return;

  try {
    tg.ready?.();
  } catch {}

  try {
    tg.expand?.();
  } catch {}
}
