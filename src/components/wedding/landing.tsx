import { lazy, Suspense, Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { SEED_ID } from "@/lib/wedding/seed";
import { useWeddingStore } from "@/lib/wedding/store";
import { codeMatch, compactCode, compressImage, isCircleOwner, isSampleCircle, normalizeCode, visibleCircles, activityScore } from "@/lib/wedding/format";
import { PHOTO_ACCEPT } from "@/lib/wedding/media";
import { accountSenderId } from "@/lib/wedding/identity";
import { compactCoupleCode } from "@/lib/wedding/couple-access";
import { canEnterWedding, canPinLanding, pinnedWeddingId } from "@/lib/wedding/landing-pin";
import { usePersistedReady } from "@/lib/wedding/use-circle";
import { useClassicRegistry, loadAppearance } from "@/lib/wedding/classic-registry";
import { useCardDisplay } from "@/lib/wedding/library";
import { cardThemeOf, themeSurface, themeTone } from "@/lib/wedding/card-themes";
import { useDismissible } from "@/lib/wedding/dismiss";
import { readKept } from "@/lib/wedding/publish";
import { ChevronRight, Compass, Crown, EllipsisVertical, Pin, UserRound } from "lucide-react";
import { usePageEntrance } from "@/components/wedding/living";
import { Mark, Button, fieldClass, PickList } from "@/components/wedding/ui";
import { WeddingCard } from "@/components/wedding/wedding-card";
import type { Account, Membership, Wedding } from "@/lib/wedding/types";

const CoverVisual = lazy(() => import("@/components/wedding/themes").then((mod) => ({ default: mod.CoverVisual })));

/** Paints saved wedding bars from this phone before the app bundle finishes. Does not grant access. */
const LANDING_EARLY_BARS = `(function(){
  var host = document.getElementById("wc-early-bars");
  if (!host || host.childElementCount || document.querySelector(".wc-card")) return;
  var raw = "";
  try { raw = localStorage.getItem("wedding-circle-v3") || ""; } catch (e) { return; }
  if (!raw) return;
  var saved;
  try { saved = JSON.parse(raw); } catch (e) { return; }
  var state = saved && saved.state && typeof saved.state === "object" ? saved.state : saved;
  if (!state || typeof state !== "object") return;
  var weddings = Array.isArray(state.weddings) ? state.weddings : [];
  var account = state.account && typeof state.account === "object" ? state.account : null;
  var email = account && account.email ? String(account.email).trim().toLowerCase() : "";
  var person = account && account.name ? String(account.name).trim().toLowerCase() : "";
  var memberships = Array.isArray(state.memberships) ? state.memberships : [];
  var keys = {};
  try { keys = JSON.parse(localStorage.getItem("wc-circle-keys") || "{}") || {}; } catch (e) { keys = {}; }
  function sample(w) { return !w || w.id === "lila-nico" || w.slug === "lila-nico" || w.illustrated; }
  function kept(w) {
    if (!w || sample(w) || typeof w.slug !== "string") return false;
    var owner = String(w.ownerEmail || "").trim().toLowerCase();
    var member = memberships.some(function(item) {
      if (!item || item.slug !== w.slug) return false;
      var memberEmail = String(item.email || "").trim().toLowerCase();
      return !email || !memberEmail || memberEmail === email;
    });
    if (member) return true;
    if (keys[w.slug] && (!email || !owner || owner === email)) return true;
    if (email && owner === email) return true;
    if (!person || !Array.isArray(w.guests)) return false;
    return w.guests.some(function(guest) {
      return guest && guest.joined && !guest.blocked && String(guest.name || "").trim().toLowerCase() === person;
    });
  }
  function score(w) {
    var total = 0;
    var posts = Array.isArray(w.posts) ? w.posts : [];
    for (var i = 0; i < posts.length; i++) {
      var post = posts[i];
      if (!post || post.removed) continue;
      if (post.text) total += 2;
      total += (post.images && post.images.length || 0) * 4;
      total += (post.videos && post.videos.length || 0) * 6;
    }
    return total;
  }
  var real = weddings.filter(kept).sort(function(a, b) {
    return score(b) - score(a) || String(a.bride || "").localeCompare(String(b.bride || ""));
  }).slice(0, 6);
  var list = real.length ? real : weddings.filter(sample).slice(0, 1);
  if (!list.length) return;
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function(ch) {
      var code = ch.charCodeAt(0);
      if (code === 38) return "&" + "amp;";
      if (code === 60) return "&" + "lt;";
      if (code === 62) return "&" + "gt;";
      if (code === 34) return "&" + "quot;";
      return "&" + "#39;";
    });
  }
  function first(value) {
    var text = String(value || "").trim();
    return text ? text.split(/\\s+/)[0] : "";
  }
  function art(w) {
    var src = w.bar && typeof w.bar.cover === "string" ? w.bar.cover : (typeof w.cover === "string" ? w.cover : "");
    if (src.charAt(0) === "/" && src.indexOf("..") < 0 && src.length < 240) return src;
    if (src.indexOf("https://") === 0 && src.indexOf(" ") < 0 && src.length < 300) return src;
    return "/card-themes/classic-default-cover.webp";
  }
  var html = "";
  for (var n = 0; n < list.length; n++) {
    var wedding = list[n];
    if (n === 1) html += '<div class="landing-featured-head"><h2>Featured Weddings</h2></div>';
    var href = /^[a-z0-9-]{3,80}$/.test(String(wedding.slug || "")) ? "/w/" + wedding.slug : "";
    html += '<div class="' + (n === 0 ? "landing-hero" : "landing-extra") + ' grid justify-items-center gap-2">';
    html += href ? '<a href="' + href + '" style="display:block;width:100%;color:inherit;text-decoration:none">' : "";
    html += '<article class="wc-card" data-card-theme="classic-default" data-early-bar="1" style="--wc-name:#1c1412;--wc-meta:#1c1412;--wc-metal:#a68456;--wc-scrim:#fffaf4">';
    html += '<img class="wc-card-art" alt="" src="' + esc(art(wedding)) + '" decoding="async" fetchpriority="' + (n === 0 ? "high" : "low") + '">';
    html += '<div class="wc-card-scrim"></div><div class="wc-sizer" style="aspect-ratio:1 / 1.08"></div><div class="wc-body"><div class="wc-names">';
    html += '<p class="wc-name">' + esc(first(wedding.groom)) + '</p><p class="wc-amp" aria-hidden="true">&</p><p class="wc-name">' + esc(first(wedding.bride)) + '</p>';
    html += '</div><p class="wc-meta"><span>' + esc(wedding.date || "") + '</span>';
    if (wedding.city || wedding.place) html += '<span> ' + esc(wedding.city || wedding.place) + '</span>';
    html += '</p></div></article>';
    html += href ? "</a>" : "";
    html += "</div>";
  }
  host.innerHTML = html;
  if (window.performance && performance.mark) performance.mark("wc-early-bars");
})();`;

function CardCover({ src, alt, className, priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  if (!src) return <div className={className ? `cover-fallback ${className}` : "cover-fallback"} aria-hidden />;
  return (
    <Suspense fallback={<div className={className ? `cover-fallback ${className}` : "cover-fallback"} aria-hidden />}>
      <CoverVisual src={src} alt={alt} className={className} priority={priority} />
    </Suspense>
  );
}

function isVerifiedHost(wedding: Wedding, account: Account | null, memberships: Membership[]) {
  if (!account) return false;
  const email = account.email.trim().toLowerCase();
  if (email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === email) return true;
  return memberships.some((item) => item.slug === wedding.slug && item.role === "host");
}

function PinnedOpening({
  wedding,
  ratio,
  full,
  onEnter,
  onChat,
  onLive,
  onUnpin,
  onBrowse,
}: {
  wedding: Wedding;
  ratio: { w: number; h: number } | null;
  full: boolean;
  onEnter: () => void;
  onChat: () => void;
  onLive: () => void;
  onUnpin: () => void;
  onBrowse: () => void;
}) {
  const theme = cardThemeOf(wedding.cardTheme);
  const [sheet, setSheet] = useState<null | "menu" | "confirm">(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const surface = themeSurface(theme);
    root.dataset.cardTheme = theme.id;
    root.dataset.tone = themeTone(theme);
    for (const [key, value] of Object.entries(surface)) root.style.setProperty(key, value);
    return () => {
      if (root.dataset.cardTheme === theme.id) {
        delete root.dataset.cardTheme;
        delete root.dataset.tone;
      }
      for (const key of Object.keys(surface)) root.style.removeProperty(key);
    };
  }, [theme]);
  const sheetOpen = sheet !== null;
  useDismissible(sheet === "menu", () => setSheet((current) => (current === "menu" ? null : current)), sheetRef);
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheet(null);
    };
    const onPop = () => setSheet(null);
    document.addEventListener("keydown", onKey);
    window.addEventListener("popstate", onPop);
    history.pushState({ wcUnpin: true }, "");
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", onPop);
      if (history.state?.wcUnpin) history.back();
    };
  }, [sheetOpen]);
  return (
    <div
      className={full ? "pinned-open is-full relative" : "pinned-open relative"}
      data-app-ready=""
      data-pinned-landing={wedding.slug}
      data-pinned-full={full ? "on" : "off"}
      data-pinned-ratio={ratio ? `${ratio.w}/${ratio.h}` : "original"}
      data-card-theme={theme.id}
      style={themeSurface(theme) as CSSProperties}
    >
      <div className="pinned-pin" ref={sheetRef}>
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-full border border-line bg-card/90 text-ink"
          aria-label="Unpin wedding"
          aria-haspopup="menu"
          aria-expanded={sheet !== null}
          onClick={() => setSheet((open) => (open ? null : "menu"))}
        >
          <Pin className="size-4" aria-hidden="true" />
        </button>
        {sheet === "menu" ? (
          <div role="menu" className="mt-2 w-44 overflow-hidden rounded-2xl border border-line bg-ivory text-ink shadow-[0_16px_40px_-24px_rgba(28,20,18,0.45)]">
            <button
              type="button"
              role="menuitem"
              className="block min-h-11 w-full px-3 text-left text-sm"
              onClick={() => setSheet("confirm")}
            >
              Unpin wedding
            </button>
          </div>
        ) : null}
      </div>
      <div className="pinned-stage flex min-h-dvh flex-col items-center justify-center gap-4 px-3 pb-6 pt-16">
        <WeddingCard wedding={wedding} opening full={full} ratio={ratio} onOpen={onEnter} onChat={onChat} onLive={onLive} />
        <div className="pinned-shortcuts flex w-full max-w-md flex-wrap items-center justify-center gap-2">
          <button type="button" className="inline-flex min-h-11 items-center px-3 text-sm text-maroon" onClick={onBrowse}>
            All weddings
          </button>
        </div>
      </div>
      {sheet === "confirm" ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/45 p-4 sm:items-center" role="dialog" aria-labelledby="unpin-title">
          <div className="w-full max-w-md rounded-3xl border border-line bg-ivory p-5 text-ink">
            <h2 id="unpin-title" className="font-serif text-2xl">Unpin wedding</h2>
            <p className="mt-2 text-sm text-muted">This only removes the opening screen. The wedding, invitations, and your access stay as they are.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  if (history.state?.wcUnpin) history.replaceState(null, "");
                  setSheet(null);
                  onUnpin();
                }}
              >
                Unpin wedding
              </Button>
              <Button type="button" variant="line" onClick={() => setSheet("menu")}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LandingMark({ className }: { className: string }) {
  return (
    <Link to="/" className={className}>
      <Mark className="size-9 shrink-0" />
      <span className="min-w-0 truncate font-serif text-base leading-normal md:text-lg">The Wedding Circle</span>
    </Link>
  );
}

export function Landing() {
  const navigate = useNavigate();
  const weddings = useWeddingStore((s) => s.weddings);
  const focusWedding = useWeddingStore((s) => s.focusWedding);
  const sample = weddings.find((w) => w.id === SEED_ID) ?? weddings.find((w) => isSampleCircle(w));
  const account = useWeddingStore((s) => s.account);
  const memberships = useWeddingStore((s) => s.memberships);
  const landingPins = useWeddingStore((s) => s.landingPins);
  const pinLanding = useWeddingStore((s) => s.pinLanding);
  const unpinLanding = useWeddingStore((s) => s.unpinLanding);
  const viewerWeddingId = useWeddingStore((s) => s.viewer.weddingId);
  const signOutAccount = useWeddingStore((s) => s.signOutAccount);
  const reviseSample = useWeddingStore((s) => s.reviseSample);
  const addFeedback = useWeddingStore((s) => s.addFeedback);
  const joined = visibleCircles(weddings, memberships ?? [], account?.name ?? "", account?.email ?? "");
  const replaced = joined.length > 0;
  const featured = replaced ? joined : sample ? [sample] : [];
  const ranks = [...featured].sort((a, b) => activityScore(b) - activityScore(a) || a.bride.localeCompare(b.bride)).slice(0, 6);
  const [editing, setEditing] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  useDismissible(headerMenu, () => setHeaderMenu(false), headerMenuRef);
  const [note, setNote] = useState("");
  const [codeOpen, setCodeOpen] = useState(false);
  const [entryCode, setEntryCode] = useState("");
  const [entryName, setEntryName] = useState("");
  const [entryNote, setEntryNote] = useState("");
  const [entryBusy, setEntryBusy] = useState(false);
  const storeReady = usePersistedReady();
  const [sessionFailed, setSessionFailed] = useState(false);
  useEffect(() => {
    if (!storeReady) return;
    if (!useWeddingStore.persist.hasHydrated()) {
      console.error("Wedding session restore did not finish.");
      setSessionFailed(true);
    }
  }, [storeReady]);
  const pinNotice = useWeddingStore((s) => s.pinNotice);
  const circlesReady = storeReady;
  const shown = circlesReady ? featured : [];
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const entrance = usePageEntrance("landing");
  const cards = useCardDisplay();
  const landingRatio = cards.landing.original ? null : { w: cards.landing.w, h: cards.landing.h };
  const landingDesktopRatio = cards.landingDesktop.original ? null : { w: cards.landingDesktop.w, h: cards.landingDesktop.h };
  const pinnedRatio = cards.pinned.original ? null : { w: cards.pinned.w, h: cards.pinned.h };
  const pinnedBarRatio = cards.pinnedBar.original ? pinnedRatio : { w: cards.pinnedBar.w, h: cards.pinnedBar.h };
  const [kept, setKept] = useState<{ title: string; sources: string[] }[]>([]);
  const contextWedding = featured.find((item) => item.id === viewerWeddingId) ?? (featured.length === 1 ? featured[0] : undefined);
  const showHost = Boolean(contextWedding && isVerifiedHost(contextWedding, account, memberships ?? []));
  const premium = canPinLanding(account, weddings, memberships ?? []);
  const pinnedId = pinnedWeddingId(landingPins, account);
  const pinned = pinnedId ? weddings.find((item) => item.id === pinnedId) : undefined;
  const pinAllowed = Boolean(pinned && canEnterWedding(pinned, account, memberships ?? []));

  useEffect(() => {
    if (history.state?.wcBrowse) history.replaceState(null, "");
    setBrowsing(false);
  }, [pinnedId]);

  useEffect(() => {
    if (!browsing) return;
    const onPop = () => setBrowsing(false);
    window.addEventListener("popstate", onPop);
    history.pushState({ wcBrowse: true }, "");
    return () => {
      window.removeEventListener("popstate", onPop);
      if (history.state?.wcBrowse) history.back();
    };
  }, [browsing]);

  useEffect(() => {
    void loadAppearance();
  }, []);

  useEffect(() => {
    if (!storeReady || !pinnedId || pinAllowed) return;
    useWeddingStore.setState({ pinNotice: "Your pinned wedding is no longer available, so this is the normal landing page." });
    unpinLanding();
  }, [storeReady, pinnedId, pinAllowed, unpinLanding]);

  useEffect(() => {
    setKept(readKept());
    useWeddingStore.getState().ensureMemberships();
  }, []);

  useEffect(() => {
    if (!account?.email && !account?.phone) return;
    let live = true;
    void import("@/lib/wedding/account-cloud")
      .then(async ({ syncSignedAccount }) => {
        if (!live) return;
        await syncSignedAccount();
        if (!live) return;
        const { restoreMemberships } = await import("@/lib/wedding/publish");
        if (live) await restoreMemberships();
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [account?.email, account?.phone]);

  useEffect(() => {
    let live = true;
    let unsubscribe = () => {};
    const pull = (loadDeveloperPublicConfig: () => Promise<{ sample?: { bride?: string; groom?: string; date?: string; city?: string; place?: string; src?: string } }>) => {
      void loadDeveloperPublicConfig()
        .then((config) => {
          if (!live) return;
          const shown = config.sample?.src || "";
          const current = useWeddingStore.getState().weddings.find((item) => item.id === SEED_ID);
          const same =
            current &&
            current.bride === (config.sample?.bride || current.bride) &&
            current.groom === (config.sample?.groom || current.groom) &&
            current.date === (config.sample?.date || current.date) &&
            current.city === (config.sample?.city || current.city) &&
            current.place === (config.sample?.place || current.place) &&
            current.cover === shown;
          if (same) return;
          reviseSample({
            bride: config.sample?.bride || "",
            groom: config.sample?.groom || "",
            date: config.sample?.date || "",
            city: config.sample?.city || "",
            place: config.sample?.place || "",
            cover: shown,
          });
        })
        .catch(() => undefined);
    };
    void import("@/lib/wedding/library").then(({ loadDeveloperPublicConfig, subscribePublicConfig }) => {
      if (!live) return;
      pull(loadDeveloperPublicConfig);
      unsubscribe = subscribePublicConfig(() => pull(loadDeveloperPublicConfig));
    });
    return () => {
      live = false;
      unsubscribe();
    };
  }, [reviseSample]);

  function releaseBrowse() {
    if (history.state?.wcBrowse) history.replaceState(null, "");
    setBrowsing(false);
  }

  function openCircle(wedding: Wedding) {
    releaseBrowse();
    const owner = Boolean(account?.email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === account.email.toLowerCase());
    focusWedding(wedding.id, owner ? "host" : "guest");
    if (isSampleCircle(wedding)) useWeddingStore.getState().setViewerSide("Bride");
    void navigate({ to: "/w/$slug", params: { slug: wedding.slug } });
  }

  function openSample() {
    if (!useWeddingStore.getState().weddings.some((item) => item.id === SEED_ID)) {
      useWeddingStore.getState().restoreSample();
    }
    const open = useWeddingStore.getState().weddings.find((item) => item.id === SEED_ID);
    if (!open) return;
    openCircle(open);
  }

  function openSection(wedding: Wedding, section: "feed" | "live" | "memories") {
    releaseBrowse();
    const owner = Boolean(account?.email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === account.email.toLowerCase());
    focusWedding(wedding.id, owner ? "host" : "guest");
    if (isSampleCircle(wedding)) useWeddingStore.getState().setViewerSide("Bride");
    const to = section === "feed" ? "/w/$slug/feed" : section === "live" ? "/w/$slug/live" : "/w/$slug/memories";
    void navigate({ to, params: { slug: wedding.slug } });
  }

  function requestPin(wedding: Wedding) {
    const result = pinLanding(wedding.id);
    if (result === "ok") {
      releaseBrowse();
      toast("This wedding will open when you start the app.");
      return;
    }
    if (result === "free" || result === "signed-out") {
      setUpgradeOpen(true);
      return;
    }
    if (result === "unauthorized") toast("You can only pin a wedding you are allowed to enter.");
    else toast("That wedding cannot be pinned.");
  }

  function closeHeaderMenu() {
    setHeaderMenu(false);
  }

  function openHeaderAuth() {
    const wedding = featured.find((item) => item.id === useWeddingStore.getState().viewer.weddingId) ?? featured[0];
    if (wedding) {
      sessionStorage.setItem("wc-after-auth", `/w/${wedding.slug}`);
      sessionStorage.setItem("wc-join-wedding", wedding.id);
    }
    sessionStorage.setItem("wc-auth-mode", "in");
    void navigate({ to: "/account" });
  }

  async function claimCoupleDoor(raw: string) {
    const accountId = accountSenderId(account);
    if (!accountId) {
      setEntryNote("Sign in before using a bride or groom code. The role is saved to your account, not a shared name.");
      return;
    }
    const local = useWeddingStore.getState().claimCoupleAccess(raw);
    if (local.ok) {
      toast(local.role === "bride" ? "You are the bride for this wedding." : "You are the groom for this wedding.");
      void navigate({ to: "/w/$slug", params: { slug: local.slug } });
      return;
    }
    if (local.error === "revoked") {
      setEntryNote("That bride or groom code was revoked. Ask the host for a new one.");
      return;
    }
    if (local.error === "claimed") {
      setEntryNote("That code was already claimed by someone else.");
      return;
    }
    if (local.error === "both") {
      setEntryNote("This account is already the other role for that wedding. One person cannot be both.");
      return;
    }
    if (local.error === "unsigned") {
      setEntryNote("Sign in before using a bride or groom code. The role is saved to your account, not a shared name.");
      return;
    }
    try {
      const { claimCoupleSecret } = await import("@/lib/wedding/couple-access.functions");
      const result = await claimCoupleSecret({ data: { code: raw, accountId, name: account?.name ?? "" } });
      if (!result.ok) {
        if (result.error === "slow") setEntryNote("Too many attempts. Wait a few minutes and try again.");
        else if (result.error === "revoked") setEntryNote("That bride or groom code was revoked. Ask the host for a new one.");
        else if (result.error === "claimed") setEntryNote("That code was already claimed by someone else.");
        else if (result.error === "both") setEntryNote("This account is already the other role for that wedding. One person cannot be both.");
        else if (result.error === "paused") setEntryNote("This wedding circle is paused. The host has closed it for now.");
        else setEntryNote("That bride or groom code is not valid. If the wedding is not published yet, it only works on the phone that created it.");
        return;
      }
      const { loadCircle } = await import("@/lib/wedding/publish");
      const remote = await loadCircle(result.slug);
      if (remote) {
        if (useWeddingStore.getState().weddings.some((item) => item.slug === remote.slug)) useWeddingStore.getState().applyRemoteCircle(remote);
        else useWeddingStore.getState().adoptCircle(remote);
      }
      const seated = useWeddingStore.getState().applyVerifiedCoupleSeat(result.slug, result.role, account?.name ?? "");
      if (!seated.ok) {
        setEntryNote(seated.error === "both" ? "This account is already the other role for that wedding. One person cannot be both." : "The code was checked, but this wedding could not be opened. Try again.");
        return;
      }
      toast(result.role === "bride" ? "You are the bride for this wedding." : "You are the groom for this wedding.");
      void navigate({ to: "/w/$slug", params: { slug: result.slug } });
    } catch {
      setEntryNote("We could not check that code. Try again.");
    }
  }

  async function enterDoor(event: FormEvent) {
    event.preventDefault();
    const code = normalizeCode(entryCode);
    const person = (account?.name || entryName).trim();
    const coupleLooking = compactCoupleCode(entryCode).startsWith("BRIDE") || compactCoupleCode(entryCode).startsWith("GROOM");
    if (!code) {
      setEntryNote("Enter the wedding code from the host.");
      return;
    }
    if (coupleLooking && !accountSenderId(account)) {
      setEntryNote("Sign in before using a bride or groom code. The role is saved to your account, not a shared name.");
      return;
    }
    if (coupleLooking) {
      setEntryBusy(true);
      setEntryNote("");
      try {
        await claimCoupleDoor(entryCode);
      } finally {
        setEntryBusy(false);
      }
      return;
    }
    if (!person) {
      setEntryNote("Add your name.");
      return;
    }
    const compact = compactCode(code);
    if (compact === "GLASSHALL" || compact === "OPENDOOR" || compact === "LILANICO") {
      openSample();
      return;
    }
    setEntryBusy(true);
    setEntryNote("");
    try {
      let found = useWeddingStore.getState().weddings.find((item) => codeMatch(item, code));
      let matched = found ? codeMatch(found, code) : undefined;
      try {
        const { loadCircleByCode } = await import("@/lib/wedding/publish");
        const remote = await loadCircleByCode(code);
        const remoteMatch = remote ? codeMatch(remote, code) : undefined;
        if (remote && remoteMatch) {
          useWeddingStore.getState().adoptCircle(remote);
          found = useWeddingStore.getState().weddings.find((item) => item.slug === remote.slug) ?? remote;
          matched = codeMatch(found, code) ?? remoteMatch;
        }
      } catch {
        /* A saved circle on this phone can still open if the lookup is offline. */
      }
      if (!found || !matched) {
        setEntryNote("That code does not match a wedding circle. Check the family, guest, or couple code.");
        return;
      }
      if (isSampleCircle(found)) {
        openSample();
        return;
      }
      if (found.disabled && !isCircleOwner(found)) {
        setEntryNote("This wedding circle is paused. The host has closed it for now.");
        return;
      }
      const relationship = "Family";
      const result = useWeddingStore.getState().joinWedding(found.slug, person, "yes", relationship, code, matched.kind);
      if (result === "blocked") {
        setEntryNote("The host has removed that name from the circle.");
        return;
      }
      if (result === "disabled") {
        setEntryNote("This wedding circle is paused. The host has closed it for now.");
        return;
      }
      if (result !== "joined" && result !== "pending") {
        setEntryNote("That code does not match a wedding circle.");
        return;
      }
      const { confirmWeddingRole } = await import("@/lib/wedding/role-client");
      const auth = await confirmWeddingRole(found.slug, person, code);
      if (auth.ok) {
        const { applyRole } = await import("@/lib/wedding/role-client");
        applyRole(found.id, auth.role);
      } else if (matched.kind === "family") {
        setEntryNote(auth.error);
        return;
      }
      void navigate({ to: "/w/$slug", params: { slug: found.slug } });
    } catch {
      setEntryNote("We could not check that code. Try again.");
    } finally {
      setEntryBusy(false);
    }
  }

  const appearance = useClassicRegistry((s) => s.appearance);
  const mobileLanding = appearance.mobileLanding;
  const landingBackground = appearance.landingBackground;

  if (pinAllowed && pinned && !browsing && circlesReady) {
    return (
      <PinnedOpening
        wedding={pinned}
        ratio={pinnedBarRatio}
        full={cards.pinnedFull}
        onEnter={() => openCircle(pinned)}
        onChat={() => openSection(pinned, "feed")}
        onLive={() => openSection(pinned, "live")}
        onUnpin={() => {
          unpinLanding();
          toast("The landing page is back.");
        }}
        onBrowse={() => setBrowsing(true)}
      />
    );
  }

  return (
    <div className={`landing-stage relative min-h-dvh overflow-x-hidden text-ink ${entrance}`} data-app-ready="">
      {sessionFailed ? (
        <p className="relative z-40 mx-auto mt-3 flex max-w-xl flex-wrap items-center justify-center gap-3 px-4 text-center text-sm text-ink" role="status">
          Saved sign-in on this phone could not be read. The public page is open.
          <button type="button" className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" onClick={() => window.location.reload()}>
            Try again
          </button>
        </p>
      ) : null}
      {mobileLanding?.src ? (
        <img
          src={mobileLanding.src}
          alt=""
          className="landing-mobile-bg"
          style={{ objectFit: mobileLanding.fit, objectPosition: mobileLanding.position }}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      {landingBackground?.src ? (
        <img
          src={landingBackground.src}
          alt=""
          className="landing-page-bg"
          style={{ objectFit: landingBackground.fit, objectPosition: landingBackground.position }}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      <div className="landing-flora" aria-hidden="true">
        <img src="/flora/tl.webp?v=4" alt="" className="landing-flora-tl" draggable={false} />
        <img src="/flora/tr.webp?v=4" alt="" className="landing-flora-tr" draggable={false} />
      </div>
      <div className="landing-gloss" aria-hidden="true" />
      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 md:px-8 md:py-5">
        <LandingMark className="landing-brand flex min-w-0 items-center gap-2 lg:justify-self-center" />
        <div className="landing-tools flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="landing-leader-pill inline-flex items-center justify-center rounded-full border border-line bg-card"
            onClick={() => void navigate({ to: "/leaderboard" })}
          >
            <Crown className="landing-leader-crown" aria-hidden="true" />
            <span className="landing-leader-word">Leaderboard</span>
          </button>
          <div className="relative" ref={headerMenuRef}>
            <button
              type="button"
              className="landing-account inline-flex size-11 items-center justify-center rounded-full text-ink"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={headerMenu}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setHeaderMenu((open) => !open);
              }}
            >
              <EllipsisVertical className="landing-account-more size-5" aria-hidden="true" />
              <UserRound className="landing-account-person size-5" aria-hidden="true" />
            </button>
            {headerMenu ? (
              <div role="menu" className="wc-glass absolute right-0 top-12 z-30 w-56 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border text-ink shadow-[0_16px_40px_-24px_rgba(28,20,18,0.45)]">
                {account ? (
                  <>
                    <div className="border-b border-line px-3 py-3">
                      <p className="font-serif text-base leading-snug">{account.name}</p>
                      {showHost ? <p className="mt-0.5 text-xs font-medium tracking-wide text-maroon">Host</p> : null}
                    </div>
                    <Link
                      to="/account"
                      role="menuitem"
                      className="block min-h-11 px-3 py-2.5 text-sm"
                      onClick={closeHeaderMenu}
                    >
                      Profile
                    </Link>
                    {account.developer && sample ? (
                      <button
                        type="button"
                        role="menuitem"
                        className="block min-h-11 w-full px-3 text-left text-sm"
                        onClick={() => {
                          closeHeaderMenu();
                          setEditing(true);
                        }}
                      >
                        Edit sample wedding
                      </button>
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="block min-h-11 w-full px-3 text-left text-sm"
                      onClick={() => {
                        closeHeaderMenu();
                        signOutAccount();
                      }}
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/account"
                      role="menuitem"
                      className="block min-h-11 px-3 py-2.5 text-sm"
                      onClick={closeHeaderMenu}
                    >
                      Profile
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      className="block min-h-11 w-full px-3 text-left text-sm"
                      onClick={() => {
                        closeHeaderMenu();
                        openHeaderAuth();
                      }}
                    >
                      Sign in / Sign up
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main className="landing-board home-wave relative z-[1] mx-auto w-full max-w-5xl px-4 pb-8 md:px-8">
        {pinNotice ? (
          <p className="mt-4 rounded-2xl border border-line bg-card px-3 py-2 text-sm" role="status">
            {pinNotice}
          </p>
        ) : null}
        <section className="landing-feature grid gap-5 py-4 md:py-2">
          <div id="wc-early-bars" hidden={circlesReady} suppressHydrationWarning />
          {shown.map((wedding, index) => (
            <Fragment key={wedding.id}>
              {index === 1 ? (
                <div className="landing-featured-head">
                  <h2>Featured Weddings</h2>
                </div>
              ) : null}
              <div className={index === 0 ? "landing-hero grid justify-items-center gap-2" : "landing-extra grid justify-items-center gap-2"}>
              <WeddingCard
                wedding={wedding}
                ratio={landingRatio}
                desktopRatio={landingDesktopRatio}
                onOpen={() => (isSampleCircle(wedding) ? openSample() : openCircle(wedding))}
                onChat={() => openSection(wedding, "feed")}
                onLive={() => openSection(wedding, "live")}
              />
              {!isSampleCircle(wedding) && account ? (
                <button type="button" className="min-h-11 px-3 text-sm text-maroon" onClick={() => requestPin(wedding)}>
                  Pin as Landing Page
                </button>
              ) : null}
            </div>
            </Fragment>
          ))}
        </section>
        <script dangerouslySetInnerHTML={{ __html: LANDING_EARLY_BARS }} />

        <div className="landing-side">
        <div className="landing-rail mx-auto w-full max-w-[26rem]">
          <Link to="/create" className="landing-create inline-flex min-h-12 w-full items-center justify-center rounded-full bg-maroon px-5 text-sm text-on-photo">
            <span className="landing-create-mark" aria-hidden="true">+</span>
            <span className="landing-create-text">
              <span className="block">Create New Wedding</span>
              <span className="landing-create-copy">Design your wedding space, invite family and friends, and keep all your memories together.</span>
            </span>
            <ChevronRight className="landing-create-arrow size-4 shrink-0" aria-hidden="true" />
          </Link>
        </div>

        <section id="enter" className="landing-rail wc-glass mx-auto mt-6 w-full max-w-[26rem] scroll-mt-8 rounded-3xl px-4 py-5">
          <h2 className="font-serif text-3xl">Join a Wedding</h2>
          <p className="mt-1 text-sm text-muted">Already invited? Enter your access code.</p>
          <button
            type="button"
            className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-full bg-maroon px-4 text-sm text-on-photo"
            onClick={() => {
              setCodeOpen(true);
              setEntryNote("");
            }}
          >
            Enter Wedding Code
          </button>
          {account && !replaced ? (
            <button type="button" className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm" onClick={openSample}>
              Sample wedding
            </button>
          ) : null}
          {codeOpen ? (
            <form className="mt-6 max-w-lg" onSubmit={(event) => void enterDoor(event)}>
              <h3 className="font-serif text-2xl">Wedding code</h3>
              <p className="mt-1 text-sm text-muted">Enter your wedding access code. Bride and groom codes remain available for their account access.</p>
              <input
                className={`${fieldClass} mt-4`}
                placeholder="Wedding code"
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value)}
                autoComplete="off"
              />
              {account ? (
                <p className="mt-3 text-sm text-muted">Entering as {account.name}</p>
              ) : (
                <input className={`${fieldClass} mt-3`} placeholder="Your name" value={entryName} onChange={(e) => setEntryName(e.target.value)} />
              )}
              {entryNote ? <p className="mt-3 text-sm text-maroon">{entryNote}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="submit" disabled={entryBusy}>
                  {entryBusy ? "Checking the code…" : "Enter Wedding Code"}
                </Button>
                <Button type="button" variant="line" onClick={() => setCodeOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </section>

        <Link to="/discover" className="landing-rail discover-row wc-glass mx-auto mt-4 flex min-h-16 w-full max-w-[26rem] items-center gap-3 rounded-2xl px-4 py-3">
          <Compass className="size-5 shrink-0 text-maroon" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">Discover</span>
            <span className="block text-sm text-muted">Bridal dresses, jewellery, makeup and accessories.</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
        </Link>

        <Link to="/leaderboard" className="landing-rail landing-leader-card discover-row wc-glass mx-auto mt-4 hidden w-full max-w-[26rem] items-center gap-3 rounded-2xl px-4 py-3">
          <span className="flex w-full items-center gap-3">
            <Crown className="landing-leader-icon size-5 shrink-0 text-maroon" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="landing-leader-title block text-sm font-medium">Leaderboard</span>
              <span className="block text-sm text-muted">Most active weddings this month.</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
          </span>
          {circlesReady && ranks.length > 0 ? (
            <span className="landing-ranks" aria-hidden="true">
              {ranks.map((wedding, index) => (
                <span key={wedding.id} className="landing-rank">
                  {index < 3 ? (
                    <svg className={`landing-rank-crown ${index === 0 ? "text-gold" : index === 1 ? "text-muted" : "text-maroon"}`} viewBox="0 0 24 16" aria-hidden="true">
                      <path fill="currentColor" d="M2 14 L3.5 5 L8 9 L12 2 L16 9 L20.5 5 L22 14 Z" />
                    </svg>
                  ) : null}
                  <img src={wedding.cover || cardThemeOf(wedding.cardTheme).art} alt="" />
                </span>
              ))}
            </span>
          ) : null}
        </Link>

        <section className="landing-rail mx-auto w-full max-w-[26rem] border-t border-line py-6">
          <form
            className="grid max-w-xl gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!note.trim()) return;
              addFeedback(note, account?.name ?? "Guest");
              setNote("");
              toast("Sent to the developer.");
            }}
          >
            <h2 className="font-serif text-2xl">A note for the people who build this</h2>
            <p className="text-sm text-muted">It goes to the developer profile. It is not posted in a wedding.</p>
            <textarea className={fieldClass} rows={2} placeholder="What should change?" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button type="submit" className="w-fit">
              Send feedback
            </Button>
          </form>
          {kept.length > 0 ? (
            <div className="mt-4 max-w-xl">
              <h2 className="font-serif text-xl">Kept photos</h2>
              <ul className="mt-2 flex flex-col gap-2 text-sm text-muted">
                {kept.map((item) => (
                  <li key={item.title}>Kept from {item.title}. These stay on this phone only. Copies already in Google Drive stay there and are no longer part of a wedding.</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
        </div>
      </main>
      {upgradeOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/45 p-4 sm:items-center" role="dialog" aria-labelledby="pin-upgrade-title">
          <div className="w-full max-w-md rounded-3xl border border-line bg-ivory p-5 text-ink">
            <h2 id="pin-upgrade-title" className="font-serif text-2xl">Pin as Landing Page</h2>
            <p className="mt-2 text-sm text-muted">This opening screen is part of hosting a paid circle. Guests do not pay. The existing one-time circle fee is the upgrade. It is not a new subscription.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/create" className="inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo">
                Create a paid circle
              </Link>
              <Button type="button" variant="line" onClick={() => setUpgradeOpen(false)}>
                Not now
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {editing && sample ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center overflow-y-auto bg-ink/45 p-4 sm:items-center" role="dialog" aria-labelledby="sample-edit-title">
          <div className="w-full max-w-xl">
            <SampleEditor wedding={sample} onClose={() => setEditing(false)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SampleEditor({ wedding, onClose }: { wedding: Wedding; onClose: () => void }) {
  const reviseSample = useWeddingStore((s) => s.reviseSample);
  const [bride, setBride] = useState(wedding.bride);
  const [groom, setGroom] = useState(wedding.groom);
  const [date, setDate] = useState(wedding.date);
  const [city, setCity] = useState(wedding.city);
  const [place, setPlace] = useState(wedding.place);
  const [cover, setCover] = useState(wedding.cover);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent) {
    event.preventDefault();
    if (bride.trim().length < 2 || groom.trim().length < 2) {
      setError("Add the bride and groom names.");
      return;
    }
    const next = { bride: bride.trim(), groom: groom.trim(), date, city: city.trim(), place: place.trim(), cover };
    reviseSample(next);
    const { developerToken } = await import("@/lib/developer/runtime");
    const token = developerToken();
    if (!token) {
      toast("Saved on this device. Sign in with the developer account so every visitor sees it.");
      onClose();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { developerSaveSample } = await import("@/lib/developer/console.functions");
      const result = await developerSaveSample({ data: { token, ...next } });
      if (!result.ok) setError(result.error);
      else {
        if (result.sample) reviseSample(result.sample);
        toast("The sample wedding is updated.");
        onClose();
      }
    } catch {
      setError("The sample could not be saved for other visitors.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid max-w-xl gap-3 rounded-[1.5rem] border border-line bg-card p-5" onSubmit={(event) => void save(event)}>
      <h2 id="sample-edit-title" className="font-serif text-2xl">Edit sample wedding</h2>
      <p className="text-sm text-muted">This is the wedding new visitors see at the front of the home page.</p>
      <input className={fieldClass} placeholder="Bride" value={bride} onChange={(event) => setBride(event.target.value)} />
      <input className={fieldClass} placeholder="Groom" value={groom} onChange={(event) => setGroom(event.target.value)} />
      <input className={fieldClass} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
      <input className={fieldClass} placeholder="City" value={city} onChange={(event) => setCity(event.target.value)} />
      <input className={fieldClass} placeholder="Place" value={place} onChange={(event) => setPlace(event.target.value)} />
      <label className="text-sm text-muted">
        Cover photo
        <input
          className="mt-1 block w-full text-sm text-ink"
          type="file"
          accept={PHOTO_ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void compressImage(file)
              .then((next) => {
                if (next.length > 480_000) {
                  setError("That photo is too large. Try a smaller one.");
                  return;
                }
                setCover(next);
                setError("");
              })
              .catch(() => setError("That photo could not be used."));
          }}
        />
      </label>
      {cover ? <CardCover src={cover} alt="" className="h-36 w-full rounded-2xl object-cover" /> : null}
      {error ? <p className="text-sm text-maroon">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save sample"}
        </Button>
        <Button type="button" variant="line" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
