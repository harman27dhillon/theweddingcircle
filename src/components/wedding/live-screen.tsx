import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CalendarHeart, CircleStop, Info, Maximize2, Plus, RotateCw, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { useWedding } from "@/components/wedding/context";
import { useLiveSession, useLiveOverlay, YoutubeDock } from "@/components/wedding/live-session";
import { Button, fieldClass, IconPop, PickList } from "@/components/wedding/ui";
import { canView } from "@/lib/wedding/access";
import { canBroadcast, canManage, canPost, youtubeId, youtubeLinkError } from "@/lib/wedding/format";
import { useDismissible } from "@/lib/wedding/dismiss";
import { playbackBadge, watchTiles } from "@/lib/wedding/live-layout";
import { useWeddingStore } from "@/lib/wedding/store";
import { useOnline } from "@/components/wedding/offline-host";
import type { AccessKind } from "@/lib/wedding/types";

export function LiveScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const setYoutube = useWeddingStore((s) => s.setYoutube);
  const session = useLiveSession();
  const setLiveAccess = useWeddingStore((s) => s.setLiveAccess);
  const mayBroadcast = canBroadcast(wedding, viewer);
  const mayManage = canManage(wedding, viewer);
  const mayTalk = canPost(wedding, viewer);
  const online = useOnline();
  const [link, setLink] = useState(wedding.youtubeUrl ?? "");
  const [about, setAbout] = useState(false);
  const [youtubeAbout, setYoutubeAbout] = useState(false);
  const aboutRef = useRef<HTMLDivElement>(null);
  const youtubeRef = useRef<HTMLDivElement>(null);
  useDismissible(about, () => setAbout(false), aboutRef);
  useDismissible(youtubeAbout, () => setYoutubeAbout(false), youtubeRef);
  const [note, setNote] = useState("");
  const video = youtubeId(wedding.youtubeUrl ?? "");
  const hosting = session.phase !== "idle";
  const watchKind = wedding.liveAccess?.kind ?? "all";
  const chosen = wedding.functions.find((item) => item.id === session.functionId) ?? wedding.functions[0];
  const liveOpen = canView(wedding, viewer, wedding.liveAccess);
  const remote = session.cameras.filter((item) => item.hostId !== session.selfId);
  const selfOnAir = session.phase === "live";
  const tiles = watchTiles(remote.map((item) => item.hostId), "", selfOnAir);
  const streamBusy = remote.length > 0;
  const overlayChats = useLiveOverlay(session.phase === "live" ? session.chats : session.focusChats);
  const commentOn = session.phase === "live" || session.focusChats.length > 0 || remote.length > 0;

  function addStream() {
    if (!online) {
      toast("The camera stream needs a connection. Nothing is being broadcast.");
      return;
    }
    if (!mayBroadcast) {
      toast("A host, co-host, or family member can start a camera.");
      return;
    }
    if (hosting) {
      session.restore();
      return;
    }
    if (streamBusy) {
      toast("This wedding already has a live stream. End it before starting another.");
      return;
    }
    void session.startPreview();
  }

  useEffect(() => {
    setLink(wedding.youtubeUrl ?? "");
  }, [wedding.youtubeUrl]);

  return (
    <div className="live-page mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 md:px-8 lg:max-w-6xl">
      <section className="live-stage wc-glass overflow-hidden rounded-card border border-line">
        <div ref={aboutRef}>
        <div className="live-bar live-bar-circle flex items-center justify-between gap-2 px-3 py-2.5">
          <h2 className="font-serif text-3xl text-ink">Wedding Circle Live</h2>
          <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-card text-maroon" aria-expanded={about} aria-label="About Wedding Circle Live" onClick={() => setAbout((open) => !open)}>
            <Info className="size-4" aria-hidden />
          </button>
        </div>
        {about ? (
          <p className="mx-3 mt-2 rounded-2xl border border-line bg-paper px-3 py-2 text-sm text-muted">This is a livestream inside Wedding Circle. One camera can be live at a time. When Cloudflare RealtimeKit is not on, this phone’s camera is used and is not recorded. When it is on, that service opens the camera and a replay is kept only after the recording is stored privately.</p>
        ) : null}
        </div>
        <div className="p-3">
          {!online ? (
            <div className="mb-3 rounded-2xl bg-paper px-4 py-4 text-sm text-ink">
              <p>The wedding camera needs a connection. This is not a live stream while you are offline.</p>
              <button type="button" className="mt-3 min-h-11 rounded-full border border-line px-4" onClick={() => window.location.reload()}>Retry</button>
            </div>
          ) : null}
          {hosting ? (
            <p className="text-sm text-muted">{session.minimized ? "Your camera is in the small window. Open it to return to the same broadcast." : "Your camera is live. Minimizing it keeps this broadcast running while you move around the wedding."}</p>
          ) : null}
          {!liveOpen ? (
            <div className="live-idle px-6 text-center text-sm">This live is private.</div>
          ) : session.directoryError ? (
            <div className="live-idle flex-col px-6 text-center text-sm">
              <p>{session.directoryError}</p>
              <button type="button" className="min-h-11 rounded-full bg-ivory px-4 text-ink" onClick={session.retryWatch}>Try again</button>
            </div>
          ) : (
            <div className="live-grid" data-count={tiles.length}>
              {tiles.map((tile) => {
                if (tile.kind === "empty") {
                  if (mayBroadcast) {
                    return (
                      <div key={tile.id} className="live-tile">
                        <button type="button" className="live-launch" disabled={session.asking || !online} onClick={addStream}>
                          <span className="live-add" aria-hidden="true">
                            <Plus className="size-6" strokeWidth={2.25} />
                          </span>
                          <span className="live-go">{session.asking ? "Asking…" : session.mediaError ? "Try again" : "Go Live"}</span>
                        </button>
                      </div>
                    );
                  }
                  return (
                    <div key={tile.id} className="live-idle px-6 text-center text-sm text-muted">
                      A host, co-host, or family member starts a camera. Watching does not use yours.
                    </div>
                  );
                }
                if (tile.kind === "self") {
                  return (
                    <button key="self" type="button" className="live-tile text-on-photo" onClick={session.restore}>
                      <span className="absolute top-2 left-2 rounded-full bg-maroon px-2.5 py-1 text-xs">LIVE · You</span>
                      <span className="px-4 text-center text-sm">{session.minimized ? "Open your camera" : "You are broadcasting"}</span>
                    </button>
                  );
                }
                if (tile.kind !== "camera") return null;
                const camera = remote.find((item) => item.hostId === tile.id);
                const badge = playbackBadge(camera?.connection ?? "connecting");
                return (
                  <button key={tile.id} type="button" className="live-tile" aria-label={`Watch ${camera?.hostName || "live camera"}`} onClick={() => session.openCamera(tile.id)}>
                    {session.player === "closed" && camera?.stream ? (
                      <video className="absolute inset-0 h-full w-full bg-ink object-contain" autoPlay muted playsInline ref={(node) => { if (node && node.srcObject !== camera.stream) node.srcObject = camera.stream; }} />
                    ) : null}
                    <span className={`pointer-events-none absolute top-2 left-2 rounded-full px-2.5 py-1 text-xs text-on-photo ${badge.live ? "bg-maroon" : "bg-ink/70"}`}>
                      {badge.live ? "LIVE · " : `${badge.text} · `}{camera?.hostName || "Camera"}
                    </span>
                    {badge.live ? null : <span className="pointer-events-none px-3 text-center text-sm text-on-photo">{badge.text}</span>}
                    {camera?.connection === "failed" ? (
                      <span className="pointer-events-none absolute bottom-2 text-xs text-on-photo">Tap to try again</span>
                    ) : null}
                  </button>
                );
              })}
              {session.phase === "live" ? (
                <div className="live-preview-controls">
                  {session.confirmingEnd ? (
                    <div className="live-stop-confirm">
                      <p>Stop this live stream? Viewers will be disconnected.</p>
                      <div className="mt-2 flex flex-wrap justify-center gap-2">
                        <button type="button" className="live-stop" disabled={session.stopping} onClick={() => void session.endBroadcast()}>
                          <CircleStop className="size-4" aria-hidden />
                          {session.stopping ? "Stopping…" : "Stop Live"}
                        </button>
                        <button type="button" className="min-h-11 rounded-full border border-line bg-ivory px-4 text-sm text-ink" onClick={session.cancelEnd}>Keep going</button>
                      </div>
                    </div>
                  ) : (
                    <button type="button" className="live-stop" disabled={session.stopping} onClick={session.askEnd}>
                      <CircleStop className="size-4" aria-hidden />
                      Stop Live
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          )}
          {session.mediaError && !hosting ? <p className="mt-2 text-sm text-maroon">{session.mediaError}</p> : null}
          {mayBroadcast && !hosting ? (
            <div className="live-actions mt-3 flex items-center gap-2">
              <IconPop label="Function" icon={<CalendarHeart className="size-4" aria-hidden />}>
                <PickList
                  label="Function"
                  value={chosen?.id ?? ""}
                  onChange={session.setFunctionId}
                  className="min-h-11 py-2"
                  options={wedding.functions.map((item) => ({ value: item.id, label: item.name }))}
                />
              </IconPop>
              {mayManage ? (
                <IconPop label="Who can watch" icon={<Users className="size-4" aria-hidden />}>
                  <PickList
                    label="Who can watch"
                    value={watchKind}
                    onChange={(value) => {
                      const kind = value as AccessKind;
                      if (kind === "ceremony") setLiveAccess(wedding.id, chosen?.accessRule ?? { kind: "ceremony", ceremonyId: chosen?.id });
                      else if (kind === "people") setLiveAccess(wedding.id, { kind: "people", names: wedding.liveAccess?.names ?? [] });
                      else setLiveAccess(wedding.id, { kind });
                      toast("The live audience was updated.");
                    }}
                    className="min-h-11 py-2"
                    options={[
                      { value: "all", label: "All wedding members" },
                      { value: "bride", label: "Bride's family" },
                      { value: "groom", label: "Groom's family" },
                      { value: "people", label: "Selected people" },
                      { value: "ceremony", label: "This function's audience" },
                    ]}
                  />
                  {watchKind === "people" ? (
                    <div className="mt-1 flex max-h-36 flex-col gap-1 overflow-y-auto">
                      {wedding.guests.map((guest) => (
                        <label key={guest.id} className="flex min-h-11 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={wedding.liveAccess?.names?.includes(guest.name) ?? false}
                            onChange={(event) => {
                              const names = new Set(wedding.liveAccess?.names ?? []);
                              if (event.target.checked) names.add(guest.name);
                              else names.delete(guest.name);
                              setLiveAccess(wedding.id, { kind: "people", names: [...names] });
                            }}
                          />
                          {guest.name}
                        </label>
                      ))}
                    </div>
                  ) : null}
                </IconPop>
              ) : null}
            </div>
          ) : null}
          {hosting && session.minimized ? (
            <Button className="mt-3" variant="line" onClick={session.restore}>Return to your camera</Button>
          ) : null}
          {mayBroadcast && !hosting && streamBusy ? <p className="mt-3 text-sm text-muted">This wedding already has a live stream. End it before starting another.</p> : null}
          <ul className="mt-3 flex max-h-48 flex-col gap-2 overflow-y-auto">
            {overlayChats.length === 0 ? <li className="text-sm text-muted">Comments appear here while a camera is open.</li> : null}
            {overlayChats.map((chat) => (
              <li key={chat.id} className="text-sm">
                <span className="font-medium">{chat.name}</span>
                <span> {chat.text}</span>
                {session.phase === "live" ? (
                  <button type="button" className="ml-2 min-h-11 text-xs text-muted" onClick={() => void session.sendRoom("drop", "", String(chat.id))}>
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          {mayTalk ? (
            <form
              className="live-composer mt-2 flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const value = note.trim().slice(0, 240);
                if (!value || !commentOn) return;
                setNote("");
                void session.sendRoom("comment", value);
              }}
            >
              <input className={fieldClass} maxLength={240} placeholder="Comment..." value={note} onChange={(event) => setNote(event.target.value)} />
              <Button type="submit" className="live-send" aria-label="Send comment" disabled={!commentOn}>
                <Send className="size-4" aria-hidden />
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-muted">Join this wedding to comment.</p>
          )}
        </div>
      </section>

      <section className="wc-glass overflow-hidden rounded-card border border-line">
        <div ref={youtubeRef}>
        <div className="live-bar live-bar-youtube flex items-center justify-between gap-2 px-3 py-2.5">
          <h2 className="font-serif text-2xl text-ink">YouTube Live</h2>
          <button type="button" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-line bg-card text-maroon" aria-expanded={youtubeAbout} aria-label="About YouTube Live" onClick={() => setYoutubeAbout((open) => !open)}>
            <Info className="size-4" aria-hidden />
          </button>
        </div>
        {youtubeAbout ? <p className="mx-3 mt-2 rounded-2xl border border-line bg-paper px-3 py-2 text-sm text-muted">A YouTube link is separate from the Wedding Circle camera. It does not play beside that camera. Attaching it does not start the camera, and ending the camera does not remove this link.</p> : null}
        </div>
        <div className="p-3">
          {!online ? (
            <div className="rounded-2xl bg-paper px-3 py-6 text-sm text-muted">
              <p>YouTube Live needs a connection. Nothing is playing while this phone is offline.</p>
              <button type="button" className="mt-3 min-h-11 rounded-full border border-line px-4" onClick={() => window.location.reload()}>Retry</button>
            </div>
          ) : video ? (
            <YoutubeInline url={wedding.youtubeUrl ?? ""} blocked={Boolean(video) && (streamBusy || hosting)} />
          ) : (
            <div className="rounded-2xl bg-paper px-3 py-6 text-sm text-muted">
              {wedding.youtubeUrl?.trim() ? (
                <>
                  <p>That link cannot be played here. Use a normal YouTube or YouTube Live address.</p>
                  <a className="mt-3 inline-flex min-h-11 items-center text-maroon" href={wedding.youtubeUrl} target="_blank" rel="noreferrer">Open on YouTube</a>
                </>
              ) : (
                <p>No YouTube link is attached.</p>
              )}
            </div>
          )}
          {mayManage ? (
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const problem = youtubeLinkError(link);
                if (problem) {
                  toast(problem);
                  return;
                }
                setYoutube(wedding.id, link);
                toast(link.trim() ? "The YouTube link is attached." : "The YouTube link was removed.");
              }}
            >
              <label className="text-sm text-muted" htmlFor="yt">YouTube link</label>
              <div className="flex gap-2">
                <input id="yt" className={fieldClass} placeholder="https://youtube.com/live/…" value={link} onChange={(event) => setLink(event.target.value)} />
                <Button type="submit">Attach</Button>
              </div>
            </form>
          ) : (
            <p className="mt-3 text-sm text-muted">A host or co-host attaches the YouTube link.</p>
          )}
        </div>
      </section>
    </div>
  );
}

const YOUTUBE_READY = new Set(["idle", "loading", "playing", "paused", "buffering", "ended"]);

function YoutubeInline({ url, blocked }: { url: string; blocked: boolean }) {
  const session = useLiveSession();
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [onPage, setOnPage] = useState(false);
  const [orientNote, setOrientNote] = useState("");
  useLayoutEffect(() => {
    const pane = root.current?.closest(".section-pane");
    if (!(pane instanceof HTMLElement)) {
      setOnPage(true);
      return;
    }
    const sync = () => setOnPage(!pane.hidden);
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(pane, { attributes: true, attributeFilter: ["hidden"] });
    return () => watch.disconnect();
  }, []);
  useEffect(() => {
    const unlock = () => {
      if (document.fullscreenElement) return;
      const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
      try { orientation.unlock?.(); } catch { /* This browser does not unlock orientation. */ }
    };
    document.addEventListener("fullscreenchange", unlock);
    return () => document.removeEventListener("fullscreenchange", unlock);
  }, []);
  const failed = !YOUTUBE_READY.has(session.youtubeState);
  function command(func: "playVideo" | "unMute") {
    const frame = document.getElementById("wc-yt");
    if (!(frame instanceof HTMLIFrameElement)) return;
    frame.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args: [], id: "wc-yt", channel: "widget" }), "*");
  }
  async function toggleFull() {
    const node = box.current;
    if (!node) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await node.requestFullscreen();
    } catch {
      toast("Full screen is not available in this browser.");
    }
  }
  async function landscape() {
    const node = box.current;
    setOrientNote("");
    try {
      if (node && !document.fullscreenElement) await node.requestFullscreen();
      const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
      if (!orientation.lock) {
        setOrientNote("Turn your phone sideways for landscape.");
        return;
      }
      await orientation.lock("landscape");
    } catch {
      setOrientNote("Turn your phone sideways for landscape.");
    }
  }
  if (blocked) {
    return (
      <div ref={root}>
        <p className="rounded-2xl bg-paper px-3 py-4 text-sm text-muted">
          A Wedding Circle camera is already live. YouTube stays attached, and it does not play beside that camera.
        </p>
      </div>
    );
  }
  if (failed) {
    return (
      <div ref={root} className="rounded-2xl bg-paper px-3 py-4 text-sm text-muted">
        <p>{session.youtubeState}</p>
        <a className="mt-3 inline-flex min-h-11 items-center text-maroon" href={url} target="_blank" rel="noreferrer">Open on YouTube</a>
      </div>
    );
  }
  return (
    <div ref={root}>
      {onPage ? (
        <>
          <div ref={box} className="yt-frame overflow-hidden rounded-2xl bg-ink">
            <YoutubeDock className="yt-dock aspect-video w-full" />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-3 text-sm" onClick={() => { command("unMute"); command("playVideo"); }}>
              Play with sound
            </button>
            <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-card px-3 text-sm" onClick={() => void toggleFull()}>
              <Maximize2 className="size-4" aria-hidden /> Full screen
            </button>
            <button type="button" className="inline-flex min-h-11 items-center gap-1 rounded-full border border-line bg-card px-3 text-sm" onClick={() => void landscape()}>
              <RotateCw className="size-4" aria-hidden /> Landscape
            </button>
          </div>
          {orientNote ? <p className="mt-2 text-sm text-muted">{orientNote}</p> : null}
          <p className="mt-2 text-sm text-muted">This plays inside the Live page, separate from the wedding camera. Sound stays off until you choose Play with sound.</p>
        </>
      ) : null}
    </div>
  );
}
