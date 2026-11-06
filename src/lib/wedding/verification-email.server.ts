import { createHash, createHmac, randomInt } from "node:crypto";
import { getSql } from "@/lib/db";
import { firebaseRuntimeFromEnv } from "@/lib/infra/config";
import { googleToken } from "@/lib/infra/google-token";
import { resolvedInfraEnv } from "@/lib/infra/resolved-env.server";
import { openJson, sealJson } from "@/lib/wedding/affiliate.crypto";
import { readFirebaseIdentity } from "@/lib/wedding/firebase-identity.server";

const sender = "The Wedding Circle <no-reply@mail.theweddingcircle.in>";
const unavailable = { ok: false as const, message: "We couldn't send the verification email. Please try again shortly." };

function accountKey(projectId: string, uid: string, email: string) {
  return createHash("sha256").update(JSON.stringify([projectId, uid, email])).digest("hex");
}

function codeDigest(key: string, account: string, code: string) {
  return createHmac("sha256", key).update(`verification-email:${account}:${code}`).digest("hex");
}

export async function sendFirebaseVerificationEmail(idToken: string) {
  try {
    const { env } = await resolvedInfraEnv(true);
    const { projectId, serviceAccountJson } = firebaseRuntimeFromEnv(env);
    const resendKey = env.RESEND_API_KEY?.trim();
    if (!resendKey || !projectId || !serviceAccountJson) return unavailable;

    const verified = await readFirebaseIdentity(idToken, projectId);
    if (!verified.ok || !verified.identity.email) {
      return { ok: false as const, message: "Sign in again to send a verification email." };
    }
    if (verified.identity.emailVerified) {
      return { ok: false as const, message: "This email is already verified. Sign in again to continue." };
    }

    const email = verified.identity.email;
    const recipient = createHash("sha256").update(email).digest("hex");
    const sql = await getSql();
    await sql`delete from wc_verification_email_limits where expires_at <= now() and bucket <> 'global'`;
    const slots = await sql`
      with recipient_slot as (
        insert into wc_verification_email_limits (bucket, expires_at, attempts)
        values (${recipient}, now() + interval '1 minute', 1)
        on conflict (bucket) do update set expires_at = excluded.expires_at, attempts = 1
        where wc_verification_email_limits.expires_at <= now()
        returning 1
      )
      insert into wc_verification_email_limits (bucket, expires_at, attempts)
      select 'global', now() + interval '1 hour', 1 from recipient_slot
      on conflict (bucket) do update set
        attempts = case when wc_verification_email_limits.expires_at <= now()
          then 1 else wc_verification_email_limits.attempts + 1 end,
        expires_at = case when wc_verification_email_limits.expires_at <= now()
          then excluded.expires_at else wc_verification_email_limits.expires_at end
      where wc_verification_email_limits.expires_at <= now()
         or wc_verification_email_limits.attempts < 100
      returning 1
    `;
    if (!slots.length) {
      return { ok: false as const, message: "Too many verification email requests. Please wait before trying again." };
    }

    const access = await googleToken(serviceAccountJson, "https://www.googleapis.com/auth/identitytoolkit");
    if (!access.ok) return unavailable;

    const action = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/accounts:sendOobCode`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${access.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ requestType: "VERIFY_EMAIL", email, returnOobLink: true }),
      },
    );
    if (!action.ok) {
      console.warn("Firebase verification link request failed", action.status);
      return unavailable;
    }
    const { oobLink } = await action.json() as { oobLink?: string };
    if (!oobLink) return unavailable;
    const link = new URL(oobLink);
    const actionCode = link.searchParams.get("oobCode");
    if (link.protocol !== "https:" || link.searchParams.get("mode") !== "verifyEmail" || !actionCode) return unavailable;

    const code = String(randomInt(1_000_000)).padStart(6, "0");
    const account = accountKey(projectId, verified.identity.uid, email);
    const digest = codeDigest(resendKey, account, code);
    const { cipher, nonce } = sealJson({ actionCode }, resendKey);
    await sql`delete from wc_verification_email_codes where expires_at <= now()`;
    await sql`
      insert into wc_verification_email_codes (account_key, digest, cipher, nonce, expires_at, attempts_left)
      values (${account}, ${digest}, ${cipher}, ${nonce}, now() + interval '10 minutes', 5)
      on conflict (account_key) do update set digest = excluded.digest, cipher = excluded.cipher,
        nonce = excluded.nonce, expires_at = excluded.expires_at, attempts_left = excluded.attempts_left
    `;

    const delivery = await fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: sender,
        to: [email],
        subject: "Your Wedding Circle verification code",
        text: `Your Wedding Circle verification code is ${code}.\n\nEnter it on the verification screen within 10 minutes. If you didn’t request a code, you can ignore this email.`,
      }),
    });
    if (!delivery.ok) {
      console.warn("Resend verification email request failed", delivery.status);
      return unavailable;
    }
    return { ok: true as const };
  } catch {
    return unavailable;
  }
}

export async function redeemFirebaseVerificationCode(idToken: string, code: string) {
  const invalid = { ok: false as const, message: "That code is incorrect, expired, or used. You can request a new code." };
  try {
    const { env } = await resolvedInfraEnv(true);
    const { projectId } = firebaseRuntimeFromEnv(env);
    const key = env.RESEND_API_KEY?.trim();
    if (!key || !projectId) return invalid;
    const verified = await readFirebaseIdentity(idToken, projectId);
    if (!verified.ok || !verified.identity.email) {
      return { ok: false as const, message: "Sign in again to verify your email." };
    }

    const account = accountKey(projectId, verified.identity.uid, verified.identity.email);
    const digest = codeDigest(key, account, code);
    const sql = await getSql();
    // Lock and update the attempt count in the same statement as the comparison.
    const [match] = await sql<{ cipher: string | null; nonce: string | null }>`
      update wc_verification_email_codes
      set attempts_left = case when digest = ${digest} then 0 else attempts_left - 1 end
      where account_key = ${account} and expires_at > now() and attempts_left > 0
      returning case when digest = ${digest} then cipher end as cipher,
        case when digest = ${digest} then nonce end as nonce
    `;
    if (!match?.cipher || !match.nonce) return invalid;
    const { actionCode } = openJson({ cipher: match.cipher, nonce: match.nonce }, key);
    return actionCode ? { ok: true as const, actionCode } : invalid;
  } catch {
    return { ok: false as const, message: "We couldn't check the code. Please try again shortly." };
  }
}
