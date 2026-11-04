import { Lock, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { circleKey } from "@/lib/wedding/circle-key";
import { entryCodeFor } from "@/lib/wedding/member-key";
import { addPollOption, createPoll, votePoll } from "@/lib/wedding/poll.functions";
import type { PollView } from "@/lib/wedding/poll";
import { clockLabel, type WhisperView } from "@/lib/wedding/whisper";
import { deleteWhisper, revealWhisper, sendWhisper } from "@/lib/wedding/whisper.functions";

export type CircleIdentity = { slug: string; memberKey: string; editKey: string; name: string; code: string };

export function circleIdentity(slug: string, memberKey: string, name: string): CircleIdentity {
  return { slug, memberKey, editKey: circleKey(slug), name, code: entryCodeFor(slug) };
}

export function ActivityBar({
  polls,
  whispers,
  voiceLive,
  whisperOnly,
  onWhisperOnly,
  onJump,
  onVote,
}: {
  polls: PollView[];
  whispers: WhisperView[];
  voiceLive: boolean;
  whisperOnly: boolean;
  onWhisperOnly: (on: boolean) => void;
  onJump: (postId: string) => void;
  onVote: (pollId: string, optionIds: string[]) => void;
}) {
  const active = polls.filter((poll) => !poll.closed);
  const unvoted = active.some((poll) => !poll.voted);
  const [open, setOpen] = useState(false);
  if (!active.length && !voiceLive && !whispers.length) return null;
  const bits = [
    active.length ? `${active.length} active poll${active.length === 1 ? "" : "s"}` : "",
    voiceLive ? "Live voice" : "",
    whispers.length ? `${whispers.length} whisper${whispers.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return (
    <div className="activity-bar">
      <button type="button" className="activity-summary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span>Group activity</span>
        <span>{bits.join(" · ")}</span>
        {unvoted ? <span className="activity-dot" aria-label="You have not voted">Needs your vote</span> : null}
      </button>
      {whispers.length ? (
        <button type="button" className="activity-filter" aria-pressed={whisperOnly} onClick={() => onWhisperOnly(!whisperOnly)}>
          <Lock className="size-3.5" aria-hidden /> Whispers
        </button>
      ) : null}
      {open ? (
        <div className="activity-sheet" role="dialog" aria-label="Group activity">
          <div className="activity-sheet-head">
            <p>Active in this chat</p>
            <button type="button" aria-label="Close activity" onClick={() => setOpen(false)}><X className="size-4" /></button>
          </div>
          {voiceLive ? <p className="activity-note">Voice chat is on. The microphone controls stay where they are.</p> : null}
          {active.map((poll) => (
            <PollCard key={poll.id} poll={poll} onVote={onVote} onJump={() => { onJump(poll.postId); setOpen(false); }} />
          ))}
          {whispers.map((whisper) => (
            <button key={whisper.id} type="button" className="activity-jump" onClick={() => { onJump(whisper.parentPostId); setOpen(false); }}>
              {whisper.collapsed ? `Whisper from ${whisper.senderName}` : whisper.mine ? `Whisper to ${whisper.recipientName}` : `Whisper from ${whisper.senderName}`}
            </button>
          ))}
          {!active.length && !whispers.length ? <p className="activity-note">Nothing else is waiting.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function PollCard({ poll, onVote, onJump }: { poll: PollView; onVote: (pollId: string, optionIds: string[]) => void; onJump?: () => void }) {
  const [picked, setPicked] = useState<string[]>(poll.options.filter((option) => option.mine).map((option) => option.id));
  useEffect(() => {
    setPicked(poll.options.filter((option) => option.mine).map((option) => option.id));
  }, [poll]);
  const total = poll.options.reduce((sum, option) => sum + (option.count ?? 0), 0);
  function choose(id: string) {
    if (poll.closed) return;
    const next = poll.multiple ? (picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]) : [id];
    setPicked(next);
    if (!poll.multiple) onVote(poll.id, next);
  }
  return (
    <article className={`poll-card${poll.closed ? " is-closed" : ""}`}>
      <p className="poll-kicker">{poll.closed ? "Poll closed" : "Poll"}{poll.anonymous ? " · Anonymous" : ""}</p>
      <h3>{poll.question}</h3>
      <ul>
        {poll.options.map((option) => {
          const width = poll.countsVisible && total > 0 && option.count != null ? Math.round((option.count / total) * 100) : 0;
          return (
            <li key={option.id}>
              <button type="button" className={option.leading ? "is-leading" : ""} aria-pressed={picked.includes(option.id)} disabled={poll.closed} onClick={() => choose(option.id)}>
                <span>{option.label}</span>
                {poll.countsVisible && option.count != null ? <span>{option.count}</span> : null}
                {poll.countsVisible ? <i style={{ width: `${width}%` }} /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {poll.multiple && !poll.closed ? <button type="button" className="poll-save" onClick={() => onVote(poll.id, picked)}>Save votes</button> : null}
      <p className="poll-meta">
        {poll.voterCount == null ? "Results stay hidden for now." : `${poll.voterCount} voted`}
        {poll.tie ? " · Tie" : ""}
        {poll.expiresAt && !poll.closed ? ` · Ends ${new Date(poll.expiresAt).toLocaleString()}` : ""}
      </p>
      {onJump ? <button type="button" className="poll-jump" onClick={onJump}>View in chat</button> : null}
    </article>
  );
}

export function PollComposer({ identity, onClose, onCreated }: { identity: CircleIdentity; onClose: () => void; onCreated: (post: { id: string; pollId?: string; text: string; author: string; at?: string }) => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [changeVotes, setChangeVotes] = useState(true);
  const [addOptions, setAddOptions] = useState(false);
  const [results, setResults] = useState("immediate");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="poll-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        const expiresAt = expiry === "15" ? new Date(Date.now() + 15 * 60_000).toISOString() : expiry === "60" ? new Date(Date.now() + 3_600_000).toISOString() : expiry === "1440" ? new Date(Date.now() + 86_400_000).toISOString() : expiry === "custom" ? (document.getElementById("poll-when") as HTMLInputElement | null)?.value ? new Date((document.getElementById("poll-when") as HTMLInputElement).value).toISOString() : "" : "";
        void createPoll({ data: { ...identity, question, options, multiple, anonymous, changeVotes, addOptions, results, expiresAt } })
          .then((result) => {
            const saved = result as { ok?: boolean; error?: string; post?: { id: string; pollId?: string; text: string; author: string; at?: string } };
            if (!saved.ok || !saved.post) setError(saved.error || "The poll was not posted.");
            else onCreated(saved.post);
          })
          .catch(() => setError("The poll was not posted."))
          .finally(() => setBusy(false));
      }}
    >
      <div className="activity-sheet-head">
        <p>Create poll</p>
        <button type="button" aria-label="Close poll" onClick={onClose}><X className="size-4" /></button>
      </div>
      <label>Question<input value={question} maxLength={140} onChange={(event) => setQuestion(event.target.value)} required /></label>
      {options.map((option, index) => (
        <label key={index}>Answer {index + 1}
          <input value={option} maxLength={80} onChange={(event) => setOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required={index < 2} />
        </label>
      ))}
      <div className="poll-actions">
        {options.length < 12 ? <button type="button" onClick={() => setOptions((current) => [...current, ""])}><Plus className="size-3.5" aria-hidden /> Add answer</button> : null}
        {options.length > 2 ? <button type="button" onClick={() => setOptions((current) => current.slice(0, -1))}>Remove last</button> : null}
      </div>
      <label className="poll-check"><input type="checkbox" checked={multiple} onChange={(event) => setMultiple(event.target.checked)} /> More than one answer</label>
      <label className="poll-check"><input type="checkbox" checked={anonymous} onChange={(event) => setAnonymous(event.target.checked)} /> Anonymous votes</label>
      <label className="poll-check"><input type="checkbox" checked={changeVotes} onChange={(event) => setChangeVotes(event.target.checked)} /> People can change their vote</label>
      <label className="poll-check"><input type="checkbox" checked={addOptions} onChange={(event) => setAddOptions(event.target.checked)} /> People can add an answer</label>
      <label>Results
        <select value={results} onChange={(event) => setResults(event.target.value)}>
          <option value="immediate">Show as people vote</option>
          <option value="after_vote">After you vote</option>
          <option value="after_close">After the poll closes</option>
        </select>
      </label>
      <label>Closes
        <select value={expiry} onChange={(event) => setExpiry(event.target.value)}>
          <option value="">No end time</option>
          <option value="15">15 minutes</option>
          <option value="60">1 hour</option>
          <option value="1440">24 hours</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {expiry === "custom" ? <label>End<input id="poll-when" type="datetime-local" required /></label> : null}
      {error ? <p className="poll-error">{error}</p> : null}
      <button type="submit" className="poll-save" disabled={busy}>Post poll</button>
    </form>
  );
}

export function WhisperCards({
  items,
  identity,
  serverNow,
  onChange,
  onReply,
}: {
  items: WhisperView[];
  identity: CircleIdentity;
  serverNow: number;
  onChange: () => void;
  onReply: (whisper: WhisperView) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const skew = serverNow ? serverNow - Date.now() : 0;
  return (
    <div className="whisper-stack">
      {items.map((whisper) => {
        const left = whisper.expiresAt ? whisper.expiresAt - (now + skew) : null;
        if (left != null && left <= 0) return null;
        return (
          <article key={whisper.id} className="whisper-card" aria-label={whisper.collapsed ? `Whisper from ${whisper.senderName}. Tap to reveal.` : "Private whisper"}>
            <p className="whisper-kicker"><Lock className="size-3.5" aria-hidden /> Private whisper</p>
            {whisper.collapsed ? (
              <button
                type="button"
                className="whisper-reveal"
                onClick={() => {
                  void revealWhisper({ data: { ...identity, whisperId: whisper.id } }).then(() => onChange());
                }}
              >
                Whisper from {whisper.senderName} — Tap to reveal
              </button>
            ) : (
              <>
                <p>{whisper.body}</p>
                <p className="whisper-meta">
                  {whisper.mine ? `To ${whisper.recipientName}` : `From ${whisper.senderName}`}
                  {whisper.unopened ? " · Unopened" : ""}
                  {left != null ? ` · ${clockLabel(left)}` : ""}
                </p>
                <div className="poll-actions">
                  <button type="button" onClick={() => onReply(whisper)}>Reply in whisper</button>
                  {whisper.mine ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm("Delete this Whisper for both of you?")) return;
                        void deleteWhisper({ data: { ...identity, whisperId: whisper.id } }).then(() => onChange());
                      }}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function WhisperComposer({
  identity,
  parentPostId,
  recipientKey,
  recipientName,
  replyTo,
  onClose,
  onSent,
}: {
  identity: CircleIdentity;
  parentPostId: string;
  recipientKey: string;
  recipientName: string;
  replyTo?: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  return (
    <form
      className="whisper-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void sendWhisper({ data: { ...identity, parentPostId, recipientKey, body, replyTo: replyTo ?? "" } }).then((result) => {
          const saved = result as { ok?: boolean; error?: string };
          if (!saved.ok) setError(saved.error || "That Whisper was not sent.");
          else onSent();
        }).catch(() => setError("That Whisper was not sent."));
      }}
    >
      <p><Lock className="size-3.5" aria-hidden /> Whisper to {recipientName}</p>
      <p className="whisper-meta">Only you and {recipientName} can see this. It disappears 60 seconds after they open it.</p>
      <textarea value={body} maxLength={500} onChange={(event) => setBody(event.target.value)} placeholder="Private reply" required />
      {error ? <p className="poll-error">{error}</p> : null}
      <div className="poll-actions">
        <button type="submit">Send whisper</button>
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

export async function castVote(identity: CircleIdentity, pollId: string, optionIds: string[]) {
  return votePoll({ data: { ...identity, pollId, optionIds } }) as Promise<{ ok?: boolean; error?: string; poll?: PollView }>;
}

export async function appendPollOption(identity: CircleIdentity, pollId: string, label: string) {
  return addPollOption({ data: { ...identity, pollId, label } }) as Promise<{ ok?: boolean; error?: string; poll?: PollView }>;
}
