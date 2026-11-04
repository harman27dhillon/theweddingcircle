import assert from "node:assert/strict";
import test from "node:test";
import { cleanBotDraft, dedupeProducts, httpsUrl, sourceReadiness } from "./discover.ts";

test("unconfigured retailer bots do not pretend to search", () => {
  const amazon = sourceReadiness("amazon-india", new Set());
  assert.equal(amazon.status, "needs_connection");
  assert.equal(amazon.label, "Needs connection");
  assert.ok(amazon.missing.includes("AMAZON_PA_ACCESS_KEY"));
  assert.match(amazon.detail, /did not create products/i);

  const ready = sourceReadiness("flipkart", new Set(["FLIPKART_AFFILIATE_ID", "FLIPKART_AFFILIATE_TOKEN"]));
  assert.equal(ready.status, "not_configured");
  assert.match(ready.detail, /No products were added/);

  const research = sourceReadiness("bridal-dress", new Set());
  assert.equal(research.status, "needs_connection");
  const researchWithKey = sourceReadiness("bridal-jewellery", new Set(["AMAZON_PA_ACCESS_KEY"]));
  assert.equal(researchWithKey.status, "not_configured");
});

test("products stay unique across bots", () => {
  const items = dedupeProducts([
    { source: "Amazon", sourceProductId: "B001", name: "Lehenga" },
    { source: "amazon", sourceProductId: "B001", name: "Lehenga copy" },
    { source: "Flipkart", sourceProductId: "F9", name: "Nath" },
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.name, "Lehenga");
});

test("only https product links are accepted", () => {
  assert.equal(httpsUrl("http://example.com/p"), "");
  assert.equal(httpsUrl("javascript:alert(1)"), "");
  assert.equal(httpsUrl("https://www.amazon.in/dp/example"), "https://www.amazon.in/dp/example");
});

test("bot settings are rejected when they would publish without a limit", () => {
  const bad = cleanBotDraft({ id: "amazon-india", keywords: "lehenga", categories: "dresses", maxResults: 500, scheduleHours: 24, freshnessDays: 14 });
  assert.equal(bad.ok, false);
  const good = cleanBotDraft({ id: "meesho", keywords: "potli bag", categories: "accessories,accessories", scheduleHours: 12, maxResults: 10, freshnessDays: 7, enabled: false });
  assert.equal(good.ok, true);
  if (good.ok) assert.equal(good.value.categories, "accessories");
});
