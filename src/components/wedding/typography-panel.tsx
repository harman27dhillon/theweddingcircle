import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/wedding/ui";
import { canManage } from "@/lib/wedding/format";
import { ensureFonts, FONT_ROLES, fontFamily, sanitizeFonts, WEDDING_FONTS, weddingFont, type FontRole, type WeddingFonts } from "@/lib/wedding/fonts";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Wedding } from "@/lib/wedding/types";

export function TypographyPanel({ wedding }: { wedding: Wedding }) {
  const viewer = useWeddingStore((s) => s.viewer);
  const accountId = useWeddingStore((s) => s.account?.id);
  const setWeddingFonts = useWeddingStore((s) => s.setWeddingFonts);
  const applied = sanitizeFonts(wedding.fonts) ?? {};
  const [role, setRole] = useState<FontRole>("names");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(applied[role] ?? "");
  const allowed = canManage(wedding, viewer) || Boolean(accountId && wedding.ownerId && wedding.ownerId === accountId);
  const current = weddingFont(applied[role]);
  const previewId = draft || applied[role] || "";
  const previewFont = weddingFont(previewId);
  const fonts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return WEDDING_FONTS.filter((font) => !needle || font.family.toLowerCase().includes(needle) || font.category.toLowerCase().includes(needle));
  }, [query]);

  useEffect(() => {
    setDraft(applied[role] ?? "");
  }, [role, wedding.fonts]);

  useEffect(() => {
    ensureFonts([previewId, ...Object.values(applied)]);
  }, [previewId, applied]);

  if (!allowed) return <p className="text-sm text-muted">Only a host or co-host can change fonts for this wedding.</p>;

  function commit(next: WeddingFonts | undefined) {
    const result = setWeddingFonts(wedding.id, next ?? {});
    toast(result === "ok" ? "Fonts saved for this wedding." : "Only a host or co-host can change these fonts.");
  }

  const roleCopy = FONT_ROLES.find((item) => item.id === role);
  const sample = role === "names"
    ? `${wedding.bride || "Bride"} & ${wedding.groom || "Groom"}`
    : role === "ceremonyHead"
      ? wedding.functions[0]?.name || "Wedding ceremony"
      : role === "ceremonyBody"
        ? [wedding.functions[0]?.venue, wedding.place, wedding.city].filter(Boolean).join(" · ") || "Saturday · garden lawn"
        : role === "headings"
          ? "The families"
          : wedding.story?.trim() || "Together with their families.";

  return (
    <div className="type-studio grid gap-3">
      <p className="text-sm text-muted">Choose a font for each part of this wedding. Chat and the app name stay as they are.</p>
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Font categories">
        {FONT_ROLES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={role === item.id}
            className={`min-h-11 rounded-full border px-3 text-sm ${role === item.id ? "border-maroon bg-maroon text-on-photo" : "border-line bg-card text-ink"}`}
            onClick={() => setRole(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="text-sm">
        Applied: <span className="font-medium">{current?.family ?? "Wedding Circle default"}</span>
      </p>
      <div className="type-preview rounded-2xl border border-line bg-ivory px-4 py-4" style={previewFont ? { fontFamily: fontFamily(previewFont.id) } : undefined}>
        <p className="text-xs uppercase tracking-[0.16em] text-gold">{roleCopy?.label}</p>
        <p className={`mt-1 text-ink ${role === "body" || role === "ceremonyBody" ? "text-base leading-relaxed" : "text-3xl leading-tight"}`}>{sample}</p>
      </div>
      <input
        className="min-h-11 rounded-2xl border border-line bg-card px-3 text-sm"
        placeholder="Search fonts"
        value={query}
        aria-label="Search fonts"
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="type-font-list max-h-72 overflow-auto rounded-2xl border border-line bg-card" aria-label="Font styles">
        {fonts.length === 0 ? <li className="px-3 py-4 text-sm text-muted">No font matches that search.</li> : null}
        {fonts.map((font) => {
          const selected = draft === font.id;
          return (
            <li key={font.id} className="border-b border-line last:border-0">
              <button
                type="button"
                className={`flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left ${selected ? "bg-paper" : ""}`}
                aria-pressed={selected}
                onClick={() => setDraft(font.id)}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{font.family}</span>
                  <span className="block text-xs text-muted">{font.category}</span>
                </span>
                {applied[role] === font.id ? <span className="shrink-0 text-xs text-maroon">Applied</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!draft || draft === applied[role]}
          onClick={() => commit({ ...applied, [role]: draft })}
        >
          Apply
        </Button>
        <Button
          type="button"
          variant="line"
          disabled={!applied[role]}
          onClick={() => {
            const next = { ...applied };
            delete next[role];
            commit(next);
          }}
        >
          Reset this category
        </Button>
        <Button
          type="button"
          variant="line"
          disabled={!Object.keys(applied).length}
          onClick={() => commit({})}
        >
          Reset all
        </Button>
      </div>
    </div>
  );
}
