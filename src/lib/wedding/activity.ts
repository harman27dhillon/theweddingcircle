import type { BeforeItem, ChatMessage, ChatRoom, Comment, FeedPost, Reaction } from "@/lib/wedding/types";

function byId<T extends { id: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    if (item?.id) map.set(item.id, item);
  }
  return map;
}

function mergeReactions(current?: Reaction[], incoming?: Reaction[]) {
  const seen = new Set<string>();
  const out: Reaction[] = [];
  for (const reaction of [...(current ?? []), ...(incoming ?? [])]) {
    const key = `${reaction.author}:${reaction.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reaction);
  }
  return out;
}

function mergeComments(current: Comment[], incoming: Comment[]) {
  const incomingById = byId(incoming);
  const currentById = byId(current);
  const localOnly = current.filter((item) => !incomingById.has(item.id));
  const rest = incoming.map((item) => {
    const local = currentById.get(item.id);
    if (!local) return item;
    return { ...item, ...local, authorId: local.authorId || item.authorId };
  });
  return [...localOnly, ...rest];
}

function mixPost(current: FeedPost | undefined, incoming: FeedPost | undefined): FeedPost {
  if (!current) return { ...incoming!, delivery: undefined };
  if (!incoming) return current;
  const images = current.images?.length ? current.images : incoming.images;
  const videos = current.videos?.length ? current.videos : incoming.videos;
  const gallery = current.gallery?.length ? current.gallery : incoming.gallery;
  const audio = current.audio?.src ? current.audio : incoming.audio;
  const incomingRev = Number(incoming.gameRev ?? 0);
  const currentRev = Number(current.gameRev ?? 0);
  const newerGame = incomingRev > currentRev;
  return {
    ...incoming,
    ...current,
    authorId: current.authorId || incoming.authorId,
    text: newerGame ? incoming.text : current.text || incoming.text,
    gameCard: newerGame ? incoming.gameCard : current.gameCard ?? incoming.gameCard,
    gameRev: Math.max(currentRev, incomingRev) || undefined,
    images: images ?? [],
    videos,
    gallery,
    audio,
    removed: Boolean(current.removed || incoming.removed),
    comments: mergeComments(current.comments ?? [], incoming.comments ?? []),
    reactions: mergeReactions(current.reactions, incoming.reactions),
    delivery: undefined,
  };
}

/** Keeps unsynced local rows, unions by id, and honors a removal from either side. */
export function mergePosts(current: FeedPost[] = [], incoming: FeedPost[] = []) {
  const incomingById = byId(incoming);
  const currentById = byId(current);
  const localOnly = current.filter((item) => item.id && !incomingById.has(item.id));
  const rest = incoming.filter((item) => item.id).map((item) => mixPost(currentById.get(item.id), item));
  return [...localOnly, ...rest];
}

function mixMessage(current: ChatMessage | undefined, incoming: ChatMessage | undefined): ChatMessage {
  if (!current) return { ...incoming!, delivery: undefined };
  if (!incoming) return current;
  return {
    ...incoming,
    ...current,
    text: current.text || incoming.text,
    removed: Boolean(current.removed || incoming.removed),
    reactions: mergeReactions(current.reactions, incoming.reactions),
    delivery: undefined,
  };
}

export function mergeMessages(current: ChatMessage[] = [], incoming: ChatMessage[] = []) {
  const incomingById = byId(incoming);
  const currentById = byId(current);
  const localOnly = current.filter((item) => item.id && !incomingById.has(item.id));
  const rest = incoming.filter((item) => item.id).map((item) => mixMessage(currentById.get(item.id), item));
  return [...rest, ...localOnly];
}

export function mergeChats(current: ChatRoom[] = [], incoming: ChatRoom[] = []) {
  const incomingById = byId(incoming);
  const currentById = byId(current);
  const seen = new Set<string>();
  const out: ChatRoom[] = [];
  for (const chat of incoming) {
    if (!chat?.id || seen.has(chat.id)) continue;
    seen.add(chat.id);
    const local = currentById.get(chat.id);
    out.push(
      local
        ? { ...local, ...chat, messages: mergeMessages(local.messages ?? [], chat.messages ?? []) }
        : chat,
    );
  }
  for (const chat of current) {
    if (!chat?.id || seen.has(chat.id)) continue;
    out.push(chat);
  }
  return out;
}

export function mergeNotes(current: BeforeItem[] = [], incoming: BeforeItem[] = []) {
  const incomingById = byId(incoming);
  const currentById = byId(current);
  const localOnly = current.filter((item) => item.id && !incomingById.has(item.id));
  const rest = incoming.filter((item) => item.id).map((item) => {
    const local = currentById.get(item.id);
    return local ? { ...item, ...local, images: local.images?.length ? local.images : item.images } : item;
  });
  return [...localOnly, ...rest];
}
