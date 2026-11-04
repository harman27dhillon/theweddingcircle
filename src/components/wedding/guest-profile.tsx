import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CameraCapture } from "@/components/wedding/camera-capture";
import { useWedding } from "@/components/wedding/context";
import { useMediaUrl } from "@/components/wedding/ui";
import { ownMemberKey, profileForMessage, storeAvatar } from "@/lib/wedding/guest-profile";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Wedding, WeddingGuestProfile } from "@/lib/wedding/types";

const LATER = "wc-profile-later";

export function laterKey(slug: string, memberKey: string) {
  return `${LATER}:${slug}:${memberKey}`;
}

function cartoonHue(seed: string) {
  let hash = 0;
  for (const char of seed || "guest") hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return hash % 6;
}

export function CartoonAvatar({ seed }: { seed: string }) {
  const hue = cartoonHue(seed);
  const skin = ["#f6d3b8", "#e2b392", "#c98a62", "#8d5a3c", "#f3c7a6", "#d7a57c"][hue];
  const hair = ["#4a2c22", "#2a1c18", "#7a3e32", "#8c2f39", "#3a2a44", "#6a4328"][hue];
  const dress = ["#8c2f39", "#6e4a86", "#2f5d50", "#8c2f39", "#3d4f73", "#a68456"][hue];
  return (
    <svg className="cartoon-avatar" viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 50c10 0 16 6 18 12H14c2-6 8-12 18-12z" fill={dress} />
      <circle cx="32" cy="30" r="13" fill={skin} />
      <path d="M16 34c1-16 8-22 16-22s15 6 16 22c-2 3-6 5-10 4-2-4-8-4-12 0-4 1-8-1-10-4z" fill={hair} />
      <path d="M18 28c2 10 6 16 14 16s12-6 14-16" fill="none" stroke={hair} strokeWidth="3" />
      <path className="cartoon-eye" d="M25 30.2c.8-1.1 2.2-1.1 3 0" fill="none" stroke="#1c1412" strokeWidth="1.3" strokeLinecap="round" />
      <path className="cartoon-eye" d="M36 30.2c.8-1.1 2.2-1.1 3 0" fill="none" stroke="#1c1412" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="24.2" cy="33" r="1.15" fill="#c45b6a" opacity="0.85" />
      <circle cx="39.8" cy="33" r="1.15" fill="#c45b6a" opacity="0.85" />
      <path d="M28.2 36.6c1.4 1.5 6.2 1.5 7.6 0" fill="none" stroke="#8c2f39" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function WeddingAvatar({
  name,
  photo,
  couple,
  label,
  seed,
  bar,
  onOpen,
}: {
  name: string;
  photo?: string;
  couple?: boolean;
  label: string;
  seed?: string;
  bar?: boolean;
  onOpen?: () => void;
}) {
  const { url } = useMediaUrl(photo || "");
  const body = url ? <img src={url} alt="" /> : <CartoonAvatar seed={seed || name || "guest"} />;
  const className = `chat-avatar${couple ? " is-couple" : ""}${bar ? " is-bar" : ""}`;
  if (!onOpen) return <span className={className} aria-hidden="true">{body}</span>;
  return (
    <button type="button" className={`chat-avatar-btn ${className}`} aria-label={label} onClick={onOpen}>
      {body}
    </button>
  );
}

export function ProfileCard({
  name,
  profile,
  couple,
  mine,
  onClose,
  onEdit,
}: {
  name: string;
  profile: WeddingGuestProfile | null;
  couple?: "" | "bride" | "groom";
  mine: boolean;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const shown = profile && !profile.removed ? profile : null;
  const { url } = useMediaUrl(shown?.photo || "");
  return (
    <div className="profile-sheet" role="presentation" onClick={onClose}>
      <div className="profile-card" role="dialog" aria-modal="true" aria-label={`${shown?.displayName || name}'s wedding profile`} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-3">
          <span className={`chat-avatar${couple ? " is-couple" : ""}`} style={{ width: "4.5rem", height: "4.5rem", flexBasis: "4.5rem", fontSize: "1.1rem" }}>
            {url ? <img src={url} alt="" /> : <CartoonAvatar seed={shown?.displayName || name} />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-serif text-2xl">{shown?.displayName || name}</p>
            {couple ? <p className="text-xs tracking-wide text-muted uppercase">{couple === "bride" ? "Bride" : "Groom"}</p> : null}
            {shown?.relationship ? <p className="text-sm text-muted">{shown.relationship}{shown.side ? ` · ${shown.side}'s side` : ""}</p> : shown?.side ? <p className="text-sm text-muted">{shown.side}'s side</p> : null}
          </div>
        </div>
        {shown?.bio ? <p className="mt-3 text-sm leading-snug">{shown.bio}</p> : null}
        {shown?.links?.length ? (
          <ul className="mt-3 flex flex-col gap-1">
            {shown.links.map((link) => (
              <li key={link.url}>
                <a className="text-sm text-maroon underline" href={link.url} target="_blank" rel="noreferrer">{link.label}</a>
              </li>
            ))}
          </ul>
        ) : null}
        {!shown ? <p className="mt-3 text-sm text-muted">No wedding profile yet.</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {mine && onEdit ? <button type="button" className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" onClick={onEdit}>Edit profile</button> : null}
          <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export function GuestProfileEditor({ open, onClose, first }: { open: boolean; onClose: () => void; first?: boolean }) {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const saveGuestProfile = useWeddingStore((s) => s.saveGuestProfile);
  const removeOwnProfile = useWeddingStore((s) => s.removeOwnProfile);
  const [key, setKey] = useState("");
  const dirty = useRef(false);
  const existing = key ? wedding.guestProfiles?.[key] : undefined;
  const current = existing && !existing.removed ? existing : null;
  const [name, setName] = useState(current?.displayName || viewer.name || "");
  const [photo, setPhoto] = useState(current?.photo || "");
  const [bio, setBio] = useState(current?.bio || "");
  const [relationship, setRelationship] = useState(current?.relationship || "");
  const [side, setSide] = useState<"" | "Bride" | "Groom">(current?.side || "");
  const [links, setLinks] = useState<{ label: string; url: string }[]>(current?.links?.length ? current.links : [{ label: "", url: "" }]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [camera, setCamera] = useState(false);
  const { url } = useMediaUrl(photo);
  const savedSig = current
    ? [current.displayName, current.photo || "", current.bio || "", current.relationship || "", current.side || "", (current.links ?? []).map((link) => `${link.label}|${link.url}`).join(";")].join("\n")
    : "";

  useEffect(() => {
    setKey(ownMemberKey(wedding.slug));
  }, [wedding.slug]);

  useEffect(() => {
    dirty.current = false;
    setReady(false);
  }, [wedding.id]);

  useEffect(() => {
    if (dirty.current) return;
    const next = current;
    setName(next?.displayName || viewer.name || "");
    setPhoto(next?.photo || "");
    setBio(next?.bio || "");
    setRelationship(next?.relationship || "");
    setSide(next?.side || "");
    setLinks(next?.links?.length ? next.links : [{ label: "", url: "" }]);
    setError("");
  }, [wedding.id, savedSig, viewer.name]);

  useEffect(() => {
    if (!open) setReady(false);
  }, [open]);

  if (!open) return null;

  async function useFile(file: File | undefined) {
    if (!file) return;
    setBusy("photo");
    setError("");
    const saved = await storeAvatar(file, wedding.slug);
    setBusy("");
    if (!saved.ok) {
      setError(saved.error);
      return;
    }
    setPhoto(saved.src);
    dirty.current = true;
    toast("Photo uploaded.");
  }

  async function save() {
    setBusy("save");
    setError("");
    const result = await saveGuestProfile(wedding.id, {
      displayName: name,
      photo,
      bio,
      relationship,
      side,
      links: links.filter((link) => link.url.trim()),
    });
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dirty.current = false;
    toast(first || !current ? "Your temporary profile is ready." : "Profile update completed.");
    if (first || !current) setReady(true);
    else onClose();
  }

  async function remove() {
    setBusy("remove");
    setError("");
    const result = await removeOwnProfile(wedding.id);
    setBusy("");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    dirty.current = false;
    toast("Wedding profile removed. Your messages stay.");
    onClose();
  }

  return (
    <div className="profile-sheet" role="presentation">
      <form
        className="profile-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wedding-profile-title"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {ready ? (
          <div>
            <h2 id="wedding-profile-title" className="font-serif text-3xl">Your temporary profile is ready.</h2>
            <p className="mt-2 text-sm text-muted">People in this wedding will see {name.trim() || "your name"}. It stays with this wedding only.</p>
            <button type="button" className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" onClick={onClose}>Continue to chat</button>
          </div>
        ) : (
          <>
            <h2 id="wedding-profile-title" className="font-serif text-3xl">{first ? "Join this Wedding." : "Your wedding profile"}</h2>
            <p className="mt-2 text-sm text-muted">Create your wedding profile to chat, share photos, and be part of the celebrations. This name is only for {wedding.bride} and {wedding.groom}'s circle.</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="chat-avatar" style={{ width: "4.5rem", height: "4.5rem", flexBasis: "4.5rem" }}>
                {url ? <img src={url} alt="" /> : <CartoonAvatar seed={name || "guest"} />}
              </span>
              <div className="flex flex-col gap-1">
                <button type="button" className="min-h-11 text-left text-sm text-maroon" onClick={() => setCamera(true)}>Take a photo</button>
                <label className="min-h-11 cursor-pointer text-sm text-maroon">
                  {busy === "photo" ? "Preparing photo…" : "Add your photo"}
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      void useFile(file);
                    }}
                  />
                </label>
                {photo ? <button type="button" className="min-h-9 text-left text-xs text-muted" onClick={() => { dirty.current = true; setPhoto(""); }}>Remove photo</button> : <p className="text-xs text-muted">A photo is optional. A cartoon stands in until you add one.</p>}
              </div>
            </div>
            <label className="mt-4 block text-sm">
              Display name
              <input className="mt-1 min-h-11 w-full rounded-2xl border border-line bg-card px-3" value={name} maxLength={40} required onChange={(event) => { dirty.current = true; setName(event.target.value); }} />
            </label>
            <label className="mt-3 block text-sm">
              Short note
              <input className="mt-1 min-h-11 w-full rounded-2xl border border-line bg-card px-3" value={bio} maxLength={140} placeholder="Optional" onChange={(event) => { dirty.current = true; setBio(event.target.value); }} />
            </label>
            <label className="mt-3 block text-sm">
              Relationship
              <input className="mt-1 min-h-11 w-full rounded-2xl border border-line bg-card px-3" list="wedding-relations" value={relationship} maxLength={40} placeholder="Optional" onChange={(event) => { dirty.current = true; setRelationship(event.target.value); }} />
              <datalist id="wedding-relations">
                <option value="Friend" />
                <option value="Cousin" />
                <option value="Family" />
                <option value="Neighbour" />
                <option value="Colleague" />
              </datalist>
            </label>
            <fieldset className="mt-3">
              <legend className="text-sm">Side, if you want to say</legend>
              <div className="mt-1 flex flex-wrap gap-2">
                {(["", "Bride", "Groom"] as const).map((value) => (
                  <button key={value || "none"} type="button" className={`min-h-11 rounded-full border px-3 text-sm ${side === value ? "border-maroon bg-maroon text-on-photo" : "border-line bg-card"}`} onClick={() => { dirty.current = true; setSide(value); }}>
                    {value === "" ? "Prefer not to say" : `${value}'s side`}
                  </button>
                ))}
              </div>
            </fieldset>
            {error ? <p className="mt-3 text-sm text-maroon" role="alert">{error}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" disabled={Boolean(busy)}>{busy === "save" ? "Saving…" : "Continue"}</button>
              <button type="button" className="min-h-11 rounded-full border border-line px-4 text-sm" onClick={onClose}>Close</button>
              {current ? <button type="button" className="min-h-11 px-2 text-sm text-muted" disabled={Boolean(busy)} onClick={() => void remove()}>{busy === "remove" ? "Removing…" : "Remove profile"}</button> : null}
            </div>
          </>
        )}
      </form>
      {camera ? (
        <CameraCapture
          onClose={() => setCamera(false)}
          onUse={(file) => {
            setCamera(false);
            void useFile(file);
          }}
        />
      ) : null}
    </div>
  );
}

export function lookupProfile(wedding: Wedding, author: string, authorId?: string) {
  return profileForMessage(wedding.guestProfiles, author, authorId);
}
