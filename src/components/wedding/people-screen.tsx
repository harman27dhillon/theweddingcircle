import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";
import { CeremonyInviteButton } from "@/components/wedding/ceremony-invite";
import { useWedding } from "@/components/wedding/context";
import { Button, Empty, fieldClass, HoldTarget, PickList, Screen } from "@/components/wedding/ui";
import { MediaGrid } from "@/components/wedding/media-grid";
import { PersonName } from "@/components/wedding/marks";
import { attendingCount, canContribute, canHost, canManage, codesOf } from "@/lib/wedding/format";
import { memberKeyFor } from "@/lib/wedding/member-key";
import { signalTyping } from "@/lib/wedding/publish";
import { readHostCodes } from "@/lib/wedding/roles.functions";
import { useWeddingStore } from "@/lib/wedding/store";
import { PHOTO_ACCEPT, VIDEO_ACCEPT, mediaKindOf, prepareUpload, uploadProgressPercent } from "@/lib/wedding/media";
import { ownPickerFiles } from "@/lib/wedding/picker-file";
import type { Rsvp, Side } from "@/lib/wedding/types";

const replies: { id: Rsvp; label: string }[] = [
  { id: "yes", label: "Attending" },
  { id: "maybe", label: "Maybe" },
  { id: "no", label: "Not attending" },
];

export function GuestsScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const setRsvp = useWeddingStore((s) => s.setRsvp);
  const setArrived = useWeddingStore((s) => s.setArrived);
  const addGuest = useWeddingStore((s) => s.addGuest);
  const approveGuest = useWeddingStore((s) => s.approveGuest);
  const removeGuest = useWeddingStore((s) => s.removeGuest);
  const blockGuest = useWeddingStore((s) => s.blockGuest);
  const setCohosts = useWeddingStore((s) => s.setCohosts);
  const addPostingCode = useWeddingStore((s) => s.addPostingCode);
  const host = canHost(viewer);
  const mayManage = canManage(wedding, viewer);
  const mine = wedding.guests.find((g) => g.name.toLowerCase() === viewer.name.toLowerCase());
  const [filter, setFilter] = useState<"all" | Rsvp>("all");
  const [name, setName] = useState("");
  const [side, setSide] = useState<Side>("Both");
  const [count, setCount] = useState(1);
  const shown = wedding.guests.filter((g) => !g.blocked && (filter === "all" || g.rsvp === filter));
  const waiting = wedding.guests.filter((g) => !g.joined);
  const accountEmail = useWeddingStore((s) => s.account?.email ?? "");
  const [hostCodes, setHostCodes] = useState<{ hostCode: string; cohostCode: string } | null>(null);
  useEffect(() => {
    if (!host) return;
    void readHostCodes({ data: { slug: wedding.slug, memberKey: memberKeyFor(wedding.slug), email: accountEmail } }).then((result) => {
      if (result.ok) setHostCodes({ hostCode: result.hostCode, cohostCode: result.cohostCode });
    });
  }, [host, wedding.slug, accountEmail]);

  return (
    <Screen
      title="Guests"
      lede={`${attendingCount(wedding.guests)} people marked attending, counting the households they bring.`}
    >
      <div className="mb-6 rounded-card border border-line bg-card p-4">
        <p className="text-sm text-muted">Your reply{mine ? ` · ${mine.name}` : ""}</p>
        <div className="mt-3">
          <PickList
            label="Your reply"
            value={mine?.rsvp ?? "pending"}
            options={[
              { value: "pending", label: "Not answered yet" },
              ...replies.map((item) => ({ value: item.id, label: item.label })),
            ]}
            onChange={(value) => {
              if (value === "pending") return;
              if (!mine) {
                addGuest(wedding.id, {
                  name: viewer.name,
                  side: "Both",
                  group: "Friends",
                  rsvp: value,
                  count: 1,
                });
              } else {
                setRsvp(wedding.id, mine.id, value);
              }
              toast("Reply saved in the circle.");
            }}
          />
        </div>
      </div>

      <div className="mb-4">
        <PickList
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "yes", label: "Attending" },
            { value: "maybe", label: "Maybe" },
            { value: "no", label: "No" },
            { value: "pending", label: "Waiting" },
          ]}
        />
      </div>

      <ul className="divide-y divide-line rounded-card border border-line bg-card">
        {shown.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-medium">
                <PersonName wedding={wedding} name={g.name} />
              </p>
              <p className="text-sm text-muted">
                {g.group} · {g.count} {g.count === 1 ? "person" : "people"}
                {!g.joined ? " · waiting to join" : ""}
                {g.arrived ? " · in the hall" : ""}
              </p>
            </div>
            {mayManage ? (
              <div className="flex flex-wrap gap-2">
                {host && !g.joined ? (
                  <Button variant="line" onClick={() => approveGuest(wedding.id, g.id)}>
                    Let them in
                  </Button>
                ) : null}
                {host ? (
                  <Button variant="line" onClick={() => setArrived(wedding.id, g.id, !g.arrived)}>
                    {g.arrived ? "Mark away" : "Mark arrived"}
                  </Button>
                ) : null}
                <Button
                  variant="line"
                  onClick={() => {
                    if (g.name.trim().toLowerCase() === wedding.hostName.trim().toLowerCase()) {
                      toast("The host stays in the circle.");
                      return;
                    }
                    removeGuest(wedding.id, g.id);
                    toast(`${g.name} was removed from the circle.`);
                  }}
                >
                  Remove
                </Button>
                <Button variant="line" onClick={() => blockGuest(wedding.id, g.id, true)}>
                  Block
                </Button>
              </div>
            ) : (
              <span className="text-sm text-muted">{labelRsvp(g.rsvp)}</span>
            )}
          </li>
        ))}
      </ul>

      {host ? (
        <form
          className="mt-6 grid gap-3 rounded-card border border-line bg-paper p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addGuest(wedding.id, { name: name.trim(), side, group: side === "Team" ? "Wedding team" : `${side}'s side`, rsvp: "pending", count });
            setName("");
            toast("Added to the list. They still need the invitation.");
          }}
        >
          <h2 className="font-serif text-2xl">Add someone</h2>
          <input className={fieldClass} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <PickList
            label="Side"
            value={side}
            onChange={setSide}
            options={[
              { value: "Bride", label: "Bride's side" },
              { value: "Groom", label: "Groom's side" },
              { value: "Both", label: "Both" },
              { value: "Team", label: "Team" },
            ]}
          />
          <input
              className={fieldClass}
              type="number"
              min={1}
              max={12}
              value={count}
              onChange={(e) => setCount(Number(e.target.value) || 1)}
            />
          <Button type="submit">Add to the list</Button>
        </form>
      ) : null}
      {host ? (
        <div className="mt-6 rounded-card border border-line bg-paper p-4">
          <h2 className="font-serif text-2xl">Co-hosts</h2>
          <p className="mt-1 text-sm text-muted">Two people, besides you, can help run the wedding. The role is saved for this circle. A co-host who already joined gets those tools on their phone, and loses them if you remove them.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {wedding.guests
              .filter((g) => g.name !== wedding.hostName)
              .map((g) => {
                const on = (wedding.cohostNames ?? []).includes(g.name);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="min-h-11 text-left"
                      onClick={() => {
                        const current = wedding.cohostNames ?? [];
                        if (!on && current.length >= 2) {
                          toast("Two co-hosts already. Remove one first.");
                          return;
                        }
                        if (on && !window.confirm(`Remove ${g.name} as a co-host? They lose host tools on this wedding.`)) return;
                        const next = on ? current.filter((name) => name !== g.name) : [...current, g.name];
                        void setCohosts(wedding.id, next).then((result: string) => {
                          if (result === "ok") toast(on ? `${g.name} is no longer a co-host.` : `${g.name} can help host.`);
                          else toast(result === "failed" ? "That co-host change could not be saved." : "Only the host can change co-hosts.");
                        });
                      }}
                    >
                      {on ? "Co-host · " : "Make co-host · "}
                      {g.name}
                    </button>
                  </li>
                );
              })}
          </ul>
          <h2 className="mt-6 font-serif text-2xl">Family and guest codes</h2>
          <p className="mt-1 text-sm text-muted">Give the family code to family. Give the guest code to everyone else. Guests can write in the chat. Family can also go live and announce.</p>
          <h3 className="mt-4 font-medium">Family</h3>
          <ul className="mt-1 text-sm">
            {codesOf(wedding).filter((item) => item.kind === "family").map((item) => (
              <li key={item.id} className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium tracking-wide">{item.code}</span>
                <CeremonyInviteButton wedding={wedding} codeId={item.id} kind="family" />
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-medium">Guests</h3>
          <ul className="mt-1 text-sm">
            {codesOf(wedding).filter((item) => item.kind === "guest").map((item) => (
              <li key={item.id} className="mt-2 flex items-center justify-between gap-2">
                <span className="min-w-0 break-all font-medium tracking-wide">{item.code}</span>
                <CeremonyInviteButton wedding={wedding} codeId={item.id} kind="guest" />
              </li>
            ))}
          </ul>
          {hostCodes ? (
            <>
              <h3 className="mt-4 font-medium">Host</h3>
              <p className="mt-1 text-sm font-medium tracking-wide">{hostCodes.hostCode}</p>
              <h3 className="mt-4 font-medium">Co-host</h3>
              <p className="mt-1 text-sm font-medium tracking-wide">{hostCodes.cohostCode}</p>
              <p className="mt-2 text-sm text-muted">These codes change a person's role. They are not shown to guests.</p>
            </>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="line" onClick={() => { const code = addPostingCode(wedding.id, "family"); if (code) toast(`Family code ${code} is ready to share.`); }}>
              New family code
            </Button>
            <Button variant="line" onClick={() => { const code = addPostingCode(wedding.id, "guest"); if (code) toast(`Guest code ${code} is ready to share.`); }}>
              New guest code
            </Button>
          </div>
        </div>
      ) : null}
      {waiting.length > 0 && host ? (
        <p className="mt-3 text-sm text-muted">{waiting.length} still waiting on a reply or an approval.</p>
      ) : null}
    </Screen>
  );
}

function labelRsvp(rsvp: Rsvp) {
  if (rsvp === "yes") return "Attending";
  if (rsvp === "no") return "Not attending";
  if (rsvp === "maybe") return "Maybe";
  return "No reply";
}

export function ChatsScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const addChat = useWeddingStore((s) => s.addChat);
  const renameChat = useWeddingStore((s) => s.renameChat);
  const removeChat = useWeddingStore((s) => s.removeChat);
  const setChatClosed = useWeddingStore((s) => s.setChatClosed);
  const host = canHost(viewer);
  const mayManage = host || viewer.role === "cohost";
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  return (
    <Screen title="Chats" lede="The threads that used to be five WhatsApp groups, kept inside this wedding.">
      <ul className="flex flex-col gap-3">
        {wedding.chats.map((chat) => {
          const last = chat.messages[chat.messages.length - 1];
          const locked = Boolean(chat.closed) && !canContribute(wedding, viewer) && viewer.role !== "planner";
          return (
            <li key={chat.id} className="rounded-card border border-line bg-card p-4">
              {locked ? (
                <div>
                  <h2 className="font-serif text-2xl">{chat.name}</h2>
                  <p className="mt-1 text-sm text-muted">Closed. Only the host, co-hosts, and family can read this thread.</p>
                </div>
              ) : (
              <Link to="/w/$slug/chat/$chatId" params={{ slug: wedding.slug, chatId: chat.id }} className="block">
                <div className="flex items-baseline justify-between gap-3">
                  <h2 className="font-serif text-2xl">{chat.name}</h2>
                  <span className="text-sm text-muted tabular-nums">{chat.messages.length}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{chat.hint}{chat.closed ? " · Closed to guests" : ""}</p>
                {last ? <p className="mt-3 line-clamp-2">{last.author}: {last.text}</p> : <p className="mt-3 text-muted">No messages yet.</p>}
              </Link>
              )}
              {mayManage ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {editing === chat.id ? (
                    <>
                      <input className={fieldClass} value={draft} onChange={(e) => setDraft(e.target.value)} />
                      <Button
                        variant="line"
                        onClick={() => {
                          if (!draft.trim()) return;
                          renameChat(wedding.id, chat.id, draft);
                          setEditing(null);
                        }}
                      >
                        Save name
                      </Button>
                    </>
                  ) : (
                    <Button variant="line" onClick={() => { setEditing(chat.id); setDraft(chat.name); }}>
                      Rename
                    </Button>
                  )}
                  <Button variant="line" onClick={() => setChatClosed(wedding.id, chat.id, !chat.closed)}>
                    {chat.closed ? "Open to the circle" : "Close to guests"}
                  </Button>
                  {host ? (
                  <Button variant="line" onClick={() => removeChat(wedding.id, chat.id)}>
                    Delete
                  </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {host ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            addChat(wedding.id, name);
            setName("");
          }}
        >
          <input className={fieldClass} placeholder="New group, such as College friends" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit">Create</Button>
        </form>
      ) : null}
    </Screen>
  );
}

type StagedFile = { file: File; preview: string; name: string; bytes: number; mark: string };

function fileMark(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function ChatThread({ chatId }: { chatId: string }) {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const sendMessage = useWeddingStore((s) => s.sendMessage);
  const removeMessage = useWeddingStore((s) => s.removeMessage);
  const reportPost = useWeddingStore((s) => s.reportPost);
  const pulse = useWeddingStore((s) => s.pulse);
  const chat = wedding.chats.find((c) => c.id === chatId);
  const account = useWeddingStore((s) => s.account);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [photoPick, setPhotoPick] = useState<StagedFile | null>(null);
  const [videoPick, setVideoPick] = useState<StagedFile | null>(null);
  const [sending, setSending] = useState(false);
  const [mediaNote, setMediaNote] = useState("");
  const [activePick, setActivePick] = useState<"" | "photo" | "video">("");
  const typingTimer = useRef(0);
  const typingBeat = useRef(0);
  const typingNames = pulse.slug === wedding.slug ? (pulse.chats[chatId] ?? []) : [];
  const canModerate = viewer.role === "host" || viewer.role === "planner";

  function noteTyping(active: boolean) {
    window.clearTimeout(typingTimer.current);
    window.clearInterval(typingBeat.current);
    if (!active) {
      signalTyping(wedding.slug, viewer.name, `chat:${chatId}`, false);
      return;
    }
    typingTimer.current = window.setTimeout(() => {
      signalTyping(wedding.slug, viewer.name, `chat:${chatId}`, true);
      typingBeat.current = window.setInterval(() => signalTyping(wedding.slug, viewer.name, `chat:${chatId}`, true), 2000);
    }, 280);
  }

  useEffect(() => {
    let stop = false;
    void import("@/lib/wedding/offline-sync").then(async (mod) => {
      const draft = await mod.readDraft(account, wedding.id, chatId);
      if (!stop && draft) setText((current) => current || draft);
    });
    return () => {
      stop = true;
    };
  }, [account, wedding.id, chatId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void import("@/lib/wedding/offline-sync").then((mod) => mod.writeDraft(account, wedding.id, chatId, text));
    }, 280);
    return () => window.clearTimeout(handle);
  }, [account, wedding.id, chatId, text]);

  useEffect(() => () => {
    window.clearTimeout(typingTimer.current);
    window.clearInterval(typingBeat.current);
    signalTyping(wedding.slug, viewer.name, `chat:${chatId}`, false);
  }, [wedding.slug, viewer.name, chatId]);

  const photoRef = useRef<StagedFile | null>(null);
  const videoRef = useRef<StagedFile | null>(null);
  photoRef.current = photoPick;
  videoRef.current = videoPick;
  useEffect(() => () => {
    if (photoRef.current) URL.revokeObjectURL(photoRef.current.preview);
    if (videoRef.current) URL.revokeObjectURL(videoRef.current.preview);
  }, []);

  const frameRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const openedRef = useRef(false);
  const [frame, setFrame] = useState(0);
  const threadMessages = chat?.messages.filter((message) => !message.removed) ?? [];
  const newestMessage = threadMessages[threadMessages.length - 1]?.id ?? "";

  useEffect(() => {
    openedRef.current = false;
    stickRef.current = true;
  }, [chatId]);

  useEffect(() => {
    const fit = () => {
      const box = frameRef.current;
      if (!box || box.getClientRects().length === 0) return;
      const top = box.getBoundingClientRect().top;
      const wide = window.matchMedia("(min-width: 768px)").matches;
      const view = window.visualViewport;
      const keyboard = document.documentElement.classList.contains("keyboard-open");
      if (keyboard) stickRef.current = true;
      const nav = document.querySelector("[data-app-nav]");
      const navHeight = wide || keyboard || !(nav instanceof HTMLElement) ? 0 : nav.getBoundingClientRect().height;
      const visibleBottom = keyboard && view ? view.offsetTop + view.height : window.innerHeight;
      const navTop = window.innerHeight - navHeight;
      const next = Math.max(180, Math.round(Math.min(visibleBottom, navTop) - top));
      setFrame((current) => (Math.abs(current - next) < 2 ? current : next));
    };
    fit();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    if (frameRef.current) watch?.observe(frameRef.current);
    const view = window.visualViewport;
    view?.addEventListener("resize", fit);
    window.addEventListener("resize", fit);
    return () => {
      view?.removeEventListener("resize", fit);
      window.removeEventListener("resize", fit);
      watch?.disconnect();
    };
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      stickRef.current = distance < 96;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [chatId]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || list.clientHeight < 40) return;
    if (!openedRef.current) {
      openedRef.current = true;
      stickRef.current = true;
      list.scrollTop = list.scrollHeight;
      return;
    }
    if (stickRef.current) list.scrollTop = list.scrollHeight;
  }, [newestMessage, frame, chatId]);

  if (!chat) return <Screen title="Missing chat"><Empty title="That thread is not in this wedding" text="Go back to the list." /></Screen>;
  const locked = Boolean(chat.closed) && !canContribute(wedding, viewer) && viewer.role !== "planner";
  if (locked) {
    return (
      <Screen title={chat.name}>
        <Empty title="This thread is closed" text="Only the host, co-hosts, and family can read it." />
      </Screen>
    );
  }

  return (
    <div
      ref={frameRef}
      className="mx-auto flex min-h-0 w-full max-w-3xl flex-col px-4"
      style={frame > 0 ? { height: frame } : { height: "calc(100dvh - var(--app-nav, 4.5rem) - 3.5rem)" }}
    >
      <header className="shrink-0 py-3">
        <h1 className="font-serif text-3xl text-ink">{chat.name}</h1>
        {chat.hint ? <p className="mt-1 text-sm text-muted">{chat.hint}</p> : null}
      </header>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
      <ol className="flex flex-col gap-3 pb-2">
        {threadMessages.length === 0 ? <Empty title="Quiet so far" text="The first message opens the thread." /> : null}
        {threadMessages.map((m) => {
          const mine = m.author === viewer.name;
          return (
            <li key={m.id} className={mine ? "ml-8" : "mr-8"}>
              <HoldTarget
                label={`Actions for ${m.author}'s message`}
                actions={[
                  ...(canContribute(wedding, viewer)
                    ? [{
                        id: "reply",
                        label: "Reply",
                        onSelect: () => setReplyTo(m.id),
                      }]
                    : []),
                  ...(mine || canModerate
                    ? [{
                        id: "delete",
                        label: "Delete",
                        onSelect: () => removeMessage(wedding.id, chat.id, m.id),
                      }]
                    : []),
                  {
                    id: "report",
                    label: "Report",
                    onSelect: () => {
                      reportPost(wedding.id, m.id, viewer.name, "Reported from a chat");
                      toast("Sent to the platform desk.");
                    },
                  },
                ]}
              >
              <div
                className={`chat-bubble feed-glass${mine ? " is-mine" : ""}`}
                style={{
                  "--feed-wash": mine ? "var(--wc-sent)" : "var(--wc-received)",
                  "--feed-ink": mine ? "var(--wc-sent-ink)" : "var(--wc-received-ink)",
                  "--feed-bar": "transparent",
                } as CSSProperties}
              >
                {!mine ? <p className="text-sm text-muted"><PersonName wedding={wedding} name={m.author} /></p> : null}
                <p>{m.text}</p>
                {m.image || m.video ? (
                  <div className="mt-2">
                    <MediaGrid
                      mine={mine}
                      tiles={[
                        ...(m.image ? [{ kind: "image" as const, src: m.image }] : []),
                        ...(m.video ? [{ kind: "video" as const, src: m.video }] : []),
                      ]}
                    />
                  </div>
                ) : null}
                {m.replyTo ? (
                  <p className={mine ? "mt-1 text-xs text-on-photo/80" : "mt-1 text-xs text-muted"}>
                    Reply to {chat.messages.find((item) => item.id === m.replyTo)?.author ?? "a message"}: {chat.messages.find((item) => item.id === m.replyTo)?.text}
                  </p>
                ) : null}
                <p className={mine ? "mt-1 text-xs text-on-photo/80 tabular-nums" : "mt-1 text-xs text-muted tabular-nums"}>{m.atLabel}</p>
                {m.delivery === "sending" ? <p className={mine ? "text-xs text-on-photo/80" : "text-xs text-muted"}>Sending…</p> : null}
                {m.delivery === "pending" ? <p className={mine ? "text-xs text-on-photo/80" : "text-xs text-muted"}>Pending — not sent</p> : null}
                {m.delivery === "sent" ? <p className={mine ? "text-xs text-on-photo/80" : "text-xs text-muted"}>Sent</p> : null}
                {m.delivery === "failed" ? <p className="text-xs text-maroon">Not sent</p> : null}
              </div>
              </HoldTarget>
            </li>
          );
        })}
      </ol>
      </div>
      {canContribute(wedding, viewer) ? (
      <form
        data-noswipe=""
        className="shrink-0 border-t border-line bg-ivory/95 py-2 flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (sending) return;
          if (!text.trim() && !photoPick && !videoPick) return;
          const photo = photoPick;
          const clip = videoPick;
          const draft = text;
          const reply = replyTo;
          void (async () => {
            setSending(true);
            setMediaNote("Preparing");
            try {
              let image = "";
              let video = "";
              let videoSeconds = 0;
              const report = (label: string) => {
                const percent = uploadProgressPercent(label);
                setMediaNote(percent != null && percent > 0 ? `Uploading ${percent}%` : "Preparing");
              };
              if (photo) {
                setActivePick("photo");
                const media = await prepareUpload(photo.file, report, wedding.slug, "chat");
                if (media.kind !== "image") throw new Error("Choose a photo for this button.");
                image = media.src;
              }
              if (clip) {
                setActivePick("video");
                const media = await prepareUpload(clip.file, report, wedding.slug, "chat");
                if (media.kind !== "video") throw new Error("Choose a video for this button.");
                video = media.src;
                videoSeconds = media.seconds;
              }
              sendMessage(wedding.id, chat.id, viewer.name, draft.trim() || (video ? "Shared a video." : "Shared a photo."), {
                image: image || undefined,
                video: video || undefined,
                videoSeconds: video ? videoSeconds : undefined,
                replyTo: reply ?? undefined,
              });
              setText("");
              void import("@/lib/wedding/offline-sync").then((mod) => mod.writeDraft(account, wedding.id, chat.id, ""));
              if (photo) URL.revokeObjectURL(photo.preview);
              if (clip) URL.revokeObjectURL(clip.preview);
              setPhotoPick(null);
              setVideoPick(null);
              setReplyTo(null);
              noteTyping(false);
            } catch (error) {
              toast(error instanceof Error ? error.message : "That file could not be saved.");
            } finally {
              setSending(false);
              setMediaNote("");
              setActivePick("");
            }
          })();
        }}
      >
        {replyTo ? (
          <p className="flex w-full items-center gap-2 text-xs text-muted">
            <span className="min-w-0 truncate">Replying to {chat.messages.find((item) => item.id === replyTo)?.author ?? "a message"}</span>
            <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center" aria-label="Close reply" onClick={() => setReplyTo(null)}>×</button>
          </p>
        ) : null}
        {photoPick || videoPick ? (
          <div className={`mb-1 media-grid is-mine ${photoPick && videoPick ? "is-2" : "is-1"}`}>
            {photoPick ? (
              <div className="media-tile">
                <img src={photoPick.preview} alt="" className="media-tile-fill" />
                {sending && activePick === "photo" ? <span className="media-shade">{mediaNote.startsWith("Uploading") ? <span className="media-pct">{mediaNote.replace("Uploading ", "")}</span> : <><span className="media-spin" aria-hidden="true" /><span>Preparing</span></>}</span> : null}
                <button type="button" className="media-tile-remove" disabled={sending} onClick={() => { URL.revokeObjectURL(photoPick.preview); setPhotoPick(null); }}>Remove</button>
              </div>
            ) : null}
            {videoPick ? (
              <div className="media-tile">
                <video src={videoPick.preview} className="media-tile-fill" muted playsInline />
                <span className="media-tile-play" aria-hidden="true">▶</span>
                {sending && activePick === "video" ? <span className="media-shade">{mediaNote.startsWith("Uploading") ? <span className="media-pct">{mediaNote.replace("Uploading ", "")}</span> : <><span className="media-spin" aria-hidden="true" /><span>Preparing</span></>}</span> : null}
                <button type="button" className="media-tile-remove" disabled={sending} onClick={() => { URL.revokeObjectURL(videoPick.preview); setVideoPick(null); }}>Remove</button>
              </div>
            ) : null}
          </div>
        ) : null}
        {sending && mediaNote && !activePick ? <p className="w-full text-xs text-muted" role="status">{mediaNote}</p> : null}
        <input className={`${fieldClass} !min-h-9 !py-1.5`} placeholder={replyTo ? "Write a reply" : `Write in ${chat.name}`} value={text} onChange={(e) => { setText(e.target.value); noteTyping(e.target.value.trim().length > 0); }} />
        <label className={`inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm ${sending ? "pointer-events-none opacity-80" : "cursor-pointer"}`}>
          Photo
          <input
            type="file"
            accept={PHOTO_ACCEPT}
            className="sr-only"
            disabled={sending}
            onChange={(e) => {
              const input = e.target;
              const chosen = Array.from(input.files ?? []);
              if (!chosen.length) return;
              void ownPickerFiles(chosen).then((owned) => {
                input.value = "";
                const file = owned.files[0];
                if (owned.errors[0]) toast(owned.errors[0]);
                if (!file) return;
                if (mediaKindOf(file) !== "image") {
                  toast("Choose a photo for this button.");
                  return;
                }
                const mark = fileMark(file);
                if (photoPick?.mark === mark) {
                  toast("That file is already selected.");
                  return;
                }
                if (photoPick) URL.revokeObjectURL(photoPick.preview);
                setPhotoPick({ file, preview: URL.createObjectURL(file), name: file.name || "Photo", bytes: file.size, mark });
              });
            }}
          />
        </label>
        <label className={`inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm ${sending ? "pointer-events-none opacity-80" : "cursor-pointer"}`}>
          Video
          <input
            type="file"
            accept={VIDEO_ACCEPT}
            className="sr-only"
            disabled={sending}
            onChange={(e) => {
              const input = e.target;
              const chosen = Array.from(input.files ?? []);
              if (!chosen.length) return;
              void ownPickerFiles(chosen).then((owned) => {
                input.value = "";
                const file = owned.files[0];
                if (owned.errors[0]) toast(owned.errors[0]);
                if (!file) return;
                if (mediaKindOf(file) !== "video") {
                  toast("Choose a video for this button.");
                  return;
                }
                const mark = fileMark(file);
                if (videoPick?.mark === mark) {
                  toast("That file is already selected.");
                  return;
                }
                if (videoPick) URL.revokeObjectURL(videoPick.preview);
                setVideoPick({ file, preview: URL.createObjectURL(file), name: file.name || "Video", bytes: file.size, mark });
              });
            }}
          />
        </label>
        <Button type="submit" disabled={sending}>{sending ? "Sending" : "Send"}</Button>
      </form>
      ) : (
        <p className="shrink-0 border-t border-line bg-ivory/95 py-3 text-sm text-muted">
          You are watching. Family can write in this thread. Guests can write in the chat.
        </p>
      )}
      {typingNames.length > 0 ? (
        <p className="flex shrink-0 items-center gap-2 py-1" aria-live="polite">
          <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="sr-only">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing</span>
        </p>
      ) : null}
    </div>
  );
}
