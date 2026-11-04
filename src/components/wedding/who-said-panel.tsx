import { useEffect, useRef, useState } from "react";
import { CartoonAvatar, lookupProfile } from "@/components/wedding/guest-profile";
import { useWedding } from "@/components/wedding/context";
import { useMediaUrl } from "@/components/wedding/ui";
import { circleKey } from "@/lib/wedding/circle-key";
import { entryCodeFor } from "@/lib/wedding/member-key";
import { SEEK_BUSY, SEEK_HELP, SEEK_JOIN, SEEK_PROMPT, type SeekIntent } from "@/lib/wedding/seek";
import { askSeek, shareSeekReply } from "@/lib/wedding/seek.functions";
import { useWeddingStore } from "@/lib/wedding/store";
import type { FeedPost, Wedding } from "@/lib/wedding/types";
import { guessWhoSaidAuthor, lockWhoSaidRound, startWhoSaidRound, submitWhoSaidLine, syncWhoSaidRound } from "@/lib/wedding/who-said.functions";

type Line = NonNullable<FeedPost["gameCard"]>["lines"][number];
type Author = { token: string; name: string };
type Pick = { statementId: string; token: string; name: string };
type RoundView = {
  id: string;
  phase: "submit" | "guess" | "revealed" | "empty";
  prompt: string;
  starterName: string;
  youStarted: boolean;
  submitted: boolean;
  submitDeadline: number;
  guessDeadline: number;
  serverNow: number;
  lines: Line[];
  authors: Author[];
  picks: Pick[];
  score: number | null;
  scoreText: string;
};

type Play =
  | { ok: true; round: RoundView | null; cards?: FeedPost[] }
  | { ok: false; error: string; round?: RoundView };

function remain(deadline: number, now: number) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function applyCards(weddingId: string, cards: FeedPost[] | undefined) {
  if (!cards?.length) return;
  useWeddingStore.setState((state) => ({
    weddings: state.weddings.map((wedding) => {
      if (wedding.id !== weddingId) return wedding;
      const posts = [...(wedding.posts ?? [])];
      for (const card of cards) {
        const index = posts.findIndex((item) => item.id === card.id);
        if (index >= 0) posts[index] = { ...posts[index], ...card };
        else posts.unshift(card);
      }
      return { ...wedding, posts };
    }),
  }));
}

function faceFor(wedding: Wedding, name: string) {
  const found = lookupProfile(wedding, name);
  const photo = found && !found.profile.removed ? found.profile.photo || "" : "";
  return { photo, seed: found?.key || name || "guest" };
}

export function SeekMark() {
  return <span className="seek-mark" aria-hidden="true">S</span>;
}

function SeekPortrait({ name, photo, seed }: { name: string; photo?: string; seed: string }) {
  const { url } = useMediaUrl(photo || "");
  return url ? <img src={url} alt="" /> : <CartoonAvatar seed={seed || name} />;
}

function SeekFace({ name, photo, seed }: { name: string; photo?: string; seed: string }) {
  return (
    <span className="seek-person">
      <SeekPortrait name={name} photo={photo} seed={seed} />
      <span>{name}</span>
    </span>
  );
}

export function WhoSaidCard({ card }: { card: NonNullable<FeedPost["gameCard"]> }) {
  const wedding = useWedding();
  return (
    <article className="who-said-card seek-card" aria-label="Who Said It?">
      <p className="who-said-kicker">Seek · Who Said It?</p>
      <p className="who-said-prompt">{card.prompt}</p>
      {card.phase === "empty" ? <p className="who-said-note">Nobody sent a line, so this round is closed.</p> : null}
      {card.lines.length > 0 ? (
        <ol className="who-said-lines">
          {card.lines.map((line) => {
            const face = faceFor(wedding, line.authorName || "");
            return (
              <li key={line.id} className={line.result ? `is-${line.result}` : undefined}>
                <span className="min-w-0 flex-1">
                  <span className="block">{line.text}</span>
                  {line.result ? (
                    <span className="who-said-meta">
                      {line.authorName ? <SeekFace name={line.authorName} photo={face.photo} seed={face.seed} /> : null}
                      <span>{line.result === "correct" ? "Correct" : line.result === "wrong" ? `Incorrect${line.guessName ? `, guessed ${line.guessName}` : ""}` : "Not guessed"}</span>
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
      {card.scoreText ? <p className="who-said-score">Score · {card.scoreText}</p> : null}
    </article>
  );
}

export function SeekHost({
  weddingId,
  slug,
  name,
  memberKey,
  canPlay,
}: {
  weddingId: string;
  slug: string;
  name: string;
  memberKey: string;
  canPlay: boolean;
}) {
  const wedding = useWedding();
  const [line, setLine] = useState("");
  const [round, setRound] = useState<RoundView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [openId, setOpenId] = useState("");
  const [turns, setTurns] = useState<{ id: string; query: string; answer: string; sources: { id: string; author: string; excerpt: string; kind: string }[] }[]>([]);
  const [asking, setAsking] = useState(false);
  const roundRef = useRef<RoundView | null>(null);
  const canRef = useRef(canPlay);
  const keyRef = useRef(memberKey);
  roundRef.current = round;
  canRef.current = canPlay;
  keyRef.current = memberKey;

  function identity() {
    return { slug, memberKey: keyRef.current, editKey: circleKey(slug), name, code: entryCodeFor(slug) };
  }

  function pushNote(text: string) {
    setNotes((current) => [...current, text].slice(-3));
  }

  function take(result: Play, quiet = false) {
    if (result.ok) {
      setRound(result.round);
      setNow(result.round?.serverNow ?? Date.now());
      applyCards(weddingId, result.cards);
      return result;
    }
    if (result.round) setRound(result.round);
    if (!quiet && result.error) pushNote(result.error);
    return result;
  }

  useEffect(() => {
    if (!canPlay || !memberKey || !name.trim() || slug === "lila-nico") return;
    let stop = false;
    const pull = () => {
      void syncWhoSaidRound({ data: identity() })
        .then((result) => {
          if (!stop) take(result as Play, true);
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 3000);
    const clock = window.setInterval(() => {
      setNow(Date.now());
      const live = roundRef.current;
      if (!live) return;
      const skew = Date.now() - live.serverNow;
      const clockNow = Date.now() - skew;
      const due = (live.phase === "submit" && clockNow >= live.submitDeadline) || (live.phase === "guess" && clockNow >= live.guessDeadline);
      if (due) pull();
    }, 1000);
    return () => {
      stop = true;
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [canPlay, memberKey, name, slug, weddingId]);

  useEffect(() => {
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<SeekIntent | { intent?: SeekIntent; text?: string }>).detail;
      const intent = typeof detail === "string" ? detail : detail?.intent;
      const text = typeof detail === "string" ? "" : detail?.text ?? "";
      if (!canRef.current || !keyRef.current) {
        pushNote(SEEK_JOIN);
        return;
      }
      if (intent === "help") {
        pushNote(SEEK_HELP);
        return;
      }
      if (intent === "ask") {
        setAsking(true);
        const eventId = `ask_${keyRef.current}_${Date.now().toString(36)}`;
        void askSeek({ data: { ...identity(), text, eventId } })
          .then((result) => {
            const reply = result as { ok?: boolean; error?: string; kind?: string; id?: string; answer?: string; sources?: { id: string; author: string; excerpt: string; kind: string }[] };
            if (reply.kind === "game") {
              window.dispatchEvent(new CustomEvent("wc-seek", { detail: "start" }));
              return;
            }
            if (!reply.ok || !reply.answer) {
              pushNote(reply.error || "Seek could not check this wedding. The question was not posted to the group.");
              return;
            }
            setTurns((current) => [...current, { id: reply.id || eventId, query: text, answer: reply.answer || "", sources: reply.sources ?? [] }].slice(-8));
          })
          .catch(() => pushNote("Seek could not check this wedding. The question was not posted to the group."))
          .finally(() => setAsking(false));
        return;
      }
      if (intent !== "start") {
        pushNote(SEEK_HELP);
        return;
      }
      const live = roundRef.current;
      if (live && (live.phase === "submit" || live.phase === "guess")) {
        pushNote(SEEK_BUSY);
        return;
      }
      setBusy(true);
      void startWhoSaidRound({ data: { ...identity(), prompt: SEEK_PROMPT } })
        .then((result) => {
          const played = take(result as Play);
          if (played.ok && played.round && !played.round.youStarted && (played.round.phase === "submit" || played.round.phase === "guess")) {
            pushNote(SEEK_BUSY);
          }
        })
        .catch(() => pushNote("That round could not be started. Try again."))
        .finally(() => setBusy(false));
    };
    window.addEventListener("wc-seek", onSeek);
    return () => window.removeEventListener("wc-seek", onSeek);
  }, [slug, name, weddingId]);

  async function run(work: Promise<Play>) {
    setBusy(true);
    try {
      return take(await work);
    } catch {
      pushNote("That could not be saved. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const deadline = round?.phase === "submit" ? round.submitDeadline : round?.phase === "guess" ? round.guessDeadline : 0;
  const skew = round ? Date.now() - round.serverNow : 0;
  const clock = now - skew;
  const picks = new Map((round?.picks ?? []).map((item) => [item.statementId, item]));
  const ready = Boolean(round && round.phase === "guess" && round.lines.length > 0 && round.lines.every((item) => picks.has(item.id)));
  const live = round && (round.phase === "submit" || round.phase === "guess") ? round : null;

  return (
    <div className="seek-thread" data-seek="">
      {notes.map((text, index) => (
        <div className="seek-row" key={`${index}-${text.slice(0, 24)}`}>
          <SeekMark />
          <div className="seek-body">
            <p className="seek-name">Seek</p>
            <p>{text}</p>
          </div>
        </div>
      ))}
      {asking ? <p className="seek-clock">Seek is looking…</p> : null}
      {turns.map((turn) => (
        <div className="seek-row" key={turn.id}>
          <SeekMark />
          <div className="seek-body seek-private">
            <p className="seek-name">Seek · Automated companion</p>
            <p className="who-said-note">Private result. The group cannot see this.</p>
            <p>{turn.answer}</p>
            {turn.sources.length ? (
              <div className="seek-people">
                {turn.sources.map((source) => (
                  <button
                    key={source.id}
                    type="button"
                    className="seek-person"
                    onClick={() => document.querySelector(`[data-post-id="${CSS.escape(source.id)}"]`)?.scrollIntoView({ block: "center" })}
                  >
                    Jump to {source.author}
                  </button>
                ))}
              </div>
            ) : null}
            <button
              type="button"
              className="seek-lock"
              onClick={() => {
                const share = window.confirm(`Share this with the group?\n\n${turn.answer}`);
                if (!share) return;
                void shareSeekReply({ data: { ...identity(), turnId: turn.id } }).then((result) => {
                  const saved = result as { ok?: boolean; error?: string; post?: { id: string } };
                  if (!saved.ok) pushNote(saved.error || "That was not shared.");
                  else pushNote("Shared with the group. Your question stayed private.");
                }).catch(() => pushNote("That was not shared."));
              }}
            >
              Share with group
            </button>
          </div>
        </div>
      ))}
      {live?.phase === "submit" ? (
        <div className="seek-row">
          <SeekMark />
          <div className="seek-body">
            <p className="seek-name">Seek</p>
            <p>A new Who Said It? round has started.</p>
            <p className="seek-clock" aria-live="polite">{remain(live.submitDeadline, clock)}</p>
            {live.youStarted ? <p className="who-said-note">You started this round. Everyone else can send one anonymous line.</p> : null}
            {!live.youStarted && live.submitted ? <p className="who-said-note">Your line was received. Nobody can see who wrote it.</p> : null}
            {!live.youStarted && !live.submitted ? (
              <form
                className="seek-bar"
                onSubmit={(event) => {
                  event.preventDefault();
                  const text = line.trim();
                  if (!text) return;
                  void run(submitWhoSaidLine({ data: { ...identity(), roundId: live.id, text } }) as Promise<Play>).then((played) => {
                  if (played?.ok) setLine("");
                });
                }}
              >
                <label className="sr-only" htmlFor="seek-line">Your anonymous line</label>
                <input id="seek-line" maxLength={200} value={line} placeholder="One anonymous line" onChange={(event) => setLine(event.target.value)} />
                <button type="submit" className="seek-lock" disabled={busy || !line.trim()}>Send</button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}
      {live?.phase === "guess" ? (
        <div className="seek-row">
          <SeekMark />
          <div className="seek-body">
            <p className="seek-name">Seek</p>
            <p>{live.youStarted ? "Guess who wrote each line." : `${live.starterName} is guessing.`}</p>
            <p className="seek-clock" aria-live="polite">{remain(deadline, clock)}</p>
            <ol className="who-said-lines">
              {live.lines.map((item) => {
                const pick = picks.get(item.id);
                const open = live.youStarted && openId === item.id;
                return (
                  <li key={item.id} className={pick ? "is-picked" : undefined}>
                    <span className="min-w-0 flex-1">
                      {live.youStarted ? (
                        <button
                          type="button"
                          className="seek-line"
                          aria-expanded={open}
                          onClick={() => setOpenId((current) => current === item.id ? "" : item.id)}
                        >
                          {item.text}
                        </button>
                      ) : <span className="seek-line is-quiet">{item.text}</span>}
                      {pick ? <span className="who-said-meta">Guessed {pick.name}</span> : <span className="who-said-meta">Not guessed yet</span>}
                      {open ? (
                        <span className="seek-people">
                          {live.authors.map((author) => {
                            const face = faceFor(wedding, author.name);
                            return (
                              <button
                                key={author.token}
                                type="button"
                                className="seek-person"
                                onClick={() => {
                                  void run(guessWhoSaidAuthor({ data: { ...identity(), roundId: live.id, statementId: item.id, token: author.token } }) as Promise<Play>);
                                }}
                              >
                                <SeekPortrait name={author.name} photo={face.photo} seed={face.seed} />
                                <span>{author.name}</span>
                              </button>
                            );
                          })}
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            {live.youStarted ? <p className="who-said-note">{live.picks.length} of {live.lines.length} guesses.</p> : null}
            {live.youStarted && ready ? (
              <button
                type="button"
                className="seek-lock"
                disabled={busy}
                onClick={() => {
                  void run(lockWhoSaidRound({ data: { ...identity(), roundId: live.id } }) as Promise<Play>);
                }}
              >
                Lock It
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
