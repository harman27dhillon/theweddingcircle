import { create } from "zustand";
import { developerPublicConfig } from "@/lib/developer/console.functions";
import { emptyAppearance, parseAppearance, replaceCustomThemes, type AppearanceConfig, type ClassicThemeRecord } from "@/lib/wedding/classic-maker";

type Registry = {
  rev: number;
  ready: boolean;
  appearance: AppearanceConfig;
  themes: ClassicThemeRecord[];
  setAppearance: (appearance: AppearanceConfig) => void;
};

export const useClassicRegistry = create<Registry>((set) => ({
  rev: 0,
  ready: false,
  appearance: emptyAppearance(),
  themes: [],
  setAppearance: (appearance) => {
    replaceCustomThemes(appearance.themes);
    set((state) => ({ appearance, themes: appearance.themes, ready: true, rev: state.rev + 1 }));
  },
}));

function newer(left: AppearanceConfig, right: AppearanceConfig) {
  return (left.updatedAt || "") >= (right.updatedAt || "") ? left : right;
}

export async function loadAppearance() {
  let remote = emptyAppearance();
  let file = emptyAppearance();
  try {
    const config = await developerPublicConfig();
    remote = parseAppearance((config as { appearance?: unknown }).appearance);
  } catch {
    remote = emptyAppearance();
  }
  try {
    const response = await fetch("/assets/developer/appearance.json", { cache: "no-store" });
    if (response.ok) file = parseAppearance(await response.json());
  } catch {
    file = emptyAppearance();
  }
  const next = newer(remote, file);
  useClassicRegistry.getState().setAppearance(next);
  return next;
}
