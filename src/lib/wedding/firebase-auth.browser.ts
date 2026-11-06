import { verificationCodeFromLink } from "./firebase-verification";
import { firebaseAuthConfig } from "@/lib/wedding/firebase-auth.functions";

export type FirebaseSession =
  | { status: "none" }
  | { status: "unconfigured" }
  | { status: "unverified"; email: string }
  | { status: "token"; token: string; email: string; uid: string; emailVerified: true }
  | { status: "error"; message: string };

let authPromise: Promise<import("firebase/auth").Auth> | null = null;
let configMark = "";

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

async function firebaseAuth() {
  const config = await firebaseAuthConfig();
  if (!config.ok) throw Object.assign(new Error("Firebase sign-in is not configured."), { code: "auth/not-configured" });
  const mark = `${config.projectId}\0${config.appId}\0${config.apiKey.length}`;
  if (!authPromise || configMark !== mark) {
    configMark = mark;
    authPromise = (async () => {
      const { initializeApp, getApps, deleteApp } = await import("firebase/app");
      const { getAuth, browserLocalPersistence, setPersistence } = await import("firebase/auth");
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
      const auth = getAuth(app);
      await setPersistence(auth, browserLocalPersistence);
      return auth;
    })();
  }
  try {
    return await authPromise;
  } catch (error) {
    authPromise = null;
    throw error;
  }
}

export async function registerWithEmail(email: string, password: string) {
  try {
    const auth = await firebaseAuth();
    const { createUserWithEmailAndPassword, sendEmailVerification } = await import("firebase/auth");
    const cred = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await sendEmailVerification(cred.user);
    return { ok: true as const, email: cred.user.email || email, emailVerified: cred.user.emailVerified === true };
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function signInWithEmail(email: string, password: string) {
  try {
    const auth = await firebaseAuth();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    await cred.user.reload();
    return { ok: true as const, email: cred.user.email || "", uid: cred.user.uid, emailVerified: cred.user.emailVerified === true };
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function sendVerificationEmail() {
  try {
    const auth = await firebaseAuth();
    const user = auth.currentUser;
    if (!user) return { ok: false as const, message: "Sign in before sending a verification email." };
    const { sendEmailVerification } = await import("firebase/auth");
    await sendEmailVerification(user);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: mapFirebaseAuthError(error) };
  }
}

export async function verifyEmailLink(link: string) {
  try {
    const auth = await firebaseAuth();
    await auth.authStateReady();
    const user = auth.currentUser;
    if (!user?.email) return { ok: false as const, message: "Sign in with the account you want to verify." };
    const code = verificationCodeFromLink(link, auth.config.authDomain || "");
    if (!code) return { ok: false as const, message: "Copy the full Verify email link from the newest Firebase email." };
    const { ActionCodeOperation, applyActionCode, checkActionCode } = await import("firebase/auth");
    const info = await checkActionCode(auth, code);
    if (info.operation !== ActionCodeOperation.VERIFY_EMAIL || info.data.email?.toLowerCase() !== user.email.toLowerCase()) {
      return { ok: false as const, message: "That verification link belongs to a different email address." };
    }
    if (auth.currentUser?.uid !== user.uid) return { ok: false as const, message: "Your signed-in account changed. Sign in again and retry." };
    await applyActionCode(auth, code);
    return { ok: true as const };
  } catch (error) {
    const code = firebaseCode(error);
    if (code === "auth/expired-action-code") return { ok: false as const, message: "Firebase says this link expired. Request a new email and copy its link before opening it." };
    if (code === "auth/invalid-action-code") return { ok: false as const, message: "Firebase says this link is invalid or already used. Request a fresh email and copy the new link." };
    return { ok: false as const, message: mapFirebaseAuthError(error) };
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
    const { onAuthStateChanged } = await import("firebase/auth");
    const user = await new Promise<import("firebase/auth").User | null>((resolve) => {
      const stop = onAuthStateChanged(auth, (next) => {
        stop();
        resolve(next);
      });
    });
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
