import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { PGlite } from "@electric-sql/pglite";

const jiti = createJiti(import.meta.url, {
  alias: { "@": new URL("../src/", import.meta.url).pathname },
});

function toSql(pg) {
  const run = async (text, params = []) => {
    const result = await pg.query(text, params);
    return result.rows;
  };
  const sql = async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i += 1) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  };
  sql.query = run;
  return sql;
}

const base = {
  name: "Member",
  code: "FAMILY-LIVE",
  codes: ["FAMILY-LIVE"],
  to: "",
  kind: "",
  payload: null,
  after: 0,
  text: "",
  access: "",
  roster: "",
  stream: "",
  watch: "",
};

test("one camera room stays up and a second stream is refused", async () => {
  const { liveRoom, bindLiveSql } = await jiti.import("../src/lib/wedding/live-room.server.ts");
  const pg = new PGlite();
  await pg.waitReady;
  bindLiveSql(toSql(pg));
  const slug = "live-batch3";
  await liveRoom({ ...base, action: "start", slug, peerId: "peer-a1aa", memberKey: "missing-key", after: Date.now() });
  const hosts = [
    ["peer-a1aa", "member-a1aa", "Asha"],
    ["peer-b2bb", "member-b2bb", "Bina"],
  ];
  for (const [, key, name] of hosts) {
    await pg.query(
      "insert into circle_members (slug, member_key, email, name, role) values ($1, $2, '', $3, 'family')",
      [slug, key, name],
    );
  }
  await pg.query("insert into circle_members (slug, member_key, email, name, role) values ($1, $2, '', $3, 'guest')", [slug, "member-guest", "Guest"]);
  await pg.query("insert into circle_members (slug, member_key, email, name, role) values ($1, $2, '', $3, 'family')", ["other-wedding", "member-other", "Other"]);

  const started = await liveRoom({ ...base, action: "start", slug, peerId: "peer-a1aa", name: "Asha", memberKey: "member-a1aa", after: Date.now() });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.live, true);
  assert.equal(started.hostName, "Asha");

  const again = await liveRoom({ ...base, action: "start", slug, peerId: "peer-a1aa", name: "Asha", memberKey: "member-a1aa", after: Date.now() });
  assert.equal(again.ok, true, again.error);
  assert.equal(again.hostId, "peer-a1aa");

  const guestStart = await liveRoom({ ...base, action: "start", slug, peerId: "peer-guest", memberKey: "member-guest", after: Date.now() });
  assert.equal(guestStart.ok, false);

  const second = await liveRoom({ ...base, action: "start", slug, peerId: "peer-b2bb", memberKey: "member-b2bb", name: "Bina", after: Date.now() });
  assert.equal(second.ok, false);
  assert.match(second.error, /already has a live stream/);

  const sameMember = await liveRoom({ ...base, action: "start", slug, peerId: "peer-a1bb", memberKey: "member-a1aa", name: "Asha", after: Date.now() });
  assert.equal(sameMember.ok, false);
  assert.match(sameMember.error, /already has a live stream/);

  const board = await liveRoom({ ...base, action: "board", slug, peerId: "viewer01", memberKey: "member-guest" });
  assert.equal(board.ok, true);
  assert.equal(board.streams.length, 1);
  assert.equal(board.streams[0]?.hostId, "peer-a1aa");

  const impersonated = await liveRoom({ ...base, action: "stop", slug, peerId: "viewer01", memberKey: "member-guest", stream: "peer-a1aa", after: Date.now() });
  assert.equal(impersonated.ok, false);
  const still = await liveRoom({ ...base, action: "board", slug, peerId: "viewer01", memberKey: "member-guest" });
  assert.equal(still.streams.some((item) => item.hostId === "peer-a1aa"), true);

  const outsider = await liveRoom({ ...base, action: "board", slug, peerId: "outsider1", memberKey: "member-other", code: "", codes: [] });
  assert.equal(outsider.ok, false);

  const stopped = await liveRoom({ ...base, action: "stop", slug, peerId: "peer-a1aa", memberKey: "member-a1aa", stream: "peer-a1aa", after: Date.now() });
  assert.equal(stopped.ok, true);
  const next = await liveRoom({ ...base, action: "start", slug, peerId: "peer-b2bb", name: "Bina", memberKey: "member-b2bb", after: Date.now() });
  assert.equal(next.ok, true, next.error);
  const afterStop = await liveRoom({ ...base, action: "board", slug, peerId: "viewer01", memberKey: "member-guest" });
  assert.equal(afterStop.streams.length, 1);
  assert.equal(afterStop.streams[0]?.hostId, "peer-b2bb");
});

test("a live comment survives a fresh server process", async () => {
  const { liveRoom, bindLiveSql, clearLiveRooms } = await jiti.import("../src/lib/wedding/live-room.server.ts");
  const pg = new PGlite();
  await pg.waitReady;
  bindLiveSql(toSql(pg));
  clearLiveRooms();
  const slug = "live-chat-keep";
  await liveRoom({ ...base, action: "streams", slug, peerId: "viewer02", memberKey: "member-guest" });
  await pg.query("insert into circle_members (slug, member_key, email, name, role) values ($1, $2, '', $3, 'family')", [slug, "member-host", "Asha"]);
  await pg.query("insert into circle_members (slug, member_key, email, name, role) values ($1, $2, '', $3, 'guest')", [slug, "member-guest", "Guest"]);
  const started = await liveRoom({ ...base, action: "start", slug, peerId: "peer-host", name: "Asha", memberKey: "member-host", after: Date.now() });
  assert.equal(started.ok, true, started.error);
  const comment = await liveRoom({ ...base, action: "comment", slug, peerId: "peer-host", name: "Asha", memberKey: "member-host", text: "Hello circle", stream: "peer-host" });
  assert.equal(comment.ok, true, comment.error);
  assert.equal(comment.chats.some((item) => item.text === "Hello circle"), true);
  clearLiveRooms();
  const poll = await liveRoom({ ...base, action: "poll", slug, peerId: "viewer02", name: "Guest", memberKey: "member-guest", stream: "peer-host" });
  assert.equal(poll.ok, true, poll.error);
  assert.equal(poll.chats.some((item) => item.text === "Hello circle"), true);
  assert.equal(typeof poll.chats.find((item) => item.text === "Hello circle").at, "number");
});
