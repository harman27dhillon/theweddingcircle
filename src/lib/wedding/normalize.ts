import type { Wedding } from "@/lib/wedding/types";
import { codesOf } from "./format.ts";

const byInput = new WeakMap<Wedding, Wedding>();
const lastById = new Map<string, { raw: Wedding; norm: Wedding }>();

function themeRevOnly(a: Wedding, b: Wedding) {
  if (a.id !== b.id) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === "cardTheme" || key === "rev" || key === "themeRev") continue;
    if (a[key as keyof Wedding] !== b[key as keyof Wedding]) return false;
  }
  return a.cardTheme !== b.cardTheme || a.rev !== b.rev || a.themeRev !== b.themeRev;
}

function heavyNormalize(w: Wedding): Wedding {
  return {
    ...w,
    weddingType: w.weddingType || "Traditional",
    contactEmail: w.contactEmail || "",
    contactPhone: w.contactPhone || "",
    showMemory: Boolean(w.showMemory),
    illustrated: Boolean(w.illustrated),
    cohostNames: w.cohostNames ?? [],
    postingCodes: codesOf(w),
    youtubeUrl: w.youtubeUrl ?? "",
    coverVideo: w.coverVideo ?? "",
    beforeNotes: w.beforeNotes ?? [],
    disabled: Boolean(w.disabled),
    mediaKey: w.mediaKey || "",
    payment: w.payment ?? { status: "paid", reference: "WC-SAMPLE", provider: "preview" },
    privacy: { upload: "everyone", ...w.privacy },
    functions: w.functions.map((f) => ({ access: "everyone" as const, ...f })),
    posts: w.posts.map((p) => ({
      ...p,
      reactions: p.reactions ?? [],
      comments: p.comments ?? [],
    })),
    guests: w.guests.map((g) => ({
      ...g,
      blocked: Boolean(g.blocked),
      relationship: g.relationship || g.group,
      contributor: Boolean(g.contributor),
    })),
    chats: w.chats.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({ ...m, reactions: m.reactions ?? [] })),
    })),
    tasks: w.tasks.map((t) => ({ ...t, category: t.category || "Ceremony arrangements" })),
  };
}

export function normalizeWedding(w: Wedding): Wedding {
  const cached = byInput.get(w);
  if (cached) return cached;
  const prev = lastById.get(w.id);
  const next = prev && themeRevOnly(prev.raw, w)
    ? { ...prev.norm, cardTheme: w.cardTheme, rev: w.rev, themeRev: w.themeRev }
    : heavyNormalize(w);
  byInput.set(w, next);
  lastById.set(w.id, { raw: w, norm: next });
  return next;
}