import { useEffect, useState } from "react";
import {
  developerApplyCloud,
  developerCloudBoard,
  developerDisconnectCloud,
  developerRequestCloud,
  developerSaveCloud,
  developerTestCloud,
} from "@/lib/developer/cloud.functions";
import { displayText } from "@/lib/infra/display";
import { CoreMigration } from "@/components/wedding/core-migration";

type Board = Awaited<ReturnType<typeof developerCloudBoard>>;
type Ready = Extract<Board, { ok: true }>;
type Provider = Ready["providers"][number];
type Service = Ready["services"][number];

export function CloudConnections({ token }: { token: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [note, setNote] = useState("");

  async function reload() {
    try {
      setBoard(await developerCloudBoard({ data: { token } }));
    } catch {
      setBoard({ ok: false, error: "Cloud connections could not be loaded." });
    }
  }

  useEffect(() => {
    void reload();
  }, [token]);

  if (!board) return <p className="text-sm text-on-photo/70">Loading cloud connections…</p>;
  if (!board.ok) return <p className="text-sm">{board.error}</p>;

  return (
    <section className="max-w-6xl">
      <h1 className="font-serif text-4xl">Cloud connections</h1>
      <p className="mt-2 max-w-3xl text-sm text-on-photo/70">{board.note}</p>
      <p className="mt-3 text-sm">Database in use · {board.databaseLabel}</p>
      {note ? <p className="mt-3 text-sm text-gold">{note}</p> : null}
      <fieldset disabled={!board.persisted} className="min-w-0">
      <div className="mt-6 grid gap-4">
        {(board.persisted ? board.services : []).map((service) => (
          <ServiceCard key={service.id} token={token} service={service} onDone={(message) => { setNote(message); void reload(); }} />
        ))}
      </div>
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {/* Firebase web config, service account, and connection tests stay on Infrastructure. This screen must not offer a second save or test. */}
        {board.providers.filter((provider) => provider.id !== "firebase").map((provider) => (
          <ProviderCard key={provider.id} token={token} provider={provider} onDone={(message) => { setNote(message); void reload(); }} />
        ))}
      </div>
      </fieldset>
      <CoreMigration token={token} />
    </section>
  );
}

function ServiceCard({ token, service, onDone }: { token: string; service: Service; onDone: (message: string) => void }) {
  const [choice, setChoice] = useState(service.choices[0]?.id || "");
  const [confirm, setConfirm] = useState(false);
  const [applyConfirm, setApplyConfirm] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const result = await developerRequestCloud({ data: { token, service: service.id, choice, confirm } });
      onDone(result.ok ? displayText(result.message) || "Saved." : displayText(result.error) || "That request could not be saved.");
      if (result.ok) setConfirm(false);
    } catch {
      onDone("That request could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    try {
      const result = await developerApplyCloud({ data: { token, service: service.id, choice, confirm: applyConfirm, consent } });
      onDone(result.ok ? displayText(result.message) || "Applied." : displayText(result.error) || "That change could not be applied.");
      if (result.ok) {
        setApplyConfirm(false);
        setConsent(false);
      }
    } catch {
      onDone("That change could not be applied. The current provider stays active.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-on-photo/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-serif text-2xl">{service.label}</h2>
        <p className="text-sm text-gold">Active · {service.active}</p>
      </div>
      <p className="mt-2 text-sm text-on-photo/70">{service.detail}</p>
      {service.requested && service.requested.choice !== "current" && service.requested.choice !== "off" ? (
        <p className="mt-2 text-sm">Requested, not active · {service.requested.choice.replaceAll("_", " ")}. {service.requested.note}</p>
      ) : null}
      {service.locked ? <p className="mt-3 text-sm">This assignment cannot be changed here.</p> : null}
      {!service.locked && service.choices.length > 0 ? (
        <>
        <form
          className="mt-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2">
            {service.choices.map((item) => (
              <label key={item.id} className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  type="radio"
                  name={service.id}
                  className="mt-1"
                  checked={choice === item.id}
                  disabled={!item.allowed}
                  onChange={() => setChoice(item.id)}
                />
                <span>
                  {item.label}
                  {!item.allowed && item.reason ? <span className="mt-1 block text-on-photo/60">{item.reason}</span> : null}
                </span>
              </label>
            ))}
          </div>
          {service.id === "media" ? (
            <p className="mt-3 text-sm text-gold">Existing files stay where they are. This does not copy, delete, or rewrite wedding media URLs.</p>
          ) : null}
          <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
            Save this as a request only. Do not switch the live service yet.
          </label>
          <button type="submit" disabled={busy || !confirm} className="mt-3 min-h-11 rounded-full border border-on-photo/20 px-4 text-sm">
            {busy ? "Saving…" : "Save request"}
          </button>
        </form>
        <div className="mt-4 border-t border-on-photo/10 pt-4">
          {service.id === "analytics" ? (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              Visitors must agree before any analytics event is sent.
            </label>
          ) : null}
          <label className="mt-2 flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={applyConfirm} onChange={(event) => setApplyConfirm(event.target.checked)} />
            Apply the selected choice. Existing wedding records and files stay where they are.
          </label>
          <button type="button" disabled={busy || !applyConfirm} className="mt-3 min-h-11 rounded-full bg-maroon px-4 text-sm" onClick={() => void apply()}>
            {busy ? "Working…" : "Apply"}
          </button>
        </div>
        </>
      ) : null}
    </article>
  );
}

function ProviderCard({ token, provider, onDone }: { token: string; provider: Provider; onDone: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [disconnect, setDisconnect] = useState(false);
  const [busy, setBusy] = useState("");
  const saved = provider.fields.some((field) => field.source === "saved");

  async function save() {
    setBusy("save");
    try {
      const result = await developerSaveCloud({ data: { token, provider: provider.id, fields: values, confirm, confirmReplace } });
      if (!result.ok) onDone(displayText(result.error) || "That configuration could not be saved.");
      else {
        if (result.saved) {
          setValues({});
          setConfirm(false);
          setConfirmReplace(false);
        }
        onDone(displayText(result.message) || "Configuration saved.");
      }
    } catch {
      onDone("That configuration could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function test(capability: string) {
    setBusy(capability);
    try {
      const result = await developerTestCloud({ data: { token, provider: provider.id, capability } });
      onDone(result.ok ? displayText(result.detail) || "The connection check finished." : displayText(result.error) || "The connection check failed.");
    } catch {
      onDone("The connection test could not be completed.");
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("disconnect");
    try {
      const result = await developerDisconnectCloud({ data: { token, provider: provider.id, confirm: disconnect } });
      if (result.ok) setDisconnect(false);
      onDone(result.ok ? displayText(result.message) || "Disconnected." : displayText(result.error) || "That connection could not be disconnected.");
    } catch {
      onDone("That connection could not be disconnected.");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="rounded-2xl border border-on-photo/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-serif text-2xl">{provider.title}</h2>
        <p className="text-sm text-gold">{provider.label}</p>
      </div>
      <p className="mt-2 text-sm text-on-photo/70">{provider.guidance}</p>
      <p className="mt-2 text-sm text-on-photo/70">{provider.secretNote}</p>
      <p className="mt-2 text-sm">Configured · {provider.configured ? "Yes" : "No"} · Connection tested · {provider.tested ? "Yes" : "No"} · Active for wedding data · No</p>
      {displayText(provider.lastTest) ? <p className="mt-1 text-sm text-on-photo/60">Last successful project test · {displayText(provider.lastTest)}</p> : null}
      <form
        className="mt-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {provider.fields.map((field) => (
          <label key={field.id} className="mt-3 block text-sm">
            {field.label}
            {field.present ? <span className="mt-1 block text-on-photo/60">{field.source === "environment" ? "From server environment" : "Saved on server"} · {field.hint}</span> : null}
            <span className="mt-1 flex gap-2">
              <input
                className="min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3"
                type={field.secret && !shown[field.id] ? "password" : "text"}
                autoComplete="off"
                spellCheck={false}
                value={values[field.id] ?? ""}
                placeholder={field.present ? "Enter a replacement" : "Not set"}
                onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
              />
              {field.secret ? (
                <button type="button" className="min-h-11 shrink-0 rounded-full border border-on-photo/20 px-3" onClick={() => setShown((current) => ({ ...current, [field.id]: !current[field.id] }))}>
                  {shown[field.id] ? "Hide" : "Show"}
                </button>
              ) : null}
            </span>
          </label>
        ))}
        <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
          Save these public values on the server. Do not type a service-role or private key.
        </label>
        {saved ? (
          <label className="mt-2 flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={confirmReplace} onChange={(event) => setConfirmReplace(event.target.checked)} />
            Replace the saved public configuration.
          </label>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={busy !== "" || provider.envLocked} className="min-h-11 rounded-full bg-maroon px-4 text-sm">
            {busy === "save" ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm"
            onClick={() => {
              setValues({});
              setConfirm(false);
              setConfirmReplace(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
      <div className="mt-4 grid gap-2">
        {provider.capabilities.map((item) => (
          <div key={item.id} className="rounded-2xl border border-on-photo/10 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>{item.label} · {labelFor(item.state)}</p>
              <button type="button" disabled={busy !== ""} className="min-h-11 rounded-full border border-on-photo/20 px-3" onClick={() => void test(item.id)}>
                {busy === item.id ? "Testing…" : "Test"}
              </button>
            </div>
            {displayText(item.detail) ? <p className="mt-2 text-on-photo/70">{displayText(item.detail)}</p> : null}
            {displayText(item.checkedAt) ? <p className="mt-1 text-on-photo/50">Checked {displayText(item.checkedAt)}</p> : null}
            {item.checks ? (
              <ul className="mt-2 list-disc pl-5 text-on-photo/70">
                {item.checks.map((check) => (
                  <li key={check.id}>{check.ok ? "Met" : "Not met"} · {check.label}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-on-photo/10 pt-4">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" checked={disconnect} onChange={(event) => setDisconnect(event.target.checked)} />
          Disconnect the saved public configuration. This does not delete weddings or files.
        </label>
        <button type="button" disabled={busy !== "" || !disconnect} className="mt-3 min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" onClick={() => void remove()}>
          {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </article>
  );
}

function labelFor(state: string) {
  if (state === "connected") return "Connected";
  if (state === "needs_setup") return "Needs setup";
  if (state === "error") return "Error";
  return "Not configured";
}
