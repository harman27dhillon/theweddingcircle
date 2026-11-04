import { useEffect, useRef } from "react";
import { livePeerId } from "@/components/wedding/live-broadcast";
import { weddingLive } from "@/lib/wedding/live-room.functions";
import type { PlaybackState } from "@/lib/wedding/live-layout";

type Signal = { id: number; from: string; to: string; kind: "offer" | "answer" | "ice"; payload: RTCSessionDescriptionInit | RTCIceCandidateInit };
type Chat = { id: number; peerId: string; name: string; text: string };

export type CameraView = {
  hostId: string;
  hostName: string;
  stream: MediaStream | null;
  connection: PlaybackState;
};

const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];

export function LiveWatch({
  slug,
  name,
  codes,
  memberKey,
  mode,
  focusId,
  retryKey,
  onCameras,
  onFocus,
  onDirectoryError,
  skipPeer = false,
  kitStream = null,
}: {
  slug: string;
  name: string;
  codes: string[];
  memberKey: string;
  mode: "all" | "one" | "none";
  focusId: string;
  retryKey: number;
  onCameras: (cameras: CameraView[]) => void;
  onFocus: (room: { live: boolean; hostName: string; viewerCount: number; chats: Chat[] }) => void;
  onDirectoryError: (message: string) => void;
  skipPeer?: boolean;
  kitStream?: MediaStream | null;
}) {
  const modeRef = useRef(mode);
  const focusRef = useRef(focusId);
  const retryRef = useRef(retryKey);
  const codesRef = useRef(codes);
  const nameRef = useRef(name);
  const memberRef = useRef(memberKey);
  const onCamerasRef = useRef(onCameras);
  const onFocusRef = useRef(onFocus);
  const onErrorRef = useRef(onDirectoryError);
  const skipRef = useRef(skipPeer);
  const kitStreamRef = useRef(kitStream);
  modeRef.current = mode;
  focusRef.current = focusId;
  retryRef.current = retryKey;
  codesRef.current = codes;
  nameRef.current = name;
  memberRef.current = memberKey;
  onCamerasRef.current = onCameras;
  onFocusRef.current = onFocus;
  onErrorRef.current = onDirectoryError;
  skipRef.current = skipPeer;
  kitStreamRef.current = kitStream;

  useEffect(() => {
    const peers = new Map<string, RTCPeerConnection>();
    const media = new Map<string, MediaStream>();
    const conns = new Map<string, PlaybackState>();
    const arming = new Set<string>();
    const pendingIce = new Map<string, RTCIceCandidateInit[]>();
    const retried = new Set<string>();
    let directory: { hostId: string; hostName: string }[] = [];
    let wanted = new Set<string>();
    let after = 0;
    let stopped = false;
    let busy = false;
    let published = "";
    let focusKey = "";
    let seenRetry = retryRef.current;
    const self = livePeerId();

    function publish() {
      const list = directory.map((item) => ({
        hostId: item.hostId,
        hostName: item.hostName,
        stream: skipRef.current ? kitStreamRef.current : media.get(item.hostId) ?? null,
        connection: skipRef.current ? (kitStreamRef.current ? "live" as const : "connecting" as const) : conns.get(item.hostId) ?? ("connecting" as const),
      }));
      const key = list.map((item) => `${item.hostId}:${item.hostName}:${item.connection}:${item.stream ? "1" : "0"}`).join("|");
      if (key === published) return;
      published = key;
      onCamerasRef.current(list);
    }

    function closePeer(id: string) {
      peers.get(id)?.close();
      peers.delete(id);
      media.delete(id);
      conns.delete(id);
      arming.delete(id);
    }

    async function send(hostId: string, kind: Signal["kind"], payload: Signal["payload"]) {
      const currentCodes = codesRef.current;
      await weddingLive({
        data: {
          action: "signal",
          slug,
          peerId: self,
          name: nameRef.current,
          code: currentCodes[0] ?? "",
          codes: currentCodes,
          to: hostId,
          kind,
          payload,
          after: 0,
          text: "",
          memberKey: memberRef.current,
          access: "",
          roster: "",
          stream: hostId,
          watch: "",
        },
      });
    }

    async function watchHost(hostId: string) {
      if (stopped || peers.has(hostId) || !wanted.has(hostId)) return;
      const pc = new RTCPeerConnection({ iceServers });
      peers.set(hostId, pc);
      conns.set(hostId, "connecting");
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.onicecandidate = (event) => {
        if (event.candidate && wanted.has(hostId)) void send(hostId, "ice", event.candidate.toJSON());
      };
      pc.ontrack = (event) => {
        if (stopped || !wanted.has(hostId)) return;
        media.set(hostId, event.streams[0] ?? new MediaStream([event.track]));
        conns.set(hostId, "live");
        publish();
      };
      pc.onconnectionstatechange = () => {
        if (stopped) return;
        const state = pc.connectionState;
        if (state === "connected") conns.set(hostId, media.has(hostId) ? "live" : "connecting");
        else if (state === "disconnected") conns.set(hostId, "reconnecting");
        else if (state === "failed") {
          conns.set(hostId, "failed");
          pc.close();
          peers.delete(hostId);
          if (wanted.has(hostId) && !retried.has(hostId)) {
            retried.add(hostId);
            void watchHost(hostId);
          }
        }
        publish();
      };
      try {
        const offer = await pc.createOffer();
        if (stopped || !wanted.has(hostId)) {
          closePeer(hostId);
          return;
        }
        await pc.setLocalDescription(offer);
        await send(hostId, "offer", offer);
      } catch {
        closePeer(hostId);
        conns.set(hostId, "failed");
      }
      publish();
    }

    function retarget() {
      if (seenRetry !== retryRef.current) {
        seenRetry = retryRef.current;
        retried.clear();
        for (const [id, state] of conns) {
          if (state === "failed") closePeer(id);
        }
      }
      const next = new Set<string>();
      if (modeRef.current === "all" || modeRef.current === "one") {
        const id = modeRef.current === "one" ? focusRef.current : "";
        const pick = id && directory.some((item) => item.hostId === id)
          ? id
          : directory.find((item) => item.hostId !== self)?.hostId ?? "";
        if (pick && pick !== self) next.add(pick);
      }
      wanted = next;
      for (const id of [...peers.keys()]) {
        if (!wanted.has(id)) closePeer(id);
      }
      for (const id of wanted) {
        if (skipRef.current) continue;
        if (!peers.has(id) && !arming.has(id)) {
          arming.add(id);
          void watchHost(id).finally(() => arming.delete(id));
        }
      }
      publish();
    }

    async function tick() {
      if (stopped || busy) return;
      busy = true;
      try {
        const currentCodes = codesRef.current;
        const result = await weddingLive({
          data: {
            action: "board",
            slug,
            peerId: self,
            name: nameRef.current,
            code: currentCodes[0] ?? "",
            codes: currentCodes,
            to: "",
            kind: "",
            payload: null,
            after,
            text: "",
            memberKey: memberRef.current,
            access: "",
            roster: "",
            stream: focusRef.current,
            watch: [...wanted].join(","),
          },
        });
        if (stopped) return;
        if (!result.ok) {
          onErrorRef.current("error" in result && result.error ? result.error : "The live could not be opened.");
          directory = [];
          for (const id of [...peers.keys()]) closePeer(id);
          publish();
          return;
        }
        onErrorRef.current("");
        directory = (result.streams ?? []).map((item) => ({ hostId: item.hostId, hostName: item.hostName }));
        for (const id of [...media.keys()]) {
          if (!directory.some((item) => item.hostId === id)) closePeer(id);
        }
        const signals = (Array.isArray(result.signals) ? result.signals : []) as Signal[];
        for (const signal of signals) {
          if (Number(signal.id) > after) after = Number(signal.id);
          const pc = peers.get(signal.from);
          if (!pc) continue;
          if (signal.kind === "answer") {
            await pc.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
            const queued = pendingIce.get(signal.from) ?? [];
            pendingIce.delete(signal.from);
            for (const candidate of queued) await pc.addIceCandidate(candidate).catch(() => undefined);
          } else if (signal.kind === "ice") {
            const candidate = signal.payload as RTCIceCandidateInit;
            if (!pc.remoteDescription) {
              const queued = pendingIce.get(signal.from) ?? [];
              queued.push(candidate);
              pendingIce.set(signal.from, queued);
            } else {
              await pc.addIceCandidate(candidate).catch(() => undefined);
            }
          }
        }
        const picked = focusRef.current && directory.some((item) => item.hostId === focusRef.current)
          ? focusRef.current
          : directory.find((item) => item.hostId !== self)?.hostId ?? "";
        const focusLive = Boolean(result.live && picked);
        const nextFocus = `${picked}:${focusLive}:${result.viewerCount ?? 0}:${(result.chats ?? []).map((chat) => chat.id).join(",")}`;
        if (nextFocus !== focusKey) {
          focusKey = nextFocus;
          onFocusRef.current({
            live: focusLive,
            hostName: focusLive ? result.hostName || directory.find((item) => item.hostId === picked)?.hostName || "" : "",
            viewerCount: focusLive ? result.viewerCount ?? 0 : 0,
            chats: focusLive ? result.chats ?? [] : [],
          });
        }
        retarget();
      } catch {
        /* Keep the last directory until the server answers again. */
      } finally {
        busy = false;
      }
    }

    const timer = window.setInterval(() => void tick(), 1500);
    const refresh = window.setInterval(() => retarget(), 400);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.clearInterval(refresh);
      document.removeEventListener("visibilitychange", onVisible);
      for (const id of [...peers.keys()]) closePeer(id);
      onCamerasRef.current([]);
      const currentCodes = codesRef.current;
      void weddingLive({
        data: {
          action: "leave",
          slug,
          peerId: self,
          name: nameRef.current,
          code: currentCodes[0] ?? "",
          codes: currentCodes,
          to: "",
          kind: "",
          payload: null,
          after: 0,
          text: "",
          memberKey: memberRef.current,
          access: "",
          roster: "",
          stream: "",
          watch: "",
        },
      }).catch(() => undefined);
    };
  }, [slug]);

  return null;
}
