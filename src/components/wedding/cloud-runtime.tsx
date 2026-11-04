import { useEffect, useState } from "react";
import { cloudRuntime, registerPushDevice } from "@/lib/developer/cloud.functions";

const CONSENT = "wc-analytics-consent";
const DEVICE = "wc-push-device";

type Runtime = Awaited<ReturnType<typeof cloudRuntime>>;

export function AnalyticsConsent() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [choice, setChoice] = useState("unknown");

  useEffect(() => {
    setChoice(window.localStorage.getItem(CONSENT) || "");
    void cloudRuntime()
      .then(setRuntime)
      .catch(() => setRuntime({ analytics: false, push: "inbox" }));
  }, []);

  useEffect(() => {
    if (choice !== "yes" || !runtime || !("firebase" in runtime) || !runtime.analytics) return;
    const config = runtime.firebase;
    if (!config.measurementId) return;
    void import("firebase/app")
      .then(async ({ getApps, initializeApp }) => {
        const { getAnalytics, isSupported } = await import("firebase/analytics");
        if (!(await isSupported())) return;
        const existing = getApps().find((app) => app.name === "wc-analytics");
        const app = existing || initializeApp(config, "wc-analytics");
        getAnalytics(app);
      })
      .catch(() => undefined);
  }, [choice, runtime]);

  if (choice === "unknown" || !runtime?.analytics || choice) return null;

  function remember(next: "yes" | "no") {
    window.localStorage.setItem(CONSENT, next);
    setChoice(next);
  }

  return (
    <div className="fixed inset-x-3 bottom-24 z-40 rounded-card border border-line bg-card p-4 text-sm shadow-lg">
      <p>Analytics is optional. Nothing is measured unless you agree.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full bg-maroon px-4 text-on-photo" onClick={() => remember("yes")}>Agree</button>
        <button type="button" className="min-h-11 rounded-full border border-line px-4" onClick={() => remember("no")}>No thanks</button>
      </div>
    </div>
  );
}

export function PushOptIn() {
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void cloudRuntime()
      .then(setRuntime)
      .catch(() => setRuntime({ analytics: false, push: "inbox" }));
  }, []);

  if (!runtime || runtime.push !== "fcm" || !("vapid" in runtime) || !runtime.vapid || !("firebase" in runtime)) return null;
  const firebase = runtime.firebase;
  const vapid = runtime.vapid;

  async function enable() {
    setBusy(true);
    setNote("");
    try {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setNote("This browser cannot show push alerts. In-app notices still work.");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setNote("Permission was not granted. In-app notices still work.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
        scope: "/firebase-cloud-messaging-push-scope",
      });
      const worker = registration.active || registration.waiting || registration.installing;
      worker?.postMessage({ type: "wc-fcm-config", ...firebase });
      const { getApps, initializeApp } = await import("firebase/app");
      const { getMessaging, getToken } = await import("firebase/messaging");
      const existing = getApps().find((app) => app.name === "wc-push");
      const app = existing || initializeApp(firebase, "wc-push");
      const token = await getToken(getMessaging(app), { vapidKey: vapid, serviceWorkerRegistration: registration });
      if (!token) {
        setNote("This browser did not return a push token. In-app notices still work.");
        return;
      }
      let secret = window.localStorage.getItem(DEVICE) || "";
      if (!/^[A-Za-z0-9_-]{16,80}$/.test(secret)) {
        secret = crypto.randomUUID().replace(/-/g, "");
        window.localStorage.setItem(DEVICE, secret);
      }
      const saved = await registerPushDevice({ data: { deviceSecret: secret, token } });
      setNote(saved.ok ? "Alerts are on for this browser only. Nobody else was subscribed." : saved.error);
    } catch {
      setNote("Push could not be turned on. In-app notices still work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-card border border-line bg-card p-4">
      <p className="text-sm">Optional alerts on this device. In-app notices stay either way.</p>
      <button type="button" disabled={busy} className="mt-3 min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" onClick={() => void enable()}>
        {busy ? "Checking…" : "Enable notifications"}
      </button>
      {note ? <p className="mt-2 text-sm">{note}</p> : null}
    </div>
  );
}
