import { cleanFirebaseInput, firebaseWebKeyChoice } from "@/lib/developer/cloud";
import { firebaseRuntimeFromEnv } from "@/lib/infra/config";
import { resolvedInfraEnv } from "@/lib/infra/resolved-env.server";

/**
 * One Firebase web config for the browser SDK and Identity Toolkit.
 * FIREBASE_API_KEY is the only key that is used. A different Vite key is not a substitute.
 * The service-account JSON stays on the server and is not part of the public result.
 */
export async function readFirebaseWebConfig() {
  const resolved = await resolvedInfraEnv();
  const runtime = firebaseRuntimeFromEnv(resolved.env);
  const choice = firebaseWebKeyChoice(runtime.apiKey, resolved.env.VITE_FIREBASE_API_KEY || "");
  const candidate = {
    apiKey: choice.key,
    authDomain: runtime.authDomain,
    projectId: runtime.projectId,
    storageBucket: runtime.storageBucket,
    messagingSenderId: runtime.messagingSenderId,
    appId: runtime.appId,
    measurementId: (resolved.env.FIREBASE_MEASUREMENT_ID || "").trim(),
  };
  const clean = candidate.apiKey ? cleanFirebaseInput(candidate) : null;
  return {
    raw: clean?.ok ? clean.fields : {},
    note: choice.note,
    incomplete: Boolean(candidate.apiKey) && !clean?.ok,
    present: Boolean(candidate.apiKey || candidate.projectId || candidate.authDomain || candidate.appId || candidate.messagingSenderId),
    serviceAccountJson: runtime.serviceAccountJson,
  };
}

/** Public web fields only. Never the service account, the Vite key, or a private key. */
export async function publicFirebaseAuthConfig() {
  const config = await readFirebaseWebConfig();
  const raw = config.raw;
  if (!raw.apiKey || !raw.authDomain || !raw.projectId || !raw.appId || !raw.messagingSenderId) {
    return { ok: false as const, reason: "Firebase sign-in is not configured." };
  }
  return {
    ok: true as const,
    apiKey: raw.apiKey,
    authDomain: raw.authDomain,
    projectId: raw.projectId,
    appId: raw.appId,
    messagingSenderId: raw.messagingSenderId,
  };
}
