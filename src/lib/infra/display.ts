/** Safe text for React. Dates and objects must never be rendered as children. */
export function displayText(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return "";
}

export function testResultText(result: unknown) {
  if (!result || typeof result !== "object") return { ok: false as const, text: "The check did not return a readable result." };
  const body = result as { ok?: unknown; detail?: unknown; error?: unknown };
  if (body.ok === true) return { ok: true as const, text: displayText(body.detail) || "The connection check finished." };
  return { ok: false as const, text: displayText(body.error) || displayText(body.detail) || "The connection check failed." };
}
