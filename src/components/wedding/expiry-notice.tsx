import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/wedding/ui";
import { useWedding } from "@/components/wedding/context";
import { beginRetentionExtension } from "@/lib/wedding/circle.functions";
import { circleKey } from "@/lib/wedding/circle-key";
import { isCircleOwner } from "@/lib/wedding/format";
import { expiryPhase, formatUtc, reminderCopy, RETENTION_FEE_LABEL, retentionExtended } from "@/lib/wedding/lifecycle";
import { useWeddingStore } from "@/lib/wedding/store";

export function ExpiryNotice() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const phase = expiryPhase(wedding, Date.now());
  if (phase !== "soon" && phase !== "closed") return null;
  const host = viewer.role === "host" || viewer.role === "cohost" || isCircleOwner(wedding);
  const when = wedding.expiresAt ? formatUtc(wedding.expiresAt) : "";
  const mediaUntil = wedding.mediaRetentionUntil ? formatUtc(wedding.mediaRetentionUntil) : when;
  const extended = retentionExtended(wedding);
  if (!host) {
    if (phase !== "soon") return null;
    return (
      <p className="border-b border-line bg-paper px-4 py-2 text-sm" role="status">
        This wedding circle closes {when}. Save any photos you want to keep before then.
      </p>
    );
  }
  const copy = wedding.expiresAt ? reminderCopy(`${wedding.bride} & ${wedding.groom}`, wedding.expiresAt) : null;

  function saveMedia() {
    toast("There is no one-file album download. Open Album and tap Save on each photo or video.");
    void navigate({ to: "/w/$slug/memories", params: { slug: wedding.slug } });
  }

  async function extend() {
    const editKey = circleKey(wedding.slug);
    if (!editKey) {
      setNote("Only the host phone that created this circle can request the extension.");
      return;
    }
    setPending(true);
    setNote("");
    try {
      const result = await beginRetentionExtension({ data: { slug: wedding.slug, editKey } });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setNote(result.message);
    } catch {
      setNote("The extension could not be requested. Nothing was charged and retention was not extended.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="border-b border-line bg-paper px-4 py-3 text-sm" role="status">
      <p className="font-medium">{phase === "closed" ? "Guests can no longer enter" : copy?.title || "This wedding circle expires soon"}</p>
      <p className="mt-1 text-muted">
        {phase === "closed"
          ? `Cloud photos and videos stay until ${mediaUntil}. The active circle already closed at ${when}.`
          : extended
            ? `Guests leave at ${when}. Cloud media stays until ${mediaUntil}.`
            : copy?.body}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full border border-line bg-card px-3" onClick={saveMedia}>
          Save my media
        </button>
        <button type="button" className="min-h-11 rounded-full bg-maroon px-3 text-on-photo" onClick={() => { setNote(""); setOpen(true); }}>
          Extend for {RETENTION_FEE_LABEL}
        </button>
        <Link to="/w/$slug/memories" params={{ slug: wedding.slug }} className="inline-flex min-h-11 items-center text-maroon">
          Album
        </Link>
      </div>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 md:items-center">
          <div className="w-full max-w-md rounded-card border border-line bg-ivory p-6 text-ink" role="dialog" aria-labelledby="retention-title">
            <h2 id="retention-title" className="font-serif text-3xl">Extend cloud media</h2>
            <p className="mt-2">{RETENTION_FEE_LABEL} for another 30 days of cloud media retention.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
              <li>Photos and videos already in this circle stay in the cloud for 30 more days.</li>
              <li>The wedding's active 30 days do not change. Guests still leave at {when}.</li>
              <li>There is no single album file. Each photo and video has its own Save button.</li>
            </ul>
            <p className="mt-3 text-sm">No payment is taken in the app. A provider has to confirm {RETENTION_FEE_LABEL} on the server before the deadline moves.</p>
            {note ? <p className="mt-3 text-sm">{note}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={pending} onClick={() => void extend()}>{pending ? "Requesting…" : `Request ${RETENTION_FEE_LABEL} extension`}</Button>
              <button type="button" className="min-h-11 rounded-full border border-line px-4" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
