/** Unicode-safe folding for Seek. Original text is kept; names are not translated. */

export type ScriptCue = "latin" | "devanagari" | "gurmukhi";

export type NormalizedText = {
  original: string;
  folded: string;
  scripts: ScriptCue[];
};

const ROMAN: [RegExp, string][] = [
  [/kr?\s*dit+a+/g, "kar ditta"],
  [/kar\s+diya/g, "kar diya"],
  [/kidd?an/g, "kiddan"],
  [/kiven/g, "kiven"],
  [/kaisi|kaisa|kese/g, "kaisi"],
  [/lag\s+reha|lag\s+raha|lag\s+rahi/g, "lag reha"],
  [/shukriya|shukria/g, "shukriya"],
  [/dhanyavaad|dhanyavad/g, "dhanyavad"],
  [/sat\s*sri\s*akal/g, "sat sri akal"],
  [/yaad\s*dila+o/g, "yaad dilao"],
];

export function normalizeSeekText(raw: string): NormalizedText {
  const original = raw.normalize("NFKC").replace(/[\u0000-\u001f\u200b-\u200d\ufeff]/g, " ").replace(/\s+/g, " ").trim();
  let folded = original.toLowerCase();
  for (const [pattern, token] of ROMAN) folded = folded.replace(pattern, token);
  folded = folded.replace(/[“”«»]/g, "\"").replace(/[’‘]/g, "'");
  const scripts: ScriptCue[] = [];
  if (/\p{Script=Devanagari}/u.test(original)) scripts.push("devanagari");
  if (/\p{Script=Gurmukhi}/u.test(original)) scripts.push("gurmukhi");
  if (/[a-z]/i.test(original) || scripts.length === 0) scripts.push("latin");
  return { original, folded, scripts };
}

export function languageStyle(text: NormalizedText, override?: string | null): ScriptCue | "hinglish" {
  if (override === "devanagari" || override === "gurmukhi" || override === "latin" || override === "hinglish") return override;
  if (text.scripts.includes("gurmukhi")) return "gurmukhi";
  if (text.scripts.includes("devanagari") && text.scripts.includes("latin")) return "hinglish";
  if (text.scripts.includes("devanagari")) return "devanagari";
  if (/\b(ne|da|kamm|kar|hai|mein|ka)\b/.test(text.folded) && /[a-z]/.test(text.folded)) return "hinglish";
  return "latin";
}

/** Pull the text after the first @seek mention, or null when Seek was not addressed. */
export function seekMention(raw: string): string | null {
  const text = normalizeSeekText(raw).folded;
  const at = text.search(/(^|\s)@seek\b/);
  if (at < 0) return null;
  const rest = text.slice(at).replace(/^\s*@seek\b/, "").replace(/[.!?]+$/g, "").trim();
  return rest;
}
