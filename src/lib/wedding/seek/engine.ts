import type { AccessRule, FeedPost, Task, Wedding } from "@/lib/wedding/types";
import { canView, type AccessViewer } from "@/lib/wedding/access";
import { languageStyle, normalizeSeekText, seekMention, type NormalizedText, type ScriptCue } from "./normalizer";

export type SeekIntentName =
  | "GREETING"
  | "ASK_APPEARANCE"
  | "REQUEST_COMPLIMENT"
  | "PLAYFUL_REPLY"
  | "THANK_YOU"
  | "GOODBYE"
  | "CHECK_TASK_STATUS"
  | "LIST_COMPLETED_TASKS"
  | "LIST_PENDING_TASKS"
  | "CREATE_HANDOFF"
  | "SET_REMINDER"
  | "SEARCH_MESSAGES"
  | "SEARCH_MEDIA"
  | "ASK_EVENT_DETAILS"
  | "START_GAME"
  | "CONFIRM"
  | "SET_MODE"
  | "OPT_IN"
  | "HELP"
  | "UNKNOWN";

export type SeekSource = { id: string; author: string; excerpt: string; at?: string; kind: "message" | "photo" | "video" | "file" };

export type SeekDecision = {
  intent: SeekIntentName;
  confidence: number;
  languageStyle: ScriptCue | "hinglish";
  reply: string;
  sources: SeekSource[];
  templateId: string;
  needsConfirm: boolean;
  action: { type: "add-task" | "complete-task" | "set-mode" | "opt-in"; payload: Record<string, string> } | null;
  nextState: { intent: string; hits: SeekSource[]; expiresAt: number } | null;
  social: boolean;
  private: boolean;
};

type Hit = FeedPost;

const COMPLIMENTS = [
  { id: "look-1", text: "You showed up, and that already suits the day." },
  { id: "look-2", text: "I cannot see the photo. From the circle, you belong in it." },
  { id: "look-3", text: "No eye for outfits here — just glad you are in the pictures." },
];
const COMPLIMENTS_HI = [
  { id: "look-hi-1", text: "मैं फोटो नहीं देख सकता। आप इस दिन का हिस्सा हो, बस इतना।" },
  { id: "look-hi-2", text: "रंग या कपड़े नहीं बता सकता। हाज़िरी अपने आप में अच्छी है।" },
];
const COMPLIMENTS_PA = [
  { id: "look-pa-1", text: "ਮੈਂ ਤਸਵੀਰ ਨਹੀਂ ਵੇਖ ਸਕਦਾ। ਤੁਸੀਂ ਇਸ ਦਿਨ ਵਿੱਚ ਹੋ, ਇਹੀ ਕਾਫ਼ੀ ਹੈ।" },
  { id: "look-pa-2", text: "ਕੱਪੜੇ ਜਾਂ ਰੰਗ ਬਾਰੇ ਨਹੀਂ ਕਹਿ ਸਕਦਾ। ਤੁਹਾਡੀ ਹਾਜ਼ਰੀ ਚੰਗੀ ਲੱਗਦੀ ਹੈ।" },
];

function pickVariant<T extends { id: string }>(items: T[], seed: string, recent: string[]): T {
  const open = items.filter((item) => !recent.includes(item.id));
  const pool = open.length ? open : items;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return pool[(hash >>> 0) % pool.length]!;
}

function tokens(value: string) {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((item) => item.length > 1);
}

function distance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = a[i - 1] === b[j - 1] ? prev : Math.min(prev, row[j], row[j - 1]) + 1;
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length] ?? 9;
}

function hasWord(text: string, word: string) {
  if (text.includes(word)) return true;
  return tokens(text).some((token) => token.length >= 4 && word.length >= 4 && distance(token, word) <= 1);
}

export function recognizeIntent(text: NormalizedText, explicit: boolean): { intent: SeekIntentName; confidence: number } {
  const body = text.folded;
  const raw = text.original;
  if (explicit && /^(confirm|haan save|theek hai save)$/.test(body)) return { intent: "CONFIRM", confidence: 0.95 };
  if (explicit && body === "start who said it") return { intent: "START_GAME", confidence: 0.99 };
  if (explicit && /^(help|what can you do)?$/.test(body)) return { intent: "HELP", confidence: 0.9 };
  if (explicit && /^mode (quiet|social|party)$/.test(body)) return { intent: "SET_MODE", confidence: 0.95 };
  if (explicit && /^(social|photo comments) (on|off)$/.test(body)) return { intent: "OPT_IN", confidence: 0.95 };
  if (/how am i looking|how do i look|kiddan lag|kiven lag|kaisi lag/.test(body) || /ਕਿਵੇਂ ਲੱਗ|कैसी लग|कैसा लग/.test(raw)) {
    return { intent: "ASK_APPEARANCE", confidence: 0.9 };
  }
  if (/\b(compliment|taarif|tareef)\b/.test(body) || /तारीफ|ਤਾਰੀਫ਼/.test(raw)) return { intent: "REQUEST_COMPLIMENT", confidence: 0.86 };
  if (/^(thanks|thank you|shukriya|dhanyavad)\b/.test(body) || /शुक्रिया|ਧੰਨਵਾਦ|ਸ਼ੁਕਰੀਆ/.test(raw)) return { intent: "THANK_YOU", confidence: 0.9 };
  if (/^(bye|goodbye|alvida|rab rakha)\b/.test(body)) return { intent: "GOODBYE", confidence: 0.88 };
  if (/^(bas bas|haha|lol|hehe)\b/.test(body)) return { intent: "PLAYFUL_REPLY", confidence: 0.8 };
  if (/^(hi|hello|hey|namaste|sat sri akal)\b/.test(body) || /ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ|नमस्ते/.test(raw)) return { intent: "GREETING", confidence: 0.86 };
  if (/pending tasks|what is left|baaki kaam|ki rehnda|list pending/.test(body) || /बाकी काम|ਬਾਕੀ ਕੰਮ/.test(raw)) return { intent: "LIST_PENDING_TASKS", confidence: 0.84 };
  if (/what did .+ finish|completed tasks|ho gaya list|this week/.test(body) && /finish|completed|ho gaya/.test(body)) return { intent: "LIST_COMPLETED_TASKS", confidence: 0.8 };
  if (/did .+ (finish|complete)|kar diya|kar ditta|ne .+ kamm/.test(body) || /कर दिया|ਕਰ ਦਿੱਤਾ|पूरा किया|ਪੂਰਾ/.test(raw)) return { intent: "CHECK_TASK_STATUS", confidence: 0.86 };
  if (/assign .+ to |remind (him|her|them)|yaad dilao/.test(body)) return { intent: "CREATE_HANDOFF", confidence: 0.84 };
  if (/\bremind\b/.test(body)) return { intent: "SET_REMINDER", confidence: 0.75 };
  if (/show photos|photos from|videos of|tasveer/.test(body) || /तस्वीर|ਫੋਟੋ|ਤਸਵੀਰ/.test(raw)) return { intent: "SEARCH_MEDIA", confidence: 0.84 };
  if (/where did|find |search |messages about|labho|dhoond/.test(body) || /ढूंढ|ਲੱਭ/.test(raw)) return { intent: "SEARCH_MESSAGES", confidence: 0.82 };
  if (/when is|venue|hotel address|ceremony|mehndi|departure/.test(body)) return { intent: "ASK_EVENT_DETAILS", confidence: 0.7 };
  if (explicit) return { intent: "UNKNOWN", confidence: 0.2 };
  return { intent: "UNKNOWN", confidence: 0 };
}

function personFrom(body: string, original = "") {
  if (/ਅਮਨ|अमन/.test(original)) return "aman";
  const did = body.match(/\bdid\s+([a-z][\w'-]{1,40})\b/);
  if (did) return did[1]!;
  const ne = body.match(/\b([a-z][\w'-]{1,40})\s+ne\b/);
  if (ne) return ne[1]!;
  const assign = body.match(/\bto\s+([a-z][\w'-]{1,40})\b/);
  if (assign) return assign[1]!;
  const only = body.match(/\bonly those\s+([a-z][\w'-]{1,40})\b/);
  if (only) return only[1]!;
  return "";
}

function taskWords(body: string, original = "") {
  const known = ["decoration", "decorations", "sajawat", "catering", "venue", "mehndi", "departure"];
  const found = known.filter((word) => hasWord(body, word));
  if (/ਸਜਾਵਟ|सजावट|डेकोरेशन/.test(original) && !found.includes("decoration")) found.push("decoration");
  return found;
}

function excerpt(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}

export function visiblePosts(wedding: Pick<Wedding, "posts" | "guests" | "functions">, viewer: AccessViewer) {
  return (wedding.posts ?? []).filter((post) => !post.removed && canView(wedding, viewer, post.accessRule, post.id, post.author) && !post.companion);
}

function whenMatches(post: Hit, body: string, now: number) {
  if (!post.at) return !/today|yesterday|friday|this week/.test(body);
  const at = Date.parse(post.at);
  if (Number.isNaN(at)) return true;
  const day = 86_400_000;
  if (body.includes("today")) return now - at < day && now >= at;
  if (body.includes("yesterday")) return now - at < 2 * day && now - at >= day;
  if (body.includes("this week")) return now - at < 7 * day && now >= at;
  if (body.includes("friday")) return new Date(at).getDay() === 5 && now - at < 14 * day;
  return true;
}

export function searchCircle(posts: Hit[], body: string, now: number, mediaOnly: boolean): SeekSource[] {
  const skip = new Set(["seek", "find", "show", "photos", "photo", "from", "messages", "message", "where", "did", "share", "the", "only", "those", "posted", "what", "about", "we", "finally", "decide", "decision", "time"]);
  const wanted = tokens(body).filter((token) => !skip.has(token) && token.length > 2);
  const ranked = posts.flatMap((post) => {
    if (!whenMatches(post, body, now)) return [];
    const hasPhoto = (post.images?.length ?? 0) > 0 || (post.gallery ?? []).some((item) => item.kind === "image");
    const hasVideo = (post.videos?.length ?? 0) > 0 || Boolean(post.videoLabel);
    if (mediaOnly && !hasPhoto && !hasVideo) return [];
    const hay = `${post.text} ${post.author}`.toLowerCase();
    const score = wanted.reduce((sum, token) => sum + (hasWord(hay, token) ? 1 : 0), 0);
    if (wanted.length && score === 0) return [];
    const kind = hasPhoto ? "photo" as const : hasVideo ? "video" as const : "message" as const;
    return [{ score, source: { id: post.id, author: post.author, excerpt: excerpt(post.text || (hasPhoto ? "Photo" : "Message")), at: post.at, kind } satisfies SeekSource }];
  }).sort((a, b) => b.score - a.score);
  return ranked.slice(0, 5).map((item) => item.source);
}

function taskLine(task: Task, style: SeekDecision["languageStyle"]) {
  const state = task.done ? "marked done" : "still open";
  if (style === "gurmukhi") return `${task.title} — ${task.owner} — ${task.done ? "ਮਾਰਕ ਹੋਇਆ" : "ਅਜੇ ਬਾਕੀ"} (${task.when}).`;
  if (style === "devanagari" || style === "hinglish") return `${task.title} — ${task.owner} — ${task.done ? "मार्क हुआ" : "अभी बाकी"} (${task.when}).`;
  return `${task.title} — ${task.owner} — ${state} (${task.when}). Not verified, only marked.`;
}

function statusReply(tasks: Task[], body: string, original: string, style: SeekDecision["languageStyle"]) {
  const person = personFrom(body, original);
  const words = taskWords(body, original);
  const pool = tasks.filter((task) => {
    const ownerOk = !person || hasWord(task.owner.toLowerCase(), person);
    const titleOk = !words.length || words.some((word) => hasWord(task.title.toLowerCase(), word));
    return ownerOk && titleOk;
  });
  if (!pool.length) {
    return { reply: "I could not find that checklist item for this wedding. I will not guess.", sources: [] as SeekSource[] };
  }
  if (pool.length > 1) {
    return { reply: `More than one checklist item matches. ${pool.map((task) => taskLine(task, style)).join(" ")} Which one?`, sources: [] as SeekSource[] };
  }
  const task = pool[0]!;
  const done = task.done ? "Yes" : "No";
  return { reply: `${done} — ${taskLine(task, style)}`, sources: [] as SeekSource[] };
}

function clarify(style: SeekDecision["languageStyle"]) {
  if (style === "gurmukhi") return "ਮੈਨੂੰ ਇਹ ਪੱਕਾ ਨਹੀਂ ਲੱਗਾ। @seek find …, @seek did Aman finish decorations?, ਜਾਂ @seek help ਲਿਖੋ।";
  if (style === "devanagari") return "मैं यह पक्का नहीं समझा। @seek find …, @seek did Aman finish decorations?, या @seek help लिखें।";
  return "I am not sure which ask that is. Try @seek find decoration messages, @seek did Aman finish decorations?, or @seek help.";
}

export function decideSeek(input: {
  text: string;
  now: number;
  explicit: boolean;
  hasPhoto: boolean;
  wedding: Pick<Wedding, "posts" | "guests" | "functions" | "tasks" | "bride" | "groom">;
  viewer: AccessViewer;
  mode: "QUIET" | "SOCIAL" | "PARTY";
  allowPhoto: boolean;
  muted: boolean;
  language?: string | null;
  recentTemplateIds?: string[];
  state?: { intent: string; hits: SeekSource[]; expiresAt: number } | null;
}): SeekDecision {
  const normalized = normalizeSeekText(input.explicit ? input.text.replace(/(^|\s)@seek\b/i, " ") : input.text);
  const style = languageStyle(normalized, input.language);
  const seen = recognizeIntent(normalized, input.explicit);
  const recent = input.recentTemplateIds ?? [];
  const base = {
    languageStyle: style,
    sources: [] as SeekSource[],
    needsConfirm: false,
    action: null as SeekDecision["action"],
    nextState: null as SeekDecision["nextState"],
    social: false,
    private: input.explicit,
  };
  if (!input.explicit && (input.muted || input.mode === "QUIET" || !input.allowPhoto || !input.hasPhoto || seen.intent !== "ASK_APPEARANCE" || seen.confidence < 0.8)) {
    return { ...base, intent: "UNKNOWN", confidence: 0, reply: "", templateId: "", private: false };
  }
  if (!input.explicit) {
    const pool = style === "gurmukhi" ? COMPLIMENTS_PA : style === "devanagari" || style === "hinglish" ? COMPLIMENTS_HI : COMPLIMENTS;
    const chosen = pickVariant(pool, `${input.text}:${input.now}`, recent);
    return { ...base, intent: "ASK_APPEARANCE", confidence: seen.confidence, reply: chosen.text, templateId: chosen.id, social: true, private: false };
  }
  if (seen.confidence < 0.6) {
    const follow = input.state && input.state.expiresAt > input.now ? input.state : null;
    if (follow && /only those|sirf/.test(normalized.folded)) {
      const person = personFrom(normalized.folded, normalized.original);
      const sources = follow.hits.filter((hit) => !person || hasWord(hit.author.toLowerCase(), person));
      return { ...base, intent: "SEARCH_MESSAGES", confidence: 0.7, reply: sources.length ? `From the last search, ${sources.length} still match.` : "Nothing from the last search matches that.", sources, templateId: "follow-up", nextState: { intent: "SEARCH_MESSAGES", hits: sources, expiresAt: input.now + 180_000 } };
    }
    return { ...base, intent: "UNKNOWN", confidence: seen.confidence, reply: clarify(style), templateId: "clarify" };
  }
  if (seen.intent === "HELP" || seen.intent === "START_GAME" || seen.intent === "CONFIRM") {
    const reply = seen.intent === "START_GAME"
      ? "Starting Who Said It?."
      : seen.intent === "CONFIRM"
        ? "Confirming the saved checklist change."
        : "I'm Seek, an automated companion — not a person. Don't scroll. Just ask. Try @seek find decoration messages, @seek show photos from Friday, or @seek did Aman finish decorations?";
    return { ...base, intent: seen.intent, confidence: seen.confidence, reply, templateId: seen.intent.toLowerCase() };
  }
  if (seen.intent === "SET_MODE") {
    const mode = normalized.folded.endsWith("party") ? "PARTY" : normalized.folded.endsWith("social") ? "SOCIAL" : "QUIET";
    return { ...base, intent: seen.intent, confidence: seen.confidence, reply: `Group Seek mode will be ${mode}. Quiet answers only @seek. Social and Party still need each person to turn photo comments on.`, templateId: `mode-${mode}`, needsConfirm: true, action: { type: "set-mode", payload: { mode } } };
  }
  if (seen.intent === "OPT_IN") {
    const on = normalized.folded.endsWith("on");
    const photo = normalized.folded.startsWith("photo");
    return { ...base, intent: seen.intent, confidence: seen.confidence, reply: on ? "I will only add an occasional public note when this group is in Social or Party mode." : "I will stay quiet unless you write @seek.", templateId: `opt-${on}`, needsConfirm: true, action: { type: "opt-in", payload: { photo: photo ? "1" : "0", on: on ? "1" : "0" } } };
  }
  if (seen.intent === "GREETING" || seen.intent === "THANK_YOU" || seen.intent === "GOODBYE" || seen.intent === "PLAYFUL_REPLY" || seen.intent === "REQUEST_COMPLIMENT" || seen.intent === "ASK_APPEARANCE") {
    const pool = seen.intent === "ASK_APPEARANCE" || seen.intent === "REQUEST_COMPLIMENT"
      ? (style === "gurmukhi" ? COMPLIMENTS_PA : style === "devanagari" || style === "hinglish" ? COMPLIMENTS_HI : COMPLIMENTS)
      : [{ id: `${seen.intent}-1`, text: seen.intent === "THANK_YOU" ? "Glad to help. I only know what is already saved in this wedding." : seen.intent === "GOODBYE" ? "I'll be here in the chat." : seen.intent === "PLAYFUL_REPLY" ? "Noted. I will leave it there." : "Hello. I'm Seek, an automated companion." }];
    const chosen = pickVariant(pool, input.text, recent);
    return { ...base, intent: seen.intent, confidence: seen.confidence, reply: chosen.text, templateId: chosen.id, nextState: seen.intent === "ASK_APPEARANCE" ? { intent: "ASK_APPEARANCE", hits: [], expiresAt: input.now + 180_000 } : null };
  }
  if (seen.intent === "CHECK_TASK_STATUS" || seen.intent === "LIST_PENDING_TASKS" || seen.intent === "LIST_COMPLETED_TASKS") {
    const tasks = input.wedding.tasks ?? [];
    if (seen.intent === "LIST_PENDING_TASKS" || seen.intent === "LIST_COMPLETED_TASKS") {
      const done = seen.intent === "LIST_COMPLETED_TASKS";
      const rows = tasks.filter((task) => task.done === done);
      const reply = rows.length ? rows.map((task) => taskLine(task, style)).join(" ") : done ? "Nothing on the checklist is marked done." : "The checklist has no open items.";
      return { ...base, intent: seen.intent, confidence: seen.confidence, reply, templateId: seen.intent.toLowerCase() };
    }
    const found = statusReply(tasks, normalized.folded, normalized.original, style);
    return { ...base, intent: seen.intent, confidence: seen.confidence, reply: found.reply, templateId: "task-status" };
  }
  if (seen.intent === "CREATE_HANDOFF" || seen.intent === "SET_REMINDER") {
    const person = personFrom(normalized.folded, normalized.original) || "the circle";
    const task = taskWords(normalized.folded, normalized.original)[0] || "task";
    const when = normalized.folded.match(/\bat\s+([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/)?.[1] || "This week";
    return {
      ...base,
      intent: seen.intent,
      confidence: seen.confidence,
      reply: `I can add “${task}” for ${person} (${when}) on the wedding checklist. Reply @seek confirm to save it. This does not send a phone reminder.`,
      templateId: "confirm-task",
      needsConfirm: true,
      action: { type: "add-task", payload: { title: task, owner: person, when } },
    };
  }
  const posts = visiblePosts(input.wedding, input.viewer);
  const media = seen.intent === "SEARCH_MEDIA";
  const sources = searchCircle(posts, normalized.folded, input.now, media);
  const conflict = /decide|decision|finally|departure/.test(normalized.folded) && sources.length > 1;
  const reply = !sources.length
    ? "I found nothing you are allowed to see for that. I will not invent it."
    : conflict
      ? `I found ${sources.length} notes and they do not say the same thing. ${sources.map((item) => `${item.author}: ${item.excerpt}`).join(" · ")}`
      : sources.map((item) => `${item.author}: ${item.excerpt}`).join(" · ");
  return {
    ...base,
    intent: seen.intent === "ASK_EVENT_DETAILS" ? "ASK_EVENT_DETAILS" : media ? "SEARCH_MEDIA" : "SEARCH_MESSAGES",
    confidence: seen.confidence,
    reply: media && sources.some((item) => item.kind === "photo") ? `${reply} I match captions and who posted them. I cannot see what is inside a photo.` : reply,
    sources,
    templateId: conflict ? "conflict" : "search",
    nextState: { intent: "SEARCH_MESSAGES", hits: sources, expiresAt: input.now + 180_000 },
  };
}

export function mentionRest(raw: string) {
  return seekMention(raw);
}

export function ruleAllowsGroup(rule?: AccessRule) {
  return !rule || rule.kind === "all";
}
