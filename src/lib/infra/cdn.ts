import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type CdnCache = "private" | "no-store" | "authorized";

export type CdnCacheLook = {
  status: number | null;
  cacheControl: string;
  cf: string;
  worker: string;
};

const HOST = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function fail(error: string) {
  return { ok: false as const, error };
}

function hostOnly(value: string) {
  let text = value.trim().toLowerCase();
  text = text.replace(/^https?:\/\//, "");
  text = text.split(/[/?#]/)[0]?.replace(/\.$/, "") || "";
  return text;
}

function publicR2Host(host: string) {
  return host === "r2.dev" || host.endsWith(".r2.dev") || host.includes("cloudflarestorage.com");
}

function httpsBase(value: string) {
  const text = value.trim().replace(/\/+$/, "");
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) return "";
    return `https://${url.hostname.toLowerCase()}`;
  } catch {
    return "";
  }
}

function bareToken(value: string) {
  return value.trim().replace(/^["']+|["']+$/g, "").replace(/^Bearer\s+/i, "").replace(/^["']+|["']+$/g, "").trim();
}

/** Normalizes a CDN form. Public R2 hosts are refused. Enabling delivery is a separate saved switch. */
export function cleanCdnInput(input: { enabled: boolean; domain: string; base: string; cache: string; token?: string; zoneId?: string }) {
  const cache: CdnCache = input.cache === "no-store" || input.cache === "authorized" ? input.cache : "private";
  const domain = hostOnly(input.domain || "");
  const base = httpsBase(input.base || "");
  const token = bareToken(input.token || "");
  const zoneId = (input.zoneId || "").trim().toLowerCase();
  if (token && (token.length < 20 || token.length > 400 || /\s/.test(token) || token.includes("BEGIN "))) {
    return fail("The Cloudflare API token was refused. Nothing was saved.");
  }
  if (zoneId && !/^[a-f0-9]{32}$/.test(zoneId)) return fail("The zone id must be 32 hexadecimal characters, or left empty. Nothing was saved.");
  if (publicR2Host(domain) || publicR2Host(base.replace(/^https:\/\//, ""))) {
    return fail("A public R2 domain was refused. Do not turn the R2 bucket public. Nothing was saved.");
  }
  if (!domain && !base) {
    if (input.enabled) return fail("A media domain is required before CDN delivery can be saved as enabled. Nothing was saved.");
    return { ok: true as const, enabled: false, domain: "", base: "", cache, token, zoneId };
  }
  if (!domain || !HOST.test(domain)) return fail("The media domain must be a host name, without a path. Nothing was saved.");
  if (base !== `https://${domain}`) return fail("The CDN base URL must be https:// and the same host as the media domain. Nothing was saved.");
  return { ok: true as const, enabled: input.enabled === true, domain, base, cache, token, zoneId };
}

/** Fingerprint of the saved CDN settings. The API token is hashed, not stored in the mark. */
export function cdnMark(input: { enabled: boolean; domain: string; base: string; cache: string; zoneId?: string; token?: string }) {
  const digest = createHash("sha256")
    .update(`wc-cdn|${input.enabled ? "yes" : "no"}|${input.domain}|${input.base}|${input.cache}|${input.zoneId || ""}|${input.token || ""}`)
    .digest("hex")
    .slice(0, 24);
  return `${input.enabled ? "yes" : "no"}|${input.domain}|${input.cache}|${digest}`;
}

export function cdnProbeToken(secret: string) {
  return createHmac("sha256", secret).update("wc-cdn-probe").digest("hex");
}

export function cdnProbeMatches(secret: string, token: string) {
  const expected = cdnProbeToken(secret);
  const given = token.trim();
  if (!given || given.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(given));
}

export function judgeCdnProbe(input: {
  enabled: boolean;
  domain: string;
  dnsOk: boolean;
  anonymousStatus: number | null;
  authedStatus: number | null;
  authedPrivate: boolean;
  probeSigned?: boolean;
}) {
  if (!input.enabled) {
    return {
      usable: false,
      state: "disabled" as const,
      detail: "CDN delivery is off. Photos and videos still use the existing private storage path.",
      requirement: "",
    };
  }
  if (!input.domain) {
    return {
      usable: false,
      state: "not_configured" as const,
      detail: "A media domain is not saved. Cloudflare was not called, and delivery was not turned on.",
      requirement: "Enter the host name, such as media.theweddingcircle.in. A zone id is not required unless the token can read one zone but cannot list zones.",
    };
  }
  if (!input.dnsOk) {
    return {
      usable: false,
      state: "incomplete" as const,
      detail: "The media host did not resolve. CDN delivery was not turned on.",
      requirement: "DNS was not changed, and the R2 bucket was not made public.",
    };
  }
  if (input.anonymousStatus === 200) {
    return {
      usable: false,
      state: "error" as const,
      detail: "The CDN probe returned HTTP 200 without a signature. A public response is not accepted.",
      requirement: "Do not turn the R2 bucket public. CDN delivery was not turned on.",
    };
  }
  const refused = input.anonymousStatus === 401 || input.anonymousStatus === 403;
  if (refused && input.authedStatus === 204 && input.authedPrivate) {
    return {
      usable: true,
      state: "verified" as const,
      detail: "Private CDN delivery is on for this domain.",
      requirement: "",
    };
  }
  if (refused && input.probeSigned === false) {
    return {
      usable: false,
      state: "incomplete" as const,
      detail: "The private probe was refused. This server could not sign the follow-up probe. CDN delivery was not turned on.",
      requirement: "The R2 bucket was not made public.",
    };
  }
  return {
    usable: false,
    state: "error" as const,
    detail: `The private CDN probe did not pass (anonymous HTTP ${input.anonymousStatus ?? "none"}, signed HTTP ${input.authedStatus ?? "none"}).`,
    requirement: "Do not turn the R2 bucket public. CDN delivery was not turned on.",
  };
}

export function judgeZoneCheck(input: {
  status: number | null;
  success: boolean;
  zoneName: string;
  domain: string;
  note: string;
  code?: number;
  emptyList?: boolean;
  listed?: boolean;
}) {
  const code = input.code || 0;
  const note = input.note || "";
  if (input.status == null) {
    return { ok: false as const, kind: "network" as const, detail: "Cloudflare could not be reached for the zone check. DNS was not changed." };
  }
  const invalidToken = input.status === 401 || code === 1000 || code === 9109 || code === 9106 || /invalid api token|invalid access token/i.test(note);
  if (invalidToken) {
    return { ok: false as const, kind: "invalid_credentials" as const, detail: "Cloudflare rejected the API token. DNS was not changed." };
  }
  if (input.status === 403 || code === 10000) {
    return {
      ok: false as const,
      kind: "insufficient_permissions" as const,
      detail: "The API token cannot read this zone. Add a zone id when the token can read one zone but cannot list zones. DNS was not changed.",
    };
  }
  if (input.status >= 400 || input.success === false) {
    return { ok: false as const, kind: "api" as const, detail: `Cloudflare zone check returned HTTP ${input.status}. DNS was not changed.` };
  }
  const zoneName = input.zoneName.trim().toLowerCase();
  if (input.emptyList || !zoneName) {
    return {
      ok: false as const,
      kind: "zone_not_managed" as const,
      detail: "The API token is saved, but Cloudflare did not show a zone for this domain. A zone id is not required for that result. DNS was not changed.",
    };
  }
  const domain = input.domain.trim().toLowerCase();
  if (domain === zoneName || domain.endsWith(`.${zoneName}`)) {
    return { ok: true as const, kind: "matched" as const, detail: "Cloudflare confirmed this domain is in the zone. DNS was not changed." };
  }
  return {
    ok: false as const,
    kind: "zone_mismatch" as const,
    detail: `Cloudflare returned zone ${zoneName}, which does not match ${domain}. DNS was not changed.`,
  };
}

export function combineCdnStatus(
  probe: { usable: boolean; state: string; detail: string; requirement: string },
  zone: { checked: boolean; ok: boolean; kind: string; detail: string } | null,
) {
  if (!zone || !zone.checked) return probe;
  const extra = zone.detail ? `${probe.detail} ${zone.detail}`.replace(/\s+/g, " ").trim() : probe.detail;
  if (zone.ok || zone.kind === "zone_not_managed") return { ...probe, detail: extra };
  return {
    usable: false,
    state: "error" as const,
    detail: extra,
    requirement: /not turned on/i.test(probe.requirement) ? probe.requirement : "CDN delivery was not turned on. DNS was not changed.",
  };
}

/** Uses the private CDN base only after a verified probe. Otherwise the signed storage URL is kept. */
export function deliveryUrl(signed: string, cdn: { usable: boolean; base: string; path: string }) {
  if (!cdn.usable) return signed;
  const base = cdn.base.trim().replace(/\/+$/, "");
  const path = cdn.path.startsWith("/") ? cdn.path : `/${cdn.path}`;
  const next = `${base}${path}`;
  if (!base.startsWith("https://") || next.includes("r2.dev") || next.includes("cloudflarestorage.com")) return signed;
  return next;
}

const CACHE_TOKEN = /^(HIT|MISS|EXPIRED|BYPASS|DYNAMIC|REVALIDATED|UPDATING)$/;

/** Keeps only a cache status token. Anything else is treated as not reported. */
export function cacheStatusToken(value: string) {
  const token = value.trim().toUpperCase();
  return CACHE_TOKEN.test(token) ? token : "";
}

/**
 * Explains an anonymous refusal and two signed reads.
 * A private 403 is expected. It does not turn CDN delivery on, and it is not a cache HIT.
 */
export function describeCdnCache(input: {
  policy: CdnCache;
  anonymous: CdnCacheLook;
  signedFirst: CdnCacheLook | null;
  signedSecond: CdnCacheLook | null;
  signedPrepared: boolean;
  secretPresent: boolean;
}) {
  const parts: string[] = [];
  const anonymousCache = input.anonymous.cacheControl.toLowerCase();
  const anonymousPrivate = anonymousCache.includes("private") || anonymousCache.includes("no-store");
  if (input.anonymous.status === 401 || input.anonymous.status === 403) {
    parts.push(`Anonymous media request returned HTTP ${input.anonymous.status}${anonymousPrivate ? " with a private response" : ""}. That refusal is expected and is not proof that CDN delivery is broken.`);
  } else if (input.anonymous.status === 200) {
    parts.push("Anonymous media request returned HTTP 200. A file was returned without a signature, so delivery is not safe.");
  } else if (input.anonymous.status == null) {
    parts.push("The media host did not answer the anonymous request.");
  } else {
    parts.push(`Anonymous media request returned HTTP ${input.anonymous.status}.`);
  }
  const anonEdge = cacheStatusToken(input.anonymous.cf);
  const anonWorker = cacheStatusToken(input.anonymous.worker);
  parts.push(anonEdge || anonWorker
    ? `Anonymous edge cache: ${anonEdge || "not reported"}. Worker cache: ${anonWorker || "not reported"}.`
    : "Anonymous edge cache was not reported. A private refusal is not stored.");

  if (!input.secretPresent) {
    parts.push("A signed cache check was not sent because the media gateway secret is not on this server. The value was not shown.");
  } else if (!input.signedPrepared || !input.signedFirst || !input.signedSecond) {
    parts.push("A signed cache check could not be prepared. The secret was not shown.");
  } else {
    const first = input.signedFirst;
    const second = input.signedSecond;
    const worker = cacheStatusToken(second.worker);
    const firstWorker = cacheStatusToken(first.worker);
    const edge = cacheStatusToken(second.cf);
    const firstEdge = cacheStatusToken(first.cf);
    if (first.status === 401 || first.status === 403) {
      parts.push(`The signed probe was rejected (HTTP ${first.status}) before a file was opened. Cache MISS and HIT were not tested. The usual cause is a different media gateway secret. The secret was not shown.`);
    } else if (first.status === 404) {
      parts.push("The signed probe was accepted and the probe object is missing (HTTP 404). Missing objects are not cached, so a cache HIT cannot be produced from this probe. A real wedding file was not used.");
    } else if (first.status === 200 && second.status === 200 && (firstWorker === "MISS" || firstEdge === "MISS") && (worker === "HIT" || edge === "HIT")) {
      const where = worker === "HIT" ? "x-wc-cache" : "cf-cache-status";
      parts.push(`Authorized cache MISS then HIT was observed on ${where}. The client response stayed private.`);
    } else if (first.status === 200 || second.status === 200) {
      parts.push(`Signed media returned HTTP ${second.status ?? first.status}. Worker cache: ${worker || firstWorker || "not reported"}. Edge cache: ${edge || firstEdge || "not reported"}. A MISS followed by a HIT was not observed.`);
    } else if (first.status == null) {
      parts.push("The signed cache check did not reach the media host.");
    } else {
      parts.push(`The signed probe returned HTTP ${first.status}. A cache HIT was not observed.`);
    }
    if (!worker && !firstWorker && first.status !== 401 && first.status !== 403) {
      parts.push("The Worker did not send x-wc-cache. It stores an authorized image only when MEDIA_EDGE_CACHE is authorized. That Worker setting was not changed.");
    }
  }
  if (input.policy === "no-store") parts.push("The saved cache policy is no-store, so responses are not eligible for an edge cache.");
  else if (input.policy === "private") parts.push("The saved cache policy is private. The browser may store a response. Cloudflare's edge is not asked to keep it.");
  else parts.push("The saved cache policy is authorized edge cache after the signature check. Unauthorized requests stay private and are not cached.");
  parts.push("CDN delivery was not turned on. The R2 bucket was not made public.");
  return {
    summary: parts.join(" ").replace(/\s+/g, " ").trim(),
    hitVerified: input.signedFirst?.status === 200
      && input.signedSecond?.status === 200
      && (cacheStatusToken(input.signedFirst.worker) === "MISS" || cacheStatusToken(input.signedFirst.cf) === "MISS")
      && (cacheStatusToken(input.signedSecond.worker) === "HIT" || cacheStatusToken(input.signedSecond.cf) === "HIT"),
  };
}
