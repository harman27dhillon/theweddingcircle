import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cacheStatusToken, cleanCdnInput, combineCdnStatus, deliveryUrl, describeCdnCache, judgeCdnProbe, judgeZoneCheck, type CdnCacheLook } from "./cdn.ts";

test("a public R2 domain is refused and HTTP 200 is not a passing CDN test", () => {
  const pub = cleanCdnInput({ enabled: true, domain: "wedding-circle-media.r2.dev", base: "https://wedding-circle-media.r2.dev", cache: "private" });
  assert.equal(pub.ok, false);
  const home = judgeCdnProbe({ enabled: true, domain: "media.example.com", dnsOk: true, anonymousStatus: 200, authedStatus: null, authedPrivate: false });
  assert.equal(home.usable, false);
  assert.match(home.detail, /HTTP 200/);
  assert.match(home.requirement, /not made public|not turn the R2 bucket public|Do not turn the R2 bucket public/);
  const off = judgeCdnProbe({ enabled: false, domain: "media.example.com", dnsOk: true, anonymousStatus: 200, authedStatus: 204, authedPrivate: true });
  assert.equal(off.usable, false);
  assert.equal(off.state, "disabled");
});

test("CDN delivery is used only after a private probe and falls back otherwise", () => {
  const ready = judgeCdnProbe({ enabled: true, domain: "media.example.com", dnsOk: true, anonymousStatus: 401, authedStatus: 204, authedPrivate: true });
  assert.equal(ready.usable, true);
  assert.equal(ready.detail.includes("r2.cloudflarestorage.com"), false);
  const signed = "https://example.r2.cloudflarestorage.com/wedding-circle-media/weddings/a/album/aa.jpg?X-Amz-Signature=abc";
  assert.equal(deliveryUrl(signed, { usable: false, base: "https://media.example.com", path: "/api/infra/view?t=1" }), signed);
  const next = deliveryUrl(signed, { usable: true, base: "https://media.example.com", path: "/api/infra/view?t=1" });
  assert.equal(next, "https://media.example.com/api/infra/view?t=1");
  assert.equal(next.includes("X-Amz-Signature"), false);
  const kept = cleanCdnInput({ enabled: true, domain: "https://Media.Example.com/extra", base: "https://media.example.com", cache: "no-store" });
  assert.equal(kept.ok, true);
  if (kept.ok) assert.equal(kept.cache, "no-store");
  const authorized = cleanCdnInput({ enabled: false, domain: "media.theweddingcircle.in", base: "https://media.theweddingcircle.in", cache: "authorized" });
  assert.equal(authorized.ok, true);
  if (authorized.ok) {
    assert.equal(authorized.enabled, false);
    assert.equal(authorized.cache, "authorized");
  }
  const dns = judgeCdnProbe({ enabled: true, domain: "media.example.com", dnsOk: false, anonymousStatus: null, authedStatus: null, authedPrivate: false });
  assert.equal(dns.state, "incomplete");
  assert.equal(dns.usable, false);
  const zone = judgeZoneCheck({ status: 401, success: false, zoneName: "", domain: "media.example.com", note: "Invalid API Token" });
  assert.equal(zone.ok, false);
  assert.equal(zone.kind, "invalid_credentials");
  const blocked = combineCdnStatus(
    { usable: true, state: "verified", detail: "Private CDN delivery is on for this domain.", requirement: "" },
    { checked: true, ok: false, kind: "invalid_credentials", detail: zone.detail },
  );
  assert.equal(blocked.usable, false);
  assert.equal(blocked.state, "error");
  const invalid = judgeZoneCheck({ status: 403, success: false, zoneName: "", domain: "media.example.com", note: "Invalid access token (9109)", code: 9109, listed: true });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.kind, "invalid_credentials");
  assert.match(invalid.detail, /rejected the API token/);
  assert.equal(/zone read is required/i.test(invalid.detail), false);
  const denied = judgeZoneCheck({ status: 403, success: false, zoneName: "", domain: "media.example.com", note: "Authentication error (10000)", code: 10000, listed: true });
  assert.equal(denied.kind, "insufficient_permissions");
  assert.match(denied.detail, /zone id/i);
  const unmanaged = judgeZoneCheck({ status: 200, success: true, zoneName: "", domain: "media.example.com", note: "", emptyList: true });
  assert.equal(unmanaged.kind, "zone_not_managed");
  assert.match(unmanaged.detail, /not required/);
  const unmanagedKept = combineCdnStatus(
    { usable: true, state: "verified", detail: "Private CDN delivery is on for this domain.", requirement: "" },
    { checked: true, ok: false, kind: "zone_not_managed", detail: unmanaged.detail },
  );
  assert.equal(unmanagedKept.usable, true);
  assert.equal(unmanagedKept.state, "verified");
  const offline = judgeZoneCheck({ status: null, success: false, zoneName: "", domain: "media.example.com", note: "" });
  assert.equal(offline.kind, "network");
  const missing = judgeCdnProbe({ enabled: true, domain: "", dnsOk: false, anonymousStatus: null, authedStatus: null, authedPrivate: false });
  assert.equal(missing.state, "not_configured");
  assert.equal(deliveryUrl("https://example.r2.cloudflarestorage.com/bucket/a", { usable: true, base: "https://media.example.com", path: "/api/infra/view?t=1" }).includes("r2.dev"), false);
  const refused = combineCdnStatus(
    { usable: false, state: "disabled", detail: "CDN delivery is off. Photos and videos still use the existing private storage path.", requirement: "" },
    { checked: true, ok: false, kind: "invalid_credentials", detail: "Cloudflare rejected the API token. DNS was not changed." },
  );
  assert.equal(refused.state, "error");
  assert.equal(refused.usable, false);
  assert.match(refused.detail, /CDN delivery is off/);
  assert.match(refused.detail, /rejected the API token/);
  assert.match(refused.requirement, /not turned on/i);
  const code1000 = judgeZoneCheck({ status: 403, success: false, zoneName: "", domain: "media.example.com", note: "Invalid API Token", code: 1000 });
  assert.equal(code1000.kind, "invalid_credentials");
  const api = judgeZoneCheck({ status: 500, success: false, zoneName: "", domain: "media.example.com", note: "Server error", code: 7003 });
  assert.equal(api.kind, "api");
  assert.match(api.detail, /HTTP 500/);
  const mismatch = judgeZoneCheck({ status: 200, success: true, zoneName: "other.example", domain: "media.example.com", note: "" });
  assert.equal(mismatch.kind, "zone_mismatch");
  const source = readFileSync(new URL("./infra.server.ts", import.meta.url), "utf8");
  const cdnTest = source.slice(source.indexOf("export async function infraCdnTest"), source.indexOf("async function lookupHost"));
  assert.equal(cdnTest.includes("CDN_ENABLED"), false);
  assert.equal(cdnTest.includes("nslookup"), false);
  assert.equal(cdnTest.includes("describeCdnCache"), true);
  assert.equal(cdnTest.includes("GATEWAY_PROBE_KEY"), true);
  const baseFn = source.slice(source.indexOf("async function usableCdnBase"), source.indexOf("async function streamTicket"));
  assert.equal(baseFn.includes('=== "authorized"'), true);
});

const look = (status: number | null, cacheControl = "", cf = "", worker = ""): CdnCacheLook => ({ status, cacheControl, cf, worker });

test("anonymous 403 is expected and does not prove a cache hit", () => {
  const report = describeCdnCache({
    policy: "authorized",
    anonymous: look(403, "private, no-store"),
    signedFirst: null,
    signedSecond: null,
    signedPrepared: false,
    secretPresent: false,
  });
  assert.equal(report.hitVerified, false);
  assert.match(report.summary, /expected/);
  assert.match(report.summary, /not proof that CDN delivery is broken/);
  assert.match(report.summary, /secret is not on this server/);
  assert.match(report.summary, /CDN delivery was not turned on/);
  assert.match(report.summary, /not made public/);
  assert.equal(cacheStatusToken(" hit "), "HIT");
  assert.equal(cacheStatusToken("nope"), "");
});

test("a signed 404 cannot become a cache HIT and a secret mismatch is not a cache result", () => {
  const missing = describeCdnCache({
    policy: "authorized",
    anonymous: look(403, "private, no-store"),
    signedFirst: look(404, "private, no-store"),
    signedSecond: look(404, "private, no-store"),
    signedPrepared: true,
    secretPresent: true,
  });
  assert.equal(missing.hitVerified, false);
  assert.match(missing.summary, /HTTP 404/);
  assert.match(missing.summary, /not cached/);
  assert.match(missing.summary, /real wedding file was not used/);
  const mismatch = describeCdnCache({
    policy: "private",
    anonymous: look(403, "private, no-store"),
    signedFirst: look(403, "private, no-store"),
    signedSecond: look(403, "private, no-store"),
    signedPrepared: true,
    secretPresent: true,
  });
  assert.equal(mismatch.hitVerified, false);
  assert.match(mismatch.summary, /different media gateway secret/);
  assert.match(mismatch.summary, /MISS and HIT were not tested/);
});

test("a MISS then HIT is reported without turning CDN delivery on", () => {
  const hit = describeCdnCache({
    policy: "authorized",
    anonymous: look(403, "private, no-store"),
    signedFirst: look(200, "private, max-age=60", "", "MISS"),
    signedSecond: look(200, "private, max-age=60", "", "HIT"),
    signedPrepared: true,
    secretPresent: true,
  });
  assert.equal(hit.hitVerified, true);
  assert.match(hit.summary, /MISS then HIT/);
  assert.match(hit.summary, /x-wc-cache/);
  assert.match(hit.summary, /CDN delivery was not turned on/);
  assert.match(hit.summary, /not made public/);
  const quiet = describeCdnCache({
    policy: "authorized",
    anonymous: look(403, "private, no-store"),
    signedFirst: look(200, "private, max-age=60"),
    signedSecond: look(200, "private, max-age=60"),
    signedPrepared: true,
    secretPresent: true,
  });
  assert.equal(quiet.hitVerified, false);
  assert.match(quiet.summary, /not observed/);
  assert.match(quiet.summary, /MEDIA_EDGE_CACHE/);
  assert.match(quiet.summary, /was not changed/);
});
