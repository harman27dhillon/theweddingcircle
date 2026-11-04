import { useEffect, useState } from "react";
import { developerPublicConfig } from "@/lib/developer/console.functions";

export type AppRuntime = {
  flags: {
    photoUploads: boolean;
    googlePhotos: boolean;
    weddingCountdown: boolean;
    premiumThemes: boolean;
  };
  feeLabel: string;
  feePaise: number;
  maxPhotos: number;
  maxVideos: number;
  announcement: string;
};

export const DEFAULT_RUNTIME: AppRuntime = {
  flags: { photoUploads: true, googlePhotos: true, weddingCountdown: false, premiumThemes: true },
  feeLabel: "₹499",
  feePaise: 49900,
  maxPhotos: 50,
  maxVideos: 5,
  announcement: "",
};

let cache: { at: number; value: AppRuntime } | null = null;

export async function appRuntime(force = false) {
  if (!force && cache && Date.now() - cache.at < 15000) return cache.value;
  try {
    const next = await developerPublicConfig();
    const value: AppRuntime = {
      flags: {
        photoUploads: next.flags.photoUploads !== false,
        googlePhotos: next.flags.googlePhotos !== false,
        weddingCountdown: next.flags.weddingCountdown === true,
        premiumThemes: next.flags.premiumThemes !== false,
      },
      feeLabel: next.feeLabel || DEFAULT_RUNTIME.feeLabel,
      feePaise: next.feePaise || DEFAULT_RUNTIME.feePaise,
      maxPhotos: next.maxPhotos || DEFAULT_RUNTIME.maxPhotos,
      maxVideos: next.maxVideos || DEFAULT_RUNTIME.maxVideos,
      announcement: next.announcement || "",
    };
    cache = { at: Date.now(), value };
    return value;
  } catch {
    return cache?.value ?? DEFAULT_RUNTIME;
  }
}

export function useAppRuntime() {
  const [runtime, setRuntime] = useState<AppRuntime>(DEFAULT_RUNTIME);
  useEffect(() => {
    let live = true;
    void appRuntime().then((value) => {
      if (live) setRuntime(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return runtime;
}

const TOKEN_KEY = "wc-dev-session";

export function developerToken() {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

export function rememberDeveloperToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function forgetDeveloperToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}
