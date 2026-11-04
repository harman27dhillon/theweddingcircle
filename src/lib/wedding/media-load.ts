export type MediaAttempt = {
  /** True once the original file is being tried instead of a thumbnail. */
  full: boolean;
  /** Automatic retries already spent on the current file. */
  tries: number;
  failed: boolean;
};

/**
 * After a photo element fails to decode.
 * A thumbnail falls back to the original once. That file is retried once. Then it stops
 * until the person taps Retry. Nothing here contacts storage.
 */
export function mediaAfterImageError(state: MediaAttempt, preview: boolean): MediaAttempt & { drop: "preview" | "full" | "both" } {
  if (preview && !state.full) return { full: true, tries: 0, failed: false, drop: "preview" };
  if (state.tries < 1) return { full: true, tries: state.tries + 1, failed: false, drop: "full" };
  return { full: true, tries: state.tries, failed: true, drop: "both" };
}
