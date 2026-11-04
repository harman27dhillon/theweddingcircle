import { useEffect, useState, type FormEvent } from "react";
import { developerCdnBoard, developerCdnSave, developerCdnTest } from "@/lib/infra/infra.functions";
import { cdnStatusLabel } from "@/lib/infra/labels";
import { displayText } from "@/lib/infra/display";

type CdnBoard = {
  enabled: boolean;
  domain: string;
  base: string;
  cache: string;
  privateAccess: true;
  accountId: string;
  bucket: string;
  r2State: string;
  zoneId: string;
  tokenPresent: boolean;
  status: string;
  detail: string;
  requirement: string;
  testedAt: string;
};

export function DeveloperCdn({ token }: { token: string }) {
  const [board, setBoard] = useState<CdnBoard | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [domain, setDomain] = useState("");
  const [base, setBase] = useState("");
  const [cache, setCache] = useState("private");
  const [zoneId, setZoneId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  async function load() {
    const result = await developerCdnBoard({ data: { token } });
    if (!result.ok) {
      setError(displayText(result.error) || "CDN settings could not be read.");
      return;
    }
    setBoard(result);
    setEnabled(result.enabled);
    setDomain(result.domain);
    setBase(result.base);
    setCache(result.cache === "no-store" ? "no-store" : result.cache === "authorized" ? "authorized" : "private");
    setZoneId(result.zoneId || "");
    setApiToken("");
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
      const result = await developerCdnSave({ data: { token, enabled, domain, base, cache, zoneId, apiToken } });
      if (!result.ok) setError(displayText(result.error) || "CDN settings were not saved.");
      else setNotice(displayText(result.detail) || "CDN settings saved.");
      await load();
    } catch {
      setError("CDN settings were not saved.");
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
      const result = await developerCdnTest({ data: { token } });
      message = displayText(result?.detail) || displayText(result?.error) || "";
      if (result?.testedAt) message = `${message} Checked ${displayText(result.testedAt)}.`.trim();
      if (!result || result.ok === false || (result.usable === false && result.state !== "disabled")) {
        failed = true;
        if (!message) message = "The CDN test stopped before it returned a result.";
      }
    } catch {
      failed = true;
      message = "The CDN test stopped before it returned a result. DNS and the bucket were not changed.";
    }
    try {
      await load();
    } catch {
      if (!message) message = "CDN settings could not be read after the test.";
    }
    if (failed) setError(message);
    else if (message) setNotice(message);
    setBusy("");
  }

  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl">Cloudflare CDN</h2>
      <p className="mt-2 text-sm text-on-photo/75">
        Delivery only. Uploads still go to the existing private bucket. The bucket is not made public, and a passing test is not an HTTP 200 from the home page.
      </p>
      <form onSubmit={(event) => void save(event)} className="mt-4 grid gap-3 rounded-card border border-on-photo/15 p-4">
        <label className="block text-sm">
          CDN status
          <select className="mt-2 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={enabled ? "yes" : "no"} onChange={(event) => setEnabled(event.target.value === "yes")}>
            <option value="no">Disabled</option>
            <option value="yes">Enabled</option>
          </select>
        </label>
        <label className="block text-sm">
          Media domain
          <input className="mt-2 min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={domain} placeholder="media.theweddingcircle.in" autoComplete="off" spellCheck={false} onChange={(event) => setDomain(event.target.value)} />
        </label>
        <label className="block text-sm">
          CDN base URL
          <input className="mt-2 min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={base} placeholder="https://media.theweddingcircle.in" autoComplete="off" spellCheck={false} onChange={(event) => setBase(event.target.value)} />
        </label>
        <p className="text-sm text-on-photo/75">Saved media domain: {board?.domain || "Not saved"}</p>
        <p className="text-sm text-on-photo/75">Saved base URL: {board?.base || "Not saved"}</p>
        <p className="text-sm text-on-photo/75">Cloudflare account ID: {board?.accountId || "Not set. It is taken from the existing R2 or livestream configuration."}</p>
        <label className="block text-sm">
          Zone ID
          <input className="mt-2 min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={zoneId} placeholder="Optional 32-character zone id" autoComplete="off" spellCheck={false} onChange={(event) => setZoneId(event.target.value)} />
        </label>
        <label className="block text-sm">
          Cloudflare API token
          <input className="mt-2 min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={apiToken} type="password" placeholder={board?.tokenPresent ? "Saved. Leave blank to keep it." : "Zone Read token. Not the R2 secret."} autoComplete="off" spellCheck={false} onChange={(event) => setApiToken(event.target.value)} />
        </label>
        <p className="text-sm text-on-photo/75">API token: {board?.tokenPresent ? "Saved on the server" : "Not saved. The private-media probe still runs without it."}</p>
        <p className="text-sm text-on-photo/75">Zone ID is optional. It is used only when a token can read one zone but cannot list zones. DNS is not changed from here.</p>
        <p className="text-sm text-on-photo/75">R2 bucket: {board?.bucket || "Not set"}</p>
        <p className="text-sm text-on-photo/75">R2 connection: {board?.r2State || "not_configured"}</p>
        <label className="block text-sm">
          Cache policy
          <select className="mt-2 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={cache} onChange={(event) => setCache(event.target.value)}>
            <option value="private">Private browser cache only</option>
            <option value="no-store">Do not store</option>
            <option value="authorized">Authorized edge cache, after the signature check</option>
          </select>
        </label>
        <p className="text-xs text-on-photo/60">Private is the browser only. Do not store keeps the file out of caches. Authorized edge cache is used only after the signature matches the object, and saving this form does not turn it on.</p>
        <p className="text-sm">Private media access: Enabled. This cannot be turned off.</p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="min-h-11 rounded-full bg-maroon px-4 text-sm" disabled={busy === "save"}>
            {busy === "save" ? "Saving…" : "Save configuration"}
          </button>
          <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" disabled={busy === "test"} onClick={() => void test()}>
            {busy === "test" ? "Checking…" : "Test CDN connection"}
          </button>
        </div>
        {board ? <p className={`text-sm ${board.status === "error" ? "text-gold" : ""}`}>Status: {cdnStatusLabel(board.status, board.enabled, board.domain)}. {board.detail}</p> : <p className="text-sm text-on-photo/70">Reading CDN status…</p>}
        {board?.requirement ? <p className="text-sm text-gold">{board.requirement}</p> : null}
        <p className="text-xs text-on-photo/60">{board?.testedAt ? `Last tested: ${board.testedAt}` : "No CDN test has been stored."}</p>
        {notice ? <p className="text-sm">{notice}</p> : null}
        {error ? <p className="text-sm text-gold">{error}</p> : null}
      </form>
    </section>
  );
}
