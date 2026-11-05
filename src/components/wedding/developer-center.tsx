import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  developerControlCheck, developerControlLogin, developerInfrastructureCheck, developerInfrastructureStatus,
  developerControlLogout, developerControlStatus,
} from "@/lib/developer/control/actions.functions";
import { CHECKS, INFRASTRUCTURE_CHECKS, type Check, type Diagnostic, type InfrastructureCheck } from "@/lib/developer/control/model";

const sections = [
  ["overview", "Infrastructure overview"],
  ["infrastructure", "Infrastructure"],
  ["configuration", "Supabase status"],
  ["database", "Database setup & hosting"],
] as const;

type Section = typeof sections[number][0];
type Status = Awaited<ReturnType<typeof developerControlStatus>>;
type Configuration = NonNullable<Status["configuration"]>;
type DatabaseState = "idle" | "checking" | "verified" | "failed";
type InfraStatus = Awaited<ReturnType<typeof developerInfrastructureStatus>>;
type InfraResults = Partial<Record<InfrastructureCheck, Diagnostic>>;
const modes: Record<DatabaseState, string> = {
  idle: "Code-Based Mode — Database Not Connected",
  checking: "Connecting / Verification Required",
  verified: "Database Connected — Persistent Storage Available",
  failed: "Database Disconnected — Code-Based Diagnostics Available",
};

const field = "min-h-11 w-full rounded-xl border border-on-photo/20 bg-ink px-3 py-2 text-on-photo outline-none focus:border-gold";
const button = "min-h-11 rounded-full border border-on-photo/25 px-4 py-2 text-sm disabled:opacity-50";
const primary = "min-h-11 rounded-full bg-maroon px-4 py-2 text-sm text-on-photo disabled:opacity-50";

export function DeveloperCenter() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setStatus(await developerControlStatus());
    } catch {
      setMessage("The Developer Center server did not respond. Try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setMessage("");
    try {
      const result = await developerControlLogin({ data: { email: data.get("email"), password: data.get("password") } });
      form.reset();
      if (result.ok) await load();
      else setMessage(result.message);
    } catch {
      form.reset();
      setMessage("Developer sign-in could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await developerControlLogout();
      setStatus(null);
      await load();
    } catch {
      setMessage("The server could not sign you out. Try again.");
    }
  }

  if (status?.email && status.configuration) {
    return <Dashboard email={status.email} configuration={status.configuration} message={message} onLogout={() => void logout()} />;
  }

  return (
    <main className="min-h-dvh bg-ink px-4 py-10 text-on-photo">
      <section className="mx-auto max-w-md rounded-card border border-on-photo/15 p-6">
        <Link to="/account" className="text-sm text-gold">Profile</Link>
        <h1 className="mt-3 font-serif text-4xl">Developer sign-in</h1>
        <p className="mt-2 text-sm text-on-photo/70">This control panel uses a separate server login and can open without Supabase.</p>
        {loading ? <p className="mt-4 text-sm" role="status">Checking developer access…</p> : status?.configured ? (
          <form className="mt-5 grid gap-4" onSubmit={(event) => void login(event)}>
            <label className="grid gap-1 text-sm">Developer email<input className={field} name="email" type="email" autoComplete="username" maxLength={254} required /></label>
            <label className="grid gap-1 text-sm">Developer password<input className={field} name="password" type="password" autoComplete="current-password" maxLength={512} required /></label>
            <button className={primary} disabled={busy}>{busy ? "Checking…" : "Unlock"}</button>
          </form>
        ) : status ? (
          <p className="mt-5 text-sm text-gold">Set DEVELOPER_ADMIN_EMAIL, DEVELOPER_ADMIN_PASSWORD, and DEVELOPER_SESSION_SECRET in the Worker to enable sign-in.</p>
        ) : <button type="button" className={`mt-4 ${button}`} onClick={() => void load()}>Retry</button>}
        {message ? <p className="mt-4 text-sm text-gold" role="status">{message}</p> : null}
      </section>
    </main>
  );
}

function Dashboard({ email, configuration, message, onLogout }: {
  email: string; configuration: Configuration; message: string; onLogout: () => void;
}) {
  const [section, setSection] = useState<Section>("overview");
  const [state, setState] = useState<DatabaseState>("idle");
  const [results, setResults] = useState<Partial<Record<Check, Diagnostic>>>({});
  const [lastConnected, setLastConnected] = useState("");
  const [running, setRunning] = useState<Check | null>(null);
  const [initialize, setInitialize] = useState(false);
  const [infraStatus, setInfraStatus] = useState<InfraStatus | null>(null);
  const [infraResults, setInfraResults] = useState<InfraResults>({});
  const [infraRunning, setInfraRunning] = useState<InfrastructureCheck | null>(null);

  async function run(check: Check) {
    setRunning(check);
    if (check !== "api" && state !== "verified") setState("checking");
    let result: Diagnostic;
    try {
      result = await developerControlCheck({ data: { check, confirm: check === "initialize" && initialize } });
    } catch {
      result = { ok: false, message: "The server could not finish this check. Reopen Developer sign-in if your session expired." };
    }
    setResults((current) => ({ ...current, [check]: result }));
    if (check !== "api") {
      if (!result.ok) setState(check === "connect" || state === "verified" ? "failed" : "checking");
      else if (check === "verify") setState("verified");
      if (result.ok && result.checkedAt) setLastConnected(result.checkedAt);
    }
    setInitialize(false);
    setRunning(null);
  }

  useEffect(() => {
    if (state !== "verified" || running) return;
    let active = true;
    const timer = setInterval(async () => {
      if (document.hidden) return;
      try {
        const result = await developerControlCheck({ data: { check: "connect" } });
        if (!active) return;
        if (result.ok && result.checkedAt) setLastConnected(result.checkedAt);
        else {
          setState("failed");
          setResults((current) => ({ ...current, connect: result }));
        }
      } catch {
        if (active) setState("failed");
      }
    }, 30_000);
    return () => { active = false; clearInterval(timer); };
  }, [state, running]);

  useEffect(() => { void developerInfrastructureStatus().then(setInfraStatus).catch(() => setInfraStatus(null)); }, []);

  async function runInfrastructure(id: InfrastructureCheck) {
    setInfraRunning(id);
    try {
      const result = await developerInfrastructureCheck({ data: { id } });
      setInfraResults((current) => ({ ...current, [id]: result }));
    } catch {
      setInfraResults((current) => ({ ...current, [id]: { ok: false, message: "Diagnostic request failed. Reopen Developer Center if the session expired." } }));
    } finally { setInfraRunning(null); }
  }

  const apiResult = results.api;
  const latestDb = results.connect;
  return (
    <div className="min-h-dvh bg-ink text-on-photo md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-on-photo/15 p-4 md:border-b-0 md:border-r md:p-6">
        <Link to="/account" className="text-sm text-gold">Profile</Link>
        <p className="mt-3 font-serif text-2xl">Developer Center</p>
        <nav aria-label="Developer Center sections" className="mt-4 flex flex-wrap gap-2 md:grid">
          {sections.map(([id, label]) => <button key={id} type="button" aria-current={section === id ? "page" : undefined} onClick={() => setSection(id)} className={`min-h-11 rounded-xl px-3 text-left text-sm ${section === id ? "bg-maroon" : "text-on-photo/75 hover:bg-on-photo/10"}`}>{label}</button>)}
        </nav>
        <p className="mt-5 break-all text-xs text-on-photo/65">{email}</p>
        <button type="button" className={`mt-3 ${button}`} onClick={onLogout}>Lock Developer Center</button>
      </aside>

      <main className="w-full max-w-5xl px-4 py-6 md:px-8">
        <p className="text-sm text-gold" role="status">{modes[state]}</p>
        {message ? <p className="mt-2 text-sm text-gold" role="status">{message}</p> : null}
        {section === "overview" ? (
          <>
            <h1 className="mt-2 font-serif text-4xl">Infrastructure overview</h1>
            <p className="mt-2 text-sm text-on-photo/70">The dashboard and configuration checks run without a database. API and Postgres tests are separate.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <StatusCard title="Application backend">Developer server responded</StatusCard>
              <StatusCard title="Worker runtime">{configuration.cloudflare ? "Cloudflare Worker detected" : "Cloudflare Worker binding unavailable"}</StatusCard>
              <StatusCard title="Supabase API">{apiResult ? apiResult.message : configuration.configured.SUPABASE_URL && configuration.configured.SUPABASE_PUBLISHABLE_KEY ? "Configured, awaiting a live API test" : "API credentials missing"}</StatusCard>
              <StatusCard title="Postgres">{state === "verified" ? "Schema and read/write checks verified" : latestDb?.message || "Awaiting verification"}</StatusCard>
              <StatusCard title="Last successful Postgres check">{lastConnected ? new Date(lastConnected).toLocaleString() : "None in this session"}</StatusCard>
              <StatusCard title="HYPERDRIVE">{configuration.hyperdrive ? "Runtime binding present. Database diagnostics use Hyperdrive." : "Optional runtime binding not present"}</StatusCard>
            </div>
          </>
        ) : null}

        {section === "infrastructure" ? (
          <>
            <h1 className="mt-2 font-serif text-4xl">Infrastructure</h1>
            <p className="mt-2 max-w-3xl text-sm text-on-photo/70">Read-only diagnostics use the Worker’s existing secrets, variables and bindings. No credential entry fields are used here. A failed check is shown below its service.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {INFRASTRUCTURE_CHECKS.map(([id, title]) => (
                <article key={id} className="rounded-card border border-on-photo/15 p-4">
                  <div className="flex items-start justify-between gap-3"><h2 className="font-serif text-xl">{title}</h2><span className="text-xs text-on-photo/60">{infraStatus ? infraStatus[id] ? "Configured" : "Missing / not detected" : "Status unavailable"}</span></div>
                  <button type="button" className={primary + " mt-3"} disabled={Boolean(infraRunning)} onClick={() => void runInfrastructure(id)}>{infraRunning === id ? "Testing…" : id === "cdn" || id === "stream" ? "Check status" : "Test connection"}</button>
                  <Result value={infraResults[id]} />
                </article>
              ))}
            </div>
            <p className="mt-4 text-xs text-on-photo/60">Some checks are configuration/reachability checks, not full feature acceptance tests. In particular, CDN cache policy and RealtimeKit presenter/viewer permissions require dedicated end-to-end tests.</p>
          </>
        ) : null}
        {section === "configuration" ? <ConfigurationPanel configuration={configuration} apiResult={apiResult} dbResult={latestDb} running={running} run={run} /> : null}
        {section === "database" ? (
          <>
            <h1 className="mt-2 font-serif text-4xl">Database setup & hosting</h1>
            <p className="mt-2 max-w-2xl text-sm text-on-photo/70">Inspect your original Supabase project first. Setup preserves existing compatible tables and stops on conflicts. These actions do not copy wedding records or change app routing.</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {CHECKS.filter(([id]) => id !== "api").map(([id, title]) => (
                <article key={id} className="rounded-card border border-on-photo/15 p-4">
                  <h2 className="font-serif text-xl">{title}</h2>
                  {id === "initialize" ? <label className="mt-2 flex items-start gap-2 text-sm text-on-photo/75"><input className="mt-1" type="checkbox" checked={initialize} onChange={(event) => setInitialize(event.target.checked)} />Create missing tables after inspection</label> : null}
                  <button type="button" className={`mt-3 ${id === "verify" ? primary : button}`} disabled={Boolean(running) || !configuration.databaseConfigured || (id === "initialize" && !initialize)} onClick={() => void run(id)}>
                    {running === id ? "Running…" : title}
                  </button>
                  <Result value={results[id]} />
                </article>
              ))}
            </div>
            {!configuration.databaseConfigured ? <p className="mt-4 text-sm text-gold">Add the Postgres connection in Supabase configuration to enable database actions.</p> : null}
          </>
        ) : null}
      </main>
    </div>
  );
}

function StatusCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-card border border-on-photo/15 p-4"><h2 className="font-serif text-xl">{title}</h2><p className="mt-2 text-sm text-on-photo/75">{children}</p></section>;
}

function Result({ value }: { value?: Diagnostic }) {
  if (!value) return null;
  return (
    <div className={`mt-3 break-words text-sm ${value.ok ? "text-on-photo/85" : "text-gold"}`} role="status">
      <p>{value.message}</p>
      {value.details?.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{value.details.map((line) => <li key={line}>{line}</li>)}</ul> : null}
    </div>
  );
}

function ConfigurationPanel({ configuration, apiResult, dbResult, running, run }: {
  configuration: Configuration; apiResult?: Diagnostic; dbResult?: Diagnostic; running: Check | null; run: (id: Check) => Promise<void>;
}) {
  return (
    <>
      <h1 className="mt-2 font-serif text-4xl">Supabase status</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">Supabase configuration is read directly from the existing Worker environment. This page is read-only; manage secrets in Cloudflare Worker Settings. Secret values are never displayed or edited here.</p>
      <div className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        <StatusCard title="SUPABASE_URL">{configuration.configured.SUPABASE_URL ? "Configured" : "Missing"}</StatusCard>
        <StatusCard title="SUPABASE_PUBLISHABLE_KEY">{configuration.configured.SUPABASE_PUBLISHABLE_KEY ? "Configured (masked)" : "Missing"}</StatusCard>
        <StatusCard title="SUPABASE_SERVICE_ROLE_KEY">{configuration.configured.SUPABASE_SERVICE_ROLE_KEY ? "Configured (server secret)" : "Missing"}</StatusCard>
        <StatusCard title="SUPABASE_DB_URL">{configuration.configured.SUPABASE_DB_URL ? "Configured (masked)" : "Missing"}</StatusCard>
        <StatusCard title="Hyperdrive">{configuration.hyperdrive ? "Worker binding detected" : "Not detected"}</StatusCard>
      </div>
      <div className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        <article className="rounded-card border border-on-photo/15 p-4"><h2 className="font-serif text-lg">Supabase API</h2><button type="button" className={button + " mt-3"} disabled={Boolean(running)} onClick={() => void run("api")}>{running === "api" ? "Testing…" : "Test Supabase API"}</button><Result value={apiResult} /></article>
        <article className="rounded-card border border-on-photo/15 p-4"><h2 className="font-serif text-lg">Database connection</h2><button type="button" className={button + " mt-3"} disabled={Boolean(running)} onClick={() => void run("connect")}>{running === "connect" ? "Testing…" : "Test database connection"}</button><Result value={dbResult} /></article>
      </div>
      <p className="mt-4 text-xs text-on-photo/60">No values can be entered, replaced or cleared here. This avoids creating a second source of truth for secrets.</p>
    </>
  );
}
