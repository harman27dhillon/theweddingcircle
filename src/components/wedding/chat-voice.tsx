import { ChevronLeft, ChevronRight, Mic, MicOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CartoonAvatar } from "@/components/wedding/guest-profile";
import { useWedding } from "@/components/wedding/context";
import { useMediaUrl } from "@/components/wedding/ui";
import { circleKey } from "@/lib/wedding/circle-key";
import { DESK_SPLIT_QUERY } from "@/lib/wedding/desk-layout";
import { ownMemberKey } from "@/lib/wedding/guest-profile";
import { useWeddingStore } from "@/lib/wedding/store";
import { readVoiceRoster } from "@/lib/wedding/voice-chat.functions";
import { samePeople, stripOpen, type RosterPerson } from "@/lib/wedding/voice-chat";
import {
  hangupVoice,
  installVoiceGuards,
  setVoiceMic,
  setVoiceSpeaker,
  subscribeVoice,
  voiceSnapshot,
  type VoiceCreds,
} from "@/lib/wedding/voice-client";

function VoiceFace({ slug, memberKey, name, photo }: { slug: string; memberKey: string; name: string; photo?: string }) {
  const { url } = useMediaUrl(photo || "");
  return (
    <span className="voice-avatar" role="listitem" title={name}>
      {url ? <img src={url} alt="" /> : <CartoonAvatar seed={`${slug}:${memberKey}`} />}
      <span className="sr-only">{name} microphone is on</span>
    </span>
  );
}

export function ChatVoiceControls() {
  const wedding = useWedding();
  const viewerName = useWeddingStore((state) => state.viewer.name);
  const [memberKey, setMemberKey] = useState("");
  const [open, setOpen] = useState(true);
  const [people, setPeople] = useState<RosterPerson[]>([]);
  const [localError, setLocalError] = useState("");
  const live = useSyncExternalStore(subscribeVoice, voiceSnapshot, voiceSnapshot);
  const ui = { ...live, error: localError || live.error };
  const holder = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [deskSlot, setDeskSlot] = useState<HTMLElement | null>(null);
  const profile = memberKey ? wedding.guestProfiles?.[memberKey] : undefined;
  const name = (profile && !profile.removed && profile.displayName) || viewerName || "Guest";

  useLayoutEffect(() => {
    const media = window.matchMedia(DESK_SPLIT_QUERY);
    const sync = () => {
      const pane = anchor.current?.closest(".section-pane");
      const visible = pane instanceof HTMLElement && !pane.hidden && !pane.hasAttribute("data-offstage");
      const desk = visible && media.matches ? document.getElementById("wc-voice-slot") : null;
      setDeskSlot(desk instanceof HTMLElement ? desk : null);
    };
    sync();
    const pane = anchor.current?.closest(".section-pane");
    const watch = pane instanceof HTMLElement ? new MutationObserver(sync) : null;
    if (pane instanceof HTMLElement) watch?.observe(pane, { attributes: true, attributeFilter: ["hidden", "data-offstage"] });
    media.addEventListener("change", sync);
    const frame = window.requestAnimationFrame(sync);
    return () => {
      watch?.disconnect();
      media.removeEventListener("change", sync);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    setMemberKey(ownMemberKey(wedding.slug));
    setOpen(true);
    setPeople([]);
    setLocalError("");
  }, [wedding.slug]);

  useEffect(() => {
    if (live.error) setLocalError("");
  }, [live.error, live.micEnabled, live.speakerEnabled]);

  useEffect(() => {
    installVoiceGuards();
    const unsub = useWeddingStore.subscribe((state, previous) => {
      if (previous.account && !state.account) void hangupVoice("logout");
      if (previous.viewer.weddingId !== state.viewer.weddingId) void hangupVoice("wedding");
    });
    return () => {
      unsub();
      void hangupVoice("leave");
    };
  }, [wedding.slug]);

  useEffect(() => {
    const root = holder.current;
    const pane = root?.closest(".section-pane");
    if (!(pane instanceof HTMLElement)) return;
    let timer = 0;
    let stopped = false;
    const hidden = () => pane.hidden || pane.hasAttribute("data-offstage");
    const pull = () => {
      if (stopped || hidden() || !memberKey) return;
      const currentKey = ownMemberKey(wedding.slug);
      if (currentKey !== memberKey) setMemberKey(currentKey);
      const creds = { slug: wedding.slug, memberKey: currentKey, editKey: circleKey(wedding.slug), name, action: "roster" as const, publish: false };
      void readVoiceRoster({ data: creds }).then((result) => {
        if (stopped || !result || !("ok" in result) || !result.ok || !("people" in result) || !result.people) return;
        const next = result.people.filter((person) => Boolean(person.memberKey));
        setPeople((current) => samePeople(current, next) ? current : next);
      }).catch(() => undefined);
    };
    const tick = () => {
      if (hidden()) {
        void hangupVoice("leave");
        return;
      }
      pull();
    };
    tick();
    timer = window.setInterval(tick, 3000);
    const watch = new MutationObserver(() => {
      if (hidden()) void hangupVoice("leave");
    });
    watch.observe(pane, { attributes: true, attributeFilter: ["hidden", "data-offstage"] });
    return () => {
      stopped = true;
      window.clearInterval(timer);
      watch.disconnect();
    };
  }, [wedding.slug, memberKey, name]);

  function creds(key = memberKey): VoiceCreds {
    return { slug: wedding.slug, memberKey: key, editKey: circleKey(wedding.slug), name };
  }

  function keyFor() {
    const key = ownMemberKey(wedding.slug);
    if (key && key !== memberKey) setMemberKey(key);
    return key;
  }

  function pressMic() {
    const key = keyFor();
    if (!key) {
      setLocalError("Join this wedding before using voice chat.");
      return;
    }
    setLocalError("");
    void setVoiceMic(!live.micEnabled, creds(key));
  }

  function pressSpeaker() {
    const key = keyFor();
    if (!key) {
      setLocalError("Join this wedding before using voice chat.");
      return;
    }
    setLocalError("");
    void setVoiceSpeaker(!live.speakerEnabled, creds(key));
  }

  function holdStrip(event: { stopPropagation: () => void; preventDefault?: () => void }) {
    event.stopPropagation();
  }

  const cluster = (
    <div ref={holder} className="theme-audio" data-noswipe="">
      {ui.error ? <p className="voice-status" role="status">{ui.error}</p> : null}
      {stripOpen(open, people) ? (
        <div
          className="voice-strip"
          role="list"
          aria-label="Microphones on"
          data-noswipe=""
          onWheel={(event) => {
            event.stopPropagation();
            const node = event.currentTarget;
            if (node.scrollWidth <= node.clientWidth) return;
            node.scrollLeft += event.deltaX || event.deltaY;
            event.preventDefault();
          }}
          onTouchStart={holdStrip}
          onTouchMove={holdStrip}
        >
          {people.map((person) => {
            const known = wedding.guestProfiles?.[person.memberKey];
            const photo = known && !known.removed ? known.photo : "";
            return <VoiceFace key={person.memberKey} slug={wedding.slug} memberKey={person.memberKey} name={person.name} photo={photo} />;
          })}
        </div>
      ) : null}
      <button
        type="button"
        className="theme-voice-arrow"
        aria-expanded={open}
        aria-label={open ? "Hide people with microphones on" : "Show people with microphones on"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {open ? <ChevronRight className="size-4" aria-hidden /> : <ChevronLeft className="size-4" aria-hidden />}
      </button>
      <button
        type="button"
        className={`theme-mic${live.micEnabled ? " is-on" : ""}${live.connecting ? " is-busy" : ""}`}
        data-state={live.micEnabled ? "on" : "off"}
        aria-pressed={live.micEnabled}
        aria-busy={live.connecting || undefined}
        aria-label={live.micEnabled ? "Turn microphone off" : "Turn microphone on"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          pressMic();
        }}
      >
        <Mic className="voice-glyph is-live size-4" aria-hidden style={{ display: live.micEnabled ? "block" : "none" }} />
        <MicOff className="voice-glyph is-muted size-4" aria-hidden style={{ display: live.micEnabled ? "none" : "block" }} />
      </button>
      <button
        type="button"
        className={`theme-speaker${live.speakerEnabled ? " is-on" : ""}${live.connecting ? " is-busy" : ""}`}
        data-state={live.speakerEnabled ? "on" : "off"}
        aria-pressed={live.speakerEnabled}
        aria-label={live.speakerEnabled ? "Turn speaker off" : "Turn speaker on"}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          pressSpeaker();
        }}
      >
        <Volume2 className="voice-glyph is-live size-4" aria-hidden style={{ display: live.speakerEnabled ? "block" : "none" }} />
        <VolumeX className="voice-glyph is-muted size-4" aria-hidden style={{ display: live.speakerEnabled ? "none" : "block" }} />
      </button>
    </div>
  );
  return (
    <>
      <div ref={anchor} hidden />
      {deskSlot ? createPortal(cluster, deskSlot) : cluster}
    </>
  );
}
