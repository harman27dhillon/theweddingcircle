import assert from "node:assert/strict";
import test from "node:test";
import {
  DAY_MS,
  LIFESPAN_MS,
  applyPaidExtension,
  backfillLifecycle,
  currentReminderSlot,
  freshLifecycle,
  readyToDelete,
  remindersOpen,
  circleEntry,
} from "./lifecycle.ts";

const created = Date.parse("2026-01-01T00:00:00.000Z");

test("a new wedding expires exactly 30 days of 24 hours later", () => {
  const life = freshLifecycle(created);
  assert.equal(life.createdAt, "2026-01-01T00:00:00.000Z");
  assert.equal(Date.parse(life.expiresAt) - created, LIFESPAN_MS);
  assert.equal(life.mediaRetentionUntil, life.expiresAt);
  assert.equal(LIFESPAN_MS, 30 * DAY_MS);
});

test("missing creation timestamps are not invented and existing deadlines are not moved", () => {
  assert.equal(backfillLifecycle({}), null);
  const stamped = freshLifecycle(created);
  const again = backfillLifecycle({ ...stamped, reliableCreatedAt: "2026-06-01T00:00:00.000Z" });
  assert.equal(again?.expiresAt, stamped.expiresAt);
  assert.equal(again?.createdAt, stamped.createdAt);
});

test("reminders start seven days before expiry and change every 12 hours", () => {
  const life = freshLifecycle(created);
  const start = Date.parse(life.expiresAt) - 7 * DAY_MS;
  assert.equal(currentReminderSlot(life.expiresAt, start - 1), null);
  const first = currentReminderSlot(life.expiresAt, start);
  const next = currentReminderSlot(life.expiresAt, start + 12 * 60 * 60 * 1000);
  assert.ok(first && next && first !== next);
  assert.equal(currentReminderSlot(life.expiresAt, Date.parse(life.expiresAt)), null);
  assert.equal(remindersOpen(life, start), true);
});

test("a paid extension moves only media retention, and a pending payment does not", () => {
  const life = freshLifecycle(created);
  const pending = applyPaidExtension(life, { status: "pending", reference: "r1" }, []);
  assert.equal(pending.applied, false);
  assert.equal(pending.life.mediaRetentionUntil, life.mediaRetentionUntil);
  const paid = applyPaidExtension(life, { status: "paid", reference: "r1" }, []);
  assert.equal(paid.applied, true);
  assert.equal(paid.life.expiresAt, life.expiresAt);
  assert.equal(Date.parse(paid.life.mediaRetentionUntil) - Date.parse(life.mediaRetentionUntil), LIFESPAN_MS);
  const twice = applyPaidExtension(paid.life, { status: "paid", reference: "r1" }, ["r1"]);
  assert.equal(twice.applied, false);
  assert.equal(twice.life.mediaRetentionUntil, paid.life.mediaRetentionUntil);
  assert.equal(remindersOpen(paid.life, Date.parse(life.expiresAt) - DAY_MS), false);
});

test("cleanup waits for both deadlines and ignores a stale job after an extension", () => {
  const life = freshLifecycle(created);
  const expiry = Date.parse(life.expiresAt);
  assert.equal(readyToDelete(life, expiry - 1), false);
  assert.equal(readyToDelete(life, expiry), true);
  const extended = applyPaidExtension(life, { status: "paid", reference: "r2" }, []).life;
  assert.equal(readyToDelete(extended, expiry), false);
  assert.equal(readyToDelete(extended, Date.parse(extended.mediaRetentionUntil)), true);
});

test("guests are locked at expiry and hosts stay until media retention ends", () => {
  const life = freshLifecycle(created);
  const expiry = Date.parse(life.expiresAt);
  assert.equal(circleEntry(life, "guest", expiry - 1), "open");
  assert.equal(circleEntry(life, "host", expiry - 1), "open");
  assert.equal(circleEntry(life, "guest", expiry), "ended");
  assert.equal(circleEntry(life, "host", expiry), "ended");
  const extended = applyPaidExtension(life, { status: "paid", reference: "r3" }, []).life;
  assert.equal(circleEntry(extended, "guest", expiry), "guest-closed");
  assert.equal(circleEntry(extended, "host", expiry), "open");
  assert.equal(circleEntry(extended, "cohost", expiry), "open");
  assert.equal(circleEntry(extended, "host", Date.parse(extended.mediaRetentionUntil)), "ended");
  assert.equal(circleEntry({}, "guest", expiry), "open");
});
