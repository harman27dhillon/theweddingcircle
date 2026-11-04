import { Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  developerAnalyze,
  developerAnnouncement,
  developerAudit,
  developerBuild,
  developerConnections,
  developerDatabase,
  developerDiagnose,
  developerErrors,
  developerFlag,
  developerLock,
  developerOverview,
  developerProposals,
  developerPictures,
  developerRemovePicture,
  developerSuspendWedding,
  developerSaveCardDisplay,
  developerUnlock,
  developerUploadPicture,
  developerUsers,
  developerWeddings,
} from "@/lib/developer/console.functions";
import { MediaLibraryPanel } from "@/components/wedding/developer-library";
import { DeveloperMusicPanel } from "@/components/wedding/developer-music";
import { DiscoverBotsPanel } from "@/components/wedding/discover-bots";
import { DeveloperInfrastructure } from "@/components/wedding/developer-infrastructure";
import { DeveloperVouchers } from "@/components/wedding/developer-vouchers";
import { DeveloperBackgrounds } from "@/components/wedding/developer-backgrounds";
import { CloudConnections } from "@/components/wedding/cloud-connections";
import { DataManager } from "@/components/wedding/data-manager";
import { forgetDeveloperToken, rememberDeveloperToken, developerToken } from "@/lib/developer/runtime";
import { CARD_RATIO_PRESETS, cardRatioChoice, resolveCardRatio } from "@/lib/wedding/card-ratio";
import { invalidateLibrary } from "@/lib/wedding/library";
import { useWeddingStore } from "@/lib/wedding/store";
import { usePersistedReady } from "@/lib/wedding/use-circle";
import { resolveMediaUrl } from "@/lib/wedding/media-db";
import { PHOTO_ACCEPT } from "@/lib/wedding/media";

const SECTIONS = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["weddings", "Weddings"],
  ["pictures", "Pictures"],
  ["library", "Media library"],
  ["music", "Background music"],
  ["discover", "Discover bots"],
  ["features", "Features"],
  ["cards", "Wedding card display"],
  ["database", "Database"],
  ["autosync", "Database & AutoSync"],
  ["cloud", "Cloud connections"],
  ["infrastructure", "Infrastructure"],
  ["vouchers", "Wedding vouchers"],
  ["backgrounds", "Appearance & backgrounds"],
  ["errors", "Errors"],
  ["logs", "Logs"],
  ["github", "GitHub"],
  ["deploy", "Deployments"],
  ["settings", "Settings"],
] as const;

type Section = (typeof SECTIONS)[number][0];
type Overview = Awaited<ReturnType<typeof developerOverview>>;

const FLAGS = [
  ["photoUploads", "Photo uploads"],
  ["weddingCountdown", "Wedding countdown"],
  ["premiumThemes", "Premium themes"],
] as const;

export function DeveloperCenter() {
  const account = useWeddingStore((s) => s.account);
  const hydrated = usePersistedReady();
  const [section, setSection] = useState<Section>("overview");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [gateError, setGateError] = useState("");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Extract<Overview, { ok: true }> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = developerToken();
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (!token) return;
    void developerOverview({ data: { token } }).then((result) => {
      if (result.ok) setOverview(result);
      else {
        forgetDeveloperToken();
        setToken("");
      }
    });
  }, [token, section]);

  if (!hydrated) return <main className="min-h-dvh bg-ink" />;

  async function unlock(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setGateError("");
    try {
      const result = await developerUnlock({ data: { email: email.trim().toLowerCase(), password } });
      if (!result.ok) {
        setGateError(result.error);
        return;
      }
      rememberDeveloperToken(result.token);
      setToken(result.token);
      setPassword("");
    } catch {
      setGateError("The developer center could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-dvh bg-ink px-4 py-10 text-on-photo">
        <form onSubmit={(event) => void unlock(event)} className="mx-auto w-full max-w-md rounded-card border border-on-photo/15 bg-ink p-6">
          <p className="text-sm text-gold">Developer Center</p>
          <h1 className="mt-2 font-serif text-4xl">Developer sign-in</h1>
          <p className="mt-3 text-sm text-on-photo/70">This is separate from a wedding account. A normal sign-up does not become a developer.</p>
          <input
            className="mt-4 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 text-on-photo outline-none"
            type="email"
            autoComplete="username"
            placeholder="Developer email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            className="mt-3 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3 text-on-photo outline-none"
            type="password"
            autoComplete="current-password"
            placeholder="Developer password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {gateError ? <p className="mt-3 text-sm text-gold">{gateError}</p> : null}
          <button type="submit" disabled={busy} className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm text-on-photo">
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <div className="min-h-dvh bg-ink text-on-photo md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-on-photo/10 px-4 py-4 md:overflow-y-auto md:border-b-0 md:border-r md:py-6">
        <Link to="/account" className="text-sm text-gold">Profile</Link>
        <p className="mt-4 font-serif text-2xl">Developer Center</p>
        <label className="mt-4 block md:hidden">
          <span className="sr-only">Section</span>
          <select
            className="w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3"
            value={section}
            onChange={(event) => setSection(event.target.value as Section)}
          >
            {SECTIONS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <nav className="mt-4 hidden flex-col gap-1 md:flex">
          {SECTIONS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={section === id ? "min-h-11 rounded-2xl bg-maroon px-3 text-left text-sm" : "min-h-11 rounded-2xl px-3 text-left text-sm text-on-photo/75"}
              onClick={() => setSection(id)}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="px-4 py-6 md:px-8">
        {section === "overview" ? <OverviewPanel overview={overview} diagnosis={message} onDiagnose={() => void diagnose()} busy={busy} /> : null}
        {section === "users" ? <UsersPanel token={token} /> : null}
        {section === "weddings" ? <WeddingsPanel token={token} /> : null}
        {section === "pictures" ? <PicturesPanel token={token} /> : null}
        {section === "library" ? <MediaLibraryPanel token={token} /> : null}
        {section === "music" ? <DeveloperMusicPanel token={token} /> : null}
        {section === "discover" ? <DiscoverBotsPanel token={token} /> : null}
        {section === "features" ? <FeaturesPanel token={token} flags={overview?.runtime.flags} announcement={overview?.runtime.announcement || ""} fee={overview?.runtime.feeLabel || "₹499"} onChanged={() => void refresh()} /> : null}
        {section === "cards" ? <CardDisplayPanel token={token} cards={overview?.runtime.cards} onChanged={() => void refresh()} /> : null}
        {section === "database" ? <DatabasePanel token={token} /> : null}
        {section === "autosync" ? <DataManager token={token} /> : null}
        {section === "cloud" ? <CloudConnections token={token} /> : null}
        {section === "infrastructure" ? <DeveloperInfrastructure token={token} /> : null}
        {section === "vouchers" ? <DeveloperVouchers token={token} /> : null}
        {section === "backgrounds" ? <DeveloperBackgrounds token={token} /> : null}
        {section === "errors" ? <ErrorsPanel token={token} /> : null}
        {section === "logs" ? <LogsPanel token={token} /> : null}
        {section === "github" ? <GithubPanel /> : null}
        {section === "deploy" ? <DeployPanel token={token} /> : null}
        {section === "settings" ? <SettingsPanel email={overview?.email || account?.email || ""} onLock={() => void lock()} /> : null}
      </main>
    </div>
  );

  async function refresh() {
    const result = await developerOverview({ data: { token } });
    if (result.ok) setOverview(result);
  }

  async function diagnose() {
    setBusy(true);
    setMessage("");
    try {
      const result = await developerDiagnose({ data: { token } });
      if (!result.ok) setMessage(result.error);
      else setMessage(result.analysis);
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await developerLock({ data: { token } });
    forgetDeveloperToken();
    setToken("");
    setOverview(null);
  }
}

function OverviewPanel({ overview, diagnosis, onDiagnose, busy }: { overview: Extract<Overview, { ok: true }> | null; diagnosis: string; onDiagnose: () => void; busy: boolean }) {
  if (!overview) return <p className="text-sm text-on-photo/70">Loading the live status…</p>;
  const cards = [
    ["Version", overview.application.version],
    ["Environment", overview.application.environment],
    ["Status", overview.application.status],
    ["Git commit", overview.application.commit],
    ["Published weddings", String(overview.usage.publishedWeddings)],
    ["Older Drive links", String(overview.usage.googleConnections)],
    ["Media items", String(overview.usage.storedMediaItems)],
    ["Database", formatBytes(overview.usage.databaseBytes)],
  ];
  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-4xl">Overview</h1>
          <p className="mt-2 text-sm text-on-photo/70">{overview.application.workspace}</p>
        </div>
        <button type="button" disabled={busy} onClick={onDiagnose} className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm">
          {busy ? "Diagnosing…" : "Diagnose application"}
        </button>
      </div>
      {diagnosis ? <pre className="mt-4 whitespace-pre-wrap text-sm text-on-photo/80">{diagnosis}</pre> : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <article key={label} className="rounded-card border border-on-photo/10 px-4 py-4">
            <p className="text-xs text-on-photo/60">{label}</p>
            <p className="mt-2 text-lg">{value}</p>
          </article>
        ))}
      </div>
      <p className="mt-4 text-sm text-on-photo/70">{overview.usage.profiles}</p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <article className="rounded-card border border-on-photo/10 p-4">
          <h2 className="font-serif text-2xl">System</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li>API · {overview.system.api}</li>
            <li>Database · {overview.system.database}</li>
            <li>Authentication · {overview.system.authentication}</li>
            <li>OpenAI · {overview.system.ai}</li>
            <li>GitHub · {overview.system.github}</li>
            <li>Deployment · {overview.system.deploy}</li>
          </ul>
        </article>
        <article className="rounded-card border border-on-photo/10 p-4">
          <h2 className="font-serif text-2xl">Recent activity</h2>
          <ul className="mt-3 space-y-3 text-sm">
            {overview.activity.length === 0 ? <li className="text-on-photo/60">No developer commands yet.</li> : null}
            {overview.activity.map((item, index) => (
              <li key={`${item.created_at}-${index}`}>
                <span className="text-gold">{item.level}</span> · {item.result}
                <span className="mt-1 block text-on-photo/80">{item.command}</span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}

function UsersPanel({ token }: { token: string }) {
  const [body, setBody] = useState<Awaited<ReturnType<typeof developerUsers>> | null>(null);
  useEffect(() => {
    void developerUsers({ data: { token } }).then(setBody);
  }, [token]);
  if (!body) return <p>Loading accounts…</p>;
  if (!body.ok) return <p>{body.error}</p>;
  return (
    <section>
      <h1 className="font-serif text-4xl">Users</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">{body.note}</p>
      <ul className="mt-4 divide-y divide-on-photo/10 rounded-card border border-on-photo/10">
        {body.connections.length === 0 ? <li className="px-4 py-3 text-sm">No older Drive connection is stored. New wedding files do not use Google Drive.</li> : null}
        {body.connections.map((item) => (
          <li key={item.email} className="px-4 py-3 text-sm">
            <span className="block">{item.name || "Unnamed"}</span>
            <span className="text-on-photo/70">{item.email}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WeddingsPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof developerWeddings>> | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState("");
  useEffect(() => {
    void developerWeddings({ data: { token } }).then(setRows);
  }, [token]);
  if (!rows) return <p>Loading weddings…</p>;
  if (!rows.ok) return <p>{rows.error}</p>;
  return (
    <section>
      <h1 className="font-serif text-4xl">Weddings</h1>
      <p className="mt-2 text-sm text-on-photo/70">Published circles only. Saved photos are under Pictures.</p>
      {note ? <p className="mt-3 text-sm text-gold">{note}</p> : null}
      <ul className="mt-4 flex flex-col gap-3">
        {rows.weddings.length === 0 ? <li className="text-sm">No wedding has been published to the server.</li> : null}
        {rows.weddings.map((wedding) => (
          <li key={wedding.slug} className="rounded-card border border-on-photo/10 p-4 text-sm">
            <p className="font-serif text-2xl">{wedding.bride} & {wedding.groom}</p>
            <p className="mt-1 text-on-photo/70">{wedding.slug} · {wedding.city} · {wedding.date || "No date"} · {wedding.guests} guests · {wedding.posts} posts · {wedding.disabled ? "Paused" : "Open"}</p>
            {pending === wedding.slug ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="min-h-11 rounded-full bg-maroon px-4"
                  onClick={() => {
                    void developerSuspendWedding({ data: { token, slug: wedding.slug, paused: !wedding.disabled, confirm: true } }).then((result) => {
                      if (!result.ok) setNote(result.error);
                      else {
                        setNote(wedding.disabled ? "The wedding is open again." : "The wedding is paused.");
                        setPending("");
                        void developerWeddings({ data: { token } }).then(setRows);
                      }
                    });
                  }}
                >
                  {wedding.disabled ? "Confirm open" : "Confirm pause"}
                </button>
                <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => setPending("")}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="mt-3 min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => setPending(wedding.slug)}>
                {wedding.disabled ? "Open wedding" : "Pause wedding"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function fileToPicture(file: File) {
  return new Promise<{ mime: string; data: string }>((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const pen = canvas.getContext("2d");
      if (!pen) {
        URL.revokeObjectURL(url);
        reject(new Error("picture"));
        return;
      }
      pen.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      let data = "";
      for (let quality = 0.82; quality >= 0.5; quality -= 0.12) {
        data = (canvas.toDataURL("image/jpeg", quality).split(",")[1] || "");
        if (data.length <= 900_000) break;
      }
      if (data.length < 32 || data.length > 900_000) reject(new Error("size"));
      else resolve({ mime: "image/jpeg", data });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("picture"));
    };
    image.src = url;
  });
}

function StoredPicture({ src, label }: { src: string; label: string }) {
  const [href, setHref] = useState("");
  useEffect(() => {
    let live = true;
    void resolveMediaUrl(src).then((next) => {
      if (live) setHref(next);
    });
    return () => {
      live = false;
    };
  }, [src]);
  if (!href) return <p className="mt-2 text-xs text-on-photo/50">{label} is stored, but the preview is not ready.</p>;
  return <img src={href} alt={label} className="mt-3 h-36 w-full rounded-2xl object-cover" />;
}

function PicturesPanel({ token }: { token: string }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof developerPictures>> | null>(null);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => {
    void developerPictures({ data: { token } }).then(setRows);
  };
  useEffect(() => {
    load();
  }, [token]);
  if (!rows) return <p>Loading saved pictures…</p>;
  if (!rows.ok) return <p>{rows.error}</p>;
  return (
    <section>
      <h1 className="font-serif text-4xl">Pictures</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">{rows.note}</p>
      {note ? <p className="mt-3 text-sm text-gold">{note}</p> : null}
      <ul className="mt-4 flex flex-col gap-4">
        {rows.weddings.length === 0 ? <li className="text-sm">No published wedding is stored on the server.</li> : null}
        {rows.weddings.map((wedding) => (
          <li key={wedding.slug} className="rounded-card border border-on-photo/10 p-4 text-sm">
            <p className="font-serif text-2xl">{wedding.bride} & {wedding.groom}</p>
            <p className="mt-1 text-on-photo/70">{wedding.slug}</p>
            {wedding.cover ? <StoredPicture src={wedding.cover} label={`${wedding.bride} and ${wedding.groom} cover`} /> : <p className="mt-2 text-on-photo/70">No cover is set.</p>}
            <label className="mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-full bg-maroon px-4">
              {busy === wedding.slug ? "Saving cover…" : "Upload cover"}
              <input
                type="file"
                accept={PHOTO_ACCEPT}
                className="sr-only"
                disabled={Boolean(busy)}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setBusy(wedding.slug);
                  setNote("");
                  void fileToPicture(file)
                    .then((picture) => developerUploadPicture({ data: { token, slug: wedding.slug, ...picture } }))
                    .then((result) => {
                      if (!result.ok) setNote(result.error);
                      else {
                        setNote("The cover is saved for this wedding.");
                        load();
                      }
                    })
                    .catch(() => setNote("That picture could not be prepared. Use a smaller JPEG, PNG or WebP."))
                    .finally(() => setBusy(""));
                }}
              />
            </label>
            <ul className="mt-4 flex flex-col gap-2">
              {wedding.files.length === 0 ? <li className="text-on-photo/70">No picture file is stored for this wedding yet.</li> : null}
              {wedding.files.map((file) => {
                const key = `${wedding.slug}:${file.id}`;
                return (
                  <li key={file.id} className="rounded-2xl border border-on-photo/10 px-3 py-3">
                    <p className="break-all">{file.mime} · {file.used ? file.where.join(", ") || "In use" : "Saved, not currently used"}</p>
                    {file.mime.startsWith("image/") ? <StoredPicture src={`idb:${file.id}`} label={file.where[0] || "Saved picture"} /> : null}
                    <p className="mt-1 text-xs text-on-photo/55">{file.id}</p>
                    {pending === key ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="min-h-11 rounded-full bg-maroon px-4"
                          onClick={() => {
                            setBusy(key);
                            void developerRemovePicture({ data: { token, slug: wedding.slug, id: file.id, confirm: true } }).then((result) => {
                              setBusy("");
                              if (!result.ok) setNote(result.error);
                              else {
                                setNote("The picture was deleted from the server.");
                                setPending("");
                                load();
                              }
                            });
                          }}
                        >
                          {busy === key ? "Deleting…" : "Confirm delete"}
                        </button>
                        <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => setPending("")}>Cancel</button>
                      </div>
                    ) : (
                      <button type="button" className="mt-3 min-h-11 rounded-full border border-on-photo/20 px-4" onClick={() => setPending(key)}>
                        Delete picture
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CardDisplayPanel({
  token,
  cards,
  onChanged,
}: {
  token: string;
  cards?: { landing: string; landingDesktop?: string; pinned: string; pinnedFull: boolean; pinnedBar?: string };
  onChanged: () => void;
}) {
  const saved = {
    landing: cards?.landing ?? "original",
    landingDesktop: cards?.landingDesktop || "original",
    pinned: cards?.pinned ?? "original",
    pinnedFull: cards?.pinnedFull ?? false,
    pinnedBar: cards?.pinnedBar || "original",
  };
  const [landingChoice, setLandingChoice] = useState(choiceOf(saved.landing));
  const [desktopChoice, setDesktopChoice] = useState(choiceOf(saved.landingDesktop));
  const [pinnedChoice, setPinnedChoice] = useState(choiceOf(saved.pinned));
  const [barChoice, setBarChoice] = useState(choiceOf(saved.pinnedBar));
  const [landingCustom, setLandingCustom] = useState(partsOf(saved.landing));
  const [desktopCustom, setDesktopCustom] = useState(partsOf(saved.landingDesktop));
  const [pinnedCustom, setPinnedCustom] = useState(partsOf(saved.pinned));
  const [barCustom, setBarCustom] = useState(partsOf(saved.pinnedBar));
  const [full, setFull] = useState(saved.pinnedFull);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<"landing" | "desktop" | "pinned" | "bar" | "">("");

  useEffect(() => {
    if (!cards) return;
    const desktop = cards.landingDesktop || "original";
    setLandingChoice(choiceOf(cards.landing));
    setDesktopChoice(choiceOf(desktop));
    setPinnedChoice(choiceOf(cards.pinned));
    setBarChoice(choiceOf(cards.pinnedBar || "original"));
    setLandingCustom(partsOf(cards.landing));
    setDesktopCustom(partsOf(desktop));
    setPinnedCustom(partsOf(cards.pinned));
    setBarCustom(partsOf(cards.pinnedBar || "original"));
    setFull(cards.pinnedFull);
  }, [cards]);

  const landingPreview = resolveCardRatio(cardRatioChoice(landingChoice, Number(landingCustom.w), Number(landingCustom.h)) ?? "");
  const desktopPreview = resolveCardRatio(cardRatioChoice(desktopChoice, Number(desktopCustom.w), Number(desktopCustom.h)) ?? "");
  const pinnedPreview = resolveCardRatio(cardRatioChoice(pinnedChoice, Number(pinnedCustom.w), Number(pinnedCustom.h)) ?? "");
  const barPreview = resolveCardRatio(cardRatioChoice(barChoice, Number(barCustom.w), Number(barCustom.h)) ?? "");
  const landingInvalid = landingChoice === "custom" && !cardRatioChoice("custom", Number(landingCustom.w), Number(landingCustom.h));
  const desktopInvalid = desktopChoice === "custom" && !cardRatioChoice("custom", Number(desktopCustom.w), Number(desktopCustom.h));
  const pinnedInvalid = pinnedChoice === "custom" && !cardRatioChoice("custom", Number(pinnedCustom.w), Number(pinnedCustom.h));
  const barInvalid = barChoice === "custom" && !cardRatioChoice("custom", Number(barCustom.w), Number(barCustom.h));

  if (!cards) {
    return (
      <section>
        <h1 className="font-serif text-4xl">WEDDING CARD DISPLAY</h1>
        <p className="mt-2 text-sm text-on-photo/70">Loading the saved card display…</p>
      </section>
    );
  }

  async function saveLanding() {
    const landing = cardRatioChoice(landingChoice, Number(landingCustom.w), Number(landingCustom.h));
    if (!landing) {
      setNotice("");
      setError("Choose a supported ratio for the landing cards. A custom ratio has to stay between 9:20 and 12:5.");
      return;
    }
    setBusy("landing");
    setError("");
    setNotice("");
    try {
      const result = await developerSaveCardDisplay({
        data: { token, landing, landingDesktop: saved.landingDesktop, pinned: saved.pinned, pinnedFull: saved.pinnedFull, pinnedBar: saved.pinnedBar },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      invalidateLibrary();
      onChanged();
      setNotice("Mobile cards saved.");
    } catch {
      setError("The card display could not be saved. The previous settings are still in use.");
    } finally {
      setBusy("");
    }
  }

  async function saveDesktop() {
    const landingDesktop = cardRatioChoice(desktopChoice, Number(desktopCustom.w), Number(desktopCustom.h));
    if (!landingDesktop) {
      setNotice("");
      setError("Choose a supported ratio for desktop cards. A custom ratio has to stay between 9:20 and 12:5.");
      return;
    }
    setBusy("desktop");
    setError("");
    setNotice("");
    try {
      const result = await developerSaveCardDisplay({
        data: { token, landing: saved.landing, landingDesktop, pinned: saved.pinned, pinnedFull: saved.pinnedFull, pinnedBar: saved.pinnedBar },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      invalidateLibrary();
      onChanged();
      setNotice("Desktop cards saved.");
    } catch {
      setError("The card display could not be saved. The previous settings are still in use.");
    } finally {
      setBusy("");
    }
  }

  async function savePinned() {
    const pinned = cardRatioChoice(pinnedChoice, Number(pinnedCustom.w), Number(pinnedCustom.h));
    if (!pinned) {
      setNotice("");
      setError("Choose a supported ratio for the pinned card. A custom ratio has to stay between 9:20 and 12:5.");
      return;
    }
    setBusy("pinned");
    setError("");
    setNotice("");
    try {
      const result = await developerSaveCardDisplay({
        data: { token, landing: saved.landing, landingDesktop: saved.landingDesktop, pinned, pinnedFull: full, pinnedBar: saved.pinnedBar },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      invalidateLibrary();
      onChanged();
      setNotice("Pinned card saved.");
    } catch {
      setError("The card display could not be saved. The previous settings are still in use.");
    } finally {
      setBusy("");
    }
  }

  async function savePinnedBar() {
    const pinnedBar = cardRatioChoice(barChoice, Number(barCustom.w), Number(barCustom.h));
    if (!pinnedBar) {
      setNotice("");
      setError("Choose a supported ratio for the pinned wedding bar. A custom ratio has to stay between 9:20 and 12:5.");
      return;
    }
    setBusy("bar");
    setError("");
    setNotice("");
    try {
      const result = await developerSaveCardDisplay({
        data: { token, landing: saved.landing, landingDesktop: saved.landingDesktop, pinned: saved.pinned, pinnedFull: saved.pinnedFull, pinnedBar },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      invalidateLibrary();
      onChanged();
      setNotice("Pinned wedding bar saved.");
    } catch {
      setError("The card display could not be saved. The previous settings are still in use.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section>
      <h1 className="font-serif text-4xl">WEDDING CARD DISPLAY</h1>
      <p className="mt-2 max-w-xl text-sm text-on-photo/70">These settings change the shape of the cards. They do not change a wedding, a theme, or which wedding someone pinned.</p>
      {error ? <p className="mt-4 text-sm text-gold" role="alert">{error}</p> : null}
      {notice ? <p className="mt-4 text-sm text-gold" role="status">{notice}</p> : null}

      <div className="mt-8 max-w-xl rounded-3xl border border-on-photo/15 p-4">
        <h2 className="font-serif text-2xl">Mobile Wedding Bar Card Ratio</h2>
        <p className="mt-1 text-sm text-on-photo/70">Phone and small screens only. Desktop cards use their own setting.</p>
        <RatioChoices name="landing-ratio" value={landingChoice} onChange={setLandingChoice} />
        {landingChoice === "custom" ? <CustomRatio value={landingCustom} onChange={setLandingCustom} /> : null}
        <RatioPreview ratio={landingPreview} invalid={landingInvalid} />
        <button type="button" disabled={busy !== ""} className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm" onClick={() => void saveLanding()}>
          {busy === "landing" ? "Saving…" : "Save mobile cards"}
        </button>
      </div>

      <div className="mt-6 max-w-xl rounded-3xl border border-on-photo/15 p-4">
        <h2 className="font-serif text-2xl">Desktop Wedding Bar Card Ratio</h2>
        <p className="mt-1 text-sm text-on-photo/70">Wide screens only. Changing this does not change the phone cards.</p>
        <RatioChoices name="desktop-ratio" value={desktopChoice} onChange={setDesktopChoice} />
        {desktopChoice === "custom" ? <CustomRatio value={desktopCustom} onChange={setDesktopCustom} /> : null}
        <RatioPreview ratio={desktopPreview} invalid={desktopInvalid} />
        <button type="button" disabled={busy !== ""} className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm" onClick={() => void saveDesktop()}>
          {busy === "desktop" ? "Saving…" : "Save desktop cards"}
        </button>
      </div>

      <div className="mt-6 max-w-xl rounded-3xl border border-on-photo/15 p-4">
        <h2 className="font-serif text-2xl">Pinned wedding card</h2>
        <p className="mt-1 text-sm text-on-photo/70">Pinned Card Aspect Ratio</p>
        <RatioChoices name="pinned-ratio" value={pinnedChoice} onChange={setPinnedChoice} />
        {pinnedChoice === "custom" ? <CustomRatio value={pinnedCustom} onChange={setPinnedCustom} /> : null}
        <div className="mt-4 flex items-center justify-between gap-3">
          <span>Full-Screen Card</span>
          <button
            type="button"
            className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm"
            aria-pressed={full}
            onClick={() => setFull((on) => !on)}
          >
            {full ? "ON" : "OFF"}
          </button>
        </div>
        <RatioPreview ratio={pinnedPreview} invalid={pinnedInvalid} full={full} />
        <button type="button" disabled={busy !== ""} className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm" onClick={() => void savePinned()}>
          {busy === "pinned" ? "Saving…" : "Save Changes"}
        </button>
      </div>

      <div className="mt-6 max-w-xl rounded-3xl border border-on-photo/15 p-4">
        <h2 className="font-serif text-2xl">Pinned Wedding Bar Aspect Ratio</h2>
        <p className="mt-1 text-sm text-on-photo/70">Used only when a wedding bar is pinned. The card ratio above and the regular wedding bars stay as they are.</p>
        <RatioChoices name="pinned-bar-ratio" value={barChoice} onChange={setBarChoice} />
        {barChoice === "custom" ? <CustomRatio value={barCustom} onChange={setBarCustom} /> : null}
        <RatioPreview ratio={barPreview} invalid={barInvalid} />
        <button type="button" disabled={busy !== ""} className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm" onClick={() => void savePinnedBar()}>
          {busy === "bar" ? "Saving…" : "Save pinned bar"}
        </button>
      </div>
    </section>
  );
}

function choiceOf(stored: string) {
  return stored.startsWith("custom:") ? "custom" : stored || "original";
}

function partsOf(stored: string) {
  const match = /^custom:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(stored);
  return match ? { w: match[1], h: match[2] } : { w: "3", h: "5" };
}

function RatioChoices({ name, value, onChange }: { name: string; value: string; onChange: (value: string) => void }) {
  const options = [
    { id: "original", label: "Original" },
    ...CARD_RATIO_PRESETS.map((item) => ({ id: item.id, label: `${item.label}: ${item.id}` })),
    { id: "custom", label: "Custom" },
  ];
  return (
    <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <label key={option.id} className="flex min-h-11 items-center gap-3 text-sm">
          <input type="radio" name={name} value={option.id} checked={value === option.id} onChange={() => onChange(option.id)} />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function CustomRatio({ value, onChange }: { value: { w: string; h: string }; onChange: (value: { w: string; h: string }) => void }) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <label className="text-sm">
        Width
        <input
          className="mt-1 block w-24 rounded-2xl border border-on-photo/20 bg-ink px-3 py-2"
          inputMode="decimal"
          value={value.w}
          onChange={(event) => onChange({ ...value, w: event.target.value })}
        />
      </label>
      <label className="text-sm">
        Height
        <input
          className="mt-1 block w-24 rounded-2xl border border-on-photo/20 bg-ink px-3 py-2"
          inputMode="decimal"
          value={value.h}
          onChange={(event) => onChange({ ...value, h: event.target.value })}
        />
      </label>
    </div>
  );
}

function RatioPreview({ ratio, invalid, full = false }: { ratio: { w: number; h: number }; invalid: boolean; full?: boolean }) {
  return (
    <div className="mt-4">
      <p className="text-sm text-on-photo/70">Preview</p>
      {invalid ? <p className="mt-2 text-sm text-gold">That custom ratio is outside the range this card can show.</p> : null}
      <div
        className="mt-2 overflow-hidden rounded-2xl border border-on-photo/25 bg-on-photo/10"
        style={full ? { width: "100%", height: "9rem" } : { width: "8.5rem", maxWidth: "100%", aspectRatio: `${ratio.w} / ${ratio.h}` }}
      >
        <div className="flex h-full flex-col justify-between p-2 text-xs">
          <span>Arun & Meera</span>
          <span>{full ? "Full screen" : "12 December"}</span>
        </div>
      </div>
    </div>
  );
}

function FeaturesPanel({
  token,
  flags,
  announcement,
  fee,
  onChanged,
}: {
  token: string;
  flags?: Record<string, boolean>;
  announcement: string;
  fee: string;
  onChanged: () => void;
}) {
  const [draft, setDraft] = useState(announcement);
  useEffect(() => setDraft(announcement), [announcement]);
  return (
    <section>
      <h1 className="font-serif text-4xl">Features</h1>
      <p className="mt-2 text-sm text-on-photo/70">These switches are stored on the server and read by the app. Current setup fee: {fee}.</p>
      <ul className="mt-4 flex flex-col gap-2">
        {FLAGS.map(([key, label]) => {
          const enabled = flags ? Boolean(flags[key]) : key !== "weddingCountdown";
          return (
            <li key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-on-photo/10 px-4 py-3">
              <span>{label}</span>
              <button
                type="button"
                className="min-h-11 rounded-full border border-on-photo/20 px-4 text-sm"
                onClick={() => {
                  void developerFlag({ data: { token, key, enabled: !enabled } }).then(() => onChanged());
                }}
              >
                {enabled ? "On" : "Off"}
              </button>
            </li>
          );
        })}
      </ul>
      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void developerAnnouncement({ data: { token, text: draft } }).then(() => onChanged());
        }}
      >
        <label className="text-sm text-on-photo/70">Home announcement</label>
        <textarea className="mt-2 min-h-24 w-full rounded-2xl border border-on-photo/20 bg-ink px-3 py-3" value={draft} onChange={(event) => setDraft(event.target.value)} />
        <button type="submit" className="mt-3 min-h-11 rounded-full bg-maroon px-4 text-sm">Save announcement</button>
      </form>
    </section>
  );
}

function DatabasePanel({ token }: { token: string }) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof developerDatabase>> | null>(null);
  useEffect(() => {
    void developerDatabase({ data: { token } }).then(setReport);
  }, [token]);
  if (!report) return <p>Reading the database…</p>;
  if (!report.ok) return <p>{report.error}</p>;
  return (
    <section>
      <h1 className="font-serif text-4xl">Database</h1>
      <p className="mt-2 text-sm text-on-photo/70">{report.source}. {report.note}</p>
      <ul className="mt-4 divide-y divide-on-photo/10 rounded-card border border-on-photo/10">
        {report.tables.map((table) => (
          <li key={table.table} className="flex justify-between px-4 py-3 text-sm">
            <span>{table.table}</span>
            <span className="tabular-nums">{table.rows}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ErrorsPanel({ token }: { token: string }) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof developerErrors>> | null>(null);
  const [analysis, setAnalysis] = useState("");
  useEffect(() => {
    void developerErrors({ data: { token } }).then(setReport);
  }, [token]);
  if (!report) return <p>Loading errors…</p>;
  if (!report.ok) return <p>{report.error}</p>;
  return (
    <section>
      <h1 className="font-serif text-4xl">Errors</h1>
      {analysis ? <pre className="mt-4 whitespace-pre-wrap rounded-card border border-on-photo/10 p-4 text-sm">{analysis}</pre> : null}
      <ul className="mt-4 flex flex-col gap-3">
        {report.errors.length === 0 ? <li className="text-sm">No stored errors.</li> : null}
        {report.errors.map((item) => (
          <li key={item.id} className="rounded-2xl border border-on-photo/10 p-4 text-sm">
            <p className="text-gold">{item.source}</p>
            <p className="mt-1">{item.message}</p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-full border border-on-photo/20 px-4"
              onClick={() => {
                void developerAnalyze({ data: { token, id: item.id } }).then((result) => {
                  if (result.ok) setAnalysis(result.analysis);
                  else setAnalysis(result.error);
                });
              }}
            >
              Analyze
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogsPanel({ token }: { token: string }) {
  const [report, setReport] = useState<Awaited<ReturnType<typeof developerAudit>> | null>(null);
  const [proposals, setProposals] = useState<Awaited<ReturnType<typeof developerProposals>> | null>(null);
  useEffect(() => {
    void developerAudit({ data: { token } }).then(setReport);
    void developerProposals({ data: { token } }).then(setProposals);
  }, [token]);
  return (
    <section>
      <h1 className="font-serif text-4xl">Logs</h1>
      <p className="mt-2 text-sm text-on-photo/70">This log cannot be edited or deleted from the command center.</p>
      <ul className="mt-4 flex flex-col gap-3">
        {report && report.ok ? report.entries.map((item, index) => (
          <li key={`${item.created_at}-${index}`} className="rounded-2xl border border-on-photo/10 p-4 text-sm">
            <p className="text-on-photo/60">{item.created_at} · {item.email}</p>
            <p className="mt-1">{item.command}</p>
            <p className="mt-1 text-on-photo/75">{item.action} · {item.result}{item.files ? ` · ${item.files}` : ""}</p>
            {item.error ? <p className="mt-1 text-gold">{item.error}</p> : null}
          </li>
        )) : <li>Loading the log…</li>}
      </ul>
      {proposals && proposals.ok && proposals.proposals.length > 0 ? (
        <p className="mt-4 text-sm text-on-photo/70">{proposals.proposals.length} stored proposals. Applied source changes can be restored from the command that created them.</p>
      ) : null}
    </section>
  );
}

function GithubPanel() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof developerConnections>> | null>(null);
  useEffect(() => {
    void developerConnections().then(setInfo);
  }, []);
  return (
    <section>
      <h1 className="font-serif text-4xl">GitHub</h1>
      {info?.github === "connected" ? (
        <p className="mt-3 text-sm">Connected to {info.repository}. Latest commit {info.commit || "could not be read"}.</p>
      ) : (
        <div className="mt-4 max-w-xl rounded-card border border-gold/40 p-4 text-sm">
          <p className="font-medium">GitHub connection required.</p>
          <p className="mt-2 text-on-photo/75">No commit, branch, or pull request is shown because none can be made yet.</p>
          <ul className="mt-3 list-disc pl-5">
            <li>Server variable GITHUB_TOKEN with repository write permission</li>
            <li>Server variable GITHUB_REPOSITORY as owner/name</li>
          </ul>
          <p className="mt-3">Current commit: {info?.commit || "No Git repository is connected."}</p>
        </div>
      )}
    </section>
  );
}

function DeployPanel({ token }: { token: string }) {
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof developerConnections>> | null>(null);
  useEffect(() => {
    void developerConnections().then(setInfo);
  }, []);
  return (
    <section>
      <h1 className="font-serif text-4xl">Deployments</h1>
      <div className="mt-4 max-w-xl rounded-card border border-gold/40 p-4 text-sm">
        <p className="font-medium">{info?.deploy === "connected" ? "Deployment host is connected." : "Deployment host is not connected."}</p>
        <p className="mt-2 text-on-photo/75">There is no deployment history to show. A deploy button would invent a result, so it is not here.</p>
        {info?.deploy !== "connected" ? (
          <ul className="mt-3 list-disc pl-5">
            <li>Server variable VERCEL_TOKEN</li>
            <li>The published project already receives its own host configuration when you publish</li>
          </ul>
        ) : null}
      </div>
      <button
        type="button"
        disabled={busy}
        className="mt-4 min-h-11 rounded-full bg-maroon px-4 text-sm"
        onClick={() => {
          setBusy(true);
          setOutput("");
          void developerBuild({ data: { token } })
            .then((result) => {
              if (!result.ok) setOutput(result.error);
              else setOutput(`${result.passed ? "Build: PASS" : "Build: FAIL"}\n${result.output}`);
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Building…" : "Run build"}
      </button>
      {output ? <pre className="mt-4 overflow-auto whitespace-pre-wrap text-xs">{output}</pre> : null}
    </section>
  );
}

function SettingsPanel({ email, onLock }: { email: string; onLock: () => void }) {
  return (
    <section>
      <h1 className="font-serif text-4xl">Settings</h1>
      <p className="mt-3 text-sm">Signed in as {email}.</p>
      <p className="mt-3 max-w-xl text-sm text-on-photo/70">
        Passkeys are not part of this account system. This password check stays on the server. Google, GitHub, and deployment secrets stay in server environment variables and are not shown here.
      </p>
      <button type="button" onClick={onLock} className="mt-6 min-h-11 rounded-full border border-on-photo/20 px-4 text-sm">Lock developer center</button>
    </section>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
