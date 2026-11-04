import { useEffect, useState } from "react";
import { libraryCatalog } from "@/lib/wedding/library.functions";
import { developerPublicConfig } from "@/lib/developer/console.functions";
import { cardDisplayFromConfig } from "@/lib/wedding/card-ratio";

export type PublicLibraryAsset = {
  id: string;
  name: string;
  category: string;
  path: string;
  active: boolean;
  builtin: boolean;
  replaced: boolean;
  updatedAt: string;
  src: string;
};

export function visibleCover(src: string) {
  return src.trim();
}

const listeners = new Set<() => void>();

let publicConfigPromise: ReturnType<typeof developerPublicConfig> | null = null;

export function loadDeveloperPublicConfig() {
  publicConfigPromise ??= developerPublicConfig().catch((error: unknown) => {
    publicConfigPromise = null;
    throw error;
  });
  return publicConfigPromise;
}

export function usePublicSampleCover() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const pull = () => {
      void loadDeveloperPublicConfig()
        .then((config) => {
          if (!live) return;
          const next = config.sample && "src" in config.sample && typeof config.sample.src === "string" ? config.sample.src : "";
          setSrc(next);
        })
        .catch(() => {
          if (live) setSrc("");
        });
    };
    pull();
    listeners.add(pull);
    return () => {
      live = false;
      listeners.delete(pull);
    };
  }, []);

  return src;
}
let cache: Promise<PublicLibraryAsset[] | null> | null = null;

export function subscribePublicConfig(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DEFAULT_CARD_DISPLAY = cardDisplayFromConfig(null);

export function useCardDisplay() {
  const [display, setDisplay] = useState<ReturnType<typeof cardDisplayFromConfig>>(DEFAULT_CARD_DISPLAY);

  useEffect(() => {
    let live = true;
    const pull = () => {
      void loadDeveloperPublicConfig()
        .then((config) => {
          if (live) setDisplay(cardDisplayFromConfig(config));
        })
        .catch(() => undefined);
    };
    pull();
    listeners.add(pull);
    return () => {
      live = false;
      listeners.delete(pull);
    };
  }, []);

  return display;
}

export function invalidateLibrary() {
  cache = null;
  publicConfigPromise = null;
  listeners.forEach((listener) => listener());
}

export function loadLibrary() {
  cache ??= libraryCatalog()
    .then((result) => (result.ok ? result.assets : null))
    .catch(() => null);
  return cache;
}

export function resolveLibrarySrc(src: string, assets: PublicLibraryAsset[]) {
  if (!src || src.startsWith("data:") || src.startsWith("blob:") || src.startsWith("idb:") || src.startsWith("gp:") || src.startsWith("r2:") || src.startsWith("theme:")) {
    return src;
  }
  const match = assets.find((item) => item.path === src) ?? (src.startsWith("/library/") ? assets.find((item) => item.id === src.slice("/library/".length).split("?")[0]) : undefined);
  if (match?.src) return match.src;
  if (src.startsWith("/library/")) {
    const id = src.slice("/library/".length).split("?")[0];
    if (id) return `/api/library/file/${encodeURIComponent(id)}`;
  }
  return src;
}

export function useLibrary() {
  const [state, setState] = useState<{ ready: boolean; failed: boolean; assets: PublicLibraryAsset[] }>({
    ready: false,
    failed: false,
    assets: [],
  });

  useEffect(() => {
    let live = true;
    const pull = () => {
      void loadLibrary().then((assets) => {
        if (!live) return;
        if (!assets) setState({ ready: true, failed: true, assets: [] });
        else setState({ ready: true, failed: false, assets });
      });
    };
    pull();
    listeners.add(pull);
    return () => {
      live = false;
      listeners.delete(pull);
    };
  }, []);

  return state;
}
