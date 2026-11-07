import { Download, Filter, Image as ImageIcon, Info, Mic, Plus, Send, Video } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { CameraCapture } from "@/components/wedding/camera-capture";
import { useWedding } from "@/components/wedding/context";
import { VoiceBubble, VoiceControls } from "@/components/wedding/voice-note";
import { HoldTarget } from "@/components/wedding/ui";
import { MediaGrid, MediaUploadGrid } from "@/components/wedding/media-grid";
import { GuestProfileEditor, laterKey, lookupProfile, ProfileCard, WeddingAvatar } from "@/components/wedding/guest-profile";
import { chatSeparator, localDayKey, ownMemberKey, weddingPhase } from "@/lib/wedding/guest-profile";
import { sameMessageThread } from "@/lib/wedding/ceremony-priority";
import { canDownload, canPost, assignedSide, canManage } from "@/lib/wedding/format";
import { isOwnMessage, coupleAuthorIds, coupleRole } from "@/lib/wedding/identity";
import { composerFieldHeight } from "@/lib/wedding/capture";
import { canView } from "@/lib/wedding/access";
import type { AccessKind, AccessRule, FeedPost } from "@/lib/wedding/types";
import { feedSidesOf, schemeForSide } from "@/lib/wedding/feed-sides";
import { MAX_PHOTOS, MAX_VIDEOS, MEDIA_ACCEPT, mediaKindOf, optimiseUploadFile, prepareUpload, unsupportedMediaMessage, uploadConcurrency, uploadProgressPercent } from "@/lib/wedding/media";
import { ownSelectedFile } from "@/lib/wedding/picker-file";
import { useAppRuntime } from "@/lib/developer/runtime";
import { downloadStored } from "@/lib/wedding/media-db";
import { weddingDownloadName } from "@/lib/wedding/download-name";
import { signalTyping } from "@/lib/wedding/publish";
import { publishVoiceNote } from "@/lib/wedding/voice-publish";
import { useWeddingStore } from "@/lib/wedding/store";
import { ChatVoiceControls } from "@/components/wedding/chat-voice";
import { SeekHost, WhoSaidCard } from "@/components/wedding/who-said-panel";
import { useDismissible } from "@/lib/wedding/dismiss";
import { DESK_SPLIT_QUERY } from "@/lib/wedding/desk-layout";
import { parseSeek } from "@/lib/wedding/seek";

type HeldDraft = {
  text: string;
  images: string[];
  videos: { src: string; seconds: number }[];
  functionId: string;
  audience: AccessKind;
  audienceNames: string[];
  scroll: number;
};

const heldDrafts = new Map<string, HeldDraft>();

function paneConcealed(pane: HTMLElement) {
  return pane.hidden || pane.hasAttribute("data-offstage");
}
const openReply = { weddingId: "", key: "", text: "" };

type UploadContext = {
  weddingId: string;
  slug: string;
  author: string;
  circle: string;
  side?: string;
  functionId?: string;
  accessRule?: AccessRule;
};

type PendingItem = {
  id: string;
  preview: string;
  file: File;
  kind: "image" | "video";
  seconds: number;
  src: string;
  progress: number | null;
  status: "selected" | "processing" | "uploading" | "uploaded" | "failed" | "cancelled";
  error: string;
  mark: string;
};

type PendingBatch = {
  id: string;
  items: PendingItem[];
  posted: boolean;
  posting: boolean;
  ctx: UploadContext;
};

const pendingBatches: PendingBatch[] = [];
const pendingListeners = new Set<() => void>();
const uploadQueue: { batchId: string; itemId: string }[] = [];
const uploadsInFlight = new Set<string>();
let uploadSlots = 0;

function emitPending() {
  if (typeof document !== "undefined") {
    const uploading = pendingBatches.some((batch) => batch.items.some((item) => item.status === "uploading" || item.status === "selected"));
    if (uploading) document.documentElement.dataset.wcUpload = "1";
    else delete document.documentElement.dataset.wcUpload;
  }
  for (const listener of pendingListeners) listener();
}

function findBatch(batchId: string) {
  return pendingBatches.find((entry) => entry.id === batchId);
}

function patchItem(batchId: string, itemId: string, partial: Partial<PendingItem>) {
  const item = findBatch(batchId)?.items.find((entry) => entry.id === itemId);
  if (!item) return;
  Object.assign(item, partial);
  emitPending();
}

function dropBatch(batchId: string) {
  const index = pendingBatches.findIndex((entry) => entry.id === batchId);
  if (index < 0) return;
  const [batch] = pendingBatches.splice(index, 1);
  for (const item of batch?.items ?? []) {
    if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  }
  emitPending();
}

function pumpUploads() {
  while (uploadSlots < uploadConcurrency() && uploadQueue.length > 0) {
    const next = uploadQueue.shift();
    if (!next) continue;
    const key = `${next.batchId}:${next.itemId}`;
    if (uploadsInFlight.has(key)) continue;
    const batch = findBatch(next.batchId);
    const item = batch?.items.find((entry) => entry.id === next.itemId);
    if (!batch || !item || batch.posted || item.status === "failed" || item.status === "cancelled") continue;
    uploadSlots += 1;
    uploadsInFlight.add(key);
    void runUpload(next.batchId, next.itemId).finally(() => {
      uploadsInFlight.delete(key);
      uploadSlots -= 1;
      pumpUploads();
    });
  }
}

function maybePostBatch(batchId: string) {
  const batch = findBatch(batchId);
  if (!batch || batch.posted || batch.posting) return;
  const waiting = batch.items.some((item) => item.status !== "failed" && item.status !== "cancelled" && !item.src);
  if (waiting) return;
  const ready = batch.items.filter((item) => item.src);
  if (!ready.length) {
    if (batch.items.every((item) => item.status === "cancelled")) dropBatch(batchId);
    return;
  }
  batch.posting = true;
  const images: string[] = [];
  const videos: { src: string; seconds: number }[] = [];
  const gallery: { kind: "image" | "video"; src: string; seconds?: number }[] = [];
  for (const item of ready) {
    if (item.kind === "video") {
      videos.push({ src: item.src, seconds: item.seconds });
      gallery.push({ kind: "video", src: item.src, seconds: item.seconds });
    } else {
      images.push(item.src);
      gallery.push({ kind: "image", src: item.src });
    }
  }
  const count = ready.length;
  const text = count === 1
    ? (ready[0]?.kind === "video" ? "Shared a video." : "Shared a photo.")
    : `Shared ${count} files.`;
  const postId = useWeddingStore.getState().addPost(batch.ctx.weddingId, {
    author: batch.ctx.author,
    circle: batch.ctx.circle,
    text,
    images,
    videos,
    gallery,
    side: batch.ctx.side,
    functionId: batch.ctx.functionId,
    accessRule: batch.ctx.accessRule,
  });
  batch.posting = false;
  if (!postId) {
    const error = "That message was not posted. Nothing already saved was removed.";
    for (const item of ready) {
      item.status = "failed";
      item.error = error;
      item.progress = null;
    }
    emitPending();
    return;
  }
  for (const item of ready) {
    if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  }
  batch.items = batch.items.filter((item) => !item.src && item.status !== "cancelled");
  if (!batch.items.length) dropBatch(batchId);
  else emitPending();
}

async function runUpload(batchId: string, itemId: string) {
  const batch = findBatch(batchId);
  const item = batch?.items.find((entry) => entry.id === itemId);
  if (!batch || !item || batch.posted) return;
  patchItem(batchId, itemId, { status: "processing", error: "", progress: null });
  try {
    let src = item.src;
    let seconds = item.seconds;
    if (!src) {
      const prepared = await prepareUpload(
        item.file,
        (label) => {
          const current = findBatch(batchId)?.items.find((entry) => entry.id === itemId);
          if (!current || findBatch(batchId)?.posted) return;
          const percent = uploadProgressPercent(label);
          if (percent == null || percent <= 0) {
            patchItem(batchId, itemId, { progress: null, status: "processing" });
            return;
          }
          patchItem(batchId, itemId, { progress: percent, status: "uploading" });
        },
        batch.ctx.slug,
      );
      src = prepared.src;
      seconds = prepared.kind === "video" ? prepared.seconds : 0;
      patchItem(batchId, itemId, { src, seconds, progress: 100, status: "uploaded" });
      await new Promise((resolve) => window.setTimeout(resolve, 160));
      if (!findBatch(batchId) || findBatch(batchId)?.posted) return;
    } else {
      patchItem(batchId, itemId, { src, seconds, progress: 100, status: "uploaded" });
    }
    maybePostBatch(batchId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "That file could not be saved.";
    patchItem(batchId, itemId, { status: "failed", error: message, progress: null });
  }
}

function cancelPending(batchId: string, itemId: string) {
  const key = `${batchId}:${itemId}`;
  if (uploadsInFlight.has(key)) return;
  const index = uploadQueue.findIndex((entry) => entry.batchId === batchId && entry.itemId === itemId);
  if (index >= 0) uploadQueue.splice(index, 1);
  const batch = findBatch(batchId);
  const item = batch?.items.find((entry) => entry.id === itemId);
  if (!batch || !item || item.status === "uploading" || item.status === "uploaded") return;
  if (item.preview.startsWith("blob:")) URL.revokeObjectURL(item.preview);
  item.status = "cancelled";
  item.error = "";
  item.progress = null;
  emitPending();
  maybePostBatch(batchId);
}

function retryPending(batchId: string, itemId: string) {
  const batch = findBatch(batchId);
  const item = batch?.items.find((entry) => entry.id === itemId);
  const key = `${batchId}:${itemId}`;
  if (!batch || !item || batch.posted || item.status !== "failed" || uploadsInFlight.has(key)) return;
  patchItem(batchId, itemId, { status: "selected", error: "", progress: null });
  uploadQueue.push({ batchId, itemId });
  pumpUploads();
}

function enqueueChatMedia(files: { file: File; kind: "image" | "video" }[], ctx: UploadContext) {
  if (!files.length) return;
  const freshFiles = files.filter((entry) => {
    const mark = `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`;
    return !pendingBatches.some((batch) => batch.ctx.weddingId === ctx.weddingId && batch.items.some((item) => item.mark === mark && item.status !== "failed"));
  });
  if (!freshFiles.length) return;
  const batch: PendingBatch = {
    id: crypto.randomUUID(),
    posted: false,
    posting: false,
    ctx,
    items: freshFiles.map((entry) => ({
      id: crypto.randomUUID(),
      preview: URL.createObjectURL(entry.file),
      file: entry.file,
      kind: entry.kind,
      seconds: 0,
      src: "",
      progress: 0,
      status: "selected",
      error: "",
      mark: `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`,
    })),
  };
  pendingBatches.push(batch);
  for (const item of batch.items) uploadQueue.push({ batchId: batch.id, itemId: item.id });
  emitPending();
  pumpUploads();
}

function usePendingUploads(weddingId: string) {
  const [items, setItems] = useState<PendingBatch[]>([]);
  useEffect(() => {
    const pull = () => setItems(pendingBatches.filter((item) => item.ctx.weddingId === weddingId).map((item) => ({ ...item, items: item.items.map((entry) => ({ ...entry })) })));
    pull();
    pendingListeners.add(pull);
    return () => {
      pendingListeners.delete(pull);
    };
  }, [weddingId]);
  useEffect(() => {
    try {
      if (sessionStorage.getItem("wc-upload-interrupted") === "1") {
        sessionStorage.removeItem("wc-upload-interrupted");
        toast("An upload was interrupted. Choose the photo or video again to retry.");
      }
    } catch {
      /* This browser cannot remember an interrupted upload. */
    }
    const mark = () => {
      try {
        if (document.documentElement.dataset.wcUpload === "1") sessionStorage.setItem("wc-upload-interrupted", "1");
      } catch {
        /* Ignore. */
      }
    };
    window.addEventListener("beforeunload", mark);
    return () => window.removeEventListener("beforeunload", mark);
  }, []);
  return items;
}

function UploadRing({ progress, label }: { progress: number | null; label: string }) {
  const radius = 16;
  const turn = 2 * Math.PI * radius;
  const indeterminate = progress == null;
  const shown = indeterminate ? 28 : progress;
  const offset = turn - (shown / 100) * turn;
  return (
    <span className={`chat-upload${indeterminate ? " is-indet" : ""}`} role="status" aria-label={label}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="chat-upload-track" cx="20" cy="20" r={radius} />
        <circle className="chat-upload-value" cx="20" cy="20" r={radius} strokeDasharray={turn} strokeDashoffset={offset} />
      </svg>
      {indeterminate ? null : <span className="chat-upload-pct">{Math.round(progress)}%</span>}
    </span>
  );
}

function CoupleSparkles() {
  return (
    <span className="couple-spark" aria-hidden="true">
      <span className="couple-dot" />
      <span className="couple-dot" />
      <span className="couple-dot" />
      <span className="couple-dot" />
      <span className="couple-dot" />
      <span className="couple-dot" />
    </span>
  );
}

function held(id: string): HeldDraft {
  return heldDrafts.get(id) ?? { text: "", images: [], videos: [], functionId: "", audience: "all", audienceNames: [], scroll: 0 };
}

type MediaPick = {
  id: string;
  file: File;
  kind: "image" | "video";
  preview: string;
  name: string;
  bytes: number;
  mark: string;
  ready: Promise<File>;
};

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FeedScreen() {
  const wedding = useWedding();
  const coupleIds = useMemo(() => coupleAuthorIds(wedding), [wedding]);
  const viewer = useWeddingStore((s) => s.viewer);
  const account = useWeddingStore((s) => s.account);
  const addPost = useWeddingStore((s) => s.addPost);
  const [audience] = useState<AccessKind>(() => held(wedding.id).audience);
  const [audienceNames] = useState<string[]>(() => held(wedding.id).audienceNames);
  const addComment = useWeddingStore((s) => s.addComment);
  const removePost = useWeddingStore((s) => s.removePost);
  const retryPost = useWeddingStore((s) => s.retryPost);
  const reportPost = useWeddingStore((s) => s.reportPost);
  const reactToPost = useWeddingStore((s) => s.reactToPost);
  const setChatAtmosphere = useWeddingStore((s) => s.setChatAtmosphere);
  const pulse = useWeddingStore((s) => s.pulse);
  const allowed = canPost(wedding, viewer);
  const host = viewer.role === "host" || viewer.role === "planner" || canManage(wedding, viewer);
  const [memberKey, setMemberKey] = useState("");
  const ownProfile = memberKey ? wedding.guestProfiles?.[memberKey] : undefined;
  const hasProfile = Boolean(ownProfile && !ownProfile.removed && ownProfile.displayName);
  const atmosphere = wedding.chatAtmosphere !== false;
  const phase = weddingPhase(wedding.date, atmosphere);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileFirst, setProfileFirst] = useState(false);
  const [card, setCard] = useState<{ name: string; authorId?: string; mine: boolean } | null>(null);
  const [heartId, setHeartId] = useState("");
  const [petals, setPetals] = useState(0);
  const dayPetal = useRef("");
  const [askProfile, setAskProfile] = useState(false);
  const [text, setText] = useState(() => held(wedding.id).text);
  const [images, setImages] = useState<string[]>(() => held(wedding.id).images);
  const [videos, setVideos] = useState<{ src: string; seconds: number }[]>(() => held(wedding.id).videos);
  const [functionId] = useState(() => held(wedding.id).functionId);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceStop, setVoiceStop] = useState(0);
  const [plusOpen, setPlusOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const plusRef = useRef<HTMLDivElement>(null);
  useDismissible(plusOpen, () => setPlusOpen(false), plusRef);
  const [reply, setReply] = useState<{ postId: string; commentId?: string; author: string; text: string } | null>(null);

  const [notice, setNotice] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [mediaFilter, setMediaFilter] = useState<"all" | "photos" | "videos" | "voice">("all");
  const typingTimer = useRef(0);
  const typingBeat = useRef(0);
  const typingNames = pulse.slug === wedding.slug ? pulse.feed : [];
  const [picks, setPicks] = useState<MediaPick[]>([]);
  const [sendingPicks, setSendingPicks] = useState(false);
  const runtime = useAppRuntime();

  function noteTyping(active: boolean) {
    window.clearTimeout(typingTimer.current);
    window.clearInterval(typingBeat.current);
    if (!active) {
      signalTyping(wedding.slug, viewer.name, "feed", false);
      return;
    }
    typingTimer.current = window.setTimeout(() => {
      signalTyping(wedding.slug, viewer.name, "feed", true);
      typingBeat.current = window.setInterval(() => signalTyping(wedding.slug, viewer.name, "feed", true), 2000);
    }, 280);
  }

  useEffect(() => () => {
    window.clearTimeout(typingTimer.current);
    window.clearInterval(typingBeat.current);
    signalTyping(wedding.slug, viewer.name, "feed", false);
  }, [wedding.slug, viewer.name]);

  useEffect(() => {
    heldDrafts.set(wedding.id, {
      text,
      images,
      videos,
      functionId,
      audience,
      audienceNames,
      scroll: heldDrafts.get(wedding.id)?.scroll ?? held(wedding.id).scroll,
    });
  }, [wedding.id, text, images, videos, functionId, audience, audienceNames]);

  function onFiles(chosen: File[]) {
    if (chosen.length === 0) return;
    setNotice("");
    if (!runtime.flags.photoUploads) {
      const message = "Photo and video uploads are turned off.";
      setNotice(message);
      toast(message);
      return;
    }
    const photoCap = Math.min(MAX_PHOTOS, runtime.maxPhotos);
    const videoCap = Math.min(MAX_VIDEOS, runtime.maxVideos);
    let photos = 0;
    let videos = 0;
    let limited = false;
    const files: { file: File; kind: "image" | "video" }[] = [];
    const rejected: string[] = [];
    for (const file of chosen) {
      if (!file || file.size <= 0) {
        rejected.push("That file was empty.");
        continue;
      }
      const kind = mediaKindOf(file);
      if (!kind) {
        rejected.push(unsupportedMediaMessage(file));
        continue;
      }
      if (kind === "image") {
        if (photos >= photoCap) {
          limited = true;
          continue;
        }
        photos += 1;
      } else if (videos >= videoCap) {
        limited = true;
        continue;
      } else {
        videos += 1;
      }
      files.push({ file, kind });
    }
    if (limited) toast(`Up to ${photoCap} photos and ${videoCap} videos at once.`);
    if (rejected[0]) {
      setNotice(rejected[0]);
      toast(rejected[0]);
    }
    if (!files.length) return;
    for (const entry of files) {
      void ownSelectedFile(entry.file).then((owned) => {
        // Replace the phone-backed URL before clearing its picker permission.
        setPicks((current) => current.map((item) => {
          if (item.file !== entry.file || owned === entry.file) return item;
          const preview = URL.createObjectURL(owned);
          window.setTimeout(() => URL.revokeObjectURL(item.preview), 1000);
          return { ...item, file: owned, preview };
        }));
        void optimiseUploadFile(owned).then((compressed) => {
          if (!compressed.type.startsWith("image/") || compressed === owned) return;
          setPicks((current) => current.map((item) => {
            if (item.file !== owned) return item;
            const preview = URL.createObjectURL(compressed);
            window.setTimeout(() => URL.revokeObjectURL(item.preview), 1000);
            return { ...item, preview, bytes: compressed.size };
          }));
        }).catch(() => undefined);
      }).catch((error) => {
        const message = error instanceof Error ? error.message : "That file could not be read. Choose it again.";
        setNotice(message);
        toast(message);
        setPicks((current) => current.filter((item) => {
          if (item.file !== entry.file) return true;
          URL.revokeObjectURL(item.preview);
          return false;
        }));
      });
    }
    setPicks((current) => {
      const next = [...current];
      let duplicate = false;
      for (const entry of files) {
        const mark = `${entry.file.name}:${entry.file.size}:${entry.file.lastModified}`;
        if (next.some((item) => item.mark === mark)) {
          duplicate = true;
          continue;
        }
        next.push({
          id: crypto.randomUUID(),
          file: entry.file,
          kind: entry.kind,
          preview: URL.createObjectURL(entry.file),
          name: entry.file.name || (entry.kind === "video" ? "Video" : "Photo"),
          bytes: entry.file.size,
          mark,
          ready: ownSelectedFile(entry.file),
        });
      }
      if (duplicate) toast("That file is already selected.");
      return next;
    });
  }

  function removePick(id: string) {
    setPicks((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return current.filter((entry) => entry.id !== id);
    });
  }

  async function sendPicks() {
    if (!picks.length || sendingPicks) return;
    setSendingPicks(true);
    const selected = picks;
    const ready = await Promise.all(selected.map(async (item) => {
      try { return { file: await item.ready, kind: item.kind }; }
      catch { return null; }
    }));
    const files = ready.filter((item): item is { file: File; kind: "image" | "video" } => Boolean(item));
    if (files.length) enqueueChatMedia(files, {
      weddingId: wedding.id,
      slug: wedding.slug,
      author: viewer.name,
      circle: viewerSide === "Bride" ? "Bride's side" : viewerSide === "Groom" ? "Groom's side" : "Guests",
      side: viewerSide,
      functionId: functionId || undefined,
      accessRule: audience === "people" ? { kind: "people", names: audienceNames } : audience === "all" ? undefined : { kind: audience },
    });
    for (const item of selected) URL.revokeObjectURL(item.preview);
    const selectedIds = new Set(selected.map((item) => item.id));
    setPicks((current) => current.filter((item) => !selectedIds.has(item.id)));
    setSendingPicks(false);
    stickRef.current = true;
  }

  const posts = wedding.posts.filter((post) => !post.removed);
  const viewerSide = viewer.side === "Bride" || viewer.side === "Groom" ? viewer.side : assignedSide(wedding, viewer.name);
  const announcements = posts.filter(
    (post) => post.kind === "announcement" && seesAnnouncement(post.audience, viewer.role, viewerSide),
  );
  const stories = posts.filter((post) => post.kind !== "announcement" && canView(wedding, viewer, post.accessRule, post.id, post.author) && matchesMedia(post, mediaFilter));
  const sides = feedSidesOf(wedding);
  const [visibleCount, setVisibleCount] = useState(12);
  const orderedStories = [...stories].reverse();
  const shownStories = orderedStories.slice(Math.max(0, orderedStories.length - visibleCount));
  const newestId = orderedStories[orderedStories.length - 1]?.id ?? "";
  const barRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const sentAt = useRef(0);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    if (!text) {
      field.style.height = "";
      return;
    }
    field.style.height = "auto";
    field.style.height = `${composerFieldHeight(field.scrollHeight, text)}px`;
  }, [text]);
  const frameRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pending = usePendingUploads(wedding.id);
  const visiblePending = pending.filter((batch) => batchMatches(batch, mediaFilter));
  const stickRef = useRef(true);
  const openedFeed = useRef("");
  const olderAnchor = useRef<number | null>(null);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) {
        setCameraOpen(false);
        setVoiceStop((value) => value + 1);
      }
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    const view = window.visualViewport;
    const stick = () => {
      const list = listRef.current;
      if (!list || !stickRef.current || list.getClientRects().length === 0) return;
      list.scrollTop = list.scrollHeight;
    };
    view?.addEventListener("resize", stick);
    return () => view?.removeEventListener("resize", stick);
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const anchor = olderAnchor.current;
    if (!list || anchor == null) return;
    olderAnchor.current = null;
    list.scrollTop = Math.max(0, list.scrollHeight - anchor);
  }, [visibleCount]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const onScroll = () => {
      const distance = list.scrollHeight - list.scrollTop - list.clientHeight;
      stickRef.current = distance < 96;
      const draft = heldDrafts.get(wedding.id);
      if (draft) draft.scroll = list.scrollTop;
      if (list.scrollTop < 48 && visibleCount < stories.length && olderAnchor.current == null) {
        olderAnchor.current = list.scrollHeight - list.scrollTop;
        setVisibleCount((count) => Math.min(stories.length, count + 12));
      }
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [visibleCount, stories.length]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const pin = () => {
      if (list.clientHeight < 40) return false;
      if (openedFeed.current !== wedding.id) {
        openedFeed.current = wedding.id;
        stickRef.current = true;
      }
      if (stickRef.current) list.scrollTop = list.scrollHeight;
      return true;
    };
    pin();
    const watch = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => pin());
    watch?.observe(list);
    const pane = list.closest(".section-pane");
    const hidden = pane instanceof HTMLElement
      ? new MutationObserver(() => {
          if (!(pane instanceof HTMLElement) || paneConcealed(pane)) return;
          if (!stickRef.current) {
            const saved = heldDrafts.get(wedding.id)?.scroll ?? 0;
            if (saved > 0) list.scrollTop = saved;
            return;
          }
          pin();
        })
      : null;
    if (pane instanceof HTMLElement) hidden?.observe(pane, { attributes: true, attributeFilter: ["hidden", "data-offstage"] });
    const onLoad = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement) && !(target instanceof HTMLVideoElement)) return;
      if (stickRef.current) list.scrollTop = list.scrollHeight;
    };
    list.addEventListener("load", onLoad, true);
    return () => {
      watch?.disconnect();
      hidden?.disconnect();
      list.removeEventListener("load", onLoad, true);
    };
  }, [wedding.id, newestId, shownStories.length, pending.length]);

  useEffect(() => {
    setMemberKey(ownMemberKey(wedding.slug));
    setProfileOpen(false);
    setCard(null);
  }, [wedding.slug]);

  useEffect(() => {
    const pane = frameRef.current?.closest(".section-pane");
    if (!(pane instanceof HTMLElement) || !memberKey) return;
    const maybe = () => {
      if (paneConcealed(pane)) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && pane.contains(active)) active.blur();
        return;
      }
      if (phase === "day" && dayPetal.current !== wedding.id && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        dayPetal.current = wedding.id;
        setPetals(1);
        window.setTimeout(() => setPetals(0), 1700);
      }
      if (!allowed || hasProfile || typeof localStorage === "undefined") {
        if (hasProfile) setAskProfile(false);
        return;
      }
      setAskProfile(!localStorage.getItem(laterKey(wedding.slug, memberKey)));
    };
    maybe();
    const watch = new MutationObserver(maybe);
    watch.observe(pane, { attributes: true, attributeFilter: ["hidden", "data-offstage"] });
    return () => watch.disconnect();
  }, [allowed, hasProfile, wedding.slug, wedding.id, memberKey, phase]);

  useEffect(() => {
    const open = () => {
      setProfileFirst(!hasProfile);
      setProfileOpen(true);
    };
    window.addEventListener("wc-open-profile", open);
    return () => window.removeEventListener("wc-open-profile", open);
  }, [hasProfile]);

  function openPerson(name: string, authorId: string | undefined, mine: boolean) {
    setCard({ name, authorId, mine });
  }

  function heart(postId: string) {
    if (!allowed) return;
    reactToPost(wedding.id, postId, viewer.name, "love");
    setHeartId(postId);
    window.setTimeout(() => setHeartId((current) => current === postId ? "" : current), 700);
  }

  return (
    <div ref={frameRef} className="chat-stage relative flex min-h-0 flex-col overflow-hidden">
      {petals > 0 ? <span className="petal-burst" aria-hidden="true"><i /><i /><i /></span> : null}
      <div className="chat-localbar">
        <WeddingAvatar
          bar
          name={ownProfile && !ownProfile.removed && ownProfile.displayName ? ownProfile.displayName : viewer.name || "You"}
          photo={ownProfile && !ownProfile.removed ? ownProfile.photo || "" : ""}
          seed={`${wedding.slug}:${memberKey || viewer.name || "guest"}`}
          label="Your wedding profile"
          onOpen={() => window.dispatchEvent(new Event("wc-open-profile"))}
        />
        <div className="chat-desk-actions">
          <div id="wc-notes-slot" />
          <div id="wc-chat-tools" className="chat-local-tools" />
          <div id="wc-voice-slot" className="chat-voice-slot" />
        </div>
      </div>
      <ChatVoiceControls />
      <ChatFilters
        open={filterOpen}
        filter={mediaFilter}
        onOpenChange={setFilterOpen}
        onFilter={setMediaFilter}
        host={canManage(wedding, viewer)}
        atmosphere={atmosphere}
        onAtmosphere={(enabled) => setChatAtmosphere(wedding.id, enabled)}
      />
      <div ref={listRef} className="chat-scroll mx-auto min-h-0 w-full min-w-0 max-w-3xl flex-1 overflow-x-hidden overflow-y-auto px-3 py-2 md:px-8 md:py-4">
      {allowed ? null : (
        <p className="mb-3 rounded-2xl border border-line bg-card px-3 py-2.5 text-sm leading-snug">This sample circle is view only. Look through the rooms. Nothing you write is posted.</p>
      )}

      {mediaFilter === "all" && announcements.length > 0 ? (
        <ul className="mb-2 flex flex-col gap-1">
          {announcements.map((post) => {
            const tone = schemeForSide(sides, post.audience === "Both" ? undefined : post.audience);
            return (
            <li
              key={post.id}
              className="announce-flash rounded-2xl px-3 py-2"
              style={tone ? { boxShadow: `inset 6px 0 0 ${tone.bar}` } : undefined}
            >
              <p className="text-[11px] font-medium tracking-wide">
                Announcement · {post.audience === "Bride" ? "Bride's side" : post.audience === "Groom" ? "Groom's side" : "Both sides"}
              </p>
              <p className="mt-1 text-base font-medium leading-snug">{post.text}</p>
            </li>
            );
          })}
        </ul>
      ) : null}

      {stories.length === 0 && visiblePending.length === 0 ? (
        <p className="chat-empty">
          {mediaFilter === "photos" ? "No photos in this chat." : mediaFilter === "videos" ? "No videos in this chat." : mediaFilter === "voice" ? "No voice notes in this chat." : "Nothing posted yet."}
        </p>
      ) : null}
      <ol className="chat-stack">
        {phase === "day" ? <li className="chat-atmosphere">Wedding Day</li> : null}
        {phase === "after" ? <li className="chat-atmosphere">Memories forever</li> : null}
        {shownStories.map((post, index) => {
          const person = lookupProfile(wedding, post.author, post.authorId);
          const displayName = person?.profile.displayName || post.author;
          const mine = isOwnMessage(post.authorId, account)
            || Boolean(memberKey && person?.key === memberKey)
            || Boolean(viewer.name.trim() && (post.author === viewer.name || displayName === viewer.name));
          const couple = coupleRole(wedding, displayName, post.authorId, coupleIds) || coupleRole(wedding, post.author, post.authorId, coupleIds);
          const previous = index > 0 ? shownStories[index - 1] : undefined;
          const previousPerson = previous ? lookupProfile(wedding, previous.author, previous.authorId) : null;
          const sameSender = Boolean(
            (post.authorId && previous?.authorId && post.authorId === previous.authorId)
            || (person && previousPerson && person.key === previousPerson.key)
            || (!post.authorId && !previous?.authorId && previous && post.author === previous.author),
          );
          const grouped = sameMessageThread(previous, post, sameSender, Boolean((previous?.comments ?? []).length));
          const next = shownStories[index + 1];
          const nextPerson = next ? lookupProfile(wedding, next.author, next.authorId) : null;
          const nextSame = Boolean(
            (post.authorId && next?.authorId && post.authorId === next.authorId)
            || (person && nextPerson && person.key === nextPerson.key)
            || (!post.authorId && !next?.authorId && next && post.author === next.author),
          );
          const comments = post.comments ?? [];
          const continues = sameMessageThread(post, next ?? post, Boolean(next) && nextSame, comments.length > 0);
          const threadPos = grouped && continues ? "is-thread-mid" : grouped ? "is-thread-end" : continues ? "is-thread-start" : "";
          const day = localDayKey(post.at);
          const previousDay = localDayKey(previous?.at);
          const separator = day && day !== previousDay ? chatSeparator(day, wedding, atmosphere) : "";
          const tiles = galleryOf(post);
          const caption = stockCaption(post.text);
          const downloadSources = [...new Set([...(post.images ?? []), ...postClips(post).map((clip) => clip.src), ...(post.gallery ?? []).map((item) => item.src)])];
          const bubbleStyle = {
            "--feed-wash": mine ? "var(--wc-sent)" : "var(--wc-received)",
            "--feed-bar": "transparent",
            "--feed-ink": mine ? "var(--wc-sent-ink)" : "var(--wc-received-ink)",
          } as CSSProperties;
          return (
            <li key={post.id} className={grouped ? `feed-keep chat-line is-group ${threadPos}` : `feed-keep chat-line ${threadPos}`}>
              {separator ? <p className="chat-day"><span>{separator}</span></p> : null}
              <div className={mine ? "chat-row is-mine" : "chat-row"}>
              {!mine ? (
                grouped ? <span className="chat-avatar-gap" aria-hidden="true" /> : (
                  <WeddingAvatar
                    name={displayName}
                    photo={person?.profile.photo}
                    seed={post.authorId || post.author || displayName}
                    couple={Boolean(couple)}
                    label={`${displayName}'s profile`}
                    onOpen={() => openPerson(displayName, post.authorId, mine)}
                  />
                )
              ) : null}
              <HoldTarget
                className={mine ? "chat-message is-mine" : "chat-message"}
                label={`Actions for ${displayName}'s message`}
                actions={[
                  ...(allowed
                    ? [{
                        id: "reply",
                        label: "Reply",
                        onSelect: () => setReply({ postId: post.id, author: displayName, text: post.text || "Shared a photo" }),
                      }]
                    : []),
                  ...(allowed && (post.author === viewer.name || displayName === viewer.name || host || mine)
                    ? [{
                        id: "delete",
                        label: "Delete",
                        onSelect: () => {
                          const sources = [...new Set([...post.images, ...postClips(post).map((clip) => clip.src), ...(post.gallery ?? []).map((item) => item.src)])].filter((src) => src.startsWith("gp:") || src.startsWith("r2:"));
                          const legacy = sources.some((src) => src.startsWith("gp:"));
                          if (sources.length && !window.confirm(legacy ? "Remove this from the circle? Files already in Google Drive stay there and are not deleted." : "Remove this from the circle? The file is not deleted from private storage.")) return;
                          removePost(wedding.id, post.id);
                        },
                      }]
                    : []),
                  ...(allowed
                    ? [{
                        id: "report",
                        label: "Report",
                        onSelect: () => {
                          reportPost(wedding.id, post.id, viewer.name, "Reported from the chat");
                          toast("Sent to the platform desk.");
                        },
                      }]
                    : []),
                ]}
              >
              {mine || grouped ? (
                <p className="sr-only">{displayName}</p>
              ) : (
                <p className="chat-name min-w-0 truncate">
                  <button type="button" className="truncate text-left" onClick={() => openPerson(displayName, post.authorId, false)}>{displayName}</button>
                </p>
              )}
              {post.gameCard ? (
                <WhoSaidCard card={post.gameCard} />
              ) : (post.text && !caption) || post.audio?.src ? (
              <div
                className={`chat-bubble feed-glass${mine ? " is-mine" : ""}${couple ? " is-couple" : ""}${heartId === post.id ? " chat-heart" : ""}`}
                data-couple={couple || undefined}
                style={bubbleStyle}
                onClick={(event) => {
                  if (event.detail === 2) heart(post.id);
                }}
              >
              {couple ? <CoupleSparkles /> : null}
              {post.text && !caption ? <p className="text-base leading-snug">{post.text}</p> : null}
              {post.audio?.src ? <VoiceBubble src={post.audio.src} seconds={post.audio.seconds} mine={mine} /> : null}
              </div>
              ) : null}
              {tiles.length > 0 ? (
                <div
                  className={`chat-float${couple ? " is-couple" : ""}${post.text && !caption ? "" : " has-tail"}`}
                  onClick={(event) => {
                    if (event.detail === 2) heart(post.id);
                  }}
                >
                  <p className="chat-media-done" role="status">Done</p>
                  <div className="chat-media-download-wrap">
                    <MediaGrid tiles={tiles} mine={mine} downloadFirst={canDownload(wedding, viewer.role) ? () => {
                      downloadSources.forEach((src, index) => void downloadStored(src, weddingDownloadName(src, index + 1)));
                    } : undefined} />
                    {canDownload(wedding, viewer.role) ? (
                      <button
                        type="button"
                        className="chat-media-download"
                        aria-label={downloadSources.length > 1 ? `Download ${downloadSources.length} files` : "Download file"}
                        title="Download to view"
                        onClick={(event) => {
                          event.stopPropagation();
                          downloadSources.forEach((src, index) => void downloadStored(src, weddingDownloadName(src, index + 1)));
                        }}
                      ><Download className="size-5" aria-hidden="true" /></button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {(allowed && reply?.postId === post.id && !reply.commentId) || post.delivery ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 px-1 text-xs">
                {allowed && reply?.postId === post.id && !reply.commentId ? (
                  <ReplyLine
                    weddingId={wedding.id}
                    postId={post.id}
                    quoteAuthor={displayName}
                    quoteText={post.text || "Shared a photo"}
                    onSubmit={(value) => addComment(wedding.id, post.id, viewer.name, value)}
                    onDone={() => setReply(null)}
                  />
                ) : null}
                {post.delivery === "sending" ? <span className="text-muted">Sending…</span> : null}
                {post.delivery === "pending" ? <span className="text-muted">Pending — not sent</span> : null}
                {post.delivery === "sent" ? <span className="text-muted">Sent</span> : null}
                {post.delivery === "failed" ? (
                  <button type="button" className="min-h-9 text-maroon" onClick={() => retryPost(wedding.id, post.id)}>
                    Not sent. Try again
                  </button>
                ) : null}
              </div>
              ) : null}
              </HoldTarget>
              </div>
              {comments.map((c, commentIndex) => {
                const cPerson = lookupProfile(wedding, c.author, c.authorId);
                const cName = cPerson?.profile.displayName || c.author;
                const cMine = isOwnMessage(c.authorId, account)
                  || Boolean(memberKey && cPerson?.key === memberKey)
                  || Boolean(viewer.name.trim() && (c.author === viewer.name || cName === viewer.name));
                const cCouple = coupleRole(wedding, cName, c.authorId, coupleIds);
                const priorId = commentIndex === 0 ? post.authorId : comments[commentIndex - 1]?.authorId;
                const cGrouped = Boolean(c.authorId && priorId && c.authorId === priorId);
                const parent = c.replyTo ? comments.find((item) => item.id === c.replyTo) : undefined;
                return (
                  <div key={c.id} className={cMine ? "chat-row is-mine" : "chat-row"}>
                  {!cMine ? (
                    cGrouped ? <span className="chat-avatar-gap" /> : (
                      <WeddingAvatar name={cName} photo={cPerson?.profile.photo} seed={c.authorId || c.author || cName} couple={Boolean(cCouple)} label={`${cName}'s profile`} onOpen={() => openPerson(cName, c.authorId, false)} />
                    )
                  ) : null}
                  <HoldTarget
                    className={cMine ? "chat-message is-mine" : "chat-message"}
                    label={`Actions for ${cName}'s reply`}
                    actions={allowed ? [{
                      id: "reply",
                      label: "Reply",
                      onSelect: () => setReply({ postId: post.id, commentId: c.id, author: cName, text: c.text }),
                    }] : []}
                  >
                    {cMine || cGrouped ? (
                      <p className="sr-only">{cName}</p>
                    ) : (
                      <p className="chat-name">
                        <button type="button" onClick={() => openPerson(cName, c.authorId, false)}>{cName}</button>
                      </p>
                    )}
                    <div
                      className={`chat-bubble feed-glass text-sm leading-snug${cMine ? " is-mine" : ""}${cCouple ? " is-couple" : ""}`}
                      data-couple={cCouple || undefined}
                      style={{
                        "--feed-wash": cMine ? "var(--wc-sent)" : "var(--wc-received)",
                        "--feed-bar": "transparent",
                        "--feed-ink": cMine ? "var(--wc-sent-ink)" : "var(--wc-received-ink)",
                      } as CSSProperties}
                    >
                    {cCouple ? <CoupleSparkles /> : null}
                    {parent ? (
                      <p className={cMine ? "mb-0.5 truncate border-l-2 border-on-photo/50 pl-2 text-xs text-on-photo/80" : "mb-0.5 truncate border-l-2 border-maroon/35 pl-2 text-xs text-muted"}>
                        {parent.author}: {excerpt(parent.text)}
                      </p>
                    ) : null}
                    <span>{c.text}</span>
                    </div>
                    {allowed && reply?.postId === post.id && reply.commentId === c.id ? (
                      <ReplyLine
                        weddingId={wedding.id}
                        postId={post.id}
                        commentId={c.id}
                        quoteAuthor={cName}
                        quoteText={c.text}
                        onSubmit={(value) => addComment(wedding.id, post.id, viewer.name, value, c.id)}
                        onDone={() => setReply(null)}
                      />
                    ) : null}
                  </HoldTarget>
                  </div>
                );
              })}
            </li>
          );
        })}
        {visiblePending.map((batch) => (
          <li key={batch.id} className="feed-keep chat-line">
            <div className="chat-row is-mine">
            <div className="chat-message is-mine">
              <p className="sr-only">{viewer.name}</p>
              <div className="chat-pending-media">
                <p className="chat-media-uploading" role="status">{batch.items.some((item) => item.status === "failed") ? "Upload needs attention" : "Uploading…"}</p>
                <PendingCollage batch={batch} />
              </div>
            </div>
            </div>
          </li>
        ))}
      </ol>
      </div>
      <SeekHost weddingId={wedding.id} slug={wedding.slug} name={viewer.name} memberKey={memberKey} canPlay={allowed} />
      {allowed ? (
        <form
          ref={barRef}
          data-noswipe=""
          className="chat-bar shrink-0 px-2 py-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (voiceActive) return;
            const now = performance.now();
            if (now - sentAt.current < 450) return;
            if (!text.trim() && images.length === 0 && videos.length === 0) {
              setNotice("Add a note, a photo, or a video, then press Send.");
              return;
            }
            const draft = text;
            const seek = parseSeek(draft);
            sentAt.current = now;
            try {
              addPost(wedding.id, {
                author: viewer.name,
                circle: viewerSide === "Bride" ? "Bride's side" : viewerSide === "Groom" ? "Groom's side" : "Guests",
                text: draft.trim() || (videos.length ? "Shared a video." : "Shared a photo."),
                images,
                functionId: functionId || undefined,
                videos,
                side: viewerSide,
                accessRule: audience === "people" ? { kind: "people", names: audienceNames } : audience === "all" ? undefined : { kind: audience },
              });
            } catch {
              sentAt.current = 0;
              setNotice("That message was not sent.");
              return;
            }
            setText("");
            setImages([]);
            setVideos([]);
            setNotice("");
            noteTyping(false);
            if (seek) window.dispatchEvent(new CustomEvent("wc-seek", { detail: { intent: seek, text: draft } }));
            if (images.length > 0 && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
              setPetals((value) => value + 1);
              window.setTimeout(() => setPetals(0), 1700);
            }
          }}
        >
          <div className="mx-auto w-full max-w-3xl">
          {notice ? <p className="mb-1 text-sm text-maroon">{notice}</p> : null}
          {videos.length > 0 || images.length > 0 ? (
            <MediaGrid
              mine
              tiles={[
                ...images.filter(Boolean).map((src) => ({ kind: "image" as const, src })),
                ...videos.filter((clip) => clip.src).map((clip) => ({ kind: "video" as const, src: clip.src })),
              ]}
            />
          ) : null}
          {typingNames.length > 0 ? (
            <p className="mb-1 flex items-center gap-2 px-3" aria-live="polite">
              <span className="typing-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="sr-only">{typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing</span>
            </p>
          ) : null}
          {picks.length > 0 ? (
            <div className="mb-2 rounded-2xl border border-line bg-card px-2 py-2">
              <div className="flex gap-2 overflow-x-auto">
                {picks.map((item) => (
                  <figure key={item.id} className="w-24 shrink-0">
                    {item.kind === "video" ? (
                      <video src={item.preview} preload="metadata" className="h-20 w-full rounded-xl bg-ink object-cover" muted playsInline />
                    ) : (
                      <img src={item.preview} alt="" className="h-20 w-full rounded-xl object-cover" />
                    )}
                    <figcaption className="mt-1 truncate text-[11px] text-muted">{item.name}</figcaption>
                    <p className="text-[11px] text-muted">{item.kind === "video" ? "Video" : "Photo"} · {formatBytes(item.bytes)}</p>
                    <button type="button" className="min-h-9 text-xs text-maroon" onClick={() => removePick(item.id)}>Remove</button>
                  </figure>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="min-h-11 rounded-full border border-line px-3 text-sm" onClick={() => fileRef.current?.click()}>Add more</button>
                <button type="button" className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" disabled={sendingPicks} onClick={() => void sendPicks()}>{sendingPicks ? "Preparing…" : "Send"}</button>
              </div>
            </div>
          ) : null}
          <div className={`chat-composer flex items-center gap-1 border border-line bg-card px-2 py-0.5 focus-within:border-maroon ${voiceActive ? "rounded-3xl" : "rounded-full"}`}>
            <div className="relative shrink-0" ref={plusRef}>
              <button
                type="button"
                className="chat-plus inline-flex size-9 items-center justify-center rounded-full"
                aria-label="Message options"
                aria-haspopup="menu"
                aria-expanded={plusOpen}
                onClick={() => setPlusOpen((open) => !open)}
              >
                <Plus className="size-4" aria-hidden />
              </button>
              {plusOpen ? (
                <div role="menu" aria-label="Add to message" className="chat-menu absolute bottom-full left-0 z-30 mb-2 w-64 overflow-hidden rounded-2xl border shadow-[0_16px_40px_-24px_rgba(28,20,18,0.45)]">
                  <button
                    type="button"
                    role="menuitem"
                    className="block min-h-11 w-full px-3 text-left text-sm"
                    onClick={() => {
                      setPlusOpen(false);
                      fileRef.current?.click();
                    }}
                  >
                    Upload from device
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="block min-h-11 w-full px-3 text-left text-sm"
                    onClick={() => {
                      setPlusOpen(false);
                      setCameraOpen(true);
                    }}
                  >
                    Camera
                  </button>
                  <div className="border-t border-line px-3 py-2 text-xs leading-snug text-muted" role="note">
                    <p className="flex items-center gap-1.5 font-medium text-ink">
                      <Info className="size-3.5" aria-hidden /> About posting
                    </p>
                    <p className="mt-1">Up to 50 photos per upload.</p>
                    <p className="mt-1">Up to 5 videos per upload.</p>
                    <p className="mt-2">A text note or a reply is 2 points. Each picture is 4. A video longer than 30 seconds is 6.</p>
                  </div>
                </div>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={MEDIA_ACCEPT}
                className="sr-only"
                aria-label="Upload from device"
                onChange={(e) => {
                  const input = e.target;
                  const chosen = Array.from(input.files ?? []);
                  if (!chosen.length) return;
                  onFiles(chosen);
                  // The preview is visible before phone file copies or compression finish.
                  void Promise.allSettled(chosen.map(ownSelectedFile)).then(() => {
                    input.value = "";
                  });
                }}
              />
            </div>
            {!voiceActive ? (
            <textarea
              ref={fieldRef}
              className="max-h-32 min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1 text-sm leading-snug text-ink outline-none placeholder:text-muted"
              rows={1}
              placeholder="Message your wedding circle..."
              value={text}
              onChange={(e) => {
                const next = e.target.value;
                setText(next);
                noteTyping(next.trim().length > 0);
                const height = composerFieldHeight(e.currentTarget.scrollHeight, next);
                e.currentTarget.style.height = height ? `${height}px` : "";
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
            ) : null}
            <VoiceControls
              disabled={false}
              weddingId={wedding.id}
              onActive={setVoiceActive}
              stopSignal={voiceStop}
              onPublish={(input) => publishVoiceNote({
                weddingId: wedding.id,
                author: viewer.name,
                circle: viewerSide === "Bride" ? "Bride's side" : viewerSide === "Groom" ? "Groom's side" : "Guests",
                side: viewerSide,
                functionId: functionId || undefined,
                accessRule: audience === "people" ? { kind: "people", names: audienceNames } : audience === "all" ? undefined : { kind: audience },
                ...input,
              })}
            />
            {!voiceActive ? (
              <button
                type="submit"
                className="chat-send"
                aria-label="Send message"
                disabled={!text.trim() && images.length === 0 && videos.length === 0}
                onPointerDown={keepComposerFocus}
                onPointerUp={releaseComposerSend}
              >
                <Send className="size-4" aria-hidden />
              </button>
            ) : null}
          </div>
          </div>
        </form>
      ) : null}
      {cameraOpen ? (
        <CameraCapture
          onClose={() => setCameraOpen(false)}
          onUse={(file) => {
            setCameraOpen(false);
            void onFiles([file]);
          }}
        />
      ) : null}
      {askProfile && !hasProfile && !profileOpen ? (
        <button type="button" className="mx-auto mb-1 text-xs text-maroon" onClick={() => { setProfileFirst(true); setProfileOpen(true); }}>Create your wedding profile</button>
      ) : null}
      <GuestProfileEditor
        open={profileOpen}
        first={profileFirst}
        onClose={() => {
          if (!hasProfile && typeof localStorage !== "undefined") localStorage.setItem(laterKey(wedding.slug, memberKey), "1");
          setProfileOpen(false);
        }}
      />
      {card ? (
        <ProfileCard
          name={card.name}
          profile={lookupProfile(wedding, card.name, card.authorId)?.profile ?? null}
          couple={coupleRole(wedding, card.name, card.authorId, coupleIds)}
          mine={card.mine || isOwnMessage(card.authorId, account)}
          onClose={() => setCard(null)}
          onEdit={card.mine || isOwnMessage(card.authorId, account) ? () => { setCard(null); setProfileFirst(false); setProfileOpen(true); } : undefined}
        />
      ) : null}
    </div>
  );
}

/** Keep the caret in the field so the keyboard does not close and move Send before the tap lands. */
function keepComposerFocus(event: PointerEvent<HTMLButtonElement>) {
  if (event.button !== 0 || event.pointerType === "mouse") return;
  event.preventDefault();
}

/** A canceled touch pointerdown does not emit click. Submit from finger-up if it is still on Send. */
function releaseComposerSend(event: PointerEvent<HTMLButtonElement>) {
  if (event.pointerType === "mouse" || event.button !== 0) return;
  const node = event.currentTarget;
  if (node.disabled) return;
  const box = node.getBoundingClientRect();
  const pad = 12;
  if (event.clientX < box.left - pad || event.clientX > box.right + pad || event.clientY < box.top - pad || event.clientY > box.bottom + pad) return;
  node.form?.requestSubmit();
}

function stockCaption(text: string) {
  return text === "Shared a photo." || text === "Shared a video." || text === "Shared a voice note." || /^Shared \d+ files\.$/.test(text);
}

function excerpt(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "Photo";
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean;
}

function ReplyLine({
  weddingId,
  postId,
  commentId,
  quoteAuthor,
  quoteText,
  onSubmit,
  onDone,
}: {
  weddingId: string;
  postId: string;
  commentId?: string;
  quoteAuthor: string;
  quoteText: string;
  onSubmit: (value: string) => "ok" | "failed";
  onDone: () => void;
}) {
  const key = `${postId}:${commentId ?? ""}`;
  const remembered = openReply.weddingId === weddingId && openReply.key === key;
  const [value, setValue] = useState(remembered ? openReply.text : "");
  const field = useRef<HTMLInputElement>(null);
  const sentAt = useRef(0);
  useEffect(() => {
    openReply.weddingId = weddingId;
    openReply.key = key;
    openReply.text = value;
  }, [value, weddingId, key]);
  useEffect(() => {
    field.current?.focus();
  }, []);
  function close() {
    if (openReply.key === key) {
      openReply.weddingId = "";
      openReply.text = "";
    }
    setValue("");
    onDone();
  }
  return (
    <form
      data-noswipe=""
      className="mt-0.5 w-full basis-full border-l-2 border-maroon/40 bg-paper/80 px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        const now = performance.now();
        if (now - sentAt.current < 450) return;
        const next = value.trim();
        if (!next) return;
        sentAt.current = now;
        const result = onSubmit(next);
        if (result === "failed") {
          sentAt.current = 0;
          toast("That reply could not be saved.");
          return;
        }
        close();
      }}
    >
      <p className="text-xs text-muted">Replying to {quoteAuthor}</p>
      <p className="truncate text-xs text-ink">«{excerpt(quoteText)}»</p>
      <div className="mt-1 flex items-center gap-1">
        <input ref={field} className="min-h-8 w-full rounded-full border border-line bg-ivory px-3 text-sm text-ink outline-none placeholder:text-muted" placeholder="Write a reply…" value={value} onChange={(event) => setValue(event.target.value)} />
        <button
          type="submit"
          className="min-h-8 shrink-0 rounded-full bg-maroon px-3 text-xs text-on-photo"
          onPointerDown={keepComposerFocus}
          onPointerUp={releaseComposerSend}
        >
          Send
        </button>
        <button type="button" className="inline-flex size-8 shrink-0 items-center justify-center text-muted" aria-label="Close reply" onClick={close}>×</button>
      </div>
    </form>
  );
}

function ChatFilters({
  open,
  filter,
  onOpenChange,
  onFilter,
  host,
  atmosphere,
  onAtmosphere,
}: {
  open: boolean;
  filter: MediaFilter;
  onOpenChange: (next: boolean) => void;
  onFilter: (next: MediaFilter) => void;
  host?: boolean;
  atmosphere?: boolean;
  onAtmosphere?: (enabled: boolean) => void;
}) {
  const label = filter === "photos" ? "Photos" : filter === "videos" ? "Videos" : filter === "voice" ? "Voice" : "Filter";
  const root = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  useDismissible(open, () => onOpenChange(false), root);
  useLayoutEffect(() => {
    const pane = anchor.current?.closest(".section-pane");
    if (!(pane instanceof HTMLElement)) return;
    const media = window.matchMedia(DESK_SPLIT_QUERY);
    const sync = () => {
      const on = !paneConcealed(pane);
      setVisible(on);
      setSlot(on ? document.getElementById(media.matches ? "wc-chat-tools" : "wc-topbar-tools") : null);
    };
    sync();
    const watch = new MutationObserver(sync);
    watch.observe(pane, { attributes: true, attributeFilter: ["hidden", "data-offstage"] });
    media.addEventListener("change", sync);
    return () => {
      watch.disconnect();
      media.removeEventListener("change", sync);
    };
  }, []);
  function choose(next: MediaFilter) {
    onFilter(next);
    onOpenChange(false);
  }
  const bar = (
    <div className="chat-filterbar" ref={root}>
      <button type="button" className="chat-filter-toggle" aria-expanded={open} aria-controls="chat-filter-panel" aria-label={`Filter messages, ${label}`} onClick={() => onOpenChange(!open)}>
        <Filter className="size-3.5" aria-hidden />
        {label}
      </button>
      {open ? (
        <div id="chat-filter-panel" className="chat-filter-panel wc-glass" role="group" aria-label="Filter messages">
          <button type="button" aria-pressed={filter === "photos"} onClick={() => choose("photos")}>
            <ImageIcon className="size-3.5" aria-hidden /> Photos
          </button>
          <button type="button" aria-pressed={filter === "videos"} onClick={() => choose("videos")}>
            <Video className="size-3.5" aria-hidden /> Videos
          </button>
          <button type="button" aria-pressed={filter === "voice"} onClick={() => choose("voice")}>
            <Mic className="size-3.5" aria-hidden /> Voice Notes
          </button>
          <button type="button" aria-pressed={filter === "all"} onClick={() => choose("all")}>
            All
          </button>
          {host && onAtmosphere ? (
            <button type="button" aria-pressed={atmosphere !== false} onClick={() => onAtmosphere(atmosphere === false)}>
              Wedding day notes
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
  return (
    <>
      <div ref={anchor} hidden />
      {visible && slot ? createPortal(bar, slot) : null}
    </>
  );
}

function postClips(post: { videoLabel?: string; videoSeconds?: number; videos?: { src: string; seconds: number }[] }) {
  if (post.videos?.length) return post.videos;
  if (post.videoLabel) return [{ src: post.videoLabel, seconds: post.videoSeconds ?? 0 }];
  return [];
}

function seesAnnouncement(audience: "Bride" | "Groom" | "Both" | undefined, role: string, side?: string) {
  const who = audience ?? "Both";
  if (who === "Both") return true;
  if (role === "host" || role === "cohost" || role === "planner") return true;
  return side === who;
}

type GalleryTile = { kind: "image" | "video"; src: string };
type MediaFilter = "all" | "photos" | "videos" | "voice";

function galleryOf(post: FeedPost): GalleryTile[] {
  if (post.gallery?.length) return post.gallery.flatMap((item) => item.src ? [{ kind: item.kind, src: item.src }] : []);
  return [
    ...post.images.filter(Boolean).map((src) => ({ kind: "image" as const, src })),
    ...postClips(post).filter((clip) => clip.src).map((clip) => ({ kind: "video" as const, src: clip.src })),
  ];
}

function matchesMedia(post: FeedPost, filter: MediaFilter) {
  if (filter === "all") return true;
  const tiles = galleryOf(post);
  if (filter === "photos") return tiles.some((tile) => tile.kind === "image");
  if (filter === "videos") return tiles.some((tile) => tile.kind === "video");
  return Boolean(post.audio?.src) || post.kind === "audio";
}

function batchMatches(batch: PendingBatch, filter: MediaFilter) {
  if (filter === "all") return true;
  if (filter === "voice") return false;
  if (filter === "photos") return batch.items.some((item) => item.kind === "image");
  return batch.items.some((item) => item.kind === "video");
}

function MediaCollage({ tiles, mine }: { tiles: GalleryTile[]; mine: boolean }) {
  return <MediaGrid tiles={tiles} mine={mine} />;
}

function PendingCollage({ batch }: { batch: PendingBatch }) {
  const tiles = batch.items.filter((item) => item.status !== "cancelled");
  const errors = [...new Set(tiles.filter((item) => item.status === "failed" && item.error && tiles.indexOf(item) < 4).map((item) => item.error))];
  return (
    <>
      <MediaUploadGrid
        mine
        items={tiles.map((item) => ({
          id: item.id,
          kind: item.kind,
          src: item.preview || item.src,
          status: item.status,
          progress: item.progress,
          error: item.error,
        }))}
        onRetry={(id) => retryPending(batch.id, id)}
        onCancel={(id) => cancelPending(batch.id, id)}
      />
      {errors.map((error) => (
        <p key={error} className="media-grid-error" role="status">{error}</p>
      ))}
    </>
  );
}
