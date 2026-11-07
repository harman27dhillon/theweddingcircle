import { isCustomClassicId, readCustomThemes, type ClassicThemeRecord } from "./classic-maker.ts";
export type CardThemeId =
  | "royal-burgundy"
  | "pastel-blush"
  | "sage-green"
  | "royal-blue"
  | "classic-ivory"
  | "midnight-emerald"
  | "terracotta-sunset"
  | "lavender-dream"
  | "classic-default"
  | "blossom-pink"
  | "sky-blue"
  | "rose-romance"
  | "peach-garden"
  | "butterfly-romance"
  | "moonlight-reverie"
  | "monsoon-romance"
  | "anime-ever-after"
  | "royal-palace"
  | "heavens-embrace"
  | "enchanted-garden"
  | "cosmic-destiny"
  | "velvet-rose"
  | "aurora-dreams"
  | "classic-sunset-romance"
  | "classic-celestial-ivory"
  | "classic-crimson-sunset"
  | "classic-marigold-palace"
  | "classic-rose-bridal"
  | "classic-royal-lakeside";

export type ThemeEffect =
  | "butterflies"
  | "moonlight"
  | "rain"
  | "anime-petals"
  | "palace-shimmer"
  | "heavenly-clouds"
  | "fireflies"
  | "cosmic-stars"
  | "rose-petals"
  | "aurora";

/** Chat colours and decoration for one wedding theme. Applied with the theme, not as a separate setting. */
export type ChatDesign = {
  background: string;
  sent: string;
  sentInk: string;
  received: string;
  receivedInk: string;
  border: string;
  radius: string;
  shadow: string;
  name: string;
  header: string;
  heading: string;
  composer: string;
  input: string;
  inputInk: string;
  placeholder: string;
  plus: string;
  plusInk: string;
  send: string;
  sendInk: string;
  nav: string;
  navInk: string;
  navOn: string;
  spark: string;
  sparkBright: string;
  sparkEdge: string;
  sparkGlow: string;
  decor: "flora" | "none";
  petal: string;
};

export type CardTheme = {
  id: string;
  name: string;
  art: string;
  mobileArt?: string;
  artFit?: "cover" | "contain";
  artPosition?: string;
  mobileArtFit?: "cover" | "contain";
  mobileArtPosition?: string;
  landingArt?: {
    desktop?: string;
    mobile?: string;
    fit?: string;
    position?: string;
    mobileFit?: string;
    mobilePosition?: string;
  };
  /** Softened copy of the cover, shared behind every page of this wedding. */
  pageSoft?: boolean;
  shell: {
    "--color-ivory": string;
    "--color-paper": string;
    "--color-card": string;
    "--color-ink": string;
    "--color-muted": string;
    "--color-line": string;
    "--color-maroon": string;
    "--color-gold": string;
    "--color-on-photo": string;
  };
  card: {
    "--wc-name": string;
    "--wc-meta": string;
    "--wc-metal": string;
    "--wc-tile": string;
    "--wc-tile-ink": string;
    "--wc-scrim": string;
  };
  chat: ChatDesign;
  effect?: ThemeEffect;
  /** Default ceremony pictures. Set on the classic catalogue and custom classic themes only. */
  ceremonyCovers?: boolean;
};

type Shell = CardTheme["shell"];
type CardArt = CardTheme["card"];

function theme(id: CardThemeId, name: string, art: string, shell: Shell, card: CardArt, chat: ChatDesign, effect?: ThemeEffect): CardTheme {
  const row: CardTheme = { id, name, art, shell, card, chat, ceremonyCovers: false };
  return effect ? { ...row, effect } : row;
}

function sceneTheme(base: CardTheme, position: string, mobilePosition: string): CardTheme {
  const phone = `${base.art}?v=phone`;
  return {
    ...base,
    mobileArt: phone,
    artFit: "cover",
    artPosition: position,
    mobileArtFit: "cover",
    mobileArtPosition: mobilePosition,
    landingArt: {
      desktop: base.art,
      mobile: phone,
      fit: "cover",
      position,
      mobileFit: "cover",
      mobilePosition,
    },
    pageSoft: true,
  };
}

function chat(partial: ChatDesign): ChatDesign {
  return partial;
}

function photoClassic(
  id: CardThemeId,
  name: string,
  art: string,
  colors: {
    ivory: string;
    card: string;
    ink: string;
    muted: string;
    line: string;
    primary: string;
    accent: string;
    sent: string;
    spark: string;
    wash: string;
  },
  position: string,
  mobile: string,
): CardTheme {
  const c = colors;
  return sceneTheme(
    theme(
      id,
      name,
      art,
      {
        "--color-ivory": c.ivory,
        "--color-paper": c.ivory,
        "--color-card": c.card,
        "--color-ink": c.ink,
        "--color-muted": c.muted,
        "--color-line": c.line,
        "--color-maroon": c.primary,
        "--color-gold": c.accent,
        "--color-on-photo": c.ivory,
      },
      {
        "--wc-name": c.ink,
        "--wc-meta": c.ink,
        "--wc-metal": c.accent,
        "--wc-tile": c.primary,
        "--wc-tile-ink": c.ivory,
        "--wc-scrim": c.ivory,
      },
      chat({
        background: c.wash,
        sent: c.sent,
        sentInk: c.ink,
        received: c.card,
        receivedInk: c.ink,
        border: c.line,
        radius: "1.2rem",
        shadow: `0 10px 22px -16px color-mix(in srgb, ${c.primary} 42%, transparent)`,
        name: c.ink,
        header: `color-mix(in srgb, ${c.ivory} 72%, transparent)`,
        heading: c.ink,
        composer: `color-mix(in srgb, ${c.ivory} 86%, transparent)`,
        input: "transparent",
        inputInk: c.ink,
        placeholder: c.muted,
        plus: c.primary,
        plusInk: c.ivory,
        send: c.primary,
        sendInk: c.ivory,
        nav: c.ink,
        navInk: c.ivory,
        navOn: c.accent,
        spark: c.spark,
        sparkBright: c.ivory,
        sparkEdge: c.primary,
        sparkGlow: `color-mix(in srgb, ${c.primary} 28%, transparent)`,
        decor: "none",
        petal: c.accent,
      }),
    ),
    position,
    mobile,
  );
}

function dressed(input: {
  background: string;
  sent: string;
  sentInk: string;
  received: string;
  receivedInk: string;
  border: string;
  ink: string;
  muted: string;
  primary: string;
  accent: string;
  surface: string;
  nav: string;
  navInk: string;
  navOn?: string;
  petal: string;
  plusInk?: string;
  radius?: string;
}): ChatDesign {
  return {
    background: input.background,
    sent: input.sent,
    sentInk: input.sentInk,
    received: input.received,
    receivedInk: input.receivedInk,
    border: input.border,
    radius: input.radius ?? "1.2rem",
    shadow: `0 10px 22px -16px color-mix(in srgb, ${input.primary} 42%, transparent)`,
    name: input.ink,
    header: `linear-gradient(180deg, ${input.surface}e6, ${input.surface}00)`,
    heading: input.ink,
    composer: input.surface,
    input: "transparent",
    inputInk: input.ink,
    placeholder: input.muted,
    plus: input.primary,
    plusInk: input.plusInk ?? input.navInk,
    send: input.primary,
    sendInk: input.plusInk ?? input.navInk,
    nav: input.nav,
    navInk: input.navInk,
    navOn: input.navOn ?? input.accent,
    spark: input.accent,
    sparkBright: input.surface,
    sparkEdge: input.accent,
    sparkGlow: "rgba(0, 0, 0, 0.14)",
    decor: "flora",
    petal: input.petal,
  };
}

const PREMIUM_THEMES: readonly CardTheme[] = [
  theme(
    "butterfly-romance",
    "Butterfly Romance",
    "/card-themes/butterfly-romance.webp",
    {
      "--color-ivory": "#FFF1F5",
      "--color-paper": "#FFF6F9",
      "--color-card": "#FFFAFC",
      "--color-ink": "#593848",
      "--color-muted": "#856878",
      "--color-line": "#EBD0DB",
      "--color-maroon": "#A65476",
      "--color-gold": "#D9B16F",
      "--color-on-photo": "#FFFAFC",
    },
    {
      "--wc-name": "#593848",
      "--wc-meta": "#7A5568",
      "--wc-metal": "#D9B16F",
      "--wc-tile": "#A65476",
      "--wc-tile-ink": "#FFFAFC",
      "--wc-scrim": "#FFF1F5",
    },
    dressed({
      background: "radial-gradient(circle at 88% 8%, #f8c9da 0%, transparent 34%), radial-gradient(circle at 8% 90%, #f3d7b4 0%, transparent 32%), linear-gradient(180deg, #fff6f9 0%, #fde4ee 100%)",
      sent: "#E8B4C8",
      sentInk: "#593848",
      received: "#FFFAFC",
      receivedInk: "#593848",
      border: "#EBD0DB",
      ink: "#593848",
      muted: "#856878",
      primary: "#A65476",
      accent: "#D9B16F",
      surface: "#FFFAFC",
      nav: "#8E4566",
      navInk: "#FFF1F5",
      navOn: "#EAD3AE",
      petal: "#E8B4C8",
      radius: "1.28rem",
    }),
    "butterflies",
  ),
  theme(
    "moonlight-reverie",
    "Moonlight Reverie",
    "/card-themes/moonlight-reverie.webp",
    {
      "--color-ivory": "#10182F",
      "--color-paper": "#1A2542",
      "--color-card": "#151E38",
      "--color-ink": "#F6F2FF",
      "--color-muted": "#B5BED7",
      "--color-line": "#39476B",
      "--color-maroon": "#3E5688",
      "--color-gold": "#D9D5F4",
      "--color-on-photo": "#F6F2FF",
    },
    {
      "--wc-name": "#F6F2FF",
      "--wc-meta": "#D9D5F4",
      "--wc-metal": "#D9D5F4",
      "--wc-tile": "#24314F",
      "--wc-tile-ink": "#F6F2FF",
      "--wc-scrim": "#10182F",
    },
    dressed({
      background: "radial-gradient(circle at 78% 0%, #8fa8e855 0%, transparent 36%), radial-gradient(circle at 12% 100%, #d9d5f422 0%, transparent 40%), linear-gradient(180deg, #1a2542 0%, #10182f 100%)",
      sent: "#46588A",
      sentInk: "#F6F2FF",
      received: "#24314F",
      receivedInk: "#F6F2FF",
      border: "#39476B",
      ink: "#F6F2FF",
      muted: "#B5BED7",
      primary: "#8FA8E8",
      accent: "#D9D5F4",
      surface: "#1A2542",
      nav: "#10182F",
      navInk: "#F6F2FF",
      plusInk: "#10182F",
      petal: "#D9D5F4",
      radius: "1.15rem",
    }),
    "moonlight",
  ),
  theme(
    "monsoon-romance",
    "Monsoon Romance",
    "/card-themes/monsoon-romance.webp",
    {
      "--color-ivory": "#E9F1F0",
      "--color-paper": "#F3F8F7",
      "--color-card": "#F8FBFA",
      "--color-ink": "#244643",
      "--color-muted": "#55726D",
      "--color-line": "#C7DEDA",
      "--color-maroon": "#367A73",
      "--color-gold": "#D2B77D",
      "--color-on-photo": "#F8FBFA",
    },
    {
      "--wc-name": "#244643",
      "--wc-meta": "#3E6460",
      "--wc-metal": "#D2B77D",
      "--wc-tile": "#367A73",
      "--wc-tile-ink": "#F8FBFA",
      "--wc-scrim": "#E9F1F0",
    },
    dressed({
      background: "radial-gradient(circle at 10% 0%, #d2b77d44 0%, transparent 32%), linear-gradient(180deg, #f4faf8 0%, #d5e8e4 100%)",
      sent: "#BBD9D2",
      sentInk: "#244643",
      received: "#FFFFFF",
      receivedInk: "#244643",
      border: "#C7DEDA",
      ink: "#244643",
      muted: "#55726D",
      primary: "#367A73",
      accent: "#D2B77D",
      surface: "#F8FBFA",
      nav: "#245E58",
      navInk: "#F8FBFA",
      navOn: "#DCC79A",
      petal: "#BBD9D2",
    }),
    "rain",
  ),
  theme(
    "anime-ever-after",
    "Anime Ever After",
    "/card-themes/anime-ever-after.webp",
    {
      "--color-ivory": "#F4F0FF",
      "--color-paper": "#F8F5FF",
      "--color-card": "#FFFCFF",
      "--color-ink": "#43365F",
      "--color-muted": "#756891",
      "--color-line": "#DED2F4",
      "--color-maroon": "#7E66B4",
      "--color-gold": "#E9AFC8",
      "--color-on-photo": "#FFFCFF",
    },
    {
      "--wc-name": "#43365F",
      "--wc-meta": "#675884",
      "--wc-metal": "#E9AFC8",
      "--wc-tile": "#7E66B4",
      "--wc-tile-ink": "#FFFCFF",
      "--wc-scrim": "#F4F0FF",
    },
    dressed({
      background: "radial-gradient(circle at 84% 10%, #e9afc888 0%, transparent 34%), radial-gradient(circle at 12% 88%, #b7d7f666 0%, transparent 36%), linear-gradient(180deg, #f7f3ff 0%, #efe6ff 100%)",
      sent: "#E4D8FA",
      sentInk: "#43365F",
      received: "#FFFCFF",
      receivedInk: "#43365F",
      border: "#DED2F4",
      ink: "#43365F",
      muted: "#756891",
      primary: "#7E66B4",
      accent: "#E9AFC8",
      surface: "#FFFCFF",
      nav: "#5C4688",
      navInk: "#FFFCFF",
      navOn: "#EBB7CE",
      petal: "#E9AFC8",
      radius: "1.35rem",
    }),
    "anime-petals",
  ),
  theme(
    "royal-palace",
    "Royal Palace",
    "/card-themes/royal-palace.webp",
    {
      "--color-ivory": "#2C1019",
      "--color-paper": "#3A1824",
      "--color-card": "#241018",
      "--color-ink": "#F8EEDB",
      "--color-muted": "#E6D0A3",
      "--color-line": "#BD9250",
      "--color-maroon": "#6E2430",
      "--color-gold": "#E6D0A3",
      "--color-on-photo": "#F8EEDB",
    },
    {
      "--wc-name": "#F8EEDB",
      "--wc-meta": "#E6D0A3",
      "--wc-metal": "#E6D0A3",
      "--wc-tile": "#4A1824",
      "--wc-tile-ink": "#F8EEDB",
      "--wc-scrim": "#1A0A10",
    },
    dressed({
      background: "radial-gradient(circle at 70% 0%, #bd925044 0%, transparent 36%), linear-gradient(180deg, #3a1824 0%, #2c1019 100%)",
      sent: "#5A2A34",
      sentInk: "#F8EEDB",
      received: "#3A1824",
      receivedInk: "#F8EEDB",
      border: "#BD9250",
      ink: "#F8EEDB",
      muted: "#E6D0A3",
      primary: "#BD9250",
      accent: "#E6D0A3",
      surface: "#3A1824",
      nav: "#2C1019",
      navInk: "#F8EEDB",
      plusInk: "#2C1019",
      petal: "#E6D0A3",
      radius: "0.85rem",
    }),
    "palace-shimmer",
  ),
  theme(
    "heavens-embrace",
    "Heaven's Embrace",
    "/card-themes/heavens-embrace.webp",
    {
      "--color-ivory": "#F0F6FF",
      "--color-paper": "#F7FAFF",
      "--color-card": "#FFFFFF",
      "--color-ink": "#35486A",
      "--color-muted": "#5E7190",
      "--color-line": "#D8E4F5",
      "--color-maroon": "#5C769A",
      "--color-gold": "#D8BD79",
      "--color-on-photo": "#FFFFFF",
    },
    {
      "--wc-name": "#35486A",
      "--wc-meta": "#54688A",
      "--wc-metal": "#D8BD79",
      "--wc-tile": "#5C769A",
      "--wc-tile-ink": "#FFFFFF",
      "--wc-scrim": "#F0F6FF",
    },
    dressed({
      background: "radial-gradient(circle at 20% 0%, #ffffff 0%, transparent 42%), radial-gradient(circle at 80% 20%, #d8bd7944 0%, transparent 30%), linear-gradient(180deg, #f7fbff 0%, #e3edf9 100%)",
      sent: "#DDE9FC",
      sentInk: "#35486A",
      received: "#FFFFFF",
      receivedInk: "#35486A",
      border: "#D8E4F5",
      ink: "#35486A",
      muted: "#5E7190",
      primary: "#5C769A",
      accent: "#D8BD79",
      surface: "#FFFFFF",
      nav: "#3D5D86",
      navInk: "#FFFFFF",
      navOn: "#E4D2A4",
      petal: "#DDE9FC",
      radius: "1.4rem",
    }),
    "heavenly-clouds",
  ),
  theme(
    "enchanted-garden",
    "Enchanted Garden",
    "/card-themes/enchanted-garden.webp",
    {
      "--color-ivory": "#EAF0E6",
      "--color-paper": "#F3F7EF",
      "--color-card": "#F8FBF4",
      "--color-ink": "#263E30",
      "--color-muted": "#5B7060",
      "--color-line": "#C7D7C3",
      "--color-maroon": "#38664A",
      "--color-gold": "#D0B16D",
      "--color-on-photo": "#F8FBF4",
    },
    {
      "--wc-name": "#263E30",
      "--wc-meta": "#3E5A48",
      "--wc-metal": "#D0B16D",
      "--wc-tile": "#38664A",
      "--wc-tile-ink": "#F8FBF4",
      "--wc-scrim": "#EAF0E6",
    },
    dressed({
      background: "radial-gradient(circle at 86% 12%, #d0b16d44 0%, transparent 32%), linear-gradient(180deg, #f4f8ef 0%, #d7e4d2 100%)",
      sent: "#C7DDC5",
      sentInk: "#263E30",
      received: "#F8FBF4",
      receivedInk: "#263E30",
      border: "#C7D7C3",
      ink: "#263E30",
      muted: "#5B7060",
      primary: "#38664A",
      accent: "#D0B16D",
      surface: "#F8FBF4",
      nav: "#2A4A36",
      navInk: "#F8FBF4",
      petal: "#D0B16D",
    }),
    "fireflies",
  ),
  theme(
    "cosmic-destiny",
    "Cosmic Destiny",
    "/card-themes/cosmic-destiny.webp",
    {
      "--color-ivory": "#17142F",
      "--color-paper": "#242044",
      "--color-card": "#1E1A3A",
      "--color-ink": "#F6F1FF",
      "--color-muted": "#B8B0D8",
      "--color-line": "#454064",
      "--color-maroon": "#6A549E",
      "--color-gold": "#E0C58A",
      "--color-on-photo": "#F6F1FF",
    },
    {
      "--wc-name": "#F6F1FF",
      "--wc-meta": "#E0C58A",
      "--wc-metal": "#E0C58A",
      "--wc-tile": "#29264B",
      "--wc-tile-ink": "#F6F1FF",
      "--wc-scrim": "#17142F",
    },
    dressed({
      background: "radial-gradient(circle at 70% 10%, #9b80de55 0%, transparent 38%), radial-gradient(circle at 16% 80%, #e0c58a22 0%, transparent 36%), linear-gradient(180deg, #242044 0%, #17142f 100%)",
      sent: "#51418A",
      sentInk: "#F6F1FF",
      received: "#29264B",
      receivedInk: "#F6F1FF",
      border: "#454064",
      ink: "#F6F1FF",
      muted: "#B8B0D8",
      primary: "#9B80DE",
      accent: "#E0C58A",
      surface: "#242044",
      nav: "#17142F",
      navInk: "#F6F1FF",
      plusInk: "#17142F",
      petal: "#E0C58A",
    }),
    "cosmic-stars",
  ),
  theme(
    "velvet-rose",
    "Velvet Rose",
    "/card-themes/velvet-rose.webp",
    {
      "--color-ivory": "#3B1724",
      "--color-paper": "#4A2030",
      "--color-card": "#2E121C",
      "--color-ink": "#F8E7EA",
      "--color-muted": "#E7C3CC",
      "--color-line": "#B77D8F",
      "--color-maroon": "#7A3048",
      "--color-gold": "#C9A56A",
      "--color-on-photo": "#F8E7EA",
    },
    {
      "--wc-name": "#F8E7EA",
      "--wc-meta": "#E7C3CC",
      "--wc-metal": "#C9A56A",
      "--wc-tile": "#5A2434",
      "--wc-tile-ink": "#F8E7EA",
      "--wc-scrim": "#240E16",
    },
    dressed({
      background: "radial-gradient(circle at 80% 0%, #a34e6944 0%, transparent 38%), linear-gradient(180deg, #4a2030 0%, #3b1724 100%)",
      sent: "#6A3044",
      sentInk: "#F8E7EA",
      received: "#4A2030",
      receivedInk: "#F8E7EA",
      border: "#B77D8F",
      ink: "#F8E7EA",
      muted: "#E7C3CC",
      primary: "#C9A56A",
      accent: "#E7C3CC",
      surface: "#4A2030",
      nav: "#3B1724",
      navInk: "#F8E7EA",
      plusInk: "#3B1724",
      petal: "#E7C0C7",
      radius: "1.25rem",
    }),
    "rose-petals",
  ),
  theme(
    "aurora-dreams",
    "Aurora Dreams",
    "/card-themes/aurora-dreams.webp",
    {
      "--color-ivory": "#EAF5F3",
      "--color-paper": "#F3FAF8",
      "--color-card": "#F8FCFB",
      "--color-ink": "#203D40",
      "--color-muted": "#577377",
      "--color-line": "#C8E1DF",
      "--color-maroon": "#367F7A",
      "--color-gold": "#A68DD4",
      "--color-on-photo": "#F8FCFB",
    },
    {
      "--wc-name": "#203D40",
      "--wc-meta": "#3A5C60",
      "--wc-metal": "#A68DD4",
      "--wc-tile": "#367F7A",
      "--wc-tile-ink": "#F8FCFB",
      "--wc-scrim": "#EAF5F3",
    },
    dressed({
      background: "linear-gradient(120deg, #d9f3ec 0%, #e7e0f8 42%, #c9efe8 100%)",
      sent: "#C4E6DF",
      sentInk: "#203D40",
      received: "#F8FCFB",
      receivedInk: "#203D40",
      border: "#C8E1DF",
      ink: "#203D40",
      muted: "#577377",
      primary: "#367F7A",
      accent: "#A68DD4",
      surface: "#F8FCFB",
      nav: "#2A6562",
      navInk: "#F8FCFB",
      navOn: "#DACFED",
      petal: "#A68DD4",
      radius: "1.3rem",
    }),
    "aurora",
  ),
];

export const CARD_THEMES: readonly CardTheme[] = [
  theme(
    "royal-burgundy",
    "Royal Burgundy",
    "/card-themes/royal-burgundy.webp",
    {
      "--color-ivory": "#4A101F",
      "--color-paper": "#5A1730",
      "--color-card": "#3A0E1C",
      "--color-ink": "#FFF8F0",
      "--color-muted": "#E4CCC8",
      "--color-line": "#D6B477",
      "--color-maroon": "#8C263D",
      "--color-gold": "#D6B477",
      "--color-on-photo": "#FFF8F0",
    },
    {
      "--wc-name": "#f8f1e4",
      "--wc-meta": "#f3e6d4",
      "--wc-metal": "#e4c27a",
      "--wc-tile": "#641526",
      "--wc-tile-ink": "#fbf6f0",
      "--wc-scrim": "#2a0a12",
    },
    chat({
      background: "radial-gradient(circle at 88% 12%, #7a2740 0%, transparent 36%), linear-gradient(180deg, #5a1730 0%, #2a0a14 100%)",
      sent: "#6e2438",
      sentInk: "#fff6ea",
      received: "#3d1524",
      receivedInk: "#f8efe6",
      border: "#e4c27a",
      radius: "1.2rem",
      shadow: "0 8px 18px -14px rgba(20, 4, 8, 0.8), inset 0 1px rgba(255, 246, 234, 0.16)",
      name: "#f0d7a2",
      header: "linear-gradient(180deg, #4a101f 0%, #4a101fd0 100%)",
      heading: "#fff8f0",
      composer: "rgba(58, 14, 28, 0.92)",
      input: "transparent",
      inputInk: "#fff8f0",
      placeholder: "#e4ccc8",
      plus: "#f3e6c8",
      plusInk: "#701c32",
      send: "#8c263d",
      sendInk: "#fff8f0",
      nav: "#3a0e1c",
      navInk: "#f8efe6",
      navOn: "#e4c27a",
      spark: "#f0d7a2",
      sparkBright: "#fff6dd",
      sparkEdge: "#e4c27a",
      sparkGlow: "rgba(228, 194, 122, 0.5)",
      decor: "flora",
      petal: "#e4c27a",
    }),
  ),
  theme(
    "pastel-blush",
    "Pastel Blush",
    "/card-themes/pastel-blush.webp",
    {
      "--color-ivory": "#fbf1ec",
      "--color-paper": "#fff7f4",
      "--color-card": "#fffdfb",
      "--color-ink": "#3a2428",
      "--color-muted": "#8a6570",
      "--color-line": "#f0d9d4",
      "--color-maroon": "#7c3144",
      "--color-gold": "#a56b52",
      "--color-on-photo": "#fff7f4",
    },
    {
      "--wc-name": "#4a2030",
      "--wc-meta": "#5c3040",
      "--wc-metal": "#a56b3c",
      "--wc-tile": "#7a3040",
      "--wc-tile-ink": "#fff6f2",
      "--wc-scrim": "#fff3e8",
    },
    chat({
      background: "radial-gradient(circle at 86% 8%, #f6c9d4 0%, transparent 34%), radial-gradient(circle at 10% 90%, #f3d7c8 0%, transparent 36%), linear-gradient(180deg, #fff6f2 0%, #f8e4e0 100%)",
      sent: "#fff7f4",
      sentInk: "#6a2940",
      received: "#fffdfb",
      receivedInk: "#4a2030",
      border: "#e7c2b4",
      radius: "1.25rem",
      shadow: "0 10px 22px -16px rgba(122, 48, 64, 0.45), inset 0 1px rgba(255,255,255,0.8)",
      name: "#7c3144",
      header: "linear-gradient(180deg, #fbf1ecd8, #fbf1ec00)",
      heading: "#4a2030",
      composer: "rgba(255, 253, 251, 0.94)",
      input: "transparent",
      inputInk: "#3a2428",
      placeholder: "#8a6570",
      plus: "#7c3144",
      plusInk: "#fff7f4",
      send: "#7c3144",
      sendInk: "#fff7f4",
      nav: "#7a3040",
      navInk: "#fff6f2",
      navOn: "#f0d7a2",
      spark: "#e8c99a",
      sparkBright: "#fff8f1",
      sparkEdge: "#d9a08c",
      sparkGlow: "rgba(196, 122, 142, 0.4)",
      decor: "flora",
      petal: "#e7a0b0",
    }),
  ),
  theme(
    "sage-green",
    "Sage Green",
    "/card-themes/sage-green.webp",
    {
      "--color-ivory": "#f1f4ec",
      "--color-paper": "#f7faf3",
      "--color-card": "#fffcf8",
      "--color-ink": "#1c2820",
      "--color-muted": "#5f7264",
      "--color-line": "#d5e2d4",
      "--color-maroon": "#2c4a36",
      "--color-gold": "#8a7340",
      "--color-on-photo": "#f6f7f1",
    },
    {
      "--wc-name": "#1d3324",
      "--wc-meta": "#2c4634",
      "--wc-metal": "#8d7040",
      "--wc-tile": "#2a4634",
      "--wc-tile-ink": "#f4f6ef",
      "--wc-scrim": "#f4f7ef",
    },
    chat({
      background: "radial-gradient(circle at 90% 0%, #d5e2c8 0%, transparent 38%), linear-gradient(180deg, #f7faf3 0%, #e3eddb 100%)",
      sent: "#f7f3e6",
      sentInk: "#1d3324",
      received: "#fffcf8",
      receivedInk: "#1c2820",
      border: "#c5d4bc",
      radius: "1.2rem",
      shadow: "0 8px 18px -14px rgba(44, 74, 54, 0.4)",
      name: "#2c4a36",
      header: "linear-gradient(180deg, #f1f4ecd4, #f1f4ec00)",
      heading: "#1d3324",
      composer: "rgba(255, 252, 248, 0.94)",
      input: "transparent",
      inputInk: "#1c2820",
      placeholder: "#5f7264",
      plus: "#2c4a36",
      plusInk: "#f6f7f1",
      send: "#2c4a36",
      sendInk: "#f6f7f1",
      nav: "#2a4634",
      navInk: "#f4f6ef",
      navOn: "#d2c4a0",
      spark: "#d2c4a0",
      sparkBright: "#f7f3e6",
      sparkEdge: "#b7a67a",
      sparkGlow: "rgba(120, 140, 110, 0.34)",
      decor: "flora",
      petal: "#b7c9a4",
    }),
  ),
  theme(
    "royal-blue",
    "Royal Blue",
    "/card-themes/royal-blue.webp",
    {
      "--color-ivory": "#101C36",
      "--color-paper": "#182848",
      "--color-card": "#0C1630",
      "--color-ink": "#F4F7FB",
      "--color-muted": "#C9D4E6",
      "--color-line": "#C9B57A",
      "--color-maroon": "#2E5E9E",
      "--color-gold": "#C9B57A",
      "--color-on-photo": "#F4F7FB",
    },
    {
      "--wc-name": "#f6f3ea",
      "--wc-meta": "#e7e2d4",
      "--wc-metal": "#e2c78a",
      "--wc-tile": "#152c56",
      "--wc-tile-ink": "#f7f4ec",
      "--wc-scrim": "#0c1830",
    },
    chat({
      background: "radial-gradient(circle at 84% 10%, #244e86 0%, transparent 40%), linear-gradient(180deg, #182848 0%, #0c1630 100%)",
      sent: "#1d3d6e",
      sentInk: "#f6f3ea",
      received: "#152848",
      receivedInk: "#f4f7fb",
      border: "#d4bc86",
      radius: "1.2rem",
      shadow: "0 8px 18px -14px rgba(4, 10, 24, 0.8), inset 0 1px rgba(246, 243, 234, 0.14)",
      name: "#e7d3a4",
      header: "linear-gradient(180deg, #101c36e6, #101c3600)",
      heading: "#f4f7fb",
      composer: "rgba(12, 22, 48, 0.92)",
      input: "transparent",
      inputInk: "#f4f7fb",
      placeholder: "#c9d4e6",
      plus: "#f6f3ea",
      plusInk: "#152c56",
      send: "#2e5e9e",
      sendInk: "#f4f7fb",
      nav: "#0c1630",
      navInk: "#f4f7fb",
      navOn: "#e2c78a",
      spark: "#e7d3a4",
      sparkBright: "#fff6e4",
      sparkEdge: "#d4bc86",
      sparkGlow: "rgba(212, 188, 134, 0.5)",
      decor: "flora",
      petal: "#e2c78a",
    }),
  ),
  theme(
    "classic-ivory",
    "Classic Ivory",
    "/card-themes/classic-ivory.webp",
    {
      "--color-ivory": "#f6f2ea",
      "--color-paper": "#fbf8f2",
      "--color-card": "#fffdfb",
      "--color-ink": "#2a241e",
      "--color-muted": "#75685c",
      "--color-line": "#e4d9cc",
      "--color-maroon": "#3c342c",
      "--color-gold": "#8d7044",
      "--color-on-photo": "#fbf8f3",
    },
    {
      "--wc-name": "#2c241c",
      "--wc-meta": "#4a3e34",
      "--wc-metal": "#a68448",
      "--wc-tile": "#3a322c",
      "--wc-tile-ink": "#fbf6ee",
      "--wc-scrim": "#fff8ef",
    },
    chat({
      background: "linear-gradient(180deg, #fbf8f2 0%, #f3eadc 100%)",
      sent: "#fffdfb",
      sentInk: "#2c241c",
      received: "#fbf8f2",
      receivedInk: "#2a241e",
      border: "#e4d3bc",
      radius: "1.05rem",
      shadow: "0 6px 14px -12px rgba(60, 52, 44, 0.35)",
      name: "#3c342c",
      header: "linear-gradient(180deg, #f6f2eae0, #f6f2ea00)",
      heading: "#2c241c",
      composer: "rgba(255, 253, 251, 0.96)",
      input: "transparent",
      inputInk: "#2a241e",
      placeholder: "#75685c",
      plus: "#3c342c",
      plusInk: "#fbf8f3",
      send: "#3c342c",
      sendInk: "#fbf8f3",
      nav: "#3a322c",
      navInk: "#fbf6ee",
      navOn: "#d9c7a2",
      spark: "#d9c7a2",
      sparkBright: "#fbf6ec",
      sparkEdge: "#c6b089",
      sparkGlow: "rgba(184, 156, 112, 0.28)",
      decor: "flora",
      petal: "#e7d3b3",
    }),
  ),
  theme(
    "midnight-emerald",
    "Midnight Emerald",
    "/card-themes/midnight-emerald.webp",
    {
      "--color-ivory": "#0C2820",
      "--color-paper": "#14382C",
      "--color-card": "#082018",
      "--color-ink": "#F4F7F2",
      "--color-muted": "#C9DDD2",
      "--color-line": "#C9B56A",
      "--color-maroon": "#1F6A52",
      "--color-gold": "#C9B56A",
      "--color-on-photo": "#F4F7F2",
    },
    {
      "--wc-name": "#f6f1e4",
      "--wc-meta": "#e7e0cc",
      "--wc-metal": "#e2c27a",
      "--wc-tile": "#0c3d30",
      "--wc-tile-ink": "#f6f3ea",
      "--wc-scrim": "#06281e",
    },
    chat({
      background: "radial-gradient(circle at 86% 8%, #1f6a52 0%, transparent 38%), linear-gradient(180deg, #14382c 0%, #082018 100%)",
      sent: "#145443",
      sentInk: "#f6f1e4",
      received: "#0e3328",
      receivedInk: "#f4f7f2",
      border: "#e6c98a",
      radius: "1.2rem",
      shadow: "0 8px 18px -14px rgba(4, 20, 14, 0.85), inset 0 1px rgba(246, 241, 228, 0.12)",
      name: "#f2d9a6",
      header: "linear-gradient(180deg, #0c2820e6, #0c282000)",
      heading: "#f4f7f2",
      composer: "rgba(8, 32, 24, 0.92)",
      input: "transparent",
      inputInk: "#f4f7f2",
      placeholder: "#c9ddd2",
      plus: "#f6f1e4",
      plusInk: "#0c3d30",
      send: "#1f6a52",
      sendInk: "#f4f7f2",
      nav: "#082018",
      navInk: "#f4f7f2",
      navOn: "#e2c27a",
      spark: "#f2d9a6",
      sparkBright: "#fff8e6",
      sparkEdge: "#e6c98a",
      sparkGlow: "rgba(230, 201, 138, 0.52)",
      decor: "flora",
      petal: "#e2c27a",
    }),
  ),
  theme(
    "terracotta-sunset",
    "Terracotta Sunset",
    "/card-themes/terracotta-sunset.webp",
    {
      "--color-ivory": "#f8efe6",
      "--color-paper": "#fbf6f0",
      "--color-card": "#fffdfb",
      "--color-ink": "#2c1c16",
      "--color-muted": "#866656",
      "--color-line": "#ead6c8",
      "--color-maroon": "#7a3422",
      "--color-gold": "#8d6234",
      "--color-on-photo": "#fff6ef",
    },
    {
      "--wc-name": "#3a2218",
      "--wc-meta": "#5c3828",
      "--wc-metal": "#a56b32",
      "--wc-tile": "#7a3422",
      "--wc-tile-ink": "#fff6ee",
      "--wc-scrim": "#fff1e4",
    },
    chat({
      background: "radial-gradient(circle at 78% 18%, #f0b09099 0%, transparent 36%), linear-gradient(180deg, #fff1e6 0%, #f3d2bc 55%, #e8c2a8 100%)",
      sent: "#fff6ef",
      sentInk: "#7a3422",
      received: "#fffdfb",
      receivedInk: "#5c3828",
      border: "#e2b07a",
      radius: "1.25rem",
      shadow: "0 10px 20px -16px rgba(122, 52, 34, 0.45)",
      name: "#7a3422",
      header: "linear-gradient(180deg, #f8efe6d8, #f8efe600)",
      heading: "#3a2218",
      composer: "rgba(255, 246, 239, 0.94)",
      input: "transparent",
      inputInk: "#2c1c16",
      placeholder: "#866656",
      plus: "#7a3422",
      plusInk: "#fff6ef",
      send: "#7a3422",
      sendInk: "#fff6ef",
      nav: "#7a3422",
      navInk: "#fff6ee",
      navOn: "#e2b07a",
      spark: "#e2b07a",
      sparkBright: "#fff1df",
      sparkEdge: "#d09a62",
      sparkGlow: "rgba(190, 112, 72, 0.38)",
      decor: "flora",
      petal: "#e8a07a",
    }),
  ),
  theme(
    "lavender-dream",
    "Lavender Dream",
    "/card-themes/lavender-dream.webp",
    {
      "--color-ivory": "#f3eef6",
      "--color-paper": "#f8f5fb",
      "--color-card": "#fefcff",
      "--color-ink": "#241c2c",
      "--color-muted": "#6e6280",
      "--color-line": "#e0d6ea",
      "--color-maroon": "#4e3168",
      "--color-gold": "#5e6578",
      "--color-on-photo": "#f8f4fb",
    },
    {
      "--wc-name": "#2e2040",
      "--wc-meta": "#463258",
      "--wc-metal": "#6a7080",
      "--wc-tile": "#4c2f66",
      "--wc-tile-ink": "#f7f4fb",
      "--wc-scrim": "#f6f1fb",
    },
    chat({
      background: "radial-gradient(circle at 12% 0%, #e4d4f2 0%, transparent 36%), linear-gradient(180deg, #f8f5fb 0%, #e7dff2 100%)",
      sent: "#fefcff",
      sentInk: "#3a2858",
      received: "#f8f5fb",
      receivedInk: "#241c2c",
      border: "#d9cce6",
      radius: "1.25rem",
      shadow: "0 10px 20px -16px rgba(78, 49, 104, 0.4)",
      name: "#4e3168",
      header: "linear-gradient(180deg, #f3eef6d8, #f3eef600)",
      heading: "#2e2040",
      composer: "rgba(254, 252, 255, 0.94)",
      input: "transparent",
      inputInk: "#241c2c",
      placeholder: "#6e6280",
      plus: "#4e3168",
      plusInk: "#f8f4fb",
      send: "#4e3168",
      sendInk: "#f8f4fb",
      nav: "#4c2f66",
      navInk: "#f7f4fb",
      navOn: "#e6d5b4",
      spark: "#e6d5b4",
      sparkBright: "#fff9f2",
      sparkEdge: "#d4c2a2",
      sparkGlow: "rgba(176, 156, 198, 0.38)",
      decor: "flora",
      petal: "#d4c2e6",
    }),
  ),
  theme(
    "classic-default",
    "Classic Default",
    "/card-themes/classic-default-cover.webp",
    {
      "--color-ivory": "#f4efe8",
      "--color-paper": "#fbf8f4",
      "--color-card": "#fffdfb",
      "--color-ink": "#1c1412",
      "--color-muted": "#7a6a62",
      "--color-line": "#e4d9ce",
      "--color-maroon": "#8c2f39",
      "--color-gold": "#a68456",
      "--color-on-photo": "#fbf8f4",
    },
    {
      "--wc-name": "#2a241e",
      "--wc-meta": "#4a3e34",
      "--wc-metal": "#a68456",
      "--wc-tile": "#6e2d3c",
      "--wc-tile-ink": "#fbf6ee",
      "--wc-scrim": "#fff6ee",
    },
    chat({
      background: "#f4efe8",
      sent: "#6e3a32",
      sentInk: "#fbf8f4",
      received: "#fffdfb",
      receivedInk: "#1c1412",
      border: "#e4d9ce",
      radius: "1.15rem",
      shadow: "none",
      name: "#6e2d3c",
      header: "#f4efe8",
      heading: "#1c1412",
      composer: "#fffdfb",
      input: "transparent",
      inputInk: "#1c1412",
      placeholder: "#7a6a62",
      plus: "#fbf8f4",
      plusInk: "#6e2d3c",
      send: "#8c2f39",
      sendInk: "#fbf8f4",
      nav: "#fbf8f4",
      navInk: "#1c1412",
      navOn: "#8c2f39",
      spark: "#b8956a",
      sparkBright: "#f3e6cf",
      sparkEdge: "#a68456",
      sparkGlow: "rgba(166, 132, 86, 0.22)",
      decor: "none",
      petal: "transparent",
    }),
  ),
  theme(
    "blossom-pink",
    "Blossom Pink",
    "/card-themes/blossom-pink.webp",
    {
      "--color-ivory": "#fff1f5",
      "--color-paper": "#fff7fa",
      "--color-card": "#fffdfd",
      "--color-ink": "#3d2432",
      "--color-muted": "#8d6174",
      "--color-line": "#f3d5e0",
      "--color-maroon": "#a23b62",
      "--color-gold": "#c6a36a",
      "--color-on-photo": "#fff7fa",
    },
    {
      "--wc-name": "#5a2340",
      "--wc-meta": "#6e3850",
      "--wc-metal": "#c6a36a",
      "--wc-tile": "#a23b62",
      "--wc-tile-ink": "#fff7fa",
      "--wc-scrim": "#fff1f6",
    },
    chat({
      background: "radial-gradient(circle at 90% 6%, #f8c3d6 0%, transparent 32%), radial-gradient(circle at 8% 92%, #f6d9c4 0%, transparent 34%), linear-gradient(180deg, #fff5f8 0%, #fde4ee 100%)",
      sent: "#fff7fa",
      sentInk: "#7a2450",
      received: "#fffdfd",
      receivedInk: "#4a2436",
      border: "#efc3d4",
      radius: "1.3rem",
      shadow: "0 10px 22px -16px rgba(162, 59, 98, 0.4), inset 0 1px rgba(255,255,255,0.85)",
      name: "#a23b62",
      header: "linear-gradient(180deg, #fff1f5e0, #fff1f500)",
      heading: "#5a2340",
      composer: "rgba(255, 253, 253, 0.95)",
      input: "transparent",
      inputInk: "#3d2432",
      placeholder: "#8d6174",
      plus: "#a23b62",
      plusInk: "#fff7fa",
      send: "#a23b62",
      sendInk: "#fff7fa",
      nav: "#8d3458",
      navInk: "#fff7fa",
      navOn: "#f0d7a8",
      spark: "#e8c99a",
      sparkBright: "#fff8ee",
      sparkEdge: "#d7b48a",
      sparkGlow: "rgba(198, 163, 106, 0.4)",
      decor: "flora",
      petal: "#f3a8c4",
    }),
  ),
  theme(
    "sky-blue",
    "Sky Blue",
    "/card-themes/sky-blue.webp",
    {
      "--color-ivory": "#f3f7fb",
      "--color-paper": "#f8fbfe",
      "--color-card": "#ffffff",
      "--color-ink": "#243246",
      "--color-muted": "#61748a",
      "--color-line": "#d5e2ee",
      "--color-maroon": "#2f567c",
      "--color-gold": "#8ea0b4",
      "--color-on-photo": "#f8fbfe",
    },
    {
      "--wc-name": "#1e334c",
      "--wc-meta": "#3a516c",
      "--wc-metal": "#8ea0b4",
      "--wc-tile": "#2f567c",
      "--wc-tile-ink": "#f8fbfe",
      "--wc-scrim": "#f3f7fb",
    },
    chat({
      background: "radial-gradient(circle at 80% 0%, #d7e8f6 0%, transparent 40%), linear-gradient(180deg, #f8fbfe 0%, #e4eef6 100%)",
      sent: "#ffffff",
      sentInk: "#1e3d5c",
      received: "#f8fbfe",
      receivedInk: "#243246",
      border: "#c9d8e6",
      radius: "1.2rem",
      shadow: "0 8px 18px -14px rgba(36, 50, 70, 0.35)",
      name: "#2f567c",
      header: "linear-gradient(180deg, #f3f7fbe0, #f3f7fb00)",
      heading: "#1e334c",
      composer: "rgba(255, 255, 255, 0.96)",
      input: "transparent",
      inputInk: "#243246",
      placeholder: "#61748a",
      plus: "#2f567c",
      plusInk: "#f8fbfe",
      send: "#2f567c",
      sendInk: "#f8fbfe",
      nav: "#2a4664",
      navInk: "#f8fbfe",
      navOn: "#d5e0ea",
      spark: "#d5e0ea",
      sparkBright: "#ffffff",
      sparkEdge: "#b7c6d6",
      sparkGlow: "rgba(142, 160, 180, 0.4)",
      decor: "flora",
      petal: "#b9d4ea",
    }),
  ),
  theme(
    "rose-romance",
    "Rose Romance",
    "/card-themes/rose-romance.webp",
    {
      "--color-ivory": "#f8eeec",
      "--color-paper": "#fbf6f4",
      "--color-card": "#fffdfc",
      "--color-ink": "#3a2428",
      "--color-muted": "#8a6670",
      "--color-line": "#ead6d4",
      "--color-maroon": "#8c3d52",
      "--color-gold": "#b76e5a",
      "--color-on-photo": "#fbf6f4",
    },
    {
      "--wc-name": "#4a2430",
      "--wc-meta": "#5c3642",
      "--wc-metal": "#b76e5a",
      "--wc-tile": "#8c3d52",
      "--wc-tile-ink": "#fff8f6",
      "--wc-scrim": "#f8eeec",
    },
    chat({
      background: "radial-gradient(circle at 92% 12%, #e8c2c6 0%, transparent 34%), linear-gradient(180deg, #fbf6f4 0%, #f0d8d6 100%)",
      sent: "#fff8f6",
      sentInk: "#6e2c40",
      received: "#fffdfc",
      receivedInk: "#3a2428",
      border: "#e3b8ae",
      radius: "1.22rem",
      shadow: "0 10px 20px -16px rgba(140, 61, 82, 0.4)",
      name: "#8c3d52",
      header: "linear-gradient(180deg, #f8eee8e0, #f8eeec00)",
      heading: "#4a2430",
      composer: "rgba(255, 248, 246, 0.95)",
      input: "transparent",
      inputInk: "#3a2428",
      placeholder: "#8a6670",
      plus: "#8c3d52",
      plusInk: "#fff8f6",
      send: "#8c3d52",
      sendInk: "#fff8f6",
      nav: "#743444",
      navInk: "#fff8f6",
      navOn: "#e7c2b0",
      spark: "#e7c4b0",
      sparkBright: "#fff6f0",
      sparkEdge: "#d7a898",
      sparkGlow: "rgba(183, 110, 90, 0.38)",
      decor: "flora",
      petal: "#e3a8b0",
    }),
  ),
  theme(
    "peach-garden",
    "Peach Garden",
    "/card-themes/peach-garden.webp",
    {
      "--color-ivory": "#fff3ea",
      "--color-paper": "#fff8f3",
      "--color-card": "#fffdfb",
      "--color-ink": "#3a261c",
      "--color-muted": "#8a6756",
      "--color-line": "#f0d8c8",
      "--color-maroon": "#c2613a",
      "--color-gold": "#a56b3c",
      "--color-on-photo": "#fff8f3",
    },
    {
      "--wc-name": "#5a2e1c",
      "--wc-meta": "#6e4030",
      "--wc-metal": "#c4894a",
      "--wc-tile": "#c2613a",
      "--wc-tile-ink": "#fff8f3",
      "--wc-scrim": "#fff3ea",
    },
    chat({
      background: "radial-gradient(circle at 70% 16%, #ffd0ae 0%, transparent 28%), radial-gradient(circle at 50% 78%, #f8c9a4 0%, transparent 40%), linear-gradient(180deg, #ffe8d6 0%, #f6c7a8 100%)",
      sent: "#fff8f3",
      sentInk: "#8a3a24",
      received: "#fffdfb",
      receivedInk: "#5a2e1c",
      border: "#efc2a4",
      radius: "1.28rem",
      shadow: "0 12px 22px -16px rgba(194, 97, 58, 0.42), inset 0 1px rgba(255,255,255,0.75)",
      name: "#c2613a",
      header: "linear-gradient(180deg, #fff3ead8, #fff3ea00)",
      heading: "#5a2e1c",
      composer: "rgba(255, 248, 243, 0.95)",
      input: "transparent",
      inputInk: "#3a261c",
      placeholder: "#8a6756",
      plus: "#c2613a",
      plusInk: "#fff8f3",
      send: "#c2613a",
      sendInk: "#fff8f3",
      nav: "#a34e30",
      navInk: "#fff8f3",
      navOn: "#f0d0a8",
      spark: "#e7c08a",
      sparkBright: "#fff4e4",
      sparkEdge: "#d7a36a",
      sparkGlow: "rgba(196, 120, 70, 0.4)",
      decor: "flora",
      petal: "#f3b48a",
    }),
  ),
  ...PREMIUM_THEMES,
  sceneTheme(
    theme(
      "classic-sunset-romance",
      "Classic Sunset Romance",
      "/card-themes/classic-sunset-romance.webp",
      {
        "--color-ivory": "#FFF7F1",
        "--color-paper": "#FFF7F1",
        "--color-card": "#F8EAE5",
        "--color-ink": "#49353D",
        "--color-muted": "#806A75",
        "--color-line": "#D8C19A",
        "--color-maroon": "#C98279",
        "--color-gold": "#D6B77A",
        "--color-on-photo": "#FFF7F1",
      },
      {
        "--wc-name": "#49353D",
        "--wc-meta": "#5C4550",
        "--wc-metal": "#D6B77A",
        "--wc-tile": "#C98279",
        "--wc-tile-ink": "#FFF7F1",
        "--wc-scrim": "#FFF7F1",
      },
      chat({
        background: "color-mix(in srgb, #FFF7F1 16%, transparent)",
        sent: "#F3D2CB",
        sentInk: "#49353D",
        received: "#F8EAE5",
        receivedInk: "#49353D",
        border: "#D8C19A",
        radius: "1.2rem",
        shadow: "0 10px 22px -16px rgba(201, 130, 121, 0.45)",
        name: "#49353D",
        header: "color-mix(in srgb, #FFF7F1 88%, transparent)",
        heading: "#49353D",
        composer: "#FFF7F1",
        input: "transparent",
        inputInk: "#49353D",
        placeholder: "#806A75",
        plus: "#C98279",
        plusInk: "#FFF7F1",
        send: "#C98279",
        sendInk: "#FFF7F1",
        nav: "#49353D",
        navInk: "#FFF7F1",
        navOn: "#D6B77A",
        spark: "#D6B77A",
        sparkBright: "#FFF7F1",
        sparkEdge: "#C98279",
        sparkGlow: "rgba(201, 130, 121, 0.28)",
        decor: "none",
        petal: "#B99AAE",
      }),
    ),
    "64% 56%",
    "78% 62%",
  ),
  sceneTheme(
    theme(
      "classic-celestial-ivory",
      "Classic Celestial Ivory",
      "/card-themes/classic-celestial-ivory.webp",
      {
        "--color-ivory": "#FFFAF5",
        "--color-paper": "#FFFAF5",
        "--color-card": "#FFF3EB",
        "--color-ink": "#493F43",
        "--color-muted": "#827887",
        "--color-line": "#DFC5B8",
        "--color-maroon": "#C99483",
        "--color-gold": "#E4C88F",
        "--color-on-photo": "#FFFAF5",
      },
      {
        "--wc-name": "#493F43",
        "--wc-meta": "#5E5458",
        "--wc-metal": "#E4C88F",
        "--wc-tile": "#C99483",
        "--wc-tile-ink": "#FFFAF5",
        "--wc-scrim": "#FFFAF5",
      },
      chat({
        background: "color-mix(in srgb, #FFFAF5 18%, transparent)",
        sent: "#F6DDD4",
        sentInk: "#493F43",
        received: "#FFF3EB",
        receivedInk: "#493F43",
        border: "#DFC5B8",
        radius: "1.2rem",
        shadow: "0 10px 22px -16px rgba(201, 148, 131, 0.42)",
        name: "#493F43",
        header: "color-mix(in srgb, #FFFAF5 88%, transparent)",
        heading: "#493F43",
        composer: "#FFFAF5",
        input: "transparent",
        inputInk: "#493F43",
        placeholder: "#827887",
        plus: "#C99483",
        plusInk: "#FFFAF5",
        send: "#C99483",
        sendInk: "#FFFAF5",
        nav: "#493F43",
        navInk: "#FFFAF5",
        navOn: "#E4C88F",
        spark: "#E4C88F",
        sparkBright: "#FFFAF5",
        sparkEdge: "#C7B8D8",
        sparkGlow: "rgba(199, 184, 216, 0.34)",
        decor: "none",
        petal: "#C7B8D8",
      }),
    ),
    "center 42%",
    "center 38%",
  ),
  photoClassic(
    "classic-crimson-sunset",
    "Classic Crimson Sunset",
    "/card-themes/classic-crimson-sunset.webp",
    {
      ivory: "#FFF5F2",
      card: "#F9E5E5",
      ink: "#48242D",
      muted: "#89636B",
      line: "#DDB6A9",
      primary: "#B83E52",
      accent: "#E8BD78",
      sent: "#F8D4D6",
      spark: "#E66B70",
      wash: "color-mix(in srgb, #FFF5F2 14%, transparent)",
    },
    "58% 46%",
    "70% 50%",
  ),
  photoClassic(
    "classic-marigold-palace",
    "Classic Marigold Palace",
    "/card-themes/classic-marigold-palace.webp",
    {
      ivory: "#FFF8E9",
      card: "#F5E8D1",
      ink: "#44392A",
      muted: "#82765D",
      line: "#D7C092",
      primary: "#C77B20",
      accent: "#D8B36A",
      sent: "#F3E4C8",
      spark: "#66784B",
      wash: "color-mix(in srgb, #FFF8E9 15%, transparent)",
    },
    "68% 42%",
    "76% 40%",
  ),
  photoClassic(
    "classic-rose-bridal",
    "Classic Rose Bridal",
    "/card-themes/classic-rose-bridal.webp",
    {
      ivory: "#FFF8F4",
      card: "#F8E8E3",
      ink: "#482A32",
      muted: "#8B7078",
      line: "#DFC0B4",
      primary: "#B94D61",
      accent: "#D8B77D",
      sent: "#F6D9D6",
      spark: "#D8A0A5",
      wash: "color-mix(in srgb, #FFF8F4 17%, transparent)",
    },
    "center 40%",
    "center 36%",
  ),
  photoClassic(
    "classic-royal-lakeside",
    "Classic Royal Lakeside",
    "/card-themes/classic-royal-lakeside.webp",
    {
      ivory: "#FFFAF4",
      card: "#F5EDE3",
      ink: "#453C38",
      muted: "#857A73",
      line: "#D9C5A4",
      primary: "#B98268",
      accent: "#DCC18B",
      sent: "#F4E4D6",
      spark: "#8FA5AD",
      wash: "color-mix(in srgb, #FFFAF4 19%, transparent)",
    },
    "64% 58%",
    "72% 50%",
  ),
];

const byId = new Map(CARD_THEMES.map((theme) => [theme.id, theme]));

/** Catalogue entries that use classic ceremony pictures. Checked by id identity, not by name or color. */
const CEREMONY_COVER_THEME_IDS = [
  "classic-default",
  "classic-ivory",
  "classic-sunset-romance",
  "classic-celestial-ivory",
  "classic-crimson-sunset",
  "classic-marigold-palace",
  "classic-rose-bridal",
  "classic-royal-lakeside",
] as const satisfies readonly CardThemeId[];

for (const item of CARD_THEMES) {
  item.ceremonyCovers = (CEREMONY_COVER_THEME_IDS as readonly string[]).includes(item.id);
}

export const PREMIUM_THEME_COUNT = CARD_THEMES.filter((item) => item.id !== "classic-default").length;

export function isCardThemeId(value: string): value is CardThemeId {
  return byId.has(value as CardThemeId);
}

/** True only when this theme's own configuration allows default ceremony pictures. Unknown ids do not fall back to Classic. */
export function themeUsesCeremonyCovers(id?: string | null) {
  if (typeof id !== "string" || id.length === 0) return false;
  if (isCardThemeId(id)) return byId.get(id)?.ceremonyCovers === true;
  if (isCustomClassicId(id)) return true;
  return false;
}

export function isAssignableThemeId(value: string) {
  return isCardThemeId(value) || isCustomClassicId(value);
}

function objectPosition(value: string) {
  if (value === "top") return "center top";
  if (value === "bottom") return "center bottom";
  if (value === "left") return "left center";
  if (value === "right") return "right center";
  return "center";
}

function themeFromCustom(record: ClassicThemeRecord): CardTheme {
  const base = byId.get("classic-default") ?? CARD_THEMES[0];
  const colors = record.colors;
  return {
    ...base,
    id: record.id,
    name: record.name,
    art: record.images.barDesktop.src || base.art,
    mobileArt: record.images.barMobile.src || record.images.barDesktop.src || base.art,
    artFit: record.images.barDesktop.fit,
    artPosition: objectPosition(record.images.barDesktop.position),
    mobileArtFit: record.images.barMobile.fit,
    mobileArtPosition: objectPosition(record.images.barMobile.position),
    landingArt: {
      desktop: record.images.landingDesktop.src,
      mobile: record.images.landingMobile.src,
      fit: record.images.landingDesktop.fit,
      position: objectPosition(record.images.landingDesktop.position),
      mobileFit: record.images.landingMobile.fit,
      mobilePosition: objectPosition(record.images.landingMobile.position),
    },
    shell: {
      "--color-ivory": colors.page,
      "--color-paper": colors.panel,
      "--color-card": colors.card,
      "--color-ink": colors.text,
      "--color-muted": colors.textSecondary,
      "--color-line": colors.accent,
      "--color-maroon": colors.button,
      "--color-gold": colors.accent,
      "--color-on-photo": colors.buttonText,
    },
    card: {
      "--wc-name": colors.barText,
      "--wc-meta": colors.textSecondary,
      "--wc-metal": colors.accent,
      "--wc-tile": colors.button,
      "--wc-tile-ink": colors.buttonText,
      "--wc-scrim": "#1c1412",
    },
    chat: {
      ...base.chat,
      background: colors.panel,
      sent: colors.chatBubble,
      sentInk: colors.chatText,
      received: colors.card,
      receivedInk: colors.text,
      border: colors.accent,
      name: colors.heading,
      heading: colors.heading,
      header: colors.nav,
      nav: colors.nav,
      navInk: colors.text,
      navOn: colors.live,
      composer: colors.panel,
      inputInk: colors.text,
      placeholder: colors.textSecondary,
      plus: colors.buttonSecondary,
      plusInk: colors.buttonText,
      send: colors.button,
      sendInk: colors.buttonText,
      decor: "flora",
    },
    ceremonyCovers: true,
  };
}

/** Weddings with no saved theme use the original Wedding Circle look. */
export function cardThemeOf(id?: string | null): CardTheme {
  if (id && isCardThemeId(id)) return byId.get(id) ?? byId.get("classic-default") ?? CARD_THEMES[0];
  if (id && isCustomClassicId(id)) {
    const custom = readCustomThemes().find((theme) => theme.id === id);
    if (custom) return themeFromCustom(custom);
  }
  return byId.get("classic-default") ?? CARD_THEMES[0];
}

const DARK_THEMES = new Set<CardThemeId>(["royal-burgundy", "royal-blue", "midnight-emerald", "moonlight-reverie", "cosmic-destiny", "royal-palace", "velvet-rose"]);

const LIGHT_WELLS: Partial<Record<CardThemeId, string>> = {
  "pastel-blush": "#7c3144",
  "sage-green": "#2c4a36",
  "classic-ivory": "#4a3e34",
  "terracotta-sunset": "#7a3422",
  "lavender-dream": "#4e3168",
  "blossom-pink": "#a23b62",
  "sky-blue": "#2f567c",
  "rose-romance": "#8c3d52",
  "peach-garden": "#c2613a",
  "butterfly-romance": "#8e4566",
  "monsoon-romance": "#245e58",
  "anime-ever-after": "#5c4688",
  "heavens-embrace": "#3d5d86",
  "enchanted-garden": "#2a4a36",
  "aurora-dreams": "#2a6562",
};

function parseHex(input: string): [number, number, number] | null {
  const hex = input.trim().replace("#", "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((part) => part + part).join("") : hex;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channel(value: number) {
  const ratio = value / 255;
  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: string, background: string) {
  const fg = parseHex(foreground);
  const bg = parseHex(background);
  if (!fg || !bg) return 0;
  const lum = (rgb: [number, number, number]) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const left = lum(fg);
  const right = lum(bg);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

function mixHex(accent: string, toward: string, accentAmount: number) {
  const from = parseHex(accent);
  const to = parseHex(toward);
  if (!from || !to) return accent;
  const amount = Math.min(1, Math.max(0, accentAmount));
  const mixed = from.map((part, index) => Math.round(part * amount + to[index] * (1 - amount)));
  return `#${mixed.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
}

/** Keep as much of the accent as possible while staying readable on this background. */
function readableAccent(accent: string, toward: string, background: string) {
  if (contrast(accent, background) >= 4.5) return accent;
  if (!parseHex(accent) || !parseHex(toward)) return contrast(toward, background) >= contrast(accent, background) ? toward : accent;
  let best = toward;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    const amount = (low + high) / 2;
    const mixed = mixHex(accent, toward, amount);
    if (contrast(mixed, background) >= 4.5) {
      best = mixed;
      low = amount;
    } else high = amount;
  }
  return best;
}

function firstReadable(background: string, options: string[]) {
  for (const color of options) {
    if (contrast(color, background) >= 4.5) return color;
  }
  return options.reduce((best, color) => (contrast(color, background) > contrast(best, background) ? color : best), options[0]);
}

function darkenUntil(background: string, foreground: string) {
  if (contrast(foreground, background) >= 4.5 || !parseHex(background)) return background;
  let best = "#000000";
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    const amount = (low + high) / 2;
    const mixed = mixHex(background, "#000000", amount);
    if (contrast(foreground, mixed) >= 4.5) {
      best = mixed;
      low = amount;
    } else high = amount;
  }
  return best;
}

export function themeTone(theme: CardTheme): "dark" | "light" {
  if (isCustomClassicId(theme.id)) {
    const hex = theme.shell["--color-ivory"].replace("#", "");
    const value = Number.parseInt(hex, 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.42 ? "dark" : "light";
  }
  return DARK_THEMES.has(theme.id as CardThemeId) ? "dark" : "light";
}

/** Page, button, chat, and dialog colors for one wedding. Portals inherit these from the document. */
const surfaceCache = new Map<string, Record<string, string>>();

export function themeSurface(theme: CardTheme) {
  const signature = isCustomClassicId(theme.id)
    ? `${theme.id}:${theme.art}:${theme.mobileArt || ""}:${theme.shell["--color-ivory"]}:${theme.shell["--color-ink"]}:${theme.shell["--color-maroon"]}`
    : theme.id;
  const cached = surfaceCache.get(signature);
  if (cached) return cached;
  const dark = themeTone(theme) === "dark";
  const well = LIGHT_WELLS[theme.id as CardThemeId];
  const flora = theme.chat.decor === "flora"
    ? {
        "--wc-flora-tl": `url("/flora/${isCustomClassicId(theme.id) ? "classic-ivory" : theme.id}/tl.svg")`,
        "--wc-flora-tr": `url("/flora/${isCustomClassicId(theme.id) ? "classic-ivory" : theme.id}/tr.svg")`,
        "--wc-rings": `url("/flora/${isCustomClassicId(theme.id) ? "classic-ivory" : theme.id}/rings.svg")`,
        ...(well ? { "--wc-well": well } : {}),
      }
    : well
      ? { "--wc-well": well }
      : {};
  const skin = theme.chat;
  const ink = theme.shell["--color-ink"];
  const ivory = theme.shell["--color-ivory"];
  const paper = theme.shell["--color-paper"];
  const gold = theme.shell["--color-gold"];
  const maroon = theme.shell["--color-maroon"];
  const onPhoto = theme.shell["--color-on-photo"];
  const surface = {
    ...theme.shell,
    "--wc-sent": skin.sent,
    "--wc-sent-ink": skin.sentInk,
    "--wc-received": skin.received,
    "--wc-received-ink": skin.receivedInk,
    "--chat-bg": skin.background,
    "--chat-border": skin.border,
    "--chat-radius": skin.radius,
    "--chat-shadow": skin.shadow,
    "--chat-name": skin.name,
    "--chat-header": skin.header,
    "--chat-heading": skin.heading,
    "--chat-composer": skin.composer,
    "--chat-input": skin.input,
    "--chat-input-ink": skin.inputInk,
    "--chat-placeholder": skin.placeholder,
    "--chat-plus": skin.plus,
    "--chat-plus-ink": skin.plusInk,
    "--chat-send": skin.send,
    "--chat-send-ink": skin.sendInk,
    "--chat-nav": skin.nav,
    "--chat-nav-ink": skin.navInk,
    "--chat-nav-on": skin.navOn,
    "--chat-nav-on-ink": firstReadable(skin.navOn, [skin.sendInk, skin.nav, ink, onPhoto, maroon, ivory]),
    "--chat-nav-current": readableAccent(skin.navOn, skin.navInk, skin.nav),
    "--wc-label": readableAccent(gold, ink, ivory),
    "--wc-link": readableAccent(contrast(maroon, paper) >= contrast(gold, paper) ? maroon : gold, ink, paper),
    "--wc-muted": readableAccent(theme.shell["--color-muted"], ink, paper),
    "--wc-solid": darkenUntil(maroon, onPhoto),
    "--wc-solid-ink": onPhoto,
    "--chat-spark": skin.spark,
    "--chat-spark-bright": skin.sparkBright,
    "--chat-spark-edge": skin.sparkEdge,
    "--chat-spark-glow": skin.sparkGlow,
    "--chat-decor": skin.decor === "flora" ? "1" : "0",
    "--chat-petal": skin.petal,
    "--wc-face": dark ? "#FFF8F0" : theme.shell["--color-card"],
    "--wc-face-ink": dark ? (theme.id === "royal-burgundy" ? "#701C32" : theme.shell["--color-maroon"]) : theme.shell["--color-ink"],
    ...flora,
  };
  surfaceCache.set(signature, surface as Record<string, string>);
  return surface;
}

const warmedThemes = new Set<string>();

/** Fetch one theme's artwork so the first paint is not waiting on it. */
export function warmThemeAssets(theme: CardTheme) {
  if (typeof Image === "undefined") return;
  const key = `${theme.id}:${theme.art}:${theme.mobileArt || ""}`;
  if (warmedThemes.has(key)) return;
  warmedThemes.add(key);
  for (const src of [theme.art, theme.mobileArt, theme.landingArt?.desktop, theme.landingArt?.mobile]) {
    if (!src) continue;
    const image = new Image();
    image.decoding = "async";
    image.src = src;
  }
}
