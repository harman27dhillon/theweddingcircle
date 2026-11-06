import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { explainIdentityToolkitKey, firebaseWebKeyChoice } from "../developer/cloud.ts";
import { requireVerifiedEmail } from "./firebase-identity.ts";

test("browser and Identity Toolkit share FIREBASE_API_KEY and do not substitute the Vite key", () => {
  const same = firebaseWebKeyChoice("AIzaSameKey000000000000000", "AIzaSameKey000000000000000");
  assert.equal(same.note, "");
  assert.equal(same.key, "AIzaSameKey000000000000000");
  const differ = firebaseWebKeyChoice("AIzaServerKey00000000000000", "AIzaViteKey0000000000000000");
  assert.equal(differ.key, "AIzaServerKey00000000000000");
  assert.match(differ.note, /was not applied/);
  const onlyVite = firebaseWebKeyChoice("", "AIzaViteKey0000000000000000");
  assert.equal(onlyVite.key, "");
  assert.match(onlyVite.note, /not used as a substitute/);
});

test("Identity Toolkit responses name the key failure", () => {
  assert.equal(explainIdentityToolkitKey(400, JSON.stringify({ error: { message: "API_KEY_INVALID" } })).cause, "invalid-key");
  assert.equal(explainIdentityToolkitKey(403, "API_KEY_HTTP_REFERRER_BLOCKED").cause, "referrer-restricted");
  assert.equal(explainIdentityToolkitKey(403, "API_KEY_IP_ADDRESS_BLOCKED").cause, "ip-restricted");
  assert.equal(explainIdentityToolkitKey(403, "Identity Toolkit API has not been used").cause, "identity-toolkit-disabled");
  const accepted = explainIdentityToolkitKey(400, JSON.stringify({ error: { message: "INVALID_LOGIN_CREDENTIALS" } }));
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.cause, "key-accepted");
  assert.equal(explainIdentityToolkitKey(400, "PASSWORD_LOGIN_DISABLED").cause, "password-provider-off");
});

test("unverified Firebase emails are refused before a wedding role is read", () => {
  const refused = requireVerifiedEmail({ uid: "user-1", email: "host@example.com", emailVerified: false });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /Verify your email/);
  assert.equal(requireVerifiedEmail({ uid: "user-1", email: "host@example.com", emailVerified: true }).ok, true);
  const server = readFileSync(new URL("./firebase-identity.server.ts", import.meta.url), "utf8");
  const gate = server.indexOf("requireVerifiedEmail");
  const lookup = server.indexOf("from circle_members");
  assert.ok(gate > 0 && lookup > gate);
  assert.match(server, /never creates a membership/);
  const circle = readFileSync(new URL("./circle.functions.ts", import.meta.url), "utf8");
  const handler = circle.slice(circle.indexOf("export const readCircleAsMember"));
  assert.match(handler, /verification_required/);
  assert.equal(handler.includes("if (!identity.ok) return null"), false);
});

test("sign-in buttons call Firebase and the old hash path cannot succeed", () => {
  const screen = readFileSync(new URL("../../components/wedding/extra-screens.tsx", import.meta.url), "utf8");
  const account = screen.slice(screen.indexOf("export function AccountScreen"), screen.indexOf("function DeveloperDesk"));
  for (const banned of ["hashPassword", "signInWithPassword", "signInFromCloud", "beginSignup", "confirmSignup", "signInDeveloper"]) {
    assert.equal(account.includes(banned), false, banned);
  }
  assert.match(account, /registerWithEmail/);
  assert.match(account, /signInWithEmail/);
  assert.match(account, /sendVerificationEmail/);
  assert.match(account, /resetPassword/);
  assert.match(account, /signOutFirebase/);
  assert.match(account, /adoptFirebaseSession\(\{ idToken,/);
  const client = readFileSync(new URL("./firebase-auth.browser.ts", import.meta.url), "utf8");
  assert.match(client, /createUserWithEmailAndPassword/);
  assert.match(client, /signInWithEmailAndPassword/);
  assert.match(client, /browserLocalPersistence/);
  assert.match(client, /getIdToken\(force\)/);
  assert.match(client, /getIdTokenResult\(true\)/);
  assert.match(client, /claims\.email_verified !== true/);
  assert.match(client, /wc-auth/);
  assert.equal(client.includes("error.message"), false);
  const web = readFileSync(new URL("./firebase-web.server.ts", import.meta.url), "utf8");
  assert.match(web, /resolvedInfraEnv/);
  assert.match(web, /firebaseWebKeyChoice/);
  const pub = web.slice(web.indexOf("export async function publicFirebaseAuthConfig"));
  assert.equal(pub.includes("serviceAccount"), false);
  const cloud = readFileSync(new URL("../developer/cloud.server.ts", import.meta.url), "utf8");
  const resolver = cloud.slice(cloud.indexOf("async function resolveFirebase"), cloud.indexOf("async function resolveSupabase"));
  assert.match(resolver, /readFirebaseWebConfig/);
  assert.equal(resolver.includes("readSaved"), false);
  assert.equal(resolver.includes("developer_cloud_public"), false);
  const accounts = readFileSync(new URL("./account-cloud.server.ts", import.meta.url), "utf8");
  assert.match(accounts, /The password was not changed/);
  const open = accounts.slice(accounts.indexOf("export async function openCircleAccount"), accounts.indexOf("export async function linkFirebaseAccount"));
  assert.equal(open.includes("password_hash"), false);
  const linker = accounts.slice(accounts.indexOf("export async function linkFirebaseAccount"));
  assert.equal(linker.includes("password_hash ="), false);
});

test("verification is requested and submitted by separate user actions", () => {
  const screen = readFileSync(new URL("../../components/wedding/extra-screens.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("./firebase-auth.browser.ts", import.meta.url), "utf8");
  const signup = client.slice(client.indexOf("export async function registerWithEmail"), client.indexOf("export async function signInWithEmail"));
  assert.doesNotMatch(signup, /[Ss]end.*Verification/);
  assert.doesNotMatch(client, /sendEmailVerification|verifyEmailLink/);
  assert.match(screen, /onClick=\{\(\) => void sendCode\(\)\}/);
  assert.match(screen, /autoComplete="one-time-code"/);
  assert.match(screen, /onSubmit=\{\(event\) => void verifyFromCode\(event\)\}/);
  assert.match(screen, /disabled=\{busy \|\| verificationCode.length !== 6\}/);
});
