/** Shared wedding theme. The server themeRev is the source of truth across devices. */

export function themeRevOf(wedding: { themeRev?: number } | null | undefined) {
  const value = Number(wedding?.themeRev ?? 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1_000_000, Math.floor(value));
}

export function mergeSharedTheme<T extends { cardTheme?: string; themeRev?: number }>(current: T, incoming: T) {
  const currentRev = themeRevOf(current);
  const incomingRev = themeRevOf(incoming);
  if (incomingRev > currentRev && incoming.cardTheme) {
    return { cardTheme: incoming.cardTheme, themeRev: incomingRev };
  }
  return { cardTheme: current.cardTheme, themeRev: currentRev };
}

/** A full wedding save keeps every other field, but cannot roll the shared theme backwards. */
export function withSharedTheme<T extends { cardTheme?: string; themeRev?: number }>(current: T, incoming: T): T {
  const theme = mergeSharedTheme(current, incoming);
  return { ...incoming, cardTheme: theme.cardTheme, themeRev: theme.themeRev };
}

export function themeWriteDecision(
  current: { cardTheme?: string; themeRev?: number },
  incoming: { cardTheme?: string; themeRev?: number },
  allowed: boolean,
): { ok: true; cardTheme: string; themeRev: number } | { ok: false; error: "denied" | "stale"; cardTheme?: string; themeRev: number } {
  const currentRev = themeRevOf(current);
  if (!allowed) return { ok: false, error: "denied", cardTheme: current.cardTheme, themeRev: currentRev };
  const incomingRev = themeRevOf(incoming);
  if (!incoming.cardTheme || incomingRev <= currentRev) {
    return { ok: false, error: "stale", cardTheme: current.cardTheme, themeRev: currentRev };
  }
  return { ok: true, cardTheme: incoming.cardTheme, themeRev: incomingRev };
}

export type ThemeLock = { id: string; themeRev?: number; failed?: boolean } | null | undefined;

/**
 * Theme to show after a pull.
 * A pending apply stays until the server confirms it or a higher themeRev arrives.
 * A stale pull cannot replace a newer confirmed theme.
 */
export function remoteThemeChoice(
  current: { cardTheme?: string; themeRev?: number },
  remote: { cardTheme?: string; themeRev?: number },
  lock?: ThemeLock,
) {
  const remoteRev = themeRevOf(remote);
  const localRev = themeRevOf(current);
  const pendingRev = lock ? Math.max(localRev, themeRevOf({ themeRev: lock.themeRev })) : 0;
  if (lock && remote.cardTheme === lock.id && remoteRev >= pendingRev && remoteRev > 0) {
    return { cardTheme: lock.id, themeRev: remoteRev, clearLock: true };
  }
  if (lock && remoteRev > pendingRev && remote.cardTheme && remote.cardTheme !== lock.id) {
    return { cardTheme: remote.cardTheme, themeRev: remoteRev, clearLock: true };
  }
  if (lock) return { cardTheme: lock.id, themeRev: Math.max(localRev, pendingRev), clearLock: false };
  if (remoteRev > localRev && remote.cardTheme) {
    return { cardTheme: remote.cardTheme, themeRev: remoteRev, clearLock: false };
  }
  if (!lock && remote.cardTheme && remoteRev === localRev && remoteRev === 0 && remote.cardTheme !== current.cardTheme) {
    return { cardTheme: remote.cardTheme, themeRev: 0, clearLock: false };
  }
  if (!lock && remote.cardTheme && remoteRev > 0 && remoteRev === localRev) {
    return { cardTheme: remote.cardTheme, themeRev: remoteRev, clearLock: false };
  }
  return { cardTheme: current.cardTheme, themeRev: localRev, clearLock: false };
}
