import { openJson, sealJson } from "../wedding/affiliate.crypto.ts";

const TEN_MINUTES = 10 * 60;

export function sealDownloadTicket(fields: { slug: string; member: string; key: string; name: string; mime: string; exp: number }, secret: string) {
  const sealed = sealJson(
    { slug: fields.slug, member: fields.member, key: fields.key, name: fields.name, mime: fields.mime, exp: String(fields.exp) },
    secret,
  );
  const nonce = Buffer.from(sealed.nonce, "base64").toString("base64url");
  const cipher = Buffer.from(sealed.cipher, "base64").toString("base64url");
  return `${nonce}.${cipher}`;
}

export function openDownloadTicket(token: string, secret: string, nowMs = Date.now()) {
  const [nonce, cipher] = token.split(".");
  if (!nonce || !cipher || token.split(".").length !== 2) return null;
  try {
    const fields = openJson(
      { nonce: Buffer.from(nonce, "base64url").toString("base64"), cipher: Buffer.from(cipher, "base64url").toString("base64") },
      secret,
    );
    const exp = Number(fields.exp);
    if (!Number.isFinite(exp) || exp * 1000 < nowMs) return null;
    if (!fields.slug || !fields.member || !fields.key || !fields.name) return null;
    return { slug: fields.slug, member: fields.member, key: fields.key, name: fields.name, mime: fields.mime || "", exp };
  } catch {
    return null;
  }
}

export function downloadExpiry(nowMs = Date.now()) {
  return Math.floor(nowMs / 1000) + TEN_MINUTES;
}
