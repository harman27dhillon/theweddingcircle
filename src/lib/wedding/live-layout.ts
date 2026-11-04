export type PlaybackState = "connecting" | "live" | "reconnecting" | "failed";

export type WatchTile =
  | { kind: "camera"; id: string }
  | { kind: "youtube"; id: string }
  | { kind: "self"; id: "self" }
  | { kind: "empty"; id: string };

/**
 * One picture. A camera already on air fills the only slot.
 * YouTube is not a second tile. An empty slot is the single Go Live control.
 */
export function watchTiles(cameraIds: string[], _youtube: string, selfLive = false): WatchTile[] {
  if (selfLive) return [{ kind: "self", id: "self" }];
  const id = cameraIds.find(Boolean);
  if (id) return [{ kind: "camera", id }];
  return [{ kind: "empty", id: "empty-0" }];
}

/** LIVE is only for a player that is actually receiving the broadcast. */
export function playbackBadge(connection: PlaybackState) {
  if (connection === "live") return { live: true, text: "Live" };
  if (connection === "reconnecting") return { live: false, text: "Reconnecting" };
  if (connection === "failed") return { live: false, text: "Couldn't connect" };
  return { live: false, text: "Connecting" };
}

export function youtubePlayerMessage(code: number) {
  if (code === 101 || code === 150) return "YouTube is not allowing this video to be embedded.";
  if (code === 100) return "This YouTube video is unavailable, private, or removed.";
  if (code === 5) return "YouTube could not play this video in the browser.";
  if (code === 2) return "That YouTube link is not a video this player can open.";
  return "YouTube could not play this link.";
}
