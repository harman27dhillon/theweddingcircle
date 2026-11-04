const DB_NAME = "wc-offline";
const DB_VERSION = 1;

type StoreName = "snapshots" | "drafts" | "outbox";

function openDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no-idb"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
      if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("idb"));
  });
}

function run<T>(store: StoreName, mode: IDBTransactionMode, op: (objectStore: IDBObjectStore) => IDBRequest<T>) {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = op(tx.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("idb"));
        tx.oncomplete = () => db.close();
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("idb"));
        };
      }),
  );
}

export async function idbPut(store: StoreName, key: string, value: unknown) {
  try {
    await run(store, "readwrite", (objectStore) => objectStore.put(value, key));
    return { ok: true as const };
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "QuotaExceededError") return { ok: false as const, error: "quota" as const };
    return { ok: false as const, error: "unavailable" as const };
  }
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | null> {
  try {
    const value = await run<T | undefined>(store, "readonly", (objectStore) => objectStore.get(key));
    return value ?? null;
  } catch {
    return null;
  }
}

export async function idbDelete(store: StoreName, key: string) {
  try {
    await run(store, "readwrite", (objectStore) => objectStore.delete(key));
  } catch {
    /* the queue can be rebuilt from the on-screen thread */
  }
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  try {
    const values = await run<T[]>(store, "readonly", (objectStore) => objectStore.getAll());
    return values ?? [];
  } catch {
    return [];
  }
}

export async function idbClearOwner(owner: string) {
  if (!owner) return;
  for (const store of ["snapshots", "drafts", "outbox"] as const) {
    const rows = await idbAll<{ owner?: string; key?: string }>(store);
    await Promise.all(
      rows
        .filter((row) => row?.owner === owner)
        .map((row) => (row.key ? idbDelete(store, row.key) : Promise.resolve())),
    );
  }
}
