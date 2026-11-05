import { useEffect, useState } from "react";
import {
  developerCoreArchive,
  developerCoreBoard,
  developerCoreCopy,
  developerCoreCutover,
  developerCoreDryRun,
  developerCoreInspect,
  developerCoreFreeze,
  developerCorePrepare,
  developerCoreProbe,
  developerCoreResume,
  developerCoreReverse,
  developerCoreRollback,
  developerCoreValidate,
} from "@/lib/developer/core-migration.functions";

type Board = Awaited<ReturnType<typeof developerCoreBoard>>;

export function CoreMigration({ token }: { token: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [note, setNote] = useState("");
  const [prepareOk, setPrepareOk] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [cutoverOk, setCutoverOk] = useState(false);
  const [freezeOk, setFreezeOk] = useState(false);
  const [reverseOk, setReverseOk] = useState(false);
  const [resumeOk, setResumeOk] = useState(false);
  const [archiveOk, setArchiveOk] = useState(false);
  const [rollbackOk, setRollbackOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setBoard(await developerCoreBoard({ data: { token } }));
    } catch {
      setBoard({ ok: false, error: "Core data migration could not be loaded." });
    }
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function testConnection() {
    setBusy(true);
    try {
      const result = await developerCoreProbe({ data: { token } });
      if (!result.ok) setNote(result.error);
      else setNote(`${result.probe.status.replaceAll("_", " ")}. ${result.probe.detail} ${result.alternates}`);
    } catch {
      setNote("The connection test did not finish. Wedding traffic was not switched.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = (await action()) as { ok?: boolean; error?: string; detail?: string };
      if (result && result.ok === false && result.error) setNote(result.error);
      else setNote("Updated. The result below is what the server recorded.");
      setPrepareOk(false);
      setCopyOk(false);
      setCutoverOk(false);
      setFreezeOk(false);
      setReverseOk(false);
      setResumeOk(false);
      setArchiveOk(false);
      setRollbackOk(false);
      await load();
    } catch {
      setNote("That step did not finish. Wedding traffic was not switched.");
    } finally {
      setBusy(false);
    }
  }

  if (!board) return <p className="mt-8 text-sm text-on-photo/70">Loading core data migration…</p>;
  if (!board.ok) return (
    <section className="mt-10 max-w-6xl border-t border-on-photo/10 pt-8">
      <h2 className="font-serif text-3xl">Core data migration</h2>
      <p className="mt-2 text-sm text-on-photo/70">{board.error}</p>
      <button type="button" disabled={busy} onClick={() => void testConnection()} className="mt-4 min-h-11 rounded-full border border-on-photo/20 px-4 text-sm">
        {busy ? "Checking…" : "Test Supabase connection"}
      </button>
      {note ? <p role="status" className="mt-3 text-sm text-on-photo/75">{note}</p> : null}
    </section>
  );

  return (
    <section className="mt-10 max-w-6xl border-t border-on-photo/10 pt-8">
      <h2 className="font-serif text-3xl">Core data migration</h2>
      <p className="mt-2 max-w-3xl text-sm text-on-photo/70">
        Separate from media storage. On the published app, wedding records move to Supabase once the field check, access check, and relationship check pass. This preview still uses the local database. Nothing here deletes either database.
      </p>
      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-on-photo/60">Current source</dt>
          <dd>{board.sourceLabel}</dd>
        </div>
        <div>
          <dt className="text-on-photo/60">Live reads and writes</dt>
          <dd>{board.liveWrites}</dd>
        </div>
        <div>
          <dt className="text-on-photo/60">Postgres connection</dt>
          <dd>{board.databaseProbe.state.replaceAll("_", " ")}. {board.databaseProbe.detail}</dd>
        </div>
        <div>
          <dt className="text-on-photo/60">Auth API</dt>
          <dd>{board.authApi.state.replaceAll("_", " ")}. {board.authApi.detail}</dd>
        </div>
        <div>
          <dt className="text-on-photo/60">Migration phase</dt>
          <dd>{board.phase.replaceAll("_", " ")}{board.validated ? " · validation passed" : " · not validated"}</dd>
        </div>
      </dl>
      <p className="mt-3 text-sm">{board.routeReason}</p>
      <p className="mt-2 text-sm">{board.auditSummary}</p>
      {board.diffs.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm">
          {board.diffs.slice(0, 12).map((diff) => (
            <li key={`${diff.table}-${diff.key}-${diff.column}-${diff.kind}`}>{diff.table} · {diff.key} · {diff.column} · {diff.kind.replaceAll("_", " ")}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-sm text-on-photo/70">{board.authNote}</p>
      <p className="mt-2 text-sm text-on-photo/70">{board.mediaNote}</p>
      <p className="mt-2 text-sm text-on-photo/70">{board.rollbackNote}</p>
      <p className="mt-2 text-sm">{board.setupNote}</p>
      <p className="mt-2 text-sm">{board.connectionSummary}</p>
      <p className="mt-2 text-sm">
        Server database URL {board.dbUrlConfigured ? "is set" : "is not set in this runtime"}. Service-role key {board.serviceRoleConfigured ? "is set" : "is not set in this runtime"}. Secrets are not shown.
      </p>
      {board.detail ? <p className="mt-3 text-sm text-gold">{board.detail}</p> : null}
      {note ? <p className="mt-2 text-sm">{note}</p> : null}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-on-photo/60">
              <th className="py-2 pr-3 font-normal">Table</th>
              <th className="py-2 pr-3 font-normal">Current</th>
              <th className="py-2 pr-3 font-normal">Supabase</th>
              <th className="py-2 font-normal">Match</th>
            </tr>
          </thead>
          <tbody>
            {board.comparison.rows.map((row) => (
              <tr key={row.table} className="border-t border-on-photo/10">
                <td className="py-2 pr-3">{row.table}</td>
                <td className="py-2 pr-3 tabular-nums">{row.source < 0 ? "missing" : row.source}</td>
                <td className="py-2 pr-3 tabular-nums">{!board.targetReachable ? "not queried" : row.target < 0 ? "missing" : row.target}</td>
                <td className="py-2">{!board.targetReachable ? "—" : row.match ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void testConnection()}>
          Test database connection
        </button>
        <button type="button" disabled={busy} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreInspect({ data: { token } }))}>
          Inspect schema and prerequisites
        </button>
        <button type="button" disabled={busy} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreDryRun({ data: { token } }))}>
          Run dry run
        </button>
        <button type="button" disabled={busy} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreValidate({ data: { token } }))}>
          Validate migrated records
        </button>
      </div>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={prepareOk} onChange={(event) => setPrepareOk(event.target.checked)} />
        Prepare Supabase tables only. Do not copy wedding rows.
      </label>
      <button type="button" disabled={busy || !prepareOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCorePrepare({ data: { token, confirm: true } }))}>
        Prepare migrations
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={copyOk} onChange={(event) => setCopyOk(event.target.checked)} />
        Copy rows into Supabase. Do not delete the current database and do not switch traffic.
      </label>
      <button type="button" disabled={busy || !copyOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreCopy({ data: { token, confirm: true } }))}>
        Run validated data migration
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={cutoverOk} onChange={(event) => setCutoverOk(event.target.checked)} />
        I confirm cutover. Serve wedding records from Supabase. Do not delete the current database.
      </label>
      <button type="button" disabled={busy || !cutoverOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreCutover({ data: { token, confirm: true } }))}>
        Confirm cutover
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={archiveOk} onChange={(event) => setArchiveOk(event.target.checked)} />
        Copy Supabase-only wedding rows into the recovery table, then remove only those rows. Do not change the current database.
      </label>
      <button type="button" disabled={busy || !archiveOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreArchive({ data: { token, confirm: true } }))}>
        Archive Supabase-only rows
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={freezeOk} onChange={(event) => setFreezeOk(event.target.checked)} />
        Pause wedding writes. Do not switch databases and do not delete rows.
      </label>
      <button type="button" disabled={busy || !freezeOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreFreeze({ data: { token, confirm: true } }))}>
        Pause writes
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={reverseOk} onChange={(event) => setReverseOk(event.target.checked)} />
        Copy Supabase wedding rows back onto the current database, then compare every field.
      </label>
      <button type="button" disabled={busy || !reverseOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreReverse({ data: { token, confirm: true } }))}>
        Reverse sync
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={resumeOk} onChange={(event) => setResumeOk(event.target.checked)} />
        Resume wedding writes on the database that is already serving them.
      </label>
      <button type="button" disabled={busy || !resumeOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreResume({ data: { token, confirm: true } }))}>
        Resume writes
      </button>
      <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" checked={rollbackOk} onChange={(event) => setRollbackOk(event.target.checked)} />
        Route wedding data back to the current database only after the reverse sync matches. Do not delete Supabase rows.
      </label>
      <button type="button" disabled={busy || !rollbackOk} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void run(() => developerCoreRollback({ data: { token, confirm: true } }))}>
        Roll back routing
      </button>
    </section>
  );
}
