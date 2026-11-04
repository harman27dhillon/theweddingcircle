import { createSign, createVerify } from "node:crypto";

export function serviceAccountJwt(account: { clientEmail: string; privateKey: string }, scope: string, nowMs: number) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(nowMs / 1000);
  const claim = Buffer.from(JSON.stringify({
    iss: account.clientEmail,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const unsigned = `${header}.${claim}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const key = account.privateKey.replace(/\\n/g, "\n");
  return `${unsigned}.${signer.sign(key).toString("base64url")}`;
}

export function verifyServiceAccountJwt(token: string, publicKey: string) {
  const [header, claim, signature] = token.split(".");
  if (!header || !claim || !signature) return false;
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${claim}`);
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(signature, "base64url"));
}
