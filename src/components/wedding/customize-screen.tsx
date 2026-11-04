import { useState } from "react";
import { toast } from "sonner";
import { LivingCanvas, useReducedMotion } from "@/components/wedding/living";
import { useWedding } from "@/components/wedding/context";
import { Button, PickList } from "@/components/wedding/ui";
import { LIVING_CATEGORIES, LIVING_STYLES, livingStyle, type LivingCategory, type PageMotion } from "@/lib/wedding/backgrounds";
import { canManage } from "@/lib/wedding/format";
import { isDeveloperEmail, useWeddingStore } from "@/lib/wedding/store";
import { useAppRuntime } from "@/lib/developer/runtime";
import { cn } from "@/lib/utils";

const MOTIONS: { id: PageMotion; label: string; note: string }[] = [
  { id: "static", label: "Static", note: "No movement" },
  { id: "subtle", label: "Subtle", note: "Very slow" },
  { id: "motion", label: "Motion", note: "A little more" },
];

export function CustomizeScreen() {
  const wedding = useWedding();
  const viewer = useWeddingStore((s) => s.viewer);
  const setPageBackground = useWeddingStore((s) => s.setPageBackground);
  const account = useWeddingStore((s) => s.account);
  const developer = Boolean(account && (account.developer || isDeveloperEmail(account.email)));
  const mayEdit = developer && canManage(wedding, viewer);
  const runtime = useAppRuntime();
  const saved = wedding.pageBackground;
  const [styleId, setStyleId] = useState(saved?.style ?? "classic");
  const [motion, setMotion] = useState<PageMotion>(saved?.motion ?? "subtle");
  const [reduce, setReduce] = useState(Boolean(saved?.reduce));
  const [category, setCategory] = useState<LivingCategory | "All">("All");
  const systemReduce = useReducedMotion();
  const style = livingStyle(styleId);
  const previewMotion: PageMotion = reduce || systemReduce ? "static" : motion;
  const dirty = styleId !== (saved?.style ?? "classic") || motion !== (saved?.motion ?? "subtle") || reduce !== Boolean(saved?.reduce);
  const shown = LIVING_STYLES.filter((item) => category === "All" || item.category === category);

  if (!developer) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8 lg:max-w-6xl">
        <h1 className="font-serif text-4xl">Page background</h1>
        <p className="mt-3 text-muted">Background is in the developer desk. A developer account is required.</p>
      </div>
    );
  }

  if (!runtime.flags.premiumThemes) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8 lg:max-w-6xl">
        <h1 className="font-serif text-4xl">Page background</h1>
        <p className="mt-3 text-muted">Premium backgrounds are turned off.</p>
      </div>
    );
  }

  if (!mayEdit) {
    const current = livingStyle(saved?.style);
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-8 lg:max-w-6xl">
        <h1 className="font-serif text-4xl">Page background</h1>
        <p className="mt-3 text-muted">The host and co-hosts choose the canvas behind this circle. You see the same one they do.</p>
        <p className="mt-4 font-medium">{current.name}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
      <header className="max-w-2xl">
        <p className="text-sm text-muted">Customize circle</p>
        <h1 className="mt-1 font-serif text-4xl">Page background</h1>
        <p className="mt-2 text-muted">
          The canvas behind posts, chats, and cards. The cover, the header, and the posts themselves stay as they are.
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>
          <PickList
            label="Animation"
            value={motion}
            onChange={setMotion}
            options={MOTIONS.map((item) => ({ value: item.id, label: `${item.label} · ${item.note}` }))}
          />
          <p className="mt-2 text-sm text-muted">Subtle is the usual choice. Motion is still quiet. Static backgrounds ignore this.</p>
          <label className="mt-4 flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
            Reduce motion for everyone in this circle
          </label>
          {systemReduce ? <p className="mt-1 text-sm text-muted">This device also prefers less motion, so the preview stays still.</p> : null}

          <div className="mt-6">
            <PickList
              label="Background"
              value={category}
              onChange={(value) => setCategory(value)}
              options={[{ value: "All" as const, label: "All" }, ...LIVING_CATEGORIES.map((item) => ({ value: item, label: item }))]}
            />
          </div>

          <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn("block w-full overflow-hidden rounded-2xl border text-left", styleId === item.id ? "border-maroon ring-2 ring-maroon" : "border-line")}
                  onClick={() => setStyleId(item.id)}
                >
                  <span className="relative block h-24">
                    <LivingCanvas styleId={item.id} motion="static" className="absolute inset-0" />
                  </span>
                  <span className="block bg-card px-3 py-2">
                    <span className="block text-sm font-medium">{item.name}</span>
                    <span className="block text-xs text-muted">
                      {item.category} · {item.animated ? "Animated" : "Still"}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-sm text-muted">Preview</p>
          <div className={cn("relative mt-2 min-h-80 overflow-hidden rounded-card border border-line", style.dark && "living-dark-scope")}>
            <LivingCanvas styleId={styleId} motion={previewMotion} className="absolute inset-0" />
            <div className="relative flex flex-col gap-3 p-4">
              <div className="flex gap-3 text-xs">
                <span>Home</span>
                <span>Chat</span>
                <span>Live</span>
              </div>
              <article className="rounded-2xl border border-line bg-card p-3 text-sm">
                <p className="font-medium">June Park</p>
                <p className="mt-1">The hall looks ready. Seats in front are held.</p>
              </article>
              <p className="rounded-2xl border border-line bg-card px-3 py-2 text-sm text-muted">A reply stays on its card.</p>
              <p className="rounded-full border border-line bg-card px-4 py-3 text-sm text-muted">Write a note</p>
            </div>
          </div>
          <p className="mt-3 text-sm">{style.name} · {style.animated ? "Animated" : "Still"}</p>
          <Button
            className="mt-3 w-full"
            disabled={!dirty}
            onClick={() => {
              setPageBackground(wedding.id, { style: styleId, motion, reduce });
              toast("Saved for everyone in this circle.");
            }}
          >
            Apply to this circle
          </Button>
        </aside>
      </div>
    </div>
  );
}
