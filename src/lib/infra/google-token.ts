import { parseServiceAccount } from "../developer/cloud.ts";
import { serviceAccountJwt } from "./google-jwt.ts";

const endpoint = "https://oauth2.googleapis.com/token";
const oauthErrors = new Set(["invalid_grant", "invalid_client", "invalid_scope", "unauthorized_client", "deleted_client", "invalid_request"]);

type TokenResult = { ok: true; token: string } | { ok: false; error: string };

export function googleRequestFailure(error: unknown) {
  const failure = error as { name?: unknown; cause?: { code?: unknown } } | null;
  if (failure?.name === "TimeoutError" || failure?.name === "AbortError") return "the request timed out";
  const code = failure?.cause?.code;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "DNS lookup failed";
  if (typeof code === "string" && /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_VERIFY_)/.test(code)) return "the TLS connection failed";
  return "the connection failed before Google responded";
}

export async function googleToken(raw: string, scope: string, { retry = false }: { retry?: boolean } = {}): Promise<TokenResult> {
  const account = parseServiceAccount(raw);
  if (!account.ok) return { ok: false, error: "The Google service account JSON is missing or unreadable." };

  let assertion: string;
  try {
    assertion = serviceAccountJwt(account, scope, Date.now());
  } catch {
    return { ok: false, error: "The Google service account private key could not sign the request." };
  }

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }).toString();
  for (let attempt = 0; ; attempt++) {
    const canRetry = retry && attempt === 0;
    const signal = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST", redirect: "manual", signal,
        headers: { "content-type": "application/x-www-form-urlencoded" }, body,
      });
    } catch (error) {
      if (canRetry) continue;
      return { ok: false, error: `Google OAuth could not be reached because ${googleRequestFailure(signal.aborted ? signal.reason : error)}.` };
    }

    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, error: `Google OAuth redirected the token request (HTTP ${response.status}).` };
    }
    if (canRetry && (response.status === 408 || response.status >= 500)) {
      await response.body?.cancel().catch(() => undefined);
      continue;
    }
    const result = await response.json().catch(() => null) as { error?: unknown; access_token?: unknown } | null;
    if (signal.aborted) {
      if (canRetry) continue;
      return { ok: false, error: "Google OAuth responded, but reading the token response timed out." };
    }
    if (!response.ok) {
      const code = typeof result?.error === "string" && oauthErrors.has(result.error) ? `, ${result.error}` : "";
      return { ok: false, error: `Google OAuth refused the token request (HTTP ${response.status}${code}).` };
    }
    if (typeof result?.access_token !== "string" || !result.access_token) {
      return { ok: false, error: "Google OAuth responded without an access token." };
    }
    return { ok: true, token: result.access_token };
  }
}
