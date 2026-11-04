// Recovered from the last server build after the typed source was overwritten.
// @ts-nocheck
import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { getSql, type Sql } from "@/lib/db";
import { weddingDataSql } from "@/lib/developer/core-route.server";
import { interpretEmailPassword, interpretFirebaseProject, interpretPasswordProbe, normalizeProjectId, parseServiceAccount, firebaseProjectNumber, firebaseKeyAllowsEmailProbe } from "@/lib/developer/cloud";
import { interpretRls, WEDDING_TABLES } from "@/lib/infra/security";
import { requireDeveloper } from "@/lib/developer/gate.server";
import { PLAY_CATALOG, decidePurchase, interpretPlayProduct, interpretPlaySubscription, purchaseTokenHash, type PurchaseSlot } from "@/lib/infra/billing";
import { affectedChecks, bareCloudflareToken, classifyPlayCatalog, classifyPlayProduct, firebaseKeyDiagnostic, isConfigProvider, mergeSavedConfig, publicConfigForms, resolveFirebaseApiKey, vapidShapeOk } from "@/lib/infra/config";
import { FLAG_IDS, FLAG_LABEL, PACKAGING_NOTE, assessInfrastructure, decideFlag, effectiveFlag, redactDetail, sealedBoard, type EnvMap, type FlagId, type ProviderId } from "@/lib/infra/core";
import { serviceAccountJwt } from "@/lib/infra/google-jwt";
import { decideLive, realtimeAuthorizationHeader, realtimeConfigGap } from "@/lib/infra/live";
import { classifyRealtimeProbe, cloudflareFailure, judgeWebinarPresets, readPresetList, readPresetPermission, REALTIME_API, PRESENTER_PRESET, VIEWER_PRESET } from "@/lib/infra/realtime";
import { authorizeMedia, keyBelongsToWedding, mediaObjectKey, withinRate, type MediaPurpose } from "@/lib/infra/media-policy";
import { MULTIPART_PART_BYTES, SERVER_PUT_MAX, UPLOAD_CHUNK_BYTES, pieceLength, uploadPieceCount } from "@/lib/infra/r2-browser";
import { completeR2Multipart, createR2Multipart, deleteR2Object, ensureR2BrowserCors, explainR2Transport, getR2Object, headR2Object, openR2Read, presignS3, probeR2Bucket, putR2Object, uploadR2Part } from "@/lib/infra/r2-sign";
import { downloadExpiry, openDownloadTicket, sealDownloadTicket } from "@/lib/infra/download-ticket";
import { openJson, sealJson } from "@/lib/wedding/affiliate.crypto";
import { contentDisposition, downloadMime, privacyAllowsDownload, safeDownloadName, weddingDownloadName } from "@/lib/wedding/download-name";
import { overPlanStorage, storageMessage } from "@/lib/wedding/plan";
import { thumbObjectKey } from "@/lib/wedding/r2-ref";
import { cdnMark, cdnProbeMatches, cdnProbeToken, cleanCdnInput, combineCdnStatus, describeCdnCache, judgeCdnProbe, judgeZoneCheck } from "@/lib/infra/cdn";
import { displayText } from "@/lib/infra/display";
import { buildGatewayReport, classifyGatewayTransport } from "@/lib/infra/media-gateway";
import { GATEWAY_PROBE_KEY, MEDIA_TOKEN_TTL_SECONDS, gatewayMark, gatewaySecretOk, mayIssueViewToken, mediaGatewayUrl, normalizeGatewayOrigin, signMediaToken, cleanGatewayInput } from "@/lib/infra/media-token";
import { infraVaultKey, resolvedInfraEnv } from "@/lib/infra/resolved-env.server";

var hits = new Map();
function amzDate(now = new Date()) {
	return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}
async function ensure(sql) {
	await sql`create table if not exists infra_flags (
    key text primary key,
    enabled boolean not null default false,
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  )`;
	await sql`create table if not exists infra_checks (
    provider text primary key,
    state text not null,
    detail text not null default '',
    fingerprint text not null default '',
    checked_at timestamptz not null default now()
  )`;
	await sql`alter table infra_checks add column if not exists diag text not null default ''`;
	await sql`create table if not exists infra_purchases (
    token_hash text primary key,
    product_slot text not null,
    state text not null,
    updated_at timestamptz not null default now()
  )`;
	await sql`create table if not exists infra_config (
    id text primary key,
    cipher text not null,
    nonce text not null,
    updated_by text not null default '',
    updated_at timestamptz not null default now()
  )`;
	await sql`create table if not exists r2_media (
    object_key text primary key,
    slug text not null,
    purpose text not null,
    mime text not null,
    bytes integer not null,
    created_at timestamptz not null default now()
  )`;
	await sql`create table if not exists r2_upload (
    upload_id text primary key,
    object_key text not null,
    slug text not null,
    purpose text not null,
    mime text not null,
    member_hash text not null,
    total_bytes integer not null,
    total_chunks integer not null,
    received integer not null default 0,
    flushed integer not null default 0,
    multipart_id text not null default '',
    next_part integer not null default 1,
    etags text not null default '[]',
    created_at timestamptz not null default now()
  )`;
	await sql`alter table r2_upload add column if not exists created_at timestamptz not null default now()`;
}
async function audit(sql, email, command, result) {
	await sql`insert into developer_audit (id, email, command, interpretation, level, action, result) values (${randomBytes(16).toString("hex")}, ${email}, ${command.slice(0, 500)}, ${"Infrastructure"}, ${"yellow"}, ${"infra"}, ${result.slice(0, 500)})`;
}
function vaultKey() {
	return infraVaultKey();
}
async function readVault(sql) {
	const key = vaultKey();
	if (!key) return {
		fields: {},
		unreadable: false,
		locked: true
	};
	const row = (await sql`select cipher, nonce from infra_config where id = ${"active"} limit 1`)[0];
	if (!row) return {
		fields: {},
		unreadable: false,
		locked: false
	};
	try {
		return {
			fields: openJson(row, key),
			unreadable: false,
			locked: false
		};
	} catch {
		return {
			fields: {},
			unreadable: true,
			locked: false
		};
	}
}
async function writeVault(sql, fields, email) {
	const key = vaultKey();
	if (!key) return {
		ok: false,
		error: "A server vault key is not set. Set INFRA_VAULT_KEY or BETTER_AUTH_SECRET. Nothing was saved."
	};
	const sealed = sealJson(fields, key);
	await sql`insert into infra_config (id, cipher, nonce, updated_by, updated_at) values (${"active"}, ${sealed.cipher}, ${sealed.nonce}, ${email}, now())
    on conflict (id) do update set cipher = excluded.cipher, nonce = excluded.nonce, updated_by = excluded.updated_by, updated_at = now()`;
	return { ok: true };
}
async function resolvedEnv() {
	try {
		const sql = await getSql();
		await ensure(sql);
	} catch {
		return {
			env: { ...process.env },
			saved: {},
			unreadable: true,
			locked: false
		};
	}
	return resolvedInfraEnv();
}
function vaultWarning(input) {
	if (input.unreadable) return "Saved configuration could not be read. Environment values are still shown. Nothing was overwritten.";
	if (input.locked) return "A server vault key is not set. Set INFRA_VAULT_KEY or BETTER_AUTH_SECRET before saving. Environment values are still used.";
	return "";
}
function allow(bucket, limit = 30) {
	const now = Date.now();
	const recent = (hits.get(bucket) || []).filter((at) => now - at < 6e5);
	if (!withinRate(recent.length, limit)) return false;
	recent.push(now);
	hits.set(bucket, recent);
	return true;
}
async function readFlags(sql) {
	const rows = await sql`select key, enabled from infra_flags`;
	const flags = Object.fromEntries(FLAG_IDS.map((id) => [id, false]));
	for (const row of rows) if (FLAG_IDS.includes(row.key)) flags[row.key] = row.enabled === true;
	return flags;
}
async function readChecks(sql) {
	const rows = await sql`select provider, state, detail, fingerprint, checked_at from infra_checks`;
	const checks = {};
	for (const row of rows) checks[row.provider] = {
		state: displayText(row.state),
		detail: displayText(row.detail),
		fingerprint: displayText(row.fingerprint),
		checkedAt: displayText(row.checked_at)
	};
	return checks;
}
function boardBody(env, checks, flags) {
	const assessed = assessInfrastructure(env, checks);
	const byId = Object.fromEntries(assessed.providers.map((item) => [item.id, item]));
	return {
		ok: true,
		environment: assessed.environment,
		database: assessed.database,
		packaging: PACKAGING_NOTE,
		providers: assessed.providers.map((item) => ({
			...item,
			checkedAt: checks[item.id]?.checkedAt || ""
		})),
		flags: FLAG_IDS.map((id) => {
			const provider = id === "firebaseAuth" ? "firebase" : id === "cloudDatabase" ? "database" : id === "r2Media" || id === "mediaMigration" ? "r2" : id === "livestream" ? "livestream" : id === "playBilling" ? "play" : id === "pushNotifications" ? "push" : null;
			const state = provider ? byId[provider]?.state || "not_configured" : assessed.environment === "production" ? "verified" : "not_configured";
			const enabled = flags[id];
			return {
				id,
				label: FLAG_LABEL[id],
				enabled,
				active: id === "productionMode" ? enabled && assessed.environment === "production" : provider ? effectiveFlag(enabled, byId[provider]?.state || "not_configured") : false,
				note: enabled && !effectiveFlag(enabled, state === "verified" ? "verified" : "not_configured") && id !== "productionMode" ? "The switch is on, but the last server test is not still valid, so the feature stays inactive." : "A switch does not by itself mean the service is connected."
			};
		}),
		catalog: PLAY_CATALOG.map((item) => ({
			slot: item.slot,
			title: item.title,
			kind: item.kind,
			productIdSet: Boolean(env[item.env]?.trim())
		}))
	};
}
export async function infraBoard(token): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return {
		ok: false,
		error: "Developer session required."
	};
	const sql = await getSql();
	try {
		await ensure(sql);
		const resolved = await resolvedEnv();
		const warning = vaultWarning(resolved);
		return sealedBoard(session, {
			...boardBody(resolved.env, await readChecks(sql), await readFlags(sql)),
			forms: publicConfigForms({
				environment: process.env,
				saved: resolved.saved
			}),
			...warning ? { warning } : {}
		});
	} catch (error) {
		const detail = redactDetail(error instanceof Error ? error.message : "unavailable");
		return sealedBoard(session, {
			...boardBody(process.env, {}, Object.fromEntries(FLAG_IDS.map((id) => [id, false]))),
			forms: publicConfigForms({
				environment: process.env,
				saved: {}
			}),
			persisted: false,
			warning: detail || "Saved infrastructure status could not be read. Nothing is reported as verified."
		});
	}
}
async function saveCheck(sql, provider, state, detail, mark, limit = 280) {
	await sql`insert into infra_checks (provider, state, detail, fingerprint, checked_at) values (${provider}, ${state}, ${redactDetail(detail, limit)}, ${mark}, now())
    on conflict (provider) do update set state = excluded.state, detail = excluded.detail, fingerprint = excluded.fingerprint, checked_at = now()`;
}
async function googleToken(raw, scope) {
	const parsed = parseServiceAccount(raw);
	if (!parsed.ok) return {
		ok: false,
		error: "The service account could not be read. The value was not shown."
	};
	let assertion = "";
	try {
		assertion = serviceAccountJwt({
			clientEmail: parsed.clientEmail,
			privateKey: parsed.privateKey
		}, scope, Date.now());
	} catch {
		return { ok: false, error: "The service account private key could not be used. The value was not shown." };
	}
	let response;
	try {
		response = await fetch("https://oauth2.googleapis.com/token", {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
				assertion
			})
		});
	} catch {
		return { ok: false, error: "Google could not be reached. No secret was stored." };
	}
	const body = await response.json().catch(() => null);
	const code = body && typeof body.error === "string" && /^[a-z0-9_]+$/i.test(body.error) ? body.error : "";
	if (!response.ok || !body?.access_token) return {
		ok: false,
		error: code ? `Google refused the service account (${code}). No secret was stored.` : "Google refused the service account. No secret was stored."
	};
	return {
		ok: true,
		token: body.access_token
	};
}
function cloudflareCode(body) {
	const code = body && Array.isArray(body.errors) ? body.errors[0]?.code : 0;
	return typeof code === "number" ? code : 0;
}
function configSource(saved, key) {
	return saved && String(saved[key] || "").trim() ? "saved configuration" : "server environment";
}
function firebaseDiag(saved, env, projectId, accountId) {
	const savedId = normalizeProjectId(saved?.FIREBASE_PROJECT_ID || "");
	const envId = normalizeProjectId(process.env.FIREBASE_PROJECT_ID || "");
	const conflict = savedId && envId && savedId !== envId ? ` Saved project id is ${savedId}. Server environment project id is ${envId}. The saved value is used.` : "";
	return `Saved project id ${projectId || "(empty)"}. Service account project id ${accountId || "unreadable"}. Project id source: ${configSource(saved, "FIREBASE_PROJECT_ID")}. API key source: ${configSource(saved, "FIREBASE_API_KEY")}.${conflict}`;
}
function uncheckedEmail(detail) {
	return /Email\/Password was not checked/.test(detail) ? detail : `${detail} Email/Password was not checked.`;
}
function cloudflareNote(body) {
	const message = body && Array.isArray(body.errors) ? body.errors[0]?.message : "";
	const code = body && Array.isArray(body.errors) ? body.errors[0]?.code : 0;
	const text = typeof message === "string" ? redactDetail(message).replace(/bearer\s+\S+/gi, "Bearer [redacted]") : "";
	const num = typeof code === "number" ? code : 0;
	if (!text && !num) return "";
	return text && num ? `${text} (${num})` : text || `Cloudflare error ${num}`;
}
export async function infraTest(token, provider): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	const id = provider;
	if (![
		"database",
		"firebase",
		"r2",
		"livestream",
		"play",
		"push"
	].includes(id)) return {
		ok: false,
		error: "That check is not available."
	};
	const resolved = await resolvedEnv();
	if (resolved.unreadable) return {
		ok: false,
		error: "Saved configuration could not be read, so the test was not run."
	};
	const env = resolved.env;
	const before = assessInfrastructure(env);
	const current = before.providers.find((item) => item.id === id);
	if (!current) return {
		ok: false,
		error: "That check is not available."
	};
	if (current.state === "not_configured" || current.state === "incomplete" || current.state === "disabled") return {
		ok: false,
		error: current.detail,
		state: current.state
	};
	const sql = await getSql();
	await ensure(sql);
	const mark = before.fingerprint[id];
	// not_configured, incomplete, and disabled stop here and never call the provider. An assessed error does not stop here: the HTTP test still runs, then displayState can hide that result behind the local error.
	try {
		if (id === "database") {
			await sql`select 1 as ok`;
			const base = before.database === "pglite" ? "The embedded database answered. No wedding rows were read. This is not a cloud database." : "The cloud database answered. The URL was not shown and no wedding rows were read.";
			let marker = before.database === "supabase" ? "unread" : "na";
			let rlsDetail = before.database === "supabase"
				? "Row level security could not be read. It was not marked complete."
				: "Not applicable on this database. Supabase row level security is checked only when SUPABASE_DB_URL is set.";
			if (before.database === "supabase") {
				try {
					const names = [...WEDDING_TABLES];
					const list = names.map((_, index) => `$${index + 1}`).join(", ");
					const readRls = async () => {
						const tables = await sql.query(`select c.relname as name, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in (${list})`, names);
						const policies = await sql.query(`select tablename as table, roles::text as roles, coalesce(qual, '') as qual from pg_policies where schemaname = 'public' and tablename in (${list})`, names);
						const grants = await sql.query(`select table_name as table, grantee, privilege_type as privilege from information_schema.role_table_grants where table_schema = 'public' and lower(grantee) in ('anon', 'authenticated', 'public') and table_name in (${list})`, names);
						return interpretRls({
							tables: tables.map((row) => ({ name: String(row.name), rls: row.rls === true || row.rls === "t" || row.rls === "true" })),
							policies: policies.map((row) => ({ table: String(row.table), roles: String(row.roles || ""), qual: String(row.qual || "") })),
							grants: grants.map((row) => ({ table: String(row.table), grantee: String(row.grantee || ""), privilege: String(row.privilege || "") })),
						});
					};
					let verdict = await readRls();
					if (verdict.marker === "off") {
						await sql`alter table if exists public.circles enable row level security`;
						await sql`alter table if exists public.circle_members enable row level security`;
						await sql`alter table if exists public.circle_auth enable row level security`;
						await sql`alter table if exists public.ceremony_invites enable row level security`;
						await sql`alter table if exists public.couple_access enable row level security`;
						await sql`revoke all on table public.circles from anon, authenticated, public`;
						await sql`revoke all on table public.circle_members from anon, authenticated, public`;
						await sql`revoke all on table public.circle_auth from anon, authenticated, public`;
						await sql`revoke all on table public.ceremony_invites from anon, authenticated, public`;
						await sql`revoke all on table public.couple_access from anon, authenticated, public`;
						verdict = await readRls();
						if (verdict.marker === "on") verdict = { ...verdict, detail: `${verdict.detail} Missing row level security was turned on and public grants were removed. No rows were deleted.` };
					}
					marker = verdict.marker;
					rlsDetail = verdict.detail;
				} catch {
					marker = "unread";
					rlsDetail = "Row level security could not be read. The database connection itself succeeded. It was not marked complete.";
				}
			}
			const detail = `${base} ${rlsDetail} [wc-rls:${marker}]`;
			await saveCheck(sql, id, "verified", detail, mark);
			await audit(sql, session.email, "Test app database", "ok");
			return {
				ok: true,
				state: "verified",
				detail
			};
		}
		if (id === "firebase" || id === "push") {
			const keyInfo = id === "firebase" ? resolveFirebaseApiKey(process.env.FIREBASE_API_KEY, resolved.saved?.FIREBASE_API_KEY) : null;
			const keyNote = keyInfo ? firebaseKeyDiagnostic(keyInfo) : "";
			const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON || "";
			if (id === "push" && !vapidShapeOk(env.FIREBASE_VAPID_KEY?.trim() || "")) {
				const detail = "FIREBASE_VAPID_KEY is not a usable key. Notification permission was not requested.";
				await saveCheck(sql, id, "error", detail, mark);
				return {
					ok: false,
					error: detail,
					state: "error"
				};
			}
			let webNote = "";
			if (id === "firebase") {
				const apiKey = keyInfo?.key || "";
				const projectId = env.FIREBASE_PROJECT_ID?.trim() || "";
				let response;
				try {
					response = await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${encodeURIComponent(apiKey)}`);
				} catch {
					const detail = `${keyNote} Firebase could not be reached. The API key was not shown.`.trim();
					await saveCheck(sql, id, "error", detail, mark);
					return { ok: false, error: detail, state: "error" };
				}
				const body = await response.text();
				const projectNumber = firebaseProjectNumber(env.FIREBASE_APP_ID || "", env.FIREBASE_MESSAGING_SENDER_ID || "");
				const interpreted = interpretFirebaseProject(response.status, body, projectId, [apiKey], env.FIREBASE_AUTH_DOMAIN?.trim() || "", projectNumber);
				const noted = `${keyNote} ${interpreted.detail}`.replace(/\s+/g, " ").trim();
				if (!firebaseKeyAllowsEmailProbe(interpreted.state)) {
					await saveCheck(sql, id, "error", noted, mark);
					return { ok: false, error: noted, state: "error", request: "getProjectConfig" };
				}
				if (interpreted.state === "needs_setup") webNote = noted;
			}
			if (!raw.trim()) {
				const detail = id === "firebase" ? uncheckedEmail(webNote || "The web API key was accepted. A Firebase service account is still required before this can be marked connected. Nothing was switched.") : (webNote || "The web API key was accepted. A Firebase service account is still required before this can be marked connected. Nothing was switched.");
				return { ok: false, error: detail, state: "incomplete" };
			}
			const tokenResult = await googleToken(raw, "https://www.googleapis.com/auth/cloud-platform");
			if (!tokenResult.ok) {
				const error = id === "firebase" ? uncheckedEmail(tokenResult.error) : tokenResult.error;
				await saveCheck(sql, id, "error", error, mark);
				return { ok: false, error, state: "error" };
			}
			let projectNote = "";
			if (id === "firebase") {
				const projectId = env.FIREBASE_PROJECT_ID?.trim() || "";
				let listed;
				try {
					listed = await fetch(`https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}`, { headers: { authorization: `Bearer ${tokenResult.token}` } });
				} catch {
					const detail = uncheckedEmail("The service account was accepted, but the Firebase project could not be reached. Nothing was switched.");
					await saveCheck(sql, id, "error", detail, mark);
					return { ok: false, error: detail, state: "error" };
				}
				const listedBody = await listed.text();
				const safeBody = redactDetail(listedBody).toLowerCase();
				if (listed.status === 200) projectNote = "The Firebase project answered the service account.";
				else if (safeBody.includes("service_disabled") || safeBody.includes("has not been used")) projectNote = "The service account was accepted. The Firebase Management API is not enabled, so project settings were not read.";
				else if (listed.status === 403) {
					const detail = uncheckedEmail("The service account key was accepted, but this account cannot read the Firebase project. Grant Firebase Viewer, then test again. Nothing was switched.");
					await saveCheck(sql, id, "error", detail, mark);
					return { ok: false, error: detail, state: "error" };
				} else if (listed.status === 404) {
					const detail = uncheckedEmail("Google accepted the key, but that Firebase project was not found. Nothing was switched.");
					await saveCheck(sql, id, "error", detail, mark);
					return { ok: false, error: detail, state: "error" };
				} else {
					const detail = uncheckedEmail(`The Firebase project check failed (HTTP ${listed.status}). Nothing was switched.`);
					await saveCheck(sql, id, "error", detail, mark);
					return { ok: false, error: detail, state: "error" };
				}
				const appId = (env.FIREBASE_APP_ID || "").trim();
				const projectHeaders = { authorization: `Bearer ${tokenResult.token}`, "x-goog-user-project": projectId };
				if (appId) {
					let appsResponse = null;
					try {
						appsResponse = await fetch(`https://firebase.googleapis.com/v1beta1/projects/${encodeURIComponent(projectId)}/webApps?pageSize=100`, { headers: projectHeaders });
					} catch {
						projectNote = `${projectNote} The web app list could not be reached. That is not a project-id mismatch.`.trim();
					}
					if (appsResponse) {
						const appsText = await appsResponse.text();
						if (appsResponse.status === 200) {
							let found = false;
							let listed = false;
							try {
								const parsed = JSON.parse(appsText);
								listed = Array.isArray(parsed.apps);
								const list = listed ? parsed.apps : [];
								found = list.some((item) => item && item.appId === appId);
							} catch {
								listed = false;
							}
							if (!listed) projectNote = `${projectNote} The web app list did not include an app array. It was not treated as a project-id mismatch.`.trim();
							else if (found) projectNote = `${projectNote} The web app id belongs to project ${projectId}.`.trim();
							else {
								const detail = uncheckedEmail(`FIREBASE_APP_ID is not one of the web apps in project ${projectId}. This is an app-id check, not a service-account project mismatch. Nothing was switched.`);
								await saveCheck(sql, id, "error", detail, mark);
								return { ok: false, error: detail, state: "error" };
							}
						} else projectNote = `${projectNote} The web app list returned HTTP ${appsResponse.status}. It was not treated as a project-id mismatch.`.trim();
					}
				}
				let emailMarker = "unread";
				let emailNote = "The Email/Password provider could not be reached. That does not mean it is disabled.";
				try {
					const configUrl = `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config`;
					let cfg = await fetch(configUrl, { headers: projectHeaders });
					let text = await cfg.text();
					if (cfg.status === 401 || cfg.status === 403) {
						const retry = await googleToken(raw, "https://www.googleapis.com/auth/identitytoolkit");
						if (retry.ok) {
							cfg = await fetch(configUrl, { headers: { authorization: `Bearer ${retry.token}`, "x-goog-user-project": projectId } });
							text = await cfg.text();
						}
					}
					const email = interpretEmailPassword(cfg.status, text);
					emailMarker = email.marker;
					emailNote = email.detail;
				} catch {
					emailMarker = "network";
					emailNote = "The Email/Password provider could not be reached. That does not mean it is disabled.";
				}
				if (emailMarker !== "enabled" && emailMarker !== "disabled" && emailMarker !== "link") {
					const apiKey = keyInfo?.key || "";
					if (apiKey) {
						try {
							const probe = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify({ email: "wc-provider-check@example.com", password: "not-a-real-password", returnSecureToken: false })
							});
							const probeText = await probe.text();
							const probed = interpretPasswordProbe(probe.status, probeText);
							if (probed.marker === "enabled" || probed.marker === "disabled") {
								emailMarker = probed.marker;
								emailNote = probed.detail;
							} else if (emailMarker === "unread" && probed.marker !== "unread") {
								emailMarker = probed.marker;
								emailNote = probed.detail;
							} else emailNote = `${emailNote} ${probed.detail}`.trim();
						} catch {
							if (emailMarker === "unread") emailMarker = "network";
							emailNote = `${emailNote} The sign-in probe could not reach Firebase. That does not mean the provider is disabled.`.trim();
						}
					}
				}
				const accountParsed = parseServiceAccount(raw);
				projectNote = `[wc-email:${emailMarker}] ${keyNote} ${projectNote} ${firebaseDiag(resolved.saved, env, projectId, accountParsed.ok ? accountParsed.projectId : "")} ${emailNote}`.replace(/\s+/g, " ").trim();
			}
			const detail = id === "push"
				? "Google accepted the service account for push setup. Notification permission was not requested."
				: [webNote, projectNote, "Google accepted the service account. Sign-in in the app was not switched."].filter(Boolean).join(" ");
			await saveCheck(sql, id, "verified", detail, mark);
			await audit(sql, session.email, id === "push" ? "Test push credentials" : "Test Firebase service account", "ok");
			return { ok: true, state: "verified", detail };
		}
		if (id === "r2") {
			const probed = await probeR2Bucket({
				accountId: env.R2_ACCOUNT_ID || "",
				bucket: env.R2_BUCKET || "",
				accessKeyId: env.R2_ACCESS_KEY_ID || "",
				secretAccessKey: env.R2_SECRET_ACCESS_KEY || ""
			});
			const detail = redactDetail(probed.detail);
			if (!probed.ok) {
				await saveCheck(sql, id, "error", detail, mark);
				return {
					ok: false,
					error: detail,
					state: "error"
				};
			}
			await saveCheck(sql, id, "verified", detail, mark);
			await audit(sql, session.email, "Test R2 bucket", "ok");
			return {
				ok: true,
				state: "verified",
				detail
			};
		}
		if (id === "livestream") {
			const provider = (env.LIVESTREAM_PROVIDER || "").trim().toLowerCase();
			if (provider !== "cloudflare-realtimekit") {
				return { ok: false, error: "Select Cloudflare RealtimeKit before testing. The in-app camera is unchanged. No meeting was created.", state: "error" };
			}
			const account = (env.CLOUDFLARE_ACCOUNT_ID || "").trim();
			const appId = (env.CLOUDFLARE_REALTIME_APP_ID || "").trim();
			const gap = realtimeConfigGap(account, appId, env.CLOUDFLARE_REALTIME_API_TOKEN || "");
			if (gap) return { ok: false, error: gap, state: "incomplete" };
			const where = `Token source: ${configSource(resolved.saved, "CLOUDFLARE_REALTIME_API_TOKEN")}. Account id source: ${configSource(resolved.saved, "CLOUDFLARE_ACCOUNT_ID")}. App id source: ${configSource(resolved.saved, "CLOUDFLARE_REALTIME_APP_ID")}.`;
			const headers = { authorization: realtimeAuthorizationHeader(env.CLOUDFLARE_REALTIME_API_TOKEN || "") };
			const root = `${REALTIME_API}/accounts/${encodeURIComponent(account)}/realtime/kit/${encodeURIComponent(appId)}`;
			let status: number | null = null;
			let note = "";
			let code = 0;
			let network = false;
			let presetVerdict: { ok: boolean; detail: string } | null = null;
			try {
				const response = await fetch(`${root}/presets?per_page=100`, { headers, signal: AbortSignal.timeout(8000) });
				const body = await response.json().catch(() => null);
				status = response.status;
				const failure = cloudflareFailure(body);
				note = failure.message;
				code = failure.code;
				if (response.ok && body?.success !== false) {
					const listed = readPresetList(body);
					const presenter = listed.find((item) => item.name === PRESENTER_PRESET);
					const viewer = listed.find((item) => item.name === VIEWER_PRESET);
					if (!presenter || !viewer) {
						presetVerdict = judgeWebinarPresets(
							presenter ? { name: presenter.name, viewType: "", acceptProduction: null, kick: null, audio: "", video: "", screenshare: "" } : null,
							viewer ? { name: viewer.name, viewType: "", acceptProduction: null, kick: null, audio: "", video: "", screenshare: "" } : null,
						);
					} else {
						const readOne = async (presetId: string, name: string) => {
							const detail = await fetch(`${root}/presets/${encodeURIComponent(presetId)}`, { headers, signal: AbortSignal.timeout(8000) });
							const detailBody = await detail.json().catch(() => null);
							if (!detail.ok) {
								const reason = cloudflareFailure(detailBody);
								throw new Error(reason.message || `HTTP ${detail.status}`);
							}
							return readPresetPermission(detailBody, name);
						};
						try {
							const [presenterDetail, viewerDetail] = await Promise.all([
								readOne(presenter.id, presenter.name),
								readOne(viewer.id, viewer.name),
							]);
							presetVerdict = judgeWebinarPresets(presenterDetail, viewerDetail);
						} catch (error) {
							const reason = error instanceof Error ? error.message : "preset details were not read";
							presetVerdict = { ok: false, detail: `RealtimeKit preset permissions could not be read. ${reason}. No meeting was created.` };
						}
					}
				}
			} catch {
				if (status == null) network = true;
			}
			const verdict = classifyRealtimeProbe({ status, note, code, network, presetVerdict });
			const detail = `${verdict.detail} ${where}`.replace(/\s+/g, " ").trim();
			if (!verdict.ok) {
				await saveCheck(sql, id, "error", detail, mark);
				return { ok: false, error: detail, state: "error" };
			}
			await saveCheck(sql, id, "verified", detail, mark);
			await audit(sql, session.email, "Test Cloudflare RealtimeKit", "ok");
			return { ok: true, state: "verified", detail };
		}
		const packageName = env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "";
		const playLead = "Nothing was purchased and no entitlement was granted. Billing was not enabled. Real-time developer notifications are not configured. This repository has no Android billing client.";
		if (!packageName) {
			const detail = `${playLead} GOOGLE_PLAY_PACKAGE_NAME is not set, so Google Play was not called.`;
			await saveCheck(sql, "play", "incomplete", detail, mark, 900);
			return { ok: false, error: detail, state: "incomplete" };
		}
		const tokenResult = await googleToken(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "", "https://www.googleapis.com/auth/androidpublisher");
		if (!tokenResult.ok) {
			const detail = `${playLead} ${tokenResult.error}`.replace(/\s+/g, " ").trim();
			await saveCheck(sql, "play", "error", detail, mark, 900);
			return { ok: false, error: detail, state: "error" };
		}
		let listed;
		try {
			listed = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/inappproducts?maxResults=20`, {
				headers: { authorization: `Bearer ${tokenResult.token}` },
				signal: AbortSignal.timeout(8000)
			});
		} catch {
			const detail = `${playLead} Google Play did not answer the product list before it timed out.`;
			await saveCheck(sql, "play", "error", detail, mark, 900);
			return { ok: false, error: detail, state: "error" };
		}
		const listedText = await listed.text();
		let listedBody = null;
		if (listedText) {
			try { listedBody = JSON.parse(listedText); } catch { listedBody = null; }
		}
		const verdict = classifyPlayCatalog(listed.status, listed.status === 200 ? listedBody : undefined);
		if (!verdict.ok) {
			const detail = `${playLead} ${verdict.detail}`.replace(/\s+/g, " ").trim();
			await saveCheck(sql, "play", "error", detail, mark, 900);
			return { ok: false, error: detail, state: "error" };
		}
		const products = PLAY_CATALOG.map((item) => ({ ...item, id: String(env[item.env] || "").trim() })).filter((item) => item.id);
		const notes = [playLead, verdict.detail];
		if (!products.length) {
			notes.push("No product ids are saved, so product availability was not checked. No id was invented.");
			const detail = notes.join(" ").replace(/\s+/g, " ").trim();
			await saveCheck(sql, "play", "incomplete", detail, mark, 900);
			return { ok: false, error: detail, state: "incomplete" };
		}
		let failed = false;
		for (const product of products) {
			const path = product.kind === "subscription"
				? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/subscriptions/${encodeURIComponent(product.id)}`
				: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/inappproducts/${encodeURIComponent(product.id)}`;
			let status = null;
			try {
				const response = await fetch(path, {
					headers: { authorization: `Bearer ${tokenResult.token}` },
					signal: AbortSignal.timeout(8000)
				});
				status = response.status;
				await response.arrayBuffer().catch(() => void 0);
			} catch {
				status = null;
			}
			const item = classifyPlayProduct(status, product.kind);
			notes.push(`${product.id}: ${item.detail}`);
			if (!item.ok) failed = true;
		}
		const detail = notes.join(" ").replace(/\s+/g, " ").trim();
		if (failed) {
			await saveCheck(sql, "play", "error", detail, mark, 900);
			return { ok: false, error: detail, state: "error" };
		}
		await saveCheck(sql, "play", "verified", detail, mark, 900);
		await audit(sql, session.email, "Test Google Play credentials", "ok");
		return { ok: true, state: "verified", detail };
	} catch (error) {
		const detail = redactDetail(id === "r2" ? explainR2Transport(error) : error instanceof Error ? error.message : "The check failed.");
		try {
			await saveCheck(sql, id, "error", detail || "The check failed.", mark);
		} catch {}
		return {
			ok: false,
			error: detail || "The check failed.",
			state: "error"
		};
	}
}
export async function infraSaveConfig(token, provider, values): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return {
		ok: false,
		error: "Developer session required."
	};
	if (!isConfigProvider(provider)) return {
		ok: false,
		error: "That configuration is not available."
	};
	const sql = await getSql();
	try {
		await ensure(sql);
		const vault = await readVault(sql);
		if (vault.unreadable) return {
			ok: false,
			error: "Saved configuration could not be read. Nothing was overwritten."
		};
		if (vault.locked) return {
			ok: false,
			error: "A server vault key is not set. Set INFRA_VAULT_KEY or BETTER_AUTH_SECRET. Nothing was saved."
		};
		const merged = mergeSavedConfig({
			provider,
			incoming: values,
			saved: vault.fields,
			environment: process.env
		});
		if (!merged.ok) return merged;
		if (!merged.write) return {
			ok: true,
			detail: "Configuration is already saved. Environment values stay on the server and were not copied."
		};
		const written = await writeVault(sql, merged.next, session.email);
		if (!written.ok) return written;
		for (const id of affectedChecks(merged.changed)) await sql`delete from infra_checks where provider = ${id}`;
		const label = provider === "firebase" ? "Firebase" : provider === "r2" ? "R2" : provider === "livestream" ? "Livestream" : provider === "play" ? "Google Play" : "Push";
		await audit(sql, session.email, `Saved ${label} configuration`, "saved");
		return {
			ok: true,
			detail: merged.changed.length ? `Saved ${label} configuration. Secrets stay on the server. Run the connection test before activation.` : `${label} configuration was kept. Environment values were not copied.`
		};
	} catch (error) {
		return {
			ok: false,
			error: redactDetail(error instanceof Error ? error.message : "The configuration was not saved.") || "The configuration was not saved."
		};
	}
}
export async function infraSetFlag(token, id, enable, confirm, phrase): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	if (!FLAG_IDS.includes(id)) return {
		ok: false,
		error: "That setting is not available."
	};
	const sql = await getSql();
	await ensure(sql);
	const env = (await resolvedEnv()).env;
	const assessed = assessInfrastructure(env, await readChecks(sql));
	const decision = decideFlag({
		id,
		enable,
		confirm,
		phrase,
		providers: Object.fromEntries(assessed.providers.map((item) => [item.id, item.state])),
		databaseExternal: assessed.database !== "pglite",
		appEnv: assessed.environment
	});
	if (!decision.ok) return decision;
	await sql`insert into infra_flags (key, enabled, updated_by, updated_at) values (${id}, ${enable}, ${session.email}, now())
    on conflict (key) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`;
	const label = FLAG_LABEL[id];
	await audit(sql, session.email, `${enable ? "Arm" : "Turn off"} ${label}`, enable ? "armed" : "off");
	return {
		ok: true,
		detail: `${label} is now ${enable ? "armed" : "off"}.${id === "mediaMigration" && enable ? " No files were copied." : id === "productionMode" && enable ? " Nothing was published." : " Existing wedding screens were not switched."}`
	};
}
async function memberRole(slug, memberKey) {
	try {
		return (await (await weddingDataSql())`select role from circle_members where slug = ${slug} and member_key = ${memberKey} limit 1`)[0]?.role || "";
	} catch {
		return "";
	}
}
function openPrivateBucket(env, state) {
	const accountId = env.R2_ACCOUNT_ID?.trim() || "";
	const bucket = env.R2_BUCKET?.trim() || "";
	const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() || "";
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() || "";
	if (!accountId || !bucket || !accessKeyId || !secretAccessKey || state !== "ready" && state !== "verified") return {
		ok: false,
		error: "Private media storage is not configured. Nothing was uploaded."
	};
	return {
		ok: true,
		accountId,
		bucket,
		accessKeyId,
		secretAccessKey
	};
}
async function assertStorageRoom(slug, bytes) {
	try {
		const payload = (await (await weddingDataSql())`select payload from circles where slug = ${slug} limit 1`)[0]?.payload;
		const wedding = {
			slug,
			payment: payload && typeof payload === "object" && !Array.isArray(payload) ? payload.payment : void 0
		};
		const usedRows = await (await getSql())`select coalesce(sum(bytes), 0) as used from r2_media where slug = ${slug}`;
		const used = Number(usedRows[0]?.used || 0);
		if (!Number.isFinite(used)) return { ok: true };
		if (overPlanStorage(wedding, used, bytes)) return {
			ok: false,
			error: storageMessage(wedding)
		};
		return { ok: true };
	} catch {
		return { ok: true };
	}
}
async function forgetAbandonedUploads(sql, creds) {
	try {
		const rows = await sql`select upload_id, slug, received, created_at from r2_upload order by created_at asc limit 20`;
		const cutoff = Date.now() - 864e5;
		for (const row of rows) {
			const at = new Date(row.created_at).getTime();
			if (!Number.isFinite(at) || at > cutoff) continue;
			const received = Math.min(400, Math.max(0, Number(row.received) || 0));
			for (let index = 0; index < received; index += 1) await deleteR2Object({
				...creds,
				key: partObjectKey(row.slug, row.upload_id, index)
			});
			await sql`delete from r2_upload where upload_id = ${row.upload_id}`;
		}
	} catch {}
}
export async function infraPrepareUpload(input): Promise<any> {
	const started = Date.now();
	if (!allow(`up:${input.slug}:${createHash("sha256").update(input.memberKey).digest("hex").slice(0, 12)}`)) return {
		ok: false,
		error: "Too many upload requests. Wait a moment and try again."
	};
	const sql = await getSql();
	await ensure(sql);
	const role = await memberRole(input.slug, input.memberKey);
	const decision = authorizeMedia({
		role,
		member: Boolean(role),
		weddingId: input.slug,
		purpose: input.purpose,
		mime: input.mime,
		bytes: input.bytes
	});
	if (!decision.ok) return decision;
	const room = await assertStorageRoom(input.slug, input.bytes);
	if (!room.ok) return room;
	const env = (await resolvedEnv()).env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return bucket;
	await forgetAbandonedUploads(sql, bucket);
	const cors = await ensureR2BrowserCors(bucket);
	if (!cors.ok) {
		console.error("[media-upload] direct unavailable", cors.detail.slice(0, 180));
		console.error("[media-upload] sign", Date.now() - started, "ms", input.bytes, "relay");
		return {
			ok: true,
			mode: "relay"
		};
	}
	const key = mediaObjectKey(input.slug, input.purpose, input.fileName, randomBytes(8).toString("hex"));
	const signed = presignS3({
		method: "PUT",
		accountId: bucket.accountId,
		bucket: bucket.bucket,
		key,
		accessKeyId: bucket.accessKeyId,
		secretAccessKey: bucket.secretAccessKey,
		amzDate: amzDate(),
		expiresSeconds: 600,
		contentType: input.mime
	});
	if (signed.url.includes(bucket.secretAccessKey) || signed.signedHeaders !== "content-type;host") return {
		ok: false,
		error: "The upload link could not be prepared."
	};
	console.error("[media-upload] sign", Date.now() - started, "ms", input.bytes, "direct");
	return {
		ok: true,
		mode: "direct",
		key,
		uploadUrl: signed.url,
		expiresSeconds: 600
	};
}
function sameWeddingObject(objectKey, slug, purpose) {
	return keyBelongsToWedding(objectKey, slug) && objectKey.startsWith(`weddings/${slug}/${purpose}/`);
}
async function recordStoredMedia(sql, input) {
	await sql`insert into r2_media (object_key, slug, purpose, mime, bytes) values (${input.key}, ${input.slug}, ${input.purpose}, ${input.mime}, ${input.bytes})
    on conflict (object_key) do nothing`;
}
export async function infraConfirmUpload(input): Promise<any> {
	if (!sameWeddingObject(input.objectKey, input.slug, input.purpose)) return {
		ok: false,
		error: "That file is not in this wedding."
	};
	if (!allow(`ok:${input.slug}:${createHash("sha256").update(input.memberKey).digest("hex").slice(0, 12)}`)) return {
		ok: false,
		error: "Too many upload requests. Wait a moment and try again."
	};
	const sql = await getSql();
	await ensure(sql);
	const role = await memberRole(input.slug, input.memberKey);
	const decision = authorizeMedia({
		role,
		member: Boolean(role),
		weddingId: input.slug,
		purpose: input.purpose,
		mime: input.mime,
		bytes: input.bytes,
		objectKey: input.objectKey
	});
	if (!decision.ok) return decision;
	const env = (await resolvedEnv()).env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return bucket;
	const head = await headR2Object({
		...bucket,
		key: input.objectKey
	});
	if (!head.ok) return {
		ok: false,
		error: head.detail
	};
	await recordStoredMedia(sql, {
		key: input.objectKey,
		slug: input.slug,
		purpose: input.purpose,
		mime: input.mime,
		bytes: input.bytes
	});
	return {
		ok: true,
		key: input.objectKey
	};
}
function storageCreds(bucket) {
	return {
		accountId: bucket.accountId,
		bucket: bucket.bucket,
		accessKeyId: bucket.accessKeyId,
		secretAccessKey: bucket.secretAccessKey
	};
}
function partObjectKey(slug, uploadId, index) {
	return `weddings/${slug}/.parts/${uploadId}/${index}`;
}
function readEtags(value) {
	try {
		const parsed = JSON.parse(value);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((item) => Number.isInteger(item.n) && typeof item.e === "string");
	} catch {
		return [];
	}
}
async function finishStoredMultipart(sql, creds, key, multipartId, parts, input) {
	const finished = await completeR2Multipart({
		...creds,
		key,
		uploadId: multipartId,
		parts
	});
	if (!finished.ok) {
		if (!(await headR2Object({
			...creds,
			key
		})).ok) return {
			ok: false,
			error: finished.detail
		};
	}
	await recordStoredMedia(sql, {
		key,
		slug: input.slug,
		purpose: input.purpose,
		mime: input.mime,
		bytes: input.totalBytes
	});
	return { ok: true };
}
export async function infraAcceptChunk(input): Promise<any> {
	try {
		console.error("[media-upload] received", input.slug, input.index, input.totalChunks, input.totalBytes);
		const raw = Buffer.from(input.chunk, "base64");
		const count = uploadPieceCount(input.totalBytes);
		if (count < 1 || input.totalChunks !== count || input.index < 0 || input.index >= count) return {
			ok: false,
			error: "That upload piece does not match the file. Nothing was stored."
		};
		if (raw.length !== pieceLength(input.totalBytes, input.index)) return {
			ok: false,
			error: "That upload piece is the wrong size. Nothing was stored."
		};
		if (!allow(`chunk:${input.slug}:${createHash("sha256").update(input.memberKey).digest("hex").slice(0, 12)}`, 800)) return {
			ok: false,
			error: "Too many upload requests. Wait a moment and try again."
		};
		const role = await memberRole(input.slug, input.memberKey);
		const decision = authorizeMedia({
			role,
			member: Boolean(role),
			weddingId: input.slug,
			purpose: input.purpose,
			mime: input.mime,
			bytes: input.totalBytes
		});
		if (!decision.ok) return decision;
		if (input.index === 0) {
			const room = await assertStorageRoom(input.slug, input.totalBytes);
			if (!room.ok) return room;
		}
		const sql = await getSql();
		await ensure(sql);
		const env = (await resolvedEnv()).env;
		const opened = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
		if (!opened.ok) return opened;
		const creds = storageCreds(opened);
		if (count === 1) {
			const key = mediaObjectKey(input.slug, input.purpose, input.fileName, randomBytes(8).toString("hex"));
			const saved = await putR2Object({
				...creds,
				key,
				contentType: input.mime,
				body: raw
			});
			if (!saved.ok) return {
				ok: false,
				error: saved.detail
			};
			await recordStoredMedia(sql, {
				key,
				slug: input.slug,
				purpose: input.purpose,
				mime: input.mime,
				bytes: input.totalBytes
			});
			return {
				ok: true,
				key,
				uploadId: "",
				done: true
			};
		}
		const memberHash = createHash("sha256").update(input.memberKey).digest("hex");
		let uploadId = input.uploadId;
		if (!uploadId) {
			if (input.index !== 0) return {
				ok: false,
				error: "That upload did not start. Nothing was stored."
			};
			uploadId = randomBytes(16).toString("hex");
			const objectKey = mediaObjectKey(input.slug, input.purpose, input.fileName, randomBytes(8).toString("hex"));
			await sql`insert into r2_upload (upload_id, object_key, slug, purpose, mime, member_hash, total_bytes, total_chunks)
        values (${uploadId}, ${objectKey}, ${input.slug}, ${input.purpose}, ${input.mime}, ${memberHash}, ${input.totalBytes}, ${count})`;
		}
		const row = (await sql`select object_key, slug, member_hash, total_bytes, total_chunks, received, flushed, multipart_id, next_part, etags, mime
      from r2_upload where upload_id = ${uploadId} limit 1`)[0];
		if (!row || row.slug !== input.slug || row.member_hash !== memberHash || Number(row.total_bytes) !== input.totalBytes || Number(row.total_chunks) !== count) return {
			ok: false,
			error: "That upload does not belong to this wedding. Nothing was stored."
		};
		row.received = Number(row.received);
		row.flushed = Number(row.flushed);
		row.next_part = Number(row.next_part);
		if ((await sql`select object_key from r2_media where object_key = ${row.object_key} limit 1`)[0]) return {
			ok: true,
			key: row.object_key,
			uploadId,
			done: true
		};
		if (row.flushed === count && row.multipart_id) {
			const finished = await finishStoredMultipart(sql, creds, row.object_key, row.multipart_id, readEtags(row.etags), {
				slug: input.slug,
				purpose: input.purpose,
				mime: row.mime,
				totalBytes: input.totalBytes
			});
			if (!finished.ok) return finished;
			await sql`delete from r2_upload where upload_id = ${uploadId}`;
			return {
				ok: true,
				key: row.object_key,
				uploadId,
				done: true
			};
		}
		if (input.index < row.flushed) return {
			ok: true,
			key: row.object_key,
			uploadId,
			done: false
		};
		if (input.index > row.received) return {
			ok: false,
			error: "An earlier piece of that file has not arrived. Nothing new was stored."
		};
		if (input.index === row.received) {
			const stored = await putR2Object({
				...creds,
				key: partObjectKey(input.slug, uploadId, input.index),
				contentType: "application/octet-stream",
				body: raw
			});
			if (!stored.ok) return {
				ok: false,
				error: stored.detail
			};
			row.received += 1;
			await sql`update r2_upload set received = ${row.received} where upload_id = ${uploadId}`;
		}
		const isLast = row.received === count;
		const pending = isLast ? input.totalBytes - row.flushed * UPLOAD_CHUNK_BYTES : (row.received - row.flushed) * UPLOAD_CHUNK_BYTES;
		const useMultipart = input.totalBytes >= MULTIPART_PART_BYTES;
		if (!isLast && (!useMultipart || pending < 5242880)) return {
			ok: true,
			key: row.object_key,
			uploadId,
			done: false
		};
		const pieces = [];
		for (let index = row.flushed; index < row.received; index += 1) {
			const piece = await getR2Object({
				...creds,
				key: partObjectKey(input.slug, uploadId, index)
			});
			if (!piece.ok) return {
				ok: false,
				error: piece.detail
			};
			pieces.push(piece.bytes);
		}
		const body = Buffer.concat(pieces);
		if (!useMultipart) {
			const saved = await putR2Object({
				...creds,
				key: row.object_key,
				contentType: row.mime,
				body
			});
			if (!saved.ok) return {
				ok: false,
				error: saved.detail
			};
		} else {
			let multipartId = row.multipart_id;
			if (!multipartId) {
				const created = await createR2Multipart({
					...creds,
					key: row.object_key,
					contentType: row.mime
				});
				if (!created.ok) return {
					ok: false,
					error: created.detail
				};
				multipartId = created.uploadId;
				row.multipart_id = multipartId;
			}
			const part = await uploadR2Part({
				...creds,
				key: row.object_key,
				uploadId: multipartId,
				partNumber: row.next_part,
				body
			});
			if (!part.ok) return {
				ok: false,
				error: part.detail
			};
			const etags = [...readEtags(row.etags), {
				n: row.next_part,
				e: part.etag
			}];
			row.next_part += 1;
			row.etags = JSON.stringify(etags);
			await sql`update r2_upload set multipart_id = ${multipartId}, next_part = ${row.next_part}, etags = ${row.etags}, flushed = ${row.received} where upload_id = ${uploadId}`;
			if (!isLast) {
				for (let index = row.flushed; index < row.received; index += 1) await deleteR2Object({
					...creds,
					key: partObjectKey(input.slug, uploadId, index)
				});
				return {
					ok: true,
					key: row.object_key,
					uploadId,
					done: false
				};
			}
			const finished = await finishStoredMultipart(sql, creds, row.object_key, multipartId, etags, {
				slug: input.slug,
				purpose: input.purpose,
				mime: row.mime,
				totalBytes: input.totalBytes
			});
			if (!finished.ok) return finished;
		}
		for (let index = row.flushed; index < row.received; index += 1) await deleteR2Object({
			...creds,
			key: partObjectKey(input.slug, uploadId, index)
		});
		if (useMultipart) {
			await sql`delete from r2_upload where upload_id = ${uploadId}`;
			return {
				ok: true,
				key: row.object_key,
				uploadId,
				done: true
			};
		}
		await recordStoredMedia(sql, {
			key: row.object_key,
			slug: input.slug,
			purpose: input.purpose,
			mime: row.mime,
			bytes: input.totalBytes
		});
		await sql`delete from r2_upload where upload_id = ${uploadId}`;
		return {
			ok: true,
			key: row.object_key,
			uploadId,
			done: true
		};
	} catch (error) {
		const detail = redactDetail(error instanceof Error ? error.message : "The upload could not be saved.");
		console.error("[media-upload]", detail || "The upload could not be saved.");
		return {
			ok: false,
			error: detail || "The upload could not be saved. Nothing else was changed."
		};
	}
}
export async function infraPrepareDownload(input): Promise<any> {
	if (!keyBelongsToWedding(input.objectKey, input.slug)) return {
		ok: false,
		error: "That file is not in this wedding."
	};
	const sql = await getSql();
	await ensure(sql);
	if (!await memberRole(input.slug, input.memberKey)) return {
		ok: false,
		error: "You are not in this wedding."
	};
	let objectKey = input.objectKey;
	if (input.variant === "preview") {
		const thumb = thumbObjectKey(input.objectKey);
		if (thumb ? (await sql`select object_key from r2_media where object_key = ${thumb} and slug = ${input.slug} limit 1`)[0] : void 0) objectKey = thumb;
		else if ((await sql`select mime from r2_media where object_key = ${input.objectKey} and slug = ${input.slug} limit 1`)[0]?.mime?.startsWith("video/")) return {
			ok: true,
			downloadUrl: "",
			expiresSeconds: 0
		};
	}
	const env = (await resolvedEnv()).env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return {
		ok: false,
		error: "Private media storage is not configured. No download link was created."
	};
	const gateway = await usableGateway(sql, env);
	if (gateway) {
		const known = (await sql`select object_key from r2_media where object_key = ${objectKey} and slug = ${input.slug} limit 1`)[0];
		if (!mayIssueViewToken({ member: true, keyOk: keyBelongsToWedding(objectKey, input.slug), recorded: Boolean(known) })) return {
			ok: false,
			error: "That file is not in this wedding."
		};
		const gatewaySecret = (env.MEDIA_GATEWAY_SECRET || "").trim();
		const gatewayToken = await signMediaToken({
			slug: input.slug,
			key: objectKey,
			methods: ["GET", "HEAD"],
			exp: Math.floor(Date.now() / 1000) + MEDIA_TOKEN_TTL_SECONDS,
			disp: "inline",
			name: weddingDownloadName(`r2:${objectKey}`, 1)
		}, gatewaySecret);
		const gatewayUrl = gatewayToken ? mediaGatewayUrl(gateway, objectKey, gatewayToken) : "";
		if (!gatewayUrl || gatewayUrl.includes(gatewaySecret) || gatewayUrl.includes(".r2.dev") || gatewayUrl.includes("cloudflarestorage.com")) return {
			ok: false,
			error: "That file could not be opened."
		};
		return {
			ok: true,
			downloadUrl: gatewayUrl,
			expiresSeconds: MEDIA_TOKEN_TTL_SECONDS
		};
	}
	const signed = presignS3({
		method: "GET",
		accountId: bucket.accountId,
		bucket: bucket.bucket,
		key: objectKey,
		accessKeyId: bucket.accessKeyId,
		secretAccessKey: bucket.secretAccessKey,
		amzDate: amzDate(),
		expiresSeconds: 300
	});
	if (signed.url.includes(bucket.secretAccessKey)) return {
		ok: false,
		error: "The download link could not be prepared."
	};
	const cdn = await usableCdnBase(sql, env);
	if (cdn) {
		const secret = vaultKey();
		if (secret) {
			const token = sealDownloadTicket({
				slug: input.slug,
				member: input.memberKey,
				key: objectKey,
				name: weddingDownloadName(`r2:${objectKey}`, 1),
				mime: "",
				exp: downloadExpiry()
			}, secret);
			return {
				ok: true,
				downloadUrl: `${cdn}/api/infra/view?t=${encodeURIComponent(token)}`,
				expiresSeconds: 300
			};
		}
	}
	return {
		ok: true,
		downloadUrl: signed.url,
		expiresSeconds: 300
	};
}
export async function infraDropUnrecorded(input): Promise<any> {
	if (!keyBelongsToWedding(input.objectKey, input.slug)) return {
		ok: false,
		error: "That file is not in this wedding."
	};
	if (!await memberRole(input.slug, input.memberKey)) return {
		ok: false,
		error: "You are not in this wedding."
	};
	const sql = await getSql();
	await ensure(sql);
	if ((await sql`select object_key from r2_media where object_key = ${input.objectKey} limit 1`)[0]) return { ok: true };
	const env = (await resolvedEnv()).env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return { ok: true };
	await deleteR2Object({
		...bucket,
		key: input.objectKey
	});
	return { ok: true };
}
export async function infraStoreThumb(input): Promise<any> {
	const body = Buffer.from(input.chunk, "base64");
	const thumb = thumbObjectKey(input.objectKey);
	const purpose = input.objectKey.split("/")[2];
	if (!thumb || purpose !== "album" && purpose !== "chat" && purpose !== "profile" && purpose !== "cover") return {
		ok: false,
		error: "That preview is not in this wedding."
	};
	if (body.byteLength !== input.bytes || input.bytes <= 0 || input.bytes > 4e5) return {
		ok: false,
		error: "That preview is empty or too large."
	};
	const role = await memberRole(input.slug, input.memberKey);
	const decision = authorizeMedia({
		role,
		member: Boolean(role),
		weddingId: input.slug,
		purpose,
		mime: input.mime,
		bytes: input.bytes,
		objectKey: thumb
	});
	if (!decision.ok) return decision;
	const sql = await getSql();
	await ensure(sql);
	if (!(await sql`select object_key from r2_media where object_key = ${input.objectKey} and slug = ${input.slug} limit 1`)[0]) return {
		ok: false,
		error: "That photo is not stored yet."
	};
	const room = await assertStorageRoom(input.slug, input.bytes);
	if (!room.ok) return room;
	const env = (await resolvedEnv()).env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return {
		ok: false,
		error: bucket.error
	};
	const saved = await putR2Object({
		...bucket,
		key: thumb,
		contentType: input.mime,
		body
	});
	if (!saved.ok) return {
		ok: false,
		error: saved.detail
	};
	await recordStoredMedia(sql, {
		key: thumb,
		slug: input.slug,
		purpose,
		mime: input.mime,
		bytes: input.bytes
	});
	return {
		ok: true,
		key: thumb
	};
}
async function downloadAllowed(slug, memberKey, objectKey) {
	if (!keyBelongsToWedding(objectKey, slug)) return {
		ok: false,
		status: 403,
		error: "That file is not in this wedding."
	};
	const role = await memberRole(slug, memberKey);
	if (!role) return {
		ok: false,
		status: 403,
		error: "You are not in this wedding."
	};
	let payload = null;
	try {
		payload = (await (await weddingDataSql())`select payload from circles where slug = ${slug} limit 1`)[0]?.payload ?? null;
	} catch {
		payload = null;
	}
	if (!privacyAllowsDownload(payload, role)) return {
		ok: false,
		status: 403,
		error: "Downloads are turned off for this wedding."
	};
	const sql = await getSql();
	await ensure(sql);
	const media = await sql`select mime from r2_media where object_key = ${objectKey} and slug = ${slug} limit 1`;
	if (!media[0]) return {
		ok: false,
		status: 404,
		error: "That file is not in this wedding."
	};
	return {
		ok: true,
		mime: String(media[0].mime || ""),
		sql
	};
}
export async function infraIssueDownload(input): Promise<any> {
	const allowed = await downloadAllowed(input.slug, input.memberKey, input.objectKey);
	if (!allowed.ok) return {
		ok: false,
		error: allowed.error
	};
	const name = safeDownloadName(input.name, input.objectKey);
	const env = (await resolvedEnv()).env;
	const gateway = await usableGateway(allowed.sql, env);
	if (gateway) {
		const gatewaySecret = (env.MEDIA_GATEWAY_SECRET || "").trim();
		const gatewayToken = await signMediaToken({
			slug: input.slug,
			key: input.objectKey,
			methods: ["GET", "HEAD"],
			exp: Math.floor(Date.now() / 1000) + MEDIA_TOKEN_TTL_SECONDS,
			disp: "attachment",
			name
		}, gatewaySecret);
		const gatewayPath = gatewayToken ? mediaGatewayUrl(gateway, input.objectKey, gatewayToken) : "";
		if (!gatewayPath || gatewayPath.includes(gatewaySecret)) return {
			ok: false,
			error: "That file could not be downloaded."
		};
		return {
			ok: true,
			path: gatewayPath,
			name
		};
	}
	const secret = vaultKey();
	if (!secret) return {
		ok: false,
		error: "Downloads are not available yet. Nothing was opened."
	};
	const token = sealDownloadTicket({
		slug: input.slug,
		member: input.memberKey,
		key: input.objectKey,
		name,
		mime: allowed.mime,
		exp: downloadExpiry()
	}, secret);
	const cdn = await usableCdnBase(allowed.sql, env);
	const path = `${cdn || ""}/api/infra/download?t=${encodeURIComponent(token)}`;
	return {
		ok: true,
		path: cdn ? path : `/api/infra/download?t=${encodeURIComponent(token)}`,
		name
	};
}
function safeType(stored, fromStorage, name) {
	const incoming = fromStorage.toLowerCase();
	if (incoming.startsWith("image/") || incoming.startsWith("video/") || incoming.startsWith("audio/")) return incoming.split(";")[0] || incoming;
	return downloadMime(name, stored);
}
export async function infraStreamDownload(token, range, method, origin = ""): Promise<any> {
	const secret = vaultKey();
	const ticket = secret && token.length <= 2e3 ? openDownloadTicket(token, secret) : null;
	if (!ticket) return Response.json({
		ok: false,
		error: "That download expired. Ask for it again."
	}, {
		status: 403,
		headers: { "cache-control": "no-store" }
	});
	const allowed = await downloadAllowed(ticket.slug, ticket.member, ticket.key);
	if (!allowed.ok) return Response.json({
		ok: false,
		error: allowed.error
	}, {
		status: allowed.status,
		headers: { "cache-control": "no-store" }
	});
	return streamTicket(ticket, allowed.mime, range, method, origin, false, allowed.sql);
}
export async function infraStreamView(token, range, method, origin = ""): Promise<any> {
	const secret = vaultKey();
	const ticket = secret && token.length <= 2e3 ? openDownloadTicket(token, secret) : null;
	if (!ticket) return Response.json({
		ok: false,
		error: "That photo could not be opened."
	}, {
		status: 403,
		headers: { "cache-control": "private, no-store" }
	});
	if (!keyBelongsToWedding(ticket.key, ticket.slug)) return Response.json({
		ok: false,
		error: "That file is not in this wedding."
	}, {
		status: 403,
		headers: { "cache-control": "private, no-store" }
	});
	if (!await memberRole(ticket.slug, ticket.member)) return Response.json({
		ok: false,
		error: "You are not in this wedding."
	}, {
		status: 403,
		headers: { "cache-control": "private, no-store" }
	});
	const sql = await getSql();
	await ensure(sql);
	const media = await sql`select mime from r2_media where object_key = ${ticket.key} and slug = ${ticket.slug} limit 1`;
	if (!media[0]) return Response.json({
		ok: false,
		error: "That file is not in this wedding."
	}, {
		status: 404,
		headers: { "cache-control": "private, no-store" }
	});
	return streamTicket(ticket, String(media[0].mime || ""), range, method, origin, true, sql);
}
export async function infraLivePlan(input): Promise<any> {
	const sql = await getSql();
	const role = await memberRole(input.slug, input.memberKey);
	const env = (await resolvedEnv()).env;
	const flags = await readFlags(sql).catch(() => Object.fromEntries(FLAG_IDS.map((id) => [id, false])));
	const live = assessInfrastructure(env, await readChecks(sql).catch(() => ({}))).providers.find((item) => item.id === "livestream");
	const decision = decideLive({
		providerReady: effectiveFlag(flags.livestream, live?.state || "not_configured"),
		action: input.action,
		role,
		member: Boolean(role)
	});
	if (!decision.ok) return decision;
	return {
		ok: true,
		detail: "The wedding member may use Cloudflare RealtimeKit when it is armed. No meeting was created by this check. The in-app camera is separate."
	};
}
async function acknowledgePlayPurchase(packageName, productId, purchaseToken, accessToken, kind) {
	const encodedPackage = encodeURIComponent(packageName);
	const encodedProduct = encodeURIComponent(productId);
	const encodedToken = encodeURIComponent(purchaseToken);
	const path = kind === "subscription"
		? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/purchases/subscriptions/${encodedProduct}/tokens/${encodedToken}:acknowledge`
		: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/purchases/products/${encodedProduct}/tokens/${encodedToken}:acknowledge`;
	try {
		const response = await fetch(path, {
			method: "POST",
			headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
			body: "{}",
			signal: AbortSignal.timeout(8000)
		});
		if (response.status === 200 || response.status === 204) {
			await response.arrayBuffer().catch(() => void 0);
			return { ok: true };
		}
		const text = await response.text().catch(() => "");
		if (response.status === 400 && /already/i.test(text) && /acknowledg/i.test(text)) return { ok: true };
		return { ok: false };
	} catch {
		return { ok: false };
	}
}
export async function infraVerifyPurchase(input): Promise<any> {
	const slot = PLAY_CATALOG.find((item) => item.slot === input.slot);
	if (!slot) return {
		ok: false,
		error: "That product is not in the catalogue. Nothing was unlocked."
	};
	const token = input.purchaseToken.trim();
	if (token.length < 8 || token.length > 500) return {
		ok: false,
		error: "That purchase token was refused. Nothing was unlocked."
	};
	if (!allow(`play:${purchaseTokenHash(token).slice(0, 16)}`, 10)) return {
		ok: false,
		error: "Too many purchase checks. Nothing was unlocked."
	};
	const env = (await resolvedEnv()).env;
	const play = assessInfrastructure(env).providers.find((item) => item.id === "play");
	const productId = env[slot.env]?.trim() || "";
	const sql = await getSql();
	await ensure(sql);
	const flags = await readFlags(sql);
	const checks = await readChecks(sql);
	const shown = assessInfrastructure(env, checks).providers.find((item) => item.id === "play");
	const configured = effectiveFlag(flags.playBilling, shown?.state || play?.state || "not_configured");
	const hash = purchaseTokenHash(token);
	const existingRows = await sql`select state from infra_purchases where token_hash = ${hash} limit 1`;
	const existing = existingRows[0]?.state === "purchased" || existingRows[0]?.state === "refunded" ? { state: existingRows[0].state } : null;
	let api = null;
	let testPurchase = false;
	if (configured && productId) {
		const packageName = (env.GOOGLE_PLAY_PACKAGE_NAME || "").trim();
		const tokenResult = packageName ? await googleToken(env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "", "https://www.googleapis.com/auth/androidpublisher") : { ok: false, error: "Google did not confirm this purchase. Nothing was unlocked." };
		if (!tokenResult.ok) api = { ok: false, error: "Google did not confirm this purchase. Nothing was unlocked." };
		else {
			const encodedPackage = encodeURIComponent(packageName);
			const path = slot.kind === "subscription"
				? `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`
				: `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodedPackage}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}`;
			let response;
			try {
				response = await fetch(path, { headers: { authorization: `Bearer ${tokenResult.token}` }, signal: AbortSignal.timeout(8000) });
			} catch {
				response = null;
			}
			const body = response ? await response.json().catch(() => null) : null;
			if (!response || !response.ok || !body) api = {
				ok: false,
				error: response && response.status === 404
					? "Google did not find that purchase token. Nothing was unlocked."
					: response && response.status === 401
						? "Google Play refused the service account. Nothing was unlocked."
						: response && response.status === 403
							? "The service account does not have permission to read this purchase. Nothing was unlocked."
							: "Google did not confirm this purchase. Nothing was unlocked."
			};
			else if (slot.kind === "subscription") {
				const read = interpretPlaySubscription(body, productId, Date.now());
				if (!read.ok) api = { ok: false, error: read.error };
				else if (read.outcome === "hold") api = { ok: false, error: read.detail };
				else if (read.outcome === "grant" && read.acknowledgement !== "acknowledged") {
					testPurchase = read.testPurchase;
					const acked = await acknowledgePlayPurchase(packageName, productId, token, tokenResult.token, "subscription");
					api = acked.ok
						? { ok: true, purchaseState: 0, productId: read.productId }
						: { ok: false, error: "Google confirmed the purchase, but acknowledgement failed. Nothing was unlocked." };
				} else {
					testPurchase = read.testPurchase;
					api = { ok: true, purchaseState: read.outcome === "grant" ? 0 : 1, productId: read.productId };
				}
			} else {
				const read = interpretPlayProduct(body, productId);
				if (!read.ok) api = { ok: false, error: read.error };
				else if (read.purchaseState === 2) api = { ok: false, error: "Google has not finished this purchase. Nothing was unlocked and nothing was revoked." };
				else if (read.purchaseState === 0 && read.acknowledgement !== "acknowledged") {
					testPurchase = read.testPurchase;
					const acked = await acknowledgePlayPurchase(packageName, productId, token, tokenResult.token, "product");
					api = acked.ok
						? { ok: true, purchaseState: 0, productId: read.productId }
						: { ok: false, error: "Google confirmed the purchase, but acknowledgement failed. Nothing was unlocked." };
				} else {
					testPurchase = read.testPurchase;
					api = { ok: true, purchaseState: read.purchaseState, productId: read.productId };
				}
			}
		}
	}
	const decision = decidePurchase({
		configured,
		productMapped: Boolean(productId),
		api,
		existing,
		expectedProductId: productId
	});
	if (decision.ok) {
		await sql`insert into infra_purchases (token_hash, product_slot, state, updated_at) values (${hash}, ${slot.slot}, ${"purchased"}, now())
      on conflict (token_hash) do update set state = excluded.state, updated_at = now()`;
		return {
			ok: true,
			slot: slot.slot,
			detail: testPurchase
				? "Google confirmed this license-test purchase once. Premium screens were not granted. The current theme and storage screens were not changed by this record."
				: "Google confirmed this purchase once. The current theme and storage screens were not changed by this record."
		};
	}
	if ("revoke" in decision && decision.revoke) await sql`insert into infra_purchases (token_hash, product_slot, state, updated_at) values (${hash}, ${slot.slot}, ${"refunded"}, now())
      on conflict (token_hash) do update set state = excluded.state, updated_at = now()`;
	return {
		ok: false,
		error: decision.error
	};
}
function rememberOrigin(headers, origin) {
	if (!origin.startsWith("https://") || origin.includes("\n") || origin.includes("\r")) return;
	headers.set("access-control-allow-origin", origin);
	headers.set("vary", "origin");
}
async function usableCdnBase(sql, env) {
	const enabled = (env.CDN_ENABLED || "").trim() === "yes";
	const domain = (env.CDN_MEDIA_DOMAIN || "").trim().toLowerCase();
	const base = (env.CDN_BASE_URL || "").trim().replace(/\/+$/, "");
	const cache = env.CDN_CACHE_POLICY === "no-store" ? "no-store" : env.CDN_CACHE_POLICY === "authorized" ? "authorized" : "private";
	if (!enabled || !domain || base !== `https://${domain}`) return "";
	const row = (await sql`select state, fingerprint from infra_checks where provider = ${"cdn"} limit 1`)[0];
	if (!row || row.state !== "verified" || row.fingerprint !== cdnMark({
		enabled: true,
		domain,
		base,
		cache,
		zoneId: (env.CDN_ZONE_ID || env.CLOUDFLARE_ZONE_ID || "").trim().toLowerCase(),
		token: bareCloudflareToken(env.CDN_API_TOKEN || "")
	})) return "";
	return base;
}
async function streamTicket(ticket, storedMime, range, method, origin, inline, sql) {
	const env = (await resolvedEnv()).env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return Response.json({
		ok: false,
		error: "Private media storage is not configured. Nothing was downloaded."
	}, {
		status: 503,
		headers: { "cache-control": "private, no-store" }
	});
	const opened = await openR2Read({
		...bucket,
		key: ticket.key,
		range,
		method: method === "HEAD" ? "HEAD" : "GET"
	});
	if (!opened.ok || method !== "HEAD" && !opened.body) return Response.json({
		ok: false,
		error: opened.ok ? "That file could not be opened." : opened.detail
	}, {
		status: 502,
		headers: { "cache-control": "private, no-store" }
	});
	const name = safeDownloadName(ticket.name, ticket.key);
	const cache = inline && env.CDN_CACHE_POLICY !== "no-store" ? "private, max-age=60" : "private, no-store";
	const headers = new Headers({
		"content-type": safeType(ticket.mime || storedMime, opened.contentType, name),
		"content-disposition": contentDisposition(name, inline),
		"cache-control": cache,
		"referrer-policy": "no-referrer",
		"x-content-type-options": "nosniff",
		"accept-ranges": "bytes"
	});
	rememberOrigin(headers, origin);
	if (opened.contentLength) headers.set("content-length", opened.contentLength);
	if (opened.contentRange) headers.set("content-range", opened.contentRange);
	return new Response(method === "HEAD" ? null : opened.body, {
		status: opened.status,
		headers
	});
}
async function saveCdnCheck(sql, state, detail, mark) {
	await sql`insert into infra_checks (provider, state, detail, fingerprint, checked_at) values (${"cdn"}, ${state}, ${detail.slice(0, 1200)}, ${mark}, now())
    on conflict (provider) do update set state = excluded.state, detail = excluded.detail, fingerprint = excluded.fingerprint, checked_at = now()`;
}
function cdnFromEnv(env) {
	const token = bareCloudflareToken(env.CDN_API_TOKEN || "");
	const zoneId = (env.CDN_ZONE_ID || env.CLOUDFLARE_ZONE_ID || "").trim().toLowerCase();
	return {
		enabled: (env.CDN_ENABLED || "").trim() === "yes",
		domain: (env.CDN_MEDIA_DOMAIN || "").trim().toLowerCase(),
		base: (env.CDN_BASE_URL || "").trim().replace(/\/+$/, ""),
		cache: env.CDN_CACHE_POLICY === "no-store" ? "no-store" : env.CDN_CACHE_POLICY === "authorized" ? "authorized" : "private",
		token,
		zoneId
	};
}
export async function infraCdnBoard(token): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	const sql = await getSql();
	await ensure(sql);
	const env = (await resolvedEnv()).env;
	const r2 = assessInfrastructure(env, await readChecks(sql)).providers.find((item) => item.id === "r2");
	const saved = cdnFromEnv(env);
	const row = (await sql`select state, detail, fingerprint, checked_at from infra_checks where provider = ${"cdn"} limit 1`)[0];
	const mark = cdnMark(saved);
	const matched = row && row.fingerprint === mark ? row : null;
	return {
		ok: true,
		enabled: saved.enabled,
		domain: saved.domain,
		base: saved.base,
		cache: saved.cache,
		privateAccess: true,
		accountId: env.R2_ACCOUNT_ID?.trim() || env.CLOUDFLARE_ACCOUNT_ID?.trim() || "",
		bucket: env.R2_BUCKET?.trim() || "",
		r2State: r2?.state || "not_configured",
		zoneId: saved.zoneId,
		tokenPresent: Boolean(saved.token),
		status: matched ? matched.state : saved.enabled ? "incomplete" : "disabled",
		detail: matched ? displayText(matched.detail) : saved.enabled ? "CDN has not been tested for this configuration." : "CDN delivery is off. Private storage is unchanged.",
		requirement: !saved.enabled || matched?.state === "verified" ? "" : "Run the CDN test. A domain that merely answers HTTP 200 is not accepted.",
		testedAt: matched ? displayText(matched.checked_at) : ""
	};
}
export async function infraCdnSave(token, input): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	const cleaned = cleanCdnInput({
		enabled: input.enabled === true,
		domain: String(input.domain || ""),
		base: String(input.base || ""),
		cache: String(input.cache || ""),
		token: String(input.apiToken || ""),
		zoneId: String(input.zoneId || "")
	});
	if (!cleaned.ok) return cleaned;
	const sql = await getSql();
	await ensure(sql);
	const vault = await readVault(sql);
	if (vault.unreadable) return {
		ok: false,
		error: "Saved configuration could not be read. Nothing was overwritten."
	};
	if (vault.locked) return {
		ok: false,
		error: "A server vault key is not set. Set INFRA_VAULT_KEY or BETTER_AUTH_SECRET. Nothing was saved."
	};
	const next = { ...vault.fields };
	next.CDN_ENABLED = cleaned.enabled ? "yes" : "no";
	next.CDN_MEDIA_DOMAIN = cleaned.domain;
	next.CDN_BASE_URL = cleaned.base;
	next.CDN_CACHE_POLICY = cleaned.cache;
	if (cleaned.token) next.CDN_API_TOKEN = cleaned.token;
	if (cleaned.zoneId) next.CDN_ZONE_ID = cleaned.zoneId;
	else delete next.CDN_ZONE_ID;
	delete next.CDN_PUBLIC;
	const written = await writeVault(sql, next, session.email);
	if (!written.ok) return written;
	await sql`delete from infra_checks where provider = ${"cdn"}`;
	await audit(sql, session.email, "Saved CDN configuration", cleaned.enabled ? "enabled" : "disabled");
	return {
		ok: true,
		detail: cleaned.enabled ? "CDN settings were saved. Run the connection test before delivery changes. The R2 bucket was not made public." : "CDN delivery is off. Existing private storage was not changed."
	};
}
export async function infraCdnTest(token): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	let stage = "read configuration";
	try {
		const sql = await getSql();
		await ensure(sql);
		const resolved = await resolvedEnv();
		if (resolved.unreadable) return { ok: false, error: "Saved configuration could not be read, so the CDN test was not run." };
		const env = resolved.env;
		const saved = cdnFromEnv(env);
		const mark = cdnMark(saved);
		const tokenSource = String(resolved.saved?.CDN_API_TOKEN || "").trim() ? "saved configuration" : saved.token ? "server environment" : "not saved";
		if (!saved.domain) {
			const detail = saved.enabled
				? "A media domain is not saved. Cloudflare was not called, and delivery was not turned on."
				: "CDN delivery is off. A media domain is not saved, so Cloudflare was not called.";
			const verdict = {
				usable: false,
				state: saved.enabled ? "not_configured" : "disabled",
				detail,
				requirement: "Enter the host name, such as media.theweddingcircle.in. A zone id is not required unless the token can read one zone but cannot list zones."
			};
			await saveCdnCheck(sql, verdict.state, verdict.detail, mark);
			return { ok: true, ...verdict, testedAt: (new Date()).toISOString() };
		}
		let dnsOk = false;
		let dnsTimedOut = false;
		let anonymousStatus = null;
		let authedStatus = null;
		let authedPrivate = false;
		if (saved.enabled) {
			stage = "dns";
			const looked = await lookupHost(saved.domain);
			dnsOk = looked === true;
			dnsTimedOut = looked === "timeout";
			if (dnsOk) {
				stage = "private media probe";
				try {
					const anonymous = await fetch(`${saved.base}/api/infra/cdn-probe`, { redirect: "manual", signal: AbortSignal.timeout(8000) });
					anonymousStatus = anonymous.status;
					await anonymous.arrayBuffer().catch(() => void 0);
				} catch {
					anonymousStatus = null;
				}
				if (anonymousStatus === 401 || anonymousStatus === 403) {
					const secret = vaultKey();
					try {
						const authed = await fetch(`${saved.base}/api/infra/cdn-probe`, {
							redirect: "manual",
							signal: AbortSignal.timeout(8000),
							headers: secret ? { "x-wc-cdn-probe": cdnProbeToken(secret) } : {}
						});
						authedStatus = authed.status;
						const cache = (authed.headers.get("cache-control") || "").toLowerCase();
						authedPrivate = authed.headers.get("x-wc-private") === "1" && cache.includes("private") && !cache.includes("public");
						await authed.arrayBuffer().catch(() => void 0);
					} catch {
						authedStatus = null;
					}
				}
			}
		}
		const blankLook = () => ({ status: null, cacheControl: "", cf: "", worker: "" });
		const readCacheLook = async (url) => {
			try {
				const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
				const look = {
					status: response.status,
					cacheControl: (response.headers.get("cache-control") || "").slice(0, 120),
					cf: (response.headers.get("cf-cache-status") || "").slice(0, 40),
					worker: (response.headers.get("x-wc-cache") || "").slice(0, 40)
				};
				await response.arrayBuffer().catch(() => void 0);
				return look;
			} catch {
				return blankLook();
			}
		};
		let anonymousLook = blankLook();
		let signedFirst = null;
		let signedSecond = null;
		let signedPrepared = false;
		const gatewaySecret = String(env.MEDIA_GATEWAY_SECRET || "").trim();
		const secretPresent = gatewaySecretOk(gatewaySecret);
		const baseSafe = saved.base.startsWith("https://") && !saved.base.includes("r2.dev") && !saved.base.includes("cloudflarestorage.com");
		if (saved.domain && baseSafe) {
			const probePath = GATEWAY_PROBE_KEY.split("/").map((part) => encodeURIComponent(part)).join("/");
			anonymousLook = await readCacheLook(`${saved.base}/v1/${probePath}`);
			if (secretPresent) {
				const probeToken = await signMediaToken({
					slug: "gateway-probe",
					key: GATEWAY_PROBE_KEY,
					methods: ["GET", "HEAD"],
					exp: Math.floor(Date.now() / 1000) + MEDIA_TOKEN_TTL_SECONDS,
					disp: "inline",
					name: "probe.jpg"
				}, gatewaySecret);
				signedPrepared = Boolean(probeToken);
				if (probeToken) {
					const signedUrl = `${saved.base}/v1/${probePath}?t=${encodeURIComponent(probeToken)}`;
					signedFirst = await readCacheLook(signedUrl);
					signedSecond = await readCacheLook(signedUrl);
				}
			}
		}
		const cacheReport = describeCdnCache({
			policy: saved.cache === "no-store" || saved.cache === "authorized" ? saved.cache : "private",
			anonymous: anonymousLook,
			signedFirst,
			signedSecond,
			signedPrepared,
			secretPresent
		});
		const secret = vaultKey();
		let probe = judgeCdnProbe({
			enabled: saved.enabled,
			domain: saved.domain,
			dnsOk,
			anonymousStatus,
			authedStatus,
			authedPrivate,
			probeSigned: Boolean(secret)
		});
		if (dnsTimedOut) {
			probe = {
				usable: false,
				state: "error",
				detail: "The media host lookup timed out. CDN delivery was not turned on.",
				requirement: "DNS was not changed, and the R2 bucket was not made public."
			};
		}
		stage = "cloudflare api";
		const zone = saved.token ? await cdnZoneCheck(saved) : { checked: false, ok: false, kind: "missing", detail: "" };
		let verdict = combineCdnStatus(probe, zone.checked ? zone : null);
		if (!saved.token) {
			verdict = {
				...verdict,
				detail: `${verdict.detail} ${cacheReport.summary} No Cloudflare API token is saved, so credentials were not sent.`.replace(/\s+/g, " ").trim()
			};
		} else {
			verdict = { ...verdict, detail: `${verdict.detail} ${cacheReport.summary} Token source: ${tokenSource}.`.replace(/\s+/g, " ").trim() };
		}
		await saveCdnCheck(sql, verdict.state, verdict.requirement ? `${verdict.detail} ${verdict.requirement}` : verdict.detail, mark);
		await audit(sql, session.email, "Test CDN", verdict.usable ? "verified" : verdict.state);
		return { ok: true, ...verdict, kind: zone.kind || "", testedAt: (new Date()).toISOString() };
	} catch {
		return { ok: false, error: `The CDN test stopped during ${stage}. DNS and the R2 bucket were not changed.` };
	}
}
async function lookupHost(host) {
	let timer;
	try {
		await Promise.race([
			lookup(host),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" })), 8000);
			})
		]);
		return true;
	} catch (error) {
		return error && error.code === "TIMEOUT" ? "timeout" : false;
	} finally {
		clearTimeout(timer);
	}
}
async function cdnZoneCheck(saved) {
	if (!saved.token) return { checked: false, ok: false, kind: "missing", detail: "" };
	const headers = { authorization: `Bearer ${saved.token}` };
	const names = saved.zoneId ? [] : saved.domain.split(".").map((_, index, parts) => parts.slice(index).join(".")).filter((name) => name.includes("."));
	const targets = saved.zoneId ? [`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(saved.zoneId)}`] : names.map((name) => `https://api.cloudflare.com/client/v4/zones?name=${encodeURIComponent(name)}&per_page=5`);
	let last = { checked: true, ok: false, kind: "zone_not_managed", detail: "The API token is saved, but Cloudflare did not show a zone for this domain. A zone id is not required for that result. DNS was not changed." };
	for (const url of targets) {
		let response;
		try {
			response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
		} catch (error) {
			const timedOut = error && (error.name === "TimeoutError" || error.name === "AbortError");
			return { checked: true, ok: false, kind: "network", detail: timedOut ? "Cloudflare did not answer the zone check before it timed out. DNS was not changed." : "Cloudflare could not be reached for the zone check. DNS was not changed." };
		}
		const body = await response.json().catch(() => null);
		const note = cloudflareNote(body);
		const code = cloudflareCode(body);
		if (!saved.zoneId && response.ok && body?.success === true) {
			const zones = Array.isArray(body.result) ? body.result : [];
			const zone = zones.find((item) => item && typeof item.name === "string" && (saved.domain === String(item.name).toLowerCase() || saved.domain.endsWith(`.${String(item.name).toLowerCase()}`)));
			if (!zone) {
				last = { checked: true, ...judgeZoneCheck({ status: response.status, success: true, zoneName: "", domain: saved.domain, note: "", code, emptyList: true, listed: true }) };
				continue;
			}
			return { checked: true, ...judgeZoneCheck({ status: response.status, success: true, zoneName: zone.name, domain: saved.domain, note: "", code, listed: true }) };
		}
		const zoneName = !Array.isArray(body?.result) && typeof body?.result?.name === "string" ? body.result.name : "";
		const judged = judgeZoneCheck({ status: response.status, success: body?.success === true, zoneName, domain: saved.domain, note, code, listed: !saved.zoneId });
		if (!judged.ok) return { checked: true, ...judged };
		return { checked: true, ...judged };
	}
	return last;
}
export function cdnProbeResponse(token: string): Response {
	const secret = vaultKey();
	if (!secret || !cdnProbeMatches(secret, token)) return new Response(null, {
		status: 401,
		headers: {
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff"
		}
	});
	return new Response(null, {
		status: 204,
		headers: {
			"cache-control": "private, no-store",
			"x-wc-private": "1",
			"x-content-type-options": "nosniff"
		}
	});
}

async function usableGateway(sql, env) {
	const enabled = String(env.MEDIA_GATEWAY_ENABLED || "").trim() === "yes";
	const origin = normalizeGatewayOrigin(String(env.MEDIA_GATEWAY_ORIGIN || ""));
	const secret = String(env.MEDIA_GATEWAY_SECRET || "").trim();
	if (!enabled || !origin || !gatewaySecretOk(secret)) return "";
	const rows = await sql`select state, fingerprint from infra_checks where provider = ${"media_gateway"} limit 1`;
	const row = rows[0];
	const mark = await gatewayMark(origin, secret);
	if (!row || row.state !== "verified" || row.fingerprint !== mark) return "";
	return origin;
}

async function saveGatewayCheck(sql, state, detail, mark, diag) {
	const payload = JSON.stringify(diag || {});
	await sql`insert into infra_checks (provider, state, detail, fingerprint, checked_at, diag) values (${"media_gateway"}, ${state}, ${String(detail).slice(0, 500)}, ${mark}, now(), ${payload})
		on conflict (provider) do update set state = excluded.state, detail = excluded.detail, fingerprint = excluded.fingerprint, checked_at = now(), diag = excluded.diag`;
}

function gatewayDiag(value) {
	const empty = { stage: "", summary: "", checks: [], lastSuccessAt: "", lastFailureAt: "" };
	if (typeof value !== "string" || !value) return empty;
	try {
		const parsed = JSON.parse(value);
		const checks = Array.isArray(parsed.checks) ? parsed.checks.filter((item) => item && typeof item.id === "string" && typeof item.label === "string" && typeof item.result === "string").slice(0, 16).map((item) => ({
			id: String(item.id).slice(0, 40),
			label: String(item.label).slice(0, 80),
			result: String(item.result).slice(0, 20),
			detail: displayText(item.detail).replace(/[?&]t=[^&\s]+/gi, "").replace(/bearer\s+\S+/gi, "Bearer").slice(0, 240)
		})) : [];
		return {
			stage: displayText(parsed.stage).slice(0, 40),
			summary: displayText(parsed.summary).slice(0, 400),
			checks,
			lastSuccessAt: displayText(parsed.lastSuccessAt).slice(0, 40),
			lastFailureAt: displayText(parsed.lastFailureAt).slice(0, 40)
		};
	} catch {
		return empty;
	}
}

function gatewayTimestamps(previous, report) {
	const now = new Date().toISOString();
	const failed = report.stage !== "verified" && report.stage !== "disabled" && report.stage !== "not_tested";
	return {
		stage: report.stage,
		summary: report.summary,
		checks: report.checks,
		lastSuccessAt: report.verdict.usable ? now : previous.lastSuccessAt || "",
		lastFailureAt: failed ? now : previous.lastFailureAt || ""
	};
}

const GATEWAY_APP_ORIGIN = "https://theweddingcircle.in";

function gatewayTransport(error) {
	const code = error && (error.code || error.cause && error.cause.code) || "";
	const name = error && (error.name || error.cause && error.cause.name) || "";
	const classified = classifyGatewayTransport({ name: String(name), code: String(code) });
	return classified.stage === "dns" || classified.stage === "tls" || classified.stage === "timeout" ? classified.stage : "unreachable";
}

async function gatewayLookup(origin) {
	const host = new URL(origin).hostname;
	let timer;
	try {
		await Promise.race([
			lookup(host),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "TIMEOUT", name: "TimeoutError" })), 8000);
			})
		]);
		return "ok";
	} catch (error) {
		return error && error.code === "TIMEOUT" ? "timeout" : gatewayTransport(error);
	} finally {
		clearTimeout(timer);
	}
}

async function gatewayFetch(url, method = "GET", headers = {}) {
	try {
		const response = await fetch(url, {
			method,
			redirect: "manual",
			signal: AbortSignal.timeout(8000),
			headers: { origin: GATEWAY_APP_ORIGIN, ...headers }
		});
		const location = response.headers.get("location") || "";
		let safeLocation = "";
		if (location) {
			try {
				const parsed = new URL(location, url);
				parsed.search = "";
				parsed.hash = "";
				safeLocation = `${parsed.origin}${parsed.pathname}`;
			} catch {
				safeLocation = "";
			}
		}
		let code = "";
		const bytes = await response.arrayBuffer().catch(() => undefined);
		if (bytes && bytes.byteLength > 0 && bytes.byteLength < 600) {
			try {
				const parsed = JSON.parse(new TextDecoder().decode(bytes));
				const value = parsed && typeof parsed.code === "string" ? parsed.code : "";
				if (value === "signature" || value === "expired" || value === "path" || value === "method") code = value;
			} catch {
				code = "";
			}
		}
		return {
			transport: "ok",
			status: response.status,
			type: response.headers.get("content-type") || "",
			cache: response.headers.get("cache-control") || "",
			location: safeLocation,
			allow: response.headers.get("access-control-allow-origin") || "",
			edge: response.headers.get("cf-cache-status") || response.headers.get("x-wc-cache") || "",
			code
		};
	} catch (error) {
		return { transport: gatewayTransport(error), status: null, type: "", cache: "", location: "", allow: "", edge: "", code: "" };
	}
}

export async function infraGatewayBoard(token: string): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	const sql = await getSql();
	await ensure(sql);
	const env = (await resolvedEnv()).env;
	const enabled = String(env.MEDIA_GATEWAY_ENABLED || "").trim() === "yes";
	const rawOrigin = String(env.MEDIA_GATEWAY_ORIGIN || "").trim();
	const origin = normalizeGatewayOrigin(rawOrigin);
	const secret = String(env.MEDIA_GATEWAY_SECRET || "").trim();
	const secretPresent = gatewaySecretOk(secret);
	const mark = origin && secretPresent ? await gatewayMark(origin, secret) : `no|${origin || ""}`;
	const rows = await sql`select state, detail, fingerprint, checked_at, diag from infra_checks where provider = ${"media_gateway"} limit 1`;
	const row = rows[0];
	const matched = row && mark && row.fingerprint === mark ? row : null;
	const stored = gatewayDiag(row?.diag);
	const preview = buildGatewayReport({
		enabled,
		origin: origin || rawOrigin,
		originValid: Boolean(origin),
		secretPresent,
		transport: "skipped",
		anonymousStatus: null,
		anonymousType: "",
		anonymousCache: "",
		anonymousLocation: "",
		originAllowed: null,
		badStatus: null,
		signedStatus: null,
		signedType: "",
		signedCache: "",
		signedLocation: "",
		signedPrepared: false
	});
	const checks = matched && stored.checks.length ? stored.checks : preview.checks;
	const stage = matched && stored.stage ? stored.stage : preview.stage;
	const summary = matched ? stored.summary || displayText(matched.detail) || preview.summary : preview.summary;
	return {
		ok: true,
		enabled,
		origin,
		originSaved: Boolean(origin),
		secretPresent,
		privateBucket: true,
		status: !enabled ? "disabled" : matched ? matched.state : "incomplete",
		detail: summary,
		requirement: !enabled || matched?.state === "verified" || matched ? "" : preview.verdict.requirement || "Run the gateway test after the host points at the Worker, not at public R2.",
		testedAt: matched ? displayText(matched.checked_at) : "",
		stage,
		checks,
		lastSuccessAt: stored.lastSuccessAt,
		lastFailureAt: stored.lastFailureAt
	};
}

export async function infraGatewaySave(token: string, input): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	const cleaned = cleanGatewayInput({ enabled: input.enabled === true, origin: String(input.origin || "") });
	if (!cleaned.ok) return cleaned;
	const sql = await getSql();
	await ensure(sql);
	const vault = await readVault(sql);
	if (vault.unreadable) return { ok: false, error: "Saved configuration could not be read. Nothing was overwritten." };
	if (vault.locked) return { ok: false, error: "A server vault key is not set. Set INFRA_VAULT_KEY or BETTER_AUTH_SECRET. Nothing was saved." };
	const typed = String(input.secret || "").trim();
	const previous = String(vault.fields.MEDIA_GATEWAY_SECRET || "").trim();
	const secret = typed || previous;
	if (typed && !gatewaySecretOk(typed)) return { ok: false, error: "That gateway secret was refused. Nothing was saved." };
	if (cleaned.enabled && !gatewaySecretOk(secret)) return { ok: false, error: "A gateway secret of at least 32 characters is required. Nothing was saved, and the bucket was not made public." };
	const next = { ...vault.fields };
	next.MEDIA_GATEWAY_ENABLED = cleaned.enabled ? "yes" : "no";
	next.MEDIA_GATEWAY_ORIGIN = cleaned.origin;
	if (secret) next.MEDIA_GATEWAY_SECRET = secret;
	else delete next.MEDIA_GATEWAY_SECRET;
	const written = await writeVault(sql, next, session.email);
	if (!written.ok) return written;
	await sql`delete from infra_checks where provider = ${"media_gateway"}`;
	await audit(sql, session.email, "Saved media gateway", cleaned.enabled ? "enabled" : "disabled");
	return { ok: true, detail: cleaned.enabled ? "Gateway settings were saved. Run the test before photos move to the Worker. The R2 bucket was not made public." : "The media gateway is off. Existing private storage was not changed." };
}

export async function infraGatewayTest(token: string): Promise<any> {
	const session = await requireDeveloper(token);
	if (!session.ok) return session;
	const sql = await getSql();
	await ensure(sql);
	const env = (await resolvedEnv()).env;
	const enabled = String(env.MEDIA_GATEWAY_ENABLED || "").trim() === "yes";
	const rawOrigin = String(env.MEDIA_GATEWAY_ORIGIN || "").trim();
	const origin = normalizeGatewayOrigin(rawOrigin);
	const secret = String(env.MEDIA_GATEWAY_SECRET || "").trim();
	const secretPresent = gatewaySecretOk(secret);
	const mark = origin && secretPresent ? await gatewayMark(origin, secret) : `no|${origin}`;
	const previous = gatewayDiag((await sql`select diag from infra_checks where provider = ${"media_gateway"} limit 1`)[0]?.diag);
	const emptyProbe = {
		anonymousStatus: null,
		anonymousType: "",
		anonymousCache: "",
		anonymousLocation: "",
		originAllowed: null,
		badStatus: null,
		signedStatus: null,
		signedType: "",
		signedCache: "",
		signedLocation: "",
		signedPrepared: false
	};
	let transport = origin ? "ok" : "skipped";
	let anonymous = { status: null, type: "", cache: "", location: "", allow: "" };
	let badStatus = null;
	let signed = { status: null, type: "", cache: "", location: "", code: "" };
	let signedPrepared = false;
	let headStatus = undefined;
	let postStatus = undefined;
	let expiredStatus = undefined;
	let modifiedStatus = undefined;
	let signedHeadStatus = undefined;
	if (transport === "ok") {
		transport = await gatewayLookup(origin);
		if (transport === "ok") {
			const probePath = GATEWAY_PROBE_KEY.split("/").map((part) => encodeURIComponent(part)).join("/");
			const target = `${origin}/v1/${probePath}`;
			const otherKey = "weddings/gateway-probe/album/probe02-other.jpg";
			const otherPath = otherKey.split("/").map((part) => encodeURIComponent(part)).join("/");
			const [first, head, posted] = await Promise.all([
				gatewayFetch(target, "GET"),
				gatewayFetch(target, "HEAD"),
				gatewayFetch(target, "POST")
			]);
			headStatus = head.transport === "ok" ? head.status : null;
			postStatus = posted.transport === "ok" ? posted.status : null;
			if (first.transport !== "ok") transport = first.transport;
			else {
				anonymous = first;
				if (first.status !== 503) {
					const bad = await gatewayFetch(`${target}?t=v1.bad.signature`, "GET");
					badStatus = bad.transport === "ok" ? bad.status : null;
					if (secretPresent) {
						const now = Math.floor(Date.now() / 1000);
						const probeToken = await signMediaToken({
							slug: "gateway-probe",
							key: GATEWAY_PROBE_KEY,
							methods: ["GET", "HEAD"],
							exp: now + MEDIA_TOKEN_TTL_SECONDS,
							disp: "inline",
							name: "WeddingCircle_Photo_001.jpg"
						}, secret);
						const expiredToken = await signMediaToken({
							slug: "gateway-probe",
							key: GATEWAY_PROBE_KEY,
							methods: ["GET", "HEAD"],
							exp: now - 60,
							disp: "inline",
							name: "WeddingCircle_Photo_001.jpg"
						}, secret);
						signedPrepared = Boolean(probeToken);
						expiredStatus = null;
						modifiedStatus = null;
						signedHeadStatus = null;
						if (probeToken) {
							const [authed, authedHead, expired, modified] = await Promise.all([
								gatewayFetch(`${target}?t=${encodeURIComponent(probeToken)}`, "GET"),
								gatewayFetch(`${target}?t=${encodeURIComponent(probeToken)}`, "HEAD"),
								expiredToken ? gatewayFetch(`${target}?t=${encodeURIComponent(expiredToken)}`, "GET") : Promise.resolve({ transport: "ok", status: null }),
								gatewayFetch(`${origin}/v1/${otherPath}?t=${encodeURIComponent(probeToken)}`, "GET")
							]);
							if (authed.transport === "ok") signed = { status: authed.status, type: authed.type, cache: authed.cache, location: authed.location, code: authed.code || "" };
							signedHeadStatus = authedHead.transport === "ok" ? authedHead.status : null;
							expiredStatus = expired.transport === "ok" ? expired.status : null;
							modifiedStatus = modified.transport === "ok" ? modified.status : null;
						}
					} else {
						expiredStatus = null;
						modifiedStatus = null;
						signedHeadStatus = null;
					}
				}
			}
		}
	}
	const allow = String(anonymous.allow || "").trim().toLowerCase();
	const originAllowed = transport === "ok" && anonymous.status != null ? allow === GATEWAY_APP_ORIGIN : null;
	const report = buildGatewayReport({
		enabled,
		origin: origin || rawOrigin,
		originValid: Boolean(origin),
		secretPresent,
		transport,
		anonymousStatus: anonymous.status,
		anonymousType: anonymous.type,
		anonymousCache: anonymous.cache,
		anonymousLocation: anonymous.location,
		originAllowed,
		badStatus,
		signedStatus: signed.status,
		signedType: signed.type,
		signedCache: signed.cache,
		signedLocation: signed.location,
		signedPrepared,
		signedCode: signed.code,
		headStatus,
		postStatus,
		expiredStatus,
		modifiedStatus,
		signedHeadStatus
	});
	const diag = gatewayTimestamps(previous, report);
	await saveGatewayCheck(sql, report.verdict.state, report.summary, mark, diag);
	await audit(sql, session.email, "Test media gateway", report.verdict.usable ? "verified" : report.stage);
	return {
		ok: true,
		...report.verdict,
		detail: report.summary,
		stage: report.stage,
		checks: diag.checks,
		lastSuccessAt: diag.lastSuccessAt,
		lastFailureAt: diag.lastFailureAt,
		testedAt: new Date().toISOString()
	};
}
