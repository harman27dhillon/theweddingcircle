import { useEffect, useState, type FormEvent, Component, type ReactNode } from "react";
import { developerInfraBoard, developerInfraFlag, developerInfraSave, developerInfraTest } from "@/lib/infra/infra.functions";
import { displayText, testResultText } from "@/lib/infra/display";
import { R2CredentialFields, r2DraftSeed, type R2FieldView } from "@/lib/infra/r2-fields";
import { DeveloperCdn } from "@/components/wedding/developer-cdn";
import { DeveloperGateway } from "@/components/wedding/developer-gateway";
import { MIGRATION_PHRASE, PRODUCTION_PHRASE, providerStatusLabel, securityStatusLabel, type FlagId } from "@/lib/infra/labels";

type InfraForm = { id: string; note: string; fields: R2FieldView[] };
type Ready = {
  ok: true;
  environment: string;
  database: string;
  packaging: string;
  warning?: string;
  persisted?: boolean;
  providers: {
    id: string;
    label: string;
    state: string;
    detail: string;
    checkedAt: string;
    missing: string[];
    checklist: { label: string; done: boolean; tone?: string }[];
    security?: string;
  }[];
  forms: InfraForm[];
  flags: { id: FlagId; label: string; enabled: boolean; active: boolean; note: string }[];
  catalog: { slot: string; title: string; kind: string; productIdSet: boolean }[];
};
type Board = Ready | { ok: false; error: string };

function seed(form: InfraForm) {
  return Object.fromEntries(form.fields.map((field) => [field.key, field.input === "password" || field.input === "json" ? "" : field.value]));
}

function fieldStatus(field: InfraForm["fields"][number]) {
  if (!field.present) return "Missing";
  if (field.input === "password" || field.input === "json" || field.mask) return "Saved on the server";
  if (field.locked) return "Set on the server";
  return "Saved";
}

function presentBoard(result: Ready): Ready {
  return {
    ...result,
    providers: result.providers.map((item) => ({
      ...item,
      detail: displayText(item.detail),
      checkedAt: displayText(item.checkedAt),
      missing: Array.isArray(item.missing) ? item.missing.map((entry) => displayText(entry)).filter(Boolean) : [],
      checklist: Array.isArray(item.checklist)
        ? item.checklist.map((step) => ({ label: displayText(step?.label), done: step?.done === true, tone: step?.tone }))
        : [],
    })),
  };
}

class InfraGuard extends Component<{ children: ReactNode }, { error: string }> {
  state = { error: "" };

  static getDerivedStateFromError(): { error: string } {
    return { error: "This section could not show the connection result. Saved credentials were kept." };
  }

  render() {
    if (this.state.error) return <p className="text-sm text-gold">{this.state.error}</p>;
    return this.props.children;
  }
}

export function DeveloperInfrastructure({ token }: { token: string }) {
  return (
    <InfraGuard>
      <InfrastructureBoard token={token} />
    </InfraGuard>
  );
}

function InfrastructureBoard({ token }: { token: string }) {
  const [board, setBoard] = useState<Ready | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [pending, setPending] = useState<{ id: FlagId; enable: boolean; label: string } | null>(null);
  const [phrase, setPhrase] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});

  async function load(): Promise<Ready | null> {
    const result = await developerInfraBoard({ data: { token } });
    if (!result.ok) {
      setBoard(null);
      setError(displayText(result.error) || "Infrastructure status could not be read.");
      return null;
    }
    const next = presentBoard(result);
    setBoard(next);
    setError("");
    return next;
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function testProvider(provider: string) {
    setBusy(provider);
    setNotice("");
    setError("");
    try {
      const result = await developerInfraTest({ data: { token, provider } });
      const verdict = testResultText(result);
      setNotice(verdict.text);
      await load();
    } catch {
      setError("That check could not be finished.");
    } finally {
      setBusy("");
    }
  }

  function toggleForm(id: string) {
    const form = board?.forms.find((item) => item.id === id);
    const opening = !open[id];
    setOpen((current) => ({ ...current, [id]: opening }));
    if (opening && form) {
      const next = id === "r2" ? r2DraftSeed(form.fields) : seed(form);
      setDrafts((current) => ({ ...current, [id]: next }));
    }
  }

  function cancelEdit(id: string) {
    const form = board?.forms.find((item) => item.id === id);
    if (form && id === "r2") setDrafts((current) => ({ ...current, [id]: r2DraftSeed(form.fields) }));
    setOpen((current) => ({ ...current, [id]: false }));
    setNotice("");
    setError("");
  }

  async function saveConfig(provider: string, event: FormEvent) {
    event.preventDefault();
    const form = board?.forms.find((item) => item.id === provider);
    const draft = drafts[provider] || {};
    const values = Object.fromEntries((form?.fields ?? []).map((field) => [field.key, draft[field.key] ?? ""]));
    setBusy(`save:${provider}`);
    setNotice("");
    setError("");
    try {
      const result = await developerInfraSave({ data: { token, provider, values } });
      if (!result.ok) {
        setError(displayText(result.error) || "That configuration was not saved.");
        return;
      }
      setNotice(displayText(result.detail) || "Configuration saved.");
      const fresh = await load();
      const form = fresh?.forms.find((item) => item.id === provider);
      if (form) setDrafts((current) => ({ ...current, [provider]: provider === "r2" ? r2DraftSeed(form.fields) : seed(form) }));
    } catch {
      setError("That configuration was not saved.");
    } finally {
      setBusy("");
    }
  }

  async function saveFlag(event: FormEvent) {
    event.preventDefault();
    if (!pending) return;
    setBusy(pending.id);
    setError("");
    try {
      const result = await developerInfraFlag({ data: { token, id: pending.id, enable: pending.enable, confirm: true, phrase } });
      if (!result.ok) setError(displayText(result.error) || "That setting was not saved.");
      else setNotice(displayText(result.detail) || "Setting saved.");
      setPending(null);
      setPhrase("");
      await load();
    } catch {
      setError("That setting was not saved.");
    } finally {
      setBusy("");
    }
  }

  if (!board) {
    return <p className="text-sm text-on-photo/70">{error || "Reading infrastructure status…"}</p>;
  }

  const needsPhrase = pending?.id === "productionMode" || (pending?.id === "mediaMigration" && pending.enable);

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gold">Developer Center</p>
      <h1 className="mt-2 font-serif text-4xl">Infrastructure & Integrations</h1>
      <p className="mt-3 text-sm text-on-photo/75">
        Status comes from the server environment and from real checks. A switch does not mean a service is connected, and nothing here buys a plan or moves wedding files.
      </p>
      <p className="mt-3 text-sm">Environment: {board.environment === "production" ? "Production" : board.environment === "test" ? "Test" : "Development"}. Database: {board.database === "pglite" ? "Embedded preview database" : board.database === "supabase" ? "Supabase URL is set" : "Cloud database URL is set"}.</p>
      {"warning" in board && typeof board.warning === "string" ? <p className="mt-3 text-sm text-gold">{board.warning}</p> : null}
      {notice ? <p className="mt-3 text-sm">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm text-gold">{error}</p> : null}

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Dashboard</h2>
        <ul className="mt-4 grid gap-3">
          {board.providers.map((item) => {
            const form = board.forms.find((entry) => entry.id === item.id);
            const draft = drafts[item.id] || {};
            const configured = form?.fields.some((field) => field.present) ?? false;
            const armed = board.flags.some((flag) => flag.active && (
              (item.id === "firebase" && flag.id === "firebaseAuth")
              || (item.id === "livestream" && flag.id === "livestream")
              || (item.id === "r2" && flag.id === "r2Media")
              || (item.id === "database" && flag.id === "cloudDatabase")
              || (item.id === "play" && flag.id === "playBilling")
              || (item.id === "push" && flag.id === "pushNotifications")
            ));
            const status = providerStatusLabel(item.state, item.state === "verified" && armed);
            return (
              <li key={item.id} className="rounded-card border border-on-photo/15 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-serif text-xl">{item.label}</h3>
                    <p className={`mt-1 text-sm ${item.state === "error" ? "text-gold" : "text-on-photo/80"}`}>{status}</p>
                    {securityStatusLabel(item.security || "") ? <p className="mt-1 text-sm text-on-photo/80">{securityStatusLabel(item.security || "")}</p> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {form ? (
                      <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => toggleForm(item.id)}>
                        {open[item.id] ? "Close" : configured ? "Edit configuration" : "Add configuration"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm"
                      disabled={busy === item.id}
                      onClick={() => void testProvider(item.id)}
                    >
                      {busy === item.id ? "Checking…" : "Test connection"}
                    </button>
                  </div>
                </div>
                <p className="mt-3 text-sm text-on-photo/80">{displayText(item.detail)}</p>
                {displayText(item.checkedAt) ? <p className="mt-2 text-xs text-on-photo/60">Last check: {displayText(item.checkedAt)}</p> : <p className="mt-2 text-xs text-on-photo/60">No connection test has been stored.</p>}
                {item.missing.length ? <p className="mt-2 text-sm">Still needed: {item.missing.map((entry) => displayText(entry)).filter(Boolean).join(", ")}</p> : null}
                <ul className="mt-3 grid gap-1 text-sm text-on-photo/75">
                  {item.checklist.map((step) => (
                    <li key={displayText(step.label)}>{step.tone === "na" ? "Not applicable" : step.tone === "operational" ? "Security operational" : step.tone === "audit" ? "Security audit required" : step.done ? "Done" : "Not done"} — {displayText(step.label)}</li>
                  ))}
                </ul>
                {form && open[item.id] ? (
                  <form onSubmit={(event) => void saveConfig(item.id, event)} className="mt-4 grid gap-3 border-t border-on-photo/10 pt-4">
                    <p className="text-sm text-on-photo/75">{form.note}</p>
                    {item.id === "r2" ? (
                      <R2CredentialFields
                        fields={form.fields}
                        draft={draft}
                        shown={shown}
                        onChange={(key, next) => {
                          setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] || draft), [key]: next } }));
                        }}
                        onToggle={(key) => setShown((current) => ({ ...current, [key]: !current[key] }))}
                      />
                    ) : form.fields.map((field) => {
                      const value = draft[field.key] ?? (field.input === "password" || field.input === "json" ? "" : field.value);
                      const secret = field.input === "password" || field.input === "json";
                      return (
                        <label key={field.key} className="block text-sm">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span>{field.label}</span>
                            <span className="text-xs text-gold">{fieldStatus(field)}</span>
                          </span>
                          {field.input === "select" ? (
                            <select
                              className="mt-2 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none"
                              value={value}
                              onChange={(event) => {
                                const next = event.target.value;
                                setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] || draft), [field.key]: next } }));
                              }}
                            >
                              <option value="">Keep the in-app camera</option>
                              <option value="cloudflare-realtimekit">Cloudflare RealtimeKit</option>
                            </select>
                          ) : field.input === "json" ? (
                            <textarea
                              className="mt-2 min-h-28 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 font-mono text-xs outline-none"
                              value={value}
                              spellCheck={false}
                              autoComplete="off"
                              placeholder={field.mask ? "Leave blank to keep the saved value" : "Paste the service account JSON"}
                              onChange={(event) => {
                                const next = event.target.value;
                                setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] || draft), [field.key]: next } }));
                              }}
                            />
                          ) : (
                            <span className="mt-2 flex gap-2">
                              <input
                                className="min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none"
                                type={field.input === "password" && !shown[field.key] ? "password" : "text"}
                                value={value}
                                autoComplete="off"
                                spellCheck={false}
                                placeholder={secret && field.mask ? "Leave blank to keep the saved value" : ""}
                                onChange={(event) => {
                                const next = event.target.value;
                                setDrafts((current) => ({ ...current, [item.id]: { ...(current[item.id] || draft), [field.key]: next } }));
                              }}
                              />
                              {field.input === "password" ? (
                                <button type="button" className="min-h-11 shrink-0 rounded-full border border-on-photo/20 px-3 text-xs" onClick={() => setShown((current) => ({ ...current, [field.key]: !current[field.key] }))}>
                                  {shown[field.key] ? "Hide" : "Show"}
                                </button>
                              ) : null}
                            </span>
                          )}
                          {field.hint ? <span className="mt-1 block text-xs text-on-photo/60">{field.hint}</span> : null}
                          {field.locked ? <span className="mt-1 block text-xs text-on-photo/60">A server value is in use. A typed value is stored and overrides it. Leave this blank to keep the server value.</span> : null}
                          {field.mask ? <span className="mt-1 block text-xs text-on-photo/60">{field.mask}</span> : null}
                        </label>
                      );
                    })}
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className="min-h-11 justify-self-start rounded-full bg-maroon px-4 text-sm text-on-photo" disabled={busy === `save:${item.id}`}>
                        {busy === `save:${item.id}` ? "Saving…" : "Save configuration"}
                      </button>
                      {item.id === "r2" ? (
                        <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => cancelEdit(item.id)}>
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <DeveloperCdn token={token} />
      <DeveloperGateway token={token} />

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Activation</h2>
        <p className="mt-2 text-sm text-on-photo/75">Each switch is saved only after you confirm it, and only after that service has passed a server test. Turning one on does not change Home, Chat, Live, or Albums.</p>
        <ul className="mt-4 grid gap-3">
          {board.flags.map((flag) => (
            <li key={flag.id} className="rounded-card border border-on-photo/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base">{flag.label}</h3>
                  <p className="mt-1 text-sm text-on-photo/70">{flag.enabled ? "Switch on" : "Switch off"}{flag.active ? " · currently allowed" : " · not active"}</p>
                </div>
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo"
                  onClick={() => {
                    setPending({ id: flag.id, enable: !flag.enabled, label: flag.label });
                    setPhrase("");
                    setError("");
                  }}
                >
                  {flag.enabled ? "Turn off" : "Arm"}
                </button>
              </div>
              <p className="mt-2 text-sm text-on-photo/70">{flag.note}</p>
            </li>
          ))}
        </ul>
        {pending ? (
          <form onSubmit={(event) => void saveFlag(event)} className="mt-4 rounded-card border border-gold/40 p-4">
            <h3 className="font-serif text-xl">{pending.enable ? "Confirm activation" : "Confirm turning this off"}</h3>
            <p className="mt-2 text-sm text-on-photo/80">
              {pending.label}. {pending.enable ? "This does not create a paid resource, publish the app, or move wedding data." : "Existing wedding screens stay as they are."}
            </p>
            {needsPhrase ? (
              <label className="mt-3 block text-sm">
                Type {pending.id === "productionMode" ? PRODUCTION_PHRASE : MIGRATION_PHRASE}
                <input className="mt-2 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 outline-none" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
              </label>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="submit" className="min-h-11 rounded-full bg-maroon px-4 text-sm" disabled={busy === pending.id}>
                {busy === pending.id ? "Saving…" : "Confirm"}
              </button>
              <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Google Play catalogue</h2>
        <p className="mt-2 text-sm text-on-photo/75">{board.packaging}</p>
        <ul className="mt-4 grid gap-2 text-sm">
          {board.catalog.map((item) => (
            <li key={item.slot} className="rounded-2xl border border-on-photo/15 px-4 py-3">
              {item.title} · {item.kind === "subscription" ? "Subscription" : "One-time"} · {item.productIdSet ? "Product id is set on the server" : "Product id is not set. No price is shown because none was created."}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
