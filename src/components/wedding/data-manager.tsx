import { useEffect, useState } from "react";
import {
  developerDataActivate,
  developerDataBoard,
  developerDataInspect,
  developerDataResume,
  developerDataSave,
  developerDataSync,
  developerDataTest,
  developerDataTransfer,
} from "@/lib/developer/data-manager.functions";

type Board = Awaited<ReturnType<typeof developerDataBoard>>;
type Ready = Extract<Board, { ok: true }>;
type Diagnostic = Ready["diagnostic"];
type ProviderId = Ready["providers"][number]["id"];

const PAIRS = [
  ["neon", "supabase"],
  ["supabase", "neon"],
  ["firebase", "supabase"],
  ["supabase", "firebase"],
] as const;

export function DataManager({ token }: { token: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [provider, setProvider] = useState<ProviderId>("neon");
  const [pasted, setPasted] = useState("");
  const [pair, setPair] = useState<(typeof PAIRS)[number]>(PAIRS[0]);
  const [saveOk, setSaveOk] = useState(false);
  const [transferOk, setTransferOk] = useState(false);
  const [syncOk, setSyncOk] = useState(false);
  const [resumeOk, setResumeOk] = useState(false);
  const [activateOk, setActivateOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [open, setOpen] = useState(true);

  async function reload() {
    try {
      const next = await developerDataBoard({ data: { token } });
      setBoard(next);
      if (next.ok) setDiagnostic((current) => current ?? next.diagnostic);
    } catch {
      setBoard({ ok: false, error: "Database Manager could not be loaded." });
    }
  }

  useEffect(() => {
    void reload();
  }, [token]);

  async function run(task: () => Promise<{ ok: boolean; diagnostic?: Diagnostic; message?: string; error?: string }>) {
    setBusy(true);
    try {
      const result = await task();
      if (result.diagnostic) {
        setDiagnostic(result.diagnostic);
        setOpen(true);
      }
      setPasted("");
      await reload();
    } catch {
      setOpen(true);
      setDiagnostic({
        headline: "That request did not finish.",
        failed: "The server did not return a result.",
        where: provider,
        code: "network",
        cause: "The request failed before a database change was confirmed.",
        changed: "Treat data as unchanged unless the activity log says otherwise.",
        dataSafety: "No delete was requested.",
        attempted: "The selected action",
        canFix: "Retry is safe if the activity log has no new copy.",
        next: "Reload this section and read the latest activity line.",
        retrySafe: true,
      });
    } finally {
      setBusy(false);
    }
  }

  if (!board) return <p className="text-sm text-on-photo/70">Loading Database Manager…</p>;
  if (!board.ok) return <p className="text-sm">{board.error}</p>;
  const current = board.providers.find((item) => item.id === provider) ?? board.providers[0];
  const notice = diagnostic ?? board.diagnostic;

  return (
    <section className="max-w-6xl">
      <h1 className="font-serif text-4xl">Database Manager & AutoSync</h1>
      <p className="mt-2 max-w-3xl text-sm text-on-photo/70">
        Neon, Supabase, and Firebase stay separate. A successful test does not switch the live website. {board.production ? "This process can check published routing." : "This preview cannot prove what the published site is serving."}
      </p>
      <p className="mt-3 text-sm">{board.policy}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-on-photo/60">
              <th className="py-2 pr-3 font-normal">Data</th>
              <th className="py-2 pr-3 font-normal">Configured</th>
              <th className="py-2 pr-3 font-normal">Connection</th>
              <th className="py-2 pr-3 font-normal">Serving</th>
              <th className="py-2 font-normal">State</th>
            </tr>
          </thead>
          <tbody>
            {board.categories.map((row) => (
              <tr key={row.id} className="border-t border-on-photo/10 align-top">
                <td className="py-2 pr-3">{row.label}</td>
                <td className="py-2 pr-3">{row.configured}</td>
                <td className="py-2 pr-3">{row.verified}</td>
                <td className="py-2 pr-3">{row.serving}</td>
                <td className="py-2">{row.state.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-2xl border border-gold/40 p-4">
        <button type="button" className="min-h-11 text-left text-sm text-gold" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide diagnostic" : "Show diagnostic"} · {notice.headline}
        </button>
        {open ? (
          <dl className="mt-3 grid gap-2 text-sm">
            <div><dt className="text-on-photo/60">What failed</dt><dd>{notice.failed || "Nothing in this request."}</dd></div>
            <div><dt className="text-on-photo/60">Where</dt><dd>{notice.where} · code {notice.code || "n/a"}</dd></div>
            <div><dt className="text-on-photo/60">Cause</dt><dd>{notice.cause || "No failure to explain."}</dd></div>
            <div><dt className="text-on-photo/60">Changed</dt><dd>{notice.changed}</dd></div>
            <div><dt className="text-on-photo/60">Data</dt><dd>{notice.dataSafety}</dd></div>
            <div><dt className="text-on-photo/60">Tried</dt><dd>{notice.attempted}</dd></div>
            <div><dt className="text-on-photo/60">Can fix itself</dt><dd>{notice.canFix}</dd></div>
            <div><dt className="text-on-photo/60">What you do</dt><dd>{notice.next}</dd></div>
            <div><dt className="text-on-photo/60">Retry</dt><dd>{notice.retrySafe ? "Safe if you are repeating a read or a blocked save." : "Do not retry blindly. Read the activity log first."}</dd></div>
          </dl>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {board.providers.map((item) => (
          <button key={item.id} type="button" className={item.id === provider ? "min-h-11 rounded-full bg-maroon px-4 text-sm" : "min-h-11 rounded-full border border-on-photo/20 px-4 text-sm"} onClick={() => setProvider(item.id)}>
            {item.title}
          </button>
        ))}
      </div>
      <article className="mt-4 rounded-2xl border border-on-photo/10 p-4">
        <h2 className="font-serif text-2xl">{current.title}</h2>
        <p className="mt-2 text-sm">{current.summary}</p>
        <ul className="mt-3 grid gap-2 text-sm">
          {current.services.map((service) => (
            <li key={service.name}><span className="text-gold">{service.name}</span> · {service.state.replaceAll("_", " ")}. {service.detail}</li>
          ))}
        </ul>
        <label className="mt-4 block text-sm">
          Connection value
          <input
            className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3"
            type="password"
            autoComplete="off"
            value={pasted}
            placeholder="Leave blank to keep the server value"
            onChange={(event) => setPasted(event.target.value)}
          />
        </label>
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={saveOk} onChange={(event) => setSaveOk(event.target.checked)} />
          Save this provider only. Do not copy data and do not switch the live site.
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy || !saveOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataSave({ data: { token, provider, pasted, confirm: true } }))}>Save connection</button>
          <button type="button" disabled={busy} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataTest({ data: { token, provider } }))}>Test connection</button>
          <button type="button" disabled={busy || provider === "firebase"} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataInspect({ data: { token } }))}>Inspect database</button>
        </div>
      </article>

      <article className="mt-4 rounded-2xl border border-on-photo/10 p-4">
        <h2 className="font-serif text-2xl">Transfer and sync</h2>
        <label className="mt-3 block text-sm">
          Direction
          <select className="mt-1 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={`${pair[0]}:${pair[1]}`} onChange={(event) => {
            const next = PAIRS.find((item) => `${item[0]}:${item[1]}` === event.target.value);
            if (next) setPair(next);
          }}>
            {PAIRS.map((item) => <option key={`${item[0]}-${item[1]}`} value={`${item[0]}:${item[1]}`}>{item[0]} to {item[1]}</option>)}
          </select>
        </label>
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={transferOk} onChange={(event) => setTransferOk(event.target.checked)} />
          Copy wedding rows. Do not delete destination-only rows and do not switch routing.
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataTransfer({ data: { token, source: pair[0], destination: pair[1], execute: false, confirm: false } }))}>View details</button>
          <button type="button" disabled={busy || !transferOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataTransfer({ data: { token, source: pair[0], destination: pair[1], execute: true, confirm: true } }))}>Transfer data</button>
        </div>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={syncOk} onChange={(event) => setSyncOk(event.target.checked)} />
          Sync Now copies the published source forward only when it is still the live writer.
        </label>
        <button type="button" disabled={busy || !syncOk} className="mt-2 min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataSync({ data: { token, confirm: true } }))}>Sync now</button>
      </article>

      <article className="mt-4 rounded-2xl border border-on-photo/10 p-4">
        <h2 className="font-serif text-2xl">Recovery centre</h2>
        <ul className="mt-3 grid gap-2 text-sm">
          {board.recovery.map((item) => (
            <li key={item.title}><span className="text-gold">{item.title}.</span> {item.detail}</li>
          ))}
        </ul>
        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={resumeOk} onChange={(event) => setResumeOk(event.target.checked)} />
          Resume a stale interrupted copy. Do not switch routing.
        </label>
        <button type="button" disabled={busy || !resumeOk} className="mt-2 min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerDataResume({ data: { token, confirm: true } }))}>Resume sync</button>
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={activateOk} onChange={(event) => setActivateOk(event.target.checked)} />
          I confirm activation. Switch wedding records only if every check passes.
        </label>
        <button type="button" disabled={busy || !activateOk} className="mt-2 min-h-11 rounded-full bg-maroon px-4 text-sm" onClick={() => void run(() => developerDataActivate({ data: { token, confirm: true } }))}>Change production routing</button>
      </article>

      <article className="mt-4">
        <h2 className="font-serif text-2xl">Activity</h2>
        {board.activity.length === 0 ? <p className="mt-2 text-sm text-on-photo/70">No manager actions have been recorded in this database.</p> : (
          <ul className="mt-2 grid gap-2 text-sm">
            {board.activity.map((item) => (
              <li key={`${item.jobId}-${item.action}-${item.at}`} className="rounded-2xl border border-on-photo/10 p-3">
                <p>{item.at} · {item.provider} · {item.action} · {item.status}</p>
                <p className="mt-1 text-on-photo/70">{item.detail}</p>
                <p className="mt-1 text-on-photo/50">Job {item.jobId}</p>
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  );
}
