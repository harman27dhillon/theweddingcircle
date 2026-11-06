import { firebaseAuthConfig, redeemVerificationCode, requestFirebaseVerificationEmail } from "@/lib/wedding/firebase-auth.functions";

export type FirebaseSession =
  | { status: "none" }
  | { status: "unconfigured" }
  | { status: "unverified"; email: string }
  | { status: "token"; token: string; email: string; uid: string; emailVerified: true }
  | { status: "error"; message: string };

let authPromise: Promise<import("firebase/auth").Auth> | null = null;

function firebaseCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  return String((error as { code?: unknown }).code || "");
}

/** Maps a Firebase Auth code. The raw message is not returned because it can contain the API key. */
export function mapFirebaseAuthError(error: unknown) {
  switch (firebaseCode(error)) {
    case "auth/email-already-in-use":
      return "That email already has an account. Sign in instead.";
    case "auth/invalid-email":
      return "Use a full email address.";
    case "auth/weak-password":
      return "Password needs at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-login-credentials":
      return "That email and password do not match.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait and try again.";
    case "auth/network-request-failed":
      return "The network blocked sign-in. Try again.";
    case "auth/user-disabled":
      return "This account is disabled.";
    case "auth/user-token-expired":
    case "auth/invalid-user-token":
      return "That sign-in session expired. Sign in again.";
    default:
      return firebaseCode(error).startsWith("auth/") ? "Firebase did not accept that sign-in." : "Firebase sign-in is not available.";
  }
}

function firebaseAuth() {
  authPromise ??= (async () => {
    const [config, { initializeApp, getApps, deleteApp }, { initializeAuth, browserLocalPersistence }] = await Promise.all([
      firebaseAuthConfig(),
      import("firebase/app"),
      import("firebase/auth"),
    ]);
    if (!config.ok) throw Object.assign(new Error("Firebase sign-in is not configured."), { code: "auth/not-configured" });
    const existing = getApps().find((app) => app.name === "wc-auth");
    if (existing) await deleteApp(existing);
    const app = initializeApp(
      {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
        messagingSenderId: config.messagingSenderId,
      },
      "wc-auth",
    );
    return initializeAuth(app, { persistence: browserLocalPersistence });
  })().catch((error) => {
    authPromise = null;
    throw error;
  });
  return authPromise;
}

export async function registerWithEmail(email: string, password: string) {
  try {
    const auth = await firebaseAuth();
    const { createUserWithEmailAndPassword } = await import("firebase/auth");
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    return { ok: true as const, email: cred.user.email || email };
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const auth = await firebaseAuth();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    const idToken = cred.user.emailVerified ? await cred.user.getIdToken() : "";
    return { ok: true as const, email: cred.user.email || "", idToken };
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function sendVerificationEmail(signal?: AbortSignal) {
  try {
    const auth = await firebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return { ok: false as const, message: "Sign in before sending a verification email." };
    const idToken = await user.getIdToken();
    signal?.throwIfAborted();
    return await requestFirebaseVerificationEmail({ data: { idToken }, signal });
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function verifyEmailCode(code: string) {
  try {
    const auth = await firebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user?.email) return { ok: false as const, message: "Sign in with the account you want to verify." };
    const result = await redeemVerificationCode({ data: { idToken: await user.getIdToken(), code } });
    if (!result.ok) return result;
    if (auth.currentUser?.uid !== user.uid) return { ok: false as const, message: "Your signed-in account changed. Sign in again and retry." };
    const { applyActionCode } = await import("firebase/auth");
    await applyActionCode(auth, result.actionCode);
    const verified = await user.getIdTokenResult(true);
    if (auth.currentUser?.uid !== user.uid || verified.claims.email_verified !== true) {
      return { ok: false as const, message: "Sign in again to refresh your verified account." };
    }
    return { ok: true as const, email: user.email, idToken: verified.token };
  } catch {
    return { ok: false as const, message: "The code could not be applied. Try requesting a new one." };
  }
}

export async function resetPassword(email: string) {
  try {
    const auth = await firebaseAuth();
    const { sendPasswordResetEmail } = await import("firebase/auth");
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function signOutFirebase() {
  try {
    const auth = await firebaseAuth();
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
  } catch {
    /* No Firebase session is open. */
  }
}

/** Reloads the Firebase user and reads a fresh ID token. emailVerified on the client is not authorization. */
export async function currentIdToken(force = false): Promise<FirebaseSession> {
  let auth: import("firebase/auth").Auth;
  try {
    auth = await firebaseAuth();
  } catch (error) {
    if (firebaseCode(error) === "auth/not-configured") return { status: "unconfigured" };
    return { status: "none" };
  }
  try {
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user) return { status: "none" };
    await user.reload();
    const email = user.email || "";
    if (user.emailVerified !== true) return { status: "unverified", email };
    const token = await user.getIdToken(force);
    if (!token) return { status: "error", message: "The sign-in session could not be refreshed." };
    return { status: "token", token, email, uid: user.uid, emailVerified: true };
  } catch (error) {
    const code = firebaseCode(error);
    if (code === "auth/user-token-expired" || code === "auth/invalid-user-token" || code === "auth/user-disabled") {
      await signOutFirebase();
      return { status: "error", message: mapFirebaseAuthError(error) };
    }
    if (code === "auth/network-request-failed") return { status: "error", message: mapFirebaseAuthError(error) };
    return { status: "error", message: mapFirebaseAuthError(error) };
  }
}
