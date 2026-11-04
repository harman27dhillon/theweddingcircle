import type { FeedSideId, FeedSides, Side } from "@/lib/wedding/types";

export const FEED_SIDE_SCHEMES: { id: FeedSideId; name: string; bar: string; wash: string; ink: string }[] = [
  { id: "rose", name: "Rose", bar: "#9c3d55", wash: "#fff1f3", ink: "#6e2438" },
  { id: "maroon", name: "Maroon", bar: "#7a2230", wash: "#f8ecec", ink: "#5c1824" },
  { id: "gold", name: "Gold", bar: "#a67c2d", wash: "#fbf6ea", ink: "#6d5014" },
  { id: "plum", name: "Plum", bar: "#6d3a6a", wash: "#f7eef6", ink: "#4d244c" },
  { id: "navy", name: "Navy", bar: "#243e66", wash: "#eef3f8", ink: "#1c3354" },
  { id: "sage", name: "Sage", bar: "#3e6b52", wash: "#eef6f1", ink: "#244833" },
  { id: "teal", name: "Teal", bar: "#1f6f73", wash: "#eef7f7", ink: "#145255" },
  { id: "ink", name: "Ink", bar: "#2c2624", wash: "#f4f1ee", ink: "#2c2624" },
];

const BY_ID = Object.fromEntries(FEED_SIDE_SCHEMES.map((item) => [item.id, item])) as Record<FeedSideId, (typeof FEED_SIDE_SCHEMES)[number]>;

export function isFeedSideId(value: unknown): value is FeedSideId {
  return typeof value === "string" && value in BY_ID;
}

export function feedSidesOf(wedding: { feedSides?: FeedSides }): FeedSides {
  return {
    bride: isFeedSideId(wedding.feedSides?.bride) ? wedding.feedSides.bride : "rose",
    groom: isFeedSideId(wedding.feedSides?.groom) ? wedding.feedSides.groom : "navy",
  };
}

export function schemeForSide(sides: FeedSides, side?: Side) {
  if (side === "Bride") return BY_ID[sides.bride];
  if (side === "Groom") return BY_ID[sides.groom];
  return null;
}
