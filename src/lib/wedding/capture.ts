export function cameraFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The camera was blocked. Allow the camera in the browser settings, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "This device has no camera the browser can open.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is already in use by another app.";
  }
  if (name === "TimeoutError") {
    return "The camera took too long to open. Try again, or go back to the chat.";
  }
  return "The camera could not start.";
}

export function microphoneFailure(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone was blocked. Allow the microphone in the browser settings, then try again.";
  }
  if (name === "NotFoundError") return "This device has no microphone the browser can use.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is already in use by another app.";
  return "The microphone could not start.";
}

export function preferredMime(kind: "audio" | "video", supported: (type: string) => boolean) {
  const list =
    kind === "audio"
      ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/aac"]
      : ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm", "video/mp4"];
  return list.find((type) => {
    try {
      return supported(type);
    } catch {
      return false;
    }
  }) ?? "";
}

export function clock(total: number) {
  const seconds = Math.max(0, Math.round(Number.isFinite(total) ? total : 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

export type CameraFacing = "user" | "environment";

export function otherFacing(facing: CameraFacing): CameraFacing {
  return facing === "user" ? "environment" : "user";
}

export function cameraLabelMatches(label: string, facing: CameraFacing) {
  const text = label.toLowerCase();
  const rear = /back|rear|environment/.test(text);
  const front = /front|user|face\b/.test(text);
  return facing === "environment" ? rear && !front : front && !rear;
}

export function chooseCameraId(cameras: { deviceId: string; label: string }[], facing: CameraFacing, avoidId = "") {
  const labeled = cameras.find((camera) => camera.deviceId && camera.deviceId !== avoidId && cameraLabelMatches(camera.label, facing));
  if (labeled) return labeled.deviceId;
  const other = cameras.find((camera) => camera.deviceId && camera.deviceId !== avoidId);
  return other?.deviceId ?? "";
}

/** A landscape sensor buffer on a portrait phone has to be baked into the file, not only rotated in CSS. */
export function frameNeedsPortraitTurn(width: number, height: number, portraitUi: boolean) {
  return Boolean(portraitUi && width > height && height > 0);
}

export function cameraDrawPlan(width: number, height: number, facing: CameraFacing, portraitUi: boolean) {
  const turned = frameNeedsPortraitTurn(width, height, portraitUi);
  if (!turned) return { outWidth: width, outHeight: height, turned: false, radians: 0, mirror: facing === "user" };
  return {
    outWidth: height,
    outHeight: width,
    turned: true,
    mirror: facing === "user",
    radians: facing === "environment" ? Math.PI / 2 : -Math.PI / 2,
  };
}

export type QuarterTurn = 0 | 90 | 180 | 270;
export type DrawTurn = QuarterTurn | "auto";

/** Clockwise degrees to bake so a portrait phone shows the frame upright. */
export function chooseBakeTurn(
  width: number,
  height: number,
  facing: CameraFacing,
  portraitUi: boolean,
  reported: number | null,
): QuarterTurn {
  if (!portraitUi || width < 2 || height < 2) return 0;
  const quarter = normalizeQuarter(reported);
  if (quarter === 90 || quarter === 180 || quarter === 270) return quarter;
  if (width > height) return facing === "user" ? 270 : 90;
  return 0;
}

export function composerFieldHeight(scrollHeight: number, value: string) {
  if (!value) return 0;
  const measured = Number.isFinite(scrollHeight) ? scrollHeight : 32;
  return Math.min(Math.max(32, Math.ceil(measured)), 128);
}

function normalizeQuarter(value: number | null): QuarterTurn | null {
  if (value == null || !Number.isFinite(value)) return null;
  const turned = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  if (turned === 0 || turned === 90 || turned === 180 || turned === 270) return turned;
  return null;
}

export function drawCameraFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
  facing: CameraFacing,
  portraitUi: boolean,
  mirror: boolean,
  turn: DrawTurn = "auto",
) {
  const degrees = turn === "auto" ? chooseBakeTurn(width, height, facing, portraitUi, null) : turn;
  const swap = degrees === 90 || degrees === 270;
  const canvas = ctx.canvas;
  const nextWidth = Math.max(2, swap ? height : width);
  const nextHeight = Math.max(2, swap ? width : height);
  if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (degrees === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (degrees === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate(-Math.PI / 2);
  } else if (degrees === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  }
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0, width, height);
}

export function fitFrame(stageWidth: number, stageHeight: number, ratioWidth: number, ratioHeight: number) {
  const aspect = ratioWidth / ratioHeight;
  if (!(stageWidth > 1) || !(stageHeight > 1) || !(aspect > 0)) return { x: 0, y: 0, width: stageWidth, height: stageHeight };
  let width = stageWidth;
  let height = width / aspect;
  if (height > stageHeight) {
    height = stageHeight;
    width = height * aspect;
  }
  return { x: (stageWidth - width) / 2, y: (stageHeight - height) / 2, width, height };
}

/** Center crop matching an object-fit:cover preview and a centered aspect frame. No rotation. */
export function frameCrop(
  sourceWidth: number,
  sourceHeight: number,
  stageWidth: number,
  stageHeight: number,
  ratioWidth: number,
  ratioHeight: number,
) {
  if (sourceWidth < 2 || sourceHeight < 2 || stageWidth < 2 || stageHeight < 2 || ratioWidth < 1 || ratioHeight < 1) {
    return { x: 0, y: 0, width: sourceWidth, height: sourceHeight };
  }
  const scale = Math.max(stageWidth / sourceWidth, stageHeight / sourceHeight);
  const visibleW = stageWidth / scale;
  const visibleH = stageHeight / scale;
  const originX = (sourceWidth - visibleW) / 2;
  const originY = (sourceHeight - visibleH) / 2;
  const frame = fitFrame(stageWidth, stageHeight, ratioWidth, ratioHeight);
  return {
    x: originX + frame.x / scale,
    y: originY + frame.y / scale,
    width: frame.width / scale,
    height: frame.height / scale,
  };
}

function denied(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError";
}

async function takeVideo(constraints: MediaStreamConstraints) {
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  const track = stream.getVideoTracks()[0] ?? null;
  stream.getTracks().forEach((item) => {
    if (item !== track) item.stop();
  });
  if (!track) throw new DOMException("The camera could not start.", "NotFoundError");
  return track;
}

// Ask for a landscape 1080p ideal, never a portrait buffer. On Android, ideal
// height > width is answered with sideways sensor frames. Fallbacks below drop
// these ideals when the camera rejects them.
const cameraVideo: MediaTrackConstraints = {
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  frameRate: { ideal: 30, max: 30 },
};

/** Android camera HALs stay busy for a moment after a track is stopped. */
export function cameraReleaseDelay() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 280);
  });
}

function openedLens(track: MediaStreamTrack, facing: CameraFacing, avoidId: string) {
  if (!avoidId) return true;
  const settings = track.getSettings();
  const opened = settings.deviceId ?? "";
  if (opened && opened === avoidId) return false;
  if (settings.facingMode === "user" || settings.facingMode === "environment") return settings.facingMode === facing;
  return true;
}

export async function openVideoTrack(facing: CameraFacing, avoidId = "") {
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const cameras = devices
    .filter((device) => device.kind === "videoinput")
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  const id = chooseCameraId(cameras, facing, avoidId);
  const attempts: MediaStreamConstraints[] = [];
  if (id) {
    attempts.push({ audio: false, video: { ...cameraVideo, deviceId: { exact: id } } });
    attempts.push({ audio: false, video: { deviceId: { exact: id } } });
  }
  attempts.push(
    { audio: false, video: { ...cameraVideo, facingMode: { exact: facing } } },
    { audio: false, video: { facingMode: { exact: facing } } },
    { audio: false, video: { ...cameraVideo, facingMode: { ideal: facing } } },
    { audio: false, video: { facingMode: { ideal: facing } } },
  );
  let last: unknown;
  for (const constraints of attempts) {
    try {
      const track = await takeVideo(constraints);
      if (!openedLens(track, facing, avoidId)) {
        track.stop();
        last = new DOMException("The other camera could not be opened.", "NotFoundError");
        continue;
      }
      return track;
    } catch (error) {
      last = error;
      if (denied(error)) throw error;
      const name = error instanceof DOMException ? error.name : "";
      if (name === "NotReadableError" || name === "AbortError") await cameraReleaseDelay();
    }
  }
  throw last instanceof Error ? last : new DOMException("The camera could not start.", "AbortError");
}

/** Private audio is readable only with the host edit key or a wedding member key. */
export function canReadPrivateMedia(mime: string, proof: { editMatch: boolean; memberMatch: boolean }) {
  if (!mime.toLowerCase().startsWith("audio/")) return true;
  return Boolean(proof.editMatch || proof.memberMatch);
}

export function voiceAttachment(value: unknown): { src: string; seconds: number } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as { src?: unknown; seconds?: unknown };
  const src = typeof body.src === "string" ? body.src.trim() : "";
  if (!src || src.length > 500 || src.startsWith("data:") || src.startsWith("blob:")) return undefined;
  if (!src.startsWith("idb:") && !src.startsWith("gp:") && !src.startsWith("r2:") && !src.startsWith("https:") && !src.startsWith("http:")) return undefined;
  const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? Math.round(body.seconds) : 0;
  if (seconds < 1 || seconds > 600) return undefined;
  return { src, seconds };
}
