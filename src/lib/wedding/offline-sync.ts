import { mergeChats } from "@/lib/wedding/activity";
import { idbAll, idbClearOwner, idbDelete, idbGet, idbPut } from "@/lib/wedding/offline-db";
import { cacheVisible, decideFlush, ownerScope, snapshotRestorable, snapshotWedding } from "@/lib/wedding/offline";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Account, ChatMessage, Wedding } from "@/lib/wedding/types";

type OutboxRow = {
  key: string;
  owner: string;
  weddingId: string;
  name: string;
  attempts: number;
  activity: { action: string; chatId?: string; message?: ChatMessage; post?: unknown; postId?: string; comment?: unknown; messageId?: string; fn?: unknown; functionId?: string };
  mark: { kind: string; id: string; chatId?: string };
};

type SnapshotRow = { key: string; owner: string; weddingId: string; syncedAt: number; wedding: Wedding };
type DraftRow = { key: string; owner: string; weddingId: string; chatId: string; text: string };

function draftKey(owner: string, weddingId: string, chatId: string) {
  return `${owner}::${weddingId}::${chatId}`;
}

export async function writeDraft(account: Account | null, weddingId: string, chatId: string, text: string) {
  const owner = ownerScope(account);
  const key = draftKey(owner, weddingId, chatId);
  const clean = text.slice(0, 4000);
  if (!clean.trim()) {
    await idbDelete("drafts", key);
    return;
  }
  const row: DraftRow = { key, owner, weddingId, chatId, text: clean };
  await idbPut("drafts", key, row);
}

export async function readDraft(account: Account | null, weddingId: string, chatId: string) {
  const owner = ownerScope(account);
  const row = await idbGet<DraftRow>("drafts", draftKey(owner, weddingId, chatId));
  if (!row || !cacheVisible(row.owner, owner)) return "";
  return row.text || "";
}

export async function rememberSnapshot(account: Account | null) {
  const owner = ownerScope(account);
  const weddings = useWeddingStore.getState().weddings;
  for (const wedding of weddings) {
    if (!wedding?.id || wedding.slug === "lila-nico") continue;
    const row: SnapshotRow = {
      key: `${owner}::${wedding.id}`,
      owner,
      weddingId: wedding.id,
      syncedAt: Date.now(),
      wedding: snapshotWedding(wedding),
    };
    await idbPut("snapshots", row.key, row);
  }
}

export async function hydrateOffline(account: Account | null) {
  if (typeof navigator !== "undefined" && navigator.onLine) return;
  const owner = ownerScope(account);
  const rows = await idbAll<SnapshotRow>("snapshots");
  const mine = rows.filter((row) => cacheVisible(row.owner, owner) && row.wedding?.id);
  if (!mine.length) return;
  useWeddingStore.setState((state) => {
    const byId = new Map(state.weddings.map((wedding) => [wedding.id, wedding]));
    const next = state.weddings.slice();
    for (const row of mine) {
      if (!snapshotRestorable(row.wedding, Date.now())) continue;
      const local = byId.get(row.wedding.id);
      if (!local) {
        next.push(row.wedding);
        continue;
      }
      const index = next.findIndex((wedding) => wedding.id === local.id);
      if (index < 0) continue;
      next[index] = {
        ...local,
        chats: mergeChats(local.chats ?? [], row.wedding.chats ?? []),
      };
    }
    return { weddings: next };
  });
}

export async function dropWeddingCache(weddingId: string) {
  if (!weddingId) return;
  for (const store of ["snapshots", "drafts", "outbox"] as const) {
    const rows = await idbAll<{ key?: string; weddingId?: string }>(store);
    await Promise.all(
      rows
        .filter((row) => row?.weddingId === weddingId && row.key)
        .map((row) => idbDelete(store, row.key as string)),
    );
  }
}

export async function noteOfflineSend(
  account: Account | null,
  weddingId: string,
  name: string,
  activity: OutboxRow["activity"],
  mark: OutboxRow["mark"],
) {
  const owner = ownerScope(account);
  const key = `${owner}::${mark.id}`;
  const row: OutboxRow = { key, owner, weddingId, name, attempts: 0, activity, mark };
  await idbPut("outbox", key, row);
}

export async function clearAccountCache(account: Account | null) {
  await idbClearOwner(ownerScope(account));
  dropSharedShellCache();
}

/** Drops any old shared document cache. Hashed scripts and interface art stay. */
export function dropSharedShellCache() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.getRegistration("/").then((registration) => {
    registration?.active?.postMessage({ type: "DROP_PRIVATE" });
    registration?.waiting?.postMessage({ type: "DROP_PRIVATE" });
  });
}

function setDelivery(weddingId: string, mark: OutboxRow["mark"], delivery: "pending" | "sent" | "failed") {
  useWeddingStore.setState((state) => ({
    weddings: state.weddings.map((wedding) => {
      if (wedding.id !== weddingId) return wedding;
      if (mark.kind === "post") {
        return { ...wedding, posts: wedding.posts.map((post) => (post.id === mark.id ? { ...post, delivery } : post)) };
      }
      return {
        ...wedding,
        chats: wedding.chats.map((chat) =>
          chat.id !== mark.chatId
            ? chat
            : { ...chat, messages: chat.messages.map((message) => (message.id === mark.id ? { ...message, delivery } : message)) },
        ),
      };
    }),
  }));
}

export async function flushOutbox() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const owner = ownerScope(useWeddingStore.getState().account);
  const rows = (await idbAll<OutboxRow>("outbox")).filter((row) => cacheVisible(row.owner, owner));
  if (!rows.length) return;
  const { pushActivity } = await import("@/lib/wedding/publish");
  for (const row of rows) {
    const wedding = useWeddingStore.getState().weddings.find((item) => item.id === row.weddingId);
    if (!wedding) continue;
    const decision = decideFlush({ online: true, attempts: row.attempts, denied: false });
    if (decision === "give-up") {
      setDelivery(row.weddingId, row.mark, "failed");
      await idbDelete("outbox", row.key);
      continue;
    }
    const result = await pushActivity(wedding, row.name, row.activity as never);
    if (result === "local") {
      await idbDelete("outbox", row.key);
      continue;
    }
    if (result === "ok") {
      setDelivery(row.weddingId, row.mark, "sent");
      await idbDelete("outbox", row.key);
      continue;
    }
    if (result === "denied") {
      setDelivery(row.weddingId, row.mark, "failed");
      await idbDelete("outbox", row.key);
      continue;
    }
    if (result === "offline") {
      setDelivery(row.weddingId, row.mark, "pending");
      return;
    }
    const attempts = row.attempts + 1;
    if (decideFlush({ online: true, attempts, denied: false }) === "give-up") {
      setDelivery(row.weddingId, row.mark, "failed");
      await idbDelete("outbox", row.key);
    } else {
      await idbPut("outbox", row.key, { ...row, attempts });
      setDelivery(row.weddingId, row.mark, "pending");
    }
  }
}
