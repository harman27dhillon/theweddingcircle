import { useEffect, useState } from "react";
import { developerAffiliateBoard, developerSaveAffiliate, developerTestAffiliate } from "@/lib/wedding/affiliate.functions";

type Board = Awaited<ReturnType<typeof developerAffiliateBoard>>;
type Service = Extract<Board, { ok: true }>["services"][number];

export function AffiliateCredentials({ token }: { token: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [note, setNote] = useState("");

  async function reload() {
    setBoard(await developerAffiliateBoard({ data: { token } }));
  }

  useEffect(() => {
    void reload();
  }, [token]);

  if (!board) return <p className="text-sm text-on-photo/70">Loading affiliate credentials…</p>;
  if (!board.ok) return <p className="text-sm">{board.error}</p>;

  return (
    <section className="rounded-2xl border border-on-photo/10 p-4">
      <h2 className="font-serif text-2xl">Affiliate and API credentials</h2>
      <p className="mt-2 max-w-3xl text-sm text-on-photo/70">
        Amazon credentials are used only by Amazon India Bridal Trends. Flipkart credentials are used only by Flipkart Bridal Trends. A Meesho token is held for Meesho Bridal Trends and is not used unless an authorized catalog API exists. Bridal Dress Research and Bridal Jewellery Research keep their own sources. Saving does not turn a bot on.
      </p>
      {board.vault === "environment" ? (
        <p className="mt-3 text-sm text-gold">This deployment reads secrets from server environment variables. A save from this page is refused unless the server has a vault key. Typed values are not stored in this browser.</p>
      ) : (
        <p className="mt-3 text-sm text-on-photo/70">Saved secrets stay on the server. This page only shows whether each service is configured.</p>
      )}
      {note ? <p className="mt-3 text-sm">{note}</p> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {board.services.map((service) => (
          <ServiceCard key={service.id} token={token} service={service} onDone={(message) => { setNote(message); void reload(); }} />
        ))}
      </div>
    </section>
  );
}

function ServiceCard({ token, service, onDone }: { token: string; service: Service; onDone: (message: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState("");

  async function save() {
    setBusy("save");
    try {
      const result = await developerSaveAffiliate({ data: { token, service: service.id, fields: values, confirm } });
      if (!result.ok) onDone(result.error);
      else {
        if (result.saved) {
          setValues({});
          setConfirm(false);
        }
        onDone(result.message);
      }
    } catch {
      onDone("Those credentials could not be submitted.");
    } finally {
      setBusy("");
    }
  }

  async function test() {
    setBusy("test");
    try {
      const result = await developerTestAffiliate({ data: { token, service: service.id } });
      onDone(result.ok ? result.message : result.error);
    } catch {
      onDone("The connection test could not be completed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <article className="rounded-2xl border border-on-photo/10 p-4">
      <h3 className="font-serif text-xl">{service.title}</h3>
      <p className="mt-1 text-sm text-on-photo/70">{service.api}</p>
      <p className="mt-2 text-sm">Status · {service.label}</p>
      <p className="mt-2 text-sm text-on-photo/70">{service.guidance}</p>
      <p className="mt-2 text-sm text-on-photo/60">Used by {service.bot} only.</p>
      {service.fields.map((field) => (
        <label key={field.id} className="mt-3 block text-sm">
          {field.label}
          <span className="mt-1 flex gap-2">
            <input
              className="min-h-11 w-full rounded-2xl border border-on-photo/20 bg-ink px-3"
              type={field.secret && !shown[field.id] ? "password" : "text"}
              autoComplete="off"
              value={values[field.id] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
            />
            {field.secret ? (
              <button type="button" className="min-h-11 shrink-0 rounded-full border border-on-photo/20 px-3" onClick={() => setShown((current) => ({ ...current, [field.id]: !current[field.id] }))}>
                {shown[field.id] ? "Hide" : "Show"}
              </button>
            ) : null}
          </span>
          <span className="mt-1 block text-xs text-on-photo/50">Server variable {field.env}</span>
        </label>
      ))}
      <label className="mt-3 flex min-h-11 items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} />
        Save these credentials on the server. Do not enable the bot.
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="min-h-11 rounded-full bg-maroon px-4 text-sm" disabled={busy !== ""} onClick={() => void save()}>
          {busy === "save" ? "Saving…" : "Save credentials"}
        </button>
        <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm" disabled={busy !== ""} onClick={() => void test()}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
      </div>
    </article>
  );
}
