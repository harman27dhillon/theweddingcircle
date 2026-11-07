import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import test from "node:test";
import { classifyDatabaseError, safeSupabaseUri, stagingDatabaseUrl, trustedSupabaseSsl } from "./supabase-connect.ts";

import { PRODUCTION_SUPABASE_URL, STAGING_SUPABASE_URL } from "./supabase-projects.ts";

const REF = "abcdefghijabcdefghij";
const PASSWORD = "S3cret-Password-Value";

test("the pooler URI is not rewritten and the password is not returned", () => {
  const raw = `postgresql://postgres.${REF}:${encodeURIComponent("p@ss word")}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
  const uri = safeSupabaseUri(raw);
  assert.equal(uri.status, "ready");
  assert.equal(uri.mode, "session_pooler");
  assert.equal(uri.usernameFormat, "pooler_project");
  assert.equal(uri.passwordPresent, true);
  assert.equal(uri.passwordLooksDoubleEncoded, false);
  assert.equal(uri.host, "aws-0-ap-south-1.pooler.supabase.com");
  assert.equal(uri.port, 5432);
  assert.equal(uri.database, "postgres");
  const dumped = JSON.stringify(uri);
  assert.equal(dumped.includes(PASSWORD), false);
  assert.equal(dumped.includes("p@ss"), false);
  assert.equal(dumped.includes(REF), false);
  assert.equal(dumped.includes(raw), false);
});

test("a short pooler username is reported and left unchanged", () => {
  const uri = safeSupabaseUri(`postgresql://postgres:${encodeURIComponent(PASSWORD)}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`);
  assert.equal(uri.usernameFormat, "short_postgres");
  assert.match(uri.detail, /will not rewrite/);
  const explained = classifyDatabaseError({ code: "28P01", message: 'password authentication failed for user "postgres"' }, uri);
  assert.equal(explained.status, "authentication_rejected");
  assert.match(explained.detail, /short username postgres/);
  assert.match(explained.detail, /Do not reset the database password yet/);
  assert.equal(explained.detail.includes(PASSWORD), false);
  assert.equal(explained.detail.toLowerCase().includes("succeeded"), false);
});

test("a matching pooler username with a rejected password is not treated as a DNS problem", () => {
  const uri = safeSupabaseUri(`postgresql://postgres.${REF}:${encodeURIComponent(PASSWORD)}@aws-1-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require`);
  assert.equal(uri.sslSpecified, true);
  const explained = classifyDatabaseError({ code: "28P01", message: "password authentication failed" }, uri);
  assert.equal(explained.status, "authentication_rejected");
  assert.match(explained.detail, /does not match the database password/);
  assert.doesNotMatch(explained.detail, /IPv6|DNS/);
});

test("double encoding is visible and DNS is not called authentication", () => {
  const uri = safeSupabaseUri(`postgresql://postgres.${REF}:p%2540ss@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`);
  assert.equal(uri.passwordLooksDoubleEncoded, true);
  assert.equal(JSON.stringify(uri).includes("p%40ss"), false);
  const auth = classifyDatabaseError({ code: "28P01", message: "password authentication failed" }, uri);
  assert.match(auth.detail, /encoded twice/);
  const direct = safeSupabaseUri(`postgresql://postgres:${encodeURIComponent(PASSWORD)}@db.${REF}.supabase.co:5432/postgres`);
  const dns = classifyDatabaseError({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" }, direct);
  assert.equal(dns.status, "dns_failure");
  assert.match(dns.detail, /not an authentication/);
  assert.equal(dns.detail.includes(PASSWORD), false);
});

test("tls verification stays on and trusts the published Supabase root", () => {
  const ssl = trustedSupabaseSsl();
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(JSON.stringify(ssl).includes('"rejectUnauthorized":false'), false);
  const root = ssl.ca.map((pem) => {
    try { return new X509Certificate(pem); } catch { return null; }
  }).find((cert) => cert?.subject.includes("Supabase Root 2021 CA"));
  assert.ok(root);
  assert.equal(root.fingerprint256, "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA");
  assert.equal(ssl.ca.length > 1, true);
});

test("malformed secrets are refused before a connection", () => {
  assert.equal(safeSupabaseUri("").status, "configuration_missing");
  assert.equal(safeSupabaseUri(`"postgresql://postgres:${PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres"`).status, "invalid_uri");
  assert.equal(safeSupabaseUri(`postgresql://postgres:${PASSWORD}@aws-0-ap-south-1.pooler.supabase.com:5432/post gres`).status, "invalid_uri");
  assert.equal(safeSupabaseUri(`https://${REF}.supabase.co`).status, "invalid_uri");
  assert.equal(safeSupabaseUri(`postgresql://postgres:[YOUR-PASSWORD]@db.${REF}.supabase.co:5432/postgres`).status, "invalid_uri");
  assert.equal(safeSupabaseUri(`postgresql://postgres:p@ss@db.${REF}.supabase.co:5432/postgres`).status, "invalid_uri");
});


test("staging requires an explicit Postgres connection to its own Supabase project", () => {
  const ref = (url: string) => new URL(url).hostname.split(".")[0];
  const pooler = (project: string) =>
    `postgresql://postgres.${ref(project)}:fixture-password@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`;
  const staging = pooler(STAGING_SUPABASE_URL);
  assert.equal(stagingDatabaseUrl({ SUPABASE_DB_URL: staging }), staging);
  assert.throws(() => stagingDatabaseUrl({ SUPABASE_DB_URL: pooler(PRODUCTION_SUPABASE_URL) }), /same project/);
  assert.throws(() => stagingDatabaseUrl({ DATABASE_URL: staging }), /Set SUPABASE_DB_URL/);
});
