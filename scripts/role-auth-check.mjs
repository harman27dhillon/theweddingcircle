import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
const roles = await vite.ssrLoadModule("/src/lib/wedding/roles.server.ts");
const slug = `role-check-${Date.now().toString(36)}`;
const editKey = "0123456789abcdef0123456789abcdef";
const registered = await roles.registerWeddingAuthority({
  slug,
  editKey,
  email: "host@example.com",
  name: "Host",
  memberKey: "",
  familyCodes: ["FAMILY-ONE"],
  guestCodes: ["GUEST-ONE"],
});
if (!registered.ok) throw new Error(registered.error);

const guest = await roles.claimWeddingRole({ slug, memberKey: "", email: "guest@example.com", name: "Guest", code: "GUEST-ONE" });
if (!guest.ok || guest.role !== "guest") throw new Error("guest code should lock guest");

const guestToHost = await roles.claimWeddingRole({ slug, memberKey: guest.memberKey, email: "guest@example.com", name: "Guest", code: "NOPE" });
if (guestToHost.ok) throw new Error("guest became privileged without a code");

const guestToFamily = await roles.claimWeddingRole({ slug, memberKey: guest.memberKey, email: "guest@example.com", name: "Guest", code: "FAMILY-ONE" });
if (!guestToFamily.ok || guestToFamily.role !== "family") throw new Error("family code should raise a guest");

const familyToHost = await roles.claimWeddingRole({ slug, memberKey: guest.memberKey, email: "guest@example.com", name: "Guest", code: "GUEST-ONE" });
if (familyToHost.ok) throw new Error("family changed role without authorization");

const stillFamily = await roles.resolveWeddingRole({ slug, memberKey: guest.memberKey, email: "guest@example.com" });
if (stillFamily.role !== "family") throw new Error("refresh did not keep the authorized role");

const withHostCode = await roles.claimWeddingRole({
  slug,
  memberKey: "",
  email: "other@example.com",
  name: "Other",
  code: registered.hostCode,
});
if (!withHostCode.ok || withHostCode.role !== "host") throw new Error("host code should authorize host");

const refreshedGuest = await roles.resolveWeddingRole({ slug, memberKey: guest.memberKey, email: "" });
if (refreshedGuest.role !== "family") throw new Error("member key did not survive a fresh lookup");

const forged = await roles.resolveWeddingRole({ slug, memberKey: "forged-key", email: "" });
if (forged.role) throw new Error("unknown member was given a role");

const stolen = await roles.registerWeddingAuthority({
  slug,
  editKey: "ffffffffffffffffffffffffffffffff",
  email: "thief@example.com",
  name: "Thief",
  memberKey: "",
  familyCodes: ["FAMILY-ONE"],
  guestCodes: ["GUEST-ONE"],
});
if (stolen.ok) throw new Error("wrong edit key became host");

const asCohost = await roles.claimWeddingRole({
  slug,
  memberKey: "",
  email: "co@example.com",
  name: "Co",
  code: registered.cohostCode,
});
if (!asCohost.ok || asCohost.role !== "cohost") throw new Error("co-host code should authorize co-host");

const cohostToHost = await roles.claimWeddingRole({
  slug,
  memberKey: asCohost.memberKey,
  email: "co@example.com",
  name: "Co",
  code: "FAMILY-ONE",
});
if (cohostToHost.ok) throw new Error("co-host changed role without the host code");

console.log("role authorization checks passed");
await vite.close();
