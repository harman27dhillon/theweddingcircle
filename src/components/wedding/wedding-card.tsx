import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, MapPin, MessageCircle, Radio, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { CARD_THEMES, cardThemeOf, warmThemeAssets, type CardTheme } from "@/lib/wedding/card-themes";
import { useClassicRegistry } from "@/lib/wedding/classic-registry";
import { canManage, coupleTitle, firstName, longDate } from "@/lib/wedding/format";
import { ensureFonts, fontCssVars } from "@/lib/wedding/fonts";
import { planLimited } from "@/lib/wedding/plan";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Wedding } from "@/lib/wedding/types";
import { Button } from "@/components/wedding/ui";
import { PremiumUpgrade } from "@/components/wedding/plan-upgrade";
import { frameForTheme } from "@/lib/wedding/bar-layout";
import { cn } from "@/lib/utils";

function FloralSprig({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M5 28c5-7 8-12 14-18" fill="none" stroke="currentColor" strokeWidth="0.9" />
      <ellipse cx="16" cy="14" rx="3.4" ry="1.55" transform="rotate(-48 16 14)" fill="currentColor" />
      <ellipse cx="11.5" cy="20" rx="2.8" ry="1.3" transform="rotate(-18 11.5 20)" fill="currentColor" opacity="0.85" />
      <ellipse cx="20" cy="10" rx="2.5" ry="1.15" transform="rotate(-68 20 10)" fill="currentColor" opacity="0.9" />
      <circle cx="22.2" cy="7.2" r="1.35" fill="currentColor" />
    </svg>
  );
}

function Rings() {
  return (
    <svg viewBox="0 0 132 22" className="wc-rings" aria-hidden>
      <path d="M2 11 H50" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <circle cx="62" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="74" cy="11" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.35" />
      <path d="M86 11 H130" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

function CardDivider({ effect }: { effect?: CardTheme["effect"] }) {
  if (!effect) return <Rings />;
  return (
    <svg viewBox="0 0 132 22" className="wc-rings" aria-hidden>
      <path d="M2 11 H42" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <path d="M90 11 H130" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      <g transform="translate(66 11)">
        {effect === "butterflies" ? (
          <>
            <ellipse cx="-7" cy="-1" rx="7" ry="3.4" transform="rotate(-32 -7 -1)" fill="currentColor" opacity="0.9" />
            <ellipse cx="7" cy="-1" rx="7" ry="3.4" transform="rotate(32 7 -1)" fill="currentColor" opacity="0.9" />
            <ellipse cx="-4.5" cy="2.4" rx="4.2" ry="2.2" transform="rotate(18 -4.5 2.4)" fill="currentColor" opacity="0.55" />
            <ellipse cx="4.5" cy="2.4" rx="4.2" ry="2.2" transform="rotate(-18 4.5 2.4)" fill="currentColor" opacity="0.55" />
            <path d="M0 -5.5 V6" stroke="currentColor" strokeWidth="0.9" />
          </>
        ) : null}
        {effect === "moonlight" ? (
          <>
            <path d="M-2 -6a6 6 0 1 0 0 12 4.6 4.6 0 1 1 0-12z" fill="currentColor" />
            <circle cx="8" cy="-4" r="0.9" fill="currentColor" />
            <circle cx="6" cy="5" r="0.6" fill="currentColor" />
          </>
        ) : null}
        {effect === "rain" ? (
          <>
            <path d="M-8 -5c2 4 2 6 0 10" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <path d="M0 -6c2 4 2 7 0 12" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
            <path d="M8 -4c2 4 2 6 0 10" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </>
        ) : null}
        {effect === "anime-petals" ? (
          <>
            <path d="M0 -7 L1.6 -1.6 L7 0 L1.6 1.6 L0 7 L-1.6 1.6 L-7 0 L-1.6 -1.6 Z" fill="currentColor" />
            <circle r="1.3" fill="currentColor" opacity="0.35" />
          </>
        ) : null}
        {effect === "palace-shimmer" ? (
          <>
            <path d="M-10 5 H10" stroke="currentColor" strokeWidth="0.8" />
            <path d="M-8 5 V1 Q-8 -6 0 -6 Q8 -6 8 1 V5" fill="none" stroke="currentColor" strokeWidth="1" />
            <circle cy="-6" r="1.1" fill="currentColor" />
          </>
        ) : null}
        {effect === "heavenly-clouds" ? (
          <>
            <circle cx="-4" cy="1" r="3.1" fill="currentColor" opacity="0.85" />
            <circle cx="1" cy="-1" r="3.6" fill="currentColor" />
            <circle cx="6" cy="1.2" r="2.6" fill="currentColor" opacity="0.8" />
          </>
        ) : null}
        {effect === "fireflies" ? (
          <>
            <path d="M-8 4 C-2 -6 4 -6 8 4" fill="none" stroke="currentColor" strokeWidth="1" />
            <ellipse cx="0" cy="-1" rx="3.2" ry="5.2" transform="rotate(-28)" fill="currentColor" opacity="0.85" />
            <circle cx="9" cy="-4" r="1" fill="currentColor" />
          </>
        ) : null}
        {effect === "cosmic-stars" ? (
          <>
            <ellipse rx="11" ry="4.2" fill="none" stroke="currentColor" strokeWidth="0.9" transform="rotate(-18)" />
            <circle cx="8" cy="-2" r="1.3" fill="currentColor" />
            <circle cx="-7" cy="2" r="0.8" fill="currentColor" />
          </>
        ) : null}
        {effect === "rose-petals" ? (
          <>
            <circle r="2.1" fill="none" stroke="currentColor" strokeWidth="0.9" />
            <ellipse cy="-3.2" rx="2.2" ry="3.3" fill="currentColor" opacity="0.8" />
            <ellipse cx="3" cy="-1" rx="2.2" ry="3.3" transform="rotate(72 3 -1)" fill="currentColor" opacity="0.75" />
            <ellipse cx="-3" cy="-1" rx="2.2" ry="3.3" transform="rotate(-72 -3 -1)" fill="currentColor" opacity="0.75" />
          </>
        ) : null}
        {effect === "aurora" ? (
          <path d="M-12 2 C-6 -6 0 6 6 -4 C9 -8 12 -2 14 3" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        ) : null}
      </g>
    </svg>
  );
}

function ShortcutTile({ label, icon: Icon, onClick }: { label: string; icon: LucideIcon; onClick?: () => void }) {
  const inner = (
    <>
      <FloralSprig className="wc-sprig wc-sprig-bl" />
      <FloralSprig className="wc-sprig wc-sprig-br" />
      <Icon className="wc-tile-icon" strokeWidth={1.65} aria-hidden />
      <span className="wc-tile-label">{label}</span>
    </>
  );
  if (!onClick) return <div className="wc-tile">{inner}</div>;
  return (
    <button type="button" className="wc-tile" onClick={onClick}>
      {inner}
    </button>
  );
}

function ThemeCardPreview({ wedding, theme, priority }: { wedding: Wedding; theme: CardTheme; priority: boolean }) {
  return (
    <span className="theme-choice-scale">
      <WeddingCard wedding={wedding} themeId={theme.id} preview priority={priority} />
    </span>
  );
}

const StableThemePreview = memo(ThemeCardPreview, (prev, next) => (
  prev.theme === next.theme
  && prev.priority === next.priority
  && prev.wedding.bride === next.wedding.bride
  && prev.wedding.groom === next.wedding.groom
  && prev.wedding.date === next.wedding.date
  && prev.wedding.city === next.wedding.city
  && prev.wedding.place === next.wedding.place
  && prev.wedding.fonts?.names === next.wedding.fonts?.names
  && prev.wedding.fonts?.ceremonyHead === next.wedding.fonts?.ceremonyHead
  && prev.wedding.fonts?.ceremonyBody === next.wedding.fonts?.ceremonyBody
));

function placed(point?: { x: number; y: number }): CSSProperties | undefined {
  if (!point) return undefined;
  return {
    position: "absolute",
    left: `${point.x}%`,
    top: `${point.y}%`,
    transform: "translate(-50%, -50%)",
    margin: 0,
    maxWidth: "78%",
    zIndex: 3,
  };
}

function coverArtStyle(
  frame: { x: number; y: number; zoom: number } | undefined,
  fit?: string,
  position?: string,
): CSSProperties | undefined {
  if (frame) {
    return {
      objectFit: "cover",
      objectPosition: `${frame.x}% ${frame.y}%`,
      transform: frame.zoom > 1 ? `scale(${frame.zoom})` : undefined,
      transformOrigin: `${frame.x}% ${frame.y}%`,
    };
  }
  if (!fit) return undefined;
  return { objectFit: fit as CSSProperties["objectFit"], objectPosition: position || "center" };
}

export function WeddingCard({
  wedding,
  themeId,
  preview = false,
  opening = false,
  full = false,
  ratio,
  desktopRatio,
  priority = false,
  onOpen,
  onChat,
  onLive,
}: {
  wedding: Pick<Wedding, "bride" | "groom" | "date" | "city" | "place" | "cardTheme" | "fonts" | "bar">;
  themeId?: string;
  preview?: boolean;
  opening?: boolean;
  full?: boolean;
  ratio?: { w: number; h: number } | null;
  desktopRatio?: { w: number; h: number } | null;
  priority?: boolean;
  onOpen?: () => void;
  onChat?: () => void;
  onLive?: () => void;
}) {
  const theme = cardThemeOf(themeId ?? wedding.cardTheme);
  const title = coupleTitle(wedding);
  const place = wedding.city.trim() || wedding.place.trim();
  const style = { ...theme.card, ...fontCssVars(wedding.fonts) } as CSSProperties;
  const wide = Boolean(ratio && !full && ratio.w / ratio.h >= 1.2);
  const bar = wedding.bar;
  const coverFrame = frameForTheme(bar, theme.id, wedding.cardTheme);
  const hostCover = bar?.cover || "";
  const deskArt = hostCover || theme.art;
  const phoneArt = hostCover || theme.mobileArt || theme.art;
  const splitArt = phoneArt !== deskArt;
  useEffect(() => {
    ensureFonts(Object.values(wedding.fonts ?? {}));
  }, [wedding.fonts]);
  return (
    <article
      className={cn("wc-card", theme.pageSoft && "is-scene", preview && "is-preview", opening && "is-opening", opening && full && "is-full", wide && "is-landscape")}
      style={style}
      data-card-theme={theme.id}
      data-card-ratio={ratio ? `${ratio.w}/${ratio.h}` : "original"}
      data-card-ratio-desktop={desktopRatio ? `${desktopRatio.w}/${desktopRatio.h}` : "original"}
    >
      <img
        src={deskArt}
        alt=""
        className={splitArt ? "wc-card-art wc-card-art-desk has-phone" : "wc-card-art"}
        style={coverArtStyle(coverFrame, theme.artFit, theme.artPosition)}
        decoding="async"
        loading={preview && !priority ? "lazy" : "eager"}
        fetchPriority={priority || !preview ? "high" : "low"}
        onError={(event) => {
          if (event.currentTarget.dataset.fallback === "1") return;
          event.currentTarget.dataset.fallback = "1";
          event.currentTarget.src = "/card-themes/classic-default-cover.jpg";
        }}
      />
      {splitArt ? (
        <img
          src={phoneArt}
          alt=""
          className="wc-card-art wc-card-art-phone"
          style={coverArtStyle(coverFrame, theme.mobileArtFit, theme.mobileArtPosition)}
          decoding="async"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      <div className="wc-card-scrim" />
      <div
        className="wc-sizer"
        style={
          !full && (ratio || desktopRatio)
            ? ({
                ...(ratio ? { "--card-ratio": `${ratio.w} / ${ratio.h}` } : {}),
                ...(desktopRatio ? { "--card-ratio-desktop": `${desktopRatio.w} / ${desktopRatio.h}` } : {}),
              } as CSSProperties)
            : undefined
        }
        aria-hidden
      />
      {onOpen ? (
        <button type="button" className="wc-card-open" aria-label={`Open ${title}`} onClick={onOpen} />
      ) : null}
      <div className="wc-body">
        <div className="wc-names" style={placed(bar?.names)}>
          <p className="wc-name">{firstName(wedding.groom)}</p>
          <p className="wc-amp" aria-hidden="true">
            &
          </p>
          <p className="wc-name">{firstName(wedding.bride)}</p>
        </div>
        <div className="wc-foot">
          <div className="wc-foot-row">
            <CardDivider effect={theme.effect} />
            <div className="wc-tiles">
              <ShortcutTile label="Chat" icon={MessageCircle} onClick={onChat} />
              <ShortcutTile label="Live" icon={Radio} onClick={onLive} />
            </div>
          </div>
          <p className="wc-meta">
            <span className="wc-meta-bit" style={placed(bar?.date)}>
              <CalendarDays className="wc-meta-icon" aria-hidden />
              <span>{longDate(wedding.date)}</span>
            </span>
            {place ? (
              <>
                {!bar?.date && !bar?.place ? <span aria-hidden="true">|</span> : null}
                <span className="wc-meta-bit" style={placed(bar?.place)}>
                  <MapPin className="wc-meta-icon" aria-hidden />
                  <span>{place}</span>
                </span>
              </>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}

export function ThemePicker({ wedding }: { wedding: Wedding }) {
  const setCardTheme = useWeddingStore((s) => s.setCardTheme);
  const viewer = useWeddingStore((s) => s.viewer);
  const applied = useWeddingStore((s) => {
    const live = s.weddings.find((item) => item.id === wedding.id);
    return cardThemeOf(live?.cardTheme ?? wedding.cardTheme).id;
  });
  const [pending, setPending] = useState(applied);
  const [phase, setPhase] = useState<"idle" | "saving" | "error">("idle");
  const pendingRef = useRef(applied);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    pendingRef.current = applied;
    setPending(applied);
  }, [applied]);
  useEffect(() => {
    const onSettle = (event: Event) => {
      const detail = (event as CustomEvent<{ weddingId?: string; themeId?: string; ok?: boolean }>).detail;
      if (!detail || detail.weddingId !== wedding.id || detail.themeId !== pendingRef.current) return;
      setPhase(detail.ok ? "idle" : "error");
    };
    window.addEventListener("wc-theme-settle", onSettle);
    return () => window.removeEventListener("wc-theme-settle", onSettle);
  }, [wedding.id]);
  const customThemes = useClassicRegistry((s) => s.themes);
  useEffect(() => {
    const theme = CARD_THEMES.find((item) => item.id === pending) ?? customThemes.find((item) => item.id === pending);
    if (theme && "art" in theme) warmThemeAssets(theme as CardTheme);
    else if (theme) warmThemeAssets(cardThemeOf(theme.id));
  }, [pending, customThemes]);
  const accountId = useWeddingStore((s) => s.account?.id);
  const liveWedding = useWeddingStore((s) => s.weddings.find((item) => item.id === wedding.id) ?? wedding);
  if (!canManage(wedding, viewer) && !(accountId && wedding.ownerId && wedding.ownerId === accountId)) return null;
  const limited = planLimited(liveWedding) && planLimited(wedding);
  const dirty = pending !== applied || phase === "error";
  function choose(themeId: typeof applied) {
    if (themeId === pendingRef.current && phase !== "error") return;
    pendingRef.current = themeId;
    dirtyRef.current = themeId !== applied;
    setPhase("idle");
    setPending(themeId);
  }
  function applyTheme() {
    if (phase === "saving") return;
    const themeId = pendingRef.current;
    setPhase("saving");
    dirtyRef.current = false;
    const result = setCardTheme(wedding.id, themeId);
    if (result === "ok") return;
    dirtyRef.current = true;
    setPhase("error");
    if (result === "denied") toast("Only a host or co-host can change this wedding's theme.");
    else if (result === "plan") toast("Free weddings use Classic Default. Premium is a one-time ₹499 for the other themes.");
    else toast("That theme could not be applied. The previous theme is still in use.");
  }
  const presetThemes = CARD_THEMES.filter((theme) => !theme.name.toLowerCase().includes("classic"));
  const classicThemes = [
    ...CARD_THEMES.filter((theme) => theme.name.toLowerCase().includes("classic")),
    ...customThemes.map((theme) => cardThemeOf(theme.id)),
  ];
  function themeList(items: CardTheme[]) {
    return (
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {items.map((theme) => {
          const picked = theme.id === pending;
          const saved = theme.id === applied;
          const showApply = picked && (theme.id !== applied || phase === "saving" || phase === "error");
          return (
            <li key={theme.id}>
              <div className={cn("theme-choice", picked && "is-picked")}>
                <div className="theme-choice-frame">
                  <button
                    type="button"
                    className="theme-choice-hit"
                    aria-pressed={picked}
                    aria-label={theme.name}
                    onClick={() => choose(theme.id)}
                  />
                  <StableThemePreview wedding={wedding} theme={theme} priority={picked || saved} />
                  {showApply ? (
                    <button
                      type="button"
                      className="theme-apply"
                      disabled={phase === "saving"}
                      onClick={(event) => {
                        event.stopPropagation();
                        applyTheme();
                      }}
                    >
                      {phase === "saving" ? "Applying" : phase === "error" ? "Try again" : "Apply"}
                    </button>
                  ) : null}
                </div>
                <span className="theme-choice-name">
                  {theme.name}
                  {saved ? " · Applied" : ""}
                  {!saved && picked ? " · Selected" : ""}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">Wedding theme</p>
      <p className="mt-0.5 text-xs text-muted">
        {limited
          ? "A host or co-host can apply any theme. Free storage stays 500 MB, and pinning this wedding still needs a verified Premium purchase or a wedding voucher."
          : "Tap a look, then press Apply on that card. Nothing changes until you confirm. Guests see the saved theme. Only a host or co-host can change it."}
      </p>
      <section className="mt-4" aria-label="Preset Themes">
        <h3 className="font-serif text-lg">Preset Themes</h3>
        {themeList(presetThemes)}
      </section>
      <section className="mt-5" aria-label="Classic Themes">
        <h3 className="font-serif text-lg">Classic Themes</h3>
        {themeList(classicThemes)}
      </section>
      {dirty && phase !== "saving" ? (
        <div className="mt-4">
          <Button type="button" variant="line" onClick={() => { dirtyRef.current = false; pendingRef.current = applied; setPhase("idle"); setPending(applied); }}>
            Cancel
          </Button>
        </div>
      ) : null}
      {limited ? <PremiumUpgrade wedding={liveWedding} /> : null}
    </div>
  );
}
