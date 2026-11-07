/* eslint-disable @typescript-eslint/ban-ts-comment -- recovered server module; strict implicit-any would rewrite the whole file */
// @ts-nocheck
import { createServerFn } from "@tanstack/react-start";
import { codeMatch, compactCode, googleMapsLink, normalizeCode } from "@/lib/wedding/format";
import { mergeChats, mergeNotes, mergePosts } from "@/lib/wedding/activity";
import { commitProfile, dropNamed, mergeProfiles, prepareProfile } from "@/lib/wedding/guest-profile.ts";
import { redactWedding } from "@/lib/wedding/access";
import { canReadPrivateMedia, voiceAttachment } from "@/lib/wedding/capture";
import { mergeSharedTheme, themeRevOf, themeWriteDecision } from "@/lib/wedding/theme-sync";
import { isAssignableThemeId } from "@/lib/wedding/card-themes";
import { fontsFromRemote } from "@/lib/wedding/fonts.ts";
import { sanitizeBar } from "@/lib/wedding/bar-layout.ts";
import { ceremonyCoverKindOf } from "@/lib/wedding/ceremony-covers.ts";
import { FREE_STORAGE_BYTES, PREMIUM_STORAGE_BYTES, lockServerPayment, storageLimitBytes, weddingStorageBytes } from "@/lib/wedding/plan";

function cleanSlug(value) {
	if (typeof value !== "string") throw new Error("That invitation link is not valid.");
	const slug = value.trim().toLowerCase();
	if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw new Error("That invitation link is not valid.");
	return slug;
}
async function coreSql() {
	const { weddingDataSql } = await import("@/lib/developer/core-route.server");
	return weddingDataSql();
}
function deletedPayload(value) {
	try {
		const parsed = typeof value === "string" ? JSON.parse(value) : value;
		return Boolean(parsed && parsed.deleted === true);
	} catch {
		return false;
	}
}
function asWedding(value, slug) {
	try {
		const parsed = typeof value === "string" ? JSON.parse(value) : value;
		if (!parsed || typeof parsed !== "object") return null;
		if (parsed.deleted === true) return null;
		if (parsed.slug !== slug || !parsed.bride || !parsed.groom) return null;
		return parsed;
	} catch {
		return null;
	}
}
function fingerprint(wedding) {
	const { rev: _rev, ...rest } = wedding;
	return JSON.stringify(rest);
}
function mergeSaved(current, incoming) {
	const theme = mergeSharedTheme(current, incoming);
	return {
		...incoming,
		posts: mergePosts(current.posts ?? [], incoming.posts ?? []),
		chats: mergeChats(current.chats ?? [], incoming.chats ?? []),
		beforeNotes: mergeNotes(current.beforeNotes ?? [], incoming.beforeNotes ?? []),
		guestProfiles: mergeProfiles(current.guestProfiles, incoming.guestProfiles),
		cardTheme: theme.cardTheme,
		themeRev: theme.themeRev,
		fonts: fontsFromRemote(current, incoming),
		rev: current.rev
	};
}
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const typingBook = (globalThis.__wcTyping ??= new Map());
function clip(value, max) {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function shareable(value) {
	if (typeof value !== "string") return "";
	const src = value.trim();
	if (!src || src.length > 500 || src.startsWith("data:") || src.startsWith("blob:")) return "";
	return src;
}
function cleanRule(value) {
	if (!value || typeof value !== "object") return void 0;
	const rule = value;
	if (rule.kind !== "bride" && rule.kind !== "groom" && rule.kind !== "people" && rule.kind !== "ceremony") return void 0;
	const names = Array.isArray(rule.names) ? rule.names.filter((item) => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 40) : void 0;
	const ceremonyId = clip(rule.ceremonyId, 80);
	return {
		kind: rule.kind,
		names,
		ceremonyId: ceremonyId || void 0
	};
}
function senderId(value) {
	if (typeof value !== "string") return "";
	const id = value.trim();
	return /^(email|phone):[A-Za-z0-9@._+-]{3,160}$/.test(id) ? id : "";
}
function cleanPost(value, author) {
	if (!value || typeof value !== "object") return null;
	const body = value;
	if (!ID.test(body.id ?? "")) return null;
	const text = clip(body.text, 2e3);
	const images = Array.isArray(body.images) ? body.images.map(shareable).filter(Boolean).slice(0, 50) : [];
	const videos = Array.isArray(body.videos) ? body.videos.flatMap((item) => {
		const src = shareable(item?.src);
		const seconds = typeof item?.seconds === "number" && item.seconds > 0 && item.seconds < 7200 ? Math.round(item.seconds) : 0;
		return src ? [{
			src,
			seconds
		}] : [];
	}).slice(0, 5) : [];
	const gallery = Array.isArray(body.gallery) ? body.gallery.flatMap((item) => {
		const src = shareable(item?.src);
		const kind = item?.kind === "video" ? "video" : item?.kind === "image" ? "image" : "";
		if (!src || !kind) return [];
		const seconds = typeof item?.seconds === "number" && item.seconds > 0 && item.seconds < 7200 ? Math.round(item.seconds) : 0;
		return [{ kind, src, ...(seconds ? { seconds } : {}) }];
	}).slice(0, 55) : [];
	const audio = voiceAttachment(body.audio);
	if (!text && images.length === 0 && videos.length === 0 && !audio) return null;
	const side = body.side === "Bride" || body.side === "Groom" || body.side === "Both" || body.side === "Team" ? body.side : void 0;
	const kind = audio ? "audio" : videos.length ? "videos" : images.length ? "photos" : "text";
	const authorId = senderId(body.authorId);
	const at = typeof body.at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(body.at) ? clip(body.at, 40) : "";
	const pollId = /^poll_[a-z0-9]{8,40}$/.test(body.pollId ?? "") ? body.pollId : "";
	return {
		id: body.id,
		atLabel: clip(body.atLabel, 40) || "Now",
		...(at ? { at } : {}),
		author,
		...(authorId ? { authorId } : {}),
		circle: clip(body.circle, 80) || "Guests",
		kind,
		text,
		images,
		audio,
		videos: videos.length ? videos : void 0,
		gallery: gallery.length ? gallery : void 0,
		functionId: clip(body.functionId, 80) || void 0,
		side,
		accessRule: cleanRule(body.accessRule),
		...(pollId ? { pollId } : {}),
		reactions: [],
		comments: [],
		removed: Boolean(body.removed)
	};
}
function cleanCeremony(value) {
	if (!value || typeof value !== "object") return null;
	const body = value;
	const id = clip(body.id, 80);
	const name = clip(body.name, 80);
	const date = clip(body.date, 10);
	const time = clip(body.time, 5);
	if (!ID.test(id) || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
	const end = clip(body.endTime, 5);
	const address = clip(body.address, 200);
	const dress = clip(body.dress, 80);
	const mapsRaw = typeof body.mapsUrl === "string" ? body.mapsUrl.trim() : "";
	const mapsUrl = googleMapsLink(mapsRaw);
	if (mapsRaw && !mapsUrl) return null;
	const coverKind = ceremonyCoverKindOf(body.coverKind);
	const rawCover = typeof body.cover === "string" ? body.cover.trim() : "";
	const cover = /^\/ceremony-covers\/[a-z0-9.-]+$/.test(rawCover) && rawCover.length < 80
		? rawCover
		: /^idb:[0-9a-f-]{36}$/i.test(rawCover)
			? rawCover
			: rawCover.startsWith("data:image/jpeg;base64,") && rawCover.length > 40 && rawCover.length <= 350000
				? rawCover
				: "";
	return {
		id,
		name,
		date,
		time,
		endTime: /^\d{2}:\d{2}$/.test(end) ? end : void 0,
		venue: clip(body.venue, 120),
		address: address || void 0,
		dress: dress || void 0,
		note: clip(body.note, 500),
		mapsUrl: mapsUrl || void 0,
		cover: cover || void 0,
		coverKind
	};
}
function cleanMessage(value, author) {
	if (!value || typeof value !== "object") return null;
	const body = value;
	if (!ID.test(body.id ?? "")) return null;
	const text = clip(body.text, 2e3);
	const image = shareable(body.image);
	const video = shareable(body.video);
	if (!text && !image && !video) return null;
	const replyTo = clip(body.replyTo, 80) || void 0;
	const authorId = senderId(body.authorId);
	return {
		id: body.id,
		author,
		...(authorId ? { authorId } : {}),
		text: text || (video ? "Shared a video." : "Shared a photo."),
		atLabel: clip(body.atLabel, 40) || "Now",
		image: image || void 0,
		video: video || void 0,
		videoSeconds: typeof body.videoSeconds === "number" ? Math.min(7200, Math.max(0, Math.round(body.videoSeconds))) : void 0,
		replyTo,
		reactions: []
	};
}
function toggleMemberReaction(list, writer, kind) {
	const current = Array.isArray(list) ? list : [];
	const same = (item) => item.memberKey && item.memberKey === writer.key || !item.memberKey && item.author === writer.name;
	if (current.find(same)?.kind === kind) return current.filter((item) => !same(item));
	return [...current.filter((item) => !same(item)), { author: writer.name, kind, memberKey: writer.key }];
}
async function ensureMembers(sql) {
	await sql`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`;
}
function parseList(value) {
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
	} catch {
		return [];
	}
}
async function upsertMember(sql, slug, memberKey, name, role, raise) {
	if (!/^[A-Za-z0-9_-]{8,64}$/.test(memberKey)) return;
	const { nextMemberRole } = await import("@/lib/wedding/membership");
	const existing = await sql`select role from circle_members where slug = ${slug} and member_key = ${memberKey} limit 1`;
	const current = existing[0]?.role ?? "";
	const next = nextMemberRole(current, role, raise === true);
	if (!next) return;
	if (existing[0]) {
		if (next === current && !name) return;
		if (name) await sql`update circle_members set name = ${name}, role = ${next} where slug = ${slug} and member_key = ${memberKey}`;
		else await sql`update circle_members set role = ${next} where slug = ${slug} and member_key = ${memberKey}`;
		return;
	}
	await sql`insert into circle_members (slug, member_key, email, name, role) values (${slug}, ${memberKey}, ${""}, ${name}, ${next})`;
}
async function authorize(sql, wedding, input) {
	await ensureMembers(sql);
	const name = clip(input.name, 80);
	if (!name) return null;
	const keys = await sql`select edit_key from circles where slug = ${wedding.slug} limit 1`;
	if (input.editKey.length >= 16 && keys[0]?.edit_key === input.editKey) {
		await upsertMember(sql, wedding.slug, input.memberKey, name, "host", true);
		return {
			name,
			role: "host",
			key: input.memberKey
		};
	}
	if (input.memberKey) {
		const member = (await sql`select name, role from circle_members where slug = ${wedding.slug} and member_key = ${input.memberKey} limit 1`)[0];
		if (member && (member.role === "host" || member.role === "cohost" || member.role === "family" || member.role === "guest")) return {
			name: member.name || name,
			role: member.role,
			key: input.memberKey
		};
	}
	let coded = null;
	const matched = input.code ? codeMatch(wedding, input.code) : void 0;
	if (matched?.kind === "family") coded = "family";
	else if (matched?.kind === "guest") coded = "guest";
	if (!coded && input.code) try {
		const { roleFromCode } = await import("@/lib/wedding/roles.server");
		const auth = (await sql`
        select host_code, cohost_code, family_codes, guest_codes from circle_auth where slug = ${wedding.slug} limit 1
      `)[0];
		if (auth) coded = roleFromCode({
			hostCode: auth.host_code,
			cohostCode: auth.cohost_code,
			familyCodes: parseList(auth.family_codes),
			guestCodes: parseList(auth.guest_codes)
		}, input.code);
	} catch {
		coded = null;
	}
	if (coded) {
		await upsertMember(sql, wedding.slug, input.memberKey, name, coded, true);
		return {
			name,
			role: coded,
			key: input.memberKey
		};
	}
	if (!input.code && wedding.privacy?.join !== "approve" && /^[A-Za-z0-9_-]{8,64}$/.test(input.memberKey)) {
		await upsertMember(sql, wedding.slug, input.memberKey, name, "guest", false);
		return {
			name,
			role: "guest",
			key: input.memberKey
		};
	}
	return null;
}
async function commitChange(sql, slug, change) {
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const current = asWedding((await sql`select payload from circles where slug = ${slug} limit 1`)[0]?.payload, slug);
		if (!current) return false;
		const changed = change(current);
		if (!changed) return false;
		if (changed === current || fingerprint(changed) === fingerprint(current)) return true;
		const rev = Number(current.rev ?? 0);
		const next = {
			...changed,
			rev: rev + 1
		};
		if ((await sql`
      update circles
      set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
      where slug = ${slug} and coalesce((payload->>'rev')::int, 0) = ${rev}
      returning slug
    `)[0]) return true;
	}
	return false;
}
function noteTyping(slug, scope, name, key, active) {
	const room = typingBook.get(slug) ?? /* @__PURE__ */ new Map();
	typingBook.set(slug, room);
	const id = `${scope}\n${key || name.toLowerCase()}`;
	if (!active) room.delete(id);
	else room.set(id, {
		name,
		key,
		at: Date.now()
	});
}
function typingSnapshot(slug, selfKey) {
	const room = typingBook.get(slug);
	const feed = [];
	const chats = {};
	if (!room) return {
		feed,
		chats
	};
	const now = Date.now();
	for (const [id, slot] of room) {
		if (now - slot.at > 7e3) {
			room.delete(id);
			continue;
		}
		if (selfKey && slot.key === selfKey) continue;
		const split = id.indexOf("\n");
		const scope = split >= 0 ? id.slice(0, split) : id;
		if (scope === "feed") {
			if (feed.length < 4 && !feed.includes(slot.name)) feed.push(slot.name);
		} else if (scope.startsWith("chat:")) {
			const chatId = scope.slice(5);
			const list = chats[chatId] ?? [];
			if (list.length < 4 && !list.includes(slot.name)) list.push(slot.name);
			chats[chatId] = list;
		}
	}
	return {
		feed,
		chats
	};
}
const planRestoreAt = new Map();
async function restoreStoredPlan(sql, wedding) {
  if (!wedding || wedding.payment?.verified === true || wedding.slug === "lila-nico") return wedding;
  if (Date.now() - (planRestoreAt.get(wedding.slug) || 0) < 30_000) return wedding;
  planRestoreAt.set(wedding.slug, Date.now());
  try {
    const [{ getSql }, { restoreVoucherEntitlement }] = await Promise.all([
      import("@/lib/db"), import("@/lib/wedding/voucher-entitlement.server"),
    ]);
    const restored = await restoreVoucherEntitlement(sql, await getSql(), wedding);
    return asWedding(restored, wedding.slug) || wedding;
  } catch (error) {
    const code = typeof error?.code === "string" && /^[A-Z0-9_]{3,20}$/.test(error.code) ? error.code : "unavailable";
    console.warn("[voucher-plan]", JSON.stringify({ slug: wedding.slug, outcome: "recovery-unavailable", code }));
    return wedding;
  }
}
async function visibleWedding(sql, wedding, memberKey) {
  wedding = await restoreStoredPlan(sql, wedding);
	if (!memberKey) return redactWedding(wedding, null);
	try {
		await ensureMembers(sql);
		const member = (await sql`select name, role from circle_members where slug = ${wedding.slug} and member_key = ${memberKey} limit 1`)[0];
		if (!member) return redactWedding(wedding, null);
		const role = member.role === "host" || member.role === "cohost" ? member.role : "guest";
		if (role === "host" || role === "cohost") return wedding;
		const guest = wedding.guests.find((item) => item.name.trim().toLowerCase() === member.name.trim().toLowerCase());
		return redactWedding(wedding, {
			name: member.name || guest?.name || "",
			role,
			side: guest?.side
		});
	} catch {
		return redactWedding(wedding, null);
	}
}
export const fetchCircle = createServerFn({ method: "GET" }).validator((slug) => cleanSlug(slug)).handler(async ({ data: slug }) => {
	const sql = await coreSql();
	const wedding = asWedding((await sql`select payload from circles where slug = ${slug} limit 1`)[0]?.payload, slug);
	return wedding ? redactWedding(await restoreStoredPlan(sql, wedding), null) : null;
});
export const saveCircle = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("The wedding could not be saved.");
	const body = input;
	const slug = cleanSlug(body.slug);
	if (slug === "lila-nico") throw new Error("The sample wedding is already shared.");
	if (typeof body.editKey !== "string" || body.editKey.length < 16) throw new Error("The wedding could not be saved.");
	const payload = asWedding(body.payload, slug);
	if (!payload) throw new Error("The wedding could not be saved.");
	return {
		slug,
		editKey: body.editKey,
		payload
	};
}).handler(async ({ data }) => {
	const sql = await coreSql();
	for (let attempt = 0; attempt < 4; attempt += 1) {
		const row = (await sql`select edit_key, payload from circles where slug = ${data.slug} limit 1`)[0];
		if (row && row.edit_key !== data.editKey) return { ok: false };
		if (row && deletedPayload(row.payload)) return { ok: false, error: "deleted" };
		const current = row ? asWedding(row.payload, data.slug) : null;
		const merged = current ? mergeSaved(current, data.payload) : {
			...data.payload,
			rev: 0
		};
		const { lockLifecycle } = await import("@/lib/wedding/lifecycle.server");
		const locked = await lockLifecycle(sql, data.slug, merged, !row);
		if (current && fingerprint(current) === fingerprint(locked.payload)) return { ok: true };
		const rev = Number(current?.rev ?? 0);
		const next = {
			...locked.payload,
			rev: rev + 1
		};
		const alreadyVerified = Boolean(current?.payment && current.payment.status === "paid" && current.payment.verified === true);
		if (alreadyVerified || (next.payment && typeof next.payment === "object")) {
			next.payment = lockServerPayment(current?.payment, next.payment);
		}
		const body = JSON.stringify(next);
		const limit = storageLimitBytes(next);
		const nextBytes = weddingStorageBytes(next);
		const prevBytes = current ? weddingStorageBytes(current) : 0;
		const sample = Boolean(next.illustrated || next.id === "lila-nico" || next.slug === "lila-nico");
		if (!sample && nextBytes > limit && nextBytes > prevBytes) return { ok: false, error: "storage" };
		if (!row) {
			const stamp = locked.stamp;
			if (!stamp) return { ok: false };
			if ((await sql`
          insert into circles (slug, payload, edit_key, created_at, expires_at, media_retention_until)
          values (${data.slug}, ${body}::jsonb, ${data.editKey}, ${stamp.createdAt}::timestamptz, ${stamp.expiresAt}::timestamptz, ${stamp.mediaRetentionUntil}::timestamptz)
          on conflict (slug) do nothing
          returning slug
        `)[0]) return { ok: true };
			continue;
		}
		if ((await sql`
        update circles
        set payload = ${body}::jsonb, updated_at = now()
        where slug = ${data.slug}
          and edit_key = ${data.editKey}
          and coalesce((payload->>'rev')::int, 0) = ${rev}
        returning slug
      `)[0]) return { ok: true };
	}
	return { ok: false };
});
export const saveCardTheme = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That theme could not be saved.");
	const body = input;
	const slug = cleanSlug(body.slug);
	if (slug === "lila-nico") throw new Error("The sample wedding cannot change theme.");
	const cardTheme = clip(body.cardTheme, 40);
	if (!isAssignableThemeId(cardTheme)) throw new Error("That theme is not available.");
	const themeRev = themeRevOf({ themeRev: body.themeRev });
	if (themeRev < 1) throw new Error("That theme could not be saved.");
	return {
		slug,
		editKey: typeof body.editKey === "string" ? body.editKey : "",
		memberKey: clip(body.memberKey, 64),
		cardTheme,
		themeRev
	};
}).handler(async ({ data }) => {
	const sql = await coreSql();
	const row = (await sql`select edit_key, payload from circles where slug = ${data.slug} limit 1`)[0];
	if (!row || deletedPayload(row.payload)) return { ok: false, error: "missing" };
	const wedding = asWedding(row.payload, data.slug);
	if (!wedding) return { ok: false, error: "missing" };
	const hostKey = data.editKey.length >= 16 && row.edit_key === data.editKey;
	let allowed = hostKey;
	if (!allowed && data.memberKey) {
		await ensureMembers(sql);
		const member = (await sql`select role from circle_members where slug = ${data.slug} and member_key = ${data.memberKey} limit 1`)[0];
		allowed = member?.role === "host" || member?.role === "cohost";
	}
	const decision = themeWriteDecision(wedding, data, allowed);
	if (!decision.ok) return { ok: false, error: decision.error, cardTheme: decision.cardTheme || "classic-default", themeRev: decision.themeRev };
	const next = {
		...wedding,
		cardTheme: decision.cardTheme,
		themeRev: decision.themeRev,
		rev: Number(wedding.rev ?? 0) + 1
	};
	const saved = (await sql`
    update circles
    set payload = ${JSON.stringify(next)}::jsonb, updated_at = now()
    where slug = ${data.slug}
      and coalesce((payload->>'themeRev')::int, 0) < ${decision.themeRev}
    returning slug
  `)[0];
	if (!saved) {
		const again = asWedding((await sql`select payload from circles where slug = ${data.slug} limit 1`)[0]?.payload, data.slug);
		return {
			ok: false,
			error: "stale",
			cardTheme: again?.cardTheme || wedding.cardTheme || "classic-default",
			themeRev: themeRevOf(again || wedding)
		};
	}
	return { ok: true, cardTheme: decision.cardTheme, themeRev: decision.themeRev };
});
export const saveWeddingBar = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("The wedding bar could not be saved.");
	const body = input;
	const slug = cleanSlug(body.slug);
	if (slug === "lila-nico") throw new Error("The sample wedding cannot change its bar.");
	return {
		slug,
		editKey: typeof body.editKey === "string" ? body.editKey : "",
		memberKey: clip(body.memberKey, 64),
		bar: body.bar ?? null
	};
}).handler(async ({ data }) => {
	const sql = await coreSql();
	const row = (await sql`select edit_key, payload from circles where slug = ${data.slug} limit 1`)[0];
	if (!row || deletedPayload(row.payload)) return { ok: false, error: "missing" };
	const wedding = asWedding(row.payload, data.slug);
	if (!wedding) return { ok: false, error: "missing" };
	const hostKey = data.editKey.length >= 16 && row.edit_key === data.editKey;
	let allowed = hostKey;
	if (!allowed && data.memberKey) {
		await ensureMembers(sql);
		const member = (await sql`select role from circle_members where slug = ${data.slug} and member_key = ${data.memberKey} limit 1`)[0];
		allowed = member?.role === "host" || member?.role === "cohost";
	}
	if (!allowed) return { ok: false, error: "denied" };
	const bar = sanitizeBar(data.bar);
	const next = { ...wedding, bar, rev: Number(wedding.rev ?? 0) + 1 };
	await sql`update circles set payload = ${JSON.stringify(next)}::jsonb, updated_at = now() where slug = ${data.slug}`;
	return { ok: true, bar: bar ?? null };
});
export const findCircleByCode = createServerFn({ method: "GET" }).validator((input) => normalizeCode(typeof input === "string" ? input : "")).handler(async ({ data: code }) => {
	const compact = compactCode(code);
	if (compact.length < 4 || compact.length > 80) return null;
	const prefix = compact.startsWith("FAMILY") ? "FAMILY" : compact.startsWith("GUEST") ? "GUEST" : "";
	const tail = prefix ? compact.slice(prefix.length) : "";
	const sql = await coreSql();
	let rows = [];
	try {
		rows = await sql`
			select c.slug, c.payload from circles c
			left join circle_auth a on a.slug = c.slug
			where regexp_replace(upper(c.payload::text), '[^A-Z0-9]', '', 'g') like ${"%" + compact + "%"}
			   or regexp_replace(upper(coalesce(a.family_codes, '') || ' ' || coalesce(a.guest_codes, '')), '[^A-Z0-9]', '', 'g') like ${"%" + compact + "%"}
			   or (
					${tail.length === 4}
					and (case
						when length(regexp_replace(upper(c.slug), '[^A-Z0-9]', '', 'g')) >= 4
						then right(regexp_replace(upper(c.slug), '[^A-Z0-9]', '', 'g'), 4)
						else left(regexp_replace(upper(c.slug), '[^A-Z0-9]', '', 'g') || 'WXYZ', 4)
					end) = ${tail}
				)
			limit 100
		`;
	} catch {
		rows = await sql`
			select slug, payload from circles
			where regexp_replace(upper(payload::text), '[^A-Z0-9]', '', 'g') like ${"%" + compact + "%"}
			   or (
					${tail.length === 4}
					and (case
						when length(regexp_replace(upper(slug), '[^A-Z0-9]', '', 'g')) >= 4
						then right(regexp_replace(upper(slug), '[^A-Z0-9]', '', 'g'), 4)
						else left(regexp_replace(upper(slug), '[^A-Z0-9]', '', 'g') || 'WXYZ', 4)
					end) = ${tail}
				)
			limit 100
		`;
	}
	for (const row of rows) {
		const wedding = asWedding(row.payload, row.slug);
		let matched = wedding ? codeMatch(wedding, code) : undefined;
		if (wedding && !matched) {
			try {
				const auth = (await sql`select family_codes, guest_codes from circle_auth where slug = ${wedding.slug} limit 1`)[0];
				if (auth) {
					const { roleFromCode } = await import("@/lib/wedding/roles.server");
					const role = roleFromCode({
						hostCode: "",
						cohostCode: "",
						familyCodes: parseList(auth.family_codes),
						guestCodes: parseList(auth.guest_codes),
					}, code);
					if (role === "family" || role === "guest") matched = { id: `auth-${role}`, code, kind: role };
				}
			} catch {
				/* Older weddings may not have the separate role-code table. */
			}
		}
		if (wedding && matched) return { ...redactWedding(wedding, null), entryCodeKind: matched.kind, entryCodeId: matched.id };
	}
	return null;
});
export const readCircleAsMember = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That wedding could not be opened.");
	const body = input;
	return {
		slug: cleanSlug(body.slug),
		memberKey: typeof body.memberKey === "string" ? body.memberKey.trim().slice(0, 64) : "",
		idToken: typeof body.idToken === "string" ? body.idToken.trim().slice(0, 4096) : ""
	};
}).handler(async ({ data }) => {
	const sql = await coreSql();
	const wedding = asWedding((await sql`select payload from circles where slug = ${data.slug} limit 1`)[0]?.payload, data.slug);
	if (!wedding) return null;
	if (data.idToken) {
		const { confirmFirebaseMembership } = await import("@/lib/wedding/firebase-identity.server");
		const identity = await confirmFirebaseMembership(data.slug, data.idToken);
		if (!identity.ok) {
			const verification = "code" in identity && identity.code === "verification_required";
			return { circleAccess: "denied" as const, error: verification ? "verification_required" as const : "denied" as const, reason: identity.reason };
		}
		if (data.memberKey && data.memberKey !== identity.memberKey) {
			return { circleAccess: "denied" as const, error: "denied" as const, reason: "That sign-in is not a member of this wedding." };
		}
		return visibleWedding(sql, wedding, identity.memberKey);
	}
	return visibleWedding(sql, wedding, data.memberKey);
});
export const syncCircle = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That wedding could not be opened.");
	const body = input;
	return {
		slug: cleanSlug(body.slug),
		memberKey: clip(body.memberKey, 64)
	};
}).handler(async ({ data }) => {
	const sql = await coreSql();
	const row = (await sql`select payload from circles where slug = ${data.slug} limit 1`)[0];
	if (row && deletedPayload(row.payload)) return {
		wedding: null,
		deleted: true,
		typing: { feed: [], chats: {} }
	};
	const wedding = asWedding(row?.payload, data.slug);
	if (!wedding) return {
		wedding: null,
		reminders: [],
		typing: {
			feed: [],
			chats: {}
		}
	};
	const { remindersForHost } = await import("@/lib/wedding/lifecycle.server");
	const reminders = await remindersForHost(sql, data.slug, data.memberKey);
	return {
		wedding: await visibleWedding(sql, wedding, data.memberKey),
		reminders: reminders.map((item) => ({
			slot: item.slot instanceof Date ? item.slot.toISOString() : String(item.slot),
			title: item.title,
			body: item.body
		})),
		typing: typingSnapshot(data.slug, data.memberKey)
	};
});
export const beginRetentionExtension = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That extension could not be opened.");
	const body = input;
	const slug = typeof body.slug === "string" ? body.slug.trim().toLowerCase() : "";
	const editKey = typeof body.editKey === "string" ? body.editKey : "";
	if (!/^[a-z0-9-]{3,80}$/.test(slug) || editKey.length < 16) throw new Error("That extension could not be opened.");
	return { slug, editKey };
}).handler(async ({ data }) => {
	const { openRetentionExtension } = await import("@/lib/wedding/lifecycle.server");
	return openRetentionExtension(data);
});
export const contributeCircle = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That could not be sent.");
	const body = input;
	const slug = cleanSlug(body.slug);
	if (slug === "lila-nico") throw new Error("The sample wedding stays on this phone.");
	const action = clip(body.action, 20);
	if (![
		"post",
		"comment",
		"chat",
		"remove-post",
		"remove-message",
		"typing",
		"save-function",
		"remove-function",
		"profile",
		"react",
		"atmosphere",
		"drop-profile"
	].includes(action)) throw new Error("That could not be sent.");
	return {
		slug,
		action,
		name: clip(body.name, 80),
		memberKey: clip(body.memberKey, 64),
		code: clip(body.code, 80),
		editKey: clip(body.editKey, 80),
		scope: clip(body.scope, 90),
		active: Boolean(body.active),
		post: body.post,
		postId: clip(body.postId, 80),
		comment: body.comment,
		chatId: clip(body.chatId, 80),
		message: body.message,
		messageId: clip(body.messageId, 80),
		fn: body.fn,
		functionId: clip(body.functionId, 80),
		profile: body.profile && typeof body.profile === "object" ? body.profile : null,
		remove: body.remove === true,
		kind: body.kind === "love" || body.kind === "joy" || body.kind === "bless" ? body.kind : "",
		enabled: body.enabled === true,
		guestName: clip(body.guestName, 80)
	};
}).handler(async ({ data }) => {
	const sql = await coreSql();
	const wedding = asWedding((await sql`select payload from circles where slug = ${data.slug} limit 1`)[0]?.payload, data.slug);
	if (!wedding) return {
		ok: false,
		error: "This wedding is not on the circle yet."
	};
	const writer = await authorize(sql, wedding, data);
	if (!writer) return {
		ok: false,
		error: "Join this wedding with its guest code before sharing with other people."
	};
	if (data.action === "save-function" || data.action === "remove-function") {
		if (writer.role !== "host" && writer.role !== "cohost") return {
			ok: false,
			error: "Only a host or co-host can edit a ceremony."
		};
	}
	if (data.action === "typing") {
		const scope = data.scope === "feed" || /^chat:[A-Za-z0-9_-]{1,80}$/.test(data.scope) ? data.scope : "";
		if (!scope) return {
			ok: false,
			error: "That conversation is not available."
		};
		noteTyping(data.slug, scope, writer.name, writer.key, data.active);
		return { ok: true };
	}
	const canModerate = writer.role === "host" || writer.role === "cohost";
	if (data.action === "profile" && !data.remove) {
		const prepared = prepareProfile(data.profile ?? {}, { accountId: senderId(data.profile?.accountId), joinedName: writer.name });
		if (!prepared.ok) return { ok: false, error: prepared.error };
		if (/^[A-Za-z0-9_-]{8,64}$/.test(writer.key)) {
			await sql`update circle_members set name = ${prepared.profile.displayName} where slug = ${data.slug} and member_key = ${writer.key}`;
		}
	}
	const saved = await commitChange(sql, data.slug, (current) => {
		if (data.action === "post") {
			const post = cleanPost(data.post, writer.name);
			if (!post) return null;
			if ((current.posts ?? []).some((item) => item.id === post.id)) return current;
			return {
				...current,
				posts: [post, ...current.posts ?? []]
			};
		}
		if (data.action === "comment") {
			const comment = cleanMessage(data.comment, writer.name);
			if (!ID.test(data.postId) || !comment) return null;
			let found = false;
			const posts = (current.posts ?? []).map((post) => {
				if (post.id !== data.postId || post.removed) return post;
				found = true;
				if ((post.comments ?? []).some((item) => item.id === comment.id)) return post;
				return {
					...post,
					comments: [...post.comments ?? [], {
						id: comment.id,
						author: writer.name,
						...(comment.authorId ? { authorId: comment.authorId } : {}),
						text: comment.text,
						atLabel: comment.atLabel,
						replyTo: comment.replyTo
					}]
				};
			});
			return found ? {
				...current,
				posts
			} : null;
		}
		if (data.action === "chat") {
			const message = cleanMessage(data.message, writer.name);
			if (!ID.test(data.chatId) || !message) return null;
			let found = false;
			const chats = (current.chats ?? []).map((chat) => {
				if (chat.id !== data.chatId) return chat;
				found = true;
				if (chat.messages.some((item) => item.id === message.id)) return chat;
				return {
					...chat,
					messages: [...chat.messages, message]
				};
			});
			return found ? {
				...current,
				chats
			} : null;
		}
		if (data.action === "remove-post") {
			if (!ID.test(data.postId)) return null;
			let allowed = false;
			const posts = (current.posts ?? []).map((post) => {
				if (post.id !== data.postId) return post;
				allowed = canModerate || post.author.trim().toLowerCase() === writer.name.trim().toLowerCase();
				return allowed ? {
					...post,
					removed: true
				} : post;
			});
			return allowed ? {
				...current,
				posts
			} : null;
		}
		if (data.action === "remove-message") {
			if (!ID.test(data.chatId) || !ID.test(data.messageId)) return null;
			let allowed = false;
			const chats = (current.chats ?? []).map((chat) => {
				if (chat.id !== data.chatId) return chat;
				return {
					...chat,
					messages: chat.messages.map((message) => {
						if (message.id !== data.messageId) return message;
						allowed = canModerate || message.author.trim().toLowerCase() === writer.name.trim().toLowerCase();
						return allowed ? {
							...message,
							removed: true
						} : message;
					})
				};
			});
			return allowed ? {
				...current,
				chats
			} : null;
		}
		if (data.action === "save-function") {
			if (writer.role !== "host" && writer.role !== "cohost") return null;
			const patch = cleanCeremony(data.fn);
			if (!patch) return null;
			let found = false;
			const functions = (current.functions ?? []).map((item) => {
				if (item.id !== patch.id) return item;
				found = true;
				return {
					...item,
					name: patch.name,
					date: patch.date,
					time: patch.time,
					endTime: patch.endTime,
					venue: patch.venue,
					address: patch.address,
					dress: patch.dress,
					note: patch.note,
					mapsUrl: patch.mapsUrl,
					cover: patch.cover,
					coverKind: patch.coverKind
				};
			});
			return found ? {
				...current,
				functions
			} : null;
		}
		if (data.action === "remove-function") {
			if (writer.role !== "host" && writer.role !== "cohost" || !ID.test(data.functionId)) return null;
			if (!(current.functions ?? []).some((item) => item.id === data.functionId)) return null;
			return {
				...current,
				functions: (current.functions ?? []).filter((item) => item.id !== data.functionId)
			};
		}
		if (data.action === "profile") {
			if (!/^[A-Za-z0-9_-]{8,64}$/.test(writer.key)) return null;
			const now = new Date().toISOString();
			if (data.remove) {
				const next = commitProfile(current.guestProfiles, writer.key, { displayName: "", removed: true, updatedAt: now });
				return next ? { ...current, guestProfiles: next } : null;
			}
			const prepared = prepareProfile(data.profile ?? {}, { accountId: senderId(data.profile?.accountId), joinedName: writer.name, now });
			if (!prepared.ok) return null;
			const next = commitProfile(current.guestProfiles, writer.key, prepared.profile);
			return next ? { ...current, guestProfiles: next } : null;
		}
		if (data.action === "react") {
			if (!ID.test(data.postId) || (data.kind !== "love" && data.kind !== "joy" && data.kind !== "bless")) return null;
			let found = false;
			const posts = (current.posts ?? []).map((post) => {
				if (post.id !== data.postId || post.removed) return post;
				found = true;
				return { ...post, reactions: toggleMemberReaction(post.reactions, writer, data.kind) };
			});
			return found ? { ...current, posts } : null;
		}
		if (data.action === "atmosphere") {
			if (writer.role !== "host" && writer.role !== "cohost") return null;
			return { ...current, chatAtmosphere: data.enabled === true };
		}
		if (data.action === "drop-profile") {
			if (writer.role !== "host" && writer.role !== "cohost" || !data.guestName) return null;
			return { ...current, guestProfiles: dropNamed(current.guestProfiles, data.guestName) };
		}
		return null;
	});
	if (!saved && data.action === "save-function" && !cleanCeremony(data.fn)) return {
		ok: false,
		error: "Add a ceremony name, date, and start time."
	};
	if (!saved && data.action === "post" && !cleanPost(data.post, writer.name)) return {
		ok: false,
		error: "Write a message before sending it."
	};
	if (!saved && data.action === "profile" && !data.remove) return {
		ok: false,
		error: "That wedding profile could not be saved. Your previous profile is unchanged."
	};
	if (saved && data.action === "post") {
		try {
			const { noteSeekSocial } = await import("@/lib/wedding/seek.server");
			await noteSeekSocial(sql, data.slug, writer, cleanPost(data.post, writer.name));
		} catch {
			/* A Seek note must not block the message that was already saved. */
		}
	}
	return saved ? { ok: true } : {
		ok: false,
		error: "The circle could not save that just now. Try again."
	};
});
export const deleteCircle = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("The wedding could not be deleted.");
	const body = input;
	const slug = cleanSlug(body.slug);
	if (slug === "lila-nico") throw new Error("The sample wedding stays.");
	if (typeof body.editKey !== "string" || body.editKey.length < 16) throw new Error("The wedding could not be deleted.");
	return {
		slug,
		editKey: body.editKey,
		keepMedia: body.keepMedia === true
	};
}).handler(async ({ data }) => {
	const media = await mediaSql();
	const core = await coreSql();
	let removed = false;
	try {
		const existing = await core`select slug from circles where slug = ${data.slug} and edit_key = ${data.editKey} limit 1`;
		if (!existing[0]) return { ok: false, partial: false };
		const children = [
			() => core`delete from circle_members where slug = ${data.slug}`,
			() => core`delete from circle_auth where slug = ${data.slug}`,
			() => core`delete from ceremony_invites where slug = ${data.slug}`,
			() => core`delete from couple_access where slug = ${data.slug}`
		];
		let partial = false;
		for (const run of children) {
			try {
				await run();
			} catch (error) {
				const message = String(error?.message || error);
				if (!/does not exist/i.test(message)) partial = true;
			}
		}
		const rows = await core`update circles set payload = ${JSON.stringify({ slug: data.slug, deleted: true, deletedAt: new Date().toISOString(), rev: Date.now() })}::jsonb, updated_at = now() where slug = ${data.slug} and edit_key = ${data.editKey} returning slug`;
		removed = Boolean(rows[0]);
		if (!removed) return { ok: false, partial };
		const kept = `kept:${data.editKey}`;
		try {
			if (data.keepMedia) await media`update circle_media set slug = ${kept} where slug = ${data.slug}`;
			else {
				await media`delete from circle_media_part where id in (select id from circle_media where slug = ${data.slug})`;
				await media`delete from circle_media where slug = ${data.slug}`;
			}
		} catch {
			partial = true;
		}
		const live = [
			() => media`delete from circle_live where slug = ${data.slug}`,
			() => media`delete from circle_live_signal where slug = ${data.slug}`
		];
		for (const run of live) try {
			await run();
		} catch (error) {
			const message = String(error?.message || error);
			if (!/does not exist/i.test(message)) partial = true;
		}
		return { ok: true, partial };
	} catch (error) {
		if (removed) return { ok: true, partial: true };
		throw error;
	}
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function mediaSql() {
	const { getSql } = await import("@/lib/db");
	const sql = await getSql();
	await sql`create table if not exists circle_media (
    id text primary key,
    slug text not null,
    mime text not null,
    chunks integer not null,
    updated_at timestamptz not null default now()
  )`;
	await sql`create table if not exists circle_media_part (
    id text not null,
    idx integer not null,
    data text not null,
    primary key (id, idx)
  )`;
	await sql`alter table circle_media add column if not exists provider text not null default 'library'`;
	await sql`alter table circle_media add column if not exists object_path text not null default ''`;
	return sql;
}
function cleanMediaId(value) {
	if (typeof value !== "string" || !UUID.test(value.trim())) throw new Error("That photo could not be opened.");
	return value.trim().toLowerCase();
}
export const saveCircleMediaPart = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That file could not be shared.");
	const body = input;
	const slug = cleanSlug(body.slug);
	if (slug === "lila-nico") throw new Error("The sample wedding is already shared.");
	const id = cleanMediaId(body.id);
	const mime = typeof body.mime === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.mime) ? body.mime.slice(0, 80) : "application/octet-stream";
	const idx = body.idx;
	const total = body.total;
	if (typeof idx !== "number" || typeof total !== "number" || !Number.isInteger(idx) || !Number.isInteger(total)) throw new Error("That file could not be shared.");
	if (idx < 0 || total < 1 || total > 40 || idx >= total) throw new Error("That file could not be shared.");
	if (typeof body.data !== "string" || body.data.length < 4 || body.data.length > 9e5 || !/^[A-Za-z0-9+/=\s]+$/.test(body.data)) throw new Error("That file could not be shared.");
	const editKey = typeof body.editKey === "string" ? body.editKey : "";
	const mediaKey = typeof body.mediaKey === "string" ? body.mediaKey : "";
	if (editKey.length < 16 && mediaKey.length < 16) throw new Error("That file could not be shared.");
	return {
		slug,
		id,
		mime,
		idx,
		total,
		data: body.data.replace(/\s/g, ""),
		editKey,
		mediaKey
	};
}).handler(async ({ data }) => {
	const media = await mediaSql();
	const row = (await (await coreSql())`
      select edit_key, payload->>'mediaKey' as media_key, payload->'payment'->>'status' as pay_status, payload->'payment'->>'verified' as pay_verified from circles where slug = ${data.slug} limit 1
    `)[0];
	if (!row) return { ok: false };
	if (!(data.editKey.length >= 16 && row.edit_key === data.editKey || data.mediaKey.length >= 16 && row.media_key === data.mediaKey)) return { ok: false };
	{
		const used = (await media`
      select coalesce(sum(length(p.data)), 0) as bytes
      from circle_media_part p
      join circle_media m on m.id = p.id
      where m.slug = ${data.slug}
        and not (p.id = ${data.id} and p.idx = ${data.idx})
    `)[0];
		const nextBytes = Number(used?.bytes ?? 0) + Math.floor(data.data.length * 0.75);
		const limit = row.pay_status === "paid" && row.pay_verified === "true" ? PREMIUM_STORAGE_BYTES : FREE_STORAGE_BYTES;
		if (nextBytes > limit) return { ok: false, error: "storage" };
	}
	await media`
      insert into circle_media (id, slug, mime, chunks)
      values (${data.id}, ${data.slug}, ${data.mime}, ${data.total})
      on conflict (id) do update set mime = excluded.mime, chunks = excluded.chunks, updated_at = now()
    `;
	await media`
      insert into circle_media_part (id, idx, data)
      values (${data.id}, ${data.idx}, ${data.data})
      on conflict (id, idx) do update set data = excluded.data
    `;
	return { ok: true };
});
function mediaProof(input) {
	if (typeof input === "string") return { id: cleanMediaId(input), memberKeys: [], editKeys: [] };
	if (!input || typeof input !== "object") throw new Error("That photo could not be opened.");
	const list = (value, max, ok) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && ok(item)).slice(0, max) : [];
	return {
		id: cleanMediaId(input.id),
		memberKeys: list(input.memberKeys, 30, (item) => /^[A-Za-z0-9_-]{8,80}$/.test(item)),
		editKeys: list(input.editKeys, 20, (item) => item.length >= 16 && item.length <= 80)
	};
}
async function audioReadable(row, proof) {
	const mime = String(row.mime || "application/octet-stream");
	if (!mime.toLowerCase().startsWith("audio/")) return true;
	const sql = await coreSql();
	const circle = (await sql`select edit_key from circles where slug = ${row.slug} limit 1`)[0];
	const editMatch = Boolean(circle && proof.editKeys.some((key) => key === circle.edit_key));
	let memberMatch = false;
	if (!editMatch) {
		await ensureMembers(sql);
		for (const key of proof.memberKeys) {
			const member = (await sql`select member_key from circle_members where slug = ${row.slug} and member_key = ${key} limit 1`)[0];
			if (member) {
				memberMatch = true;
				break;
			}
		}
	}
	return canReadPrivateMedia(mime, { editMatch, memberMatch });
}
export const fetchCircleMediaMeta = createServerFn({ method: "GET" }).validator((input) => mediaProof(input)).handler(async ({ data }) => {
	const sql = await mediaSql();
	const row = (await sql`
      select slug, mime, chunks, provider from circle_media where id = ${data.id} limit 1
    `)[0];
	if (!row) return null;
	if (!(await audioReadable(row, data))) return null;
	const chunks = Number(row.chunks);
	if (!Number.isInteger(chunks) || chunks < 1 || chunks > 40) return null;
	return {
		mime: row.mime || "application/octet-stream",
		chunks
	};
});
export const fetchCircleMediaPart = createServerFn({ method: "GET" }).validator((input) => {
	const proof = mediaProof(input);
	const body = input && typeof input === "object" ? input : {};
	if (typeof body.idx !== "number" || !Number.isInteger(body.idx) || body.idx < 0 || body.idx > 39) throw new Error("That photo could not be opened.");
	return { ...proof, idx: body.idx };
}).handler(async ({ data }) => {
	const sql = await mediaSql();
	const meta = (await sql`select slug, mime, provider from circle_media where id = ${data.id} limit 1`)[0];
	if (!meta || !(await audioReadable(meta, data))) return null;
	const row = (await sql`
      select data from circle_media_part where id = ${data.id} and idx = ${data.idx} limit 1
    `)[0];
	if (!row?.data) return null;
	return { data: row.data };
});
export const deleteCircleMedia = createServerFn({ method: "POST" }).validator((input) => {
	if (!input || typeof input !== "object") throw new Error("That file could not be removed.");
	const body = input;
	const slug = cleanSlug(body.slug);
	const id = cleanMediaId(body.id);
	const editKey = typeof body.editKey === "string" ? body.editKey : "";
	const mediaKey = typeof body.mediaKey === "string" ? body.mediaKey : "";
	if (editKey.length < 16 && mediaKey.length < 16) throw new Error("That file could not be removed.");
	return { slug, id, editKey, mediaKey };
}).handler(async ({ data }) => {
	const sql = await mediaSql();
	const row = (await (await coreSql())`
      select edit_key, payload->>'mediaKey' as media_key from circles where slug = ${data.slug} limit 1
    `)[0];
	if (!row) return { ok: false };
	const allowed = data.editKey.length >= 16 && row.edit_key === data.editKey || data.mediaKey.length >= 16 && row.media_key === data.mediaKey;
	if (!allowed) return { ok: false };
	await sql`delete from circle_media_remote where id = ${data.id}`;
	await sql`delete from circle_media_part where id = ${data.id}`;
	await sql`delete from circle_media where id = ${data.id} and slug = ${data.slug}`;
	return { ok: true };
});
