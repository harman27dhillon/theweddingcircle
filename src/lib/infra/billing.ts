import { createHash } from "node:crypto";

export const PLAY_CATALOG = [
  { slot: "premium_themes", title: "Premium themes and theme packs", kind: "one_time" as const, env: "PLAY_PRODUCT_PREMIUM_THEMES" },
  { slot: "extra_storage", title: "Extra wedding media storage", kind: "one_time" as const, env: "PLAY_PRODUCT_EXTRA_STORAGE" },
  { slot: "premium_membership", title: "Optional premium membership", kind: "subscription" as const, env: "PLAY_PRODUCT_PREMIUM_MEMBERSHIP" },
] as const;

export type PurchaseSlot = (typeof PLAY_CATALOG)[number]["slot"];
export type PlayAcknowledgement = "pending" | "acknowledged" | "unknown";

export function purchaseTokenHash(token: string) {
  return createHash("sha256").update(token.trim()).digest("hex");
}

function acknowledgementOf(value: unknown): PlayAcknowledgement {
  if (value === 0 || value === "0" || value === "ACKNOWLEDGEMENT_STATE_PENDING") return "pending";
  if (value === 1 || value === "1" || value === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") return "acknowledged";
  return "unknown";
}

function productIdOf(reported: unknown, expectedProductId: string) {
  const id = typeof reported === "string" ? reported.trim() : "";
  if (id && id !== expectedProductId) return { ok: false as const, error: "The product did not match. Nothing was unlocked." };
  const productId = id || expectedProductId;
  if (!productId) return { ok: false as const, error: "The product did not match. Nothing was unlocked." };
  return { ok: true as const, productId };
}

/** One-time product purchase. Pending is not a refund. A missing product id uses the id that was requested. */
export function interpretPlayProduct(body: unknown, expectedProductId: string) {
  if (!body || typeof body !== "object") return { ok: false as const, error: "Google did not confirm this purchase. Nothing was unlocked." };
  const record = body as Record<string, unknown>;
  const context = record.purchaseStateContext && typeof record.purchaseStateContext === "object"
    ? String((record.purchaseStateContext as { purchaseState?: unknown }).purchaseState || "")
    : "";
  let purchaseState: number | null = null;
  if (context === "PURCHASED") purchaseState = 0;
  else if (context === "CANCELLED" || context === "CANCELED") purchaseState = 1;
  else if (context === "PENDING") purchaseState = 2;
  else if (record.purchaseState === 0 || record.purchaseState === "0") purchaseState = 0;
  else if (record.purchaseState === 1 || record.purchaseState === "1") purchaseState = 1;
  else if (record.purchaseState === 2 || record.purchaseState === "2") purchaseState = 2;
  if (purchaseState == null) return { ok: false as const, error: "Google did not include a purchase state. Nothing was unlocked." };
  const product = productIdOf(record.productId, expectedProductId);
  if (!product.ok) return product;
  const testPurchase = record.purchaseType === 0 || record.purchaseType === "0" || (record.testPurchaseContext != null && typeof record.testPurchaseContext === "object");
  return {
    ok: true as const,
    purchaseState,
    productId: product.productId,
    acknowledgement: acknowledgementOf(record.acknowledgementState),
    testPurchase,
  };
}

function expiryMs(item: unknown) {
  if (!item || typeof item !== "object") return Number.NaN;
  return Date.parse(String((item as { expiryTime?: unknown }).expiryTime || ""));
}

/**
 * Subscriptions v2. Active and grace stay entitled.
 * Canceled stays entitled only until expiryTime. Pending, paused, and on hold do not revoke.
 */
export function interpretPlaySubscription(body: unknown, expectedProductId: string, nowMs: number) {
  if (!body || typeof body !== "object") return { ok: false as const, error: "Google did not confirm this subscription. Nothing was unlocked." };
  const record = body as Record<string, unknown>;
  const state = typeof record.subscriptionState === "string" ? record.subscriptionState : "";
  const items = Array.isArray(record.lineItems) ? record.lineItems : [];
  const matched = items.find((item) => item && typeof item === "object" && (item as { productId?: unknown }).productId === expectedProductId)
    || (items.length === 1 && items[0] && typeof items[0] === "object" && !(items[0] as { productId?: unknown }).productId ? items[0] : null);
  if (!matched) return { ok: false as const, error: "Google did not confirm this subscription. Nothing was unlocked." };
  const product = productIdOf((matched as { productId?: unknown }).productId, expectedProductId);
  if (!product.ok) return product;
  const expiry = expiryMs(matched);
  const unexpired = Number.isFinite(expiry) && expiry > nowMs;
  let outcome: "grant" | "revoke" | "hold" = "hold";
  let detail = "Google did not confirm an active subscription. Nothing was unlocked and nothing was revoked.";
  if (state === "SUBSCRIPTION_STATE_ACTIVE" || state === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
    outcome = "grant";
    detail = "";
  } else if (state === "SUBSCRIPTION_STATE_CANCELED") {
    if (unexpired) {
      outcome = "grant";
      detail = "";
    } else if (Number.isFinite(expiry)) {
      outcome = "revoke";
      detail = "";
    } else detail = "Google shows this subscription as canceled, but no future expiry was included. Nothing was unlocked and nothing was revoked.";
  } else if (state === "SUBSCRIPTION_STATE_EXPIRED" || state === "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED") {
    outcome = "revoke";
    detail = "";
  } else if (state === "SUBSCRIPTION_STATE_PENDING") detail = "Google still has this subscription pending. Nothing was unlocked and nothing was revoked.";
  else if (state === "SUBSCRIPTION_STATE_ON_HOLD") detail = "Google placed this subscription on hold. Nothing was unlocked and nothing was revoked.";
  else if (state === "SUBSCRIPTION_STATE_PAUSED") detail = "Google shows this subscription as paused. Nothing was unlocked and nothing was revoked.";
  const testPurchase = (record.testPurchaseContext != null && typeof record.testPurchaseContext === "object") || record.purchaseType === 0 || record.purchaseType === "0";
  return {
    ok: true as const,
    outcome,
    productId: product.productId,
    acknowledgement: acknowledgementOf(record.acknowledgementState),
    testPurchase,
    detail,
  };
}

export function decidePurchase(input: {
  configured: boolean;
  productMapped: boolean;
  api: { ok: true; purchaseState: number; productId: string } | { ok: false; error: string } | null;
  existing: { state: "purchased" | "refunded" } | null;
  expectedProductId: string;
}) {
  if (!input.configured) return { ok: false as const, error: "Google Play Billing is not configured. Nothing was unlocked." };
  if (!input.productMapped || !input.expectedProductId) return { ok: false as const, error: "That product is not in the Play Console catalogue. Nothing was unlocked." };
  if (!input.api) return { ok: false as const, error: "Google did not confirm this purchase. Nothing was unlocked." };
  if (!input.api.ok) return { ok: false as const, error: input.api.error || "Google did not confirm this purchase. Nothing was unlocked." };
  if (input.api.productId !== input.expectedProductId) return { ok: false as const, error: "The product did not match. Nothing was unlocked." };
  const state = Number(input.api.purchaseState);
  if (state === 2) return { ok: false as const, grant: false as const, revoke: false as const, error: "Google has not finished this purchase. Nothing was unlocked and nothing was revoked." };
  if (state === 1) return { ok: false as const, grant: false as const, revoke: true as const, error: "Google reported this purchase as cancelled or refunded. Access was not granted." };
  if (state !== 0) return { ok: false as const, error: "Google did not confirm this purchase. Nothing was unlocked." };
  if (input.existing?.state === "purchased") return { ok: false as const, duplicate: true as const, error: "This purchase was already recorded. It was not applied twice." };
  return { ok: true as const, grant: true as const };
}