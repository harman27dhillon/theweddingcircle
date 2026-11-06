import type { Diagnostic } from "./model";

// Supabase restricts OpenAPI metadata at /rest/v1/ to privileged keys. A
// reserved resource lets PostgREST answer without exposing application data.
const probePath = "/rest/v1/wc_api_probe_reserved_missing?select=*&limit=0";

export async function probeSupabaseDataApi(project: string, key: string): Promise<Diagnostic> {
  const headers = new Headers({ apikey: key, accept: "application/json" });
  if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);

  const signal = AbortSignal.timeout(15_000);
  try {
    const response = await fetch(project + probePath, { headers, redirect: "manual", signal });
    const status = response.status;
    if (status >= 300 && status < 400) {
      await response.body?.cancel().catch(() => undefined);
      return { ok: false, message: `Supabase redirected the Data API request (HTTP ${status}). Check the project URL.` };
    }

    const payload: unknown = await response.json().catch(() => null);
    if (signal.aborted) return { ok: false, message: "The Supabase Data API response timed out." };
    const rawCode = payload && typeof payload === "object" && "code" in payload ? payload.code : null;
    const code = typeof rawCode === "string" && /^(PGRST[0-9]{3}|42501|UNAUTHORIZED_(INVALID|MISSING)_API_KEY)$/.test(rawCode) ? rawCode : "";
    const result = code ? `HTTP ${status}, ${code}` : `HTTP ${status}`;

    if ((status === 404 && code === "PGRST205") || (status === 200 && Array.isArray(payload) && payload.length === 0)) {
      return { ok: true, message: "Supabase accepted the Worker API key and reached the Data API. No records were read.", checkedAt: new Date().toISOString() };
    }
    if (code === "PGRST302" || code === "42501") {
      return { ok: false, message: `Supabase reached PostgREST, but anonymous Data API access is restricted (${result}).` };
    }
    if (status === 401 || status === 403) {
      return { ok: false, message: `Supabase denied the Data API probe (${result}). Check the project's API gateway and Data API access settings.` };
    }
    return { ok: false, message: `Supabase returned an unexpected Data API response (${result}).` };
  } catch {
    return { ok: false, message: signal.aborted
      ? "The Supabase Data API did not respond within 15 seconds."
      : "The Worker could not connect to the Supabase Data API over HTTPS." };
  }
}
