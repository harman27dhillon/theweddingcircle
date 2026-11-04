/** How a chat media group is shown. More than four files stay a 2×2 grid with a +N tile. */
export function mediaGridPlan(count: number) {
  const total = Math.max(0, Math.floor(count) || 0);
  if (total <= 1) return { mode: "1" as const, columns: 1, cells: total, extra: 0 };
  if (total === 2) return { mode: "2" as const, columns: 2, cells: 2, extra: 0 };
  if (total === 3) return { mode: "3" as const, columns: 3, cells: 3, extra: 0 };
  if (total === 4) return { mode: "4" as const, columns: 2, cells: 4, extra: 0 };
  return { mode: "4" as const, columns: 2, cells: 4, extra: total - 3 };
}
