import { linkFirebaseAccount, publishCircleAccount } from "@/lib/wedding/account-cloud.functions";
import { currentIdToken } from "@/lib/wedding/firebase-auth.browser";
import { useWeddingStore } from "@/lib/wedding/store";

/** Saves the signed-in account on the wedding database and keeps one id across devices. */
export async function syncSignedAccount() {
  const account = useWeddingStore.getState().account;
  if (!account?.id || !account.passwordHash || account.passwordHash.startsWith("google:") || account.passwordHash.startsWith("firebase:")) return;
  const result = await publishCircleAccount({
    data: {
      id: account.id,
      name: account.name,
      email: account.email,
      phone: account.phone,
      passwordHash: account.passwordHash,
      country: account.country || "",
    },
  }).catch(() => null);
  if (!result?.ok || result.account.id === account.id) return;
  const nextId = result.account.id;
  useWeddingStore.setState((state) => ({
    account: state.account && state.account.id === account.id ? { ...state.account, id: nextId } : state.account,
    accounts: state.accounts.map((item) => (item.id === account.id ? { ...item, id: nextId } : item)),
  }));
}

/** Password hashes are not a sign-in path. Firebase Auth is the only login. */
export async function signInFromCloud(_identifier?: string, _passwordHash?: string) {
  return "bad" as const;
}

/** Stores the Firebase uid on the existing Supabase account. Does not open a wedding. */
export type AdoptFirebaseSessionResult =
  | { status: "ok" }
  | { status: "unverified" | "none" | "unconfigured" | "bad" }
  | { status: "link-failed"; reason: string };

/** Links only a freshly verified Firebase session and preserves a useful, safe failure reason. */
export async function adoptFirebaseSession(input: { name: string; country: string; phone: string }): Promise<AdoptFirebaseSessionResult> {
  const session = await currentIdToken(true);
  if (session.status !== "token") return { status: session.status };
  let linked: Awaited<ReturnType<typeof linkFirebaseAccount>>;
  try {
    linked = await linkFirebaseAccount({
      data: { idToken: session.token, name: input.name, country: input.country, phone: input.phone },
    });
  } catch {
    return { status: "link-failed", reason: "The account-link service could not be reached. Your Firebase sign-in is still active; try again." };
  }
  if (!linked?.ok) {
    const reason = "reason" in linked && linked.reason
      ? linked.reason
      : "The account could not be linked. No wedding access was granted.";
    return { status: "link-failed", reason };
  }
  const signed = useWeddingStore.getState().signInLinkedAccount({
    id: linked.account.id,
    name: linked.account.name || input.name,
    email: linked.account.email,
    country: linked.account.country || input.country,
    phone: linked.account.phone || input.phone,
    firebaseUid: linked.uid,
  });
  return signed === "ok" ? { status: "ok" } : { status: "bad" };
}
