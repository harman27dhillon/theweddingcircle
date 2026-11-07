import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MEDIA_LIMITS, authorizeMedia, keyBelongsToWedding } from "../infra/media-policy.ts";
import { SERVER_PUT_MAX, UPLOAD_CHUNK_BYTES, encodeUploadPiece, explainBrowserPut, explainUnreachedServer, explainUploadHttp, explainUploadRequestFailure, pieceLength, retryDelayMs, shouldRelayAfterDirect, uploadPieceCount } from "../infra/r2-browser.ts";
import { browserUploadCorsXml, completeMultipartXml, corsAllowsBrowserPut, presignS3 } from "../infra/r2-sign.ts";
import { downloadExpiry, openDownloadTicket, sealDownloadTicket } from "../infra/download-ticket.ts";
import { contentDisposition, downloadFailure, privacyAllowsDownload, safeDownloadName, weddingDownloadName } from "./download-name.ts";
import { safeMediaRef } from "./offline.ts";
import { parseR2Ref, r2RefBelongsTo, thumbObjectKey } from "./r2-ref.ts";
import { localThumbId } from "./media-db.ts";
import { mediaAfterImageError } from "./media-load.ts";

const SECRET = "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

test("an r2 ref stays inside one wedding and survives a refresh snapshot", () => {
  const own = "r2:weddings/aisha-rohan/album/ab12cd34-photo.jpg";
  const other = "r2:weddings/other-wedding/album/ab12cd34-photo.jpg";
  assert.equal(parseR2Ref(own), "weddings/aisha-rohan/album/ab12cd34-photo.jpg");
  assert.equal(parseR2Ref("r2:weddings/aisha-rohan/album/../secret.jpg"), null);
  assert.equal(r2RefBelongsTo(own, "aisha-rohan"), true);
  assert.equal(r2RefBelongsTo(other, "aisha-rohan"), false);
  assert.equal(keyBelongsToWedding("weddings/other-wedding/chat/aa-file.mp4", "aisha-rohan"), false);
  assert.equal(safeMediaRef(own), own);
  assert.equal(safeMediaRef("gp:aisha-rohan/file123"), "gp:aisha-rohan/file123");
  assert.equal(safeMediaRef("r2:https://public.example/file.jpg"), "");
});

test("a guest may upload a profile photo but not another wedding cover", () => {
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "profile", mime: "image/jpeg", bytes: 1000 }).ok, true);
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "cover", mime: "image/jpeg", bytes: 1000 }).ok, false);
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "chat", mime: "video/mp4", bytes: MEDIA_LIMITS.video }).ok, true);
  assert.equal(authorizeMedia({ role: "guest", member: true, weddingId: "w1", purpose: "chat", mime: "video/quicktime", bytes: 1000 }).ok, true);
  const crossed = authorizeMedia({
    role: "host",
    member: true,
    weddingId: "w1",
    purpose: "album",
    mime: "image/jpeg",
    bytes: 1000,
    objectKey: "weddings/w2/album/aa-photo.jpg",
  });
  assert.equal(crossed.ok, false);
});

test("a signed upload does not contain the secret and signs the content type", () => {
  const link = presignS3({
    method: "PUT",
    accountId: "a".repeat(32),
    bucket: "wedding-circle-media",
    key: "weddings/w1/album/ab12-photo.jpg",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: SECRET,
    amzDate: "20130524T000000Z",
    expiresSeconds: 60,
    contentType: "image/jpeg",
  });
  assert.equal(link.url.includes(SECRET), false);
  assert.equal(link.url.includes("X-Amz-Signature="), true);
  assert.equal(link.signedHeaders, "content-type;host");
  assert.equal(link.url.includes("wedding-circle-media"), true);
});

test("new uploads do not call Google Drive and livestream does not use R2", () => {
  const media = readFileSync(new URL("./media.ts", import.meta.url), "utf8");
  const live = readFileSync(new URL("../infra/live.ts", import.meta.url), "utf8");
  const voice = readFileSync(new URL("./voice-realtime.ts", import.meta.url), "utf8");
  const upload = readFileSync(new URL("../google/upload.ts", import.meta.url), "utf8");
  assert.equal(media.includes("uploadToGoogle"), false);
  assert.equal(media.includes("googleapis.com"), false);
  assert.equal(media.includes("uploadPreparedFile"), true);
  assert.match(upload, /not Google Drive/);
  assert.equal(upload.includes("googleUploadStart"), false);
  assert.equal(live.toLowerCase().includes("r2"), false);
  assert.equal(voice.includes("r2.cloudflarestorage.com"), false);
});

test("a browser PUT reports the real R2 result and a missing CORS answer is not called success", () => {
  assert.match(explainBrowserPut(0, ""), /blocked the upload/);
  assert.match(explainBrowserPut(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>"), /signature/);
  assert.match(explainBrowserPut(403, "<Error><Code>AccessDenied</Code><Message>secret-key</Message></Error>"), /refused/);
  assert.equal(explainBrowserPut(403, "<Error><Message>secret-key</Message></Error>").includes("secret-key"), false);
  const xml = browserUploadCorsXml();
  assert.equal(corsAllowsBrowserPut(xml), true);
  assert.equal(corsAllowsBrowserPut("<CORSConfiguration></CORSConfiguration>"), false);
  assert.equal(xml.includes("public-read"), false);
  assert.equal(xml.toLowerCase().includes("principal"), false);
  assert.equal(SERVER_PUT_MAX < 4_500_000, true);
});

test("an upload is split into small same-origin pieces and an R2 refusal is not rewritten", () => {
  assert.equal(uploadPieceCount(1), 1);
  assert.equal(pieceLength(1000, 0), 1000);
  assert.equal(uploadPieceCount(UPLOAD_CHUNK_BYTES + 10), 2);
  assert.equal(pieceLength(UPLOAD_CHUNK_BYTES + 10, 0), UPLOAD_CHUNK_BYTES);
  assert.equal(pieceLength(UPLOAD_CHUNK_BYTES + 10, 1), 10);
  assert.match(explainUploadRequestFailure(new Error("Failed to fetch")), /POST \/_serverFn\/ returned no HTTP status \(Failed to fetch\)/);
  assert.match(explainUploadRequestFailure(new Error("Failed to fetch")), /R2 was not asked/);
  assert.equal(explainUploadRequestFailure(new Error("R2 rejected the request signature. The secret was not shown. No file was uploaded.")), "");
  const r2Refusal = "R2 rejected the request signature. The secret was not shown. No file was uploaded.";
  assert.equal(explainUploadHttp(400, JSON.stringify({ ok: false, error: r2Refusal })), r2Refusal);
  assert.match(explainUploadHttp(502, "<html>bad gateway</html>"), /HTTP 502/);
  assert.match(explainUploadHttp(502, "<html>bad gateway</html>"), /not in this response/);
  const raw = new Uint8Array(9000);
  for (let index = 0; index < raw.length; index += 1) raw[index] = index % 251;
  const back = Uint8Array.from(Buffer.from(encodeUploadPiece(raw), "base64"));
  assert.equal(back.length, raw.length);
  assert.equal(back[0x1fff], raw[0x1fff]);
  assert.equal(back[0x2000], raw[0x2000]);
  assert.match(explainUnreachedServer(new Error("Failed to fetch")), /did not answer \(Failed to fetch\)/);
  const xml = completeMultipartXml([{ n: 1, e: "\"abc&def\"" }]);
  assert.equal(xml.includes("&" + "amp;"), true);
  assert.equal(xml.includes("<ETag>\"abc&def\"</ETag>"), false);
  assert.equal(xml.includes("public-read"), false);
  const server = readFileSync(new URL("../infra/infra.server.ts", import.meta.url), "utf8");
  const upload = readFileSync(new URL("./r2-upload.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../routes/api/infra/media.ts", import.meta.url), "utf8");
  const accept = server.slice(server.indexOf("export async function infraAcceptChunk"), server.indexOf("export async function infraPrepareDownload"));
  assert.equal(accept.includes("recordStoredMedia"), true);
  assert.equal(accept.indexOf("putR2Object") < accept.indexOf("recordStoredMedia"), true);
  assert.equal(upload.includes("r2.cloudflarestorage.com"), false);
  assert.equal(upload.includes("XMLHttpRequest"), false);
  assert.equal(upload.includes('"/api/infra/media"'), false);
  assert.equal(upload.includes("infraAcceptChunk"), true);
  assert.equal(upload.includes("encodeUploadPiece"), true);
  const body = upload.slice(upload.indexOf("export async function uploadPreparedFile"));
  assert.equal(body.indexOf("infraConfirmUpload") < body.indexOf("Loading 100%"), true);
  assert.equal(body.includes("shouldRelayAfterDirect"), true);
  assert.equal(route.includes("infraAcceptChunk"), true);
  assert.equal(route.includes("presign"), false);
  const downloadRoute = readFileSync(new URL("../../routes/api/infra/download.ts", import.meta.url), "utf8");
  const downloadClient = readFileSync(new URL("./media-db.ts", import.meta.url), "utf8");
  const privateDownload = downloadClient.slice(downloadClient.indexOf("async function downloadPrivate"), downloadClient.indexOf("export async function downloadStored"));
  assert.equal(privateDownload.includes("r2.cloudflarestorage.com"), false);
  assert.equal(privateDownload.includes('target = "_blank"'), false);
  assert.equal(privateDownload.includes("issueDownloadPath"), true);
  assert.equal(downloadRoute.includes("infraStreamDownload"), true);
  assert.equal(downloadRoute.includes("public-read"), false);
  const stream = server.slice(server.indexOf("async function streamTicket"), server.indexOf("async function saveCdnCheck"));
  assert.equal(stream.includes("openR2Read"), true);
  assert.equal(stream.includes("arrayBuffer"), false);
  assert.equal(stream.includes("public-read"), false);
  assert.equal(stream.includes("s-maxage"), false);
  assert.equal(stream.includes("privacyAllowsDownload"), false);
  const gate = server.slice(server.indexOf("async function downloadAllowed"), server.indexOf("export async function infraIssueDownload"));
  assert.equal(gate.includes("privacyAllowsDownload"), true);
  assert.equal(gate.includes("keyBelongsToWedding"), true);
  const prepare = server.slice(server.indexOf("export async function infraPrepareUpload"), server.indexOf("function sameWeddingObject"));
  assert.equal(prepare.includes("ensureR2BrowserCors"), false);
  assert.equal(prepare.includes("presignS3"), true);
  assert.equal(prepare.includes("assertStorageRoom"), true);
  assert.equal(server.slice(server.indexOf("async function assertStorageRoom"), server.indexOf("async function forgetAbandonedUploads")).includes("overPlanStorage"), true);
  assert.equal(prepare.includes('mode: "direct"'), true);
  const confirm = server.slice(server.indexOf("export async function infraConfirmUpload"), server.indexOf("export async function infraStoreUpload"));
  assert.equal(confirm.indexOf("headR2Object") < confirm.indexOf("recordStoredMedia"), true);
});

test("a download stays on the app and keeps the real file name", () => {
  const secret = "vault-secret";
  const name = weddingDownloadName("r2:weddings/aisha-rohan/album/ab12-photo.jpg", 1);
  assert.equal(name, "WeddingCircle_Photo_001.jpg");
  assert.equal(weddingDownloadName("r2:weddings/aisha-rohan/album/ab12-clip.mp4", 2), "WeddingCircle_Video_002.mp4");
  assert.equal(safeDownloadName("WeddingCircle_Photo_001.jpg", "weddings/aisha-rohan/album/ab12-photo.jpg"), "WeddingCircle_Photo_001.jpg");
  assert.equal(safeDownloadName("../secret.mp4", "weddings/aisha-rohan/album/ab12-photo.jpg").startsWith("WeddingCircle_"), true);
  const disposition = contentDisposition(name);
  assert.equal(disposition.includes("attachment;"), true);
  assert.equal(disposition.includes("r2.cloudflarestorage.com"), false);
  assert.equal(privacyAllowsDownload({ privacy: { download: false } }, "guest"), false);
  assert.equal(privacyAllowsDownload({ privacy: { download: false } }, "host"), true);
  assert.equal(privacyAllowsDownload({ privacy: { download: true } }, "guest"), true);
  const token = sealDownloadTicket({
    slug: "aisha-rohan",
    member: "memberkey1",
    key: "weddings/aisha-rohan/album/ab12-photo.jpg",
    name,
    mime: "image/jpeg",
    exp: downloadExpiry(1_000_000),
  }, secret);
  const opened = openDownloadTicket(token, secret, 1_000_000);
  assert.equal(opened?.key, "weddings/aisha-rohan/album/ab12-photo.jpg");
  assert.equal(openDownloadTicket(token, secret, downloadExpiry(1_000_000) * 1000 + 5000), null);
  assert.equal(openDownloadTicket("nope.token", secret), null);
  assert.match(downloadFailure(403, JSON.stringify({ error: "You are not in this wedding." })), /not in this wedding/);
  assert.equal(downloadFailure(0, "").includes("Failed to fetch"), false);
  const thumb = thumbObjectKey("weddings/aisha-rohan/album/ab12-photo.jpg");
  assert.equal(parseR2Ref(`r2:${thumb}`), thumb);
  assert.equal(thumbObjectKey("weddings/other/album/../secret.jpg"), "");
  assert.equal(localThumbId("weddings/aisha-rohan/album/ab12-photo.jpg"), "r2thumb:weddings/aisha-rohan/album/ab12-photo.jpg");
  assert.equal(localThumbId("weddings/other/album/../secret.jpg"), "");
  assert.equal(localThumbId("https://cdn.example/file.jpg"), "");
  const preview = readFileSync(new URL("./r2-upload.ts", import.meta.url), "utf8");
  const previewFn = preview.slice(preview.indexOf("export async function uploadPreviewBlob"), preview.indexOf("export async function resolveR2Media"));
  assert.equal(previewFn.includes("saveLocalThumb"), true);
  assert.equal(previewFn.includes("infraStoreThumb"), false);
  assert.equal(previewFn.includes("r2.cloudflarestorage.com"), false);
  const resolve = preview.slice(preview.indexOf("export async function resolveR2Media"));
  assert.equal(resolve.indexOf("localThumbUrl") < resolve.indexOf("infraPrepareDownload"), true);
  assert.equal(shouldRelayAfterDirect(0), true);
  assert.equal(shouldRelayAfterDirect(403), false);
  assert.equal(retryDelayMs(0), 400);
  assert.equal(retryDelayMs(1), 800);
  const media = readFileSync(new URL("./media.ts", import.meta.url), "utf8");
  assert.match(media, /return optimiseMedia\(file\)/);
  assert.match(media, /imageOrientation: "from-image"/);
  assert.match(media, /uploadLimit = 3/);
  assert.equal(media.includes("uploadPreparedFile"), true);
});

test("a broken thumbnail falls back to the original once, then stops", () => {
  const previewMiss = mediaAfterImageError({ full: false, tries: 0, failed: false }, true);
  assert.equal(previewMiss.full, true);
  assert.equal(previewMiss.failed, false);
  assert.equal(previewMiss.drop, "preview");
  const again = mediaAfterImageError(previewMiss, true);
  assert.equal(again.tries, 1);
  assert.equal(again.failed, false);
  assert.equal(again.drop, "full");
  const stopped = mediaAfterImageError(again, true);
  assert.equal(stopped.failed, true);
  assert.equal(stopped.drop, "both");
  const fullOnly = mediaAfterImageError({ full: false, tries: 0, failed: false }, false);
  assert.equal(fullOnly.failed, false);
  assert.equal(fullOnly.drop, "full");
  const upload = readFileSync(new URL("./r2-upload.ts", import.meta.url), "utf8");
  assert.equal(upload.includes("export function dropResolvedMedia"), true);
  const viewer = readFileSync(new URL("../../components/wedding/ui.tsx", import.meta.url), "utf8");
  assert.equal(viewer.includes(">Previous<"), false);
  assert.equal(viewer.includes(">Next<"), false);
  assert.equal(viewer.includes("media-preview-arrow"), true);
  const chat = readFileSync(new URL("../../components/wedding/feed-screen.tsx", import.meta.url), "utf8");
  assert.equal(chat.includes("keepComposerFocus"), true);
  assert.equal(chat.indexOf("sentAt.current = now") < chat.indexOf("addPost(wedding.id"), true);
  const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
  assert.equal(css.includes("html.keyboard-open [data-app-nav]"), true);
  assert.equal(css.includes("landing-leader-trail"), false);
  assert.equal(css.includes("leader-glow"), false);
  assert.equal(css.includes("leader-rank"), false);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*\.landing-leader-pill/);
});

