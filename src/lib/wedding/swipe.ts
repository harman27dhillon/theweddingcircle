/** Next tab for a horizontal swipe. A short flick and a longer drag both count. Vertical movement stays put. */
export function nextSwipeIndex(current: number, dx: number, dy: number, elapsedMs: number, count = 5) {
  if (current < 0 || current >= count) return current;
  const elapsed = Math.max(16, elapsedMs);
  const speed = Math.abs(dx) / elapsed;
  const horizontal = Math.abs(dx) > Math.abs(dy) * 1.15;
  const flung = horizontal && Math.abs(dx) >= 28 && speed >= 0.45;
  const dragged = horizontal && Math.abs(dx) >= 52;
  if (!flung && !dragged) return current;
  const next = current + (dx < 0 ? 1 : -1);
  if (next < 0 || next >= count) return current;
  return next;
}
