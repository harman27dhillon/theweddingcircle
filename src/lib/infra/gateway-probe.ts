import { judgeGatewayProbe } from "./media-gateway.ts";
import { GATEWAY_PROBE_KEY, gatewaySecretOk, mediaGatewayUrl, normalizeGatewayOrigin, signMediaToken } from "./media-token.ts";

/** Bounded, read-only check of the Worker protocol; never uploads wedding media. */
export async function probeMediaGateway(input: { enabled: boolean; origin: string; secret: string }, request: typeof fetch = fetch) {
  const empty = { anonymousStatus: null, anonymousCache: "", anonymousLocation: "", badStatus: null, signedStatus: null, signedCache: "", signedLocation: "", signedType: "" };
  const origin = normalizeGatewayOrigin(input.origin);
  if (!input.enabled || !origin) return judgeGatewayProbe({ ...empty, enabled: input.enabled, origin });
  if (!gatewaySecretOk(input.secret)) return { usable: false, state: "incomplete" as const, detail: "The app has no usable gateway signing secret.", requirement: "Set the same MEDIA_GATEWAY_SECRET on the app and Worker, then save and test again." };
  const signedToken = await signMediaToken({ slug: "gateway-probe", key: GATEWAY_PROBE_KEY, methods: ["GET", "HEAD"], exp: Math.floor(Date.now() / 1000) + 60, disp: "inline", name: "probe.jpg" }, input.secret);
  const signedUrl = mediaGatewayUrl(origin, GATEWAY_PROBE_KEY, signedToken);
  const target = signedUrl.split("?")[0];
  async function read(url: string) {
    try {
      const response = await request(url, { redirect: "manual", signal: AbortSignal.timeout(8000) });
      const result = { status: response.status, cache: response.headers.get("cache-control") || "", location: response.headers.get("location") || "", type: response.headers.get("content-type") || "" };
      await response.body?.cancel();
      return result;
    } catch { return { status: null, cache: "", location: "", type: "" }; }
  }
  const [anonymous, bad, signed] = await Promise.all([read(target), read(`${target}?t=v1.bad.signature`), read(signedUrl)]);
  return judgeGatewayProbe({ enabled: true, origin, anonymousStatus: anonymous.status, anonymousCache: anonymous.cache, anonymousLocation: anonymous.location, badStatus: bad.status, signedStatus: signed.status, signedCache: signed.cache, signedLocation: signed.location, signedType: signed.type });
}
