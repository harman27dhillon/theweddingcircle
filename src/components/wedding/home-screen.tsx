import { useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { usePageEntrance } from "@/components/wedding/living";
import { CoupleScene } from "@/components/wedding/characters";
import { PersonName } from "@/components/wedding/marks";
import { useWedding } from "@/components/wedding/context";
import { attendingCount, compressImage, coupleTitle, googleMapsLink, isCohost, isSampleCircle, longDate, rsvpBuckets, weddingCountdown } from "@/lib/wedding/format";
import { featuredCeremony } from "@/lib/wedding/ceremony-priority";
import { PHOTO_ACCEPT, prepareUpload } from "@/lib/wedding/media";
import { detectCulture, type CultureMatch } from "@/lib/wedding/culture";
import { CoverVisual } from "@/components/wedding/themes";
import { cardThemeOf, themeUsesCeremonyCovers } from "@/lib/wedding/card-themes";
import { frameForTheme } from "@/lib/wedding/bar-layout";
import { ceremonyCoverFor } from "@/lib/wedding/ceremony-covers";
import { resolveLibrarySrc, useLibrary, usePublicSampleCover } from "@/lib/wedding/library";
import { BUILTIN_ASSETS } from "@/lib/wedding/library-catalog";
import { useWeddingStore } from "@/lib/wedding/store";
import { useClassicRegistry } from "@/lib/wedding/classic-registry";
import { Button, Clip, useMediaUrl } from "@/components/wedding/ui";

const INVITE_COVERS = [
  { id: "pastel-garden", label: "Pastel floral garden", src: "/covers/pastel-garden.svg" },
  { id: "ivory-gold", label: "Ivory and champagne gold", src: "/covers/ivory-gold.svg" },
  { id: "dusty-rose", label: "Dusty rose flowers", src: "/covers/dusty-rose.svg" },
  { id: "maroon-gold", label: "Elegant maroon and gold", src: "/covers/maroon-gold.svg" },
  { id: "sage", label: "Sage green botanical", src: "/covers/sage.svg" },
  { id: "royal", label: "Royal Indian motifs", src: "/covers/royal.svg" },
  { id: "cream-gold", label: "Minimal cream and gold", src: "/covers/cream-gold.svg" },
  { id: "sunset", label: "Romantic sunset florals", src: "/covers/sunset.svg" },
  { id: "peach", label: "Soft peach and blush", src: "/covers/peach.svg" },
  { id: "emerald", label: "Deep emerald and gold", src: "/covers/emerald.svg" },
] as const;

const CLASSIC_COVER = "/card-themes/classic-default-cover.jpg";

function CeremonyPhoto({ src }: { src: string }) {
  const { url } = useMediaUrl(src);
  if (!url) return null;
  return <img src={url} alt="" className="invite-event-photo" />;
}
const CLASSIC_FLORA = {
  tl: "/flora/classic-default-floral-top-left.webp?v=2",
  tr: "/flora/classic-default-floral-top-right.webp?v=2",
  bottom: "/flora/classic-default-floral-bottom.webp?v=2",
} as const;

function fileFromDataUrl(src: string) {
  const [head, body] = src.split(",");
  const mime = /data:([^;,]+)/.exec(head || "")?.[1] || "image/jpeg";
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], "cover.jpg", { type: mime });
}

function isPlaceholderCover(src: string) {
  const value = src.trim();
  return !value || value.startsWith("theme:") || value.endsWith(".svg");
}

export function HomeScreen() {
  const wedding = useWedding();
  const setTheme = useWeddingStore((s) => s.setTheme);
  const viewer = useWeddingStore((s) => s.viewer);
  const announcement = wedding.posts.find((p) => p.kind === "announcement");
  const attending = attendingCount(wedding.guests);
  const joined = wedding.guests.filter((g) => g.joined && !g.blocked).length;
  const buckets = rsvpBuckets(wedding.guests);
  const homeVideos = (wedding.beforeNotes ?? []).filter((item) => item.kind === "video" && item.onHome && item.video);
  const [culture, setCulture] = useState<CultureMatch | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState(wedding.cover);
  const [uploading, setUploading] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const [draftFocus, setDraftFocus] = useState(50);
  const library = useLibrary();
  const catalogCovers = (library.ready && !library.failed
    ? library.assets
    : BUILTIN_ASSETS.map((item) => ({ ...item, active: true }))
  ).filter((item) => item.active && item.category !== "Sample art" && item.category !== "Backgrounds");

  useEffect(() => {
    if (!wedding.illustrated) return;
    let live = true;
    void detectCulture()
      .then((match) => {
        if (live) setCulture(match);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [wedding.illustrated]);

  const mayTheme = viewer.role === "host" || isCohost(wedding, viewer);
  const sampleCover = usePublicSampleCover();
  const coverSrc = isSampleCircle(wedding) ? sampleCover || "" : wedding.cover;
  const showDrawing = !isSampleCircle(wedding) && wedding.illustrated && (!coverSrc || coverSrc.endsWith(".svg") || coverSrc.startsWith("theme:"));
  const theme = cardThemeOf(wedding.cardTheme);
  const classicScene =
    theme.id === "classic-default" && !wedding.coverVideo && isPlaceholderCover(coverSrc);
  const sceneCover = Boolean(theme.pageSoft && theme.art && !wedding.coverVideo && isPlaceholderCover(coverSrc));
  const sceneFrame = sceneCover ? frameForTheme(wedding.bar, theme.id, theme.id) : undefined;
  const entrance = usePageEntrance(wedding.id);
  const navigate = useNavigate();
  const blocker = useBlocker({
    withResolver: true,
    enableBeforeUnload: false,
    shouldBlockFn: ({ current, action }) => {
      if (action !== "BACK") return false;
      const path = current.pathname.replace(/\/$/, "") || "/";
      return path === `/w/${wedding.slug}`;
    },
  });

  useEffect(() => {
    if (!mayTheme || isSampleCircle(wedding)) return;
    if (window.location.hash !== "#cover") return;
    setDraft(wedding.cover);
    setDraftFocus(focusPercent(wedding.coverFocus));
    setPicking(true);
  }, [mayTheme, wedding.id, wedding.cover, wedding.coverFocus]);

  useEffect(() => {
    if (blocker.status !== "blocked") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [blocker.status]);

  const ceremonyBackground = useClassicRegistry((s) => s.appearance.ceremonyBackground);
  const ceremonyWell = themeUsesCeremonyCovers(theme.id) ? "classic" : "theme";

  const when = wedding.date ? longDate(wedding.date) : "";
  const where = [wedding.place ?? "", wedding.city ?? ""].map((item) => item.trim()).filter(Boolean);
  const rite = [wedding.religion ?? "", wedding.region ?? ""].map((item) => item.trim()).filter(Boolean).join(" · ");

  const riteKey = inviteRite(wedding.religion ?? "");
  const events = [...wedding.functions].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const featured = featuredCeremony(events, wedding.date, todayKey) ?? events[0];
  const restEvents = events.filter((item) => item.id !== featured?.id);
  const ceremonyItem = (item: (typeof events)[number]) => {
    const query = [item.venue, item.address, wedding.city].filter((part) => part?.trim()).join(", ");
    const map = query ? `https://maps.google.com/?q=${encodeURIComponent(query)}` : "";
    const cover = ceremonyCoverFor(item, theme.id);
    return (
      <li key={item.id} className={item.id === featured?.id ? `invite-event invite-event-next${cover ? " has-ceremony-cover" : ""}` : `invite-event${cover ? " has-ceremony-cover" : ""}`}>
        {cover ? <CeremonyPhoto src={cover} /> : null}
        {cover ? <span className="invite-event-veil" aria-hidden="true" /> : null}
        <div className="invite-event-copy">
        <p className="invite-mark">{item.id === featured?.id ? "Next" : weekDate(item.date)}</p>
        <h3 className="mt-1 font-serif text-2xl">{item.name}</h3>
        <p className="mt-1 text-sm">
          {item.date ? weekDate(item.date) : ""}
          {item.time ? ` · ${item.time}` : ""}
          {item.endTime ? `–${item.endTime}` : ""}
        </p>
        {item.venue?.trim() ? <p className="mt-1 text-sm">{item.venue.trim()}</p> : null}
        {item.address?.trim() ? <p className="text-sm text-muted">{item.address.trim()}</p> : null}
        {item.dress?.trim() ? <p className="mt-1 text-sm">Dress · {item.dress.trim()}</p> : null}
        {item.note?.trim() ? <p className="mt-1 text-sm text-muted">{item.note.trim()}</p> : null}
        {googleMapsLink(item.mapsUrl ?? "") || map ? (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {googleMapsLink(item.mapsUrl ?? "") ? (
              <a href={googleMapsLink(item.mapsUrl ?? "")} className="inline-flex min-h-11 items-center text-maroon" target="_blank" rel="noopener noreferrer">
                Open in Google Maps
              </a>
            ) : (
              <a href={map} className="inline-flex min-h-11 items-center text-maroon" target="_blank" rel="noopener noreferrer">
                Directions
              </a>
            )}
          </div>
        ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className={entrance} data-rite={riteKey}>
      <article
        className={`invite-sheet home-wave${ceremonyBackground?.src ? " has-ceremony-image" : ""}`}
        data-ceremony-well={ceremonyWell}
        style={ceremonyBackground?.src ? { ["--ceremony-bg" as string]: `url("${ceremonyBackground.src}")` } : undefined}
      >
        <header
          className={classicScene ? "invite-cover glass-panel is-classic-scene" : sceneCover ? "invite-cover glass-panel is-scene-cover" : "invite-cover glass-panel"}
          style={{
            ["--cover-focus" as string]: wedding.coverFocus || "center 42%",
            ["--scene-focus" as string]: theme.artPosition || "center",
            ["--scene-focus-phone" as string]: theme.mobileArtPosition || theme.artPosition || "center",
          }}
        >
          {wedding.coverVideo ? (
            <Clip src={wedding.coverVideo} className="invite-blur" autoPlay muted loop controls={false} />
          ) : classicScene ? (
            <img src={CLASSIC_COVER} alt="" className="invite-photo" />
          ) : sceneCover ? (
            <img
              src={theme.art}
              alt=""
              className="invite-photo"
              style={sceneFrame ? {
                objectPosition: `${sceneFrame.x}% ${sceneFrame.y}%`,
                transform: sceneFrame.zoom > 1 ? `scale(${sceneFrame.zoom})` : undefined,
                transformOrigin: `${sceneFrame.x}% ${sceneFrame.y}%`,
              } : undefined}
            />
          ) : coverSrc && !showDrawing ? (
            <CoverVisual src={coverSrc} alt="" className="invite-blur" priority />
          ) : showDrawing ? (
            <CoupleScene className="invite-blur" look={culture?.rite ? culture.look : "plain"} />
          ) : (
            <div className="invite-blur invite-paper" />
          )}
          {classicScene ? (
            <>
              <img src={CLASSIC_FLORA.tl} alt="" className="classic-flora classic-flora-tl" />
              <img src={CLASSIC_FLORA.tr} alt="" className="classic-flora classic-flora-tr" />
              <img src={CLASSIC_FLORA.bottom} alt="" className="classic-flora classic-flora-bottom" />
            </>
          ) : null}
          <div className="invite-mist" />
          <div className="invite-copy">
            <p className="invite-kicker">{rite || "Together with their families"}</p>
            {wedding.bride?.trim() ? <h1 className="invite-name">{wedding.bride.trim()}</h1> : null}
            {wedding.bride?.trim() && wedding.groom?.trim() ? <p className="invite-ampersand">&</p> : null}
            {wedding.groom?.trim() ? <h1 className="invite-name">{wedding.groom.trim()}</h1> : null}
            {!wedding.bride?.trim() && !wedding.groom?.trim() ? <h1 className="invite-name">{coupleTitle(wedding)}</h1> : null}
            <div className="invite-rule" aria-hidden="true" />
            {when || where.length > 0 ? (
              <p className="invite-when">
                {when}
                {when && where.length > 0 ? " · " : ""}
                {where.join(", ")}
              </p>
            ) : null}
            {(wedding.story ?? "").trim() ? <p className="invite-message">{wedding.story.trim()}</p> : null}
            {wedding.invitation?.hashtag?.trim() ? <p className="invite-kicker">{wedding.invitation.hashtag.trim()}</p> : null}
            <WeddingCountdown date={wedding.date} />
          </div>
        </header>

        {(events.length > 0) ? (
          <section className="invite-block glass-panel invite-ceremonies">
            <div className="invite-lead">
              {featured ? (
              <ol className="invite-lead-list">
                {ceremonyItem(featured)}
              </ol>
              ) : null}
            </div>
            {restEvents.length > 0 ? (
              <div className="invite-rest">
                <h2 className="sr-only">More ceremonies</h2>
                <ol className="invite-rest-list mt-5 flex flex-col md:mt-0">
                  {restEvents.map((item) => ceremonyItem(item))}
                </ol>
              </div>
            ) : null}
          </section>
        ) : null}

        {announcement ? (
          <p className="text-center text-sm">
            <span className="invite-mark">From the family</span>
            <span className="mt-2 block text-base">{announcement.text}</span>
          </p>
        ) : null}
        {picking && mayTheme ? (
            <div className="cover-picker" data-noswipe="">
              <div className="cover-preview" style={{ ["--cover-focus" as string]: `center ${draftFocus}%` }}>
                {draft ? <img src={draft} alt="" className="invite-blur" /> : <div className="invite-blur invite-paper" />}
                <div className="invite-mist" />
                <div className="invite-copy">
                  {wedding.bride?.trim() ? <p className="invite-name">{wedding.bride.trim()}</p> : null}
                  {wedding.bride?.trim() && wedding.groom?.trim() ? <p className="invite-ampersand">&</p> : null}
                  {wedding.groom?.trim() ? <p className="invite-name">{wedding.groom.trim()}</p> : null}
                </div>
              </div>
              <ul className="cover-grid">
                {INVITE_COVERS.map((cover) => (
                  <li key={cover.id}>
                    <button type="button" aria-pressed={draft === cover.src} onClick={() => setDraft(cover.src)}>
                      <img src={cover.src} alt="" />
                      <span>{cover.label}</span>
                      {wedding.cover === cover.src ? <span className="cover-current">Current</span> : null}
                    </button>
                  </li>
                ))}
                {catalogCovers.map((cover) => (
                  <li key={cover.id}>
                    <button type="button" aria-pressed={draft === cover.path} onClick={() => setDraft(cover.path)}>
                      <img src={resolveLibrarySrc(cover.path, library.assets)} alt="" />
                      <span>{cover.name}</span>
                      {wedding.cover === cover.path ? <span className="cover-current">Current</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
              <label className="cover-upload">
                {uploading ? uploadLabel || "Preparing photo" : "Upload your own photo"}
                <input
                  type="file"
                  accept={PHOTO_ACCEPT}
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setUploading(true);
                    setUploadLabel("Preparing photo");
                    void compressImage(file, (percent) => setUploadLabel(`Preparing ${percent}%`))
                      .then((src) => {
                        setDraft(src);
                        setDraftFocus(42);
                      })
                      .catch(() => toast("That photo could not be used."))
                      .finally(() => setUploading(false));
                  }}
                />
              </label>
              {draft.startsWith("data:image/") ? (
                <label className="cover-position">
                  Move the photo
                  <input type="range" min={0} max={100} value={draftFocus} onChange={(event) => setDraftFocus(Number(event.target.value))} />
                </label>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={!draft || uploading}
                  onClick={() => {
                    void (async () => {
                      let src = draft;
                      const focus = draft.startsWith("data:image/") ? `center ${draftFocus}%` : "center 42%";
                      if (draft.startsWith("data:image/")) {
                        setUploading(true);
                        setUploadLabel("Preparing");
                        try {
                          const prepared = await prepareUpload(fileFromDataUrl(draft), setUploadLabel, wedding.slug, "cover");
                          src = prepared.src;
                        } catch (error) {
                          toast(error instanceof Error ? error.message : "That cover could not be saved.");
                          return;
                        } finally {
                          setUploading(false);
                        }
                      }
                      setTheme(wedding.id, src, focus);
                      const saved = useWeddingStore.getState().weddings.find((item) => item.id === wedding.id)?.cover;
                      if (saved !== src) {
                        toast("The cover could not be saved.");
                        return;
                      }
                      setDraft(src);
                      setPicking(false);
                      toast("Cover saved.");
                    })();
                  }}
                >
                  Apply cover
                </Button>
                <Button
                  type="button"
                  variant="line"
                  onClick={() => {
                    setDraft(wedding.cover);
                    setPicking(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

        {homeVideos.length > 0 ? (
          <section className="invite-block glass-panel">
            <h2 className="text-center font-serif text-2xl">Before the day</h2>
            <ul className="mt-3 flex flex-col gap-3">
              {homeVideos.map((item) => (
                <li key={item.id}>
                  <Clip src={item.video || ""} className="h-auto w-full bg-ink object-contain" />
                  <p className="mt-2 text-sm">
                    <PersonName wedding={wedding} name={item.author} />
                    {item.text ? <span className="text-muted"> · {item.text}</span> : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <p className="invite-fine glass-panel">
          {joined} in the circle · {attending} attending
          {wedding.hostName?.trim() ? ` · ${wedding.hostName.trim()}` : ""}
          {wedding.contactPhone?.trim() ? ` · ${wedding.contactPhone.trim()}` : ""}
          {wedding.contactEmail?.trim() ? ` · ${wedding.contactEmail.trim()}` : ""}
          {` · ${buckets.accepted} accepted`}
        </p>
      </article>
      {blocker.status === "blocked" && typeof document !== "undefined"
        ? createPortal(
            <div className="leave-wedding" role="dialog" aria-modal="true" aria-labelledby="leave-wedding-title">
              <div className="leave-wedding-card">
                <h2 id="leave-wedding-title" className="font-serif text-2xl">Leave this wedding?</h2>
                <p className="mt-2 text-sm text-muted">Going back returns to the Wedding Circle landing page. You stay signed in, and this wedding stays yours.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" className="min-h-11" onClick={() => blocker.reset()}>Stay</Button>
                  <Button
                    type="button"
                    variant="line"
                    className="min-h-11"
                    onClick={() => {
                      blocker.reset();
                      window.setTimeout(() => {
                        void navigate({ to: "/", replace: true });
                      }, 60);
                    }}
                  >
                    Exit to landing page
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function focusPercent(value?: string) {
  const match = value?.match(/(\d+)%/);
  return match ? Number(match[1]) : 42;
}

function inviteRite(religion: string) {
  const value = religion.toLowerCase();
  if (value.includes("sikh")) return "sikh";
  if (value.includes("muslim") || value.includes("islam")) return "muslim";
  if (value.includes("christian")) return "christian";
  if (value.includes("hindu") || value.includes("jain")) return "hindu";
  return "neutral";
}

function weekDate(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date(year, month - 1, day));
}

function WeddingCountdown({ date }: { date: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      window.clearInterval(timer);
      timer = 0;
      if (document.hidden) return;
      const stamp = Date.now();
      setNow(stamp);
      const parts = weddingCountdown(date, stamp);
      if (!parts || parts.done) return;
      timer = window.setInterval(() => setNow(Date.now()), 1000);
    };
    arm();
    document.addEventListener("visibilitychange", arm);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", arm);
    };
  }, [date]);
  const parts = now === null ? null : weddingCountdown(date, now);
  if (!parts) return null;
  if (parts.done) {
    return (
      <p className="invite-countdown-here font-serif text-lg" aria-live="polite">
        The Wedding Day Is Here!
      </p>
    );
  }
  const units = [
    ["Days", String(parts.days)],
    ["Hours", String(parts.hours).padStart(2, "0")],
    ["Minutes", String(parts.minutes).padStart(2, "0")],
    ["Seconds", String(parts.seconds).padStart(2, "0")],
  ] as const;
  return (
    <div className="invite-countdown" role="timer" aria-label={`${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes, ${parts.seconds} seconds`}>
      {units.map(([label, value]) => (
        <span key={label}>
          <strong>{value}</strong>
          <small>{label}</small>
        </span>
      ))}
    </div>
  );
}
