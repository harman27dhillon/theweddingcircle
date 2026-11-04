import { useEffect, useState } from "react";
import { useWeddingStore } from "@/lib/wedding/store";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  return online;
}

/** Registers one app-shell worker in production and keeps the phone cache in step with the open account. */
export function OfflineHost() {
  const online = useOnline();
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    if (online) {
      setCovered(false);
      return;
    }
    const look = () => setCovered(Boolean(document.querySelector(".swipe-column")));
    look();
    const id = window.setInterval(look, 500);
    return () => window.clearInterval(id);
  }, [online]);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const shellName = "/wedding-shell-sw.js";
    const dropForeignPush = (registrations: readonly ServiceWorkerRegistration[]) => {
      for (const registration of registrations) {
        const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
        if (script.includes("firebase-messaging-sw.js") && !registration.scope.includes("firebase-cloud-messaging-push-scope")) {
          void registration.unregister();
        }
      }
    };
    if (!import.meta.env.PROD) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        dropForeignPush(registrations);
        for (const registration of registrations) {
          const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
          if (script.includes(shellName)) void registration.unregister();
        }
      });
      return;
    }
    const idle = () => {
      const root = document.documentElement;
      if (root.dataset.wcLive === "1" || root.dataset.wcUpload === "1") return false;
      const field = document.activeElement;
      if (field instanceof HTMLTextAreaElement && field.value.trim()) return false;
      if (field instanceof HTMLInputElement && field.value.trim() && /^(text|search|email|tel|url|password|number)?$/.test(field.type)) return false;
      return true;
    };
    const arm = (registration: ServiceWorkerRegistration) => {
      let lastUpdate = Date.now();
      const wake = () => {
        if (!idle()) return;
        registration.waiting?.postMessage({ type: "SKIP_WAITING" });
      };
      const lookForUpdate = () => {
        if (!idle()) return;
        if (Date.now() - lastUpdate < 15 * 60 * 1000) return;
        lastUpdate = Date.now();
        void registration.update().catch(() => undefined);
      };
      wake();
      const timer = window.setInterval(() => {
        wake();
        lookForUpdate();
      }, 15000);
      registration.addEventListener("updatefound", () => {
        registration.installing?.addEventListener("statechange", wake);
      });
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          wake();
          lookForUpdate();
        }
      };
      window.addEventListener("online", wake);
      window.addEventListener("focusout", wake);
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        window.clearInterval(timer);
        window.removeEventListener("online", wake);
        window.removeEventListener("focusout", wake);
        document.removeEventListener("visibilitychange", onVisible);
      };
    };
    let cancelled = false;
    let stopArm = () => {};
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    const onController = () => {
      if (!hadController || reloading) return;
      let recent = false;
      try {
        const last = Number(sessionStorage.getItem("wc-sw-reload-at") || "0");
        recent = Date.now() - last < 15000;
        if (!recent) sessionStorage.setItem("wc-sw-reload-at", String(Date.now()));
      } catch {
        /* A blocked session store still cannot loop: the in-memory flag stops a second reload. */
      }
      if (recent) return;
      reloading = true;
      window.location.reload();
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; version?: string } | null;
      if (!data || data.type !== "WC_SHELL" || !data.version) return;
      const current = document.querySelector('meta[name="wc-shell"]')?.getAttribute("content") || "";
      if (data.version === current) return;
      let seen = false;
      try {
        seen = sessionStorage.getItem("wc-shell-align") === data.version;
        sessionStorage.setItem("wc-shell-align", data.version);
      } catch {
        /* A blocked session store still cannot loop: the version is remembered below only after a successful write. */
      }
      if (seen) return;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    void navigator.serviceWorker.getRegistrations().then(dropForeignPush).catch(() => undefined);
    void navigator.serviceWorker.register(shellName, { scope: "/", updateViaCache: "none" }).then((registration) => {
      if (cancelled) return;
      stopArm = arm(registration);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      stopArm();
      navigator.serviceWorker.removeEventListener("message", onMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", onController);
    };
  }, []);

  useEffect(() => {
    let lastOwner = "";
    let timer = 0;
    let stop = false;
    const boot = async () => {
      const { ownerScope } = await import("@/lib/wedding/offline");
      const { hydrateOffline, rememberSnapshot, flushOutbox } = await import("@/lib/wedding/offline-sync");
      if (stop) return;
      const current = useWeddingStore.getState().account;
      useWeddingStore.getState().purgeRememberedDeletions();
      lastOwner = ownerScope(current);
      await hydrateOffline(current);
      if (navigator.onLine) await flushOutbox();
      const { syncOpenApp } = await import("@/lib/wedding/publish");
      void syncOpenApp();
    };
    const ready = () => void boot();
    if (useWeddingStore.persist.hasHydrated()) ready();
    else useWeddingStore.persist.onFinishHydration(ready);
    const unsub = useWeddingStore.subscribe((state, previous) => {
      void import("@/lib/wedding/offline").then(async ({ ownerScope }) => {
        const next = ownerScope(state.account);
        if (next !== lastOwner) {
          if (lastOwner && lastOwner !== "device") {
            const { clearAccountCache } = await import("@/lib/wedding/offline-sync");
            await clearAccountCache(previous.account);
          }
          lastOwner = next;
        }
      });
      if (state.weddings === previous.weddings) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void import("@/lib/wedding/offline-sync").then((mod) => mod.rememberSnapshot(useWeddingStore.getState().account));
      }, 800);
    });
    const onOnline = () => {
      void import("@/lib/wedding/publish").then((mod) => mod.syncOpenApp());
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") onOnline();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      unsub();
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return online || covered ? null : (
    <p className="wc-offline-chip" role="status">Offline. Saved screens stay on this phone.</p>
  );
}
