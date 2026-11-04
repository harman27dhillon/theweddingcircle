import type { Wedding } from "@/lib/wedding/types";

const hall = "";
const dinner = "/media/demo-dinner.svg";
const dance = "/media/demo-dance.svg";

export const SEED_ID = "lila-nico";

export const seedWedding: Wedding = {
  id: SEED_ID,
  slug: "lila-nico",
  bride: "Lila Fern",
  groom: "Nico Vale",
  hostName: "Lila Fern",
  date: "2026-11-14",
  city: "Cedar Bay",
  place: "The Glass Hall",
  story: "Lila and Nico asked everyone they love into one private circle. The pictures are drawn, the names are made up, and the day is still theirs.",
  cover: hall,
  religion: "",
  region: "",
  cultureNote: "",
  weddingType: "Illustrated",
  mode: "day",
  illustrated: true,
  cohostNames: ["June Park", "Ren Cole"],
  postingCodes: [
    { id: "code-lila", code: "GLASS-HALL", kind: "family" },
    { id: "code-lila-guest", code: "OPEN-DOOR", kind: "guest" },
  ],
  youtubeUrl: "",
  coverVideo: "",
  beforeNotes: [
    {
      id: "b1",
      author: "Lila Fern",
      text: "The outfit is ivory, with a thin ribbon. Shoes are still a maybe.",
      images: [],
      atLabel: "Monday",
      kind: "outfit",
      side: "Bride",
    },
    {
      id: "b2",
      author: "June Park",
      text: "Cousins are bringing matching jackets. We can share the tailor's note here.",
      images: [],
      atLabel: "Tuesday",
      kind: "note",
      side: "Both",
    },
  ],
  functions: [
    {
      id: "welcome",
      name: "Welcome",
      date: "2026-11-13",
      time: "18:00",
      venue: "The Glass Hall garden",
      note: "A first evening for people who travelled.",
      live: false,
    },
    {
      id: "ceremony",
      name: "Ceremony",
      date: "2026-11-14",
      time: "11:00",
      venue: "The Glass Hall",
      note: "The promise, kept short, then everyone may look up.",
      live: true,
    },
    {
      id: "celebration",
      name: "Celebration",
      date: "2026-11-14",
      time: "16:00",
      venue: "The lawn",
      note: "Music and a walk outside before dinner.",
      live: false,
    },
    {
      id: "dinner",
      name: "Dinner",
      date: "2026-11-14",
      time: "19:30",
      venue: "The long table",
      note: "Speeches stay under four minutes.",
      live: false,
    },
  ],
  posts: [
    {
      id: "p1",
      atLabel: "10:48 AM",
      author: "Wedding team",
      circle: "Wedding team",
      kind: "announcement",
      text: "The ceremony is in the Glass Hall at 11:00. Seats in front are for the grandparents.",
      images: [],
      functionId: "ceremony",
      audience: "Both",
    },
    {
      id: "p2",
      atLabel: "9:55 AM",
      author: "June Park",
      circle: "Friends",
      kind: "photos",
      text: "They are inside. Lila is the one with the ribbon.",
      images: [hall],
      functionId: "ceremony",
    },
    {
      id: "p3",
      atLabel: "Yesterday",
      author: "Pip Alvarez",
      circle: "Friends",
      kind: "photos",
      text: "Dinner table, before anyone sat down.",
      images: [dinner],
      functionId: "dinner",
    },
    {
      id: "p4",
      atLabel: "4:20 PM",
      author: "Ren Cole",
      circle: "Friends",
      kind: "photos",
      text: "The first dance is just the two of them.",
      images: [dance],
      functionId: "celebration",
    },
  ],
  guests: [
    { id: "g1", name: "Lila Fern", side: "Bride", group: "Bride's family", rsvp: "yes", count: 1, joined: true, arrived: true, contributor: true },
    { id: "g2", name: "Nico Vale", side: "Groom", group: "Groom's family", rsvp: "yes", count: 1, joined: true, arrived: true, contributor: true },
    { id: "g3", name: "June Park", side: "Both", group: "Friends", rsvp: "yes", count: 1, joined: true, arrived: true, contributor: true },
    { id: "g4", name: "Ren Cole", side: "Both", group: "Friends", rsvp: "yes", count: 1, joined: true, arrived: true, contributor: true },
    { id: "g5", name: "Pip Alvarez", side: "Both", group: "Friends", rsvp: "yes", count: 1, joined: true, arrived: true, contributor: true },
    { id: "g6", name: "Theo Blake", side: "Both", group: "Friends", rsvp: "yes", count: 1, joined: true, arrived: false, contributor: false },
    { id: "g7", name: "Mara Quinn", side: "Bride", group: "Bride's family", rsvp: "maybe", count: 2, joined: true, arrived: false, contributor: false },
    { id: "g8", name: "Wren Hall", side: "Team", group: "Wedding team", rsvp: "yes", count: 1, joined: true, arrived: true, contributor: true },
    { id: "g9", name: "Uncle from the coast", side: "Groom", group: "Groom's family", rsvp: "no", count: 2, joined: true, arrived: false, contributor: false },
    { id: "g10", name: "Sable Ito", side: "Bride", group: "Cousins", rsvp: "pending", count: 1, joined: false, arrived: false, contributor: false },
  ],
  chats: [
    {
      id: "family-a",
      name: "Bride's family",
      hint: "Morning timing and who is collecting people.",
      messages: [
        { id: "m1", author: "Lila Fern", text: "I am fine. Tell the cousins the hall opens at 10:30.", atLabel: "8:05 AM" },
        { id: "m2", author: "Mara Quinn", text: "We are ten minutes out.", atLabel: "10:12 AM" },
      ],
    },
    {
      id: "family-b",
      name: "Groom's family",
      hint: "Where the grandparents will sit.",
      messages: [
        { id: "m3", author: "Nico Vale", text: "Front row is for the grandparents. Hold it.", atLabel: "10:30 AM" },
      ],
    },
    {
      id: "friends",
      name: "Friends",
      hint: "The unofficial channel. It is still inside the wedding.",
      messages: [
        { id: "m4", author: "Pip Alvarez", text: "I used the posting code. Photos are going in the feed.", atLabel: "9:40 AM" },
        { id: "m5", author: "Theo Blake", text: "I can see everything. I do not have a code, so I am just watching.", atLabel: "9:48 AM" },
      ],
    },
    {
      id: "team",
      name: "Wedding team",
      hint: "Wren, the drivers, and the two co-hosts.",
      messages: [
        { id: "m6", author: "Wren Hall", text: "If dinner runs long, speeches move to 8:15.", atLabel: "9:05 AM" },
        { id: "m7", author: "June Park", text: "I can change the ceremony time if the hall asks.", atLabel: "9:16 AM" },
      ],
    },
  ],
  enquiries: [],
  tasks: [
    { id: "t1", title: "Confirm the Glass Hall timing", owner: "Wren Hall", when: "This week", done: true, category: "Venue" },
    { id: "t2", title: "Print the invitation QR", owner: "Lila Fern", when: "Before Friday", done: false, category: "Invitations" },
    { id: "t3", title: "Guest bus from the hotel", owner: "Ren Cole", when: "14 Nov, morning", done: false, category: "Transportation" },
  ],
  shortlist: ["noor", "frame"],
  places: [
    { id: "pl1", name: "The Glass Hall", kind: "Ceremony", detail: "Cedar Bay. Ceremony at 11:00.", image: hall },
    { id: "pl2", name: "The long table", kind: "Dinner", detail: "Same building, after the celebration.", image: dinner },
    { id: "pl3", name: "Hotel porch", kind: "Rooms", detail: "Friends staying over. The bus leaves from here." },
  ],
  privacy: { join: "link", post: "everyone", live: "hosts", download: true, upload: "everyone" },
  liveNotes: [
    { id: "ln1", author: "Theo Blake", text: "Watching from the hotel. The picture is clear.", atLabel: "11:02 AM" },
    { id: "ln2", author: "Pip Alvarez", text: "In the hall. I will post after the promise.", atLabel: "11:06 AM" },
  ],
  sharingLocation: false,
  contactEmail: "lila@example.com",
  contactPhone: "9812345678",
  payment: { status: "paid", reference: "WC-SAMPLE", provider: "preview", method: "upi", upiApp: "GPay" },
};

export function blankChats(): Wedding["chats"] {
  return [
    { id: "family-a", name: "Bride's family", hint: "Private to this side.", messages: [] },
    { id: "family-b", name: "Groom's family", hint: "Private to this side.", messages: [] },
    { id: "cousins", name: "Cousins", hint: "The unofficial channel.", messages: [] },
    { id: "friends", name: "Friends", hint: "People who are not in the family threads.", messages: [] },
    { id: "team", name: "Wedding team", hint: "Planner, family leads, transport.", messages: [] },
  ];
}
