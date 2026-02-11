import { clearIntroAll } from "./intro";
import { clearOrderDraft, DRAFT_UPDATED_EVENT } from "./order";

export async function hardResetAll(opts?: { preserveThemeKey?: boolean }) {
  const preserveThemeKey = !!opts?.preserveThemeKey;
  const themeKey = "memorial.ui.theme.v1";

  // 1) Очищаем заявку + интро
  await clearOrderDraft();
  clearIntroAll();

  // 2) Чистим навигацию и прочие memorial.*
  try {
    const keysToRemove = [
      "memorial.navEnabled",
      "memorial.navEnabled.reviewOnly",
      "memorial.stepnav.enabled",
      "memorial.stepnav",
      "memorial.step",
      "memorial.lastStep",
      "memorial.reviewOnly"
    ];
    keysToRemove.forEach((k) => localStorage.removeItem(k));

    const all = Object.keys(localStorage);
    for (const k of all) {
      if (!k.startsWith("memorial.")) continue;
      if (preserveThemeKey && k === themeKey) continue;
      localStorage.removeItem(k);
    }
  } catch {
    // ignore
  }

  // 3) События обновления
  try {
    window.dispatchEvent(new Event("memorial:hardReset"));
    window.dispatchEvent(new Event(DRAFT_UPDATED_EVENT));
    window.dispatchEvent(new Event("memorial:orderDraftUpdated"));
  } catch {
    // ignore
  }

  // 4) Перезагрузка — гарантированно сбрасывает зависшие state/refs/порталы
  setTimeout(() => {
    try {
      window.location.reload();
    } catch {
      window.location.href = window.location.href;
    }
  }, 80);
}
