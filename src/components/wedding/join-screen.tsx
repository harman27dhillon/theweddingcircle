import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { CoverVisual } from "@/components/wedding/themes";
import { Button, fieldClass, Mark, PickList } from "@/components/wedding/ui";
import { codeMatch, compactCode, coupleTitle, longDate, normalizeCode } from "@/lib/wedding/format";
import { SEED_ID } from "@/lib/wedding/seed";
import { RELATIONSHIPS } from "@/lib/wedding/traditions";
import { applyRole, confirmWeddingRole } from "@/lib/wedding/role-client";
import { useWeddingStore } from "@/lib/wedding/store";
import type { CircleStatus } from "@/lib/wedding/use-circle";
import type { Rsvp } from "@/lib/wedding/types";

export function CircleGate({ status, onRetry }: { status: CircleStatus; onRetry?: () => void }) {
  const navigate = useNavigate();
  const focusWedding = useWeddingStore((s) => s.focusWedding);
  const setViewerSide = useWeddingStore((s) => s.setViewerSide);
  const restoreSample = useWeddingStore((s) => s.restoreSample);

  if (status === "loading") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
        <p className="text-sm text-muted">Wedding Circle</p>
        <h1 className="mt-2 font-serif text-4xl">Opening the invitation</h1>
        <p className="mt-3 text-muted">This link works on any phone. You do not need an account.</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
        <h1 className="font-serif text-4xl">We could not open this invitation</h1>
        <p className="mt-3 text-muted">Check your connection and try again. Nothing was changed on your wedding.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" className="inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo" onClick={onRetry}>
            Try again
          </button>
          <Link to="/" className="inline-flex min-h-11 items-center text-sm text-maroon">
            Home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="font-serif text-4xl">This invitation link is invalid or expired.</h1>
      <p className="mt-3 text-muted">Ask the couple for a new invitation link.</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          className="inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo"
          onClick={() => {
            if (!useWeddingStore.getState().weddings.some((item) => item.id === SEED_ID)) restoreSample();
            const sample = useWeddingStore.getState().weddings.find((item) => item.id === SEED_ID);
            if (!sample) return;
            focusWedding(sample.id, "guest");
            setViewerSide("Bride");
            void navigate({ to: "/w/$slug", params: { slug: sample.slug } });
          }}
        >
          View sample wedding
        </button>
        <Link to="/" className="inline-flex min-h-11 items-center text-sm text-maroon">
          Home
        </Link>
      </div>
    </main>
  );
}

export function JoinScreen({ code }: { code: string }) {
  const navigate = useNavigate();
  const wedding = useWeddingStore((s) => s.weddings.find((w) => w.slug === code.trim().toLowerCase()));
  const joinWedding = useWeddingStore((s) => s.joinWedding);
  const account = useWeddingStore((s) => s.account);
  const [name, setName] = useState(account?.name ?? "");
  const [rsvp, setRsvp] = useState<Rsvp>("yes");
  const [relationship, setRelationship] = useState<(typeof RELATIONSHIPS)[number]>(RELATIONSHIPS[1]);
  const [postingCode, setPostingCode] = useState("");
  const [note, setNote] = useState("");

  if (!wedding) return <CircleGate status="missing" />;

  return (
    <main className="min-h-dvh bg-ivory">
      <div className="mx-auto grid min-h-dvh max-w-5xl md:grid-cols-2">
        <div className="relative min-h-72">
          <CoverVisual src={wedding.cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/80 to-ink/10" />
          <div className="relative flex h-full flex-col justify-end p-6 text-on-photo">
            <Mark className="mb-4 size-9" />
            <p className="text-sm">You are invited</p>
            <h1 className="font-serif text-5xl">{coupleTitle(wedding)}</h1>
            <p className="mt-2">
              {longDate(wedding.date)} · {wedding.city}
            </p>
          </div>
        </div>
        <form
          className="flex flex-col justify-center gap-4 px-6 py-10"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
            const guestName = account?.name ?? name.trim();
            if (!guestName) {
              setNote("Add your name.");
              return;
            }
            const typed = postingCode.trim();
            const normalized = normalizeCode(typed);
            const sameCircle =
              !typed ||
              normalized === wedding.slug.toUpperCase() ||
              compactCode(normalized) === compactCode(wedding.slug) ||
              typed.toLowerCase().includes(`/w/${wedding.slug}`) ||
              typed.toLowerCase().includes(`/join/${wedding.slug}`);
            let matched = sameCircle ? undefined : codeMatch(wedding, normalized);
            let roleAuth: Awaited<ReturnType<typeof confirmWeddingRole>> | undefined;
            if (!sameCircle && !matched) {
              roleAuth = await confirmWeddingRole(wedding.slug, guestName, normalized);
              if (!roleAuth.ok) {
                setNote(roleAuth.error || "That code does not match this wedding.");
                return;
              }
              matched = { id: "server-validated", code: normalized, kind: roleAuth.role === "family" ? "family" : "guest" };
            }
            const result = joinWedding(wedding.slug, guestName, rsvp, relationship, matched ? normalized : "", matched?.kind);
            if (result === "bad-code" || result === "wrong-kind") {
              setNote("That code is not for this wedding. Family and guest codes are different.");
              return;
            }
            if (result === "disabled") {
              setNote("This wedding circle is paused. The host has closed it for now.");
              return;
            }
            if (result === "blocked") {
              setNote("The family has closed this circle to that name.");
              return;
            }
            if (result === "missing") {
              setNote("This invitation link is invalid or expired.");
              return;
            }
            if (matched) {
              const auth = roleAuth ?? await confirmWeddingRole(wedding.slug, guestName, normalized);
              if (auth.ok) applyRole(wedding.id, auth.role);
              else if (matched.kind === "family") {
                setNote(auth.error);
                return;
              }
            }
            if (result === "pending") setNote("The family will let you in. You can wait on the home of the wedding.");
            void navigate({ to: "/w/$slug", params: { slug: wedding.slug } });
            })();
          }}
        >
          <h2 className="font-serif text-3xl">Join the wedding</h2>
          <p className="text-sm text-muted">No account is required. Your name is how the family sees you.</p>
          {account ? (
            <p className="text-muted">
              Signed in as {account.name}. You can still enter as a guest.
            </p>
          ) : (
            <p className="rounded-2xl border border-line bg-paper px-4 py-3 text-sm">
              You can enter with your name. A Family/VIP-Guest code gives family access. A Guest code gives guest access.{" "}
              <Link to="/account" className="text-maroon">Sign in</Link>
            </p>
          )}
          <input
            className={fieldClass}
            placeholder="Your name"
            value={account?.name ?? name}
            readOnly={Boolean(account)}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={fieldClass}
            placeholder="Family/VIP-Guest code or Guest code, optional"
            value={postingCode}
            onChange={(e) => setPostingCode(e.target.value)}
          />
          <PickList
            label="How you know them"
            value={relationship}
            onChange={setRelationship}
            options={RELATIONSHIPS.map((item) => ({ value: item, label: item }))}
          />
          <PickList
            label="Reply"
            value={rsvp}
            onChange={setRsvp}
            options={[
              { value: "yes", label: "Attending" },
              { value: "maybe", label: "Maybe" },
              { value: "no", label: "Not attending" },
            ]}
          />
          <Button type="submit">Enter wedding</Button>
          {note ? <p className="text-sm text-muted">{note}</p> : null}
          {wedding.privacy.join === "approve" ? (
            <p className="text-sm text-muted">This wedding approves each guest. You will see a waiting state until the family lets you in.</p>
          ) : null}
        </form>
      </div>
    </main>
  );
}
