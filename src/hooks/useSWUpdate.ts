import { useRegisterSW } from "virtual:pwa-register/react";

const PAGE_LOAD_TIME = Date.now();

function applyUpdateNow() {
  navigator.serviceWorker?.ready.then((reg) => {
    if (!reg.waiting) return;
    navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), {
      once: true,
    });
    reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });
}

export function useSWUpdate() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onNeedRefresh() {
      // Fresh open: auto-apply without prompting. The new SW is waiting and the
      // user hasn't interacted yet, so a silent reload is safe.
      if (Date.now() - PAGE_LOAD_TIME < 4000) applyUpdateNow();
      // Mid-session: let needRefresh=true show the pill (set by the library).
    },
    onRegisteredSW(_url, r) {
      if (!r) return;
      const check = () => r.update();
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    },
  });

  function applyUpdate() {
    navigator.serviceWorker?.addEventListener("controllerchange", () => window.location.reload(), {
      once: true,
    });
    updateServiceWorker(true);
  }

  return { needRefresh, applyUpdate };
}
