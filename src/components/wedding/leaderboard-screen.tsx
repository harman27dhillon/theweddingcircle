import { lazy, Suspense, useEffect } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { SEED_ID } from "@/lib/wedding/seed";
import { useWeddingStore } from "@/lib/wedding/store";
import { usePersistedReady } from "@/lib/wedding/use-circle";
import { activityScore, coupleTitle, daysUntil, isSampleCircle, visibleCircles } from "@/lib/wedding/format";
import { Mark } from "@/components/wedding/ui";
import type { Wedding } from "@/lib/wedding/types";

const CoverVisual = lazy(() => import("@/components/wedding/themes").then((mod) => ({ default: mod.CoverVisual })));

function RankCrown({ rank }: { rank: number }) {
  const gold = rank === 1;
  const tone = gold ? "text-gold" : rank === 2 ? "text-muted" : "text-maroon";
  const label = gold ? "Gold crown" : rank === 2 ? "Silver crown" : "Bronze crown";
  return (
    <svg viewBox="0 0 24 16" className={`h-4 w-5 ${tone}`} role="img" aria-label={label}>
      <path fill="currentColor" d="M2 14 L3.5 5 L8 9 L12 2 L16 9 L20.5 5 L22 14 Z" />
    </svg>
  );
}

function whenLabel(date: string) {
  const days = daysUntil(date);
  if (days > 1) return `${days} days left`;
  if (days === 1) return "Tomorrow";
  if (days === 0) return "Today";
  return "After the day";
}

export function LeaderboardScreen() {
  const navigate = useNavigate();
  const weddings = useWeddingStore((s) => s.weddings);
  const account = useWeddingStore((s) => s.account);
  const memberships = useWeddingStore((s) => s.memberships);
  const focusWedding = useWeddingStore((s) => s.focusWedding);
  const reviseSample = useWeddingStore((s) => s.reviseSample);
  const hydrated = usePersistedReady();
  const sample = weddings.find((item) => item.id === SEED_ID) ?? weddings.find((item) => isSampleCircle(item));
  const joined = visibleCircles(weddings, memberships ?? [], account?.name ?? "", account?.email ?? "");
  const listed = joined.length > 0 ? joined : sample ? [sample] : [];
  const board = [...listed].sort((a, b) => activityScore(b) - activityScore(a) || coupleTitle(a).localeCompare(coupleTitle(b)));

  useEffect(() => {
    let live = true;
    void import("@/lib/wedding/library").then(({ loadDeveloperPublicConfig }) => {
      void loadDeveloperPublicConfig()
        .then((config) => {
          if (!live) return;
          const current = useWeddingStore.getState().weddings.find((item) => item.id === SEED_ID);
          if (!current) return;
          const shown = config.sample?.src || "";
          const same =
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
    });
    return () => {
      live = false;
    };
  }, [reviseSample]);

  function openCircle(wedding: Wedding) {
    if (isSampleCircle(wedding) && !useWeddingStore.getState().weddings.some((item) => item.id === SEED_ID)) {
      useWeddingStore.getState().restoreSample();
    }
    const open = isSampleCircle(wedding) ? useWeddingStore.getState().weddings.find((item) => item.id === SEED_ID) ?? wedding : wedding;
    const owner = Boolean(account?.email && open.ownerEmail && open.ownerEmail.toLowerCase() === account.email.toLowerCase());
    focusWedding(open.id, owner ? "host" : "guest");
    if (isSampleCircle(open)) useWeddingStore.getState().setViewerSide("Bride");
    void navigate({ to: "/w/$slug", params: { slug: open.slug } });
  }

  return (
    <main className="min-h-dvh bg-ivory text-ink">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-4 lg:max-w-6xl lg:px-8">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 font-serif">
          <Mark className="size-8" />
          The Wedding Circle
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-16 lg:max-w-4xl lg:px-8">
        <div>
          <h1 className="font-serif text-4xl">Leaderboard</h1>
          <p className="mt-2 text-sm text-muted">Popular wedding circles, ranked by activity. A text is 2, a picture is 4, a long video is 6, and each live viewer is 1.</p>
        </div>
        {!hydrated ? (
          <p className="rounded-2xl border border-line bg-card px-4 py-6 text-sm text-muted" role="status">Loading rankings…</p>
        ) : null}
        {hydrated && board.length === 0 ? (
          <p className="rounded-3xl border border-gold/40 bg-card px-5 py-8 text-center font-serif text-lg text-ink">No wedding circles to rank yet.</p>
        ) : null}
        {hydrated && board.length > 0 ? (
          <ol className="flex flex-col gap-2.5 pt-4">
            {board.map((wedding, index) => {
              const rank = index + 1;
              const cover = wedding.cover?.trim() ?? "";
              const medal = rank === 1 ? "border-gold/70 bg-[#fff8ee]" : rank === 2 ? "border-line bg-card" : rank === 3 ? "border-maroon/30 bg-card" : "border-line bg-card";
              return (
                <li key={wedding.id}>
                  <button
                    type="button"
                    className={`flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left shadow-[0_10px_24px_-22px_rgba(28,20,18,0.8)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon active:translate-y-px ${medal}`}
                    onClick={() => openCircle(wedding)}
                  >
                    <span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-medium tabular-nums ${rank <= 3 ? "bg-ivory text-ink" : "text-muted"}`}>{rank}</span>
                    <span className="relative shrink-0">
                      <span className="grid size-14 place-items-center overflow-hidden rounded-full border border-line bg-paper">
                        {cover ? (
                          <Suspense fallback={<span className="text-[10px] text-muted">WC</span>}>
                            <CoverVisual src={cover} alt="" className="size-14 object-cover object-center" />
                          </Suspense>
                        ) : (
                          <span className="text-[10px] text-muted">WC</span>
                        )}
                      </span>
                      {rank <= 3 ? (
                        <span className="pointer-events-none absolute bottom-full left-1/2 z-[1] mb-0.5 -translate-x-1/2">
                          <RankCrown rank={rank} />
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-xl leading-tight">{coupleTitle(wedding)}</span>
                      <span className="mt-0.5 block text-sm text-muted">
                        {whenLabel(wedding.date)}
                        <span className="px-1.5">·</span>
                        {activityScore(wedding)} points
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>
    </main>
  );
}
