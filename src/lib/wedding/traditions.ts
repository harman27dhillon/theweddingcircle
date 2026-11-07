export type SuggestedFunction = {
  name: string;
  note: string;
  time: string;
};

const TIMES = ["10:00", "11:00", "14:00", "16:00", "18:00", "19:30"];

const FUNCTION_NOTES: Record<string, string> = {
  Engagement: "A small promise, before the bigger days.",
  Roka: "Both families sit together. Keep the guest list short.",
  Mehndi: "Henna for the bride's side. The time should be the time you mean.",
  Haldi: "A short ceremony. Clothes that can take turmeric.",
  Sangeet: "Music after dinner. Leave a seat for the grandparents.",
  Jaggo: "A late night for the family that wants it. Not everyone has to stay.",
  "Anand Karaj": "The ceremony itself. Seats in front are for the elders.",
  "Wedding ceremony": "The rite your family actually uses. Confirm who sits in front.",
  Nikah: "The ceremony. Confirm the time with the person leading it.",
  Baraat: "The arrival. Tell the hall when the procession will actually enter.",
  Phere: "The vows. Keep the aisle clear.",
  "Kanyadaan": "A family moment. It does not need a crowd.",
  Vidaai: "The farewell. Give the families a quiet minute.",
  Reception: "Dinner and greetings. Speeches stay short.",
  Walima: "The celebration meal after the ceremony.",
  "Church ceremony": "Confirm the service time and who reads.",
  "Wedding mass": "The service, then everyone moves to the meal.",
  Pheras: "The circling of the fire. Confirm the priest's time.",
  "Mandap ceremony": "The ceremony under the mandap.",
  Garba: "An evening of dance before the wedding day.",
  "Mehendi": "Henna for the bride's side. The time should be the time you mean.",
};

const FALLBACK = ["Welcome", "Ceremony", "Celebration", "Dinner"];

const BY_KEY: Record<string, string[]> = {
  "sikh|punjabi": ["Roka", "Mehndi", "Haldi", "Sangeet", "Jaggo", "Baraat", "Anand Karaj", "Reception", "Vidaai"],
  "sikh|": ["Roka", "Mehndi", "Anand Karaj", "Reception", "Vidaai"],
  "hindu|punjabi": ["Roka", "Mehndi", "Haldi", "Sangeet", "Baraat", "Wedding ceremony", "Reception", "Vidaai"],
  "hindu|north indian": ["Roka", "Mehndi", "Haldi", "Sangeet", "Baraat", "Phere", "Reception", "Vidaai"],
  "hindu|south indian": ["Engagement", "Mehndi", "Haldi", "Wedding ceremony", "Reception"],
  "hindu|tamil": ["Engagement", "Mehndi", "Wedding ceremony", "Reception"],
  "hindu|telugu": ["Engagement", "Mehndi", "Haldi", "Wedding ceremony", "Reception"],
  "hindu|malayalam": ["Engagement", "Mehndi", "Wedding ceremony", "Reception"],
  "hindu|kannada": ["Engagement", "Mehndi", "Wedding ceremony", "Reception"],
  "hindu|gujarati": ["Engagement", "Garba", "Mehndi", "Haldi", "Wedding ceremony", "Reception"],
  "hindu|rajasthani": ["Roka", "Mehndi", "Haldi", "Baraat", "Phere", "Reception"],
  "hindu|bengali": ["Engagement", "Mehndi", "Wedding ceremony", "Reception"],
  "hindu|marathi": ["Engagement", "Mehndi", "Haldi", "Wedding ceremony", "Reception"],
  "hindu|assamese": ["Engagement", "Mehndi", "Wedding ceremony", "Reception"],
  "hindu|": ["Engagement", "Mehndi", "Haldi", "Wedding ceremony", "Reception"],
  "muslim|kashmiri": ["Engagement", "Mehndi", "Nikah", "Walima"],
  "muslim|": ["Engagement", "Mehndi", "Nikah", "Walima"],
  "christian|": ["Engagement", "Church ceremony", "Reception"],
  "jain|": ["Engagement", "Mehndi", "Wedding ceremony", "Reception"],
  "buddhist|": ["Engagement", "Wedding ceremony", "Reception"],
  "other|": FALLBACK,
};

export function suggestFunctions(religion: string, region: string): SuggestedFunction[] {
  const r = religion.toLowerCase();
  const g = region.toLowerCase();
  const names =
    BY_KEY[`${r}|${g}`] ??
    BY_KEY[`${r}|`] ??
    (r === "hindu" ? BY_KEY["hindu|punjabi"] : undefined) ??
    FALLBACK;
  return names.map((name, i) => ({
    name,
    note: FUNCTION_NOTES[name] ?? "Add the detail your family actually uses.",
    time: TIMES[i % TIMES.length] ?? "11:00",
  }));
}

export const WEDDING_TYPES = ["Traditional", "Modern", "Intimate", "Destination", "Interfaith", "Other"] as const;

export const CHECKLIST: { category: string; title: string }[] = [
  { category: "Venue", title: "Confirm the ceremony and reception halls" },
  { category: "Invitations", title: "Send the private link and print the QR" },
  { category: "Catering", title: "Lock the menu and the guest count" },
  { category: "Clothing", title: "Final fittings for the couple" },
  { category: "Jewellery", title: "Decide what is worn, and what stays at home" },
  { category: "Photography", title: "Share the function times with the photographer" },
  { category: "Decoration", title: "Approve the look for the ceremony" },
  { category: "Music", title: "Procession, ceremony, and reception — three different volumes" },
  { category: "Transportation", title: "Guest arrival and the bus" },
  { category: "Accommodation", title: "Rooms for people travelling in" },
  { category: "Ceremony arrangements", title: "Confirm the rite, the timing, and who sits in front" },
];

export const RELATIONSHIPS = [
  "Family",
  "Friends",
  "College friends",
  "Cousins",
  "Colleague",
  "Wedding team",
] as const;

export const RELIGIONS = ["Sikh", "Hindu", "Muslim", "Christian", "Jain", "Buddhist", "Other"] as const;

export const REGIONS = [
  "Punjabi",
  "North Indian",
  "South Indian",
  "Gujarati",
  "Rajasthani",
  "Bengali",
  "Marathi",
  "Kashmiri",
  "Tamil",
  "Telugu",
  "Malayalam",
  "Kannada",
  "Assamese",
  "Other",
] as const;

export const THEME_CHOICES = [
  { id: "hearts", label: "Hearts" },
  { id: "marigolds", label: "Marigolds" },
  { id: "jasmine", label: "Jasmine" },
  { id: "roses", label: "Roses" },
  { id: "petals", label: "Petals" },
  { id: "garland", label: "Garland" },
  { id: "lanterns", label: "Lanterns" },
  { id: "mehndi", label: "Mehndi" },
  { id: "procession", label: "Procession" },
  { id: "blessing", label: "Blessing" },
] as const;

export const THEME_SRCS = new Set<string>(THEME_CHOICES.map((item) => `theme:${item.id}`));
