import { useState } from "react";
import { toast } from "sonner";
import { saveDeveloperAppearance } from "@/lib/developer/appearance.functions";
import { loadAppearance, useClassicRegistry } from "@/lib/wedding/classic-registry";
import { BUILTIN_ASSETS } from "@/lib/wedding/library-catalog";
import type { MobileLandingBackground } from "@/lib/wedding/classic-maker";

const EXTRA = [
  { label: "Rose Garden", src: "/assets/developer/landing/rose-garden.png" },
  { label: "Classic cover", src: "/card-themes/classic-default-cover.jpg" },
  { label: "Pastel garden", src: "/covers/pastel-garden.svg" },
  { label: "Ivory and gold", src: "/covers/ivory-gold.svg" },
  { label: "Sunset florals", src: "/covers/sunset.svg" },
];

const CHOICES = [
  ...BUILTIN_ASSETS.filter((item) => item.path.startsWith("/media/")).map((item) => ({ label: item.name, src: item.path })),
  ...EXTRA,
];

function BackgroundSlot({
  title,
  detail,
  saved,
  onSave,
}: {
  title: string;
  detail: string;
  saved: MobileLandingBackground;
  onSave: (next: MobileLandingBackground) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function choose(next: MobileLandingBackground) {
    setBusy(true);
    setError("");
    try {
      await onSave(next);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "That background could not be saved.";
      setError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-serif text-2xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">{detail}</p>
      {saved?.src ? <img src={saved.src} alt="" className="mt-3 h-36 w-full max-w-md rounded-2xl object-cover" /> : <p className="mt-3 text-sm text-on-photo/60">Using the default.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {CHOICES.map((choice) => (
          <button
            key={`${title}-${choice.src}`}
            type="button"
            disabled={busy}
            aria-pressed={saved?.src === choice.src}
            className={saved?.src === choice.src ? "min-h-11 rounded-full bg-maroon px-3 text-sm" : "min-h-11 rounded-full border border-on-photo/20 px-3 text-sm"}
            onClick={() => void choose({ src: choice.src, fit: "cover", position: "center", bundled: true })}
          >
            {choice.label}
          </button>
        ))}
        <button type="button" disabled={busy || !saved} className="min-h-11 rounded-full border border-gold/50 px-3 text-sm text-gold" onClick={() => void choose(null)}>
          Reset to default
        </button>
      </div>
      {error ? <p className="mt-2 text-sm text-gold">{error}</p> : null}
    </section>
  );
}

export function DeveloperBackgrounds({ token }: { token: string }) {
  const appearance = useClassicRegistry((s) => s.appearance);

  async function save(slot: "landingBackground" | "ceremonyBackground", next: MobileLandingBackground) {
    const current = useClassicRegistry.getState().appearance;
    const result = await saveDeveloperAppearance({
      data: { token, appearance: { ...current, [slot]: next } },
    });
    if (!result.ok) throw new Error(result.error);
    await loadAppearance();
    toast(next ? "Background saved." : "Background reset.");
  }

  return (
    <section>
      <h1 className="font-serif text-4xl">Appearance and backgrounds</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">
        These two pictures are independent. The landing picture is desktop only. The ceremony picture covers the ceremony container, not each ceremony photo. Rose Garden stays a phone landing choice and is not the desktop default.
      </p>
      <BackgroundSlot
        title="Main landing page"
        detail="Shown behind the public landing page on desktop. Phones keep the separate mobile landing picture."
        saved={appearance.landingBackground}
        onSave={(next) => save("landingBackground", next)}
      />
      <BackgroundSlot
        title="Ceremony container"
        detail="Replaces the light pink Classic ceremony window when set. Preset themes keep their own look until a picture is chosen. Individual ceremony photos stay as they are."
        saved={appearance.ceremonyBackground}
        onSave={(next) => save("ceremonyBackground", next)}
      />
    </section>
  );
}
