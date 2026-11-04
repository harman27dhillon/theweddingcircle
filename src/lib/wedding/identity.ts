/** Stable sender id for a signed-in account. Same email or phone always maps to the same id, even on another device. Display names are not used. */
const SENDER_ID = /^(email|phone):[A-Za-z0-9@._+-]{3,160}$/;

export function accountSenderId(account: { email?: string; phone?: string } | null | undefined): string {
  if (!account) return "";
  const email = (account.email ?? "").trim().toLowerCase();
  if (email.includes("@")) {
    const id = `email:${email}`;
    return SENDER_ID.test(id) ? id : "";
  }
  const digits = (account.phone ?? "").replace(/\D/g, "");
  const phone = digits.length > 10 ? digits.slice(-10) : digits;
  if (phone.length === 10) {
    const id = `phone:${phone}`;
    return SENDER_ID.test(id) ? id : "";
  }
  return "";
}

export function isSenderId(value: unknown): value is string {
  return typeof value === "string" && SENDER_ID.test(value.trim());
}

/** True only when both sides carry the same account id. Missing ids are never treated as the current user. */
export function isOwnMessage(authorId: string | undefined, account: { email?: string; phone?: string } | null | undefined): boolean {
  const me = accountSenderId(account);
  return Boolean(me && authorId && authorId === me);
}

export type CoupleRole = "bride" | "groom";

type CouplePost = {
  author?: string;
  authorId?: string;
  removed?: boolean;
  comments?: Array<{ author?: string; authorId?: string }>;
};

/**
 * Bride and groom ids taken from the wedding record.
 * The host's account id is used when their name is the bride or the groom.
 * Otherwise the oldest signed-in message whose author matches that name supplies the id.
 */
export function coupleAuthorIds(wedding: {
  bride?: string;
  groom?: string;
  hostName?: string;
  ownerEmail?: string;
  coupleAccess?: { bride?: { accountId?: string }; groom?: { accountId?: string } };
  posts?: CouplePost[];
}): { bride: string; groom: string } {
  const brideName = (wedding.bride ?? "").trim().toLowerCase();
  const groomName = (wedding.groom ?? "").trim().toLowerCase();
  const hostName = (wedding.hostName ?? "").trim().toLowerCase();
  const ownerId = accountSenderId({ email: wedding.ownerEmail ?? "" });
  let bride = isSenderId(wedding.coupleAccess?.bride?.accountId) ? wedding.coupleAccess.bride.accountId.trim() : "";
  let groom = isSenderId(wedding.coupleAccess?.groom?.accountId) ? wedding.coupleAccess.groom.accountId.trim() : "";
  if (!bride && ownerId && brideName && hostName === brideName) bride = ownerId;
  else if (!groom && ownerId && groomName && hostName === groomName) groom = ownerId;

  const posts = wedding.posts ?? [];
  for (let i = posts.length - 1; i >= 0; i -= 1) {
    const post = posts[i];
    if (post?.removed) continue;
    claim(post?.author, post?.authorId);
    const comments = post?.comments ?? [];
    for (const comment of comments) claim(comment.author, comment.authorId);
  }

  function claim(author?: string, authorId?: string) {
    if (!isSenderId(authorId)) return;
    const id = authorId.trim();
    const name = (author ?? "").trim().toLowerCase();
    if (!bride && brideName && name === brideName) bride = id;
    if (!groom && groomName && name === groomName) groom = id;
  }

  return { bride, groom };
}

/** Whose message this is, using the wedding couple — never a hard-coded name. */
export function coupleRole(
  wedding: { bride?: string; groom?: string } | null | undefined,
  author: string | undefined,
  authorId: string | undefined,
  ids: { bride?: string; groom?: string },
): CoupleRole | "" {
  if (!wedding) return "";
  const id = isSenderId(authorId) ? authorId.trim() : "";
  if (id && ids.bride && id === ids.bride) return "bride";
  if (id && ids.groom && id === ids.groom) return "groom";
  const name = (author ?? "").trim().toLowerCase();
  if (!name) return "";
  const brideName = (wedding.bride ?? "").trim().toLowerCase();
  const groomName = (wedding.groom ?? "").trim().toLowerCase();
  if (brideName && name === brideName && (!id || !ids.bride || id === ids.bride)) return "bride";
  if (groomName && name === groomName && (!id || !ids.groom || id === ids.groom)) return "groom";
  return "";
}
