import type { WeddingBarLayout } from "./bar-layout";
import type { WeddingFonts } from "./fonts";

export type Rsvp = "yes" | "no" | "maybe" | "pending";
export type Role = "host" | "cohost" | "guest" | "planner";
export type Side = "Bride" | "Groom" | "Both" | "Team";
export type Audience = "Bride" | "Groom" | "Both";
export type PostKind = "text" | "photos" | "videos" | "audio" | "announcement";
export type JoinMode = "link" | "approve";
export type PostMode = "everyone" | "hosts";
export type FunctionAccess = "everyone" | "family" | "hosts";
export type CodeKind = "family" | "guest";
export type AccessKind = "all" | "bride" | "groom" | "people" | "ceremony";

export type AccessRule = {
  kind: AccessKind;
  names?: string[];
  ceremonyId?: string;
};

export type ReactionKind = "love" | "joy" | "bless";

export type Reaction = {
  author: string;
  kind: ReactionKind;
  /** Membership key of the person who reacted. Older reactions may omit it. */
  memberKey?: string;
};

export type Comment = {
  id: string;
  author: string;
  /** Signed-in account id (`email:` or `phone:`). Absent on older messages. */
  authorId?: string;
  text: string;
  atLabel: string;
  replyTo?: string;
};

export type Payment = {
  status: "paid" | "failed" | "pending";
  reference: string;
  provider: "preview";
  method?: "credit" | "debit" | "upi";
  upiApp?: string;
  /** Set only after a trusted server verifies the purchase. A preview charge never sets this. */
  verified?: boolean;
};

export type FunctionEvent = {
  id: string;
  name: string;
  date: string;
  time: string;
  endTime?: string;
  venue: string;
  address?: string;
  dress?: string;
  note: string;
  mapsUrl?: string;
  live: boolean;
  access?: FunctionAccess;
  accessRule?: AccessRule;
  /** Host picture for this ceremony. A path, idb id, or a short jpeg data URL. */
  cover?: string;
  /** Explicit picture choice. "none" suppresses the classic default. */
  coverKind?: string;
};

export type FeedPost = {
  id: string;
  atLabel: string;
  author: string;
  /** Signed-in account id (`email:` or `phone:`). Absent on older messages. */
  authorId?: string;
  circle: string;
  kind: PostKind;
  text: string;
  images: string[];
  functionId?: string;
  reactions?: Reaction[];
  comments?: Comment[];
  videoLabel?: string;
  videoSeconds?: number;
  videos?: { src: string; seconds: number }[];
  /** Selection order for a grouped photo/video message. Images and videos stay filled for older readers. */
  gallery?: { kind: "image" | "video"; src: string; seconds?: number }[];
  audio?: { src: string; seconds: number };
  side?: Side;
  audience?: Audience;
  accessRule?: AccessRule;
  removed?: boolean;
  delivery?: "sending" | "sent" | "failed" | "pending";
  /** ISO time the message was written. Older messages may omit it. */
  at?: string;
  /** True when Seek, the automated companion, wrote this message. Clients cannot set it. */
  companion?: boolean;
  /** Group poll attached to this chat message. */
  pollId?: string;
  /** Who Said It? card. Absent on ordinary messages. */
  gameRev?: number;
  gameCard?: {
    roundId: string;
    phase: "submit" | "guess" | "revealed" | "empty";
    prompt: string;
    endsAt: number;
    lines: { id: string; text: string; authorName?: string; guessName?: string; result?: "correct" | "wrong" | "missed" }[];
    scoreText: string;
  };
};

export type Guest = {
  id: string;
  name: string;
  side: Side;
  group: string;
  rsvp: Rsvp;
  count: number;
  joined: boolean;
  arrived: boolean;
  relationship?: string;
  blocked?: boolean;
  contributor?: boolean;
  allowBride?: boolean;
  allowGroom?: boolean;
  allowCeremonies?: string[];
  blockedIds?: string[];
};

export type ChatMessage = {
  id: string;
  author: string;
  /** Signed-in account id (`email:` or `phone:`). Absent on older messages. */
  authorId?: string;
  text: string;
  atLabel: string;
  image?: string;
  video?: string;
  videoSeconds?: number;
  replyTo?: string;
  reactions?: Reaction[];
  removed?: boolean;
  delivery?: "sending" | "sent" | "failed" | "pending";
};

export type ChatRoom = {
  id: string;
  name: string;
  hint: string;
  closed?: boolean;
  messages: ChatMessage[];
};

export type Enquiry = {
  id: string;
  guests: string;
  location: string;
  when: string;
  budget: string;
  needs: string;
  atLabel: string;
};

export type Task = {
  id: string;
  title: string;
  owner: string;
  when: string;
  done: boolean;
  category?: string;
};

export type Privacy = {
  join: JoinMode;
  post: PostMode;
  live: PostMode;
  download: boolean;
  upload?: PostMode;
};

export type PageMotion = "static" | "subtle" | "motion";

export type PageBackground = {
  style: string;
  motion: PageMotion;
  reduce: boolean;
};

export type FeedSideId = "rose" | "maroon" | "gold" | "plum" | "navy" | "sage" | "teal" | "ink";

export type FeedSides = {
  bride: FeedSideId;
  groom: FeedSideId;
};

export type BeforeKind = "note" | "outfit" | "other" | "video";

export type BeforeItem = {
  id: string;
  author: string;
  text: string;
  images: string[];
  atLabel: string;
  kind: BeforeKind;
  video?: string;
  videoSeconds?: number;
  side?: Side;
  onHome?: boolean;
  accessRule?: AccessRule;
};

export type CoupleRoleName = "bride" | "groom";
export type CoupleCodeStatus = "active" | "claimed" | "revoked";

export type CoupleSeat = {
  accountId: string;
  name: string;
};

export type CoupleCodeRecord = {
  code: string;
  status: CoupleCodeStatus;
  claimedBy?: string;
};

/** Verified seats can be published. The code string must not be. */
export type CoupleAccess = {
  bride?: CoupleSeat;
  groom?: CoupleSeat;
  brideCode?: CoupleCodeRecord;
  groomCode?: CoupleCodeRecord;
};

export type Place = {
  id: string;
  name: string;
  kind: string;
  detail: string;
  image?: string;
  moving?: boolean;
};

export type InvitationDetails = {
  brideParents?: string;
  groomParents?: string;
  familyNote?: string;
  hashtag?: string;
};

export type WeddingGuestProfile = {
  displayName: string;
  photo?: string;
  bio?: string;
  links?: { label: string; url: string }[];
  relationship?: string;
  side?: "Bride" | "Groom";
  /** Used only to match this member's messages. Never shown on the profile card. */
  accountId?: string;
  joinedName?: string;
  updatedAt?: string;
  removed?: boolean;
};

export type Wedding = {
  id: string;
  slug: string;
  bride: string;
  groom: string;
  hostName: string;
  date: string;
  city: string;
  place: string;
  story: string;
  invitation?: InvitationDetails;
  cover: string;
  coverFocus?: string;
  religion: string;
  region: string;
  cultureNote: string;
  mode: "day" | "plan";
  functions: FunctionEvent[];
  posts: FeedPost[];
  guests: Guest[];
  chats: ChatRoom[];
  enquiries: Enquiry[];
  tasks: Task[];
  shortlist: string[];
  places: Place[];
  privacy: Privacy;
  liveNotes: ChatMessage[];
  sharingLocation: boolean;
  weddingType?: string;
  contactEmail?: string;
  contactPhone?: string;
  ownerEmail?: string;
  payment?: Payment;
  showMemory?: boolean;
  illustrated?: boolean;
  cohostNames?: string[];
  postingCodes?: { id: string; code: string; kind?: CodeKind }[];
  /** Short-lived lookup metadata returned only after a matching entry code is validated. */
  entryCodeKind?: CodeKind;
  entryCodeId?: string;
  youtubeUrl?: string;
  liveViewers?: string[];
  coverVideo?: string;
  beforeNotes?: BeforeItem[];
  pageBackground?: PageBackground;
  feedSides?: FeedSides;
  cardTheme?: string;
  /** Server clock for the shared theme. Higher wins across devices. */
  themeRev?: number;
  fonts?: WeddingFonts;
  bar?: WeddingBarLayout;
  /** Stable account id of the person who created this wedding. */
  ownerId?: string;
  /** Ownership could not be verified. Host tools stay closed until it is. */
  ownerReview?: boolean;
  coupleAccess?: CoupleAccess;
  /** Wedding-only display names and photos, keyed by membership. Not a global account. */
  guestProfiles?: Record<string, WeddingGuestProfile>;
  /** Host switch for wedding-day notes in chat. Omitted means on. */
  chatAtmosphere?: boolean;
  liveAccess?: AccessRule;
  disabled?: boolean;
  mediaKey?: string;
  rev?: number;
  /** Server clock when the circle was created. Missing on weddings opened before lifecycle existed. */
  createdAt?: string;
  /** When guests can no longer enter. A media extension does not move this. */
  expiresAt?: string;
  /** When cloud photos, videos, and chat may be deleted. */
  mediaRetentionUntil?: string;
};

export type Membership = {
  slug: string;
  email: string;
  name: string;
  role: string;
  accountId?: string;
};

export type Viewer = {
  name: string;
  role: Role;
  weddingId: string;
  coded?: boolean;
  side?: "Bride" | "Groom";
};

export type Account = {
  id: string;
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  developer?: boolean;
  country?: string;
  religion?: string;
  tradition?: string;
  firebaseUid?: string;
};

export type FeedbackNote = {
  id: string;
  text: string;
  fromName: string;
  atLabel: string;
};

export type PendingSignup = {
  name: string;
  email: string;
  phone: string;
  passwordHash: string;
  emailCode: string;
  phoneCode: string;
  religion?: string;
  tradition?: string;
  country?: string;
};

export type Notice = {
  id: string;
  weddingId: string;
  title: string;
  body: string;
  atLabel: string;
  read: boolean;
  kind: string;
};

export type Report = {
  id: string;
  weddingId: string;
  postId: string;
  reason: string;
  atLabel: string;
  author: string;
};

export type WeddingDraft = {
  bride: string;
  groom: string;
  hostName: string;
  date: string;
  city: string;
  place: string;
  story: string;
  religion: string;
  region: string;
  cultureNote: string;
  cover: string;
  weddingType: string;
  contactEmail: string;
  contactPhone: string;
  ownerEmail: string;
  payment: Payment;
  functions: { name: string; date: string; time: string; note: string }[];
};

export type VendorReview = {
  author: string;
  text: string;
  stars: number;
};

export type Vendor = {
  id: string;
  category: string;
  name: string;
  city: string;
  blurb: string;
  price: string;
  featured: boolean;
  services?: string;
  contact?: string;
  photo?: string;
  reviews?: VendorReview[];
};
