// Recovered from the last server build after the typed source was overwritten.
// @ts-nocheck
import { getRequest } from "@tanstack/react-start/server";
import { createHash, randomBytes } from "node:crypto";
import { getSql } from "@/lib/db";
import { weddingDataSql } from "@/lib/developer/core-route.server";
import { PLAY_CATALOG, decidePurchase, interpretPlayProduct, interpretPlaySubscription, purchaseTokenHash } from "@/lib/infra/billing";
import { bareCloudflareToken } from "@/lib/infra/config";
import { FLAG_IDS, assessInfrastructure, effectiveFlag, redactDetail } from "@/lib/infra/core";
import { googleToken } from "@/lib/infra/google-token";
import { decideLive } from "@/lib/infra/live";
import { authorizeMedia, keyBelongsToWedding, mediaObjectKey, withinRate } from "@/lib/infra/media-policy";
import { MULTIPART_PART_BYTES, UPLOAD_CHUNK_BYTES, pieceLength, uploadPieceCount } from "@/lib/infra/r2-browser";
import { completeR2Multipart, createR2Multipart, deleteR2Object, getR2Object, headR2Object, openR2Read, presignS3, putR2Object, uploadR2Part } from "@/lib/infra/r2-sign";
import { downloadExpiry, openDownloadTicket, sealDownloadTicket } from "@/lib/infra/download-ticket";
import { contentDisposition, downloadMime, privacyAllowsDownload, safeDownloadName, weddingDownloadName } from "@/lib/wedding/download-name";
import { overPlanStorage, storageMessage } from "@/lib/wedding/plan";
import { thumbObjectKey } from "@/lib/wedding/r2-ref";
import { cdnMark, cdnProbeMatches } from "@/lib/infra/cdn";
import { displayText } from "@/lib/infra/display";
import { MEDIA_TOKEN_TTL_SECONDS, gatewayMark, gatewaySecretOk, mayIssueViewToken, mediaGatewayUrl, normalizeGatewayOrigin, signMediaToken } from "@/lib/infra/media-token";
import { infraVaultKey, resolvedInfraEnv } from "@/lib/infra/resolved-env.server";

var hits = new Map();
function amzDate(now = new Date()) {
	return now.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function vaultKey() {
	return infraVaultKey();
}
async function resolvedEnv() {
	const resolved = await resolvedInfraEnv();
	try {
		await getSql();
	} catch {
		return { ...resolved, unreadable: true, locked: false };
	}
	return resolved;
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
	const jurisdiction = env.R2_JURISDICTION?.trim().toLowerCase() || "default";
	const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() || "";
	const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() || "";
	if (!/^[a-f0-9]{32}$/i.test(accountId) || !["default", "eu", "fedramp", "us"].includes(jurisdiction) || !bucket || !accessKeyId || !secretAccessKey || state !== "ready" && state !== "verified") return {
		ok: false,
		error: "Private media storage is not configured. Nothing was uploaded."
	};
	return {
		ok: true,
		accountId,
		jurisdiction,
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
		const rows = await sql`select upload_id, slug, received, created_at from r2_upload where created_at < now() - interval '1 day' order by created_at asc limit 20`;
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
const cleanupAt = new Map();
async function scheduleUploadCleanup(sql, bucket) {
  const mark = bucket.accountId + "/" + bucket.bucket;
  if (Date.now() - (cleanupAt.get(mark) || 0) < 300_000) return;
  cleanupAt.set(mark, Date.now());
  const cleanup = forgetAbandonedUploads(sql, bucket);
  const request = getRequest();
  if (typeof request.waitUntil === "function") request.waitUntil(cleanup);
  else await cleanup;
}
export async function infraPrepareUpload(input): Promise<any> {
	const started = Date.now();
	if (!allow(`up:${input.slug}:${createHash("sha256").update(input.memberKey).digest("hex").slice(0, 12)}`)) return {
		ok: false,
		error: "Too many upload requests. Wait a moment and try again."
	};
	const sql = await getSql();

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
	const [room, resolved, checks] = await Promise.all([
		assertStorageRoom(input.slug, input.bytes), resolvedEnv(), readChecks(sql),
	]);
	if (!room.ok) return room;
	const env = resolved.env;
	const bucket = openPrivateBucket(env, assessInfrastructure(env, checks).providers.find((item) => item.id === "r2")?.state);
	if (!bucket.ok) return bucket;
	await scheduleUploadCleanup(sql, bucket);
	const key = mediaObjectKey(input.slug, input.purpose, input.fileName, randomBytes(8).toString("hex"));
	const signed = presignS3({
		method: "PUT",
		accountId: bucket.accountId,
		jurisdiction: bucket.jurisdiction,
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
		jurisdiction: bucket.jurisdiction,
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
		jurisdiction: bucket.jurisdiction,
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

const GATEWAY_APP_ORIGIN = "https://theweddingcircle.in";
