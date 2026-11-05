import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AnalyticsConsent } from "@/components/wedding/cloud-runtime";
import { OfflineHost } from "@/components/wedding/offline-host";
import { BootBoundary } from "@/components/wedding/boot-boundary";
import { loadAppearance } from "@/lib/wedding/classic-registry";
import { useWeddingStore } from "@/lib/wedding/store";
import "../styles.css";

const APP_NAME = "Wedding Circle";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: APP_NAME },
      { name: "theme-color", content: "#f4efe8" },
      { name: "wc-shell", content: "v8" },
      {
        name: "description",
        content: "A private circle for one wedding: guests, photos, live functions, and the memory of the day.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: Root,
});

let storeBoot: Promise<unknown> | null = null;

function bootWeddingStore() {
  if (storeBoot) return storeBoot;
  try {
    storeBoot = Promise.resolve(useWeddingStore.persist.rehydrate());
  } catch (error) {
    storeBoot = Promise.reject(error);
  }
  return storeBoot;
}

if (typeof window !== "undefined") void bootWeddingStore();

function Root() {
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    void import("@/lib/wedding/publish").then(({ startCircleSync }) => {
      const next = startCircleSync();
      if (cancelled) next();
      else stop = next;
    }).catch(() => undefined);
    let booted = false;
    const ready = () => {
      if (booted) return;
      booted = true;
      try {
        useWeddingStore.getState().ensureEntryCodes();
      } catch {
        /* A damaged saved circle must not stop the page from opening. */
      }
      const warm = () => {
        void import("@/lib/wedding/media-db").then(({ relocateDataUrls }) =>
          relocateDataUrls(useWeddingStore.getState().weddings).then((moved) => {
            if (!moved.changed) return;
            useWeddingStore.setState({ weddings: moved.next });
          }),
        ).catch(() => undefined);
      };
      if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(() => warm(), { timeout: 1600 });
      else window.setTimeout(warm, 400);
    };
    const unsub = useWeddingStore.persist.onFinishHydration(() => ready());
    const timer = window.setTimeout(ready, 1500);
    void bootWeddingStore().then(() => {
      ready();
      if (!useWeddingStore.persist.hasHydrated()) console.error("Wedding session restore did not finish.");
    }, () => {
      console.error("Wedding session restore failed.");
      ready();
    });
    void loadAppearance().catch(() => undefined);
    return () => {
      cancelled = true;
      stop();
      unsub?.();
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var shell='wc-shell-v8';setTimeout(function(){var waiting=document.querySelector('[data-landing-wait]');if(!waiting)return;var box=document.createElement('main');box.setAttribute('data-app-ready','');box.style.cssText='min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;background:#f4efe8;color:#1c1412;text-align:center;font-family:Georgia,serif';box.innerHTML='<h1 style=\"font-size:1.6rem;margin:0\">The Wedding Circle</h1><p style=\"margin:0;max-width:22rem\">This page did not finish opening. Weddings saved on this phone are still here.</p>';var b=document.createElement('button');b.type='button';b.textContent='Try again';b.style.cssText='min-height:44px;padding:0 16px;border-radius:999px;border:0;background:#8c2f39;color:#fffaf4';b.onclick=function(){var go=function(){location.reload()};var once=false;try{once=sessionStorage.getItem('wc-boot-retry')==='1';sessionStorage.setItem('wc-boot-retry','1')}catch(e){}if(!once&&navigator.serviceWorker){navigator.serviceWorker.getRegistrations().then(function(list){return Promise.all(list.map(function(r){var script=(r.active&&r.active.scriptURL)||(r.waiting&&r.waiting.scriptURL)||'';if(script.indexOf('wedding-shell-sw.js')!==-1)return r.unregister()}))}).finally(go)}else go()};box.appendChild(b);document.body.appendChild(box);},8000)})();",
          }}
        />
        <PreviewHostBridge />
        <AuthProvider>
          <BootBoundary>
            <Outlet />
          </BootBoundary>
          <OfflineHost />
          <AnalyticsConsent />
          <Toaster position="top-center" />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}
