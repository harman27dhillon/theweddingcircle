import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useWedding } from "@/components/wedding/context";
import { Button, Empty, fieldClass, Mark, PickList, Screen } from "@/components/wedding/ui";
import { VENDORS } from "@/lib/wedding/catalog";
import { cleanPhone, coupleTitle, isSampleCircle, longDate, todayISO, validEmail } from "@/lib/wedding/format";
import { CIRCLE_FEE_LABEL } from "@/lib/wedding/payments";
import { developerUnlock } from "@/lib/developer/console.functions";
import { rememberDeveloperToken } from "@/lib/developer/runtime";
import { isDeveloperEmail, useWeddingStore, vendorById } from "@/lib/wedding/store";
import { DeveloperAppearance } from "@/components/wedding/developer-appearance";
import { LibraryPhoto } from "@/components/wedding/library-photo";
import { PushOptIn } from "@/components/wedding/cloud-runtime";
import { CHECKLIST } from "@/lib/wedding/traditions";
import { COUNTRIES } from "@/lib/wedding/countries";

function continueAfterAuth(navigate: ReturnType<typeof useNavigate>) {
  const next = sessionStorage.getItem("wc-after-auth");
  sessionStorage.removeItem("wc-after-auth");
  sessionStorage.removeItem("wc-join-wedding");
  if (next === "/create") {
    void navigate({ to: "/create" });
    return;
  }
  const invite = next?.match(/^\/i\/([A-Za-z0-9_-]{43,80})$/);
  if (invite?.[1]) {
    void navigate({ to: "/i/$token", params: { token: invite[1] } });
    return;
  }
  const slug = weddingSlugFromReturn(next);
  if (slug) {
    const state = useWeddingStore.getState();
    const wedding = state.weddings.find((item) => item.slug === slug);
    if (wedding) {
      const owner = Boolean(state.account?.email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === state.account.email.toLowerCase());
      state.focusWedding(wedding.id, owner ? "host" : "guest");
      if (isSampleCircle(wedding)) state.setViewerSide("Bride");
    }
    void navigate({ to: "/w/$slug", params: { slug } });
    return;
  }
  void navigate({ to: "/" });
}

function weddingSlugFromReturn(next: string | null) {
  const match = next?.match(/^\/w\/([a-z0-9-]+)$/);
  return match?.[1] ?? "";
}

export function AccountScreen() {
  const navigate = useNavigate();
  const account = useWeddingStore((s) => s.account);
  const signOutAccount = useWeddingStore((s) => s.signOutAccount);
  const weddings = useWeddingStore((s) => s.weddings);
  const [mode, setMode] = useState<"create" | "in">("create");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [signPassword, setSignPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [phase, setPhase] = useState<"form" | "verify">("form");
  const [authEmail, setAuthEmail] = useState("");
  const [joinTitle, setJoinTitle] = useState("");

  async function completeVerified(address: string, secret = "") {
    const { adoptFirebaseSession } = await import("@/lib/wedding/account-cloud");
    const adopted = await adoptFirebaseSession({ name: name.trim(), country, phone: cleanPhone(phone) });
    if (adopted === "unverified") {
      setPhase("verify");
      setAuthEmail(address);
      setNotice("Verify your email before opening a wedding.");
      return;
    }
    if (adopted !== "ok") {
      setNotice(adopted === "link-failed" ? "That email could not be linked. The existing account was not changed." : "Firebase did not open this account.");
      return;
    }
    if (secret && isDeveloperEmail(address)) {
      try {
        const unlocked = await developerUnlock({ data: { email: address.trim().toLowerCase(), password: secret } });
        if (unlocked.ok) rememberDeveloperToken(unlocked.token);
      } catch {
        /* The wedding account is signed in. The command center can ask again. */
      }
    }
    setPhase("form");
    setNotice("");
    void import("@/lib/wedding/publish").then(({ restoreMemberships }) => restoreMemberships()).catch(() => undefined);
    continueAfterAuth(navigate);
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("wc-auth-mode");
    if (saved === "in" || saved === "create") setMode(saved);
    const joinId = sessionStorage.getItem("wc-join-wedding");
    if (joinId) {
      const wedding = useWeddingStore.getState().weddings.find((item) => item.id === joinId);
      if (wedding) setJoinTitle(coupleTitle(wedding));
    }
    let cancel = false;
    void (async () => {
      const { currentIdToken } = await import("@/lib/wedding/firebase-auth.browser");
      const session = await currentIdToken(false);
      if (cancel) return;
      if (session.status === "unverified") {
        setPhase("verify");
        setAuthEmail(session.email);
        return;
      }
      if (session.status === "error") setNotice(session.message);
    })();
    return () => {
      cancel = true;
    };
  }, []);

  const mine = account ? weddings.filter((w) => w.ownerEmail && w.ownerEmail === account.email) : [];
  const joined = account
    ? weddings.filter(
        (w) =>
          w.ownerEmail !== account.email &&
          w.guests.some((g) => g.name.toLowerCase() === account.name.toLowerCase() && g.joined && !g.blocked),
      )
    : [];

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast("Add the name guests will see.");
      return;
    }
    if (!validEmail(email)) {
      toast("Use a full email address.");
      return;
    }
    if (!country) {
      toast("Choose your country.");
      return;
    }
    if (password.length < 6) {
      toast("Password needs at least 6 characters.");
      return;
    }
    if (password !== again) {
      toast("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setNotice("");
    const { registerWithEmail } = await import("@/lib/wedding/firebase-auth.browser");
    const result = await registerWithEmail(email, password);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      toast(result.message);
      return;
    }
    setAuthEmail(result.email);
    setPhase("verify");
    setNotice("Check your email and verify it before opening a wedding.");
    toast("Verification email sent.");
  }

  async function signIn(e: FormEvent) {
    e.preventDefault();
    if (!validEmail(identifier)) {
      toast("Enter the email on the account.");
      return;
    }
    if (signPassword.length < 6) {
      toast("Enter the password.");
      return;
    }
    setBusy(true);
    setNotice("");
    const { signInWithEmail } = await import("@/lib/wedding/firebase-auth.browser");
    const result = await signInWithEmail(identifier, signPassword);
    if (!result.ok) {
      setBusy(false);
      setNotice(result.message);
      toast(result.message);
      return;
    }
    if (!result.emailVerified) {
      setBusy(false);
      setAuthEmail(result.email);
      setPhase("verify");
      setNotice("Verify your email before opening a wedding.");
      return;
    }
    await completeVerified(result.email, signPassword);
    setBusy(false);
  }

  async function sendReset() {
    if (!validEmail(identifier)) {
      toast("Enter the email on the account.");
      return;
    }
    setBusy(true);
    const { resetPassword } = await import("@/lib/wedding/firebase-auth.browser");
    const result = await resetPassword(identifier);
    setBusy(false);
    setNotice(result.ok ? "Password reset email sent." : result.message);
    toast(result.ok ? "Password reset email sent." : result.message);
  }

  async function resendVerification() {
    setBusy(true);
    const { sendVerificationEmail } = await import("@/lib/wedding/firebase-auth.browser");
    const result = await sendVerificationEmail();
    setBusy(false);
    setNotice(result.ok ? "Verification email sent." : result.message);
    toast(result.ok ? "Verification email sent." : result.message);
  }

  async function confirmVerified() {
    setBusy(true);
    setNotice("");
    const { currentIdToken } = await import("@/lib/wedding/firebase-auth.browser");
    const session = await currentIdToken(true);
    if (session.status === "unverified") {
      setBusy(false);
      setNotice("That email is still not verified.");
      toast("That email is still not verified.");
      return;
    }
    if (session.status !== "token") {
      setBusy(false);
      const message = session.status === "error" ? session.message : "Sign in again, then verify your email.";
      setNotice(message);
      toast(message);
      return;
    }
    await completeVerified(session.email, signPassword || password);
    setBusy(false);
  }

  async function leaveAccount() {
    const { signOutFirebase } = await import("@/lib/wedding/firebase-auth.browser");
    await signOutFirebase();
    signOutAccount();
    setPhase("form");
    setNotice("");
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-8 lg:max-w-3xl lg:px-8">
      <Link to="/" className="mb-6 flex items-center gap-3">
        <Mark className="size-8" />
        <span className="font-serif">Wedding Circle</span>
      </Link>
      <h1 className="font-serif text-4xl">{account ? "Your profile" : "Sign in"}</h1>
      <p className="mt-2 text-muted">
        {account
          ? "Weddings for this email load after Firebase verifies it. Roles stay on the wedding."
          : joinTitle
            ? `Sign in or create an account to continue to ${joinTitle}.`
            : "Create an account with your email. A verification link is required before a wedding opens."}
      </p>
      {notice ? <p className="mt-3 text-sm text-muted">{notice}</p> : null}

      {account ? (
        <div className="mt-6">
          <div className="rounded-card border border-line bg-card p-4">
            <p className="font-serif text-2xl">{account.name}</p>
            {account.email ? <p className="mt-2 text-sm">Email · {account.email}</p> : null}
            {account.phone ? <p className="text-sm">Phone · {account.phone}</p> : null}
            {account.country ? <p className="text-sm">Country · {account.country}</p> : null}
            <p className="mt-2 text-sm text-muted">{account.developer || isDeveloperEmail(account.email) ? "Developer access on this device." : "Signed in with Firebase."}</p>
          </div>
          {account.developer || isDeveloperEmail(account.email) ? <DeveloperDesk /> : null}
          <h2 className="mt-8 font-serif text-2xl">My weddings</h2>
          {mine.length === 0 ? <p className="mt-2 text-muted">You have not opened a circle with this email yet.</p> : null}
          <WeddingList items={mine} />
          <h2 className="mt-6 font-serif text-2xl">Joined weddings</h2>
          {joined.length === 0 ? <p className="mt-2 text-muted">Weddings you join under this name appear here.</p> : null}
          <WeddingList items={joined} />
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link to="/inbox" className="text-maroon">Notifications</Link>
            <Link to="/create" className="text-maroon">Create Wedding Circle</Link>
            <button type="button" className="text-muted" onClick={() => void leaveAccount()}>
              Log out
            </button>
          </div>
        </div>
      ) : phase === "verify" ? (
        <div className="mt-6 grid gap-3">
          <p className="rounded-2xl border border-line bg-paper px-4 py-3 text-sm">
            Verify {authEmail || "your email"} before opening a wedding. The link is from Firebase. A code on this page is not accepted.
          </p>
          <Button type="button" disabled={busy} onClick={() => void resendVerification()}>Resend verification email</Button>
          <Button type="button" variant="line" disabled={busy} onClick={() => void confirmVerified()}>I've verified</Button>
          <button type="button" className="text-sm text-muted" onClick={() => void leaveAccount()}>Use a different email</button>
        </div>
      ) : (
        <div className="mt-6">
          <div className="mb-4 mt-6 flex gap-2">
            <Button variant={mode === "create" ? "primary" : "line"} onClick={() => setMode("create")}>
              Create account
            </Button>
            <Button variant={mode === "in" ? "primary" : "line"} onClick={() => setMode("in")}>
              Sign in
            </Button>
          </div>

          {mode === "in" ? (
            <form className="grid gap-3" onSubmit={(e) => void signIn(e)}>
              <input
                className={fieldClass}
                type="email"
                placeholder="Email"
                autoComplete="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
              <input
                className={fieldClass}
                type="password"
                placeholder="Password"
                autoComplete="current-password"
                value={signPassword}
                onChange={(e) => setSignPassword(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
              <button type="button" className="text-sm text-maroon" disabled={busy} onClick={() => void sendReset()}>
                Email me a reset link
              </button>
            </form>
          ) : (
            <form className="grid gap-3" onSubmit={(e) => void createAccount(e)}>
              <input className={fieldClass} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
              <input className={fieldClass} type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className={fieldClass} placeholder="Phone (saved on the profile, not used to sign in)" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <PickList
                label="Country"
                value={country}
                onChange={setCountry}
                options={[{ value: "", label: "Choose your country" }, ...COUNTRIES.map((item) => ({ value: item, label: item }))]}
              />
              <input className={fieldClass} type="password" placeholder="Password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <input className={fieldClass} type="password" placeholder="Repeat password" value={again} onChange={(e) => setAgain(e.target.value)} />
              <Button type="submit" disabled={busy}>
                {busy ? "Creating account…" : "Sign up"}
              </Button>
            </form>
          )}
        </div>
      )}
    </main>
  );
}

function DeveloperDesk() {
  const feedback = useWeddingStore((s) => s.feedback);
  const weddings = useWeddingStore((s) => s.weddings);
  const focusWedding = useWeddingStore((s) => s.focusWedding);
  return (
    <div className="mt-8">
      <h2 className="font-serif text-2xl">Developer desk</h2>
      <p className="mt-2 text-muted">Every circle on this device, and every note sent from the home page.</p>
      <Link to="/developer" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo">
        Open command center
      </Link>
      <h3 className="mt-6 font-medium">Mobile Landing Page Background</h3>
      <p className="mt-1 text-sm text-muted">Phones only. Saving here does not change a wedding cover, theme, or the desktop landing page.</p>
      <DeveloperAppearance />
      <ul className="mt-4 flex flex-col gap-2">
        {weddings.map((w) => (
          <li key={w.id}>
            <Link
              to="/w/$slug"
              params={{ slug: w.slug }}
              className="block rounded-2xl border border-line bg-card px-4 py-3"
              onClick={() => focusWedding(w.id, "host")}
            >
              <span className="font-serif text-xl">{coupleTitle(w)}</span>
              <span className="mt-1 block text-sm text-muted">{w.city}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="mt-8 font-serif text-2xl">Feedback</h2>
      {feedback.length === 0 ? <p className="mt-2 text-muted">Nothing sent yet.</p> : null}
      <ul className="mt-3 flex flex-col gap-3">
        {feedback.map((item) => (
          <li key={item.id} className="rounded-2xl border border-line bg-card p-4">
            <p className="text-sm text-muted">{item.fromName} · {item.atLabel}</p>
            <p className="mt-1">{item.text}</p>
          </li>
        ))}
      </ul>
      <Link to="/desk" className="mt-4 inline-block text-sm text-maroon">
        Platform desk
      </Link>
    </div>
  );
}

function WeddingList({ items }: { items: { id: string; slug: string; bride: string; groom: string; date: string; city: string }[] }) {
  const focusWedding = useWeddingStore((s) => s.focusWedding);
  if (items.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {items.map((w) => (
        <li key={w.id}>
          <Link
            to="/w/$slug"
            params={{ slug: w.slug }}
            className="block rounded-2xl border border-line bg-card px-4 py-3"
            onClick={() => focusWedding(w.id)}
          >
            <span className="font-serif text-xl">{coupleTitle(w)}</span>
            <span className="mt-1 block text-sm text-muted">{longDate(w.date)} · {w.city}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function InboxScreen() {
  const notices = useWeddingStore((s) => s.notices);
  const weddings = useWeddingStore((s) => s.weddings);
  const markNoticesRead = useWeddingStore((s) => s.markNoticesRead);
  return (
    <main className="mx-auto min-h-dvh w-full max-w-xl px-4 py-8 lg:max-w-3xl lg:px-8">
      <Link to="/" className="text-sm text-maroon">Home</Link>
      <div className="mt-4 flex items-end justify-between gap-3">
        <h1 className="font-serif text-4xl">Notifications</h1>
        <Button variant="line" onClick={() => markNoticesRead()}>Mark read</Button>
      </div>
      <PushOptIn />
      <ul className="mt-6 flex flex-col gap-3">
        {notices.length === 0 ? <Empty title="Nothing new" text="RSVPs, posts, and live ceremonies land here." /> : null}
        {notices.map((n) => {
          const wedding = weddings.find((w) => w.id === n.weddingId);
          return (
            <li key={n.id} className="rounded-card border border-line bg-card p-4">
              <p className="text-sm text-muted">
                {n.kind} · {n.atLabel}
                {n.read ? "" : " · new"}
              </p>
              <p className="mt-1 font-medium">{n.title}</p>
              <p className="mt-1">{n.body}</p>
              {wedding ? (
                <Link
                  to={n.kind === "announcement" ? "/w/$slug/feed" : "/w/$slug"}
                  params={{ slug: wedding.slug }}
                  className="mt-2 inline-block text-sm text-maroon"
                >
                  {n.kind === "announcement" ? "Open the chat" : coupleTitle(wedding)}
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export function DeskScreen() {
  const weddings = useWeddingStore((s) => s.weddings);
  const reports = useWeddingStore((s) => s.reports);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "done">("all");
  const today = todayISO();
  const rows = useMemo(() => {
    return weddings.filter((w) => {
      const done = w.date < today;
      if (filter === "active" && done) return false;
      if (filter === "done" && !done) return false;
      const hay = `${w.bride} ${w.groom} ${w.city} ${w.slug}`.toLowerCase();
      return hay.includes(query.trim().toLowerCase());
    });
  }, [weddings, query, filter, today]);
  const paid = weddings.filter((w) => w.payment?.status === "paid");
  const people = new Set(weddings.flatMap((w) => w.guests.map((g) => g.name.toLowerCase())));
  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl px-4 py-8 lg:max-w-6xl lg:px-8">
      <Link to="/" className="text-sm text-maroon">Home</Link>
      <h1 className="mt-4 font-serif text-4xl">Platform desk</h1>
      <p className="mt-2 text-muted">The owner view. Circles stay private. This desk only sees counts, payments, and reports.</p>
      <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Weddings" value={String(weddings.length)} />
        <Stat label="Active" value={String(weddings.filter((w) => w.date >= today).length)} />
        <Stat label="Completed" value={String(weddings.filter((w) => w.date < today).length)} />
        <Stat label="Revenue" value={`₹${paid.length * 499}`} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3">
        <Stat label="People" value={String(people.size)} />
        <Stat label="Payments" value={String(paid.length)} />
        <Stat label="Reports" value={String(reports.length)} />
      </div>
      <p className="mt-4 text-sm text-muted">{VENDORS.length} vendor profiles · fee {CIRCLE_FEE_LABEL} each paid circle</p>
      <div className="mt-6 grid gap-3">
        <input className={fieldClass} placeholder="Search a wedding" value={query} onChange={(e) => setQuery(e.target.value)} />
        <PickList
          label="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "active", label: "Active" },
            { value: "done", label: "Completed" },
          ]}
        />
      </div>
      <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-card">
        {rows.map((w) => (
          <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="font-medium">{coupleTitle(w)}</p>
              <p className="text-sm text-muted">{w.city} · {w.payment?.status ?? "unpaid"} · {w.payment?.reference || "no reference"}</p>
            </div>
            <Link to="/w/$slug" params={{ slug: w.slug }} className="text-sm text-maroon">Open</Link>
          </li>
        ))}
      </ul>
      <h2 className="mt-8 font-serif text-2xl">Reported content</h2>
      {reports.length === 0 ? <p className="mt-2 text-muted">No reports.</p> : (
        <ul className="mt-3 flex flex-col gap-2">
          {reports.map((r) => (
            <li key={r.id} className="rounded-2xl border border-line bg-card px-4 py-3 text-sm">
              {r.atLabel} · {r.author} · {r.reason}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card px-3 py-4">
      <p className="font-serif text-2xl tabular-nums">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export function ChecklistScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const toggleTask = useWeddingStore((s) => s.toggleTask);
  const addTask = useWeddingStore((s) => s.addTask);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState(CHECKLIST[0]?.category ?? "Venue");
  const [when, setWhen] = useState(wedding.date);
  const [owner, setOwner] = useState(viewer.name);
  const groups = new Map<string, typeof wedding.tasks>();
  for (const task of wedding.tasks) {
    const key = task.category || "Ceremony arrangements";
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return (
    <Screen title="Checklist" lede="Suggested from the kind of wedding you are having. Nothing here is compulsory.">
      {[...groups.entries()].map(([name, tasks]) => (
        <section key={name} className="mb-6">
          <h2 className="font-serif text-2xl">{name}</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {tasks.map((t) => (
              <li key={t.id}>
                <button type="button" className="flex w-full items-start gap-3 rounded-2xl border border-line bg-card px-4 py-3 text-left" onClick={() => toggleTask(wedding.id, t.id)}>
                  <span className={t.done ? "mt-1 size-4 rounded-full bg-maroon" : "mt-1 size-4 rounded-full border border-line"} />
                  <span>
                    <span className={t.done ? "text-muted line-through" : ""}>{t.title}</span>
                    <span className="mt-1 block text-sm text-muted">{t.owner} · {t.when}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <form
        className="grid gap-3 rounded-card border border-line bg-paper p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          addTask(wedding.id, title, owner || viewer.name, category, when);
          setTitle("");
        }}
      >
        <h2 className="font-serif text-2xl">Add a task</h2>
        <input className={fieldClass} placeholder="What needs doing" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 md:grid-cols-3">
          <select className={fieldClass} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CHECKLIST.map((item) => (
              <option key={item.category}>{item.category}</option>
            ))}
          </select>
          <input className={fieldClass} placeholder="Who" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <input className={fieldClass} type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <Button type="submit">Add</Button>
      </form>
    </Screen>
  );
}

export function VendorScreen({ vendorId }: { vendorId: string }) {
  const wedding = useWedding();
  const vendor = vendorById(vendorId);
  const toggleShortlist = useWeddingStore((s) => s.toggleShortlist);
  if (!vendor) {
    return (
      <Screen title="Vendor">
        <Empty title="That profile is not listed" text="Choose someone from services." />
      </Screen>
    );
  }
  const saved = wedding.shortlist.includes(vendor.id);
  return (
    <Screen title={vendor.name} lede={vendor.blurb}>
      {vendor.photo ? <LibraryPhoto src={vendor.photo} alt="" className="mb-4 aspect-[16/8] w-full rounded-card object-cover" /> : null}
      <p className="text-sm text-muted">{vendor.category} · {vendor.city}{vendor.featured ? " · Featured" : ""}</p>
      <p className="mt-3">{vendor.services || "Wedding services"}</p>
      <p className="mt-2">{vendor.price}</p>
      {vendor.contact ? <p className="mt-2 text-muted">{vendor.contact}</p> : null}
      <Button className="mt-4" variant={saved ? "primary" : "line"} onClick={() => toggleShortlist(wedding.id, vendor.id)}>
        {saved ? "Shortlisted" : "Shortlist"}
      </Button>
      <h2 className="mt-8 font-serif text-2xl">Reviews</h2>
      {(vendor.reviews ?? []).length === 0 ? <p className="mt-2 text-muted">No reviews yet.</p> : (
        <ul className="mt-3 flex flex-col gap-3">
          {vendor.reviews?.map((r) => (
            <li key={r.author} className="rounded-2xl border border-line bg-card p-4">
              <p className="text-sm text-muted">{r.author} · {r.stars} / 5</p>
              <p className="mt-1">{r.text}</p>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
