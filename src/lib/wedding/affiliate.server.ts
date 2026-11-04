import { getSql, type Sql } from "@/lib/db";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { env } from "@/lib/env.server";
import {
  AFFILIATE_SERVICES,
  affiliateService,
  cleanAffiliateFields,
  interpretAffiliateHttp,
  meeshoBlock,
  publicServiceView,
  redactSecrets,
  type AffiliateServiceId,
} from "@/lib/wedding/affiliate";
import { openJson, sealJson, signAmazonSearch } from "@/lib/wedding/affiliate.crypto";

const lastTest = new Map<string, number>();

function vaultKey() {
  return env("AFFILIATE_VAULT_KEY") || env("BETTER_AUTH_SECRET") || "";
}

async function ensure(sql: Sql) {
  await sql`create table if not exists developer_secret_vault (
    service text primary key,
    cipher text not null,
    nonce text not null,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists affiliate_link_status (
    service text primary key,
    state text not null,
    detail text not null default '',
    checked_at timestamptz not null default now()
  )`;
}

async function readSealed(sql: Sql, service: string) {
  const key = vaultKey();
  if (!key) return null;
  const row = (await sql<{ cipher: string; nonce: string }>`
    select cipher, nonce from developer_secret_vault where service = ${service} limit 1
  `)[0];
  if (!row) return null;
  try {
    return openJson(row, key);
  } catch {
    return null;
  }
}

function envFields(serviceId: AffiliateServiceId) {
  const service = affiliateService(serviceId);
  if (!service) return null;
  const fields: Record<string, string> = {};
  for (const field of service.fields) {
    const value = env(field.env);
    if (!value) return null;
    fields[field.id] = value;
  }
  return fields;
}

async function resolvedFields(sql: Sql, serviceId: AffiliateServiceId) {
  const sealed = await readSealed(sql, serviceId);
  const service = affiliateService(serviceId);
  if (service && sealed && service.fields.every((field) => sealed[field.id])) return { fields: sealed, source: "server" as const };
  const fromEnv = envFields(serviceId);
  if (fromEnv) return { fields: fromEnv, source: "environment" as const };
  return { fields: null, source: "none" as const };
}

export async function storedCredentialNames(sql: Sql) {
  const names = new Set<string>();
  if (!vaultKey()) return names;
  await ensure(sql);
  for (const service of AFFILIATE_SERVICES) {
    const sealed = await readSealed(sql, service.id);
    if (!sealed) continue;
    for (const field of service.fields) {
      if (sealed[field.id]) names.add(field.env);
    }
  }
  return names;
}

async function attentionFor(sql: Sql, service: string) {
  const row = (await sql<{ state: string; detail: string }>`
    select state, detail from affiliate_link_status where service = ${service} limit 1
  `)[0];
  if (!row || row.state !== "needs_attention") return "";
  return redactSecrets(row.detail || "Connection needs attention.", []);
}

export async function affiliateBoard(token: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const sql = await getSql();
  await ensure(sql);
  const services = [];
  for (const service of AFFILIATE_SERVICES) {
    const resolved = await resolvedFields(sql, service.id);
    const view = publicServiceView({
      id: service.id,
      complete: Boolean(resolved.fields),
      source: resolved.source,
      attention: resolved.fields ? await attentionFor(sql, service.id) : "",
    });
    if (view) services.push(view);
  }
  return {
    ok: true as const,
    vault: vaultKey() ? "ready" as const : "environment" as const,
    services,
  };
}

export async function saveAffiliate(token: string, serviceId: string, input: Record<string, unknown>, confirm: boolean) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  if (!confirm) return { ok: false as const, error: "Confirm before saving. Credentials are not stored, and the bot stays off." };
  const clean = cleanAffiliateFields(serviceId, input);
  if (!clean.ok) return clean;
  const key = vaultKey();
  if (!key) {
    const names = clean.service.fields.map((field) => field.env).join(", ");
    return {
      ok: true as const,
      saved: false as const,
      message: `These values were not saved. This deployment cannot store affiliate secrets from the browser. Set ${names} in the server environment, then reload. Nothing was written to this device, and the bot was not turned on.`,
    };
  }
  const sql = await getSql();
  await ensure(sql);
  const sealed = sealJson(clean.fields, key);
  await sql`insert into developer_secret_vault (service, cipher, nonce, updated_at)
    values (${clean.service.id}, ${sealed.cipher}, ${sealed.nonce}, now())
    on conflict (service) do update set cipher = excluded.cipher, nonce = excluded.nonce, updated_at = now()`;
  await sql`delete from affiliate_link_status where service = ${clean.service.id}`;
  return { ok: true as const, saved: true as const, message: "Saved on the server. The values will not be shown again. The bot was not turned on." };
}

async function remember(sql: Sql, service: string, state: string, detail: string) {
  const safe = redactSecrets(detail, []);
  await sql`insert into affiliate_link_status (service, state, detail, checked_at)
    values (${service}, ${state}, ${safe}, now())
    on conflict (service) do update set state = excluded.state, detail = excluded.detail, checked_at = now()`;
}

export async function testAffiliate(token: string, serviceId: string) {
  const session = await requireDeveloper(token);
  if (!session.ok) return session;
  const service = affiliateService(serviceId);
  if (!service) return { ok: false as const, error: "That affiliate service is not part of Discover." };
  const recent = lastTest.get(service.id) ?? 0;
  if (Date.now() - recent < 15_000) return { ok: false as const, error: "Wait a moment before testing this connection again." };
  lastTest.set(service.id, Date.now());
  const sql = await getSql();
  await ensure(sql);
  const resolved = await resolvedFields(sql, service.id);
  if (!resolved.fields) {
    return { ok: true as const, status: "not_configured" as const, message: "Not configured. Add the server credentials before testing. No request was sent." };
  }
  if (service.id === "meesho") {
    const message = meeshoBlock();
    await remember(sql, service.id, "needs_attention", message);
    return { ok: true as const, status: "needs_attention" as const, message };
  }
  const secrets = Object.values(resolved.fields);
  try {
    const result = service.id === "amazon" ? await probeAmazon(resolved.fields) : await probeFlipkart(resolved.fields);
    const verdict = interpretAffiliateHttp(service.id, result.status, result.body, secrets);
    await remember(sql, service.id, verdict.status, verdict.message);
    return { ok: true as const, status: verdict.status, message: verdict.message };
  } catch {
    const message = "The connection test could not be completed. No products were added.";
    await remember(sql, service.id, "needs_attention", message);
    return { ok: true as const, status: "needs_attention" as const, message };
  }
}

async function probeFlipkart(fields: Record<string, string>) {
  const id = encodeURIComponent(fields.affiliateId || "");
  const response = await fetch(`https://affiliate-api.flipkart.net/affiliate/api/${id}.json`, {
    headers: {
      "Fk-Affiliate-Id": fields.affiliateId || "",
      "Fk-Affiliate-Token": fields.token || "",
    },
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, body: (await response.text()).slice(0, 500) };
}

async function probeAmazon(fields: Record<string, string>) {
  const signed = signAmazonSearch({
    accessKey: fields.accessKey || "",
    secretKey: fields.secretKey || "",
    partnerTag: fields.partnerTag || "",
  });
  const response = await fetch(signed.url, {
    method: "POST",
    headers: signed.headers,
    body: signed.payload,
    signal: AbortSignal.timeout(8000),
  });
  return { status: response.status, body: (await response.text()).slice(0, 500) };
}
