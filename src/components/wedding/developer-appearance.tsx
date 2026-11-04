import { useState } from "react";
import { toast } from "sonner";
import { Button, fieldClass } from "@/components/wedding/ui";
import { saveDeveloperAppearance, saveDeveloperImage } from "@/lib/developer/appearance.functions";
import { developerToken } from "@/lib/developer/runtime";
import { compressImage } from "@/lib/wedding/format";
import {
  COLOR_FIELDS,
  IMAGE_SLOTS,
  freshTheme,
  type ClassicThemeRecord,
  type ImageSlotKey,
  type ThemeImage,
} from "@/lib/wedding/classic-maker";
import { loadAppearance, useClassicRegistry } from "@/lib/wedding/classic-registry";

const ROSE_GARDEN_SRC = "/assets/developer/landing/rose-garden.png";

type DraftFile = { mime: string; data: string; preview: string };

async function readPhoto(file: File) {
  if (!/^image\/(jpeg|png|webp|jpg)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  }
  const preview = await compressImage(file);
  const data = preview.split(",")[1] || "";
  if (!data) throw new Error("That photo could not be read.");
  return { mime: "image/jpeg", data, preview } satisfies DraftFile;
}

function downloadPackage(filename: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function storeImage(slot: string, file: DraftFile) {
  const result = await saveDeveloperImage({ data: { token: developerToken(), slot, mime: file.mime, data: file.data } });
  if (!result.ok) {
    if ("download" in result && result.download) downloadPackage(result.download.filename, result.download.base64);
    throw new Error(result.error || "That image was not saved.");
  }
  return result.path;
}

export function DeveloperAppearance() {
  const appearance = useClassicRegistry((s) => s.appearance);
  return (
    <div className="mt-8 flex flex-col gap-10">
      <MobileLandingEditor saved={appearance.mobileLanding} />
      <ClassicThemeMaker themes={appearance.themes} mobileLanding={appearance.mobileLanding} />
    </div>
  );
}

function MobileLandingEditor({ saved }: { saved: { src: string; fit: "cover" | "contain"; position: "center" | "top" | "bottom" | "left" | "right"; bundled: boolean } | null }) {
  const [file, setFile] = useState<DraftFile | null>(null);
  const [fit, setFit] = useState(saved?.fit ?? "cover");
  const [position, setPosition] = useState(saved?.position ?? "center");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(saved?.bundled ? "Saved to project assets." : saved?.src ? "Saved for this server." : "No custom background.");
  const preview = file?.preview || saved?.src || "";

  async function save(next: typeof saved) {
    setBusy(true);
    try {
      const token = developerToken();
      if (!token) throw new Error("Developer session required. Unlock the developer desk on this device first.");
      const current = useClassicRegistry.getState().appearance;
      const result = await saveDeveloperAppearance({
        data: { token, appearance: { ...current, mobileLanding: next, themes: current.themes } },
      });
      if (!result.ok) throw new Error(result.error);
      setStatus(result.status || (next?.bundled ? "Saved to project assets." : "Reset to the default landing background."));
      setFile(null);
      await loadAppearance();
      toast(next ? "Mobile landing background saved." : "Mobile landing background reset.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "That background could not be saved.";
      setStatus(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h3 className="font-serif text-2xl">Mobile Landing Page Background</h3>
      <p className="mt-2 text-sm text-muted">This photo is only the public landing page on phones. It does not change a wedding, a cover, a theme, or the desktop landing page.</p>
      <label className="mt-4 inline-flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-card px-4 text-sm">
        Choose Photo from Gallery
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (!picked) return;
            void readPhoto(picked).then((next) => {
              setFile(next);
              setStatus("Preview only — not yet integrated.");
            }).catch((error: unknown) => toast(error instanceof Error ? error.message : "That photo could not be used."));
          }}
        />
      </label>
      <div className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-card p-3">
        <img src={ROSE_GARDEN_SRC} alt="" className="h-24 w-16 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Rose Garden</p>
          <p className="mt-1 text-xs text-muted">Pink, blush, and ivory roses. This sets only the phone landing page, using cover fit.</p>
          <Button
            type="button"
            className="mt-2"
            variant={saved?.src === ROSE_GARDEN_SRC && !file ? "line" : "primary"}
            disabled={busy || (saved?.src === ROSE_GARDEN_SRC && !file)}
            onClick={() => {
              setFile(null);
              setFit("cover");
              setPosition("center");
              void save({ src: ROSE_GARDEN_SRC, fit: "cover", position: "center", bundled: true });
            }}
          >
            {saved?.src === ROSE_GARDEN_SRC && !file ? "Rose Garden in use" : "Use Rose Garden"}
          </Button>
        </div>
      </div>
      {preview ? (
        <img src={preview} alt="" className="mt-4 h-40 w-full rounded-2xl border border-line object-cover" style={{ objectFit: fit, objectPosition: position }} />
      ) : <p className="mt-4 text-sm text-muted">The default landing colours are in use.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Fit
          <select className={fieldClass} value={fit} onChange={(event) => setFit(event.target.value === "contain" ? "contain" : "cover")}>
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
          </select>
        </label>
        <label className="text-sm">Position
          <select className={fieldClass} value={position} onChange={(event) => setPosition(event.target.value as typeof position)}>
            {["center", "top", "bottom", "left", "right"].map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-3 text-sm" role="status">{status}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={busy} onClick={() => {
          void (async () => {
            let src = saved?.src || "";
            let bundled = Boolean(saved?.bundled && !file);
            if (file) {
              setBusy(true);
              try {
                src = await storeImage("landing/mobile", file);
                bundled = true;
                setStatus("Saved to project assets.");
              } catch (error) {
                setBusy(false);
                const message = error instanceof Error ? error.message : "That photo was not integrated.";
                setStatus(message);
                toast(message);
                return;
              }
            }
            if (!src) {
              toast("Choose a photo first.");
              return;
            }
            await save({ src, fit, position, bundled });
          })();
        }}>Save</Button>
        <Button type="button" variant="line" disabled={busy} onClick={() => { setFile(null); setFit(saved?.fit ?? "cover"); setPosition(saved?.position ?? "center"); setStatus(saved?.src ? "Changes cancelled." : "No custom background."); }}>Cancel</Button>
        <Button type="button" variant="line" disabled={busy} onClick={() => void save(null)}>Reset to Default</Button>
      </div>
    </section>
  );
}

function ClassicThemeMaker({ themes, mobileLanding }: { themes: ClassicThemeRecord[]; mobileLanding: { src: string; fit: "cover" | "contain"; position: "center" | "top" | "bottom" | "left" | "right"; bundled: boolean } | null }) {
  const [draft, setDraft] = useState<ClassicThemeRecord | null>(themes[0] ? structuredClone(themes[0]) : null);
  const [files, setFiles] = useState<Partial<Record<ImageSlotKey, DraftFile>>>({});
  const [mode, setMode] = useState<"landing" | "card">("card");
  const [phone, setPhone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Built-in Classic themes stay as they are.");
  const [confirmDelete, setConfirmDelete] = useState(false);

  function select(id: string) {
    const theme = themes.find((item) => item.id === id);
    setDraft(theme ? structuredClone(theme) : null);
    setFiles({});
    setConfirmDelete(false);
    setStatus(theme ? "Editing a saved custom theme." : "");
  }

  async function persist(nextThemes: ClassicThemeRecord[], note: string) {
    const token = developerToken();
    if (!token) throw new Error("Developer session required. Unlock the developer desk on this device first.");
    const result = await saveDeveloperAppearance({
      data: { token, appearance: { updatedAt: new Date().toISOString(), mobileLanding, themes: nextThemes } },
    });
    if (!result.ok) throw new Error(result.error);
    await loadAppearance();
    setStatus(result.status || note);
    toast(note);
  }

  async function saveTheme() {
    if (!draft) return;
    setBusy(true);
    try {
      const images = { ...draft.images };
      for (const [key, file] of Object.entries(files) as [ImageSlotKey, DraftFile][]) {
        const slot = key === "landingMobile" ? "landing/mobile" : key === "landingDesktop" ? "landing/desktop" : key === "barMobile" ? "wedding-bar/mobile" : "wedding-bar/desktop";
        const path = await storeImage(slot, file);
        images[key] = { ...images[key], src: path, bundled: true };
      }
      const nextDraft = { ...draft, images };
      const others = themes.filter((item) => item.id !== draft.id);
      await persist([...others, nextDraft], "Theme saved.");
      setDraft(nextDraft);
      setFiles({});
    } catch (error) {
      const message = error instanceof Error ? error.message : "That theme could not be saved.";
      setStatus(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  }

  const previewImage = draft
    ? (mode === "landing"
      ? (phone ? draft.images.landingMobile : draft.images.landingDesktop)
      : (phone ? draft.images.barMobile : draft.images.barDesktop))
    : null;
  const previewFile = previewImage ? files[(mode === "landing" ? (phone ? "landingMobile" : "landingDesktop") : (phone ? "barMobile" : "barDesktop")) as ImageSlotKey] : null;

  return (
    <section>
      <h3 className="font-serif text-2xl">Classic Theme Maker</h3>
      <p className="mt-2 text-sm text-muted">Custom Classic themes are added beside Classic Default and Classic Ivory. Built-in themes are not overwritten.</p>
      <p className="mt-2 text-sm text-muted">Locked: Classic Default, Classic Ivory.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" onClick={() => { const next = freshTheme(); setDraft(next); setFiles({}); setStatus("Preview only — not yet integrated."); }}>Create New Classic Theme</Button>
        {draft ? <Button type="button" variant="line" onClick={() => { const copy = freshTheme(`${draft.name} copy`); copy.colors = { ...draft.colors }; copy.images = structuredClone(draft.images); setDraft(copy); setFiles({}); setStatus("Duplicate is preview only until you save it."); }}>Duplicate Theme</Button> : null}
      </div>
      {themes.length > 0 ? (
        <label className="mt-4 block text-sm">Edit an existing custom Classic theme
          <select className={fieldClass} value={draft?.id || ""} onChange={(event) => select(event.target.value)}>
            <option value="">Choose</option>
            {themes.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
          </select>
        </label>
      ) : null}
      {draft ? (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div>
            <label className="text-sm">Theme name
              <input className={fieldClass} value={draft.name} maxLength={48} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {COLOR_FIELDS.map(([key, label]) => (
                <label key={key} className="text-sm">{label}
                  <span className="mt-1 flex items-center gap-2">
                    <input type="color" aria-label={label} value={draft.colors[key]} onChange={(event) => setDraft({ ...draft, colors: { ...draft.colors, [key]: event.target.value } })} />
                    <input className={fieldClass} value={draft.colors[key]} onChange={(event) => {
                      const value = event.target.value;
                      if (/^#[0-9a-fA-F]{0,6}$/.test(value)) setDraft({ ...draft, colors: { ...draft.colors, [key]: value } });
                    }} />
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-4">
              {IMAGE_SLOTS.map(([key, label]) => {
                const image = draft.images[key];
                const pending = files[key];
                return (
                  <div key={key} className="rounded-2xl border border-line p-3">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-xs text-muted">{pending ? "Preview only — not yet integrated." : image.bundled && image.src ? "Saved to project assets." : image.src ? "Using a saved path." : "Default artwork."}</p>
                    {pending?.preview || image.src ? <img src={pending?.preview || image.src} alt="" className="mt-2 h-24 w-full rounded-xl object-cover" style={{ objectFit: image.fit, objectPosition: image.position }} /> : null}
                    <label className="mt-2 inline-flex min-h-11 cursor-pointer items-center text-sm text-maroon">
                      {image.src || pending ? "Replace image" : "Choose image"}
                      <input type="file" accept="image/*" className="sr-only" onChange={(event) => {
                        const picked = event.target.files?.[0];
                        event.target.value = "";
                        if (!picked) return;
                        void readPhoto(picked).then((next) => setFiles((current) => ({ ...current, [key]: next }))).catch((error: unknown) => toast(error instanceof Error ? error.message : "That photo could not be used."));
                      }} />
                    </label>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button type="button" variant="line" disabled={!pending || busy} onClick={() => {
                        if (!pending || !draft) return;
                        const slot = key === "landingMobile" ? "landing/mobile" : key === "landingDesktop" ? "landing/desktop" : key === "barMobile" ? "wedding-bar/mobile" : "wedding-bar/desktop";
                        setBusy(true);
                        void storeImage(slot, pending).then((path) => {
                          setDraft({ ...draft, images: { ...draft.images, [key]: { ...image, src: path, bundled: true } } });
                          setFiles((current) => {
                            const next = { ...current };
                            delete next[key];
                            return next;
                          });
                          setStatus("Saved to project assets. Save the theme to keep this image on it.");
                        }).catch((error: unknown) => {
                          setStatus(error instanceof Error ? error.message : "That image was not integrated.");
                        }).finally(() => setBusy(false));
                      }}>Save as App Asset</Button>
                      <Button type="button" variant="line" onClick={() => {
                        setFiles((current) => {
                          const next = { ...current };
                          delete next[key];
                          return next;
                        });
                        setDraft({ ...draft, images: { ...draft.images, [key]: { src: "", fit: "cover", position: "center", bundled: false } } });
                      }}>Remove image</Button>
                      <Button type="button" variant="line" onClick={() => setDraft({ ...draft, images: { ...draft.images, [key]: { src: "", fit: "cover", position: "center", bundled: false } } })}>Reset to default</Button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <select className={fieldClass} value={image.fit} onChange={(event) => setDraft({ ...draft, images: { ...draft.images, [key]: { ...image, fit: event.target.value === "contain" ? "contain" : "cover" } } })}>
                        <option value="cover">Cover</option>
                        <option value="contain">Contain</option>
                      </select>
                      <select className={fieldClass} value={image.position} onChange={(event) => setDraft({ ...draft, images: { ...draft.images, [key]: { ...image, position: event.target.value as ThemeImage["position"] } } })}>
                        {["center", "top", "bottom", "left", "right"].map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-sm" role="status">{status}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void saveTheme()}>Save Theme</Button>
              <Button type="button" variant="line" disabled={busy} onClick={() => select(draft.id)}>Cancel Changes</Button>
              <Button type="button" variant="line" disabled={busy} onClick={() => { setDraft({ ...draft, colors: freshTheme().colors, images: freshTheme(draft.name).images }); setFiles({}); setStatus("Reset in the editor. Save to keep it."); }}>Reset to Default</Button>
              {confirmDelete ? (
                <Button type="button" disabled={busy} onClick={() => {
                  setBusy(true);
                  void persist(themes.filter((item) => item.id !== draft.id), "Custom theme deleted.").then(() => {
                    setDraft(null);
                    setConfirmDelete(false);
                  }).catch((error: unknown) => toast(error instanceof Error ? error.message : "That theme could not be deleted.")).finally(() => setBusy(false));
                }}>Confirm delete</Button>
              ) : <Button type="button" variant="line" onClick={() => setConfirmDelete(true)}>Delete custom theme</Button>}
            </div>
          </div>
          <aside>
            <p className="text-sm font-medium">Live preview</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant={mode === "landing" ? "primary" : "line"} onClick={() => setMode("landing")}>Landing</Button>
              <Button type="button" variant={mode === "card" ? "primary" : "line"} onClick={() => setMode("card")}>Wedding card</Button>
              <Button type="button" variant={!phone ? "primary" : "line"} onClick={() => setPhone(false)}>Desktop</Button>
              <Button type="button" variant={phone ? "primary" : "line"} onClick={() => setPhone(true)}>Mobile</Button>
            </div>
            <div className="relative mt-3 overflow-hidden rounded-2xl border border-line" style={{ background: draft.colors.page, color: draft.colors.text, minHeight: phone ? 420 : 280, maxWidth: phone ? 220 : "100%" }}>
              {previewFile?.preview || previewImage?.src ? (
                <img src={previewFile?.preview || previewImage?.src} alt="" className="absolute inset-0 h-full w-full" style={{ objectFit: previewImage?.fit || "cover", objectPosition: previewImage?.position || "center" }} />
              ) : null}
              <div className="relative p-3" style={{ background: mode === "card" ? "transparent" : `${draft.colors.panel}cc` }}>
                <p style={{ color: draft.colors.heading, fontFamily: "Georgia, serif" }}>{mode === "landing" ? "The Wedding Circle" : "Aisha & Rohan"}</p>
                <p className="text-xs" style={{ color: draft.colors.textSecondary }}>{phone ? "Mobile" : "Desktop"} · {mode === "card" ? "Card artwork stays behind the names" : "Landing preview"}</p>
                <p className="mt-3 rounded-xl px-3 py-2 text-sm" style={{ background: draft.colors.card, color: draft.colors.text, border: `1px solid ${draft.colors.accent}` }}>14 November · Amritsar</p>
                <button type="button" className="mt-3 min-h-11 rounded-full px-4 text-sm" style={{ background: draft.colors.button, color: draft.colors.buttonText }}>Open</button>
                <p className="mt-3 rounded-2xl px-3 py-2 text-sm" style={{ background: draft.colors.chatBubble, color: draft.colors.chatText }}>A chat note stays readable.</p>
                <p className="mt-2 text-xs" style={{ color: draft.colors.live }}>Live accent</p>
              </div>
            </div>
          </aside>
        </div>
      ) : <p className="mt-4 text-sm text-muted">Create a theme to edit colours and images. Nothing is changed until you save.</p>}
    </section>
  );
}
