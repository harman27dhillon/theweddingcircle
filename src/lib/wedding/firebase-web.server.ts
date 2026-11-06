import { serverEnvironment } from "@/lib/env.server";
import { cleanFirebaseInput, firebaseWebKeyChoice } from "@/lib/developer/cloud";
import { firebaseRuntimeFromEnv } from "@/lib/infra/config";
import { resolvedInfraEnv } from "@/lib/infra/resolved-env.server";

/**
 * One Firebase web config for the browser SDK and Identity Toolkit.
 * FIREBASE_API_KEY is the only key that is used. A different Vite key is not a substitute.
 * The service-account JSON stays on the server and is not part of the public result.
 */
export async function readFirebaseWebConfig() {
  return firebaseWebConfigFromEnv((await resolvedInfraEnv()).env);
}

function firebaseWebConfigFromEnv(environment: Record<string, string | undefined>) {
  const runtime = firebaseRuntimeFromEnv(environment);
  const choice = firebaseWebKeyChoice(runtime.apiKey, environment.VITE_FIREBASE_API_KEY || "");
  const candidate = {
    apiKey: choice.key,
    authDomain: runtime.authDomain,
    projectId: runtime.projectId,
    storageBucket: runtime.storageBucket,
    messagingSenderId: runtime.messagingSenderId,
    appId: runtime.appId,
    measurementId: (environment.FIREBASE_MEASUREMENT_ID || "").trim(),
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

function publicFields(raw: ReturnType<typeof firebaseWebConfigFromEnv>["raw"]) {
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

/** Returns the browser configuration without querying the vault when runtime settings are complete. */
export async function publicFirebaseAuthConfig() {
  const direct = publicFields(firebaseWebConfigFromEnv(await serverEnvironment()).raw);
  return direct.ok ? direct : publicFields((await readFirebaseWebConfig()).raw);
}
