export function installMobileErrorOverlay() {
  if (typeof window === "undefined") return;

  const show = (title: string, payload: any) => {
    try {
      const id = "mobile-error-overlay";
      let box = document.getElementById(id);
      if (!box) {
        box = document.createElement("pre");
        box.id = id;
        box.style.position = "fixed";
        box.style.left = "8px";
        box.style.right = "8px";
        box.style.bottom = "8px";
        box.style.zIndex = "2147483647";
        box.style.maxHeight = "45vh";
        box.style.overflow = "auto";
        box.style.padding = "10px";
        box.style.borderRadius = "10px";
        box.style.background = "rgba(0,0,0,0.85)";
        box.style.color = "#fff";
        box.style.fontSize = "12px";
        box.style.whiteSpace = "pre-wrap";
        box.style.border = "1px solid rgba(255,255,255,0.25)";
        document.body.appendChild(box);
      }
      box.textContent =
        `${title}\n` +
        `${new Date().toISOString()}\n\n` +
        (typeof payload === "string" ? payload : JSON.stringify(payload, null, 2));
    } catch {}
  };

  window.addEventListener("error", (e) => {
    show("[window.error]", {
      message: (e as any).message,
      filename: (e as any).filename,
      lineno: (e as any).lineno,
      colno: (e as any).colno,
      stack: (e as any).error?.stack || null
    });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const r: any = (e as any).reason;
    show("[unhandledrejection]", {
      reason: r?.message || String(r),
      stack: r?.stack || null
    });
  });
}
