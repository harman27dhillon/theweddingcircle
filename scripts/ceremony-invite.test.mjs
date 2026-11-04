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

const guestCode = "GUEST-NOTINURL99";
const familyCode = "FAMILY-NOTINURL99";
const brideCode = "BRIDE-NOTINURL99";

function weddingPayload() {
  return {
    slug: "meera-arun",
    bride: "Meera",
    groom: "Arun",
    date: "2026-12-12",
    city: "Jaipur",
    cardTheme: "midnight-emerald",
    disabled: false,
    postingCodes: [
      { id: "family-code-1", code: familyCode, kind: "family" },
      { id: "guest-code-1", code: guestCode, kind: "guest" },
    ],
    functions: [
      { id: "haldi", name: "Haldi", date: "2026-12-11", time: "10:00", venue: "Courtyard", note: "Turmeric", secretCode: guestCode, live: true },
      { id: "wedding", name: "Wedding", date: "2026-12-12", time: "11:00", venue: "Glass Hall", address: "MI Road", dress: "Pastel", endTime: "13:00" },
    ],
  };
}

test("ceremony selection copies only real details and does not grant by role name alone", async () => {
  const { snapshotCeremonies, canIssueInvite, invitationShareText } = await jiti.import("../src/lib/wedding/ceremony-invite.ts");
  const functions = weddingPayload().functions;
  const before = JSON.stringify(functions);
  const snaps = snapshotCeremonies(functions, ["wedding", "missing"]);
  assert.equal(JSON.stringify(functions), before);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].name, "Wedding");
  assert.equal(snaps[0].dress, "Pastel");
  assert.equal(snaps[0].secretCode, undefined);
  assert.equal(snaps[0].live, undefined);
  assert.equal(canIssueInvite({ host: false, family: true, bride: false, groom: false }, "guest"), false);
  assert.equal(canIssueInvite({ host: false, family: true, bride: false, groom: false }, "family"), true);
  assert.equal(canIssueInvite({ host: false, family: false, bride: true, groom: false }, "bride"), true);
  assert.equal(canIssueInvite({ host: false, family: false, bride: true, groom: false }, "groom"), false);
  assert.equal(canIssueInvite({ host: false, family: false, bride: false, groom: false }, "family"), false);
  const text = invitationShareText({ bride: "Meera", groom: "Arun", ceremonies: snaps, url: "https://example.test/i/token" });
  assert.match(text, /Wedding/);
  assert.doesNotMatch(text, new RegExp(guestCode));
  assert.match(text, /https:\/\/example.test\/i\/token/);
});

test("temporary invitation links expire on the server and stay inside the code's access", async () => {
  const api = await jiti.import("../src/lib/wedding/ceremony-invite.server.ts");
  const pg = new PGlite();
  await pg.waitReady;
  await pg.query(`create table if not exists circles (
    slug text primary key,
    payload jsonb not null,
    edit_key text not null,
    updated_at timestamptz not null default now()
  )`);
  await pg.query(`create table if not exists circle_members (
    slug text not null,
    member_key text not null,
    email text not null default '',
    name text not null default '',
    role text not null,
    primary key (slug, member_key)
  )`);
  await pg.query(`create table if not exists couple_access (
    slug text primary key,
    bride_code text not null default '',
    bride_status text not null default '',
    bride_claimed text not null default '',
    bride_account text not null default '',
    bride_name text not null default '',
    groom_code text not null default '',
    groom_status text not null default '',
    groom_claimed text not null default '',
    groom_account text not null default '',
    groom_name text not null default ''
  )`);
  const payload = weddingPayload();
  await pg.query("insert into circles (slug, payload, edit_key) values ($1, $2::jsonb, $3)", ["meera-arun", JSON.stringify(payload), "edit-key-1234567890"]);
  await pg.query("insert into circle_members (slug, member_key, email, name, role) values ('meera-arun', 'member-family', '', 'Aunt', 'family')");
  await pg.query("insert into circle_members (slug, member_key, email, name, role) values ('meera-arun', 'member-guest', '', 'Guest', 'guest')");
  await pg.query(`insert into couple_access (slug, bride_code, bride_status, groom_code, groom_status, bride_account, groom_account)
    values ('meera-arun', $1, 'active', 'GROOM-OTHER', 'active', 'email:bride@example.com', '')`, [brideCode]);
  api.bindCeremonyInviteSql(toSql(pg));

  const base = { slug: "meera-arun", editKey: "", memberKey: "", accountId: "", ceremonyIds: ["haldi"] };
  const guestDenied = await api.createCeremonyInvite({ ...base, memberKey: "member-guest", codeId: "family-code-1", kind: "family" });
  assert.equal(guestDenied.ok, false);

  const familyGuest = await api.createCeremonyInvite({ ...base, memberKey: "member-family", codeId: "guest-code-1", kind: "guest" });
  assert.equal(familyGuest.ok, false);

  const wrongId = await api.createCeremonyInvite({ ...base, editKey: "edit-key-1234567890", codeId: "guest-code-1", kind: "family" });
  assert.equal(wrongId.ok, false);

  const brideGroom = await api.createCeremonyInvite({ ...base, accountId: "email:bride@example.com", codeId: "groom", kind: "groom" });
  assert.equal(brideGroom.ok, false);

  const created = await api.createCeremonyInvite({
    ...base,
    editKey: "edit-key-1234567890",
    codeId: "guest-code-1",
    kind: "guest",
    ceremonyIds: ["haldi", "not-a-ceremony"],
  });
  assert.equal(created.ok, true);
  assert.equal(created.ceremonies.length, 1);
  assert.equal(created.ceremonies[0].name, "Haldi");
  assert.equal(created.ceremonies[0].secretCode, undefined);
  assert.doesNotMatch(created.token, /GUEST|FAMILY|meera-arun|guest-code/);
  const seconds = await pg.query("select extract(epoch from (expires_at - created_at)) as seconds from ceremony_invites where token = $1", [created.token]);
  assert.equal(Number(seconds.rows[0].seconds), 86400);

  const view = await api.readCeremonyInvite(created.token);
  assert.equal(view.ok, true);
  assert.equal(view.kind, "guest");
  assert.equal(view.bride, "Meera");
  const packed = JSON.stringify(view);
  assert.doesNotMatch(packed, new RegExp(guestCode));
  assert.doesNotMatch(packed, /guest-code-1/);
  assert.doesNotMatch(packed, /edit-key/);

  const entered = await api.enterCeremonyInvite({ token: created.token, name: "Riya", side: "Bride", memberKey: "", accountId: "" });
  assert.equal(entered.ok, true);
  assert.equal(entered.role, "guest");
  assert.doesNotMatch(JSON.stringify(entered), new RegExp(guestCode));
  const member = await pg.query("select role from circle_members where member_key = $1", [entered.memberKey]);
  assert.equal(member.rows[0].role, "guest");

  const again = await api.enterCeremonyInvite({ token: created.token, name: "Dev", side: "Groom", memberKey: "member-new-guest", accountId: "" });
  assert.equal(again.ok, true);
  assert.equal(again.role, "guest");

  const hostKept = await api.enterCeremonyInvite({ token: created.token, name: "Host", side: "Bride", memberKey: "member-family", accountId: "" });
  assert.equal(hostKept.role, "family");
  const stillFamily = await pg.query("select role from circle_members where member_key = 'member-family'");
  assert.equal(stillFamily.rows[0].role, "family");

  const familyInvite = await api.createCeremonyInvite({ ...base, memberKey: "member-family", codeId: "family-code-1", kind: "family", ceremonyIds: ["wedding"] });
  assert.equal(familyInvite.ok, true);
  assert.equal(familyInvite.ceremonies[0].id, "wedding");
  assert.equal(familyInvite.ceremonies[0].venue, "Glass Hall");

  const brideInvite = await api.createCeremonyInvite({ ...base, accountId: "email:bride@example.com", codeId: "bride", kind: "bride", ceremonyIds: ["wedding"] });
  assert.equal(brideInvite.ok, true);
  const brideEnter = await api.enterCeremonyInvite({ token: brideInvite.token, name: "Meera", side: "", memberKey: "", accountId: "email:bride@example.com" });
  assert.equal(brideEnter.ok, true);
  assert.equal(brideEnter.role, "bride");
  assert.doesNotMatch(JSON.stringify(brideEnter), new RegExp(brideCode));
  const claimed = await pg.query("select bride_status, bride_code from couple_access where slug = 'meera-arun'");
  assert.equal(claimed.rows[0].bride_status, "claimed");
  assert.equal(claimed.rows[0].bride_code, brideCode);

  const after = await pg.query("select payload from circles where slug = 'meera-arun'");
  const stored = after.rows[0].payload;
  assert.equal(stored.functions[0].name, "Haldi");
  assert.equal(stored.functions[1].name, "Wedding");
  assert.equal(stored.functions[0].secretCode, guestCode);
  assert.equal(stored.postingCodes[1].code, guestCode);

  await pg.query("update ceremony_invites set expires_at = now() - interval '1 second' where token = $1", [created.token]);
  const expired = await api.readCeremonyInvite(created.token);
  assert.equal(expired.status, "expired");
  const expiredEnter = await api.enterCeremonyInvite({ token: created.token, name: "Late", side: "Bride", memberKey: "", accountId: "" });
  assert.equal(expiredEnter.ok, false);
  assert.match(expiredEnter.error, /expired/);
  const still = await pg.query("select slug from circles where slug = 'meera-arun'");
  assert.equal(still.rows.length, 1);

  const revoked = await api.revokeCeremonyInvite(familyInvite.token);
  assert.equal(revoked.ok, true);
  const afterRevoke = await api.readCeremonyInvite(familyInvite.token);
  assert.equal(afterRevoke.status, "revoked");
  const revokedEnter = await api.enterCeremonyInvite({ token: familyInvite.token, name: "Late", side: "Bride", memberKey: "", accountId: "" });
  assert.match(revokedEnter.error, /no longer active/);

  payload.disabled = true;
  await pg.query("update circles set payload = $2::jsonb where slug = $1", ["meera-arun", JSON.stringify({ ...payload, disabled: true })]);
  const pausedEnter = await api.enterCeremonyInvite({ token: brideInvite.token, name: "Other", side: "", memberKey: "", accountId: "email:other@example.com" });
  assert.match(pausedEnter.error, /paused/);
});
