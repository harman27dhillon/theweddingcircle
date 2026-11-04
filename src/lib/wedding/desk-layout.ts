/** Desktop wedding workspace. Phone navigation does not use this. */

export const DESK_SPLIT_QUERY = "(min-width: 1100px)";

export type DeskPanels = { left: 0 | 1; right: 2 | 3 | 4 };

export function emptyDeskPanels(): DeskPanels {
  return { left: 0, right: 2 };
}

export function readDeskPanels(raw: string | null): DeskPanels | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { left?: unknown; right?: unknown };
    const left = parsed.left === 0 || parsed.left === 1 ? parsed.left : null;
    const right = parsed.right === 2 || parsed.right === 3 || parsed.right === 4 ? parsed.right : null;
    if (left === null || right === null) return null;
    return { left, right };
  } catch {
    return null;
  }
}

/** Route changes update only the panel that owns that section. */
export function panelsFromRoute(routeIndex: number, current: DeskPanels): DeskPanels {
  if (routeIndex === 0 || routeIndex === 1) return { ...current, left: routeIndex };
  if (routeIndex === 2 || routeIndex === 3 || routeIndex === 4) return { ...current, right: routeIndex };
  return current;
}

export function deskPaneVisible(index: number, split: boolean, active: number, panels: DeskPanels) {
  if (!split) return index === active;
  if (index <= 1) return index === panels.left;
  return index === panels.right;
}
