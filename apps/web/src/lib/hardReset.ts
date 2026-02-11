// apps/web/src/lib/hardReset.ts
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
      "memorial.reviewOnly",
      "memorial.visited.BackEditorStep"
    ];

    keysToRemove.forEach((k) => {
      localStorage.removeItem(k);
      try {
        sessionStorage.removeItem(k);
      } catch {}
    });

    const all = Object.keys(localStorage);
    for (const k of all) {
      if (!k.startsWith("memorial.")) continue;
      if (preserveThemeKey && k === themeKey) continue;
      localStorage.removeItem(k);
    }

    try {
      const allS = Object.keys(sessionStorage);
      for (const k of allS) {
        if (!k.startsWith("memorial.")) continue;
        sessionStorage.removeItem(k);
      }
    } catch {}
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

  // 4) Перезагрузка + сброс hash, чтобы StepNav не "залипал" на старом шаге
  setTimeout(() => {
    try {
      if (window.location.hash) window.location.hash = "";
      // или жестко на старт:
      // window.location.hash = "#/wizard/start";
    } catch {}

    try {
      window.location.reload();
    } catch {
      window.location.href = window.location.href;
    }
  }, 80);
}
