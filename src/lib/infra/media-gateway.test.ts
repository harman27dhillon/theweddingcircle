import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleMediaGateway, judgeGatewayProbe, buildGatewayReport, classifyGatewayTransport, authorizedCacheRequest, readMediaEdgeCache, signedProbeMismatch, type MediaGatewayBinding, type MediaHead } from "./media-gateway.ts";
import {
  GATEWAY_PROBE_KEY,
  MEDIA_TOKEN_TTL_SECONDS,
  canonicalObjectKey,
  chooseMediaUrl,
  cleanGatewayInput,
  DEPLOYED_MEDIA_GATEWAY_ORIGIN,
  gatewayMark,
  gatewaySecretOk,
  gatewaySavedStatus,
  mayIssueViewToken,
  mediaGatewayUrl,
  normalizeGatewayOrigin,
  signMediaToken,
  verifyMediaToken,
} from "./media-token.ts";

const SECRET = "test-only-media-gateway-secret-0123456789";
const OTHER_SECRET = "another-test-only-media-gateway-secret-99";
const ORIGIN = "https://media.theweddingcircle.in";
const APP = "https://theweddingcircle.in";
const KEY = "weddings/aisha-rohan/album/ab12-photo.jpg";
const VIDEO = "weddings/aisha-rohan/chat/ab12cd-clip.mp4";
const OTHER = "weddings/other-wedding/album/ab12-photo.jpg";

function bytes(text: string) {
  return new TextEncoder().encode(text);
}

function memoryBucket(files: Record<string, { type: string; body: string }>) {
  const calls: string[] = [];
  const binding = {
    calls,
    secret: SECRET,
    allowedOrigins: `${APP},https://www.theweddingcircle.in`,
    async head(key: string): Promise<MediaHead | null> {
      calls.push(`head:${key}`);
      const file = files[key];
      if (!file) return null;
      return { size: bytes(file.body).length, etag: "etag-1", uploaded: new Date("2026-01-02T00:00:00Z"), contentType: file.type };
    },
    async get(key: string, range?: { offset: number; length: number }): Promise<MediaHead | null> {
      calls.push(`get:${key}:${range ? `${range.offset}+${range.length}` : "all"}`);
      const file = files[key];
      if (!file) return null;
      const raw = bytes(file.body);
      const slice = range ? raw.slice(range.offset, range.offset + range.length) : raw;
      return { size: raw.length, etag: "etag-1", uploaded: new Date("2026-01-02T00:00:00Z"), contentType: file.type, body: slice };
    },
  } satisfies MediaGatewayBinding & { calls: string[] };
  return binding;
}

async function tokenFor(key: string, secret = SECRET, exp = 2_000_000_000, disp: "inline" | "attachment" = "inline") {
  return signMediaToken({
    slug: key.split("/")[1] || "",
    key,
    methods: ["GET", "HEAD"],
    exp,
    disp,
    name: "WeddingCircle_Photo_001.jpg",
  }, secret);
}

function ask(path: string, token = "", init: RequestInit = {}) {
  const url = `${ORIGIN}${path}${token ? `?t=${encodeURIComponent(token)}` : ""}`;
  return new Request(url, init);
}

test("a gateway origin cannot be a public R2 host", () => {
  assert.equal(normalizeGatewayOrigin("https://media.theweddingcircle.in"), ORIGIN);
  assert.equal(normalizeGatewayOrigin(DEPLOYED_MEDIA_GATEWAY_ORIGIN), DEPLOYED_MEDIA_GATEWAY_ORIGIN);
  assert.equal(normalizeGatewayOrigin("https://wedding-circle.r2.dev"), "");
  assert.equal(normalizeGatewayOrigin("https://account.r2.cloudflarestorage.com"), "");
  assert.equal(cleanGatewayInput({ enabled: true, origin: "https://pub.r2.dev" }).ok, false);
  assert.equal(cleanGatewayInput({ enabled: false, origin: "https://media.theweddingcircle.in" }).ok, true);
  assert.equal(gatewaySecretOk("short"), false);
  assert.equal(gatewaySecretOk(SECRET), true);
});

test("tokens are scoped, expiring, and do not contain the secret", async () => {
  const now = 1_700_000_000;
  const token = await signMediaToken({
    slug: "aisha-rohan",
    key: KEY,
    methods: ["HEAD", "GET"],
    exp: now + MEDIA_TOKEN_TTL_SECONDS,
    disp: "inline",
    name: "WeddingCircle_Photo_001.jpg",
  }, SECRET);
  assert.equal(token.includes(SECRET), false);
  assert.equal(token.includes("R2_SECRET"), false);
  const opened = await verifyMediaToken(token, SECRET, now + 10);
  assert.equal(opened?.key, KEY);
  assert.equal(await verifyMediaToken(token, OTHER_SECRET, now + 10), null);
  assert.equal(await verifyMediaToken(token, SECRET, now + MEDIA_TOKEN_TTL_SECONDS + 5), null);
  const flipped = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(await verifyMediaToken(flipped, SECRET, now + 10), null);
  const [version, body, signature] = token.split(".");
  const decoded = JSON.stringify({ key: OTHER });
  assert.equal(await verifyMediaToken(`${version}.${Buffer.from(decoded).toString("base64url")}.${signature}`, SECRET, now + 10), null);
  assert.equal(canonicalObjectKey("weddings/aisha-rohan/album/../secret.jpg"), "");
  assert.equal(canonicalObjectKey("weddings/aisha-rohan/album/%2e%2e/secret.jpg"), "");
  assert.equal(mayIssueViewToken({ member: false, keyOk: true, recorded: true }), false);
  assert.equal(mayIssueViewToken({ member: true, keyOk: true, recorded: false }), false);
  assert.equal(mayIssueViewToken({ member: true, keyOk: false, recorded: true }), false);
  assert.equal(mayIssueViewToken({ member: true, keyOk: true, recorded: true }), true);
  const url = mediaGatewayUrl(ORIGIN, KEY, token);
  assert.equal(url.startsWith(`${ORIGIN}/v1/weddings/aisha-rohan/album/ab12-photo.jpg?t=`), true);
  assert.equal(url.includes(SECRET), false);
  assert.equal(chooseMediaUrl({ gatewayUrl: url, fallbackUrl: "https://example.r2.cloudflarestorage.com/bucket/a?X-Amz-Signature=1" }), url);
  assert.equal(chooseMediaUrl({ gatewayUrl: "", fallbackUrl: "https://example.r2.cloudflarestorage.com/bucket/a?X-Amz-Signature=1" }).includes("X-Amz-Signature"), true);
  const first = await gatewayMark(ORIGIN, SECRET);
  const rotated = await gatewayMark(ORIGIN, OTHER_SECRET);
  assert.equal(first === rotated, false);
  assert.equal(first.includes(SECRET), false);
});

test("the worker refuses missing, bad, expired, swapped, and traversal requests without reading R2", async () => {
  const bucket = memoryBucket({ [KEY]: { type: "image/jpeg", body: "jpeg-bytes" }, [OTHER]: { type: "image/jpeg", body: "other-wedding" } });
  const valid = await tokenFor(KEY);
  const missing = await handleMediaGateway(ask(`/v1/${KEY}`), bucket);
  assert.equal(missing.status, 403);
  assert.equal(bucket.calls.length, 0);
  assert.match(missing.headers.get("cache-control") || "", /private, no-store/);
  assert.equal((missing.headers.get("cache-control") || "").includes("public"), false);

  const bad = await handleMediaGateway(ask(`/v1/${KEY}`, "v1.not.a-real-signature"), bucket);
  assert.equal(bad.status, 403);
  assert.equal(bucket.calls.length, 0);

  const expired = await tokenFor(KEY, SECRET, 10);
  const late = await handleMediaGateway(ask(`/v1/${KEY}`, expired), bucket);
  assert.equal(late.status, 403);
  assert.equal(bucket.calls.length, 0);

  const flipped = `${valid.slice(0, -1)}${valid.endsWith("a") ? "b" : "a"}`;
  const altered = await handleMediaGateway(ask(`/v1/${KEY}`, flipped), bucket);
  assert.equal(altered.status, 403);

  const swapped = await handleMediaGateway(ask(`/v1/${OTHER}`, valid), bucket);
  assert.equal(swapped.status, 403);
  assert.equal(swapped.headers.get("cache-control"), "private, no-store");
  assert.equal(bucket.calls.some((call) => call.includes(OTHER)), false);

  const otherToken = await tokenFor(OTHER);
  const crossed = await handleMediaGateway(ask(`/v1/${KEY}`, otherToken), bucket);
  assert.equal(crossed.status, 403);

  const climb = await handleMediaGateway(ask("/v1/weddings/aisha-rohan/album/%2e%2e/%2e%2e/secret.jpg", valid), bucket);
  assert.equal(climb.status, 403);
  const encoded = await handleMediaGateway(ask("/v1/weddings%2Fother-wedding%2Falbum%2Fab12-photo.jpg", valid), bucket);
  assert.equal(encoded.status, 403);
  assert.equal(bucket.calls.length, 0);

  const ok = await handleMediaGateway(ask(`/v1/${KEY}`, valid, { headers: { origin: APP } }), bucket);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "jpeg-bytes");
  assert.equal(ok.headers.get("content-type"), "image/jpeg");
  assert.equal(ok.headers.get("access-control-allow-origin"), APP);
  assert.match(ok.headers.get("cache-control") || "", /private, no-store/);
  assert.equal((ok.headers.get("cdn-cache-control") || "").includes("public"), false);
  assert.equal(ok.headers.get("referrer-policy"), "no-referrer");
  assert.equal(ok.headers.get("location"), null);
});

test("video range, HEAD, conditional requests, and CORS stay private", async () => {
  const body = "0123456789abcdef";
  const bucket = memoryBucket({ [VIDEO]: { type: "video/mp4", body } });
  const token = await signMediaToken({
    slug: "aisha-rohan",
    key: VIDEO,
    methods: ["GET", "HEAD"],
    exp: 2_000_000_000,
    disp: "inline",
    name: "WeddingCircle_Video_002.mp4",
  }, SECRET);
  const head = await handleMediaGateway(ask(`/v1/${VIDEO}`, token, { method: "HEAD" }), bucket);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("content-length"), String(body.length));
  assert.equal(head.headers.get("accept-ranges"), "bytes");
  assert.equal(bucket.calls.some((call) => call.startsWith("get:")), false);

  const partial = await handleMediaGateway(ask(`/v1/${VIDEO}`, token, { headers: { range: "bytes=0-3" } }), bucket);
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), `bytes 0-3/${body.length}`);
  assert.equal(await partial.text(), "0123");
  const beyond = await handleMediaGateway(ask(`/v1/${VIDEO}`, token, { headers: { range: "bytes=40-50" } }), bucket);
  assert.equal(beyond.status, 416);
  assert.match(beyond.headers.get("content-range") || "", /bytes \*/);
  assert.match(beyond.headers.get("cache-control") || "", /private, no-store/);

  const cached = await handleMediaGateway(ask(`/v1/${VIDEO}`, token, { headers: { "if-none-match": '"etag-1"' } }), bucket);
  assert.equal(cached.status, 304);
  const stale = await handleMediaGateway(ask(`/v1/${VIDEO}`, token, { headers: { "if-modified-since": "Wed, 01 Jan 2020 00:00:00 GMT" } }), bucket);
  assert.equal(stale.status, 200);

  const evil = await handleMediaGateway(ask(`/v1/${VIDEO}`, token, { headers: { origin: "https://evil.example" } }), bucket);
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
  const preflight = await handleMediaGateway(new Request(`${ORIGIN}/v1/${VIDEO}`, { method: "OPTIONS", headers: { origin: APP } }), bucket);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), APP);
  assert.equal((preflight.headers.get("access-control-allow-origin") || "").includes("*"), false);
  const blocked = await handleMediaGateway(new Request(`${ORIGIN}/v1/${VIDEO}`, { method: "OPTIONS", headers: { origin: "https://evil.example" } }), bucket);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

test("one wedding's response is not reusable as another wedding's media", async () => {
  const bucket = memoryBucket({
    [KEY]: { type: "image/jpeg", body: "photo-a" },
    [OTHER]: { type: "image/jpeg", body: "photo-b" },
  });
  const first = await handleMediaGateway(ask(`/v1/${KEY}`, await tokenFor(KEY)), bucket);
  const second = await handleMediaGateway(ask(`/v1/${OTHER}`, await tokenFor(OTHER)), bucket);
  assert.equal(await first.text(), "photo-a");
  assert.equal(await second.text(), "photo-b");
  assert.match(first.headers.get("cache-control") || "", /private/);
  assert.match(second.headers.get("cache-control") || "", /no-store/);
  assert.equal((first.headers.get("cache-control") || "").includes("public"), false);
});

test("the gateway probe fails closed on a public answer", () => {
  const open = judgeGatewayProbe({
    enabled: true,
    origin: ORIGIN,
    anonymousStatus: 200,
    anonymousCache: "public, max-age=60",
    anonymousLocation: "",
    badStatus: 403,
    signedStatus: 404,
    signedCache: "private, no-store",
    signedLocation: "",
    signedType: "application/json",
  });
  assert.equal(open.usable, false);
  const redirect = judgeGatewayProbe({
    enabled: true,
    origin: ORIGIN,
    anonymousStatus: 302,
    anonymousCache: "private, no-store",
    anonymousLocation: "https://bucket.r2.dev/file.jpg",
    badStatus: 403,
    signedStatus: 404,
    signedCache: "private, no-store",
    signedLocation: "",
    signedType: "application/json",
  });
  assert.equal(redirect.usable, false);
  assert.match(redirect.requirement, /not made public|Do not enable r2.dev|public R2/);
  const ready = judgeGatewayProbe({
    enabled: true,
    origin: ORIGIN,
    anonymousStatus: 403,
    anonymousCache: "private, no-store",
    anonymousLocation: "",
    badStatus: 403,
    signedStatus: 404,
    signedCache: "private, no-store",
    signedLocation: "",
    signedType: "application/json; charset=utf-8",
  });
  assert.equal(ready.usable, true);
  const off = judgeGatewayProbe({
    enabled: false,
    origin: ORIGIN,
    anonymousStatus: 403,
    anonymousCache: "private, no-store",
    anonymousLocation: "",
    badStatus: 403,
    signedStatus: 404,
    signedCache: "private, no-store",
    signedLocation: "",
    signedType: "application/json",
  });
  assert.equal(off.usable, false);
  assert.equal(off.state, "disabled");
});

test("issuance stays behind membership and the worker does not publish the bucket", () => {
  const server = readFileSync(new URL("./infra.server.ts", import.meta.url), "utf8");
  const prepare = server.slice(server.indexOf("export async function infraPrepareDownload"), server.indexOf("export async function infraDropUnrecorded"));
  assert.equal(prepare.indexOf("memberRole") < prepare.indexOf("signMediaToken"), true);
  assert.equal(prepare.indexOf("mayIssueViewToken") < prepare.indexOf("signMediaToken"), true);
  assert.equal(prepare.indexOf("signMediaToken") < prepare.indexOf("presignS3"), true);
  assert.equal(prepare.includes("presignS3"), true);
  const issue = server.slice(server.indexOf("export async function infraIssueDownload"), server.indexOf("function safeType"));
  assert.equal(issue.indexOf("downloadAllowed") < issue.indexOf("signMediaToken"), true);
  const worker = readFileSync(new URL("../../../workers/media-gateway/src/index.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("../../../workers/media-gateway/wrangler.toml", import.meta.url), "utf8");
  assert.equal(worker.includes("r2.dev"), false);
  assert.equal(worker.includes("public-read"), false);
  assert.equal(config.includes("r2.dev"), true);
  assert.match(config, /workers_dev = false/);
  assert.match(config, /binding = "MEDIA"/);
  const upload = readFileSync(new URL("../wedding/r2-upload.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../../components/wedding/ui.tsx", import.meta.url), "utf8");
  assert.equal(upload.includes("MEDIA_GATEWAY_SECRET"), false);
  assert.equal(upload.includes("R2_SECRET_ACCESS_KEY"), false);
  assert.equal(view.includes("MEDIA_GATEWAY_SECRET"), false);
  assert.equal(GATEWAY_PROBE_KEY.startsWith("weddings/gateway-probe/"), true);
  const gatewayTest = server.slice(server.indexOf("export async function infraGatewayTest"));
  assert.equal(gatewayTest.includes("MEDIA_GATEWAY_ENABLED ="), false);
  assert.equal(gatewayTest.includes("r2.dev"), false);
});

const blankProbe = {
  anonymousStatus: null as number | null,
  anonymousType: "",
  anonymousCache: "",
  anonymousLocation: "",
  originAllowed: null as boolean | null,
  badStatus: null as number | null,
  signedStatus: null as number | null,
  signedType: "",
  signedCache: "",
  signedLocation: "",
  signedPrepared: false,
};

test("gateway diagnostics name the first failed step and do not repeat a disabled call", () => {
  const off = buildGatewayReport({ enabled: false, origin: ORIGIN, originValid: true, secretPresent: true, transport: "skipped", ...blankProbe });
  assert.equal(off.stage, "disabled");
  assert.match(off.summary, /gateway is off/i);
  assert.equal(off.checks.filter((item) => item.detail === off.summary).length, 0);
  assert.equal(off.checks.filter((item) => item.result === "skipped").length, 9);
  assert.equal(off.summary.includes(SECRET), false);
  assert.equal(off.checks.find((item) => item.id === "secret")?.result, "present");
  assert.equal(off.checks.find((item) => item.id === "secret")?.label, "Media Gateway Secret");
  assert.match(off.checks.find((item) => item.id === "secret")?.detail || "", /MEDIA_GATEWAY_SECRET/);
  assert.equal(off.checks.find((item) => item.id === "secret")?.detail.includes(SECRET), false);
  assert.equal(off.checks.some((item) => item.detail.includes(SECRET)), false);

  const dns = classifyGatewayTransport({ code: "ENOTFOUND" });
  const tls = classifyGatewayTransport({ code: "CERT_HAS_EXPIRED" });
  const timeout = classifyGatewayTransport({ name: "TimeoutError" });
  const down = classifyGatewayTransport({ code: "ECONNREFUSED" });
  assert.equal(dns.stage, "dns");
  assert.equal(tls.stage, "tls");
  assert.equal(timeout.stage, "timeout");
  assert.equal(down.stage, "unreachable");
  assert.equal(`${dns.detail} ${tls.detail} ${timeout.detail} ${down.detail}`.includes("?t="), false);

  const unreachable = buildGatewayReport({ enabled: true, origin: ORIGIN, originValid: true, secretPresent: true, transport: "dns", ...blankProbe });
  assert.equal(unreachable.stage, "dns");
  assert.equal(unreachable.checks.find((item) => item.id === "signed")?.result, "skipped");

  const binding = buildGatewayReport({
    enabled: true,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 503,
    anonymousType: "application/json",
  });
  assert.equal(binding.stage, "binding");
  assert.equal(binding.checks.find((item) => item.id === "anonymous")?.result, "skipped");
  assert.match(binding.summary, /binding/i);

  const missingRoute = buildGatewayReport({
    enabled: true,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 404,
    anonymousType: "text/plain",
    originAllowed: false,
  });
  assert.equal(missingRoute.stage, "anonymous");
  assert.match(missingRoute.summary, /HTTP 404/);

  const secretMismatch = buildGatewayReport({
    enabled: true,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 403,
    anonymousType: "application/json",
    anonymousCache: "private, no-store",
    originAllowed: true,
    badStatus: 403,
    signedStatus: 401,
    signedPrepared: true,
  });
  assert.equal(secretMismatch.stage, "signed");
  assert.match(secretMismatch.summary, /does not match/);
  assert.equal(secretMismatch.summary.includes(SECRET), false);
  assert.equal(secretMismatch.checks.find((item) => item.id === "private")?.result, "skipped");

  const ready = buildGatewayReport({
    enabled: true,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 403,
    anonymousType: "application/json; charset=utf-8",
    anonymousCache: "private, no-store",
    originAllowed: true,
    badStatus: 403,
    signedStatus: 404,
    signedType: "application/json; charset=utf-8",
    signedCache: "private, no-store",
    signedPrepared: true,
  });
  assert.equal(ready.stage, "verified");
  assert.equal(ready.verdict.usable, true);
  assert.equal(ready.checks.find((item) => item.id === "private")?.result, "passed");
  assert.equal(ready.checks.find((item) => item.id === "anonymous")?.result, "passed");

  const publicRedirect = buildGatewayReport({
    enabled: true,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 302,
    anonymousType: "text/plain",
    anonymousLocation: "https://bucket.r2.dev/file.jpg",
    originAllowed: true,
  });
  assert.equal(publicRedirect.verdict.usable, false);
  assert.match(publicRedirect.verdict.requirement, /not made public|r2\.dev/);
});

test("a gateway test can run while the switch is off and still does not enable delivery", () => {
  const offButChecked = buildGatewayReport({
    enabled: false,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 403,
    anonymousType: "application/json",
    anonymousCache: "private, no-store",
    originAllowed: true,
    badStatus: 403,
    signedStatus: 404,
    signedType: "application/json",
    signedCache: "private, no-store",
    signedPrepared: true,
    headStatus: 403,
    postStatus: 405,
    expiredStatus: 403,
    modifiedStatus: 403,
    signedHeadStatus: 404,
  });
  assert.equal(offButChecked.verdict.usable, false);
  assert.equal(offButChecked.stage, "disabled");
  assert.match(offButChecked.summary, /switch is still off/i);
  assert.equal(offButChecked.checks.find((item) => item.id === "anonymous")?.result, "passed");
  assert.equal(offButChecked.checks.find((item) => item.id === "expired")?.result, "passed");
  assert.equal(offButChecked.summary.includes(SECRET), false);
});

test("a signed 403 names the mismatch and a placeholder origin is not saved", async () => {
  assert.equal(gatewaySavedStatus({ checking: true, saved: true, dirty: false }), "Checking");
  assert.equal(gatewaySavedStatus({ checking: false, saved: true, dirty: false }), "Saved on server");
  assert.equal(gatewaySavedStatus({ checking: false, saved: true, dirty: true }), "Unsaved changes");
  assert.equal(gatewaySavedStatus({ checking: false, saved: false, dirty: false }), "Missing");
  const rejected = buildGatewayReport({
    enabled: false,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 403,
    anonymousType: "application/json",
    anonymousCache: "private, no-store",
    originAllowed: true,
    badStatus: 403,
    signedStatus: 403,
    signedType: "application/json",
    signedCache: "private, no-store",
    signedPrepared: true,
    signedCode: "signature",
  });
  assert.equal(rejected.verdict.usable, false);
  assert.equal(rejected.verdict.state, "error");
  assert.match(rejected.summary, /Worker rejected the signed probe/);
  assert.match(rejected.summary, /Mismatch: signature/);
  assert.equal(rejected.summary.includes(SECRET), false);
  const unnamed = buildGatewayReport({
    enabled: true,
    origin: ORIGIN,
    originValid: true,
    secretPresent: true,
    transport: "ok",
    ...blankProbe,
    anonymousStatus: 403,
    anonymousType: "application/json",
    anonymousCache: "private, no-store",
    originAllowed: true,
    badStatus: 403,
    signedStatus: 403,
    signedType: "application/json",
    signedPrepared: true,
  });
  assert.match(unnamed.summary, /unclassified/);
  assert.match(signedProbeMismatch("expired"), /expiry/);
  assert.match(signedProbeMismatch("path"), /object path/);
  assert.match(signedProbeMismatch("method"), /HTTP method/);
  assert.equal(signedProbeMismatch(undefined).includes(SECRET), false);
  const bucket = memoryBucket({});
  const valid = await signMediaToken({ slug: "aisha-rohan", key: KEY, methods: ["GET", "HEAD"], exp: Math.floor(Date.now() / 1000) + 60, disp: "inline", name: "photo.jpg" }, SECRET);
  const bad = await handleMediaGateway(new Request(`${ORIGIN}/v1/${KEY}?t=v1.bad.sig`), bucket);
  assert.equal(bad.status, 403);
  assert.equal((await bad.json()).code, "signature");
  const late = await signMediaToken({ slug: "aisha-rohan", key: KEY, methods: ["GET", "HEAD"], exp: 10, disp: "inline", name: "photo.jpg" }, SECRET);
  const expired = await handleMediaGateway(new Request(`${ORIGIN}/v1/${KEY}?t=${late}`), bucket);
  assert.equal((await expired.json()).code, "expired");
  const moved = await handleMediaGateway(new Request(`${ORIGIN}/v1/${OTHER}?t=${valid}`), bucket);
  assert.equal((await moved.json()).code, "path");
  const headOnly = await signMediaToken({ slug: "aisha-rohan", key: KEY, methods: ["HEAD"], exp: Math.floor(Date.now() / 1000) + 60, disp: "inline", name: "photo.jpg" }, SECRET);
  const wrongMethod = await handleMediaGateway(new Request(`${ORIGIN}/v1/${KEY}?t=${headOnly}`), bucket);
  assert.equal((await wrongMethod.json()).code, "method");
  assert.equal(bucket.calls.length, 0);
});

test("authorized edge cache is read only after the signature and the token is not the cache key", async () => {
  assert.equal(readMediaEdgeCache("authorized"), true);
  assert.equal(readMediaEdgeCache(" Authorized "), true);
  assert.equal(readMediaEdgeCache("\"authorized\""), true);
  assert.equal(readMediaEdgeCache("no"), false);
  assert.equal(readMediaEdgeCache(""), false);
  const stored = new Map<string, Response>();
  let matches = 0;
  const edgeCache = {
    async match(request: Request) {
      matches += 1;
      assert.equal(request.url.includes("t="), false);
      assert.equal(request.method, "GET");
      const found = stored.get(request.url);
      return found ? found.clone() : undefined;
    },
    async put(request: Request, response: Response) {
      assert.equal(request.url.includes("?t="), false);
      assert.equal(request.method, "GET");
      const policy = response.headers.get("cache-control") || "";
      assert.match(policy, /^public, max-age=\d+$/);
      assert.equal(/private|no-store|no-cache/i.test(policy), false);
      assert.equal(response.headers.get("cdn-cache-control"), null);
      assert.equal(response.status, 200);
      stored.set(request.url, response);
    },
  };
  const bucket = memoryBucket({
    [KEY]: { type: "image/jpeg", body: "photo-bytes" },
    [OTHER]: { type: "image/jpeg", body: "other-wedding" },
    [VIDEO]: { type: "video/mp4", body: "video-bytes" },
  });
  const binding = { ...bucket, edgeCache, cachePolicy: "authorized" as const };
  const token = await tokenFor(KEY);
  const denied = await handleMediaGateway(ask(`/v1/${KEY}`), binding);
  assert.equal(denied.status, 403);
  assert.equal(stored.size, 0);
  assert.equal(matches, 0);
  assert.equal(bucket.calls.length, 0);
  const first = await handleMediaGateway(ask(`/v1/${KEY}`, token), binding);
  assert.equal(first.status, 200);
  assert.equal(await first.text(), "photo-bytes");
  assert.equal(first.headers.get("x-wc-cache"), "MISS");
  assert.equal(first.headers.get("cache-control"), "private, no-store");
  assert.equal(first.headers.get("cdn-cache-control"), "no-store");
  assert.equal((first.headers.get("cache-control") || "").includes("public"), false);
  assert.equal(stored.size, 1);
  assert.equal([...stored.keys()][0]?.includes(token), false);
  assert.equal([...stored.keys()][0]?.includes("/weddings/aisha-rohan/"), true);
  const callsAfterMiss = bucket.calls.length;
  const second = await handleMediaGateway(ask(`/v1/${KEY}`, token), binding);
  assert.equal(second.headers.get("x-wc-cache"), "HIT");
  assert.equal(await second.text(), "photo-bytes");
  assert.equal(second.headers.get("cache-control"), "private, no-store");
  assert.equal(second.headers.get("cdn-cache-control"), "no-store");
  assert.equal(bucket.calls.length, callsAfterMiss);
  const head = await handleMediaGateway(ask(`/v1/${KEY}`, token, { method: "HEAD" }), binding);
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("x-wc-cache"), "HIT");
  assert.equal(await head.text(), "");
  assert.equal(bucket.calls.length, callsAfterMiss);
  const matchesAfterAuth = matches;
  const bad = await handleMediaGateway(ask(`/v1/${KEY}`, "v1.not.a-real-signature"), binding);
  assert.equal(bad.status, 403);
  assert.equal((await bad.json()).code, "signature");
  assert.equal(matches, matchesAfterAuth);
  const expired = await handleMediaGateway(ask(`/v1/${KEY}`, await tokenFor(KEY, SECRET, 10)), binding);
  assert.equal(expired.status, 403);
  assert.equal((await expired.json()).code, "expired");
  const moved = await handleMediaGateway(ask(`/v1/${OTHER}`, token), binding);
  assert.equal(moved.status, 403);
  assert.equal((await moved.json()).code, "path");
  assert.equal(bucket.calls.some((call) => call.includes(OTHER)), false);
  const missingKey = "weddings/aisha-rohan/album/missing-photo.jpg";
  const missing = await handleMediaGateway(ask(`/v1/${missingKey}`, await tokenFor(missingKey)), binding);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-wc-cache"), "BYPASS");
  const missingAgain = await handleMediaGateway(ask(`/v1/${missingKey}`, await tokenFor(missingKey)), binding);
  assert.equal(missingAgain.status, 404);
  assert.equal(missingAgain.headers.get("x-wc-cache"), "BYPASS");
  assert.equal([...stored.keys()].some((url) => url.includes("missing-photo")), false);
  const other = await handleMediaGateway(ask(`/v1/${OTHER}`, await tokenFor(OTHER)), binding);
  assert.equal(await other.text(), "other-wedding");
  assert.equal(other.headers.get("x-wc-cache"), "MISS");
  assert.equal(stored.size, 2);
  const again = await handleMediaGateway(ask(`/v1/${KEY}`, token), binding);
  assert.equal(await again.text(), "photo-bytes");
  assert.equal(again.headers.get("x-wc-cache"), "HIT");
  const videoToken = await tokenFor(VIDEO);
  const video = await handleMediaGateway(ask(`/v1/${VIDEO}`, videoToken), binding);
  assert.equal(video.headers.get("x-wc-cache"), "BYPASS");
  assert.equal(video.headers.get("cache-control"), "private, no-store");
  assert.equal(stored.size, 2);
  const bare = authorizedCacheRequest(new URL(`${ORIGIN}/v1/${KEY}?t=${encodeURIComponent(token)}`));
  assert.equal(bare.url.includes("t="), false);
  const failing = {
    async match() { return undefined; },
    async put() { throw new Error("cache refused"); },
  };
  const refused = await handleMediaGateway(ask(`/v1/${KEY}`, token), { ...bucket, edgeCache: failing, cachePolicy: "authorized" as const });
  assert.equal(refused.status, 200);
  assert.equal(await refused.text(), "photo-bytes");
  assert.equal(refused.headers.get("x-wc-cache"), "BYPASS");
  assert.equal(refused.headers.get("cache-control"), "private, no-store");
});
