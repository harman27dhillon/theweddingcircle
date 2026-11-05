import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  developerControlCheck, developerControlConfiguration, developerControlLogin,
  developerControlLogout, developerControlStatus,
} from "@/lib/developer/control/actions.functions";
import { CHECKS, CONFIG_FIELDS, type Check, type ConfigName, type Diagnostic } from "@/lib/developer/control/model";

const sections = [
  ["overview", "Infrastructure overview"],
  ["configuration", "Supabase configuration"],
  ["database", "Database setup & hosting"],
] as const;

type Section = typeof sections[number][0];
type Status = Awaited<ReturnType<typeof developerControlStatus>>;
type Configuration = NonNullable<Status["configuration"]>;
type DatabaseState = "idle" | "checking" | "verified" | "failed";
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
              <StatusCard title="HYPERDRIVE">{configuration.hyperdrive ? "Runtime binding present. Direct Supabase Postgres is used for these checks." : "Optional runtime binding not present"}</StatusCard>
            </div>
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
  const [shown, setShown] = useState<Partial<Record<ConfigName, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [clear, setClear] = useState(false);
  const [result, setResult] = useState<Diagnostic>();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const values = Object.fromEntries(CONFIG_FIELDS.map(({ name }) => [name, fields.get(name)]));
    const clearRequested = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "clear";
    setBusy(true);
    setResult(undefined);
    try {
      const response = await developerControlConfiguration({ data: { values: clearRequested ? {} : values, clear: clearRequested, confirm: clear } });
      setResult(response);
      if (response.ok) {
        form.reset();
        setShown({});
        setClear(false);
      }
    } catch {
      setResult({ ok: false, message: "The configuration request did not finish. Check Worker Versions before retrying." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="mt-2 font-serif text-4xl">Supabase configuration</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">Values entered here are sent to the server to stage Developer Center secrets in Cloudflare. Blank fields leave deployed values in place. Review and deploy the staged version in Cloudflare to use the changes.</p>
      {!configuration.canStage ? <p className="mt-3 text-sm text-gold">Secret management is unavailable. Set the Developer Center secrets directly in Cloudflare or configure its secret management token.</p> : null}
      <form className="mt-6 grid max-w-2xl gap-4 rounded-card border border-on-photo/15 p-4 sm:p-6" onSubmit={(event) => void save(event)} autoComplete="off">
        {CONFIG_FIELDS.map(({ name, secret }) => (
          <div key={name}>
            <label htmlFor={name} className="block break-all text-sm">{name}</label>
            <p className="mb-2 mt-1 text-xs text-on-photo/65">{configuration.configured[name] ? "Configured on this Worker" : "Missing"}</p>
            <div className="flex gap-2">
              <input id={name} name={name} type={secret && !shown[name] ? "password" : "text"} className={field} autoComplete="off" spellCheck={false} maxLength={8192} />
              {secret ? <button type="button" className={button} aria-label={`${shown[name] ? "Hide" : "Show"} ${name}`} onClick={() => setShown((current) => ({ ...current, [name]: !current[name] }))}>{shown[name] ? "Hide" : "Show"}</button> : null}
            </div>
          </div>
        ))}
        <StatusCard title="HYPERDRIVE">{configuration.hyperdrive ? "Cloudflare runtime binding detected" : "Optional Cloudflare runtime binding not configured"}</StatusCard>
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={busy || !configuration.canStage}>Save Configuration</button>
          <button type="button" className={button} disabled={busy || !configuration.canStage} onClick={() => setClear((value) => !value)}>Clear Configuration</button>
        </div>
        {clear ? <div className="rounded-xl border border-gold/40 p-3 text-sm"><p>Stage removal of the four Developer Center secrets? Wedding app secrets are separate.</p><button type="submit" value="clear" className={`mt-2 ${button}`} disabled={busy}>Confirm clear</button></div> : null}
        <Result value={result} />
      </form>
      <div className="mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
        <StatusCard title="HTTPS API test"><button type="button" className={button} disabled={Boolean(running)} onClick={() => void run("api")}>{running === "api" ? "Testing…" : "Test Supabase API connection"}</button></StatusCard>
        <StatusCard title="Postgres connection test"><button type="button" className={button} disabled={Boolean(running)} onClick={() => void run("connect")}>{running === "connect" ? "Testing…" : "Test database connectivity"}</button></StatusCard>
        <Result value={apiResult} />
        <Result value={dbResult} />
      </div>
    </>
  );
}
