// Recovered from the last production bundle, then extended for landing pins,
// message author ids, and bride/groom access. Do not treat this file as a rewrite.
// @ts-nocheck
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { mergeChats, mergeNotes, mergePosts } from "./activity.ts";
import { VENDORS } from "./catalog.ts";
import { circleKey, deletedSlugList, isDeletedSlug, rememberCircleKey, rememberDeletedSlug } from "./circle-key.ts";
import { rememberEntryCode } from "./member-key.ts";
import { mergeParkedMemberships, mergeParkedWeddings, parkSignedOutSession, takeParkedSession } from "./account-session.ts";
import { fontsFromRemote, sanitizeFonts } from "./fonts.ts";
import { assignCoupleSeat, claimAcrossWeddings, mergeCoupleAccess } from "./couple-access.ts";
import { overPlanStorage, retainVerifiedPayment, storageMessage, storedMediaBytes, weddingStorageBytes } from "./plan.ts";
import { canManage, canPost, codeMatch, codesOf, googleMapsLink, isCircleOwner, isSampleCircle, nowLabel, slugify, uid } from "./format.ts";
import { accountSenderId } from "./identity.ts";
import { dropNamed, mergeProfiles, ownMemberKey, prepareProfile } from "./guest-profile.ts";
import { canEnterWedding, landingUserKey } from "./landing-pin.ts";
import { blankChats, SEED_ID, seedWedding } from "./seed.ts";
import { CHECKLIST, THEME_SRCS } from "./traditions.ts";
import { parkLegacyFrame, sanitizeBar } from "./bar-layout.ts";
import { reconcileCreator } from "./host-identity.ts";
import { isAssignableThemeId } from "@/lib/wedding/card-themes";
import { remoteThemeChoice, themeRevOf } from "./theme-sync.ts";
import { LIVING_BY_ID } from "./backgrounds.ts";
import { shellWedding } from "./offline.ts";
import type { Account, FeedbackNote, Membership, Notice, Report, Viewer, Wedding } from "./types.ts";
import type { StoreApi, UseBoundStore } from "zustand";

type WeddingStore = {
	weddings: Wedding[];
	viewer: Viewer;
	accounts: Account[];
	account: Account | null;
	pendingSignup: any;
	notices: Notice[];
	reports: Report[];
	feedback: FeedbackNote[];
	guestLocks: Record<string, boolean>;
	memberships: Membership[];
	pulse: { slug: string; feed: string[]; chats: Record<string, string[]> };
	landingPins: Record<string, string>;
	pinNotice: string | null;
	[key: string]: any;
};

type WeddingStoreHook = UseBoundStore<StoreApi<WeddingStore>> & {
	persist: {
		hasHydrated: () => boolean;
		onFinishHydration: (fn: () => void) => (() => void) | void;
		rehydrate: () => Promise<void> | void;
	};
};

function seatCouple(state, wedding, access, role, name) {
	const email = (state.account?.email ?? "").trim().toLowerCase();
	const payingOwner = Boolean(email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === email);
	const onThis = state.viewer.weddingId === wedding.id;
	const alreadyManager = onThis && (state.viewer.role === "host" || state.viewer.role === "cohost");
	const keepHost = payingOwner || alreadyManager;
	const viewer = keepHost ? {
		...state.viewer,
		name: state.viewer.name || name,
		weddingId: wedding.id,
		role: payingOwner ? "host" : state.viewer.role
	} : {
		name,
		role: "guest",
		weddingId: wedding.id,
		coded: false,
		side: role === "bride" ? "Bride" : "Groom"
	};
	const clean = (viewer.name || name).trim();
	const side = role === "bride" ? "Bride" : "Groom";
	const existing = (state.memberships ?? []).find((item) => item.slug === wedding.slug);
	const keepMembership = keepHost || Boolean(existing?.email && existing.email !== email);
	return {
		weddings: patch(state.weddings, wedding.id, (item) => {
			const known = item.guests.find((guest) => guest.name.trim().toLowerCase() === clean.toLowerCase());
			const guests = known ? item.guests.map((guest) => guest.id === known.id ? {
				...guest,
				joined: true,
				side
			} : guest) : [...item.guests, {
				id: uid(),
				name: clean,
				side,
				group: side,
				relationship: side,
				rsvp: "yes",
				count: 1,
				joined: true,
				arrived: false,
				blocked: false,
				contributor: false
			}];
			return { ...item, coupleAccess: access, guests };
		}),
		viewer,
		memberships: keepMembership ? state.memberships : upsertMembership(state.memberships, {
			slug: wedding.slug,
			email,
			name: clean,
			role: "guest"
		})
	};
}

function markDelivery(weddingId, mark, delivery) {
	useWeddingStore.setState((state) => ({ weddings: state.weddings.map((item) => {
		if (item.id !== weddingId) return item;
		if (mark.kind === "post") return {
			...item,
			posts: item.posts.map((post) => post.id === mark.id ? { ...post, delivery } : post)
		};
		return {
			...item,
			chats: item.chats.map((chat) => chat.id !== mark.chatId ? chat : {
				...chat,
				messages: chat.messages.map((message) => message.id === mark.id ? { ...message, delivery } : message)
			})
		};
	}) }));
}
function queueActivity(weddingId, name, activity, mark) {
	const offline = typeof navigator !== "undefined" && navigator.onLine === false;
	if (offline && mark) {
		markDelivery(weddingId, mark, "pending");
		void import("./offline-sync").then((mod) => mod.noteOfflineSend(useWeddingStore.getState().account, weddingId, name, activity, mark));
		return;
	}
	import("./publish.ts").then(async ({ pushActivity }) => {
		const wedding = useWeddingStore.getState().weddings.find((item) => item.id === weddingId);
		if (!wedding) return;
		const result = await pushActivity(wedding, name, activity);
		if (result === "offline") {
			if (mark) {
				markDelivery(weddingId, mark, "pending");
				void import("./offline-sync").then((mod) => mod.noteOfflineSend(useWeddingStore.getState().account, weddingId, name, activity, mark));
			}
			const { toast } = await import("sonner");
			toast("Pending — not sent. It stays on this phone until the connection returns.");
			return;
		}
		if (result === "failed") {
			const { toast } = await import("sonner");
			toast("That stayed on this phone. Other people cannot see it yet.");
		}
		if (!mark || result === "local") return;
		if (result === "denied") {
			markDelivery(weddingId, mark, "failed");
			return;
		}
		markDelivery(weddingId, mark, result === "ok" ? "sent" : "failed");
	});
}
async function commitCeremony(weddingId, activity) {
	const wedding = useWeddingStore.getState().weddings.find((item) => item.id === weddingId);
	if (!wedding) return "failed";
	const { pushActivity, pushCircle } = await import("./publish.ts");
	const result = await pushActivity(wedding, useWeddingStore.getState().viewer.name, activity);
	if (result === "ok" || result === "local" || result === "offline") return result;
	if (result === "denied") return "failed";
	if (!circleKey(wedding.slug)) return "failed";
	const latest = useWeddingStore.getState().weddings.find((item) => item.id === weddingId);
	if (!latest) return "failed";
	return await pushCircle(latest) === "ok" ? "ok" : "failed";
}
function ceremonyFields(fn) {
	const name = fn.name.trim().slice(0, 80);
	const date = fn.date.trim();
	const time = fn.time.trim();
	if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
	const end = (fn.endTime ?? "").trim();
	const address = (fn.address ?? "").trim().slice(0, 200);
	const dress = (fn.dress ?? "").trim().slice(0, 80);
	const mapsRaw = (fn.mapsUrl ?? "").trim();
	const mapsUrl = googleMapsLink(mapsRaw);
	if (mapsRaw && !mapsUrl) return null;
	const coverKind = ceremonyCoverKindOf(fn.coverKind);
	const cover = ceremonyCoverValue(fn.cover);
	return {
		name,
		date,
		time,
		endTime: /^\d{2}:\d{2}$/.test(end) ? end : void 0,
		venue: (fn.venue ?? "").trim().slice(0, 120),
		address: address || void 0,
		dress: dress || void 0,
		note: (fn.note ?? "").trim().slice(0, 500),
		mapsUrl: mapsUrl || void 0,
		cover,
		coverKind
	};
}
function backfillMemberships(weddings, account, saved) {
	const list = (saved ?? []).filter((item) => item && typeof item.slug === "string" && item.slug && item.slug !== "lila-nico");
	const seen = new Set(list.map((item) => item.slug));
	const email = account?.email?.trim().toLowerCase() ?? "";
	const name = account?.name?.trim().toLowerCase() ?? "";
	for (const wedding of weddings) {
		if (isSampleCircle(wedding) || seen.has(wedding.slug)) continue;
		const ownerEmail = wedding.ownerEmail?.trim().toLowerCase() ?? "";
		const deviceHost = Boolean(circleKey(wedding.slug) && (!email || !ownerEmail || ownerEmail === email));
		const emailHost = Boolean(email && ownerEmail === email);
		const owner = deviceHost || emailHost;
		const joined = Boolean(name && Array.isArray(wedding.guests) && wedding.guests.some((guest) => guest.joined && !guest.blocked && guest.name.trim().toLowerCase() === name));
		if (!owner && !joined) continue;
		list.push({
			slug: wedding.slug,
			email,
			name: account?.name ?? "",
			role: owner ? "host" : "guest",
			accountId: owner && account?.id ? account.id : ""
		});
		seen.add(wedding.slug);
	}
	return list.slice(0, 40);
}
function ownerManaged(state, wedding) {
	const accountId = state.account?.id || "";
	return Boolean(wedding && accountId && wedding.ownerId && wedding.ownerId === accountId);
}
function upsertMembership(list, item) {
	const slug = item.slug.trim().toLowerCase();
	if (!slug || slug === "lila-nico") return list ?? [];
	const next = (list ?? []).filter((row) => row.slug !== slug);
	next.unshift({
		slug,
		email: (item.email || "").trim().toLowerCase(),
		name: (item.name || "").trim().slice(0, 80),
		role: item.role,
		accountId: typeof item.accountId === "string" ? item.accountId : ""
	});
	return next.slice(0, 40);
}
function keepLocalGuests(local, remote) {
	const merged = remote.map((guest) => {
		if (!local.find((item) => item.name.trim().toLowerCase() === guest.name.trim().toLowerCase())?.joined || guest.blocked) return guest;
		return {
			...guest,
			joined: true
		};
	});
	const seen = new Set(merged.map((guest) => guest.name.trim().toLowerCase()));
	for (const guest of local) {
		if (!guest.joined || guest.blocked) continue;
		const name = guest.name.trim().toLowerCase();
		if (!name || seen.has(name)) continue;
		merged.push(guest);
		seen.add(name);
	}
	return merged;
}
function patch(weddings, id, fn) {
	return weddings.map((w) => {
		if (w.id !== id) return w;
		if (isSampleCircle(w)) return w;
		return fn(w);
	});
}
function wName(weddings, weddingId, functionId) {
	const fn = weddings.find((w) => w.id === weddingId)?.functions.find((f) => f.id === functionId);
	return fn ? `${fn.name} is live for the circle.` : "A function is live.";
}
function lensFor(wedding, role, coded = false) {
	if (role === "host") return {
		name: wedding.hostName,
		role,
		weddingId: wedding.id,
		coded: true
	};
	if (role === "cohost") return {
		name: wedding.cohostNames?.[0] ?? wedding.guests.find((g) => g.name !== wedding.hostName)?.name ?? "Co-host",
		role,
		weddingId: wedding.id,
		coded: true
	};
	if (role === "planner") return {
		name: wedding.guests.find((g) => g.side === "Team")?.name ?? "Planner",
		role,
		weddingId: wedding.id,
		coded: false
	};
	if (coded) return {
		name: wedding.guests.find((g) => g.contributor && g.name !== wedding.hostName)?.name ?? "Guest",
		role: "guest",
		weddingId: wedding.id,
		coded: true
	};
	return {
		name: wedding.guests.find((g) => !g.contributor && g.name !== wedding.hostName && g.side !== "Team")?.name ?? "Guest",
		role: "guest",
		weddingId: wedding.id,
		coded: false
	};
}
function claimAccount(state, account) {
	let weddings = state.weddings;
	let memberships = state.memberships ?? [];
	let landingPins = { ...state.landingPins ?? {} };
	let notices = state.notices;
	let reports = state.reports;
	const currentId = accountSenderId(state.account);
	const nextId = accountSenderId(account);
	if (state.account && currentId && currentId !== nextId) {
		const parked = parkSignedOutSession(state, state.account);
		weddings = parked.weddings;
		memberships = parked.memberships;
		landingPins = parked.landingPins;
		notices = parked.notices;
		reports = parked.reports;
	}
	const brought = takeParkedSession(account);
	if (brought) {
		weddings = mergeParkedWeddings(weddings, brought.weddings ?? []);
		memberships = mergeParkedMemberships(memberships, brought.memberships ?? []);
		if (brought.pinId && nextId) landingPins[nextId] = brought.pinId;
	}
	return {
		weddings,
		memberships,
		landingPins,
		notices,
		reports,
		viewerOk: weddings.some((w) => w.id === state.viewer?.weddingId)
	};
}
function note(author, text, extra) {
	return {
		id: uid(),
		author,
		authorId: accountSenderId(useWeddingStore.getState().account) || undefined,
		text,
		atLabel: nowLabel(),
		image: extra?.image,
		video: extra?.video,
		videoSeconds: extra?.videoSeconds,
		replyTo: extra?.replyTo,
		reactions: []
	};
}
function pushNotice(notices, notice) {
	return [{
		...notice,
		id: uid(),
		atLabel: nowLabel(),
		read: false
	}, ...notices].slice(0, 40);
}
function toggleReaction(list, author, kind, memberKey) {
	const current = list ?? [];
	const same = (item) => memberKey ? item.memberKey === memberKey || !item.memberKey && item.author === author : item.author === author;
	if (current.find(same)?.kind === kind) return current.filter((item) => !same(item));
	return [...current.filter((item) => !same(item)), {
		author,
		kind,
		...(memberKey ? { memberKey } : {})
	}];
}
var starterNotices = [
	{
		id: "n1",
		weddingId: SEED_ID,
		title: "Ceremony is live",
		body: "Lila and Nico opened the hall for anyone who could not travel.",
		atLabel: "11:00 AM",
		read: false,
		kind: "live"
	},
	{
		id: "n2",
		weddingId: SEED_ID,
		title: "New announcement",
		body: "The ceremony is in the Glass Hall at 11:00.",
		atLabel: "10:48 AM",
		read: false,
		kind: "announcement"
	},
	{
		id: "n3",
		weddingId: SEED_ID,
		title: "Friends shared a drawing",
		body: "The dinner table is in the album.",
		atLabel: "Yesterday",
		read: true,
		kind: "photo"
	}
];
const themeEpoch = new Map();
const themePushTail = new Map();
let themeEpochSeq = 1;
function remoteCardTheme(current, remote) {
	const lock = themeEpoch.get(current.id);
	const choice = remoteThemeChoice(current, remote, lock);
	if (choice.clearLock) themeEpoch.delete(current.id);
	return choice;
}
var memoryStorage = {
	getItem: (key) => {
		if (typeof window === "undefined") return null;
		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) return null;
			JSON.parse(raw);
			return raw;
		} catch {
			return null;
		}
	},
	setItem: (key, value) => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.setItem(key, value);
		} catch {}
	},
	removeItem: (key) => {
		if (typeof window === "undefined") return;
		try {
			window.localStorage.removeItem(key);
		} catch {}
	}
};
var DEVELOPER = {
	id: "00000000-0000-4000-8000-000000000001",
	name: "Circle developer",
	email: "developer@weddingcircle.app",
	phone: "9810000499",
	passwordHash: "3aa2ee3c2f232c1dd47a2246402f34c2190663dcf5f57572f034abd66c796717",
	developer: true,
	country: "India"
};
var DEVELOPER_EMAILS = ["developer@weddingcircle.app", "singhsaab6812@gmail.com"];
export function isDeveloperEmail(email) {
	return DEVELOPER_EMAILS.includes(email.trim().toLowerCase());
}
function asDeveloper(account) {
	const withId = account && typeof account.id === "string" && account.id.length >= 16 ? account : {
		...account,
		id: uid()
	};
	return isDeveloperEmail(withId.email) ? {
		...withId,
		developer: true
	} : withId;
}
function withDeveloper(accounts) {
	const list = (accounts ?? []).map(asDeveloper);
	if (list.some((account) => account.email === DEVELOPER.email)) return list;
	return [DEVELOPER, ...list];
}
const weddingStore = create()(persist((set, get) => ({
	weddings: [structuredClone(seedWedding)],
	viewer: lensFor(seedWedding, "guest", false),
	accounts: [DEVELOPER],
	account: null,
	pendingSignup: null,
	notices: starterNotices,
	reports: [],
	feedback: [],
	guestLocks: {},
	memberships: [],
	pulse: {
		slug: "",
		feed: [],
		chats: {}
	},
	landingPins: {} as Record<string, string>,
	pinNotice: null as string | null,
	beginSignup: (pending) => {
		const email = pending.email.trim().toLowerCase();
		const phone = pending.phone;
		if (!email && !phone) return "exists";
		if (get().accounts.some((a) => email && a.email === email || phone && a.phone === phone)) return "exists";
		set({ pendingSignup: {
			...pending,
			email,
			phone
		} });
		return "ok";
	},
	confirmSignup: (emailCode, phoneCode) => {
		const pending = get().pendingSignup;
		if (!pending) return "bad";
		if (pending.email && pending.emailCode !== emailCode.trim()) return "bad";
		if (pending.phone && pending.phoneCode !== phoneCode.trim()) return "bad";
		if (!pending.email && !pending.phone) return "bad";
		return get().register({
			name: pending.name,
			email: pending.email,
			phone: pending.phone,
			passwordHash: pending.passwordHash,
			country: pending.country ?? "",
			religion: pending.religion ?? "",
			tradition: pending.tradition ?? ""
		}) === "ok" ? "ok" : "bad";
	},
	signInWithPassword: (identifier, passwordHash) => {
		const id = identifier.trim().toLowerCase();
		const digits = identifier.replace(/\D/g, "");
		const phone = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
		const found = get().accounts.find((a) => id.includes("@") && a.email === id || phone.length === 10 && a.phone === phone);
		if (!found || found.passwordHash !== passwordHash) return "bad";
		const account = asDeveloper(found);
		const session = claimAccount(get(), account);
		set((s) => ({
			accounts: s.accounts.map((item) => item.email === account.email && item.phone === account.phone ? account : item),
			account,
			weddings: session.weddings,
			memberships: session.memberships,
			landingPins: session.landingPins,
			notices: session.notices,
			reports: session.reports,
			viewer: {
				...s.viewer,
				name: account.name,
				...(session.viewerOk ? {} : {
					role: "guest",
					coded: false,
					weddingId: SEED_ID
				})
			}
		}));
		return "ok";
	},
	signInLinkedAccount: ({ id, name, email, country, phone, firebaseUid }) => {
		const clean = String(email || "").trim().toLowerCase();
		const uid = String(firebaseUid || "").trim();
		if (!clean || uid.length < 4) return "bad";
		const existing = get().accounts.find((account) => account.email === clean);
		const passwordHash = existing?.passwordHash || `firebase:${uid}`;
		const account = asDeveloper({
			...(existing || {}),
			id: typeof id === "string" && id.length >= 16 ? id : existing?.id || uid(),
			name: (existing?.name || String(name || "").trim() || clean.split("@")[0] || "Guest").trim(),
			email: clean,
			phone: existing?.phone || String(phone || ""),
			passwordHash,
			country: existing?.country || String(country || ""),
			firebaseUid: uid
		});
		const session = claimAccount(get(), account);
		set((s) => ({
			accounts: existing ? s.accounts.map((item) => item.email === clean ? account : item) : [...s.accounts, account],
			account,
			pendingSignup: null,
			weddings: session.weddings,
			memberships: session.memberships,
			landingPins: session.landingPins,
			notices: session.notices,
			reports: session.reports,
			viewer: {
				...s.viewer,
				name: account.name,
				...(session.viewerOk ? {} : {
					role: "guest",
					coded: false,
					weddingId: SEED_ID
				})
			}
		}));
		return "ok";
	},
	signInWithGoogle: ({ name, email, sub }) => {
		const clean = email.trim().toLowerCase();
		if (!clean || !sub.trim()) return;
		const existing = get().accounts.find((account) => account.email === clean);
		if (existing) {
			const account = asDeveloper({
				...existing,
				name: existing.name || name.trim() || existing.email
			});
			const session = claimAccount(get(), account);
			set((s) => ({
				accounts: s.accounts.map((item) => item.email === clean ? account : item),
				account,
				weddings: session.weddings,
				memberships: session.memberships,
				landingPins: session.landingPins,
				notices: session.notices,
				reports: session.reports,
				viewer: {
					...s.viewer,
					name: account.name,
					...(session.viewerOk ? {} : {
						role: "guest",
						coded: false,
						weddingId: SEED_ID
					})
				}
			}));
			return;
		}
		const account = asDeveloper({
			name: name.trim() || clean.split("@")[0] || "Guest",
			email: clean,
			phone: "",
			passwordHash: `google:${sub.trim()}`,
			country: ""
		});
		const session = claimAccount(get(), account);
		set((s) => ({
			accounts: [...s.accounts, account],
			account,
			pendingSignup: null,
			weddings: session.weddings,
			memberships: session.memberships,
			landingPins: session.landingPins,
			notices: session.notices,
			reports: session.reports,
			viewer: {
				...s.viewer,
				name: account.name,
				role: "guest",
				coded: false,
				...(session.viewerOk ? {} : { weddingId: SEED_ID })
			}
		}));
	},
	register: (input) => {
		const email = input.email.trim().toLowerCase();
		const phone = input.phone;
		if (!email && !phone) return "missing";
		if (get().accounts.some((a) => email && a.email === email || phone && a.phone === phone)) return "exists";
		const account = asDeveloper({
			name: input.name.trim(),
			email,
			phone,
			passwordHash: input.passwordHash,
			country: typeof input.country === "string" ? input.country.trim().slice(0, 80) : "",
			religion: input.religion,
			tradition: input.tradition
		});
		const session = claimAccount(get(), account);
		set((s) => ({
			accounts: [...s.accounts, account],
			account,
			pendingSignup: null,
			weddings: session.weddings,
			memberships: session.memberships,
			landingPins: session.landingPins,
			notices: session.notices,
			reports: session.reports,
			viewer: {
				...s.viewer,
				name: account.name,
				role: "guest",
				coded: false,
				...(session.viewerOk ? {} : { weddingId: SEED_ID })
			}
		}));
		return "ok";
	},
	signOutAccount: () => {
		const state = get();
		void import("./offline-sync").then((mod) => mod.clearAccountCache(state.account));
		const parked = parkSignedOutSession(state, state.account);
		const sample = parked.weddings.find((w) => w.id === "lila-nico") ?? parked.weddings.find((w) => isSampleCircle(w));
		set({
			account: null,
			weddings: parked.weddings,
			memberships: parked.memberships,
			landingPins: parked.landingPins,
			notices: parked.notices,
			reports: parked.reports,
			viewer: sample ? lensFor(sample, "guest", false) : {
				name: "Guest",
				role: "guest",
				weddingId: SEED_ID,
				coded: false
			}
		});
	},
	addFeedback: (text, fromName) => set((s) => ({ feedback: [{
		id: uid(),
		text: text.trim(),
		fromName: fromName.trim() || "Guest",
		atLabel: nowLabel()
	}, ...s.feedback].slice(0, 80) })),
	markNoticesRead: () => set((s) => ({ notices: s.notices.map((n) => ({
		...n,
		read: true
	})) })),
	setRole: () => void 0,
	setCodedGuest: () => void 0,
	applyAuthorizedRole: (weddingId, role) => set((s) => {
		if (s.viewer.weddingId !== weddingId) return s;
		const wedding = s.weddings.find((item) => item.id === weddingId);
		const accountId = s.account?.id || "";
		if (wedding?.ownerId && accountId && wedding.ownerId === accountId && role !== "host") return s;
		const coded = role !== "guest";
		const next = role === "host" || role === "cohost" ? role : "guest";
		if (s.viewer.role === next && Boolean(s.viewer.coded) === coded) return s;
		return { viewer: {
			...s.viewer,
			role: next,
			coded
		} };
	}),
	raiseWithCode: () => "bad",
	setViewerSide: (side) => set((s) => {
		const name = s.viewer.name.trim().toLowerCase();
		const current = s.weddings.find((w) => w.id === s.viewer.weddingId);
		if (!current || isSampleCircle(current)) return { viewer: {
			...s.viewer,
			side
		} };
		return {
			viewer: {
				...s.viewer,
				side
			},
			weddings: s.weddings.map((w) => w.id !== s.viewer.weddingId ? w : {
				...w,
				guests: w.guests.some((g) => g.name.toLowerCase() === name) ? w.guests.map((g) => g.name.toLowerCase() === name ? {
					...g,
					side,
					group: `${side}'s side`
				} : g) : [...w.guests, {
					id: uid(),
					name: s.viewer.name,
					side,
					group: `${side}'s side`,
					rsvp: "yes",
					count: 1,
					joined: true,
					arrived: false,
					contributor: Boolean(s.viewer.coded)
				}]
			})
		};
	}),
	setTheme: (weddingId, src, focus) => set((s) => {
		const ownPhoto = src.startsWith("data:image/");
		const storedPhoto = src.startsWith("r2:weddings/") && !src.includes("..") && src.length < 300;
		const libraryPhoto = src.startsWith("/media/") || src.startsWith("/library/") || src.startsWith("/covers/") || src.startsWith("/api/library/");
		if (!THEME_SRCS.has(src) && !ownPhoto && !libraryPhoto && !storedPhoto) return s;
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding) return s;
		const namedCohost = (wedding.cohostNames ?? []).some((name) => name.toLowerCase() === s.viewer.name.toLowerCase());
		if (s.viewer.role !== "host" && s.viewer.role !== "cohost" && !namedCohost) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			cover: src,
			coverFocus: focus || "center",
			illustrated: false,
			coverVideo: ""
		})) };
	}),
	setFeedSides: (weddingId, sides) => {
		const state = get();
		const wedding = state.weddings.find((w) => w.id === weddingId);
		if (!wedding || state.viewer.role !== "host" || isSampleCircle(wedding)) return;
		if (!isFeedSideId(sides.bride) || !isFeedSideId(sides.groom)) return;
		set({ weddings: patch(state.weddings, weddingId, (w) => ({
			...w,
			feedSides: {
				bride: sides.bride,
				groom: sides.groom
			}
		})) });
		const next = get().weddings.find((w) => w.id === weddingId);
		if (next) import("./publish.ts").then(({ pushCircle }) => pushCircle(next));
	},
	setCardTheme: (weddingId, themeId) => {
		if (!isAssignableThemeId(themeId)) return "invalid";
		const state = get();
		const wedding = state.weddings.find((w) => w.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) return "denied";
		const settle = (ok) => {
			if (typeof window === "undefined") return;
			window.dispatchEvent(new CustomEvent("wc-theme-settle", { detail: { weddingId, themeId, ok } }));
		};
		const existing = themeEpoch.get(weddingId);
		if (wedding.cardTheme === themeId && !existing?.failed) {
			settle(true);
			return "ok";
		}
		const previous = existing?.previous ?? wedding.cardTheme;
		const epoch = themeEpochSeq++;
		const nextRev = Math.max(themeRevOf(wedding), themeRevOf(existing)) + 1;
		const parkedBar = parkLegacyFrame(wedding.bar, wedding.cardTheme);
		const barMoved = parkedBar !== wedding.bar;
		themeEpoch.set(weddingId, { id: themeId, epoch, previous, failed: false, themeRev: nextRev });
		set({ weddings: patch(state.weddings, weddingId, (w) => ({
			...w,
			cardTheme: themeId,
			themeRev: nextRev,
			rev: Number(w.rev ?? 0) + 1,
			...(barMoved ? { bar: parkedBar } : {})
		})) });
		if (barMoved) {
			const savedBar = get().weddings.find((w) => w.id === weddingId);
			if (savedBar) void import("./publish.ts").then(({ pushWeddingBar }) => pushWeddingBar(savedBar));
		}
		const prev = themePushTail.get(weddingId) || Promise.resolve();
		const run = prev.catch(() => undefined).then(async () => {
			const lock = themeEpoch.get(weddingId);
			if (!lock || lock.epoch !== epoch) return;
			const latest = get().weddings.find((w) => w.id === weddingId);
			if (!latest || latest.cardTheme !== themeId) return;
			const { pushCardTheme } = await import("./publish.ts");
			if (themeEpoch.get(weddingId)?.epoch !== epoch) return;
			const result = await pushCardTheme(latest);
			if (themeEpoch.get(weddingId)?.epoch !== epoch) return;
			if (result === "ok") {
				themeEpoch.delete(weddingId);
				const { toast } = await import("sonner");
				toast("Theme applied to this wedding.");
				settle(true);
				return;
			}
			const stuck = themeEpoch.get(weddingId);
			if (stuck && stuck.epoch === epoch) stuck.failed = true;
			const { toast } = await import("sonner");
			toast(result === "offline"
				? "The theme could not be saved. You are offline. It is still showing on this phone."
				: result === "denied"
					? "Only a host or co-host can save this theme for everyone. It is still showing on this phone."
					: "That theme could not be saved. It is still showing on this phone.");
			settle(false);
		});
		themePushTail.set(weddingId, run);
		return "ok";
	},
	setWeddingFonts: (weddingId, fonts) => {
		const state = get();
		const wedding = state.weddings.find((w) => w.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) return "denied";
		const next = sanitizeFonts(fonts) ?? {};
		set({ weddings: patch(state.weddings, weddingId, (w) => ({
			...w,
			fonts: next,
			rev: Number(w.rev ?? 0) + 1
		})) });
		const saved = get().weddings.find((w) => w.id === weddingId);
		if (saved) void import("./publish.ts").then(({ pushCircle }) => pushCircle(saved));
		return "ok";
	},
	setWeddingBar: (weddingId, layout) => {
		const state = get();
		const wedding = state.weddings.find((w) => w.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) return "denied";
		const bar = sanitizeBar(layout);
		set({ weddings: patch(state.weddings, weddingId, (w) => ({
			...w,
			bar,
			rev: Number(w.rev ?? 0) + 1
		})) });
		const saved = get().weddings.find((w) => w.id === weddingId);
		if (saved) {
			void import("./publish.ts").then(async ({ pushWeddingBar }) => {
				const result = await pushWeddingBar(saved);
				if (result === "ok") return;
				const { toast } = await import("sonner");
				toast(result === "denied"
					? "Only a host or co-host can save the wedding bar. It is still showing on this phone."
					: "The wedding bar could not be saved. It is still showing on this phone.");
			});
		}
		return "ok";
	},
	setPageBackground: (weddingId, background) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canManage(wedding, s.viewer)) return s;
		if (!LIVING_BY_ID[background.style]) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			pageBackground: {
				style: background.style,
				motion: background.motion,
				reduce: background.reduce
			}
		})) };
	}),
	setCoverVideo: (weddingId, src) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !src) return s;
		const namedCohost = (wedding.cohostNames ?? []).some((name) => name.toLowerCase() === s.viewer.name.toLowerCase());
		if (s.viewer.role !== "host" && s.viewer.role !== "cohost" && !namedCohost) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			coverVideo: src
		})) };
	}),
	addBefore: (weddingId, input) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canContribute(wedding, s.viewer)) return s;
		const item = {
			id: uid(),
			author: input.author,
			text: input.text.trim(),
			images: input.images,
			atLabel: nowLabel(),
			kind: input.kind,
			video: input.video,
			videoSeconds: input.videoSeconds,
			side: input.side
		};
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			beforeNotes: [item, ...w.beforeNotes ?? []]
		})) };
	}),
	removeBefore: (weddingId, itemId) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		beforeNotes: (w.beforeNotes ?? []).filter((item) => item.id !== itemId),
		coverVideo: (w.beforeNotes ?? []).some((item) => item.id === itemId && item.video && item.video === w.coverVideo) ? "" : w.coverVideo
	})) })),
	shareBeforeHome: (weddingId, itemId) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || isSampleCircle(wedding)) return s;
		const item = (wedding.beforeNotes ?? []).find((note) => note.id === itemId);
		if (!item?.video || item.kind !== "video") return s;
		if (!(item.author.trim().toLowerCase() === s.viewer.name.trim().toLowerCase()) && !canManage(wedding, s.viewer)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			beforeNotes: (w.beforeNotes ?? []).map((note) => note.id === itemId ? {
				...note,
				onHome: !note.onHome
			} : note)
		})) };
	}),
	watchLive: (weddingId, name) => set((s) => {
		const clean = name.trim();
		if (!clean) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => {
			const viewers = w.liveViewers ?? [];
			if (viewers.some((item) => item.toLowerCase() === clean.toLowerCase())) return w;
			return {
				...w,
				liveViewers: [...viewers, clean]
			};
		}) };
	}),
	markNoticeRead: (id) => set((s) => ({ notices: s.notices.map((n) => n.id === id ? {
		...n,
		read: true
	} : n) })),
	focusWedding: (weddingId) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding) return s;
		const ownerEmail = (wedding.ownerEmail || "").trim().toLowerCase();
		const matching = ownerEmail ? s.accounts.filter((account) => (account.email || "").trim().toLowerCase() === ownerEmail).length : 0;
		const decision = reconcileCreator({
			ownerId: wedding.ownerId,
			ownerEmail: wedding.ownerEmail,
			accountId: s.account?.id || "",
			accountEmail: s.account?.email || "",
			matchingAccounts: matching,
			hasEditKey: Boolean(circleKey(wedding.slug))
		});
		const membership = (s.memberships ?? []).find((item) => item.slug === wedding.slug && s.account?.id && item.accountId === s.account.id);
		let role = "guest";
		let coded = false;
		if (decision.host || membership?.role === "host") role = "host";
		else if (membership?.role === "cohost") role = "cohost";
		else if (membership?.role === "family") {
			role = "guest";
			coded = true;
		} else if (s.viewer.weddingId === weddingId && (s.viewer.role === "host" || s.viewer.role === "cohost" || s.viewer.coded)) return s;
		if (s.viewer.weddingId === weddingId && s.viewer.role === role && Boolean(s.viewer.coded) === coded && !decision.ownerId) return s;
		const nextWedding = decision.ownerId && decision.ownerId !== (wedding.ownerId || "") ? {
			...wedding,
			ownerId: decision.ownerId,
			ownerReview: false
		} : decision.review && !wedding.ownerReview ? {
			...wedding,
			ownerReview: true
		} : null;
		return {
			...(nextWedding ? { weddings: s.weddings.map((item) => item.id === wedding.id ? nextWedding : item) } : {}),
			viewer: {
				name: s.viewer.name,
				role,
				weddingId,
				coded,
				side: s.viewer.side
			}
		};
	}),
	setMode: (weddingId, mode) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		mode
	})) })),
	saveInvitation: (weddingId, invitation, names) => set((s) => {
		const wedding = s.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, s.viewer)) return s;
		const bride = names?.bride?.trim() || wedding.bride;
		const groom = names?.groom?.trim() || wedding.groom;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			invitation,
			bride,
			groom
		})) };
	}),
	saveDetails: (weddingId, details) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) return false;
		const bride = details.bride.trim().slice(0, 80);
		const groom = details.groom.trim().slice(0, 80);
		const date = details.date.trim();
		if (!bride || !groom || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
		set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			bride,
			groom,
			date,
			city: details.city.trim().slice(0, 80),
			place: details.place.trim().slice(0, 120),
			story: details.story.trim().slice(0, 500),
			religion: details.religion.trim().slice(0, 80),
			region: details.region.trim().slice(0, 80),
			weddingType: details.weddingType.trim().slice(0, 80)
		})) }));
		return true;
	},
	setMemory: (weddingId, on) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		showMemory: on
	})) })),
	createWedding: (draft) => {
		if (!get().account) return "";
		let slug = `${slugify(draft.bride, draft.groom)}-${uid().replace(/-/g, "").slice(0, 6)}`;
		const taken = new Set(get().weddings.map((w) => w.slug));
		while (taken.has(slug)) slug = `${slugify(draft.bride, draft.groom)}-${uid().replace(/-/g, "").slice(0, 6)}`;
		const id = uid();
		rememberCircleKey(slug, uid());
		const wedding = {
			id,
			slug,
			bride: draft.bride.trim(),
			groom: draft.groom.trim(),
			hostName: draft.hostName.trim() || draft.bride.trim(),
			date: draft.date,
			city: draft.city.trim(),
			place: draft.place.trim() || draft.city.trim(),
			story: draft.story.trim(),
			cover: draft.cover,
			cardTheme: "classic-default",
			religion: draft.religion,
			region: draft.region,
			cultureNote: draft.cultureNote.trim(),
			mode: "plan",
			functions: draft.functions.map((f) => ({
				id: uid(),
				name: f.name.trim(),
				date: f.date || draft.date,
				time: f.time || "11:00",
				venue: draft.place.trim() || draft.city.trim(),
				note: f.note,
				live: false
			})),
			posts: [],
			guests: [{
				id: uid(),
				name: draft.hostName.trim() || draft.bride.trim(),
				side: "Bride",
				group: "Bride's family",
				rsvp: "yes",
				count: 1,
				joined: true,
				arrived: false
			}],
			chats: blankChats(),
			enquiries: [],
			shortlist: [],
			places: [{
				id: uid(),
				name: draft.place.trim() || "Ceremony",
				kind: "Ceremony",
				detail: draft.city.trim()
			}],
			privacy: {
				join: "link",
				post: "everyone",
				live: "hosts",
				download: true,
				upload: "everyone"
			},
			liveNotes: [],
			sharingLocation: false,
			weddingType: draft.weddingType,
			contactEmail: draft.contactEmail.trim(),
			contactPhone: draft.contactPhone.trim(),
			ownerEmail: draft.ownerEmail.trim(),
			payment: draft.payment,
			showMemory: false,
			illustrated: false,
			cohostNames: [],
			postingCodes: [{
				id: uid(),
				code: `FAMILY-${uid().slice(0, 4).toUpperCase()}`,
				kind: "family"
			}, {
				id: uid(),
				code: `GUEST-${uid().slice(0, 4).toUpperCase()}`,
				kind: "guest"
			}],
			youtubeUrl: "",
			coverVideo: "",
			beforeNotes: [],
			disabled: false,
			mediaKey: uid(),
			tasks: [...CHECKLIST.map((item) => ({
				id: uid(),
				title: item.title,
				owner: draft.hostName.trim() || "Host",
				when: draft.date,
				done: false,
				category: item.category
			}))]
		};
		const email = (get().account?.email || draft.ownerEmail || "").trim().toLowerCase();
		const accountId = get().account?.id || "";
		const owned = {
			...wedding,
			ownerId: accountId
		};
		set((s) => ({
			weddings: [owned, ...s.weddings],
			memberships: upsertMembership(s.memberships, {
				slug,
				email,
				name: wedding.hostName,
				role: "host",
				accountId
			}),
			viewer: {
				name: wedding.hostName,
				role: "host",
				weddingId: id
			},
			notices: pushNotice(s.notices, {
				weddingId: id,
				title: "Wedding circle opened",
				body: `${wedding.bride} & ${wedding.groom} is ready to invite people.`,
				kind: "wedding"
			})
		}));
		return slug;
	},
	adoptCircle: (wedding) => set((s) => {
		if (!wedding?.slug || isDeletedSlug(wedding.slug)) return s;
		const index = s.weddings.findIndex((item) => item.slug === wedding.slug || item.id === wedding.id);
		if (index < 0) return { weddings: [wedding, ...s.weddings] };
		const current = s.weddings[index];
		const incoming = Array.isArray(wedding.postingCodes) ? wedding.postingCodes : [];
		const known = new Set((current.postingCodes ?? []).map((item) => (item.code || "").toUpperCase()));
		const extra = incoming.filter((item) => item.code && !known.has(item.code.toUpperCase()));
		const sameDisabled = Boolean(current.disabled) === Boolean(wedding.disabled);
		if (!extra.length && sameDisabled) return s;
		const next = s.weddings.slice();
		next[index] = {
			...current,
			disabled: Boolean(wedding.disabled),
			postingCodes: [...current.postingCodes ?? [], ...extra]
		};
		return { weddings: next };
	}),
	joinWedding: (slug, name, rsvp, relationship, code, entry) => {
		const wedding = get().weddings.find((w) => w.slug === slug);
		if (!wedding) return "missing";
		const clean = name.trim();
		if (!clean) return "missing";
		if (wedding.disabled && !isCircleOwner(wedding)) return "disabled";
		if (isSampleCircle(wedding)) {
			set((s) => ({ viewer: {
				name: clean,
				role: "guest",
				weddingId: wedding.id,
				coded: false,
				side: s.viewer.side
			} }));
			return "joined";
		}
		if (wedding.guests.find((g) => g.name.toLowerCase() === clean.toLowerCase())?.blocked) return "blocked";
		const matched = codeMatch(wedding, code ?? "");
		if ((entry || code?.trim()) && !matched) return "bad-code";
		if (entry && matched && matched.kind !== entry) return "wrong-kind";
		const family = matched?.kind === "family";
		const pending = wedding.privacy.join === "approve" && !matched;
		if (matched && !isSampleCircle(wedding)) rememberEntryCode(slug, matched.code);
		const side = relationship.startsWith("Bride") ? "Bride" : relationship.startsWith("Groom") ? "Groom" : relationship === "Wedding team" ? "Team" : "Both";
		set((s) => {
			const guestLocks = { ...s.guestLocks ?? {} };
			if (family) delete guestLocks[wedding.id];
			else if (entry === "guest" || matched?.kind === "guest") guestLocks[wedding.id] = true;
			return {
				weddings: patch(s.weddings, wedding.id, (w) => {
					const known = w.guests.find((g) => g.name.toLowerCase() === clean.toLowerCase());
					const guests = known ? w.guests.map((g) => g.id === known.id ? {
						...g,
						rsvp,
						relationship,
						group: relationship,
						side,
						joined: pending ? g.joined : true,
						contributor: g.contributor
					} : g) : [...w.guests, {
						id: uid(),
						name: clean,
						side,
						group: relationship,
						relationship,
						rsvp,
						count: 1,
						joined: !pending,
						arrived: false,
						blocked: false,
						contributor: false
					}];
					return {
						...w,
						guests
					};
				}),
				viewer: {
					name: clean,
					role: "guest",
					weddingId: wedding.id,
					coded: false,
					side: side === "Bride" || side === "Groom" ? side : s.viewer.side
				},
				memberships: upsertMembership(s.memberships, {
					slug: wedding.slug,
					email: (s.account?.email ?? "").trim().toLowerCase(),
					name: clean,
					role: family ? "family" : "guest"
				}),
				notices: pushNotice(s.notices, {
					weddingId: wedding.id,
					title: pending ? "Someone is waiting to join" : "New RSVP",
					body: `${clean} · ${rsvp === "yes" ? "Attending" : rsvp === "no" ? "Not attending" : "Maybe"} · ${relationship}`,
					kind: "rsvp"
				}),
				guestLocks
			};
		});
		return pending ? "pending" : "joined";
	},
	enterFromInvite: (slug, name, side, role) => {
		const wedding = get().weddings.find((item) => item.slug === slug);
		if (!wedding || isSampleCircle(wedding)) return "missing";
		if (role !== "guest" && role !== "family" && role !== "host" && role !== "cohost") return "missing";
		const clean = name.trim();
		if (!clean) return "missing";
		if (side !== "Bride" && side !== "Groom") return "side";
		if (wedding.disabled && !isCircleOwner(wedding)) return "disabled";
		if (wedding.guests.find((guest) => guest.name.toLowerCase() === clean.toLowerCase())?.blocked) return "blocked";
		const rank = { guest: 1, family: 2, cohost: 3, host: 4 };
		set((s) => {
			const currentRank = s.viewer.weddingId === wedding.id
				? s.viewer.role === "host" ? 4 : s.viewer.role === "cohost" ? 3 : s.viewer.coded ? 2 : 1
				: 0;
			const keep = currentRank > rank[role];
			const family = role === "family";
			const guestLocks = { ...s.guestLocks ?? {} };
			if (!keep) {
				if (family || role === "host" || role === "cohost") delete guestLocks[wedding.id];
				else guestLocks[wedding.id] = true;
			}
			const relationship = side === "Bride" ? "Bride's family" : "Groom's family";
			return {
				weddings: patch(s.weddings, wedding.id, (w) => {
					const known = w.guests.find((guest) => guest.name.toLowerCase() === clean.toLowerCase());
					const guests = known ? w.guests.map((guest) => guest.id === known.id ? {
						...guest,
						side,
						group: relationship,
						relationship,
						joined: true
					} : guest) : [...w.guests, {
						id: uid(),
						name: clean,
						side,
						group: relationship,
						relationship,
						rsvp: "yes",
						count: 1,
						joined: true,
						arrived: false,
						blocked: false,
						contributor: false
					}];
					return { ...w, guests };
				}),
				viewer: keep ? s.viewer : {
					name: clean,
					role: role === "host" || role === "cohost" ? role : "guest",
					weddingId: wedding.id,
					coded: role !== "guest",
					side
				},
				memberships: upsertMembership(s.memberships, {
					slug: wedding.slug,
					email: (s.account?.email ?? "").trim().toLowerCase(),
					name: clean,
					role: role === "cohost" || role === "host" || role === "family" ? role : "guest",
					accountId: role === "host" ? s.account?.id || "" : ""
				}),
				guestLocks
			};
		});
		return "joined";
	},
	addPost: (weddingId, input) => {
		const wedding = get().weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canPost(wedding, get().viewer)) return "";
		const mediaSrcs = [
			input.audio?.src,
			input.videoLabel,
			...(input.images ?? []),
			...(input.videos ?? []).map((clip) => clip.src),
			...(input.gallery ?? []).map((item) => item.src),
		].filter((src) => typeof src === "string" && src);
		const extra = [...new Set(mediaSrcs)].reduce((sum, src) => sum + storedMediaBytes(src), 0);
		if (overPlanStorage(wedding, weddingStorageBytes(wedding), extra)) {
			void import("sonner").then(({ toast }) => toast(storageMessage(wedding)));
			return "";
		}
		const id = uid();
		const profile = wedding.guestProfiles?.[ownMemberKey(wedding.slug)];
		const author = profile && !profile.removed && profile.displayName ? profile.displayName : input.author;
		const post = {
			id,
			at: new Date().toISOString(),
			atLabel: nowLabel(),
			author,
			authorId: accountSenderId(get().account) || undefined,
			circle: input.circle,
			kind: input.kind ?? (input.audio?.src ? "audio" : input.videoLabel || input.videos?.length ? "videos" : input.images.length ? "photos" : "text"),
			text: input.text.trim(),
			images: input.images,
			functionId: input.functionId,
			videoLabel: input.videoLabel || input.videos?.[0]?.src,
			videoSeconds: input.videoSeconds || input.videos?.[0]?.seconds,
			videos: input.videos,
			gallery: input.gallery?.length ? input.gallery : undefined,
			audio: input.audio,
			side: input.side,
			accessRule: input.accessRule,
			reactions: [],
			comments: [],
			delivery: "sending"
		};
		set((s) => ({
			weddings: patch(s.weddings, weddingId, (w) => ({
				...w,
				posts: [post, ...w.posts]
			})),
			notices: pushNotice(s.notices, {
				weddingId,
				title: input.audio?.src ? "New voice note" : input.videoLabel || input.videos?.length ? "New video" : input.images.length ? "New photos" : "New post",
				body: `${author}: ${input.text.trim() || (input.audio?.src ? "Voice note" : input.videoLabel || "Shared with the circle")}`,
				kind: input.audio?.src ? "audio" : input.videoLabel || input.videos?.length ? "video" : "photo"
			})
		}));
		queueActivity(weddingId, author, {
			action: "post",
			post
		}, {
			kind: "post",
			id
		});
		return id;
	},
	addComment: (weddingId, postId, author, text, replyTo) => {
		const wedding = get().weddings.find((w) => w.id === weddingId);
		const body = text.trim();
		if (!wedding || isSampleCircle(wedding) || !canPost(wedding, get().viewer) || !body) return "failed";
		const post = wedding.posts.find((item) => item.id === postId && !item.removed);
		if (!post) return "failed";
		if (!(replyTo ? (post.comments ?? []).some((item) => item.id === replyTo) : true)) return "failed";
		const last = (post.comments ?? []).at(-1);
		const profile = wedding.guestProfiles?.[ownMemberKey(wedding.slug)];
		const authorName = profile && !profile.removed && profile.displayName ? profile.displayName : author;
		if (last && last.author === authorName && last.text === body && last.replyTo === replyTo) return "ok";
		const comment = {
			id: uid(),
			author: authorName,
			authorId: accountSenderId(get().account) || undefined,
			text: body,
			atLabel: nowLabel(),
			replyTo
		};
		set((s) => ({
			weddings: patch(s.weddings, weddingId, (w) => ({
				...w,
				posts: w.posts.map((p) => p.id === postId ? {
					...p,
					comments: [...p.comments ?? [], comment]
				} : p)
			})),
			notices: pushNotice(s.notices, {
				weddingId,
				title: "New comment",
				body: `${authorName}: ${body}`,
				kind: "comment"
			})
		}));
		queueActivity(weddingId, authorName, {
			action: "comment",
			postId,
			comment
		});
		return "ok";
	},
	reactToPost: (weddingId, postId, author, kind) => {
		const wedding = get().weddings.find((w) => w.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canPost(wedding, get().viewer)) return;
		const post = wedding.posts.find((item) => item.id === postId && !item.removed);
		if (!post) return;
		const before = post.reactions ?? [];
		const memberKey = ownMemberKey(wedding.slug);
		const profile = wedding.guestProfiles?.[memberKey];
		const name = profile && !profile.removed && profile.displayName ? profile.displayName : author;
		set((s) => ({
			weddings: patch(s.weddings, weddingId, (w) => ({
				...w,
				posts: w.posts.map((p) => p.id === postId ? {
					...p,
					reactions: toggleReaction(p.reactions, name, kind, memberKey)
				} : p)
			}))
		}));
		void import("./publish.ts").then(async ({ pushActivity }) => {
			const current = get().weddings.find((item) => item.id === weddingId);
			if (!current) return;
			const result = await pushActivity(current, name, { action: "react", postId, kind });
			if (result === "ok" || result === "local") return;
			set((s) => ({
				weddings: patch(s.weddings, weddingId, (w) => ({
					...w,
					posts: w.posts.map((p) => p.id === postId ? { ...p, reactions: before } : p)
				}))
			}));
			const { toast } = await import("sonner");
			toast(result === "offline" ? "That reaction was not saved. You are offline." : "That reaction was not saved.");
		});
	},
	removePost: (weddingId, postId) => {
		const wedding = get().weddings.find((item) => item.id === weddingId);
		set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			posts: w.posts.map((p) => p.id === postId ? {
				...p,
				removed: true
			} : p)
		})) }));
		if (wedding && !isSampleCircle(wedding)) queueActivity(weddingId, get().viewer.name, {
			action: "remove-post",
			postId
		});
	},
	reportPost: (weddingId, postId, author, reason) => set((s) => ({ reports: [{
		id: uid(),
		weddingId,
		postId,
		reason,
		atLabel: nowLabel(),
		author
	}, ...s.reports] })),
	addAnnouncement: (weddingId, author, text, audience) => set((s) => ({
		weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			posts: [{
				id: uid(),
				atLabel: nowLabel(),
				author,
				circle: "Wedding team",
				kind: "announcement",
				text: text.trim(),
				images: [],
				audience,
				reactions: [],
				comments: []
			}, ...w.posts]
		})),
		notices: pushNotice(s.notices, {
			weddingId,
			title: "Wedding announcement",
			body: text.trim(),
			kind: "announcement"
		})
	})),
	setRsvp: (weddingId, guestId, rsvp) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		guests: w.guests.map((g) => g.id === guestId ? {
			...g,
			rsvp
		} : g)
	})) })),
	setArrived: (weddingId, guestId, arrived) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		guests: w.guests.map((g) => g.id === guestId ? {
			...g,
			arrived
		} : g)
	})) })),
	addGuest: (weddingId, guest) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		guests: [...w.guests, {
			...guest,
			id: uid(),
			joined: false,
			arrived: false
		}]
	})) })),
	removeGuest: (weddingId, guestId) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, s.viewer)) return s;
		const guest = wedding.guests.find((item) => item.id === guestId);
		const name = guest?.name ?? "";
		if (name && name.trim().toLowerCase() !== wedding.hostName.trim().toLowerCase()) {
			void import("./publish.ts").then(({ pushActivity }) => pushActivity(wedding, s.viewer.name, { action: "drop-profile", guestName: name })).catch(() => undefined);
		}
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			guests: w.guests.map((g) => g.id === guestId && g.name.trim().toLowerCase() !== w.hostName.trim().toLowerCase() ? {
				...g,
				blocked: true,
				joined: false
			} : g),
			guestProfiles: name ? dropNamed(w.guestProfiles, name) : w.guestProfiles
		})) };
	}),
	blockGuest: (weddingId, guestId, blocked) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		const guest = wedding?.guests.find((item) => item.id === guestId);
		if (blocked && wedding && guest && !isSampleCircle(wedding) && canManage(wedding, s.viewer)) {
			void import("./publish.ts").then(({ pushActivity }) => pushActivity(wedding, s.viewer.name, { action: "drop-profile", guestName: guest.name })).catch(() => undefined);
		}
		return { weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		guests: w.guests.map((g) => g.id === guestId ? {
			...g,
			blocked,
			joined: blocked ? false : g.joined
		} : g),
		guestProfiles: blocked && guest ? dropNamed(w.guestProfiles, guest.name) : w.guestProfiles
	})) };
	}),
	sendMessage: (weddingId, chatId, author, text, extra) => {
		const message = {
			...note(author, text.trim(), extra),
			delivery: "sending"
		};
		set((s) => ({
			weddings: patch(s.weddings, weddingId, (w) => ({
				...w,
				chats: w.chats.map((c) => c.id === chatId ? {
					...c,
					messages: [...c.messages, message]
				} : c)
			})),
			notices: pushNotice(s.notices, {
				weddingId,
				title: "New family message",
				body: `${author}: ${text.trim() || (extra?.video ? "Shared a video" : "Shared a photo")}`,
				kind: "chat"
			})
		}));
		queueActivity(weddingId, author, {
			action: "chat",
			chatId,
			message
		}, {
			kind: "message",
			id: message.id,
			chatId
		});
	},
	reactToMessage: (weddingId, chatId, messageId, author, kind) => set((s) => ({
		weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			chats: w.chats.map((c) => c.id === chatId ? {
				...c,
				messages: c.messages.map((m) => m.id === messageId ? {
					...m,
					reactions: toggleReaction(m.reactions, author, kind)
				} : m)
			} : c)
		})),
		notices: pushNotice(s.notices, {
			weddingId,
			title: "New reaction",
			body: `${author} marked a message.`,
			kind: "reaction"
		})
	})),
	addChat: (weddingId, name) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		chats: [...w.chats, {
			id: uid(),
			name: name.trim(),
			hint: "A private thread inside this wedding.",
			messages: []
		}]
	})) })),
	renameChat: (weddingId, chatId, name) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		chats: w.chats.map((c) => c.id === chatId ? {
			...c,
			name: name.trim()
		} : c)
	})) })),
	removeChat: (weddingId, chatId) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		chats: w.chats.filter((c) => c.id !== chatId)
	})) })),
	setChatClosed: (weddingId, chatId, closed) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canManage(wedding, s.viewer)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			chats: w.chats.map((c) => c.id === chatId ? {
				...c,
				closed
			} : c)
		})) };
	}),
	addLiveNote: (weddingId, author, text) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		liveNotes: [...w.liveNotes, note(author, text.trim())].slice(-40)
	})) })),
	toggleTask: (weddingId, taskId) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		tasks: w.tasks.map((t) => t.id === taskId ? {
			...t,
			done: !t.done
		} : t)
	})) })),
	addTask: (weddingId, title, owner, category, when) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		tasks: [...w.tasks, {
			id: uid(),
			title: title.trim(),
			owner,
			when: when?.trim() || "This week",
			done: false,
			category: category || "Ceremony arrangements"
		}]
	})) })),
	addEnquiry: (weddingId, enquiry) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		enquiries: [{
			...enquiry,
			id: uid(),
			atLabel: nowLabel()
		}, ...w.enquiries]
	})) })),
	toggleShortlist: (weddingId, vendorId) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		shortlist: w.shortlist.includes(vendorId) ? w.shortlist.filter((id) => id !== vendorId) : [...w.shortlist, vendorId]
	})) })),
	updatePrivacy: (weddingId, privacy) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		privacy
	})) })),
	setGuestSide: (weddingId, guestId, side) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canManage(wedding, s.viewer)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			guests: w.guests.map((guest) => guest.id === guestId ? {
				...guest,
				side
			} : guest)
		})) };
	}),
	setGuestGrant: (weddingId, guestId, grant) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canManage(wedding, s.viewer)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			guests: w.guests.map((guest) => guest.id === guestId ? {
				...guest,
				...grant
			} : guest)
		})) };
	}),
	setFunctionAccess: (weddingId, functionId, accessRule) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canManage(wedding, s.viewer) && !ownerManaged(s, wedding)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			functions: w.functions.map((item) => item.id === functionId ? {
				...item,
				accessRule
			} : item)
		})) };
	}),
	setLiveAccess: (weddingId, accessRule) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !canManage(wedding, s.viewer) && !ownerManaged(s, wedding)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			liveAccess: accessRule
		})) };
	}),
	saveFunction: async (weddingId, fn) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) return "denied";
		const existing = wedding.functions.find((item) => item.id === fn.id);
		const fields = ceremonyFields(fn);
		if (!existing || !fields) return "invalid";
		const next = {
			...existing,
			...fields
		};
		set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			functions: w.functions.map((item) => item.id === next.id ? next : item)
		})) }));
		const saved = await commitCeremony(weddingId, {
			action: "save-function",
			fn: next
		});
		if (saved === "failed") set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			functions: w.functions.map((item) => item.id === existing.id ? existing : item)
		})) }));
		return saved;
	},
	addFunction: (weddingId, fn) => set((s) => ({
		weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			functions: [...w.functions, {
				...fn,
				id: uid(),
				live: false
			}]
		})),
		notices: pushNotice(s.notices, {
			weddingId,
			title: "Upcoming function",
			body: `${fn.name} · ${fn.date} ${fn.time}`,
			kind: "function"
		})
	})),
	removeFunction: async (weddingId, functionId) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) return "denied";
		const existing = wedding.functions.find((item) => item.id === functionId);
		if (!existing) return "missing";
		set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			functions: w.functions.filter((item) => item.id !== functionId)
		})) }));
		const saved = await commitCeremony(weddingId, {
			action: "remove-function",
			functionId
		});
		if (saved === "failed") set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			functions: w.functions.some((item) => item.id === existing.id) ? w.functions : [...w.functions, existing]
		})) }));
		return saved;
	},
	moveFunction: (weddingId, functionId, dir) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => {
		const i = w.functions.findIndex((f) => f.id === functionId);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= w.functions.length) return w;
		const functions = w.functions.slice();
		const [item] = functions.splice(i, 1);
		if (!item) return w;
		functions.splice(j, 0, item);
		return {
			...w,
			functions
		};
	}) })),
	goLive: (weddingId, functionId) => set((s) => ({
		weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			mode: "day",
			functions: w.functions.map((f) => ({
				...f,
				live: f.id === functionId
			}))
		})),
		notices: pushNotice(s.notices, {
			weddingId,
			title: "Live ceremony starting",
			body: wName(s.weddings, weddingId, functionId),
			kind: "live"
		})
	})),
	stopLive: (weddingId) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		functions: w.functions.map((f) => ({
			...f,
			live: false
		}))
	})) })),
	setSharing: (weddingId, on) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		sharingLocation: on
	})) })),
	setYoutube: (weddingId, url) => set((s) => ({
		weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			youtubeUrl: url.trim()
		})),
		notices: url.trim() ? pushNotice(s.notices, {
			weddingId,
			title: "A live video was attached",
			body: "The ceremony can be watched in the circle.",
			kind: "live"
		}) : s.notices
	})),
	setCohosts: async (weddingId, names) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || (state.viewer.role !== "host" && !ownerManaged(state, wedding)) || !circleKey(wedding.slug)) return "denied";
		const hostName = wedding.hostName.trim().toLowerCase();
		const allowed = new Map(wedding.guests.filter((guest) => guest.name.trim() && guest.name.trim().toLowerCase() !== hostName).map((guest) => [guest.name.trim().toLowerCase(), guest.name.trim()]));
		const next = [...new Set(names.map((name) => allowed.get(name.trim().toLowerCase()) ?? "").filter(Boolean))].slice(0, 2);
		if (next.length !== [...new Set(names.map((name) => name.trim()).filter(Boolean))].length) return "denied";
		const previous = wedding.cohostNames ?? [];
		set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			cohostNames: next
		})) }));
		try {
			const { assignCohosts } = await import("./roles.functions.ts");
			const { pushCircle } = await import("./publish.ts");
			const key = circleKey(wedding.slug);
			let result = await assignCohosts({ data: {
				slug: wedding.slug,
				editKey: key,
				names: next
			} });
			if (!result.ok) {
				const latest = get().weddings.find((item) => item.id === weddingId);
				if (latest) await pushCircle(latest);
				result = await assignCohosts({ data: {
					slug: wedding.slug,
					editKey: key,
					names: next
				} });
			}
			if (!result.ok) {
				set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
					...w,
					cohostNames: previous
				})) }));
				return "denied";
			}
			return "ok";
		} catch {
			set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
				...w,
				cohostNames: previous
			})) }));
			return "failed";
		}
	},
	rememberMembership: (item) => set((s) => ({ memberships: upsertMembership(s.memberships, item) })),
	ensureMemberships: () => set((s) => {
		const weddings = Array.isArray(s.weddings) ? s.weddings : [];
		let memberships = backfillMemberships(weddings, s.account, s.memberships);
		const name = (s.account?.name || s.viewer.name || "").trim().toLowerCase();
		if (!name || name === "guest") return { memberships };
		for (const wedding of weddings) {
			if (!wedding || isSampleCircle(wedding) || memberships.some((item) => item.slug === wedding.slug)) continue;
			if (!Array.isArray(wedding.guests) || !wedding.guests.some((guest) => guest.joined && !guest.blocked && guest.name.trim().toLowerCase() === name)) continue;
			memberships = upsertMembership(memberships, {
				slug: wedding.slug,
				email: s.account?.email ?? "",
				name: s.account?.name || s.viewer.name,
				role: s.viewer.role
			});
		}
		return { memberships };
	}),
	addPostingCode: (weddingId, kind = "family") => {
		const code = `${kind === "guest" ? "GUEST" : "FAMILY"}-${uid().slice(0, 4).toUpperCase()}`;
		let saved = false;
		set((s) => {
			const wedding = s.weddings.find((w) => w.id === weddingId);
			if (!wedding || isSampleCircle(wedding) || !canManage(wedding, s.viewer)) return s;
			saved = true;
			return { weddings: patch(s.weddings, weddingId, (w) => ({
				...w,
				postingCodes: [...codesOf(w), {
					id: uid(),
					code,
					kind
				}]
			})) };
		});
		if (saved) {
			const wedding = get().weddings.find((item) => item.id === weddingId);
			const key = wedding ? circleKey(wedding.slug) : "";
			if (wedding && key) {
				const codes = codesOf(wedding);
				import("./roles.functions.ts").then(({ syncWeddingCodes }) => syncWeddingCodes({ data: {
					slug: wedding.slug,
					editKey: key,
					familyCodes: codes.filter((item) => item.kind === "family").map((item) => item.code),
					guestCodes: codes.filter((item) => item.kind === "guest").map((item) => item.code)
				} }));
			}
		}
		return saved ? code : "";
	},
	setCircleDisabled: (weddingId, disabled) => set((s) => {
		const wedding = s.weddings.find((w) => w.id === weddingId);
		if (!wedding || !isCircleOwner(wedding)) return s;
		return { weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			disabled
		})) };
	}),
	purgeDeletedCircle: (slug) => {
		const clean = String(slug || "").trim().toLowerCase();
		if (!clean || clean === "lila-nico") return "";
		rememberDeletedSlug(clean);
		const wedding = get().weddings.find((w) => w.slug === clean);
		const id = wedding?.id || "";
		const memberships = get().memberships ?? [];
		const pins = get().landingPins ?? {};
		const pinned = Object.values(pins).includes(id);
		if (!wedding && !memberships.some((item) => item.slug === clean) && !pinned) return "";
		set((s) => ({
			weddings: s.weddings.filter((w) => w.slug !== clean),
			memberships: (s.memberships ?? []).filter((item) => item.slug !== clean),
			landingPins: Object.fromEntries(Object.entries(s.landingPins ?? {}).filter(([, pinnedId]) => pinnedId !== id)),
			viewer: id && s.viewer.weddingId === id ? {
				name: s.account?.name ?? s.viewer.name,
				role: "guest",
				weddingId: SEED_ID,
				coded: false,
				side: s.viewer.side
			} : s.viewer
		}));
		if (id) void import("./offline-sync.ts").then((mod) => mod.dropWeddingCache(id));
		return id;
	},
	purgeRememberedDeletions: () => {
		for (const slug of deletedSlugList()) get().purgeDeletedCircle(slug);
	},
	absorbExpiryNotices: (weddingId, reminders) => set((s) => {
		if (!weddingId || !Array.isArray(reminders) || reminders.length === 0) return s;
		let notices = s.notices;
		let changed = false;
		for (const item of reminders) {
			if (!item?.slot || !item.title) continue;
			const id = `expiry:${weddingId}:${item.slot}`;
			if (notices.some((notice) => notice.id === id)) continue;
			changed = true;
			notices = [{
				id,
				weddingId,
				title: String(item.title).slice(0, 140),
				body: String(item.body || "").slice(0, 500),
				atLabel: nowLabel(),
				read: false,
				kind: "expiry"
			}, ...notices].slice(0, 40);
		}
		return changed ? { notices } : s;
	}),
	deleteWedding: (weddingId) => {
		const wedding = get().weddings.find((w) => w.id === weddingId);
		const email = (get().account?.email ?? "").trim().toLowerCase();
		const payingOwner = Boolean(email && wedding?.ownerEmail && wedding.ownerEmail.toLowerCase() === email);
		if (!wedding || isSampleCircle(wedding) || (!isCircleOwner(wedding) && !payingOwner)) return false;
		set((s) => ({
			weddings: s.weddings.filter((w) => w.id !== weddingId),
			memberships: (s.memberships ?? []).filter((item) => item.slug !== wedding.slug),
			landingPins: Object.fromEntries(Object.entries(s.landingPins ?? {}).filter(([, pinnedId]) => pinnedId !== weddingId)),
			viewer: s.viewer.weddingId === weddingId ? {
				name: s.account?.name ?? s.viewer.name,
				role: "guest",
				weddingId: SEED_ID,
				coded: false,
				side: "Bride"
			} : s.viewer
		}));
		return true;
	},
	applyRemoteCircle: (remote) => set((s) => {
		if (isSampleCircle(remote) || isDeletedSlug(remote.slug)) return s;
		const current = s.weddings.find((w) => w.slug === remote.slug);
		if (!current) return s;
		const nextCodes = remote.postingCodes?.length ? remote.postingCodes : current.postingCodes;
		const posts = mergePosts(current.posts ?? [], remote.posts ?? []);
		const chats = mergeChats(current.chats ?? [], remote.chats ?? []);
		const beforeNotes = mergeNotes(current.beforeNotes ?? [], remote.beforeNotes ?? []);
		const owner = isCircleOwner(current);
		const newer = Number(remote.rev ?? 0) > Number(current.rev ?? 0);
		const theme = remoteCardTheme(current, remote);
		const life = {
			createdAt: remote.createdAt || current.createdAt,
			expiresAt: remote.expiresAt || current.expiresAt,
			mediaRetentionUntil: remote.mediaRetentionUntil || current.mediaRetentionUntil
		};
		const next = owner ? {
			...current,
			...life,
			ownerId: current.ownerId || remote.ownerId,
			disabled: Boolean(remote.disabled),
			postingCodes: nextCodes,
			posts,
			chats,
			beforeNotes,
			guestProfiles: mergeProfiles(current.guestProfiles, remote.guestProfiles),
			chatAtmosphere: remote.chatAtmosphere ?? current.chatAtmosphere,
			rev: Math.max(Number(remote.rev ?? 0), Number(current.rev ?? 0)) || current.rev,
			functions: newer && Array.isArray(remote.functions) ? remote.functions : current.functions,
			cardTheme: theme.cardTheme,
			themeRev: theme.themeRev,
			fonts: fontsFromRemote(current, remote),
			bar: remote.bar !== undefined ? remote.bar : current.bar,
			payment: retainVerifiedPayment(current.payment, remote.payment),
			coupleAccess: mergeCoupleAccess(current.coupleAccess, remote.coupleAccess, true)
		} : {
			...current,
			...remote,
			...life,
			ownerId: current.ownerId || remote.ownerId,
			disabled: Boolean(remote.disabled),
			postingCodes: nextCodes,
			mediaKey: remote.mediaKey || current.mediaKey,
			posts,
			chats,
			beforeNotes,
			cover: remote.cover || current.cover,
			coverVideo: remote.coverVideo ?? current.coverVideo,
			functions: Array.isArray(remote.functions) && remote.functions.length ? remote.functions : current.functions,
			guests: keepLocalGuests(current.guests ?? [], Array.isArray(remote.guests) ? remote.guests : current.guests ?? []),
			liveNotes: remote.liveNotes ?? current.liveNotes,
			feedSides: remote.feedSides ?? current.feedSides,
			guestProfiles: mergeProfiles(current.guestProfiles, remote.guestProfiles),
			chatAtmosphere: remote.chatAtmosphere ?? current.chatAtmosphere,
			cardTheme: theme.cardTheme,
			themeRev: theme.themeRev,
			fonts: fontsFromRemote(current, remote),
			bar: remote.bar !== undefined ? remote.bar : current.bar,
			payment: retainVerifiedPayment(current.payment, remote.payment),
			rev: Math.max(Number(remote.rev ?? 0), Number(current.rev ?? 0)) || current.rev,
			coupleAccess: mergeCoupleAccess(current.coupleAccess, remote.coupleAccess, false)
		};
		if (JSON.stringify(current) === JSON.stringify(next)) return s;
		return { weddings: s.weddings.map((w) => w.slug === remote.slug ? next : w) };
	}),
	setPulse: (pulse) => set({ pulse }),
	retryPost: (weddingId, postId) => {
		const wedding = get().weddings.find((item) => item.id === weddingId);
		const post = wedding?.posts.find((item) => item.id === postId);
		if (!wedding || !post || isSampleCircle(wedding)) return;
		set((s) => ({ weddings: s.weddings.map((item) => item.id !== weddingId ? item : {
			...item,
			posts: item.posts.map((itemPost) => itemPost.id === postId ? {
				...itemPost,
				delivery: "sending"
			} : itemPost)
		}) }));
		queueActivity(weddingId, post.author, {
			action: "post",
			post
		}, {
			kind: "post",
			id: postId
		});
	},
	removeMessage: (weddingId, chatId, messageId) => {
		const wedding = get().weddings.find((item) => item.id === weddingId);
		set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
			...w,
			chats: w.chats.map((chat) => chat.id !== chatId ? chat : {
				...chat,
				messages: chat.messages.map((message) => message.id === messageId ? {
					...message,
					removed: true
				} : message)
			})
		})) }));
		if (wedding && !isSampleCircle(wedding)) queueActivity(weddingId, get().viewer.name, {
			action: "remove-message",
			chatId,
			messageId
		});
	},
	ensureEntryCodes: () => {
		try {
		set((s) => {
		if (!Array.isArray(s.weddings)) return s;
		let changed = false;
		const weddings = s.weddings.map((w) => {
			if (!w || typeof w.slug !== "string") return w;
			const postingCodes = codesOf(w);
			const mediaKey = w.mediaKey && w.mediaKey.length >= 16 ? w.mediaKey : uid();
			if (JSON.stringify(w.postingCodes ?? []) === JSON.stringify(postingCodes) && typeof w.disabled === "boolean" && w.mediaKey === mediaKey) return w;
			changed = true;
			return {
				...w,
				postingCodes,
				disabled: Boolean(w.disabled),
				mediaKey
			};
		});
		return changed ? { weddings } : s;
		});
		} catch {}
	},
	approveGuest: (weddingId, guestId) => set((s) => ({ weddings: patch(s.weddings, weddingId, (w) => ({
		...w,
		guests: w.guests.map((g) => g.id === guestId ? {
			...g,
			joined: true
		} : g)
	})) })),
	restoreSample: () => set((s) => ({
		weddings: s.weddings.map((w) => w.id === "lila-nico" ? structuredClone(seedWedding) : w),
		viewer: s.account ? {
			name: s.account.name,
			role: "guest",
			weddingId: SEED_ID,
			coded: false
		} : lensFor(seedWedding, "guest", false)
	})),
	reviseSample: (input) => set((s) => ({ weddings: s.weddings.map((w) => {
		if (w.id !== "lila-nico" && w.slug !== "lila-nico") return w;
		const cover = input.cover.trim();
		const photo = Boolean(cover) && !cover.endsWith(".svg") && !cover.startsWith("theme:");
		return {
			...w,
			bride: input.bride.trim() || w.bride,
			groom: input.groom.trim() || w.groom,
			date: input.date || w.date,
			city: input.city.trim() || w.city,
			place: input.place.trim() || w.place,
			cover: cover || w.cover,
			illustrated: photo ? false : w.illustrated
		};
	}) })),
	signInDeveloper: (email) => {
		const clean = email.trim().toLowerCase();
		if (!isDeveloperEmail(clean)) return "bad";
		const existing = get().accounts.find((account) => account.email === clean);
		const account = asDeveloper(existing ?? {
			name: clean === DEVELOPER.email ? DEVELOPER.name : "Developer",
			email: clean,
			phone: "",
			passwordHash: DEVELOPER.passwordHash,
			developer: true
		});
		const session = claimAccount(get(), account);
		set((s) => ({
			accounts: existing ? s.accounts.map((item) => item.email === clean ? account : item) : [...s.accounts, account],
			account,
			pendingSignup: null,
			weddings: session.weddings,
			memberships: session.memberships,
			landingPins: session.landingPins,
			notices: session.notices,
			reports: session.reports,
			viewer: {
				...s.viewer,
				name: account.name,
				...(session.viewerOk ? {} : {
					role: "guest",
					coded: false,
					weddingId: SEED_ID
				})
			}
		}));
		return "ok";
	},
	pinLanding: (weddingId) => {
		const account = get().account;
		const key = landingUserKey(account);
		if (!key) return "signed-out";
		const wedding = get().weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding)) return "unavailable";
		const email = (account?.email ?? "").trim().toLowerCase();
		const owner = Boolean(email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === email);
		const paid = wedding.payment?.status === "paid";
		const allowed = canEnterWedding(wedding, account, get().memberships ?? []);
		if (!(owner && paid)) return allowed ? "free" : "unauthorized";
		if (!allowed) return "unauthorized";
		set((s) => ({ landingPins: { ...s.landingPins ?? {}, [key]: weddingId }, pinNotice: null }));
		return "ok";
	},
	unpinLanding: () => {
		const key = landingUserKey(get().account);
		if (!key) return "signed-out";
		set((s) => {
			const landingPins = { ...s.landingPins ?? {} };
			delete landingPins[key];
			return { landingPins };
		});
		return "ok";
	},
	setCoupleAccess: (weddingId, access) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, state.viewer) && !ownerManaged(state, wedding)) {
			return Promise.resolve({ ok: false, error: "Only a host can change bride and groom access." });
		}
		set((s) => ({ weddings: patch(s.weddings, weddingId, (item) => ({ ...item, coupleAccess: access })) }));
		const key = circleKey(wedding.slug);
		if (!key) return Promise.resolve({ ok: true, local: true });
		return (async () => {
			try {
				const { saveCoupleSecrets } = await import("./couple-access.functions.ts");
				const saved = await saveCoupleSecrets({ data: { slug: wedding.slug, editKey: key, access } });
				const { pushCircle } = await import("./publish.ts");
				const current = get().weddings.find((item) => item.id === weddingId);
				if (current) await pushCircle(current);
				if (!saved.ok) return { ok: true, local: true };
				return { ok: true, local: false };
			} catch {
				return { ok: true, local: true };
			}
		})();
	},
	claimCoupleAccess: (code) => {
		const account = get().account;
		const accountId = accountSenderId(account);
		if (!accountId) return { ok: false, error: "unsigned" };
		const name = (account?.name || "").trim();
		const result = claimAcrossWeddings(get().weddings, code, accountId, name);
		if (!result.ok) return result;
		const wedding = get().weddings.find((item) => item.id === result.weddingId);
		if (!wedding || isSampleCircle(wedding) || wedding.disabled) return { ok: false, error: "invalid" };
		set(seatCouple(get(), wedding, result.access, result.role, name || (result.role === "bride" ? "Bride" : "Groom")));
		const editKey = circleKey(wedding.slug);
		if (editKey) {
			void import("./couple-access.functions.ts").then(({ saveCoupleSecrets }) => saveCoupleSecrets({ data: { slug: wedding.slug, editKey, access: result.access } })).catch(() => undefined);
			void import("./publish.ts").then(({ pushCircle }) => {
				const current = get().weddings.find((item) => item.id === wedding.id);
				return current ? pushCircle(current) : undefined;
			}).catch(() => undefined);
		}
		return { ok: true, slug: result.slug, role: result.role, weddingId: result.weddingId };
	},
	applyVerifiedCoupleSeat: (slug, role, name) => {
		const accountId = accountSenderId(get().account);
		if (!accountId) return { ok: false, error: "unsigned" };
		const wedding = get().weddings.find((item) => item.slug === slug);
		if (!wedding || isSampleCircle(wedding)) return { ok: false, error: "invalid" };
		const assigned = assignCoupleSeat(wedding.coupleAccess, role, { accountId, name: (name || get().account?.name || role).trim().slice(0, 80) });
		if (!assigned.ok) return assigned;
		const access = { ...assigned.access };
		const record = role === "bride" ? access.brideCode : access.groomCode;
		if (record?.code && record.status !== "revoked") {
			const next = { ...record, status: "claimed", claimedBy: accountId };
			if (role === "bride") access.brideCode = next;
			else access.groomCode = next;
		}
		set(seatCouple(get(), wedding, access, role, (name || get().account?.name || role).trim()));
		return { ok: true, slug, role };
	},
	markCirclePaid: (weddingId, payment) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !payment || payment.status !== "paid") return false;
		const email = (state.account?.email ?? "").trim().toLowerCase();
		const owner = Boolean(email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === email) || isCircleOwner(wedding);
		if (!owner) return false;
		set((s) => ({ weddings: patch(s.weddings, weddingId, (item) => ({ ...item, payment: { ...payment, verified: false } })) }));
		const next = get().weddings.find((item) => item.id === weddingId);
		if (next) void import("./publish.ts").then(({ pushCircle }) => pushCircle(next));
		return true;
	},
	applyVoucherPremium: (weddingId, reference) => {
		const wedding = get().weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding)) return false;
		const note = typeof reference === "string" && reference.startsWith("VOUCHER-") ? reference : "";
		if (!note) return false;
		set((s) => ({ weddings: patch(s.weddings, weddingId, (item) => ({
			...item,
			payment: { status: "paid", reference: note, provider: "preview", verified: true }
		})) }));
		return true;
	},
	saveGuestProfile: async (weddingId, draft) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding)) return { ok: false, error: "This circle cannot save a wedding profile." };
		if (!canPost(wedding, state.viewer) && !canManage(wedding, state.viewer)) return { ok: false, error: "Join this wedding before creating a profile." };
		const key = ownMemberKey(wedding.slug);
		const prepared = prepareProfile(draft, {
			accountId: accountSenderId(state.account),
			joinedName: state.viewer.weddingId === weddingId ? state.viewer.name : draft.displayName
		});
		if (!prepared.ok) return prepared;
		const previous = wedding.guestProfiles?.[key] ?? null;
		const previousViewer = state.viewer;
		set((s) => ({
			weddings: patch(s.weddings, weddingId, (item) => ({
				...item,
				guestProfiles: { ...item.guestProfiles, [key]: prepared.profile }
			})),
			viewer: s.viewer.weddingId === weddingId ? { ...s.viewer, name: prepared.profile.displayName } : s.viewer
		}));
		try {
			const { pushActivity } = await import("./publish.ts");
			const current = get().weddings.find((item) => item.id === weddingId);
			if (!current) throw new Error("missing");
			const result = await pushActivity(current, prepared.profile.displayName, { action: "profile", profile: prepared.profile, remove: false });
			if (result === "ok" || result === "local") {
				if (previous?.photo && previous.photo !== prepared.profile.photo && previous.photo.startsWith("idb:")) {
					void import("./media-db.ts").then((mod) => mod.deleteMediaBlob(previous.photo));
					void import("./media-sync.ts").then((mod) => mod.forgetSharedMedia(wedding, previous.photo));
				}
				return { ok: true, profile: prepared.profile };
			}
			throw new Error(result);
		} catch (error) {
			set((s) => ({
				weddings: patch(s.weddings, weddingId, (item) => {
					const guestProfiles = { ...item.guestProfiles };
					if (previous) guestProfiles[key] = previous;
					else delete guestProfiles[key];
					return { ...item, guestProfiles };
				}),
				viewer: s.viewer.weddingId === weddingId ? previousViewer : s.viewer
			}));
			const offline = error instanceof Error && error.message === "offline";
			return { ok: false, error: offline ? "Not saved. You are offline. Your previous profile is unchanged." : "That profile was not saved. Your previous profile is unchanged." };
		}
	},
	removeOwnProfile: async (weddingId) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding)) return { ok: false, error: "This circle cannot change that profile." };
		const key = ownMemberKey(wedding.slug);
		const previous = wedding.guestProfiles?.[key] ?? null;
		if (!previous || previous.removed) return { ok: true };
		const tombstone = { displayName: "", removed: true, updatedAt: new Date().toISOString() };
		set((s) => ({
			weddings: patch(s.weddings, weddingId, (item) => ({
				...item,
				guestProfiles: { ...item.guestProfiles, [key]: tombstone }
			}))
		}));
		try {
			const { pushActivity } = await import("./publish.ts");
			const current = get().weddings.find((item) => item.id === weddingId);
			if (!current) throw new Error("missing");
			const result = await pushActivity(current, state.viewer.name, { action: "profile", profile: null, remove: true });
			if (result === "ok" || result === "local") {
				if (previous.photo?.startsWith("idb:")) {
					void import("./media-db.ts").then((mod) => mod.deleteMediaBlob(previous.photo));
					void import("./media-sync.ts").then((mod) => mod.forgetSharedMedia(wedding, previous.photo));
				}
				return { ok: true };
			}
			throw new Error(result);
		} catch (error) {
			set((s) => ({
				weddings: patch(s.weddings, weddingId, (item) => ({
					...item,
					guestProfiles: { ...item.guestProfiles, [key]: previous }
				}))
			}));
			const offline = error instanceof Error && error.message === "offline";
			return { ok: false, error: offline ? "Not removed. You are offline." : "That profile was not removed." };
		}
	},
	setChatAtmosphere: (weddingId, enabled) => {
		const state = get();
		const wedding = state.weddings.find((item) => item.id === weddingId);
		if (!wedding || isSampleCircle(wedding) || !canManage(wedding, state.viewer)) return false;
		const previous = wedding.chatAtmosphere;
		set((s) => ({ weddings: patch(s.weddings, weddingId, (item) => ({ ...item, chatAtmosphere: enabled })) }));
		void import("./publish.ts").then(async ({ pushActivity }) => {
			const current = get().weddings.find((item) => item.id === weddingId);
			if (!current) return;
			const result = await pushActivity(current, state.viewer.name, { action: "atmosphere", enabled });
			if (result === "ok" || result === "local") return;
			set((s) => ({ weddings: patch(s.weddings, weddingId, (item) => ({ ...item, chatAtmosphere: previous })) }));
			const { toast } = await import("sonner");
			toast("The wedding-day notes were not changed.");
		});
		return true;
	},
}), {
	name: "wedding-circle-v3",
	storage: createJSONStorage(() => memoryStorage),
	skipHydration: true,
	version: 8,
	merge: (persisted, current) => {
		const saved = persisted && typeof persisted === "object" ? persisted : {};
		const weddings = Array.isArray(saved.weddings) ? saved.weddings.filter((w) => w && typeof w === "object" && typeof w.slug === "string" && w.slug).map((w) => ({
			...w,
			guests: Array.isArray(w.guests) ? w.guests : [],
			functions: Array.isArray(w.functions) ? w.functions : [],
			posts: Array.isArray(w.posts) ? w.posts : [],
			chats: Array.isArray(w.chats) ? w.chats : [],
			tasks: Array.isArray(w.tasks) ? w.tasks : [],
			beforeNotes: Array.isArray(w.beforeNotes) ? w.beforeNotes : []
		})) : null;
		return {
			...current,
			...saved,
			weddings: weddings && weddings.length ? weddings : current.weddings,
			memberships: Array.isArray(saved.memberships) ? saved.memberships : current.memberships ?? [],
			landingPins: saved.landingPins && typeof saved.landingPins === "object" && !Array.isArray(saved.landingPins) ? saved.landingPins : current.landingPins ?? {},
			notices: Array.isArray(saved.notices) ? saved.notices : current.notices,
			reports: Array.isArray(saved.reports) ? saved.reports : current.reports,
			feedback: Array.isArray(saved.feedback) ? saved.feedback : current.feedback,
			accounts: Array.isArray(saved.accounts) ? saved.accounts.map((account) => asDeveloper(account)) : current.accounts,
			account: saved.account ? asDeveloper(saved.account) : current.account,
			guestLocks: saved.guestLocks && typeof saved.guestLocks === "object" && !Array.isArray(saved.guestLocks) ? saved.guestLocks : current.guestLocks ?? {}
		};
	},
	partialize: (s) => ({
		weddings: s.weddings.map((w) => shellWedding(w.id === "lila-nico" || w.slug === "lila-nico" ? { ...w, cover: "" } : w)),
		viewer: s.viewer,
		account: s.account,
		accounts: s.accounts,
		pendingSignup: s.pendingSignup,
		notices: s.notices,
		reports: s.reports,
		feedback: s.feedback,
		guestLocks: s.guestLocks,
		memberships: s.memberships ?? [],
		landingPins: s.landingPins ?? {}
	}),
	migrate: (persisted) => {
		try {
		const saved = persisted;
		let weddings = (saved.weddings ?? [structuredClone(seedWedding)]).map((w) => {
			const next = w.id === "lila-nico" && !(w.beforeNotes && w.beforeNotes.length) ? {
				...w,
				beforeNotes: structuredClone(seedWedding.beforeNotes ?? []),
				coverVideo: w.coverVideo ?? ""
			} : {
				...w,
				beforeNotes: w.beforeNotes ?? [],
				coverVideo: w.coverVideo ?? ""
			};
			if (w.id === "lila-nico" || w.slug === "lila-nico") return {
				...next,
				cover: ""
			};
			return next;
		});
		let memberships = saved.memberships ?? [];
		let landingPins = saved.landingPins && typeof saved.landingPins === "object" ? saved.landingPins : {};
		let notices = saved.notices?.length ? saved.notices : starterNotices;
		let reports = saved.reports ?? [];
		if (!saved.account) {
			const parked = parkSignedOutSession({
				weddings,
				memberships,
				landingPins,
				notices,
				reports
			}, null);
			weddings = parked.weddings;
			memberships = [];
			landingPins = parked.landingPins;
			notices = parked.notices?.length ? parked.notices : starterNotices;
			reports = parked.reports;
		}
		return {
			weddings,
			viewer: saved.account ? saved.viewer ?? {
				name: "Guest",
				role: "guest",
				weddingId: "lila-nico",
				coded: false
			} : lensFor(weddings[0] ?? seedWedding, "guest", false),
			account: saved.account ? asDeveloper(saved.account) : null,
			accounts: withDeveloper(saved.accounts),
			pendingSignup: saved.pendingSignup ?? null,
			notices,
			reports,
			feedback: saved.feedback ?? [],
			guestLocks: saved.guestLocks ?? {},
			memberships: saved.account ? backfillMemberships(weddings, asDeveloper(saved.account), memberships) : [],
			landingPins
		};
		} catch {
			return {
				weddings: [structuredClone(seedWedding)],
				viewer: lensFor(seedWedding, "guest", false),
				account: null,
				accounts: withDeveloper([]),
				pendingSignup: null,
				notices: starterNotices,
				reports: [],
				feedback: [],
				guestLocks: {},
				memberships: [],
				landingPins: {}
			};
		}
	}
})) as unknown as WeddingStoreHook;

export const useWeddingStore = weddingStore;

export function vendorById(id) {
	return VENDORS.find((v) => v.id === id);
}
