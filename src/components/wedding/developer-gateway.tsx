import { useEffect, useState, type FormEvent } from "react";
import { developerGatewayBoard, developerGatewaySave, developerGatewayTest } from "@/lib/infra/infra.functions";
import { displayText } from "@/lib/infra/display";
import { DEPLOYED_MEDIA_GATEWAY_ORIGIN, gatewaySavedStatus, normalizeGatewayOrigin } from "@/lib/infra/media-token";

type GatewayCheck = {
  id: string;
  label: string;
  result: string;
  detail: string;
};

type GatewayBoard = {
  enabled: boolean;
  origin: string;
  secretPresent: boolean;
  privateBucket: true;
  status: string;
  detail: string;
  requirement: string;
  testedAt: string;
  stage?: string;
  checks?: GatewayCheck[];
  lastSuccessAt?: string;
  lastFailureAt?: string;
};

function checkWord(result: string) {
  if (result === "passed") return "Passed";
  if (result === "failed") return "Failed";
  if (result === "present") return "Present";
  if (result === "missing") return "Missing";
  if (result === "invalid") return "Invalid";
  return "Not run";
}

function stageText(stage: string, checks: GatewayCheck[]) {
  if (stage === "disabled") {
    const called = checks.some((item) => item.id === "reach" && item.result !== "skipped");
    if (!called) return "Gateway is off. The Worker was not called.";
    const failed = checks.find((item) => item.result === "failed" || item.result === "invalid" || item.result === "missing");
    return failed ? `Gateway is off. ${failed.label}. ${failed.detail}` : "Gateway is off. Security checks ran and the switch was not turned on.";
  }
  if (stage === "not_tested") return "Not tested yet.";
  if (stage === "verified") return "None. The security checks passed.";
  const found = checks.find((item) => item.id === stage);
  return found ? `${found.label}. ${found.detail}` : stage || "Not recorded.";
}

export function DeveloperGateway({ token }: { token: string }) {
  const [board, setBoard] = useState<GatewayBoard | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [origin, setOrigin] = useState("");
  const [secret, setSecret] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const result = await developerGatewayBoard({ data: { token } });
    if (!result.ok) {
      setError(displayText(result.error) || "Gateway settings could not be read.");
      return;
    }
    setBoard(result);
    setEnabled(result.enabled);
    setOrigin(result.origin || "");
    setSecret("");
    setError("");
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setNotice("");
    setError("");
    try {
      const result = await developerGatewaySave({ data: { token, enabled, origin, secret } });
      if (!result.ok) {
        setError(displayText(result.error) || "Gateway settings were not saved.");
        return;
      }
      const fresh = await developerGatewayBoard({ data: { token } });
      if (!fresh.ok) {
        setError("Gateway settings were not confirmed after saving.");
        return;
      }
      const wanted = normalizeGatewayOrigin(origin);
      if ((fresh.origin || "") !== wanted) {
        setBoard(fresh);
        setEnabled(fresh.enabled);
        setOrigin(fresh.origin || "");
        setSecret("");
        setError("The Worker origin was not confirmed on the server.");
        return;
      }
      if (secret.trim() && !fresh.secretPresent) {
        setBoard(fresh);
        setEnabled(fresh.enabled);
        setOrigin(fresh.origin || "");
        setSecret("");
        setError("The Media Gateway Secret was not confirmed on the server.");
        return;
      }
      setBoard(fresh);
      setEnabled(fresh.enabled);
      setOrigin(fresh.origin || "");
      setSecret("");
      setNotice("Gateway settings saved.");
    } catch {
      setError("Gateway settings were not saved.");
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    setNotice("");
    setError("");
    let message = "";
    let failed = false;
    try {
      const result = await Promise.race([
        developerGatewayTest({ data: { token } }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("timeout")), 25000);
        }),
      ]);
      message = displayText(result?.detail) || displayText(result?.error) || "The gateway test finished.";
      if (result?.testedAt) message = `${message} Checked ${displayText(result.testedAt)}.`;
      failed = !result?.ok || (result.usable !== true && result.state !== "disabled");
      if (result?.ok && result.state === "disabled" && /security checks passed/i.test(message)) failed = false;
      if (result?.ok) {
        setBoard((current) => current ? {
          ...current,
          status: String(result.state || current.status),
          detail: displayText(result.detail) || current.detail,
          stage: result.stage,
          checks: Array.isArray(result.checks) ? result.checks : current.checks,
          testedAt: displayText(result.testedAt) || current.testedAt,
          lastSuccessAt: displayText(result.lastSuccessAt) || current.lastSuccessAt,
          lastFailureAt: displayText(result.lastFailureAt) || current.lastFailureAt,
        } : current);
      }
    } catch {
      failed = true;
      message = "The gateway test did not finish. The bucket was not made public.";
    }
    try {
      await load();
    } catch {
      if (!message) message = "Gateway settings could not be read after the test.";
      failed = true;
    }
    if (failed) setError(message);
    else if (message) setNotice(message);
    setBusy("");
  }

  const savedOrigin = board?.origin || "";
  const originDirty = Boolean(board) && normalizeGatewayOrigin(origin) !== savedOrigin && origin.trim() !== savedOrigin;
  const secretDirty = secret.trim().length > 0;
  const originStatus = gatewaySavedStatus({ checking: !board, saved: Boolean(savedOrigin), dirty: originDirty });
  const secretStatus = gatewaySavedStatus({ checking: !board, saved: Boolean(board?.secretPresent), dirty: secretDirty });

  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl">Private media gateway</h2>
      <p className="mt-2 text-sm text-on-photo/75">
        Photos and videos stay in the private bucket. This host must point at the Worker, never at a public R2 address. A link works for one file, for 15 minutes, and only after this wedding member is allowed to see it.
      </p>
      <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-3 rounded-card border border-on-photo/15 p-4">
        <label className="block text-sm">
          Gateway
          <select className="mt-2 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={enabled ? "yes" : "no"} onChange={(event) => setEnabled(event.target.value === "yes")}>
            <option value="no">Off — keep the current private path</option>
            <option value="yes">On — after the test passes</option>
          </select>
        </label>
        <label className="block text-sm">
          Worker origin
          <input className="mt-2 min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={origin} placeholder={DEPLOYED_MEDIA_GATEWAY_ORIGIN} autoComplete="off" spellCheck={false} onChange={(event) => setOrigin(event.target.value)} />
        </label>
        <p className="text-sm text-on-photo/75">Worker origin: {originStatus}</p>
        <label className="block text-sm">
          Media Gateway Secret
          <span className="mt-1 block text-xs text-on-photo/60">MEDIA_GATEWAY_SECRET</span>
          <input className="mt-2 min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={secret} type="password" autoComplete="new-password" spellCheck={false} placeholder={board?.secretPresent ? "Saved. Leave blank to keep it." : "At least 32 characters. Not shown again."} onChange={(event) => setSecret(event.target.value)} />
        </label>
        <p className="text-sm text-on-photo/75">Media Gateway Secret: {secretStatus}</p>
        <p className="text-sm text-on-photo/75">Bucket: private. This screen cannot turn public access on.</p>
        <p className="text-sm text-on-photo/75">Status: {board?.status || "not tested"}{board?.testedAt ? ` · ${board.testedAt}` : ""}</p>
        <p className="text-sm text-on-photo/75">On the Worker, set the same secret and ALLOWED_ORIGINS to the real site only. Do not change other DNS records from here.</p>
        {board ? (
          <div className="grid gap-1 rounded-2xl border border-on-photo/15 p-3">
            <p className="text-sm">{board.detail}</p>
            {board.requirement && board.requirement !== board.detail ? <p className="text-sm text-on-photo/75">{board.requirement}</p> : null}
            <p className="text-xs text-on-photo/70">First failed step: {stageText(board.stage || "", board.checks || [])}</p>
            <ul className="mt-1 grid gap-1">
              {(board.checks || []).map((check) => (
                <li key={check.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-xs">
                  <span>{check.label}</span>
                  <span>{checkWord(check.result)}</span>
                  <span className="col-span-2 text-on-photo/70">{check.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Last successful test: {board.lastSuccessAt || "None yet"}</p>
            <p className="text-xs">Last failed test: {board.lastFailureAt || "None yet"}</p>
          </div>
        ) : null}
        {notice ? <p className="text-sm">{notice}</p> : null}
        {error ? <p className="text-sm">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo" disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save gateway"}
          </button>
          <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" disabled={busy === "test"} onClick={() => void test()}>
            {busy === "test" ? "Checking…" : "Test gateway"}
          </button>
        </div>
      </form>
    </section>
  );
}
