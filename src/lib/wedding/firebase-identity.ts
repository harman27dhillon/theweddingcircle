import { createVerify } from "node:crypto";

export type FirebaseIdentity = { uid: string; email: string; emailVerified: boolean };

function jsonPart(part: string) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Checks the Firebase ID token signature and the project claims. It does not grant a wedding role. */
export function verifyFirebaseIdentity(token: string, projectId: string, certs: Record<string, string>, now = Date.now()): { ok: true; identity: FirebaseIdentity } | { ok: false; reason: string } {
  const project = projectId.trim();
  const parts = token.split(".");
  if (!project || parts.length !== 3 || parts.some((part) => !part)) return { ok: false, reason: "That sign-in token is not a Firebase ID token." };
  const header = jsonPart(parts[0]);
  const payload = jsonPart(parts[1]);
  if (!header || !payload) return { ok: false, reason: "That sign-in token could not be read." };
  if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "That sign-in token is not signed the way Firebase signs ID tokens." };
  const cert = certs[header.kid];
  if (!cert || (!cert.includes("BEGIN CERTIFICATE") && !cert.includes("BEGIN PUBLIC KEY"))) return { ok: false, reason: "That sign-in token was not signed by a known Firebase key." };
  try {
    const verify = createVerify("RSA-SHA256");
    verify.update(`${parts[0]}.${parts[1]}`);
    verify.end();
    if (!verify.verify(cert, Buffer.from(parts[2], "base64url"))) return { ok: false, reason: "That sign-in token signature was rejected." };
  } catch {
    return { ok: false, reason: "That sign-in token signature was rejected." };
  }
  const iss = `https://securetoken.google.com/${project}`;
  if (payload.iss !== iss || payload.aud !== project) return { ok: false, reason: "That sign-in token is for a different Firebase project." };
  if (typeof payload.sub !== "string" || payload.sub.length < 4 || payload.sub.length > 128) return { ok: false, reason: "That sign-in token has no Firebase user." };
  const exp = typeof payload.exp === "number" ? payload.exp : 0;
  const iat = typeof payload.iat === "number" ? payload.iat : 0;
  if (!exp || exp * 1000 <= now) return { ok: false, reason: "That sign-in token has expired." };
  if (!iat || iat * 1000 > now + 5 * 60 * 1000) return { ok: false, reason: "That sign-in token is not valid yet." };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  return { ok: true, identity: { uid: payload.sub, email, emailVerified: payload.email_verified === true } };
}

/** A verified Firebase email is required before a wedding role is read. A client-supplied flag is ignored. */
export function requireVerifiedEmail(identity: FirebaseIdentity) {
  if (identity.emailVerified !== true) {
    return { ok: false as const, reason: "Verify your email before opening this wedding. No membership was granted." };
  }
  return { ok: true as const };
}
