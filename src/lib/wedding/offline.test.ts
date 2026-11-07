import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cacheVisible, decideFlush, duplicateMessageIds, mergePendingMessages, ownerScope, SHELL_CACHE, shellAssetCacheable, shellDocumentCacheable, shellOfflineDocument, shellRequestPolicy, snapshotRestorable, snapshotWedding } from "./offline.ts";
import type { Wedding } from "./types.ts";

test("shell worker bypasses private and dev requests and caches static files", () => {
  assert.equal(shellRequestPolicy("POST", "/"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/api/auth"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/api/lifecycle"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/api/google/chunk"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/api/library/file/abc"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/_server/fn"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/src/routes/index.tsx"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/@vite/client"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/assets/app.js"), "fresh");
  assert.equal(shellRequestPolicy("GET", "/assets/styles.css"), "fresh");
  assert.equal(shellRequestPolicy("GET", "/assets/index-DFZdCwFD.js"), "immutable");
  assert.equal(shellRequestPolicy("GET", "/assets/styles-Cj5jXX5R.css"), "immutable");
  assert.equal(shellRequestPolicy("GET", "/favicon.svg"), "static");
  assert.equal(shellRequestPolicy("GET", "/card-themes/pastel-blush.webp"), "static");
  assert.equal(shellRequestPolicy("GET", "/theme-music/pastel-blush.wav"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/media/ceremony.webp"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/live/index.m3u8"), "bypass");
  assert.equal(shellRequestPolicy("PUT", "/assets/index-DFZdCwFD.js"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/wedding-shell-sw.js"), "bypass");
  assert.equal(shellRequestPolicy("GET", "/w/aisha-rohan"), "navigate");
  assert.equal(shellRequestPolicy("GET", "/who-said-trophy.png"), "static");
  assert.equal(SHELL_CACHE, "wc-precache-v8");
  assert.equal(shellAssetCacheable(200, "text/javascript"), true);
  assert.equal(shellAssetCacheable(200, "text/css"), true);
  assert.equal(shellAssetCacheable(200, "text/html; charset=utf-8"), false);
  assert.equal(shellAssetCacheable(404, "text/javascript"), false);
  assert.equal(shellOfflineDocument(true), "exact");
  assert.equal(shellOfflineDocument(false), "offline-shell");
});

test("offline documents never keep tokens", () => {
  assert.equal(shellDocumentCacheable({ contentType: "text/html", setCookie: false, bytes: 2000, body: "<html>Wedding Circle wc-shell-v8</html>" }), true);
  assert.equal(shellDocumentCacheable({ contentType: "text/html", setCookie: false, bytes: 2000, body: "<html>Wedding Circle</html>" }), false);
  const shell = readFileSync(new URL("../../../public/wedding-shell-sw.js", import.meta.url), "utf8");
  const push = readFileSync(new URL("../../../public/firebase-messaging-sw.js", import.meta.url), "utf8");
  const host = readFileSync(new URL("../../components/wedding/offline-host.tsx", import.meta.url), "utf8");
  assert.match(shell, /VERSION = "v8"/);
  assert.match(shell, /cache: "reload"/);
  assert.equal(push.includes("clients.claim"), false);
  assert.match(host, /updateViaCache: "none"/);
  assert.equal(shellDocumentCacheable({ contentType: "text/html", setCookie: true, bytes: 2000, body: "<html>ok</html>" }), false);
  assert.equal(shellDocumentCacheable({ contentType: "application/json", setCookie: false, bytes: 20, body: "{}" }), false);
  assert.equal(shellDocumentCacheable({ contentType: "text/html", setCookie: false, bytes: 40, body: "access_token=secret" }), false);
});

test("offline snapshot drops invite codes, couple codes and passwords", () => {
  const wedding = {
    id: "w1",
    slug: "aisha-rohan",
    bride: "Aisha",
    groom: "Rohan",
    hostName: "Aisha",
    date: "2026-12-12",
    city: "Jaipur",
    place: "Hall",
    story: "Saved",
    cover: "data:image/png;base64,AAAA",
    mode: "day",
    functions: [],
    posts: [],
    guests: [],
    chats: [{ id: "c1", name: "Family", hint: "", messages: [{ id: "m1", author: "Aisha", text: "Hello", atLabel: "1:00" }] }],
    enquiries: [],
    tasks: [],
    shortlist: [],
    places: [],
    privacy: { join: "link", post: "everyone", live: "hosts", download: false },
    liveNotes: [],
    sharingLocation: false,
    postingCodes: [{ id: "1", code: "SECRET-CODE" }],
    mediaKey: "secret-media-key",
    coupleAccess: { brideCode: { code: "BRIDESECRET", status: "active" }, bride: { accountId: "email:a@b.c", name: "Aisha" } },
  } as unknown as Wedding;
  const saved = snapshotWedding(wedding);
  const body = JSON.stringify(saved);
  assert.equal(saved.postingCodes?.length, 0);
  assert.equal(saved.mediaKey, undefined);
  assert.equal(saved.coupleAccess?.brideCode, undefined);
  assert.equal(body.includes("SECRET-CODE"), false);
  assert.equal(body.includes("password"), false);
  assert.equal(saved.chats[0]?.messages[0]?.text, "Hello");
  assert.equal(saved.cover, "");
});

test("pending messages stay pending until the server has the same id", () => {
  const merged = mergePendingMessages(
    [{ id: "server", author: "A", text: "Live", atLabel: "1" }],
    [{ id: "local", author: "A", text: "Queued", atLabel: "2", delivery: "sent" }],
  );
  assert.equal(merged.messages.length, 2);
  assert.equal(merged.stillPending[0]?.delivery, "pending");
  assert.equal(merged.messages.some((message) => message.id === "local" && message.delivery === "sent"), false);
});

test("flush waits offline, stops after denial, and retries a limited number of times", () => {
  assert.equal(decideFlush({ online: false, attempts: 0, denied: false }), "wait");
  assert.equal(decideFlush({ online: true, attempts: 0, denied: true }), "drop-denied");
  assert.equal(decideFlush({ online: true, attempts: 5, denied: false }), "give-up");
  assert.equal(decideFlush({ online: true, attempts: 1, denied: false }), "send");
});

test("ended weddings are not restored from the offline snapshot", () => {
  const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
  const future = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(snapshotRestorable({ id: "w", slug: "aisha", expiresAt: past, mediaRetentionUntil: past }, Date.now()), false);
  assert.equal(snapshotRestorable({ id: "w", slug: "aisha", expiresAt: future, mediaRetentionUntil: future }, Date.now()), true);
  assert.equal(snapshotRestorable({ id: "w", slug: "aisha" }, Date.now()), true);
  assert.equal(snapshotRestorable({ slug: "aisha" }, Date.now()), false);
});
test("cached weddings are not visible to a different account", () => {
  const a = ownerScope({ email: "a@example.com", phone: "" });
  const b = ownerScope({ email: "b@example.com", phone: "" });
  assert.equal(cacheVisible(a, a), true);
  assert.equal(cacheVisible(a, b), false);
  assert.equal(duplicateMessageIds([{ chats: [{ messages: [{ id: "m" }, { id: "m" }] }] }]).length, 1);
});
