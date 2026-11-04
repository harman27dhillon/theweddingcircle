import { createContext, useContext, useRef, type ReactNode } from "react";
import type { Wedding } from "@/lib/wedding/types";

const WeddingContext = createContext<Wedding | null>(null);
const CircleThemeContext = createContext<string | null>(null);

export function WeddingProvider({ wedding, children }: { wedding: Wedding; children: ReactNode }) {
  const held = useRef(wedding);
  const themeOnly =
    held.current !== wedding
    && held.current.id === wedding.id
    && held.current.chats === wedding.chats
    && held.current.posts === wedding.posts
    && held.current.guests === wedding.guests
    && held.current.functions === wedding.functions
    && held.current.cardTheme !== wedding.cardTheme;
  if (themeOnly) {
    if (held.current.cardTheme !== wedding.cardTheme) held.current.cardTheme = wedding.cardTheme;
  } else held.current = wedding;
  return (
    <WeddingContext.Provider value={themeOnly ? held.current : wedding}>
      <CircleThemeContext.Provider value={wedding.cardTheme || "classic-default"}>{children}</CircleThemeContext.Provider>
    </WeddingContext.Provider>
  );
}

export function useWedding() {
  const wedding = useContext(WeddingContext);
  if (!wedding) throw new Error("This screen only opens inside a wedding.");
  return wedding;
}

/** Theme id for this visit. A theme change does not rebuild chat, album, or live state. */
export function useCircleTheme() {
  const themeId = useContext(CircleThemeContext);
  if (!themeId) throw new Error("This screen only opens inside a wedding.");
  return themeId;
}
