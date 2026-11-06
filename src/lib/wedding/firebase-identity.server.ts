import { requireVerifiedEmail, verifyFirebaseIdentity } from "@/lib/wedding/firebase-identity";
import { membershipFromIdentity } from "@/lib/wedding/membership";
import { firebaseRuntimeFromEnv } from "@/lib/infra/config";
import { resolvedInfraEnv } from "@/lib/infra/resolved-env.server";

const CERTS = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

let cached: { at: number; certs: Record<string, string> } | null = null;

async function firebaseCerts() {
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.certs;
  const response = await fetch(CERTS);
  if (!response.ok) return null;
  const body = await response.json() as Record<string, unknown>;
  const certs: Record<string, string> = {};
  for (const [kid, value] of Object.entries(body)) {
    if (typeof value === "string" && value.includes("BEGIN CERTIFICATE")) certs[kid] = value;
  }
  if (!Object.keys(certs).length) return null;
  cached = { at: Date.now(), certs };
  return certs;
}

/** Verifies the Firebase ID token. It does not grant a wedding role and does not require a verified email. */
export async function readFirebaseIdentity(idToken: string, project?: string) {
  const projectId = project ?? firebaseRuntimeFromEnv((await resolvedInfraEnv()).env).projectId;
  if (!projectId) return { ok: false as const, reason: "Firebase project is not configured. No membership was granted." };
  let certs: Record<string, string> | null = null;
  try {
    certs = await firebaseCerts();
  } catch {
    certs = null;
  }
  if (!certs) return { ok: false as const, reason: "Firebase signing keys could not be read. No membership was granted." };
  return verifyFirebaseIdentity(idToken, projectId, certs);
}

/** Verifies a Firebase ID token, requires a verified email, then reads the wedding role from Supabase. It never creates a membership. */
export async function confirmFirebaseMembership(slug: string, idToken: string) {
  const verified = await readFirebaseIdentity(idToken);
  if (!verified.ok) return verified;
  if (!verified.identity.email) return { ok: false as const, reason: "This Firebase user has no email address, so no wedding membership was granted." };
  const gate = requireVerifiedEmail(verified.identity);
  if (!gate.ok) return { ok: false as const, reason: gate.reason, code: "verification_required" as const };
  const { weddingDataSql } = await import("@/lib/developer/core-route.server");
  const sql = await weddingDataSql();
  const rows = await sql<{ email: string; role: string; member_key: string }>`
    select email, role, member_key from circle_members
    where slug = ${slug} and lower(email) = ${verified.identity.email}
    limit 3
  `;
  const decision = membershipFromIdentity({
    email: verified.identity.email,
    rows: rows.map((row) => ({ email: row.email || "", role: row.role || "", memberKey: row.member_key || "" })),
  });
  if (!decision.ok) return decision;
  return { ok: true as const, role: decision.role, memberKey: decision.memberKey, uid: verified.identity.uid };
}
