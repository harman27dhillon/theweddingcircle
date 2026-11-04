import { useEffect, useState } from "react";
import { AffiliateCredentials } from "@/components/wedding/affiliate-credentials";
import { DISCOVER_CATEGORIES } from "@/lib/wedding/discover";
import {
  developerDiscoverBots,
  developerReviewDiscoverProduct,
  developerRunDiscoverBot,
  developerSaveDiscoverBot,
} from "@/lib/wedding/discover.functions";

type Board = Awaited<ReturnType<typeof developerDiscoverBots>>;
type Bot = Extract<Board, { ok: true }>["bots"][number];

export function DiscoverBotsPanel({ token }: { token: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  async function reload() {
    const result = await developerDiscoverBots({ data: { token } });
    setBoard(result);
  }

  useEffect(() => {
    void reload();
  }, [token]);

  async function save(bot: Bot, draft: Bot, confirm: boolean) {
    const behavior =
      bot.enabled !== draft.enabled ||
      bot.scheduleEnabled !== draft.scheduleEnabled ||
      bot.scheduleHours !== draft.scheduleHours ||
      bot.moderate !== draft.moderate;
    if (behavior && !confirm && !window.confirm("This changes the schedule or what can be published. Save it?")) return;
    setBusy(bot.id);
    setNote("");
    try {
      const result = await developerSaveDiscoverBot({
        data: {
          token,
          id: draft.id,
          enabled: draft.enabled,
          keywords: draft.keywords,
          categories: draft.categories,
          scheduleEnabled: draft.scheduleEnabled,
          scheduleHours: draft.scheduleHours,
          maxResults: draft.maxResults,
          freshnessDays: draft.freshnessDays,
          moderate: draft.moderate,
          rankingNote: draft.rankingNote,
          confirm: behavior,
        },
      });
      setNote(result.ok ? `${draft.name} was saved.` : result.error);
      if (result.ok) await reload();
    } catch {
      setNote("That bot could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function run(bot: Bot) {
    setBusy(bot.id);
    setNote("");
    try {
      const result = await developerRunDiscoverBot({ data: { token, id: bot.id } });
      setNote(result.ok ? `${bot.name}: ${result.detail}` : result.error);
      await reload();
    } catch {
      setNote("That run could not be started.");
    } finally {
      setBusy("");
    }
  }

  async function review(id: string, action: "publish" | "hold" | "exclude" | "restore") {
    setBusy(id);
    try {
      const result = await developerReviewDiscoverProduct({ data: { token, id, action } });
      setNote(result.ok ? "The product was updated." : result.error);
      if (result.ok) await reload();
    } catch {
      setNote("That product could not be updated.");
    } finally {
      setBusy("");
    }
  }

  if (!board) return <p>Loading discovery bots…</p>;
  if (!board.ok) return <p>{board.error}</p>;
  return (
    <section>
      <h1 className="font-serif text-4xl">Discover bots</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">
        These controls stay in the developer center. A bot that is not connected does not invent products. Credentials below are submitted to the server and are not kept in this browser.
      </p>
      {note ? <p className="mt-4 text-sm">{note}</p> : null}
      <div className="mt-6">
        <AffiliateCredentials token={token} />
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {board.bots.map((bot) => (
          <BotCard key={bot.id} bot={bot} busy={busy === bot.id} runs={board.runs.filter((run) => run.botId === bot.id)} onSave={(draft) => void save(bot, draft, false)} onRun={() => void run(bot)} />
        ))}
      </div>
      <div className="mt-8">
        <h2 className="font-serif text-2xl">Products</h2>
        {board.products.length === 0 ? <p className="mt-2 text-sm text-on-photo/70">No products to review. An unconnected bot does not create listings.</p> : (
          <ul className="mt-3 divide-y divide-on-photo/10 rounded-2xl border border-on-photo/10">
            {board.products.map((product) => (
              <li key={product.id} className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block">{product.name}</span>
                  <span className="text-on-photo/70">{product.sourceLabel} · {product.category} · {product.excluded ? "Excluded" : product.published ? "Published" : "Held"}</span>
                </span>
                <span className="flex flex-wrap gap-2">
                  <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-3" disabled={busy === product.id} onClick={() => void review(product.id, "publish")}>Publish</button>
                  <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-3" disabled={busy === product.id} onClick={() => void review(product.id, "hold")}>Hold</button>
                  <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-3" disabled={busy === product.id} onClick={() => void review(product.id, product.excluded ? "restore" : "exclude")}>{product.excluded ? "Restore" : "Exclude"}</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function BotCard({ bot, busy, runs, onSave, onRun }: { bot: Bot; busy: boolean; runs: Extract<Board, { ok: true }>["runs"]; onSave: (draft: Bot) => void; onRun: () => void }) {
  const [draft, setDraft] = useState(bot);
  useEffect(() => setDraft(bot), [bot]);
  const selected = new Set(draft.categories.split(",").map((item) => item.trim()).filter(Boolean));
  return (
    <article className="rounded-2xl border border-on-photo/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">{bot.name}</h2>
          <p className="mt-1 text-sm text-on-photo/70">{bot.specialization}</p>
        </div>
        <p className="rounded-full border border-on-photo/20 px-3 py-1 text-sm">{bot.connection}</p>
      </div>
      <p className="mt-3 text-sm text-on-photo/70">{bot.detail}</p>
      <dl className="mt-3 grid gap-1 text-sm text-on-photo/80 sm:grid-cols-2">
        <div>Enabled: {bot.enabled ? "Yes" : "Paused"}</div>
        <div>Valid products: {bot.productCount}</div>
        <div>Last run: {bot.lastRunAt ? new Date(bot.lastRunAt).toLocaleString() : "Never"}</div>
        <div>Last success: {bot.lastSuccessAt ? new Date(bot.lastSuccessAt).toLocaleString() : "Never"}</div>
        <div>Next run: {bot.nextRunAt ? new Date(bot.nextRunAt).toLocaleString() : "Not scheduled"}</div>
        <div>Operational: No</div>
      </dl>
      {bot.missing.length > 0 ? <p className="mt-2 text-sm">Missing: {bot.missing.join(", ")}</p> : null}
      {bot.lastError ? <p className="mt-2 text-sm">Last error: {bot.lastError}</p> : null}
      <label className="mt-4 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
        Enable this bot
      </label>
      <label className="mt-2 block text-sm">
        Search phrases
        <textarea className="mt-1 min-h-20 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} />
      </label>
      <fieldset className="mt-3">
        <legend className="text-sm">Categories</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DISCOVER_CATEGORIES.filter((item) => item.id !== "all").map((item) => (
            <label key={item.id} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-on-photo/20 px-3 text-sm">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  setDraft({ ...draft, categories: [...next].join(",") });
                }}
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          Hours between runs
          <input className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" type="number" min={6} max={168} value={draft.scheduleHours} onChange={(event) => setDraft({ ...draft, scheduleHours: Number(event.target.value) })} />
        </label>
        <label className="text-sm">
          Maximum results
          <input className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" type="number" min={1} max={40} value={draft.maxResults} onChange={(event) => setDraft({ ...draft, maxResults: Number(event.target.value) })} />
        </label>
        <label className="text-sm">
          Fresh for days
          <input className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" type="number" min={1} max={60} value={draft.freshnessDays} onChange={(event) => setDraft({ ...draft, freshnessDays: Number(event.target.value) })} />
        </label>
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.scheduleEnabled} onChange={(event) => setDraft({ ...draft, scheduleEnabled: event.target.checked })} />
        Schedule runs
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={draft.moderate} onChange={(event) => setDraft({ ...draft, moderate: event.target.checked })} />
        Hold new products for review
      </label>
      <label className="mt-2 block text-sm">
        Ranking note
        <textarea className="mt-1 min-h-16 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={draft.rankingNote} onChange={(event) => setDraft({ ...draft, rankingNote: event.target.value })} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full bg-maroon px-4 text-sm" disabled={busy} onClick={() => onSave(draft)}>Save</button>
        <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" disabled={busy} onClick={onRun}>{busy ? "Working…" : "Run now"}</button>
      </div>
      {runs.length > 0 ? (
        <ul className="mt-4 text-sm text-on-photo/70">
          {runs.slice(0, 3).map((run) => (
            <li key={run.id}>{run.status} · found {run.found}{run.error ? ` · ${run.error}` : ""}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}
