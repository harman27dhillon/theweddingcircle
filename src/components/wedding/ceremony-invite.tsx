import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/wedding/ui";
import { invitationShareText, inviteAccessLabel, type CeremonySnapshot, type InviteKind } from "@/lib/wedding/ceremony-invite";
import { createCeremonyInvite, enterCeremonyInvite, readCeremonyInvite, revokeCeremonyInvite } from "@/lib/wedding/ceremony-invite.functions";
import { cardThemeOf, themeSurface, themeTone } from "@/lib/wedding/card-themes";
import { circleKey } from "@/lib/wedding/circle-key";
import { useDismissible } from "@/lib/wedding/dismiss";
import { coupleTitle, isSampleCircle, longDate } from "@/lib/wedding/format";
import { accountSenderId } from "@/lib/wedding/identity";
import { memberKeyFor, rememberMemberKey } from "@/lib/wedding/member-key";
import { loadCircle } from "@/lib/wedding/publish";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Wedding } from "@/lib/wedding/types";

function mayOffer(wedding: Wedding, kind: InviteKind) {
  if (isSampleCircle(wedding)) return false;
  const state = useWeddingStore.getState();
  const viewer = state.viewer;
  if (viewer.weddingId !== wedding.id) return false;
  const me = accountSenderId(state.account);
  if (viewer.role === "host" || viewer.role === "cohost") return true;
  if (kind === "family" && viewer.role === "guest" && viewer.coded) return true;
  if (kind === "bride" && me && wedding.coupleAccess?.bride?.accountId === me) return true;
  if (kind === "groom" && me && wedding.coupleAccess?.groom?.accountId === me) return true;
  return false;
}

export function CeremonyInviteButton({ wedding, codeId, kind }: { wedding: Wedding; codeId: string; kind: InviteKind }) {
  const viewer = useWeddingStore((s) => s.viewer);
  const account = useWeddingStore((s) => s.account);
  const [open, setOpen] = useState(false);
  if (isSampleCircle(wedding) || viewer.weddingId !== wedding.id) return null;
  const me = accountSenderId(account);
  const allowed =
    viewer.role === "host" ||
    viewer.role === "cohost" ||
    (kind === "family" && viewer.role === "guest" && Boolean(viewer.coded)) ||
    (kind === "bride" && Boolean(me && wedding.coupleAccess?.bride?.accountId === me)) ||
    (kind === "groom" && Boolean(me && wedding.coupleAccess?.groom?.accountId === me));
  if (!allowed) return null;
  return (
    <>
      <button type="button" className="invite-code-btn" onClick={() => setOpen(true)}>
        Invitation
      </button>
      {open ? <InviteWindow wedding={wedding} codeId={codeId} kind={kind} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function InviteWindow({
  wedding,
  codeId,
  kind,
  onClose,
}: {
  wedding: Wedding;
  codeId: string;
  kind: InviteKind;
  onClose: () => void;
}) {
  const account = useWeddingStore((s) => s.account);
  const [selected, setSelected] = useState<string[]>(() => wedding.functions.map((item) => item.id));
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ token: string; url: string; expiresAt: string; ceremonies: CeremonySnapshot[] } | null>(null);
  const theme = cardThemeOf(wedding.cardTheme);
  const cardRef = useRef<HTMLDivElement>(null);
  useDismissible(true, onClose, cardRef);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cardRef.current?.focus({ preventScroll: true });
    return () => previous?.focus({ preventScroll: true });
  }, []);

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  async function share() {
    if (!mayOffer(wedding, kind)) {
      toast("You cannot share an invitation for that access code.");
      return;
    }
    setBusy(true);
    try {
      if (link) {
        const revoked = await revokeCeremonyInvite({ data: link.token });
        if (!revoked.ok) toast("The previous link could not be stopped. It still expires after 24 hours.");
      }
      const created = await createCeremonyInvite({
        data: {
          slug: wedding.slug,
          editKey: circleKey(wedding.slug),
          memberKey: memberKeyFor(wedding.slug),
          accountId: accountSenderId(account),
          codeId,
          kind,
          ceremonyIds: selected,
        },
      });
      if (!created.ok) {
        toast(created.error);
        return;
      }
      const url = `${window.location.origin}/i/${created.token}`;
      const next = { token: created.token, url, expiresAt: created.expiresAt, ceremonies: created.ceremonies };
      setLink(next);
      if (created.ceremonies.length < selected.length) toast("A ceremony that is no longer on the schedule was left out.");
      const text = invitationShareText({ bride: wedding.bride, groom: wedding.groom, ceremonies: created.ceremonies, url });
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: `${coupleTitle(wedding)}'s wedding`, text, url });
          toast("Invitation shared.");
        } catch (error) {
          const cancelled = error instanceof DOMException && error.name === "AbortError";
          if (!cancelled) {
            const copied = await copyLink(url);
            toast(copied ? "Sharing is not available here. The link was copied." : "Sharing is not available. Copy the link below.");
          }
        }
      }
    } catch {
      toast("The invitation could not be created. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    const copied = await copyLink(link.url);
    toast(copied ? "Link copied." : "Could not copy the link. Select it below.");
  }

  async function revoke() {
    if (!link) return;
    setBusy(true);
    try {
      const result = await revokeCeremonyInvite({ data: link.token });
      if (!result.ok) {
        toast("That link could not be stopped.");
        return;
      }
      setLink(null);
      toast("That invitation link is no longer active.");
    } catch {
      toast("That link could not be stopped.");
    } finally {
      setBusy(false);
    }
  }

  const node = (
    <div
      className="invite-pop"
      data-card-theme={theme.id}
      data-tone={themeTone(theme)}
      style={themeSurface(theme) as CSSProperties}
    >
      <div ref={cardRef} className="invite-pop-card" role="dialog" aria-modal="true" aria-labelledby="ceremony-invite-title" tabIndex={-1} data-invite-kind={kind} data-invite-code={codeId}>
        <h2 id="ceremony-invite-title" className="font-serif text-2xl">Ceremony invitation</h2>
        <p className="mt-1 text-sm text-muted">
          This uses the {inviteAccessLabel(kind)} for this wedding only. Removing a ceremony here does not change the schedule.
        </p>
        {wedding.functions.length === 0 ? (
          <p className="mt-3 text-sm">No ceremonies are configured yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {wedding.functions.map((item) => {
              const on = selected.includes(item.id);
              return (
                <li key={item.id}>
                  <label className={on ? "invite-ceremony is-on" : "invite-ceremony"}>
                    <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                    <span>
                      <span className="block font-medium">{item.name}</span>
                      <CeremonyFacts item={item} />
                      <span className="mt-1 block text-xs text-maroon">{on ? "Included" : "Not included"}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {link ? (
          <div className="mt-3 rounded-2xl border border-line bg-card px-3 py-2">
            <p className="text-sm">This link works for 24 hours. Anyone who has it can open the invitation until then.</p>
            {link.expiresAt ? <p className="mt-1 text-xs text-muted">Stops working {when(link.expiresAt)}.</p> : null}
            <p className="mt-2 text-sm">{link.ceremonies.length === 0 ? "No ceremonies included." : `${link.ceremonies.length} ${link.ceremonies.length === 1 ? "ceremony" : "ceremonies"} included.`}</p>
            <input className="mt-2 w-full rounded-xl border border-line bg-ivory px-2 py-2 text-xs" readOnly aria-label="Invitation link" value={link.url} />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="line" disabled={busy} onClick={() => void copy()}>Copy link</Button>
              <Button type="button" variant="line" disabled={busy} onClick={() => void revoke()}>Revoke link</Button>
            </div>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="button" variant="line" onClick={onClose}>Close</Button>
          <Button type="button" disabled={busy} onClick={() => void share()}>{busy ? "Working…" : link ? "Share a new link" : "Share"}</Button>
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}

function CeremonyFacts({ item }: { item: CeremonySnapshot | { date?: string; time?: string; endTime?: string; venue?: string; address?: string; dress?: string; note?: string; mapsUrl?: string } }) {
  const whenText = [item.date ? prettyDate(item.date) : "", item.time, item.endTime ? `until ${item.endTime}` : ""].filter(Boolean).join(" · ");
  return (
    <span className="mt-1 block text-sm text-muted">
      {whenText ? <span className="block">{whenText}</span> : null}
      {item.venue ? <span className="block">{item.venue}</span> : null}
      {item.address ? <span className="block">{item.address}</span> : null}
      {item.dress ? <span className="block">Dress: {item.dress}</span> : null}
      {item.note ? <span className="block">{item.note}</span> : null}
      {item.mapsUrl ? (
        <a className="mt-1 inline-flex min-h-11 items-center text-maroon" href={item.mapsUrl} target="_blank" rel="noopener noreferrer">
          Directions
        </a>
      ) : null}
    </span>
  );
}

function prettyDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? longDate(value) : value;
}

function when(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "after 24 hours";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

export function CeremonyInvitePage({ token }: { token: string }) {
  const navigate = useNavigate();
  const account = useWeddingStore((s) => s.account);
  const [view, setView] = useState<Awaited<ReturnType<typeof readCeremonyInvite>> | null>(null);
  const [name, setName] = useState(account?.name ?? "");
  const [side, setSide] = useState<"Bride" | "Groom" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readCeremonyInvite({ data: token })
      .then((result) => {
        if (live) setView(result);
      })
      .catch(() => {
        if (live) setView({ ok: false, status: "missing" });
      });
    return () => {
      live = false;
    };
  }, [token]);

  const theme = cardThemeOf(view && view.ok ? view.theme : undefined);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const next = themeSurface(theme);
    root.dataset.cardTheme = theme.id;
    root.dataset.tone = themeTone(theme);
    for (const [key, value] of Object.entries(next)) root.style.setProperty(key, value);
    return () => {
      if (root.dataset.cardTheme === theme.id) {
        delete root.dataset.cardTheme;
        delete root.dataset.tone;
      }
      for (const key of Object.keys(next)) root.style.removeProperty(key);
    };
  }, [theme]);

  async function enter(event: FormEvent) {
    event.preventDefault();
    if (!view || !view.ok) return;
    setBusy(true);
    setNote("");
    try {
      const result = await enterCeremonyInvite({
        data: {
          token,
          name,
          side,
          memberKey: "",
          accountId: accountSenderId(account),
        },
      });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      if (result.memberKey && !memberKeyFor(result.slug)) rememberMemberKey(result.slug, result.memberKey);
      const remote = await loadCircle(result.slug);
      if (remote) {
        const state = useWeddingStore.getState();
        if (state.weddings.some((item) => item.slug === remote.slug)) state.applyRemoteCircle(remote);
        else state.adoptCircle(remote);
      }
      if (result.role === "bride" || result.role === "groom") {
        const seated = useWeddingStore.getState().applyVerifiedCoupleSeat(result.slug, result.role, account?.name || name);
        if (!seated.ok) {
          setNote(seated.error === "both" ? "This account is already the other role for that wedding." : "The wedding could not be opened on this phone. Try again.");
          return;
        }
      } else {
        const joined = useWeddingStore.getState().enterFromInvite(result.slug, name, side, result.role);
        if (joined === "blocked") {
          setNote("The host has removed that name from the circle.");
          return;
        }
        if (joined === "disabled") {
          setNote("This wedding circle is paused.");
          return;
        }
        if (joined !== "joined") {
          setNote("The wedding could not be opened on this phone. Try again.");
          return;
        }
      }
      void navigate({ to: "/w/$slug", params: { slug: result.slug } });
    } catch {
      setNote("The invitation could not be opened. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-ivory px-4 py-6 text-ink" data-card-theme={theme.id} data-tone={themeTone(theme)} data-ceremony-invite="" style={themeSurface(theme) as CSSProperties}>
      <main className="mx-auto w-full max-w-md">
        {!view ? <p>Opening the invitation…</p> : null}
        {view && !view.ok ? (
          <section className="invite-pop-card static" role="status">
            <h1 className="font-serif text-3xl">
              {view.status === "expired" ? "This invitation link has expired." : view.status === "revoked" ? "This invitation link is no longer active." : "This invitation link is not valid."}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {view.status === "expired"
                ? "It stopped working 24 hours after it was created. Ask the person who shared it for a new one."
                : "Ask the person who invited you for a new link."}
            </p>
            <Link to="/" className="mt-4 inline-flex min-h-11 items-center text-maroon">Back to Wedding Circle</Link>
          </section>
        ) : null}
        {view && view.ok ? (
          <section className="invite-pop-card static">
            <p className="text-sm text-muted">You're invited</p>
            <h1 className="font-serif text-3xl">{view.bride && view.groom ? `${view.bride} & ${view.groom}` : "Wedding invitation"}</h1>
            {view.date || view.city ? <p className="mt-2 text-sm">{[view.date ? prettyDate(view.date) : "", view.city].filter(Boolean).join(" · ")}</p> : null}
            <p className="mt-2 text-sm text-muted">This invitation uses {inviteAccessLabel(view.kind)}. It does not include other codes.</p>
            {view.expiresAt ? <p className="mt-1 text-xs text-muted">This link stops working {when(view.expiresAt)}.</p> : null}
            {view.ceremonies.length === 0 ? (
              <p className="mt-4 text-sm">No ceremonies were included in this invitation.</p>
            ) : (
              <ul className="mt-4 flex flex-col gap-2">
                {view.ceremonies.map((item) => (
                  <li key={item.id} className="invite-ceremony is-on">
                    <span>
                      {item.name ? <span className="block font-medium">{item.name}</span> : null}
                      <CeremonyFacts item={item} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {view.paused ? <p className="mt-4 text-sm">This wedding circle is paused. You can read the invitation, but you cannot enter yet.</p> : null}
            {view.kind === "bride" || view.kind === "groom" ? (
              accountSenderId(account) ? (
                <form className="mt-4" onSubmit={(event) => void enter(event)}>
                  <Button type="submit" disabled={busy || view.paused}>{busy ? "Opening…" : view.kind === "bride" ? "Enter as the bride" : "Enter as the groom"}</Button>
                  {note ? <p className="mt-2 text-sm text-maroon" role="status">{note}</p> : null}
                </form>
              ) : (
                <div className="mt-4">
                  <p className="text-sm">Sign in before taking this role. The role is saved to your account.</p>
                  <Link
                    to="/account"
                    className="mt-2 inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo"
                    onClick={() => sessionStorage.setItem("wc-after-auth", `/i/${token}`)}
                  >
                    Sign in
                  </Link>
                </div>
              )
            ) : (
              <form className="mt-4 grid gap-2" onSubmit={(event) => void enter(event)}>
                <label className="text-sm">
                  Your name
                  <input className="mt-1 w-full rounded-2xl border border-line bg-ivory px-3 py-2" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" />
                </label>
                <fieldset>
                  <legend className="text-sm">Which side are you with?</legend>
                  <label className="mt-1 flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name="invite-side" checked={side === "Bride"} onChange={() => setSide("Bride")} />
                    Bride's side
                  </label>
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="radio" name="invite-side" checked={side === "Groom"} onChange={() => setSide("Groom")} />
                    Groom's side
                  </label>
                </fieldset>
                <Button type="submit" disabled={busy || view.paused}>{busy ? "Opening…" : "Enter the wedding"}</Button>
                {note ? <p className="text-sm text-maroon" role="status">{note}</p> : null}
              </form>
            )}
          </section>
        ) : null}
      </main>
    </div>
  );
}
