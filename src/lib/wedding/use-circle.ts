import { useEffect, useLayoutEffect, useState } from "react";
import { loadCircleSync } from "@/lib/wedding/publish";
import { circleKey } from "@/lib/wedding/circle-key";
import { useWeddingStore } from "@/lib/wedding/store";

export type CircleStatus = "loading" | "ready" | "missing" | "error";

function useHydrated() {
  return usePersistedReady();
}

/** Saved circles are already on this phone. Flip before paint so wedding bars are not held for a later effect. */
export function usePersistedReady() {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    let live = true;
    const done = () => {
      if (live) setReady(true);
    };
    if (useWeddingStore.persist.hasHydrated()) done();
    const unsub = useWeddingStore.persist.onFinishHydration(done);
    const timer = window.setTimeout(done, 1200);
    return () => {
      live = false;
      unsub?.();
      window.clearTimeout(timer);
    };
  }, []);
  return ready;
}

export function useCircle(slugInput: string) {
  const slug = slugInput.trim().toLowerCase();
  const hydrated = useHydrated();
  const wedding = useWeddingStore((s) => s.weddings.find((item) => item.slug === slug));
  const adoptCircle = useWeddingStore((s) => s.adoptCircle);
  const restoreSample = useWeddingStore((s) => s.restoreSample);
  const [status, setStatus] = useState<CircleStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!hydrated) return;
    let cancel = false;
    if (!/^[a-z0-9-]{3,80}$/.test(slug)) {
      setStatus("missing");
      return;
    }
    if (slug === "lila-nico") {
      if (!useWeddingStore.getState().weddings.some((item) => item.slug === slug)) restoreSample();
      setStatus("ready");
      return;
    }
    const owner = Boolean(circleKey(slug));
    const known = useWeddingStore.getState().weddings.some((item) => item.slug === slug);
    if (owner && known) setStatus("ready");
    else setStatus(known ? "ready" : "loading");
    let timer = 0;
    let pulling = false;
    let again = false;
    const pull = () => {
      if (cancel) return;
      if (pulling) {
        again = true;
        return;
      }
      pulling = true;
      void loadCircleSync(slug)
        .then((result) => {
          if (cancel) return;
          if (result) {
            const next = { slug, feed: result.typing.feed, chats: result.typing.chats };
            const prev = useWeddingStore.getState().pulse;
            if (prev.slug !== next.slug || prev.feed.join("\n") !== next.feed.join("\n") || JSON.stringify(prev.chats) !== JSON.stringify(next.chats)) {
              useWeddingStore.getState().setPulse(next);
            }
          }
          const remote = result?.wedding;
          if (result?.deleted) {
            useWeddingStore.getState().purgeDeletedCircle(slug);
            setStatus("missing");
            return;
          }
          if (!remote) {
            setStatus(useWeddingStore.getState().weddings.some((item) => item.slug === slug) ? "ready" : "missing");
            return;
          }
          if (useWeddingStore.getState().weddings.some((item) => item.slug === slug)) useWeddingStore.getState().applyRemoteCircle(remote);
          else adoptCircle(remote);
          const reminders = Array.isArray(result?.reminders) ? result.reminders : [];
          if (reminders.length) useWeddingStore.getState().absorbExpiryNotices(remote.id, reminders);
          setStatus("ready");
        })
        .catch(() => {
          if (!cancel) setStatus(useWeddingStore.getState().weddings.some((item) => item.slug === slug) ? "ready" : "error");
        })
        .finally(() => {
          pulling = false;
          if (cancel) return;
          if (again) {
            again = false;
            pull();
            return;
          }
          timer = window.setTimeout(pull, 4000);
        });
    };
    const kick = () => {
      if (document.visibilityState === "hidden") return;
      window.clearTimeout(timer);
      pull();
    };
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("online", kick);
    pull();
    return () => {
      cancel = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("online", kick);
    };
  }, [hydrated, slug, attempt, adoptCircle, restoreSample]);

  return {
    status: !hydrated ? "loading" : wedding ? "ready" : status,
    wedding,
    retry: () => setAttempt((n) => n + 1),
  };
}
