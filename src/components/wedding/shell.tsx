import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowLeftRight,
  Bell,
  Clapperboard,
  Home,
  Menu,
  MessageCircle,
  Radio,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, Fragment, memo } from "react";
import { createPortal } from "react-dom";
import { Button, Mark } from "@/components/wedding/ui";
import { WeddingAvatar } from "@/components/wedding/guest-profile";
import { PersonName } from "@/components/wedding/marks";
import { useWedding, useCircleTheme } from "@/components/wedding/context";
import { LivingCanvas, useReducedMotion } from "@/components/wedding/living";
import { coupleTitle, roleLabel } from "@/lib/wedding/format";
import { ownMemberKey } from "@/lib/wedding/guest-profile";
import { DESK_SPLIT_QUERY, deskPaneVisible, emptyDeskPanels, panelsFromRoute, readDeskPanels, type DeskPanels } from "@/lib/wedding/desk-layout";
import { useDismissible } from "@/lib/wedding/dismiss";
import { cardThemeOf, themeSurface, themeTone, warmThemeAssets, type CardTheme } from "@/lib/wedding/card-themes";
import { useClassicRegistry } from "@/lib/wedding/classic-registry";
import { ensureFonts, fontCssVars } from "@/lib/wedding/fonts";
import { SEED_ID } from "@/lib/wedding/seed";
import { useWeddingStore } from "@/lib/wedding/store";
import { applyRole, confirmWeddingRole } from "@/lib/wedding/role-client";
import { LiveSessionProvider } from "@/components/wedding/live-session";
import { ExpiryNotice } from "@/components/wedding/expiry-notice";
import { useOnline } from "@/components/wedding/offline-host";
import { HomeScreen } from "@/components/wedding/home-screen";
import { FeedScreen } from "@/components/wedding/feed-screen";
import { LiveScreen } from "@/components/wedding/live-screen";
import { MemoriesScreen } from "@/components/wedding/memory-screen";
import { MoreScreen } from "@/components/wedding/plan-screen";
import { nextSwipeIndex } from "@/lib/wedding/swipe";
import { cn } from "@/lib/utils";

const swipeSections = ["", "/feed", "/live", "/memories", "/more"] as const;

/** Desktop and phone landing files are the same wedding art at different crops. CSS shows one. */
function ThemeLanding({ theme }: { theme: CardTheme }) {
  const art = theme.landingArt;
  if (!art?.desktop && !art?.mobile) return null;
  const desktop = art.desktop || art.mobile;
  const mobile = art.mobile || art.desktop;
  return (
    <>
      {desktop ? (
        <img
          src={desktop}
          alt=""
          className={cn("theme-landing-desk", theme.pageSoft && "is-soft")}
          style={{ objectFit: art.fit === "contain" ? "contain" : "cover", objectPosition: art.position || "center" }}
        />
      ) : null}
      {mobile ? (
        <img
          src={mobile}
          alt=""
          className={cn("theme-landing-phone", theme.pageSoft && "is-soft")}
          style={{ objectFit: (art.mobileFit || art.fit) === "contain" ? "contain" : "cover", objectPosition: art.mobilePosition || art.position || "center" }}
        />
      ) : null}
    </>
  );
}

function swipeIndex(path: string, base: string) {
  if (!path.startsWith(base)) return -1;
  const rest = path.slice(base.length).replace(/\/$/, "");
  return swipeSections.indexOf(rest as (typeof swipeSections)[number]);
}

const primary = [
  { href: "", label: "Home", icon: Home },
  { href: "/feed", label: "Chat", icon: MessageCircle },
  { href: "/live", label: "Live", icon: Radio },
  { href: "/memories", label: "Album", icon: Clapperboard },
  { href: "/more", label: "More", icon: Menu },
] as const;

export function Shell({ children }: { children: ReactNode }) {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const unread = useWeddingStore((s) => s.notices.filter((n) => !n.read).length);
  const notices = useWeddingStore((s) => s.notices);
  const markNoticeRead = useWeddingStore((s) => s.markNoticeRead);
  const weddings = useWeddingStore((s) => s.weddings);
  const account = useWeddingStore((s) => s.account);
  void account;
  const [rolesOpen, setRolesOpen] = useState(false);
  const [roleCode, setRoleCode] = useState("");
  const [roleNote, setRoleNote] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [memberKey, setMemberKey] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  const [roleSlot, setRoleSlot] = useState<HTMLElement | null>(null);
  const [notesSlot, setNotesSlot] = useState<HTMLElement | null>(null);
  const [rolePlace, setRolePlace] = useState<{ top: number; left: number } | null>(null);
  const [notesPlace, setNotesPlace] = useState<{ top: number; right: number } | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const rolesRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  useDismissible(notesOpen, () => setNotesOpen(false), notesRef);
  useDismissible(rolesOpen, () => setRolesOpen(false), rolesRef);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const online = useOnline();
  const navigate = useNavigate();
  const base = `/w/${wedding.slug}`;
  const columnRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const routeIndex = swipeIndex(path, base);
  const [shownIndex, setShownIndex] = useState<number | null>(null);
  const active = shownIndex !== null && shownIndex !== routeIndex ? shownIndex : routeIndex;
  const [panels, setPanels] = useState<DeskPanels>(emptyDeskPanels);
  const [split, setSplit] = useState(false);
  const [chatLiveSwapped, setChatLiveSwapped] = useState(false);
  const splitRef = useRef(false);
  splitRef.current = split;
  const chatOn = active >= 0 && (split ? panels.left === 1 : active === 1);
  const chatLivePair = split && panels.left === 1 && panels.right === 2;
  useEffect(() => {
    try {
      setChatLiveSwapped(sessionStorage.getItem(`wc-desk-swap:${wedding.slug}`) === "1");
    } catch {
      setChatLiveSwapped(false);
    }
  }, [wedding.slug]);
  function toggleChatLive() {
    setChatLiveSwapped((current) => {
      const next = !current;
      try {
        sessionStorage.setItem(`wc-desk-swap:${wedding.slug}`, next ? "1" : "0");
      } catch {
        /* This session can still swap without storage. */
      }
      return next;
    });
  }
  const parkChrome = split && chatOn;
  useLayoutEffect(() => {
    if (!parkChrome) {
      setRoleSlot(null);
      setNotesSlot(null);
      return;
    }
    const sync = () => {
      const role = document.getElementById("wc-role-slot");
      const notes = document.getElementById("wc-notes-slot");
      setRoleSlot(role instanceof HTMLElement ? role : null);
      setNotesSlot(notes instanceof HTMLElement ? notes : null);
    };
    sync();
    const frame = window.requestAnimationFrame(sync);
    return () => window.cancelAnimationFrame(frame);
  }, [parkChrome]);
  useLayoutEffect(() => {
    if (!rolesOpen && !notesOpen) return;
    const place = () => {
      if (rolesOpen && rolesRef.current) {
        const rect = rolesRef.current.getBoundingClientRect();
        const width = 256;
        setRolePlace({ top: rect.bottom + 8, left: Math.min(Math.max(8, rect.left), window.innerWidth - width - 8) });
      }
      if (notesOpen && notesRef.current) {
        const rect = notesRef.current.getBoundingClientRect();
        setNotesPlace({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
      }
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [rolesOpen, notesOpen, parkChrome]);
  const mineProfile = memberKey ? wedding.guestProfiles?.[memberKey] : undefined;
  const myPhoto = mineProfile && !mineProfile.removed ? mineProfile.photo || "" : "";
  const myName = mineProfile && !mineProfile.removed && mineProfile.displayName ? mineProfile.displayName : viewer.name || "You";
  useLayoutEffect(() => {
    setMemberKey(ownMemberKey(wedding.slug));
  }, [wedding.slug]);
  const shownPath = active >= 0 ? `${base}${swipeSections[active]}` : path;
  const indexRef = useRef(active);
  if (active >= 0) indexRef.current = active;
  const swipeLock = useRef(false);
  const showSectionRef = useRef<(index: number) => void>(() => {});
  const systemReduce = useReducedMotion();
  const page = wedding.pageBackground;
  const pageMotion = page?.reduce || systemReduce ? "static" : page?.motion ?? "subtle";
  const themeId = useCircleTheme();
  const themeRev = useClassicRegistry((s) => s.rev);
  const cardTheme = cardThemeOf(themeId);
  void themeRev;
  const surface = themeSurface(cardTheme);
  const fontVars = fontCssVars(wedding.fonts);
  const [glide, setGlide] = useState<"forward" | "back" | "">("");
  const flight = useRef(0);
  const glideTimer = useRef(0);
  const queued = useRef<number | null>(null);
  useEffect(() => {
    warmThemeAssets(cardTheme);
  }, [cardTheme]);
  useEffect(() => {
    ensureFonts(Object.values(wedding.fonts ?? {}));
  }, [wedding.fonts]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const next = themeSurface(cardTheme);
    root.dataset.cardTheme = cardTheme.id;
    root.dataset.tone = themeTone(cardTheme);
    if (cardTheme.pageSoft) root.dataset.pageSoft = "1";
    else delete root.dataset.pageSoft;
    for (const [key, value] of Object.entries(next)) root.style.setProperty(key, value);
    return () => {
      if (root.dataset.cardTheme === cardTheme.id) {
        delete root.dataset.cardTheme;
        delete root.dataset.tone;
        delete root.dataset.pageSoft;
      }
      for (const key of Object.keys(next)) root.style.removeProperty(key);
    };
  }, [cardTheme]);
  const sample = wedding.id === SEED_ID;
  const onHome = path === base || path === `${base}/`;
  const onHomeRef = useRef(onHome);
  onHomeRef.current = onHome;
  const [exitPull, setExitPull] = useState(0);
  const [edgePull, setEdgePull] = useState(0);
  useEffect(() => {
    const column = columnRef.current;
    if (!column) return;
    let pull = 0;
    let edge = 0;
    let tracking: { x: number; y: number; t: number; ignore: boolean } | null = null;
    let last: { x: number; y: number } | null = null;
    let axis = "";
    let consumed = false;
    const showPull = (value: number) => {
      pull = value;
      setExitPull(value);
    };
    const showEdge = (value: number) => {
      edge = value;
      setEdgePull(value);
    };
    const blocked = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      if (target.closest(".album-shot") && !target.closest("button, a, input, textarea, select, video, iframe")) return false;
      if (target.closest("[data-noswipe], input, textarea, select, video, iframe, canvas, [contenteditable='true'], [role='dialog']")) return true;
      const activeEl = document.activeElement;
      return Boolean(
        activeEl instanceof HTMLElement
        && activeEl !== document.body
        && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT" || activeEl.isContentEditable)
        && (activeEl === target || activeEl.contains(target)),
      );
    };
    const commit = (dx: number, dy: number, started: number) => {
      if (splitRef.current) return;
      const next = nextSwipeIndex(indexRef.current, dx, dy, performance.now() - started, swipeSections.length);
      if (next === indexRef.current) return;
      if (swipeLock.current) {
        queued.current = next;
        return;
      }
      showSectionRef.current(next);
    };
    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        tracking = null;
        last = null;
        return;
      }
      const touch = event.touches[0];
      axis = "";
      tracking = touch ? { x: touch.clientX, y: touch.clientY, t: performance.now(), ignore: blocked(event.target) } : null;
      last = touch ? { x: touch.clientX, y: touch.clientY } : null;
    };
    const onMove = (event: TouchEvent) => {
      if (!tracking || tracking.ignore) return;
      const touch = event.touches[0];
      if (!touch) return;
      last = { x: touch.clientX, y: touch.clientY };
      const dx = touch.clientX - tracking.x;
      const dy = touch.clientY - tracking.y;
      if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) axis = Math.abs(dx) > Math.abs(dy) * 1.05 ? "x" : "y";
      if (axis === "x") {
        if (splitRef.current) return;
        if (onHomeRef.current && tracking.x <= 36 && dx > 0) showEdge(Math.min(dx, 140));
        const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
        const speed = Math.abs(dx) / Math.max(16, performance.now() - tracking.t);
        if (horizontal && (Math.abs(dx) >= 52 || (Math.abs(dx) >= 36 && speed >= 0.55))) event.preventDefault();
        return;
      }
      if (
        onHomeRef.current
        && (() => {
          const pane = column.querySelector(":scope > main > .section-pane:not([hidden]):not([data-offstage])");
          return pane instanceof HTMLElement ? pane.scrollTop : window.scrollY;
        })() < 12
        && tracking.y < 170
        && tracking.x > 48
        && !(event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='dialog']"))
        && dy > 36
        && dy > Math.abs(dx) * 1.5
      ) {
        showPull(Math.min(dy, 140));
        event.preventDefault();
        return;
      }
      if (onHomeRef.current && tracking.x <= 36 && !tracking.ignore && dx > 28 && dx > Math.abs(dy) * 1.4) {
        showEdge(Math.min(dx, 140));
        if (dx > 72) event.preventDefault();
        return;
      }
      if (axis === "y") return;
      if (Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.15) event.preventDefault();
    };
    const onEnd = (event: TouchEvent) => {
      const began = tracking;
      const touch = event.changedTouches[0];
      const pulled = pull;
      const edged = edge;
      tracking = null;
      last = null;
      showPull(0);
      showEdge(0);
      if (!began || began.ignore || !touch) return;
      const dx = touch.clientX - began.x;
      const dy = touch.clientY - began.y;
      const elapsed = Math.max(16, performance.now() - began.t);
      const onControl = event.target instanceof Element && Boolean(event.target.closest("a, button, [role='button'], label, summary, input, textarea, select"));
      if (onControl && Math.hypot(dx, dy) < 64) return;
      const next = nextSwipeIndex(indexRef.current, dx, dy, elapsed, swipeSections.length);
      const leaving = onHomeRef.current && began.x <= 36 && edged >= 110 && dx > Math.abs(dy) * 1.4;
      const pulling = pulled >= 110 && onHomeRef.current;
      if (next !== indexRef.current || leaving || pulling) {
        consumed = true;
        event.preventDefault();
      }
      if (onHomeRef.current && began.x <= 36 && edged >= 110 && dx > Math.abs(dy) * 1.4) {
        void navigate({ to: "/" });
        return;
      }
      if (pulled >= 110 && onHomeRef.current) {
        void navigate({ to: "/" });
        return;
      }
      if (swipeLock.current) {
        const next = nextSwipeIndex(indexRef.current, dx, dy, performance.now() - began.t, swipeSections.length);
        if (next !== indexRef.current) queued.current = next;
        return;
      }
      commit(dx, dy, began.t);
    };
    const onCancel = () => {
      const began = tracking;
      const point = last;
      tracking = null;
      last = null;
      showPull(0);
      showEdge(0);
      if (!began || began.ignore || swipeLock.current || !point) return;
      const dx = point.x - began.x;
      const dy = point.y - began.y;
      const next = nextSwipeIndex(indexRef.current, dx, dy, performance.now() - began.t, swipeSections.length);
      if (next !== indexRef.current) consumed = true;
      commit(dx, dy, began.t);
    };
    const onClick = (event: MouseEvent) => {
      if (!consumed) return;
      consumed = false;
      event.preventDefault();
      event.stopPropagation();
    };
    column.addEventListener("touchstart", onStart, { capture: true, passive: true });
    column.addEventListener("touchmove", onMove, { capture: true, passive: false });
    column.addEventListener("touchend", onEnd, { capture: true, passive: false });
    column.addEventListener("touchcancel", onCancel, { capture: true });
    column.addEventListener("click", onClick, true);
    return () => {
      column.removeEventListener("touchstart", onStart, { capture: true });
      column.removeEventListener("touchmove", onMove, { capture: true });
      column.removeEventListener("touchend", onEnd, { capture: true });
      column.removeEventListener("touchcancel", onCancel, { capture: true });
      column.removeEventListener("click", onClick, true);
    };
  }, [navigate, wedding.slug]);
  useLayoutEffect(() => {
    const media = window.matchMedia(DESK_SPLIT_QUERY);
    const apply = () => setSplit(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  useEffect(() => {
    const saved = readDeskPanels(window.sessionStorage.getItem(`wc-desk:${wedding.slug}`));
    setPanels(panelsFromRoute(swipeIndex(pathRef.current, `/w/${wedding.slug}`), saved ?? emptyDeskPanels()));
  }, [wedding.slug]);
  useEffect(() => {
    setPanels((current) => panelsFromRoute(routeIndex, current));
  }, [routeIndex]);
  useEffect(() => {
    window.sessionStorage.setItem(`wc-desk:${wedding.slug}`, JSON.stringify(panels));
  }, [panels, wedding.slug]);
  useEffect(() => {
    if (routeIndex < 0) {
      indexRef.current = -1;
      flight.current = 0;
      swipeLock.current = false;
      document.documentElement.removeAttribute("data-gliding");
      window.clearTimeout(glideTimer.current);
      if (shownIndex !== null) setShownIndex(null);
      return;
    }
    if (flight.current !== 0 && routeIndex !== indexRef.current) return;
    if (flight.current === 0) indexRef.current = routeIndex;
    if (shownIndex !== null && routeIndex === indexRef.current) setShownIndex(null);
  }, [routeIndex, shownIndex]);
  useEffect(() => {
    setToolsOpen(false);
  }, [path, active]);
  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || toolsRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-app-mark]")) return;
      setToolsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToolsOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [toolsOpen]);
  function showSection(index: number) {
    if (index < 0 || index >= swipeSections.length) return;
    const basePath = `/w/${wedding.slug}`;
    if (index === indexRef.current && (flight.current !== 0 || swipeIndex(pathRef.current, basePath) === index)) return;
    const dir = index >= indexRef.current ? "forward" : "back";
    indexRef.current = index;
    const token = ++flight.current;
    document.documentElement.dataset.gliding = "1";
    swipeLock.current = true;
    window.clearTimeout(glideTimer.current);
    glideTimer.current = window.setTimeout(() => {
      if (flight.current !== token) return;
      swipeLock.current = false;
      document.documentElement.removeAttribute("data-gliding");
      flight.current = 0;
      const follow = queued.current;
      queued.current = null;
      if (follow != null && follow !== index) {
        showSection(follow);
        return;
      }
      const now = swipeIndex(window.location.pathname, basePath);
      if (now < 0 || now === indexRef.current) return;
      const fix = swipeSections[indexRef.current];
      if (!fix && indexRef.current !== 0) return;
      void navigate({
        to: fix === "" ? "/w/$slug" : (`/w/$slug${fix}` as "/w/$slug"),
        params: { slug: wedding.slug },
      });
    }, 340);
    setGlide(dir);
    setShownIndex(index);
    const href = swipeSections[index];
    const destination = {
      to: href === "" ? "/w/$slug" : (`/w/$slug${href}` as "/w/$slug"),
      params: { slug: wedding.slug },
    } as const;
    void navigate(destination).finally(() => {
      window.setTimeout(() => {
        if (token !== flight.current) return;
        const now = swipeIndex(window.location.pathname, basePath);
        if (now < 0 || now === indexRef.current) return;
        const fix = swipeSections[indexRef.current];
        if (!fix && indexRef.current !== 0) return;
        void navigate({
          to: fix === "" ? "/w/$slug" : (`/w/$slug${fix}` as "/w/$slug"),
          params: { slug: wedding.slug },
        });
      }, 80);
    });
  }
  showSectionRef.current = showSection;
  function goSection(href: string) {
    setToolsOpen(false);
    queued.current = null;
    const index = swipeSections.indexOf(href as (typeof swipeSections)[number]);
    setPanels((current) => panelsFromRoute(index, current));
    if (index < 0) return;
    showSection(index);
  }
  useLayoutEffect(() => {
    const nav = document.querySelector("[data-app-nav]");
    const header = document.querySelector("[data-app-header]");
    let navHeight = -1;
    let headerHeight = -1;
    const apply = () => {
      const wide = window.matchMedia("(min-width: 768px)").matches;
      if (nav instanceof HTMLElement) {
        const height = wide ? 0 : Math.ceil(nav.getBoundingClientRect().height);
        if (Math.abs(height - navHeight) >= 1) {
          navHeight = height;
          document.documentElement.style.setProperty("--app-nav", `${height}px`);
        }
      }
      if (header instanceof HTMLElement) {
        const height = Math.ceil(header.getBoundingClientRect().height);
        if (Math.abs(height - headerHeight) >= 1) {
          headerHeight = height;
          document.documentElement.style.setProperty("--app-header", `${height}px`);
        }
      }
    };
    apply();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    if (nav instanceof HTMLElement) watch?.observe(nav);
    if (header instanceof HTMLElement) watch?.observe(header);
    window.addEventListener("resize", apply);
    return () => {
      watch?.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [toolsOpen]);
  useEffect(() => {
    const root = document.documentElement;
    const view = window.visualViewport;
    let open = false;
    let timer = 0;
    const editableFocused = () => {
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el.closest("[data-app-nav]")) return false;
      if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
      if (el instanceof HTMLInputElement) {
        return ["text", "search", "email", "tel", "url", "password", "number", ""].includes(el.type);
      }
      return false;
    };
    const apply = () => {
      const focused = editableFocused();
      const bottom = view ? Math.round(view.offsetTop + view.height) : window.innerHeight;
      const gap = view ? Math.max(0, window.innerHeight - view.height - view.offsetTop) : 0;
      const covered = gap > 60;
      const next = focused && (open ? gap > 40 || covered : covered);
      if (next !== open) {
        open = next;
        root.classList.toggle("keyboard-open", next);
      }
      if (focused && view) root.style.setProperty("--vv-bottom", `${bottom}px`);
      else root.style.removeProperty("--vv-bottom");
    };
    const onFocusOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, 80);
    };
    view?.addEventListener("resize", apply);
    window.addEventListener("focusin", apply);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(timer);
      view?.removeEventListener("resize", apply);
      window.removeEventListener("focusin", apply);
      window.removeEventListener("focusout", onFocusOut);
      root.classList.remove("keyboard-open");
      root.style.removeProperty("--vv-bottom");
    };
  }, []);
  const roleControl = (
    <div className="relative shrink-0 text-sm" ref={rolesRef}>
      <button
        type="button"
        className="inline-flex min-h-11 items-center whitespace-nowrap rounded-full border border-line bg-ivory px-3 text-ink"
        aria-label={`Role, ${roleLabel(viewer)}`}
        aria-expanded={rolesOpen}
        onClick={() => setRolesOpen((open) => !open)}
      >
        {roleLabel(viewer)}
      </button>
      {rolesOpen && rolePlace ? (
        <ul className="fixed z-50 w-64 overflow-hidden rounded-2xl border border-line bg-ivory text-ink shadow-none" style={{ top: rolePlace.top, left: rolePlace.left }}>
          <li className="px-4 py-3">
            <p className="text-sm">Your role is {roleLabel(viewer)}. It stays locked.</p>
            <p className="mt-1 text-xs text-muted">Enter the host, co-host, or family code to change it. A guest code cannot raise your role.</p>
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setRoleNote("");
                void confirmWeddingRole(wedding.slug, viewer.name, roleCode).then((result) => {
                  if (!result.ok) {
                    setRoleNote(result.error);
                    return;
                  }
                  applyRole(wedding.id, result.role);
                  setRoleCode("");
                  setRoleNote("");
                  setRolesOpen(false);
                });
              }}
            >
              <input
                className="w-full rounded-2xl border border-line bg-card px-3 py-2 text-sm"
                placeholder="Authorization code"
                value={roleCode}
                autoComplete="off"
                onChange={(event) => setRoleCode(event.target.value)}
              />
              <button type="submit" className="min-h-11 rounded-full bg-maroon px-3 text-sm text-on-photo">
                Check code
              </button>
            </form>
            {roleNote ? <p className="mt-2 text-xs text-maroon">{roleNote}</p> : null}
          </li>
        </ul>
      ) : null}
    </div>
  );
  const notesControl = (
    <div className="relative" ref={notesRef}>
      <button
        type="button"
        className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-card px-3 text-sm"
        aria-label="Notifications"
        onClick={() => setNotesOpen((open) => !open)}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 ? <span className="tabular-nums">{unread}</span> : null}
      </button>
      {notesOpen && notesPlace ? (
        <ul className="fixed z-50 w-72 overflow-hidden rounded-2xl border border-line bg-ivory text-ink" style={{ top: notesPlace.top, right: notesPlace.right }}>
          {notices.slice(0, 6).length === 0 ? <li className="px-4 py-3 text-sm text-muted">Nothing new</li> : null}
          {notices.slice(0, 6).map((notice) => {
            const circle = weddings.find((item) => item.id === notice.weddingId);
            const to =
              notice.kind === "function"
                ? "/w/$slug/functions"
                : notice.kind === "chat"
                  ? "/w/$slug/chats"
                  : notice.kind === "live"
                    ? "/w/$slug/live"
                    : notice.kind === "expiry"
                      ? "/w/$slug/memories"
                      : notice.kind === "announcement" || notice.kind === "comment" || notice.kind === "reaction" || notice.kind === "photo" || notice.kind === "video"
                        ? "/w/$slug/feed"
                        : "/w/$slug";
            return (
              <li key={notice.id} className="border-b border-line last:border-0">
                {circle ? (
                  <Link
                    to={to}
                    params={{ slug: circle.slug }}
                    className="block px-4 py-3"
                    onClick={() => {
                      markNoticeRead(notice.id);
                      setNotesOpen(false);
                    }}
                  >
                    <span className="block text-sm font-medium">{notice.title}</span>
                    <span className="mt-1 block text-sm text-muted">{notice.body}</span>
                  </Link>
                ) : (
                  <p className="px-4 py-3 text-sm">{notice.title}</p>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
  return (
    <LiveSessionProvider>
    <div className={cn("relative z-[1] min-h-dvh", split && "desk-split")} data-app-ready="" data-card-theme={cardTheme.id} data-tone={themeTone(cardTheme)} style={surface as CSSProperties}>
      <div ref={columnRef} className={cn("swipe-column relative flex min-h-dvh min-w-0 flex-col", split && "desk-split", chatLivePair && chatLiveSwapped && "is-chat-live-swapped", !page?.style && "desk-theme-floor")} style={fontVars}>
        {online ? null : (
          <p className="border-b border-line bg-ivory px-4 py-3 text-sm text-ink" role="status">
            You're offline. Saved home and chats on this phone can still open, and a message you already typed stays here. Live video, uploads, and payments are not sent until you reconnect.
          </p>
        )}
        {edgePull > 36 ? (
          <div className="pointer-events-none fixed top-1/3 z-40" style={{ left: 8, transform: `translateX(${Math.min(edgePull, 72)}px)` }}>
            <span className="rounded-full border border-gold/70 bg-ivory/95 px-3 py-1 text-xs text-ink">
              {edgePull >= 110 ? "Release to return home" : "Swipe right to leave"}
            </span>
          </div>
        ) : null}
        {exitPull > 28 ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-40 flex justify-center" style={{ transform: `translateY(${Math.min(exitPull, 72)}px)` }}>
            <span className="rounded-full border border-gold/70 bg-ivory/95 px-3 py-1 text-xs text-ink">
              {exitPull >= 110 ? "Release to return home" : "Swipe down to leave this wedding"}
            </span>
          </div>
        ) : null}
        <span className="theme-atmosphere" aria-hidden="true" />
        <LivingCanvas styleId={page?.style} motion={pageMotion} wash={page?.style ? undefined : cardTheme.shell["--color-ivory"]} />
        <ThemeLanding theme={cardTheme} />
        {cardTheme.pageSoft ? <span className="theme-page-veil" aria-hidden="true" /> : null}
        <header data-app-header="" className="sticky top-0 z-30 bg-ivory/85 backdrop-blur-md">
          {sample ? (
            <div className="px-3 pt-1 md:hidden">
              <Link to="/w/$slug" params={{ slug: wedding.slug }} className="sample-pill inline-flex h-8 items-center rounded-full border border-line bg-card px-2.5 text-xs">
                Sample wedding circle
              </Link>
            </div>
          ) : null}
          <div
            ref={toolsRef}
            id="wc-desk-tools"
            data-app-menu=""
            className={cn("flex items-center gap-2 px-3 py-1.5", !toolsOpen && "md:hidden")}
            onClick={(event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("a")) setToolsOpen(false);
            }}
          >
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
          {chatOn && !split ? (
            <WeddingAvatar
              bar
              name={myName}
              photo={myPhoto}
              seed={`${wedding.slug}:${memberKey || viewer.name || "guest"}`}
              label="Your wedding profile"
              onOpen={() => window.dispatchEvent(new Event("wc-open-profile"))}
            />
          ) : (
          <Link to="/w/$slug" params={{ slug: wedding.slug }} className="min-w-0 shrink">
            <span className="block truncate font-serif text-base leading-tight md:text-lg">{coupleTitle(wedding)}</span>
            <span className="block truncate text-[11px] font-normal leading-tight text-muted">
              <PersonName wedding={wedding} name={viewer.name} />
            </span>
          </Link>
          )}
          {parkChrome && roleSlot ? createPortal(roleControl, roleSlot) : roleControl}
          </div>
          <span className="flex shrink-0 items-center gap-2">
          <div id="wc-topbar-tools" className="relative shrink-0 empty:hidden" />
          {parkChrome && notesSlot ? createPortal(notesControl, notesSlot) : notesControl}
          <Link to="/account" className="hidden min-h-11 items-center rounded-full border border-line bg-card px-3 text-sm sm:inline-flex">
            Profile
          </Link>
          </span>
          </div>
          </div>
          <DeskNav base={base} split={split} active={active} panels={panels} toolsOpen={toolsOpen} onTools={() => setToolsOpen((open) => !open)} onJump={goSection} showSwap={chatLivePair} swapped={chatLiveSwapped} onSwap={toggleChatLive} />
        </header>
        {wedding.disabled ? (
          <p className="border-b border-line bg-paper px-4 py-2 text-sm">This circle is paused. Family and guests cannot enter until you open it again under Privacy.</p>
        ) : null}
        <ExpiryNotice />
        <main className={cn("relative z-[1] flex min-h-0 flex-1 flex-col pb-safe md:pb-0", split && active >= 0 && "desk-board")} data-glide={glide || undefined}>
          {active >= 0 ? <CircleSections active={active} split={split} panels={panels} /> : <div className="section-pane nested-pane">{children}</div>}
        </main>
        <nav data-app-nav="" className="nav-safe app-tabbar fixed inset-x-0 bottom-0 z-30 md:hidden">
          <ul className="grid grid-cols-5">
            {primary.slice(0, 4).map((item) => (
              <li key={item.label}>
                <MobileLink base={base} href={item.href} label={item.label} icon={item.icon} path={shownPath} onJump={goSection} />
              </li>
            ))}
            <li>
              <MobileLink base={base} href="/more" label="More" icon={Menu} path={shownPath} onJump={goSection} />
            </li>
          </ul>
        </nav>
      </div>
    </div>
    </LiveSessionProvider>
  );
}

const StableHome = memo(HomeScreen);
const StableFeed = memo(FeedScreen);
const StableLive = memo(LiveScreen);
const StableMemories = memo(MemoriesScreen);
const StableMore = memo(MoreScreen);
const circleScreens = [StableHome, StableFeed, StableLive, StableMemories, StableMore] as const;

function CircleSections({ active, split, panels }: { active: number; split: boolean; panels: DeskPanels }) {
  const signature = `${active}|${split ? 1 : 0}|${panels.left}|${panels.right}`;
  const reduce = useReducedMotion();
  const [mark, setMark] = useState("");
  useEffect(() => {
    if (reduce) return;
    setMark(signature);
    const timer = window.setTimeout(() => setMark(""), 340);
    return () => window.clearTimeout(timer);
  }, [signature, reduce]);
  return (
    <>
      {circleScreens.map((Screen, index) => {
        const shown = deskPaneVisible(index, split, active, panels);
        const feed = swipeSections[index] === "/feed";
        return (
          <div
            key={swipeSections[index] || "home"}
            hidden={feed ? undefined : !shown}
            data-offstage={feed && !shown ? "" : undefined}
            inert={feed && !shown ? true : undefined}
            aria-hidden={feed && !shown ? true : undefined}
            data-desk={index <= 1 ? "left" : "right"}
            className={cn("section-pane", shown && mark === signature && "section-arrive")}
            data-section={swipeSections[index] || "home"}
          >
            <Screen />
          </div>
        );
      })}
    </>
  );
}

const deskItems = [
  { href: "", label: "Home", icon: Home, side: "left" },
  { href: "/feed", label: "Chat", icon: MessageCircle, side: "left" },
  { href: "/live", label: "Live", icon: Radio, side: "right" },
  { href: "/memories", label: "Albums", icon: Clapperboard, side: "right" },
  { href: "/more", label: "More", icon: Menu, side: "right" },
] as const;

function DeskNav({ base, split, active, panels, toolsOpen, onTools, onJump, showSwap, swapped, onSwap }: { base: string; split: boolean; active: number; panels: DeskPanels; toolsOpen: boolean; onTools: () => void; onJump: (href: string) => void; showSwap: boolean; swapped: boolean; onSwap: () => void }) {
  return (
    <nav className={cn("desk-nav", toolsOpen && "is-open", showSwap && "has-swap")} aria-label="Wedding">
      <button
        type="button"
        data-app-mark=""
        className="desk-nav-mark"
        aria-label={toolsOpen ? "Hide wedding tools" : "Show wedding tools"}
        aria-expanded={toolsOpen}
        aria-controls="wc-desk-tools"
        onClick={onTools}
      >
        <Mark className="size-7" />
      </button>
      <Link to="/" className="desk-nav-exit" aria-label="Back to Landing Page" title="Back to Landing Page">
        <ArrowLeft className="size-4" aria-hidden />
      </Link>
      <div className="desk-nav-pages">
      {deskItems.map((item) => {
        const index = swipeSections.indexOf(item.href);
        const on = split ? (item.side === "left" ? panels.left === index : panels.right === index) : active === index;
        return (
          <Fragment key={item.label}>
          <Link
            to={item.href === "" ? "/w/$slug" : (`/w/$slug${item.href}` as "/w/$slug")}
            params={{ slug: base.replace("/w/", "") }}
            aria-current={on ? "page" : undefined}
            activeOptions={{ exact: true }}
            className={on ? "is-on" : undefined}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              onJump(item.href);
            }}
            onClick={(event) => {
              if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              if (event.detail === 0) onJump(item.href);
            }}
          >
            <item.icon className="size-4" aria-hidden />
            {item.label}
          </Link>
          {showSwap && item.href === "/feed" ? (
            <button
              type="button"
              className="desk-swap"
              aria-pressed={swapped}
              aria-label="Swap Chat and Live positions"
              title="Swap Chat and Live positions"
              onClick={onSwap}
            >
              <ArrowLeftRight className="size-4" aria-hidden />
            </button>
          ) : null}
          </Fragment>
        );
      })}
      </div>
    </nav>
  );
}

function MobileLink({ base, href, label, icon: Icon, path, onJump }: { base: string; href: string; label: string; icon: typeof Home; path: string; onJump: (href: string) => void }) {
  const to = `${base}${href}`;
  const on = href === "" ? path === base || path === `${base}/` : path.startsWith(to);
  return (
    <Link
      to={href === "" ? "/w/$slug" : (`/w/$slug${href}` as "/w/$slug")}
      params={{ slug: base.replace("/w/", "") }}
      aria-current={on ? "page" : undefined}
      activeOptions={{ exact: true }}
      className={cn("flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[11px] leading-none", on ? "font-medium text-maroon" : "font-normal text-ink")}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        onJump(href);
      }}
      onClick={(event) => {
        event.preventDefault();
        if (event.detail === 0) onJump(href);
      }}
    >
      <span className={cn("flex size-8 items-center justify-center rounded-full", on && "bg-maroon/15")}>
        <Icon className="size-[18px]" aria-hidden />
      </span>
      {label}
    </Link>
  );
}
