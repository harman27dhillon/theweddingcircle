import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useAppRuntime } from "@/lib/developer/runtime";
import { useWedding } from "@/components/wedding/context";
import { Button, Clip, Empty, fieldClass, Photo, PickList, QrImage, Screen, useMediaUrl } from "@/components/wedding/ui";
import { PersonName } from "@/components/wedding/marks";
import { VENDOR_CATEGORIES, VENDORS } from "@/lib/wedding/catalog";
import { canAnnounce, canHost, canManage, canPlan, codesOf, compressImage, confirmWeddingName, coupleTitle, googleMapsLink, isCircleOwner, longDate } from "@/lib/wedding/format";
import { circleKey, forgetCircleKey, rememberDeletedSlug } from "@/lib/wedding/circle-key";
import { eraseCircle, pushCircle, rememberKept } from "@/lib/wedding/publish";
import { circleMedia } from "@/lib/wedding/media";
import { useWeddingStore, vendorById } from "@/lib/wedding/store";
import { SEED_ID } from "@/lib/wedding/seed";
import { useLibrary } from "@/lib/wedding/library";
import { LibraryPhoto } from "@/components/wedding/library-photo";
import { usePageEntrance } from "@/components/wedding/living";
import { Bell, BookOpen, CalendarDays, ChevronDown, ChevronRight, ClipboardList, Crown, ImageIcon, Lock, MapPin, Palette, QrCode, Radio, Settings, Shield, Sparkles, Store, Type, Users } from "lucide-react";
import { ThemePicker } from "@/components/wedding/wedding-card";
import { TypographyPanel } from "@/components/wedding/typography-panel";
import { CeremonyInviteButton } from "@/components/wedding/ceremony-invite";
import { CoupleAccessPanel } from "@/components/wedding/couple-access-panel";
import { WeddingBarPanel } from "@/components/wedding/wedding-bar-panel";
import type { FunctionEvent, Privacy } from "@/lib/wedding/types";
import { CEREMONY_PICTURE_LABELS, CEREMONY_PICTURE_ORDER, ceremonyCoverFor, matchCeremonyName } from "@/lib/wedding/ceremony-covers";
import { PHOTO_ACCEPT } from "@/lib/wedding/media";

const moreTiles = [
  { href: "/functions", label: "Ceremonies", icon: CalendarDays },
  { href: "/announcements", label: "Notices", icon: Bell },
  { href: "/places", label: "Places", icon: MapPin },
  { href: "/services", label: "Services", icon: Store },
  { href: "/checklist", label: "Checklist", icon: ClipboardList },
  { href: "/planner", label: "Planner", icon: BookOpen },
  { href: "/highlights", label: "Highlights", icon: Sparkles },
  { href: "/invite", label: "Invite", icon: QrCode },
  { href: "/settings", label: "Privacy", icon: Lock },
] as const;

export function MoreScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const entrance = usePageEntrance(`${wedding.id}-more`);
  const accountId = useWeddingStore((s) => s.account?.id);
  const verified = Boolean(accountId && wedding.ownerId && wedding.ownerId === accountId);
  const owner = isCircleOwner(wedding);
  const manager = (canManage(wedding, viewer) || verified) && !wedding.ownerReview;
  const [hostOpen, setHostOpen] = useState(false);
  const guestOnly = viewer.role === "guest" && !viewer.coded;
  const tiles = guestOnly ? moreTiles.filter((item) => item.href !== "/settings") : moreTiles;
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 py-4 md:px-8 md:py-8 lg:max-w-6xl">
      <div className={`more-stage flex min-h-0 flex-1 flex-col ${entrance}`}>
        {wedding.ownerReview && !manager ? (
          <p className="mb-4 text-sm text-muted">This wedding's host record needs a review. Host tools stay off until the original creator can be verified.</p>
        ) : null}
        {manager ? (
          <button
            type="button"
            className="host-launch glass-panel mb-4 flex aspect-[3/1] w-full items-center justify-center gap-3 rounded-2xl border border-maroon/35 px-4 text-maroon"
            aria-expanded={hostOpen}
            draggable={false}
            onClick={() => setHostOpen((open) => !open)}
          >
            <Crown className="size-6 shrink-0" aria-hidden />
            <span className="font-serif text-2xl">Host Control</span>
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </button>
        ) : null}
        {manager && hostOpen ? <HostControl owner={owner} /> : null}
        <header className="more-heading mb-4">
          <h1 className="font-serif text-3xl text-ink md:text-4xl">More</h1>
        </header>
        <ul className="more-tiles grid grid-cols-2 gap-3 min-[380px]:grid-cols-3">
          {tiles.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  to={`/w/$slug${item.href}` as "/w/$slug"}
                  params={{ slug: wedding.slug }}
                  className="glass-panel flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center"
                  draggable={false}
                  preload="intent"
                >
                  <Icon className="size-6" aria-hidden />
                  <span className="text-sm font-medium leading-tight">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function Fold({ id, title, icon: Icon, open, onToggle, children, danger = false }: { id: string; title: string; icon: typeof Crown; open: boolean; onToggle: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <section className={`host-fold${open ? " is-open" : ""}${danger ? " is-danger" : ""}`} data-host-section={id}>
      <h3 className="m-0">
        <button type="button" className="host-fold-toggle" aria-expanded={open} aria-controls={`host-panel-${id}`} onClick={onToggle}>
          <Icon className="size-6 shrink-0" aria-hidden />
          <span>{title}</span>
          <ChevronDown className="host-fold-chevron size-4 shrink-0" aria-hidden />
        </button>
      </h3>
      <div className="host-fold-panel" id={`host-panel-${id}`} hidden={!open} aria-hidden={!open} inert={open ? undefined : true}>
        {open ? <div className="host-fold-inner">{children}</div> : null}
      </div>
    </section>
  );
}

function HostControl({ owner }: { owner: boolean }) {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const accountId = useWeddingStore((s) => s.account?.id);
  const tools = canManage(wedding, viewer) || Boolean(accountId && wedding.ownerId && wedding.ownerId === accountId);
  const setCohosts = useWeddingStore((s) => s.setCohosts);
  const saveDetails = useWeddingStore((s) => s.saveDetails);
  const updatePrivacy = useWeddingStore((s) => s.updatePrivacy);
  const setCircleDisabled = useWeddingStore((s) => s.setCircleDisabled);
  const deleteWedding = useWeddingStore((s) => s.deleteWedding);
  const navigate = useNavigate();
  const title = coupleTitle(wedding);
  const [open, setOpen] = useState("settings");
  const [details, setDetails] = useState({
    bride: wedding.bride,
    groom: wedding.groom,
    date: wedding.date,
    city: wedding.city,
    place: wedding.place,
    story: wedding.story,
    religion: wedding.religion,
    region: wedding.region,
    weddingType: wedding.weddingType ?? "",
  });
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState("");
  const [mediaChoice, setMediaChoice] = useState<"keep" | "delete" | "">("");
  const [working, setWorking] = useState(false);
  function toggle(id: string) {
    setOpen((current) => (current === id ? "" : id));
  }
  async function changeCohost(name: string, on: boolean) {
    const current = wedding.cohostNames ?? [];
    if (!on && current.length >= 2) {
      toast("Two co-hosts already. Remove one first.");
      return;
    }
    if (on && !window.confirm(`Remove ${name} as a co-host? They lose host tools on this wedding.`)) return;
    const next = on ? current.filter((item) => item !== name) : [...current, name];
    const result = await setCohosts(wedding.id, next);
    if (result === "ok") toast(on ? `${name} is no longer a co-host.` : `${name} can help host.`);
    else toast(result === "failed" ? "That co-host change could not be saved. Try again." : "Only the host can change co-hosts.");
  }
  function closeDelete() {
    if (working) return;
    setDeleteStep(0);
  }
  useEffect(() => {
    if (!deleteStep) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDelete();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteStep, working]);
  async function removeWedding() {
    if (working) return;
    const current = useWeddingStore.getState().weddings.find((item) => item.id === wedding.id) ?? wedding;
    if (!isCircleOwner(current)) {
      toast("Only the host can delete this wedding. Nothing was removed.");
      return;
    }
    if (!confirmWeddingName(typed, title) || (mediaChoice !== "keep" && mediaChoice !== "delete")) return;
    setWorking(true);
    try {
      const erased = await eraseCircle(current, mediaChoice === "keep");
      if (erased.status === "offline" || erased.status === "denied") {
        toast(
          erased.status === "denied"
            ? "Only the host can delete this wedding. Nothing was removed."
            : erased.message || "The wedding could not be deleted just now. Nothing was removed.",
        );
        return;
      }
      const removed = deleteWedding(current.id);
      if (!removed) {
        toast("The wedding is still here. It was not removed from this phone.");
        return;
      }
      rememberDeletedSlug(current.slug);
      forgetCircleKey(current.slug);
      void import("@/lib/wedding/offline-sync").then((mod) => mod.dropWeddingCache(current.id));
      if (mediaChoice === "keep") {
        const sources = [
          ...circleMedia(wedding).map((item) => item.url),
          ...wedding.posts.flatMap((post) => [...post.images, ...(post.videos ?? []).map((clip) => clip.src), post.videoLabel ?? ""]),
          ...(wedding.beforeNotes ?? []).flatMap((note) => [...note.images, note.video ?? ""]),
        ].filter((src) => src.startsWith("http") || src.startsWith("gp:") || src.startsWith("r2:") || src.startsWith("idb:"));
        rememberKept(title, sources);
      }
      toast(erased.status === "partial"
        ? "The wedding is deleted. Some stored files may still be cleaning up. Files already in Google Drive stay there and were not deleted."
        : mediaChoice === "keep"
          ? "The wedding is deleted. Kept photos stay on this phone. Files already in Google Drive stay there and were not deleted."
          : "The wedding is deleted. Files already in Google Drive stay there and were not deleted. New files in private storage were not removed from the bucket by this action.");
      void navigate({ to: "/" });
    } catch {
      toast("The wedding could not be deleted just now. Nothing was removed.");
    } finally {
      setWorking(false);
    }
  }
  const readyToDelete = confirmWeddingName(typed, title) && (mediaChoice === "keep" || mediaChoice === "delete") && !working;
  return (
    <section className="host-control mb-5 rounded-card border border-maroon/40 bg-card p-4">
      <h2 className="font-serif text-2xl">Host Control</h2>
      <div className="host-folds mt-3">
        <Fold id="settings" title="Wedding Settings" icon={Settings} open={open === "settings"} onToggle={() => toggle("settings")}>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const saved = saveDetails(wedding.id, details);
              toast(saved ? "Wedding details saved." : "Add both names and a date.");
            }}
          >
            <input className={fieldClass} aria-label="Bride" value={details.bride} onChange={(event) => setDetails((current) => ({ ...current, bride: event.target.value }))} />
            <input className={fieldClass} aria-label="Groom" value={details.groom} onChange={(event) => setDetails((current) => ({ ...current, groom: event.target.value }))} />
            <input className={fieldClass} aria-label="Date" type="date" value={details.date} onChange={(event) => setDetails((current) => ({ ...current, date: event.target.value }))} />
            <input className={fieldClass} aria-label="City" value={details.city} onChange={(event) => setDetails((current) => ({ ...current, city: event.target.value }))} />
            <input className={fieldClass} aria-label="Place" value={details.place} onChange={(event) => setDetails((current) => ({ ...current, place: event.target.value }))} />
            <input className={fieldClass} aria-label="Tradition" value={details.religion} onChange={(event) => setDetails((current) => ({ ...current, religion: event.target.value }))} />
            <input className={fieldClass} aria-label="Region" value={details.region} onChange={(event) => setDetails((current) => ({ ...current, region: event.target.value }))} />
            <input className={fieldClass} aria-label="Wedding type" value={details.weddingType} onChange={(event) => setDetails((current) => ({ ...current, weddingType: event.target.value }))} />
            <textarea className={fieldClass} aria-label="Story" rows={2} value={details.story} onChange={(event) => setDetails((current) => ({ ...current, story: event.target.value }))} />
            <Button type="submit">Save details</Button>
          </form>
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <Link to="/w/$slug" params={{ slug: wedding.slug }} hash="cover" className="min-h-11 text-maroon">Invitation cover</Link>
            <Link to="/w/$slug/functions" params={{ slug: wedding.slug }} className="min-h-11 text-maroon">Ceremonies</Link>
          </div>
        </Fold>
        <Fold id="couple" title="Bride & Groom Access" icon={Users} open={open === "couple"} onToggle={() => toggle("couple")}>
          {tools ? <CoupleAccessPanel wedding={wedding} /> : <p className="text-sm text-muted">Only a host can assign the bride and groom.</p>}
        </Fold>
        <Fold id="theme" title="Theme & Appearance" icon={Palette} open={open === "theme"} onToggle={() => toggle("theme")}>
          <ThemePicker wedding={wedding} />
        </Fold>
        <Fold id="fonts" title="Typography & Fonts" icon={Type} open={open === "fonts"} onToggle={() => toggle("fonts")}>
          <TypographyPanel wedding={wedding} />
        </Fold>
        <Fold id="bar" title="Wedding Bar" icon={ImageIcon} open={open === "bar"} onToggle={() => toggle("bar")}>
          {tools ? <WeddingBarPanel wedding={wedding} /> : <p className="text-sm text-muted">Only a host or co-host can change the wedding bar.</p>}
        </Fold>
        <Fold id="guests" title="Guest & Family Management" icon={Users} open={open === "guests"} onToggle={() => toggle("guests")}>
          {owner ? (
            <div>
              <h3 className="font-medium">Co-hosts</h3>
              <p className="mt-1 text-sm text-muted">Choose up to two people who already joined. Only you can assign or revoke them.</p>
              <ul className="mt-2 flex flex-col">
                {wedding.guests.filter((guest) => guest.name.trim().toLowerCase() !== wedding.hostName.trim().toLowerCase()).map((guest) => {
                  const on = (wedding.cohostNames ?? []).some((name) => name.toLowerCase() === guest.name.toLowerCase());
                  return (
                    <li key={guest.id}>
                      <button type="button" className="min-h-11 text-left text-sm" onClick={() => void changeCohost(guest.name, on)}>
                        {on ? "Co-host · " : "Make co-host · "}
                        {guest.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted">The host chooses co-hosts.</p>
          )}
          <div className="mt-3 flex flex-col gap-2 text-sm">
            <Link to="/w/$slug/guests" params={{ slug: wedding.slug }} className="min-h-11 text-maroon">Guest list</Link>
            <Link to="/w/$slug/invite" params={{ slug: wedding.slug }} className="min-h-11 text-maroon">Invitation and entry codes</Link>
          </div>
        </Fold>
        <Fold id="live" title="Live & Media Controls" icon={Radio} open={open === "live"} onToggle={() => toggle("live")}>
          <p className="text-sm text-muted">The YouTube link and camera stay on the live screen so this page does not duplicate that studio.</p>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <Link to="/w/$slug/live" params={{ slug: wedding.slug }} className="min-h-11 text-maroon">Live stream</Link>
            <Link to="/w/$slug/memories" params={{ slug: wedding.slug }} className="min-h-11 text-maroon">Album</Link>
          </div>
        </Fold>
        <Fold id="privacy" title="Privacy & Permissions" icon={Shield} open={open === "privacy"} onToggle={() => toggle("privacy")}>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="line" onClick={() => updatePrivacy(wedding.id, { ...wedding.privacy, join: wedding.privacy.join === "link" ? "approve" : "link" })}>
              {wedding.privacy.join === "link" ? "Require approval" : "Allow the link"}
            </Button>
            <Button type="button" variant="line" onClick={() => updatePrivacy(wedding.id, { ...wedding.privacy, download: !wedding.privacy.download })}>
              {wedding.privacy.download ? "Turn downloads off" : "Allow downloads"}
            </Button>
            <Button type="button" variant="line" onClick={() => useWeddingStore.getState().setMemory(wedding.id, !wedding.showMemory)}>
              {wedding.showMemory ? "Leave the memory view" : "Preview after the wedding"}
            </Button>
          </div>
          {owner ? (
            <div className="mt-3">
              <Button type="button" variant="line" onClick={() => { setCircleDisabled(wedding.id, !wedding.disabled); toast(wedding.disabled ? "The circle is open again." : "The circle is paused. Family and guests cannot enter."); }}>
                {wedding.disabled ? "Open the circle" : "Pause the circle"}
              </Button>
            </div>
          ) : null}
          <Link to="/w/$slug/settings" params={{ slug: wedding.slug }} className="mt-3 inline-flex min-h-11 items-center text-sm text-maroon">Family access and ceremony privacy</Link>
        </Fold>
        <Fold id="manage" title="Wedding Management" icon={Crown} open={open === "manage"} onToggle={() => toggle("manage")} danger>
          {owner ? (
            <div>
              <h3 className="font-medium text-maroon">Delete this wedding</h3>
              <p className="mt-1 text-sm text-muted">Deleting removes the wedding details, ceremonies, memberships, feed, and comments. Nothing is removed until the final confirmation.</p>
              <Button type="button" className="mt-3" variant="line" disabled={working} onClick={() => setDeleteStep(1)}>Delete wedding</Button>
            </div>
          ) : (
            <p className="text-sm text-muted">Only the host who created this wedding can delete it.</p>
          )}
        </Fold>
      </div>
      {deleteStep > 0 && typeof document !== "undefined"
        ? createPortal(
            <div className="host-confirm" role="dialog" aria-modal="true" aria-labelledby="delete-step-title" data-delete-step={deleteStep} data-noswipe="">
              <div className="host-confirm-card">
                {deleteStep === 1 ? (
                  <>
                    <h3 id="delete-step-title" className="font-serif text-2xl">Delete {title}?</h3>
                    <p className="mt-2 text-sm text-muted">
                      Deleting {title} is permanent. It can remove the wedding, its ceremonies, memberships, chat, and comments. Photos can be kept on this phone or deleted with it. Nothing is deleted in this step.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="line" onClick={closeDelete}>Cancel</Button>
                      <Button type="button" onClick={() => setDeleteStep(2)}>Continue to Final Confirmation</Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 id="delete-step-title" className="font-serif text-2xl">Final confirmation</h3>
                    <p className="mt-2 text-sm text-muted">
                      This is the last step for {title}. Type that wedding name, choose what happens to photos and videos, then press Delete wedding. Pressing Enter does not delete it. Cancel leaves the wedding unchanged.
                    </p>
                    <label className="mt-3 block text-sm">
                      Type {title}
                      <input
                        className={`${fieldClass} mt-1`}
                        aria-label="Type the wedding name"
                        placeholder={title}
                        value={typed}
                        onChange={(event) => setTyped(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.preventDefault();
                        }}
                      />
                    </label>
                    {typed.trim() && !confirmWeddingName(typed, title) ? (
                      <p className="mt-2 text-sm text-maroon">That does not match {title}. The wedding is still here.</p>
                    ) : null}
                    <div className="mt-3 flex flex-col gap-2 text-sm">
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="radio" name="media-choice" checked={mediaChoice === "keep"} onChange={() => setMediaChoice("keep")} />
                        Keep photos and videos on this phone
                      </label>
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="radio" name="media-choice" checked={mediaChoice === "delete"} onChange={() => setMediaChoice("delete")} />
                        Delete stored photos and videos too
                      </label>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button type="button" variant="line" onClick={closeDelete} disabled={working}>Cancel</Button>
                      <Button type="button" variant="line" disabled={!readyToDelete} onClick={() => void removeWedding()}>
                        {working ? "Deleting the wedding…" : "Delete wedding"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

function CeremonyPreview({ src }: { src: string }) {
  const { url } = useMediaUrl(src);
  if (!url) return null;
  return <img src={url} alt="" className="h-28 w-full rounded-2xl object-cover object-[72%_center]" />;
}

function CeremonyPicture({ draft, onChange }: { draft: FunctionEvent; onChange: (next: FunctionEvent) => void }) {
  const match = matchCeremonyName(draft.name);
  const preview = ceremonyCoverFor(draft, "classic-default");
  const hint = draft.cover
    ? "This ceremony keeps your picture. Changing another ceremony does not replace it."
    : match && "ambiguous" in match
      ? "This name matches more than one ceremony. Choose which picture to use."
      : match
        ? "The name matches a built-in picture."
        : "This name has no special picture, so a quiet wedding picture is used.";
  return (
    <div className="grid gap-2">
      <PickList
        label="Ceremony picture"
        value={draft.coverKind ?? "auto"}
        onChange={(value) => onChange({ ...draft, coverKind: value === "auto" ? undefined : value })}
        options={[
          { value: "auto", label: "Match the ceremony name" },
          ...CEREMONY_PICTURE_ORDER.map((value) => ({ value, label: CEREMONY_PICTURE_LABELS[value] })),
          { value: "none", label: "No default picture" },
        ]}
      />
      <p className="text-sm text-muted">{hint} Default pictures are part of Classic themes. A preset theme keeps its own ceremony look. Your own picture still shows.</p>
      {preview ? <CeremonyPreview src={preview} /> : null}
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line px-3 text-sm">
          Use your own picture
          <input
            className="sr-only"
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              void compressImage(file).then((data) => {
                if (data.length > 350_000) {
                  toast("That picture is too large. Try a smaller one.");
                  return;
                }
                onChange({ ...draft, cover: data });
              }).catch(() => toast("That picture could not be used."));
            }}
          />
        </label>
        {draft.cover ? (
          <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => onChange({ ...draft, cover: undefined })}>
            Restore default picture
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function FunctionsScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const moveFunction = useWeddingStore((s) => s.moveFunction);
  const removeFunction = useWeddingStore((s) => s.removeFunction);
  const host = canManage(wedding, viewer);
  return (
    <Screen title="Functions" lede="Suggestions follow the tradition. The family decides what stays.">
      <ol className="flex flex-col gap-3">
        {wedding.functions.map((f, i) => (
          <li key={f.id} className="rounded-card border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Link to="/w/$slug/function/$fnId" params={{ slug: wedding.slug, fnId: f.id }} className="font-serif text-2xl">
                  {f.name}
                </Link>
                <p className="mt-1 text-sm text-muted">
                  {longDate(f.date)} · <span className="tabular-nums">{f.time}</span> · {f.venue}
                </p>
                <p className="mt-2">{f.note}</p>
                {f.live ? <p className="mt-2 text-sm text-maroon">Live now</p> : null}
              </div>
              {host ? (
                <div className="flex flex-col gap-2">
                  <Button variant="line" onClick={() => moveFunction(wedding.id, f.id, -1)} disabled={i === 0}>
                    Up
                  </Button>
                  <Button variant="line" onClick={() => moveFunction(wedding.id, f.id, 1)} disabled={i === wedding.functions.length - 1}>
                    Down
                  </Button>
                </div>
              ) : null}
            </div>
            {host ? (
              <button
                type="button"
                className="mt-3 text-sm text-muted"
                onClick={() => {
                  if (!window.confirm(`Remove ${f.name}?`)) return;
                  void removeFunction(wedding.id, f.id).then((result: string) => {
                    if (result === "ok" || result === "local") toast("Ceremony removed.");
                    else toast(result === "denied" ? "Only a host or co-host can remove a ceremony." : "That ceremony could not be removed.");
                  });
                }}
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </Screen>
  );
}

export function FunctionScreen({ fnId }: { fnId: string }) {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const saveFunction = useWeddingStore((s) => s.saveFunction);
  const fn = wedding.functions.find((f) => f.id === fnId);
  const posts = wedding.posts.filter((p) => p.functionId === fnId && !p.removed);
  const host = canManage(wedding, viewer);
  const closed = (fn?.access ?? "everyone") === "hosts" && viewer.role === "guest" && !viewer.coded;
  const [draft, setDraft] = useState<FunctionEvent | null>(fn ?? null);
  if (!fn || !draft) {
    return (
      <Screen title="Function">
        <Empty title="That function is not on this wedding" text="It may have been removed." />
      </Screen>
    );
  }
  return (
    <Screen title={fn.name} lede={fn.note}>
      <p className="text-muted">
        {longDate(fn.date)} · <span className="tabular-nums">{fn.time}</span>
      </p>
      <p className="mt-1">{fn.venue}</p>
      {closed ? <p className="mt-3 text-muted">This function is only open to the hosts.</p> : null}
      {host ? (
        <form
          className="mt-5 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const maps = (draft.mapsUrl ?? "").trim();
            if (maps && !googleMapsLink(maps)) {
              toast("Paste a Google Maps link from maps.google.com, google.com/maps, maps.app.goo.gl, or goo.gl/maps.");
              return;
            }
            void saveFunction(wedding.id, { ...draft, mapsUrl: googleMapsLink(maps) || undefined }).then((result: string) => {
              if (result === "ok" || result === "local") toast("Function updated.");
              else if (result === "denied") toast("Only a host or co-host can edit a ceremony.");
              else if (result === "invalid") toast("Add a name, a date, and a start time.");
              else toast("That ceremony could not be saved.");
            });
          }}
        >
          <input className={fieldClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <input className={fieldClass} type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
            <input className={fieldClass} type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} />
          </div>
          <input className={fieldClass} value={draft.venue} placeholder="Venue" onChange={(e) => setDraft({ ...draft, venue: e.target.value })} />
          <input className={fieldClass} value={draft.address ?? ""} placeholder="Address, if you want it on the invitation" onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Google Maps link</span>
            <input className={fieldClass} value={draft.mapsUrl ?? ""} placeholder="https://maps.google.com/..." onChange={(e) => setDraft({ ...draft, mapsUrl: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <input className={fieldClass} type="time" value={draft.endTime ?? ""} aria-label="End time" onChange={(e) => setDraft({ ...draft, endTime: e.target.value })} />
            <input className={fieldClass} value={draft.dress ?? ""} placeholder="Dress code" onChange={(e) => setDraft({ ...draft, dress: e.target.value })} />
          </div>
          <textarea className={fieldClass} rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          <CeremonyPicture draft={draft} onChange={setDraft} />
          <PickList
            label="Who can open this function"
            value={draft.access ?? "everyone"}
            onChange={(value) => setDraft({ ...draft, access: value })}
            options={[
              { value: "everyone", label: "Everyone in the circle" },
              { value: "family", label: "Family threads only" },
              { value: "hosts", label: "Hosts only" },
            ]}
          />
          <Button type="submit">Save</Button>
        </form>
      ) : null}
      {googleMapsLink(fn.mapsUrl ?? "") ? (
        <a className="mt-4 inline-flex min-h-11 items-center text-sm text-maroon" href={googleMapsLink(fn.mapsUrl ?? "")} target="_blank" rel="noopener noreferrer">
          Open in Google Maps
        </a>
      ) : null}
      <div className="mt-6 flex gap-3">
        <Link to="/w/$slug/live" params={{ slug: wedding.slug }} className="text-sm text-maroon">
          {fn.live ? "Watch the live stream" : "Live room"}
        </Link>
        <Link to="/w/$slug/feed" params={{ slug: wedding.slug }} className="text-sm text-maroon">
          Share into the chat
        </Link>
      </div>
      <h2 className="mt-8 font-serif text-2xl">From this function</h2>
      {posts.length === 0 ? (
        <p className="mt-2 text-muted">Nothing filed here yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {posts.map((p) => (
            <li key={p.id} className="rounded-2xl border border-line bg-card p-4">
              <p className="text-sm text-muted">{p.atLabel} · <PersonName wedding={wedding} name={p.author} /></p>
              <p className="mt-1">{p.text}</p>
              {p.images.map((src, index) => (
                <Photo key={src} src={src} alt="" className="mt-3 h-auto w-full rounded-2xl object-contain" />
              ))}
              {(p.videos?.length ? p.videos.map((clip) => clip.src) : p.videoLabel ? [p.videoLabel] : []).map((src) => (
                <Clip key={src} src={src} className="mt-3 h-auto w-full rounded-2xl bg-ink object-contain" />
              ))}
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

export function AnnouncementsScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const addAnnouncement = useWeddingStore((s) => s.addAnnouncement);
  const [text, setText] = useState("");
  const [audience, setAudience] = useState<"Bride" | "Groom" | "Both">("Both");
  const notes = wedding.posts.filter((p) => p.kind === "announcement");
  return (
    <Screen title="Announcements" lede="Official notes. Guests see them on the home and at the top of the chat.">
      {canAnnounce(wedding, viewer) ? (
        <form
          className="mb-6 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim()) return;
            addAnnouncement(wedding.id, viewer.name, text, audience);
            setText("");
            toast("The circle has the update.");
          }}
        >
          <textarea className={fieldClass} rows={3} placeholder="Dinner starts at 8. The hall doors are open." value={text} onChange={(e) => setText(e.target.value)} />
          <PickList
            label="Who sees it"
            value={audience}
            onChange={setAudience}
            options={[
              { value: "Both", label: "Both sides" },
              { value: "Bride", label: "Bride's side" },
              { value: "Groom", label: "Groom's side" },
            ]}
          />
          <Button type="submit">Publish</Button>
        </form>
      ) : (
        <p className="mb-4 text-sm text-muted">A posting code from the family is needed to publish an announcement.</p>
      )}
      {notes.length === 0 ? <Empty title="No announcements" text="When the plan changes, it should land here, not in a side chat." /> : null}
      <ul className="flex flex-col gap-3">
        {notes.map((n) => (
          <li key={n.id} className="border-l-2 border-maroon pl-4">
            <p className="text-sm text-muted tabular-nums">{n.atLabel} · <PersonName wedding={wedding} name={n.author} /></p>
            <p className="mt-1 text-lg">{n.text}</p>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

export function PlacesScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const setSharing = useWeddingStore((s) => s.setSharing);
  const [eta, setEta] = useState(10);
  useEffect(() => {
    const id = window.setInterval(() => setEta((n) => (n > 1 ? n - 1 : 1)), 20000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <Screen title="Places" lede="Where to be, and the bus. Location sharing stays off until you turn it on.">
      <ul className="flex flex-col gap-4">
        {wedding.places.map((place) => (
          <li key={place.id} className="overflow-hidden rounded-card border border-line bg-card">
            {place.image ? <img src={place.image} alt="" className="aspect-[16/7] w-full object-cover" /> : null}
            <div className="p-4">
              <p className="text-sm text-muted">{place.kind}</p>
              <h2 className="font-serif text-2xl">{place.name}</h2>
              <p className="mt-2">{place.detail}</p>
              {place.moving ? (
                <p className="mt-2 text-maroon">Arriving in about {eta} minutes.</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <h2 className="font-serif text-2xl">Your location</h2>
        <p className="mt-2 text-muted">
          {wedding.sharingLocation
            ? `${viewer.name} is sharing a rough area with the hosts. This preview does not read the phone's GPS.`
            : "Off. Hosts cannot see you."}
        </p>
        <Button className="mt-4" variant={wedding.sharingLocation ? "line" : "primary"} onClick={() => setSharing(wedding.id, !wedding.sharingLocation)}>
          {wedding.sharingLocation ? "Stop sharing" : "Share that I am with the wedding"}
        </Button>
      </div>
    </Screen>
  );
}

export function ServicesScreen() {
  const wedding = useWedding();
  const toggleShortlist = useWeddingStore((s) => s.toggleShortlist);
  const addEnquiry = useWeddingStore((s) => s.addEnquiry);
  const [category, setCategory] = useState<string>("All");
  const [open, setOpen] = useState(false);
  const [needs, setNeeds] = useState("Decoration, catering, and photography");
  const runtime = useAppRuntime();
  const shown = VENDORS.filter((v) => category === "All" || v.category === category);
  return (
    <Screen title="Services" lede="Find people for the wedding, then keep the ones you hire inside the circle.">
      <div className="mb-4">
        <PickList
          label="Category"
          value={category}
          onChange={setCategory}
          options={VENDOR_CATEGORIES.map((item) => ({ value: item, label: item }))}
        />
      </div>
      <ul className="flex flex-col gap-3">
        {shown.map((v) => {
          const saved = wedding.shortlist.includes(v.id);
          return (
            <li key={v.id} className="rounded-card border border-line bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-muted">
                    {v.category} · {v.city}
                    {v.featured ? " · Featured" : ""}
                  </p>
                  <h2 className="font-serif text-2xl">
                    <Link to="/w/$slug/vendor/$vendorId" params={{ slug: wedding.slug, vendorId: v.id }}>{v.name}</Link>
                  </h2>
                  <p className="mt-2">{v.blurb}</p>
                  <p className="mt-2 text-sm text-muted">{v.price}</p>
                </div>
                <Button variant={saved ? "primary" : "line"} onClick={() => toggleShortlist(wedding.id, v.id)}>
                  {saved ? "Shortlisted" : "Shortlist"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-6 grid gap-3 rounded-card border border-line bg-paper p-4"
        onSubmit={(e) => {
          e.preventDefault();
          addEnquiry(wedding.id, {
            guests: "300",
            location: wedding.city,
            when: longDate(wedding.date),
            budget: "₹8–12 lakh",
            needs,
          });
          setOpen(true);
          toast("The enquiry is on the planner desk.");
        }}
      >
        <h2 className="font-serif text-2xl">Ask the planners</h2>
        <p className="text-muted">About 300 guests · {wedding.city} · {longDate(wedding.date)} · ₹8–12 lakh</p>
        <textarea className={fieldClass} rows={3} value={needs} onChange={(e) => setNeeds(e.target.value)} />
        <Button type="submit">Send the enquiry</Button>
        {open ? <p className="text-sm text-muted">Vendors who fit can reply. In this preview, the note waits on the planner desk.</p> : null}
      </form>
      <p className="mt-4 text-xs text-muted">Families pay {runtime.feeLabel} to open a circle. Vendors pay to be featured. Nothing is billed here.</p>
    </Screen>
  );
}

export function PlannerScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const toggleTask = useWeddingStore((s) => s.toggleTask);
  const addTask = useWeddingStore((s) => s.addTask);
  const [title, setTitle] = useState("");
  if (!canPlan(wedding, viewer)) {
    return (
      <Screen title="Planner desk">
        <Empty title="The desk is for the family and the planner" text="Guests see the wedding, not the working list." />
      </Screen>
    );
  }
  const yes = wedding.guests.filter((g) => g.rsvp === "yes").reduce((n, g) => n + g.count, 0);
  return (
    <Screen title="Planner desk" lede="The planner works in the wedding, not from a separate thread.">
      <div className="mb-6 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-2xl border border-line bg-card py-4">
          <p className="font-serif text-2xl tabular-nums">{yes}</p>
          <p className="text-xs text-muted">Attending</p>
        </div>
        <div className="rounded-2xl border border-line bg-card py-4">
          <p className="font-serif text-2xl tabular-nums">{wedding.functions.length}</p>
          <p className="text-xs text-muted">Functions</p>
        </div>
        <div className="rounded-2xl border border-line bg-card py-4">
          <p className="font-serif text-2xl tabular-nums">{wedding.tasks.filter((t) => !t.done).length}</p>
          <p className="text-xs text-muted">Open tasks</p>
        </div>
      </div>
      <h2 className="font-serif text-2xl">Timeline</h2>
      <ol className="mt-3 border-l border-line pl-4">
        {wedding.functions.map((f) => (
          <li key={f.id} className="mb-4">
            <p className="text-sm text-muted tabular-nums">{longDate(f.date)} · {f.time}</p>
            <p className="font-medium">{f.name}</p>
            <p className="text-sm text-muted">{f.venue}</p>
          </li>
        ))}
      </ol>
      <h2 className="mt-6 font-serif text-2xl">Tasks</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {wedding.tasks.map((t) => (
          <li key={t.id}>
            <button type="button" className="flex w-full items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left" onClick={() => toggleTask(wedding.id, t.id)}>
              <span className={t.done ? "mt-1 size-4 rounded-full bg-maroon" : "mt-1 size-4 rounded-full border border-line"} />
              <span>
                <span className={t.done ? "text-muted line-through" : ""}>{t.title}</span>
                <span className="mt-1 block text-sm text-muted">{t.owner} · {t.when}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          addTask(wedding.id, title, viewer.name);
          setTitle("");
        }}
      >
        <input className={fieldClass} placeholder="Add a task" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Button type="submit">Add</Button>
      </form>
      <h2 className="mt-8 font-serif text-2xl">Shortlist</h2>
      {wedding.shortlist.length === 0 ? <p className="mt-2 text-muted">No vendors saved yet.</p> : (
        <ul className="mt-3 flex flex-col gap-2">
          {wedding.shortlist.map((id) => {
            const v = vendorById(id);
            if (!v) return null;
            return <li key={id} className="rounded-2xl border border-line bg-card px-4 py-3">{v.name} · {v.category}</li>;
          })}
        </ul>
      )}
      <h2 className="mt-8 font-serif text-2xl">Enquiries</h2>
      {wedding.enquiries.length === 0 ? <p className="mt-2 text-muted">No requests sent.</p> : (
        <ul className="mt-3 flex flex-col gap-3">
          {wedding.enquiries.map((e) => (
            <li key={e.id} className="rounded-2xl border border-line bg-card p-4">
              <p className="text-sm text-muted">{e.atLabel} · {e.guests} guests · {e.budget}</p>
              <p className="mt-1">{e.needs}</p>
              <p className="text-sm text-muted">{e.location} · {e.when}</p>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}

export function InviteScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}/w/${wedding.slug}` : `/w/${wedding.slug}`;
  const text = `${coupleTitle(wedding)}'s wedding\nYou're invited\n${longDate(wedding.date)} · ${wedding.city}\nOpen the invitation\n${link}`;
  const family = viewer.role === "host" || viewer.role === "cohost";
  const canPublish = Boolean(circleKey(wedding.slug));
  const library = useLibrary();
  const setTheme = useWeddingStore((s) => s.setTheme);
  const invitations = library.assets.filter((item) => item.active && item.category === "Invitations");
  return (
    <Screen title="Invite" lede="Anyone with this link can open the wedding on their own phone. They do not need an account, and they do not need the phone that created it.">
      <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
        <QrImage value={link} />
        <div>
          <p className="font-serif text-3xl">{coupleTitle(wedding)}</p>
          <p className="mt-2 text-muted">You are invited. The link, the QR code, and WhatsApp all open the same guest page.</p>
          <p className="mt-4 break-all text-sm">{link}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard?.writeText(link);
                toast("Invitation link copied.");
              }}
            >
              Copy invitation link
            </Button>
            <a className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <a className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm" href={`sms:?&body=${encodeURIComponent(text)}`}>
              SMS
            </a>
            <a
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm"
              href={`mailto:?subject=${encodeURIComponent(`${coupleTitle(wedding)}'s wedding`)}&body=${encodeURIComponent(text)}`}
            >
              Email
            </a>
            <Button
              variant="line"
              onClick={() => {
                if (navigator.share) {
                  void navigator.share({ title: `${coupleTitle(wedding)}'s wedding`, text, url: link }).catch(() => undefined);
                  return;
                }
                void navigator.clipboard?.writeText(link);
                toast("Invitation link copied.");
              }}
            >
              Other
            </Button>
            {canPublish ? (
              <Button
                variant="line"
                onClick={() => {
                  void pushCircle(wedding).then((result) => {
                    toast(result === "ok" ? "Invitation published for other phones." : "Could not publish just now. Try again.");
                  });
                }}
              >
                Publish link
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      {family && invitations.length > 0 ? (
        <div className="mt-8">
          <h2 className="font-serif text-2xl">Invitation pictures</h2>
          <p className="mt-1 text-sm text-muted">These are pictures the developer has offered for invitations. Choosing one sets it as this circle’s cover. It does not change anyone’s own photos.</p>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {invitations.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={wedding.cover === item.path ? "block w-full overflow-hidden rounded-2xl ring-2 ring-maroon" : "block w-full overflow-hidden rounded-2xl"}
                  onClick={() => {
                    setTheme(wedding.id, item.path);
                    toast("The invitation picture is now the cover.");
                  }}
                >
                  <LibraryPhoto src={item.path} alt={item.name} className="aspect-[4/3] w-full object-cover" />
                  <span className="block px-2 py-2 text-sm">{item.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {family ? (
        <div className="mt-8 rounded-card border border-line bg-paper p-4">
          <h2 className="font-serif text-2xl">Family/VIP-Guest and Guest codes</h2>
          <p className="mt-1 text-sm text-muted">
            Share the Family/VIP-Guest code with family and VIP guests. Share the Guest code with everyone else. People can also enter from the home page with those codes.
          </p>
          <h3 className="mt-4 font-medium">Family/VIP-Guest code</h3>
          <ul className="mt-1 text-sm">
            {codesOf(wedding).filter((item) => item.kind === "family").map((item) => (
              <li key={item.id} className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium tracking-wide">{item.code}</span>
                <CeremonyInviteButton wedding={wedding} codeId={item.id} kind="family" />
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-medium">Guest code</h3>
          <ul className="mt-1 text-sm">
            {codesOf(wedding).filter((item) => item.kind === "guest").map((item) => (
              <li key={item.id} className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium tracking-wide">{item.code}</span>
                <CeremonyInviteButton wedding={wedding} codeId={item.id} kind="guest" />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-6 text-sm text-muted">Ask the host for a Family/VIP-Guest code or a Guest code if you are entering from the home page.</p>
      )}
    </Screen>
  );
}

export function SettingsScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const navigate = useNavigate();
  const guestOnly = viewer.role === "guest" && !viewer.coded;
  useEffect(() => {
    if (guestOnly) void navigate({ to: "/w/$slug/more", params: { slug: wedding.slug }, replace: true });
  }, [guestOnly, navigate, wedding.slug]);
  const updatePrivacy = useWeddingStore((s) => s.updatePrivacy);
  const restoreSample = useWeddingStore((s) => s.restoreSample);
  const setCircleDisabled = useWeddingStore((s) => s.setCircleDisabled);
  const setFunctionAccess = useWeddingStore((s) => s.setFunctionAccess);
  const host = canHost(viewer);
  const owner = isCircleOwner(wedding);
  if (guestOnly) return null;
  function set<K extends keyof Privacy>(key: K, value: Privacy[K]) {
    updatePrivacy(wedding.id, { ...wedding.privacy, [key]: value });
  }
  return (
    <Screen title="Privacy" lede="The wedding is private. Only people you let in can see it.">
      <div className="divide-y divide-line rounded-card border border-line bg-card px-4">
        <Row label="Joining" text={wedding.privacy.join === "link" ? "Anyone with the link can enter." : "The family approves each person."} />
        <Row label="Chat" text="Guests can write, reply, and share photos or videos in the chat. Family can also go live and announce." />
        <Row label="Livestream" text="The host, co-hosts, and family can attach a YouTube live and open a function stream." />
        <Row label="Announcements" text="Family, the host, and co-hosts can publish an announcement." />
        <Row label="Downloads" text={wedding.privacy.download ? "Guests can save photos." : "Guests can look, not save."} />
        <Row label="Circle" text={wedding.disabled ? "Paused. Family and guests cannot enter." : "Open. Family and guests can enter with their codes."} />
      </div>
      {host ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="line" onClick={() => set("join", wedding.privacy.join === "link" ? "approve" : "link")}>
            {wedding.privacy.join === "link" ? "Require approval" : "Allow the link"}
          </Button>
          <Button variant="line" onClick={() => set("download", !wedding.privacy.download)}>
            {wedding.privacy.download ? "Turn downloads off" : "Allow downloads"}
          </Button>
          <Button variant="line" onClick={() => useWeddingStore.getState().setMemory(wedding.id, !wedding.showMemory)}>
            {wedding.showMemory ? "Leave the memory view" : "Preview after the wedding"}
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Ask the host to change these.</p>
      )}
      {canManage(wedding, viewer) ? (
        <div className="mt-6">
          <h2 className="font-serif text-2xl">Private ceremony access</h2>
          <p className="mt-1 text-sm text-muted">Keep a ceremony open to all wedding members or limit it to selected people.</p>
          {wedding.functions.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3">
              {wedding.functions.map((item) => (
                <PickList
                  key={item.id}
                  label={`${item.name} audience`}
                  value={item.accessRule?.kind === "people" ? "people" : item.accessRule && item.accessRule.kind !== "all" ? "legacy" : "all"}
                  onChange={(value) => {
                    if (value === "legacy") return;
                    const kind = value as "all" | "people";
                    setFunctionAccess(wedding.id, item.id, kind === "all" ? undefined : { kind });
                    toast(`${item.name} is ${kind === "all" ? "open to the wedding" : "private"}.`);
                  }}
                  className="min-h-11"
                  options={[
                    { value: "all", label: "All wedding members" },
                    { value: "people", label: "Selected people" },
                    { value: "legacy", label: "Existing private access" },
                  ]}
                />
              ))}
              {wedding.functions.filter((item) => item.accessRule?.kind === "people").map((item) => (
                <div key={`${item.id}-people`} className="flex max-h-28 flex-col gap-1 overflow-y-auto">
                  <p className="text-sm text-muted">{item.name}</p>
                  {wedding.guests.map((guest) => (
                    <label key={guest.id} className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.accessRule?.names?.includes(guest.name) ?? false}
                        onChange={(event) => {
                          const names = new Set(item.accessRule?.names ?? []);
                          if (event.target.checked) names.add(guest.name);
                          else names.delete(guest.name);
                          setFunctionAccess(wedding.id, item.id, { kind: "people", names: [...names] });
                        }}
                      />
                      {guest.name}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <PrivacyPolicy />
      {owner ? (
        <div className="mt-8 rounded-card border border-line bg-paper p-4">
          <h2 className="font-serif text-2xl">Pause the circle</h2>
          <p className="mt-1 text-sm text-muted">Pausing keeps the circle and stops family and guests from entering. Deleting the wedding is in Host Control on More.</p>
          <div className="mt-4">
            <Button variant="line" onClick={() => { setCircleDisabled(wedding.id, !wedding.disabled); toast(wedding.disabled ? "The circle is open again." : "The circle is paused. Family and guests cannot enter."); }}>
              {wedding.disabled ? "Open the circle" : "Pause the circle"}
            </Button>
          </div>
        </div>
      ) : null}
      {wedding.id === SEED_ID && host ? (
        <Button className="mt-8" variant="line" onClick={() => { restoreSample(); toast("The sample wedding is back as it started."); }}>
          Restore the sample wedding
        </Button>
      ) : null}
    </Screen>
  );
}

function Row({ label, text }: { label: string; text: string }) {
  return (
    <div className="py-4">
      <p className="font-medium">{label}</p>
      <p className="text-sm text-muted">{text}</p>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <article className="mt-8 rounded-card border border-line bg-card p-4">
      <h2 className="font-serif text-3xl">Privacy policy</h2>
      <p className="mt-2 text-sm text-muted">This is the privacy policy for Wedding Circle. It explains what the app keeps, where new photos are stored, and what other people in a wedding can see.</p>
      <h3 className="mt-6 font-serif text-2xl">What this covers</h3>
      <p className="mt-2 text-sm">Wedding Circle is a private place for one wedding. It is not a public social network. A circle is visible only to the host, the people they add as co-hosts, and family or guests who enter with a code.</p>
      <h3 className="mt-6 font-serif text-2xl">Your profile</h3>
      <p className="mt-2 text-sm">If you create a profile, Wedding Circle keeps your name, and the email or phone number you used, on this device. A password is stored only as a one-way hash. We do not ask for a Google password. Religion and tradition are used only to suggest wedding functions. They are not sold and they are not used for advertising.</p>
      <h3 className="mt-6 font-serif text-2xl">Photos and videos</h3>
      <p className="mt-2 text-sm">Photos and videos you post belong to you. New files are stored in private wedding storage for that circle. They are not placed on a public web address, and they are not used for advertising, analytics, or to train AI. People in that circle can see what you posted. Another wedding cannot open those files.</p>
      <p className="mt-2 text-sm">A viewing link is short-lived and is created only after the server checks that you are in the wedding. The storage secret stays on the server. Older files that were already saved in someone's Google Drive are not deleted and are not moved. Those older posts can still open while that Drive connection remains valid.</p>
      <h3 className="mt-6 font-serif text-2xl">Google Drive</h3>
      <p className="mt-2 text-sm">New uploads do not ask for Google Drive. Wedding Circle does not start a new Drive connection. If a file was saved there before, it stays in that Drive account until the owner deletes it in Google. Removing a post from the circle does not delete the file.</p>
      <h3 className="mt-6 font-serif text-2xl">Who can see a wedding</h3>
      <p className="mt-2 text-sm">The host chooses whether a link is enough or each guest must be approved. Family and guests use different codes. Guests can use the chat. Family can also go live and publish announcements. The host and co-hosts can remove or block a guest. The sample wedding is view only.</p>
      <p className="mt-2 text-sm">Downloads are a host setting. If downloads are off, guests can look but not save. If you turn on “I am with the wedding,” hosts see that you turned it on. This app does not read your phone’s precise location.</p>
      <h3 className="mt-6 font-serif text-2xl">What we do not do</h3>
      <p className="mt-2 text-sm">We do not sell personal information. We do not use wedding photos or videos for ads. We do not use them to train AI. We do not build an advertising profile from your religion, tradition, guest list, or posts. The setup fee shown when a circle is created is a preview. This app does not charge a card or a UPI app.</p>
      <h3 className="mt-6 font-serif text-2xl">Security</h3>
      <p className="mt-2 text-sm">A password is kept only as a hash. The key that signs a private viewing link stays on the server. It is not placed in the page, and it is not shared with other weddings. A viewing link expires. Disconnecting an older Drive account, or deleting the circle, does not delete files that were already stored.</p>
      <h3 className="mt-6 font-serif text-2xl">Children</h3>
      <p className="mt-2 text-sm">A wedding may include photographs of children. Post a photo only if you have the right to share it with that circle. Wedding Circle is not directed at children, and it does not ask a child to create an account.</p>
      <h3 className="mt-6 font-serif text-2xl">How long it is kept</h3>
      <p className="mt-2 text-sm">A post stays in the circle until you delete it, a host or co-host removes it, or the host deletes the circle. Pausing a circle hides it from family and guests without erasing it. Deleting a circle removes it from the app. Files already in Google Drive stay there unless you delete them in Google yourself. New files in private storage are not deleted by removing the circle from this phone. You can save photos and videos before a circle is deleted.</p>
      <h3 className="mt-6 font-serif text-2xl">Your choices</h3>
      <p className="mt-2 text-sm">You can delete your own posts and ask the host to remove you. The host can pause or permanently delete the circle. Older Drive files remain in that Google account either way. New uploads do not require a Google connection.</p>
      <h3 className="mt-6 font-serif text-2xl">Changes and contact</h3>
      <p className="mt-2 text-sm">If this policy changes, the new text will appear on this page. Questions go to the developer from the note on the home page. That note is not posted in a wedding.</p>
    </article>
  );
}
