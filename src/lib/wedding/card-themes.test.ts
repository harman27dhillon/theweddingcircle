import assert from "node:assert/strict";
import test from "node:test";
import { CARD_THEMES, cardThemeOf, isCardThemeId, themeSurface, themeTone } from "./card-themes.ts";

const IDS = [
  "royal-burgundy",
  "pastel-blush",
  "sage-green",
  "royal-blue",
  "classic-ivory",
  "midnight-emerald",
  "terracotta-sunset",
  "lavender-dream",
  "classic-default",
  "blossom-pink",
  "sky-blue",
  "rose-romance",
  "peach-garden",
  "butterfly-romance",
  "moonlight-reverie",
  "monsoon-romance",
  "anime-ever-after",
  "royal-palace",
  "heavens-embrace",
  "enchanted-garden",
  "cosmic-destiny",
  "velvet-rose",
  "aurora-dreams",
  "classic-sunset-romance",
  "classic-celestial-ivory",
  "classic-crimson-sunset",
  "classic-marigold-palace",
  "classic-rose-bridal",
  "classic-royal-lakeside",
];

test("twenty-nine themes keep their ids and each has a full chat design", () => {
  assert.deepEqual(CARD_THEMES.map((theme) => theme.id), IDS);
  const backgrounds = new Set<string>();
  for (const theme of CARD_THEMES) {
    assert.equal(isCardThemeId(theme.id), true);
    assert.ok(theme.chat.background && theme.chat.sent && theme.chat.received);
    assert.ok(theme.chat.sentInk && theme.chat.receivedInk && theme.chat.border);
    assert.ok(theme.chat.composer && theme.chat.send && theme.chat.nav);
    assert.ok(theme.chat.spark && theme.chat.sparkEdge);
    backgrounds.add(theme.chat.background);
    const surface = themeSurface(theme);
    assert.equal(themeSurface(theme), surface);
    assert.equal(surface["--chat-bg"], theme.chat.background);
    assert.equal(surface["--wc-sent"], theme.chat.sent);
    assert.equal(surface["--chat-decor"], theme.chat.decor === "flora" ? "1" : "0");
  }
  assert.equal(backgrounds.size, CARD_THEMES.length);
});

test("derived text stays readable on every theme without replacing the shell palette", () => {
  const contrast = (foreground: string, background: string) => {
    const rgb = (hex: string) => {
      const full = hex.slice(1);
      const n = Number.parseInt(full, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const lin = (value: number) => {
      const ratio = value / 255;
      return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
    };
    const lum = (hex: string) => rgb(hex).reduce((sum, part, index) => sum + [0.2126, 0.7152, 0.0722][index] * lin(part), 0);
    const left = lum(foreground);
    const right = lum(background);
    const [hi, lo] = left > right ? [left, right] : [right, left];
    return (hi + 0.05) / (lo + 0.05);
  };
  for (const theme of CARD_THEMES) {
    const surface = themeSurface(theme);
    assert.equal(surface["--color-ivory"], theme.shell["--color-ivory"], theme.id);
    assert.equal(surface["--color-ink"], theme.shell["--color-ink"], theme.id);
    assert.ok(contrast(surface["--wc-label"], theme.shell["--color-ivory"]) >= 4.5, theme.id + " label");
    assert.ok(contrast(surface["--wc-link"], theme.shell["--color-paper"]) >= 4.5, theme.id + " link");
    assert.ok(contrast(surface["--wc-muted"], theme.shell["--color-paper"]) >= 4.5, theme.id + " muted");
    assert.ok(contrast(surface["--chat-nav-on-ink"], theme.chat.navOn) >= 4.5, theme.id + " nav icon");
    assert.ok(contrast(surface["--chat-nav-current"], theme.chat.nav) >= 4.5, theme.id + " nav label");
    assert.ok(contrast(surface["--wc-solid-ink"], surface["--wc-solid"]) >= 4.5, theme.id + " button");
    assert.ok(contrast(theme.shell["--color-ink"], theme.shell["--color-ivory"]) >= 4.5, theme.id + " heading");
  }
});

test("classic default stays plain and distinct from classic ivory", () => {
  const classic = cardThemeOf(undefined);
  const ivory = cardThemeOf("classic-ivory");
  assert.equal(classic.id, "classic-default");
  assert.equal(classic.chat.decor, "none");
  assert.equal(ivory.chat.decor, "flora");
  assert.notEqual(classic.chat.sent, ivory.chat.sent);
  assert.notEqual(classic.shell["--color-maroon"], ivory.shell["--color-maroon"]);
  assert.equal(cardThemeOf("not-a-theme").id, "classic-default");
  assert.equal(cardThemeOf("butterfly-romance").name, "Butterfly Romance");
  assert.equal(cardThemeOf("butterfly-romance").effect, "butterflies");
  assert.equal(themeTone(cardThemeOf("moonlight-reverie")), "dark");
  assert.equal(themeTone(cardThemeOf("cosmic-destiny")), "dark");
  assert.equal(themeTone(cardThemeOf("royal-palace")), "dark");
  assert.equal(themeTone(cardThemeOf("velvet-rose")), "dark");
  assert.equal(themeTone(cardThemeOf("aurora-dreams")), "light");
  assert.equal(themeTone(cardThemeOf("butterfly-romance")), "light");
  assert.equal(cardThemeOf("butterfly-romance").art, "/card-themes/butterfly-romance.webp");
  assert.equal(cardThemeOf("royal-palace").art, "/card-themes/royal-palace.webp");
  assert.equal(cardThemeOf("velvet-rose").art, "/card-themes/velvet-rose.webp");
  assert.equal(cardThemeOf("royal-burgundy").art, "/card-themes/royal-burgundy.webp");
  assert.equal(cardThemeOf("classic-default").art, "/card-themes/classic-default-cover.webp");
  assert.equal(cardThemeOf("classic-default").pageSoft, undefined);
  const sunset = cardThemeOf("classic-sunset-romance");
  const celestial = cardThemeOf("classic-celestial-ivory");
  assert.equal(sunset.name, "Classic Sunset Romance");
  assert.equal(celestial.name, "Classic Celestial Ivory");
  assert.equal(sunset.art, "/card-themes/classic-sunset-romance.webp");
  assert.equal(celestial.art, "/card-themes/classic-celestial-ivory.webp");
  assert.notEqual(sunset.art, celestial.art);
  assert.equal(sunset.pageSoft, true);
  assert.equal(celestial.pageSoft, true);
  assert.equal(sunset.artFit, "cover");
  assert.equal(celestial.artFit, "cover");
  assert.equal(sunset.landingArt?.desktop, sunset.art);
  assert.equal(celestial.landingArt?.desktop, celestial.art);
  assert.equal(sunset.landingArt?.mobilePosition, "78% 62%");
  assert.equal(celestial.landingArt?.position, "center 42%");
  assert.equal(sunset.shell["--color-maroon"], "#C98279");
  assert.equal(celestial.shell["--color-maroon"], "#C99483");
  const crimson = cardThemeOf("classic-crimson-sunset");
  const marigold = cardThemeOf("classic-marigold-palace");
  const bridal = cardThemeOf("classic-rose-bridal");
  const lakeside = cardThemeOf("classic-royal-lakeside");
  assert.equal(crimson.name, "Classic Crimson Sunset");
  assert.equal(marigold.name, "Classic Marigold Palace");
  assert.equal(bridal.name, "Classic Rose Bridal");
  assert.equal(lakeside.name, "Classic Royal Lakeside");
  assert.equal(crimson.art, "/card-themes/classic-crimson-sunset.webp");
  assert.equal(marigold.art, "/card-themes/classic-marigold-palace.webp");
  assert.equal(bridal.art, "/card-themes/classic-rose-bridal.webp");
  assert.equal(lakeside.art, "/card-themes/classic-royal-lakeside.webp");
  assert.equal(new Set([sunset.art, celestial.art, crimson.art, marigold.art, bridal.art, lakeside.art]).size, 6);
  for (const theme of [crimson, marigold, bridal, lakeside]) {
    assert.equal(theme.pageSoft, true, theme.id);
    assert.equal(theme.landingArt?.desktop, theme.art, theme.id);
    assert.equal(theme.chat.decor, "none", theme.id);
  }
  assert.equal(crimson.shell["--color-maroon"], "#B83E52");
  assert.equal(crimson.shell["--color-gold"], "#E8BD78");
  assert.equal(crimson.shell["--color-ivory"], "#FFF5F2");
  assert.equal(crimson.landingArt?.position, "58% 46%");
  assert.equal(marigold.shell["--color-maroon"], "#C77B20");
  assert.equal(marigold.shell["--color-ink"], "#44392A");
  assert.equal(marigold.shell["--color-card"], "#F5E8D1");
  assert.equal(bridal.shell["--color-maroon"], "#B94D61");
  assert.equal(bridal.shell["--color-ivory"], "#FFF8F4");
  assert.equal(bridal.mobileArtPosition, "center 36%");
  assert.equal(lakeside.shell["--color-maroon"], "#B98268");
  assert.equal(lakeside.shell["--color-gold"], "#DCC18B");
  assert.equal(lakeside.shell["--color-card"], "#F5EDE3");
  assert.equal(cardThemeOf("royal-burgundy").effect, undefined);
  assert.equal(cardThemeOf("royal-burgundy").id, "royal-burgundy");
});
