import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { CircleGate, JoinScreen } from "@/components/wedding/join-screen";
import { WeddingProvider } from "@/components/wedding/context";
import { Shell } from "@/components/wedding/shell";
import { coupleTitle, isCircleOwner, isSampleCircle } from "@/lib/wedding/format";
import { circleEntry, formatUtc } from "@/lib/wedding/lifecycle";
import { normalizeWedding } from "@/lib/wedding/normalize";
import { loadCircle } from "@/lib/wedding/publish";
import { applyRole, refreshWeddingRole, registerHostAuthority, type AuthorizedRole } from "@/lib/wedding/role-client";
import { reconcileCreator } from "@/lib/wedding/host-identity";
import { circleKey } from "@/lib/wedding/circle-key";
import { useCircle } from "@/lib/wedding/use-circle";
import { useWeddingStore } from "@/lib/wedding/store";

export const Route = createFileRoute("/w/$slug")({
  component: WeddingLayout,
});

function WeddingLayout() {
  const { slug } = Route.useParams();
  const { status, wedding: raw, retry } = useCircle(slug);
  const viewer = useWeddingStore((s) => s.viewer);
  const accountId = useWeddingStore((s) => s.account?.id || "");
  const accountEmail = useWeddingStore((s) => s.account?.email || "");
  const applyRemoteCircle = useWeddingStore((s) => s.applyRemoteCircle);
  const wedding = raw ? normalizeWedding(raw) : undefined;

  useEffect(() => {
    if (!wedding || isSampleCircle(wedding)) return;
    let live = true;
    const state = useWeddingStore.getState();
    const ownerEmail = (wedding.ownerEmail || "").trim().toLowerCase();
    const matching = ownerEmail ? state.accounts.filter((account) => (account.email || "").trim().toLowerCase() === ownerEmail).length : 0;
    const decision = reconcileCreator({
      ownerId: wedding.ownerId,
      ownerEmail: wedding.ownerEmail,
      accountId: state.account?.id || "",
      accountEmail: state.account?.email || "",
      matchingAccounts: matching,
      hasEditKey: Boolean(circleKey(wedding.slug)),
    });
    if (decision.ownerId && decision.ownerId !== (wedding.ownerId || "")) {
      useWeddingStore.setState((current) => ({
        weddings: current.weddings.map((item) => (item.id === wedding.id ? { ...item, ownerId: decision.ownerId, ownerReview: false } : item)),
      }));
    } else if (decision.review && !wedding.ownerReview) {
      useWeddingStore.setState((current) => ({
        weddings: current.weddings.map((item) => (item.id === wedding.id ? { ...item, ownerReview: true } : item)),
      }));
    }
    let expected: AuthorizedRole | null = decision.host ? "host" : null;
    if (decision.host) applyRole(wedding.id, "host");
    const unsub = useWeddingStore.subscribe((next) => {
      if (!live || expected === null || next.viewer.weddingId !== wedding.id) return;
      const actual: AuthorizedRole =
        next.viewer.role === "host" ? "host" : next.viewer.role === "cohost" ? "cohost" : next.viewer.coded ? "family" : "guest";
      if (actual !== expected) applyRole(wedding.id, expected);
    });
    void (async () => {
      let result = await refreshWeddingRole(wedding.slug);
      if (circleKey(wedding.slug) && result.role !== "host") {
        const registered = await registerHostAuthority(wedding);
        if (registered.ok) result = { ok: true as const, role: "host" as const, memberKey: registered.memberKey, review: false };
      }
      if (!live || useWeddingStore.getState().viewer.weddingId !== wedding.id) return;
      const ownerNow = useWeddingStore.getState().account?.id && useWeddingStore.getState().weddings.find((item) => item.id === wedding.id)?.ownerId === useWeddingStore.getState().account?.id;
      if (decision.host || ownerNow) expected = "host";
      else if (result.review) expected = "guest";
      else if (result.role) expected = result.role;
      else expected = "guest";
      applyRole(wedding.id, expected);
    })();
    const timer = window.setInterval(() => {
      void refreshWeddingRole(wedding.slug).then((result) => {
        if (!live || useWeddingStore.getState().viewer.weddingId !== wedding.id) return;
        const ownerNow = useWeddingStore.getState().account?.id && useWeddingStore.getState().weddings.find((item) => item.id === wedding.id)?.ownerId === useWeddingStore.getState().account?.id;
        if (decision.host || ownerNow) expected = "host";
        else if (result.role) expected = result.role;
        else expected = "guest";
        applyRole(wedding.id, expected);
      });
    }, 8000);
    return () => {
      live = false;
      window.clearInterval(timer);
      unsub();
    };
  }, [wedding?.id, wedding?.slug, accountId, accountEmail]);

  useEffect(() => {
    if (status !== "ready") return;
    const current = useWeddingStore.getState().weddings.find((item) => item.slug === slug.trim().toLowerCase());
    if (!current || isSampleCircle(current) || !isCircleOwner(current)) return;
    let cancel = false;
    void loadCircle(current.slug)
      .then((remote) => {
        if (!cancel && remote) applyRemoteCircle(remote);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [slug, status, applyRemoteCircle]);

  if (!wedding || status !== "ready") {
    return <CircleGate status={status === "ready" ? "missing" : status} onRetry={retry} />;
  }

  const owner = isCircleOwner(wedding);
  const paused = Boolean(wedding.disabled) && !owner;
  if (paused) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <p className="text-sm text-muted">Wedding Circle</p>
        <h1 className="mt-2 font-serif text-4xl">This wedding circle is paused</h1>
        <p className="mt-3 text-muted">The host has closed it for now. Family and guests cannot enter until it is opened again.</p>
        <Link to="/" className="mt-6 inline-block text-maroon">
          Home
        </Link>
      </main>
    );
  }

  const entryRole = viewer.role === "cohost" ? "cohost" : viewer.role === "host" || owner ? "host" : viewer.role;
  const entry = circleEntry(wedding, entryRole, Date.now());
  if (entry !== "open") {
    const when = wedding.expiresAt ? formatUtc(wedding.expiresAt) : "";
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <p className="text-sm text-muted">Wedding Circle</p>
        <h1 className="mt-2 font-serif text-4xl">{entry === "ended" ? "This wedding circle has closed" : "This wedding circle has expired"}</h1>
        <p className="mt-3 text-muted">
          {entry === "ended"
            ? "The cloud media retention period has ended. Photos, videos, and chat from this circle are no longer available."
            : `Guests cannot enter after ${when}. The host can still open it until the cloud media retention ends.`}
        </p>
        <Link to="/" className="mt-6 inline-block text-maroon">
          Home
        </Link>
      </main>
    );
  }

  if (viewer.weddingId !== wedding.id) {
    return <JoinScreen code={slug} />;
  }

  const me = wedding.guests.find((g) => g.name.toLowerCase() === viewer.name.toLowerCase());
  if (me?.blocked && viewer.role !== "host") {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <h1 className="font-serif text-4xl">This circle is closed to you</h1>
        <p className="mt-3 text-muted">The family has removed your access. The wedding stays private.</p>
        <Link to="/" className="mt-6 inline-block text-maroon">
          Home
        </Link>
      </main>
    );
  }
  const waiting = wedding.privacy.join === "approve" && viewer.role === "guest" && me && !me.joined;

  if (waiting) {
    return (
      <main className="mx-auto max-w-lg px-6 py-20">
        <p className="text-sm text-muted">Wedding Circle</p>
        <h1 className="mt-2 font-serif text-4xl">{coupleTitle(wedding)}</h1>
        <p className="mt-3 text-muted">
          {viewer.name}, the family approves each guest. You are on the list. The wedding opens when they let you in.
        </p>
        <Link to="/" className="mt-6 inline-block text-maroon">
          Home
        </Link>
      </main>
    );
  }

  return (
    <WeddingProvider wedding={wedding}>
      <Shell>
        <Outlet />
      </Shell>
    </WeddingProvider>
  );
}
