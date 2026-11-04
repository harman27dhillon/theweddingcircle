export type CultureLook = "plain" | "sikh" | "hindu" | "hindu-south" | "hindu-east" | "muslim" | "christian" | "buddhist";

export type CultureMatch = {
  look: CultureLook;
  label: string;
  rite: string;
};

const STATES: { test: RegExp; look: CultureLook; label: string; rite: string }[] = [
  { test: /punjab|chandigarh|amritsar|ludhiana|jalandhar|patiala|mohali|bathinda/, look: "sikh", label: "Punjab", rite: "Sikh wedding" },
  { test: /uttar pradesh|lucknow|noida|kanpur|varanasi|agra|prayagraj|ghaziabad|meerut/, look: "hindu", label: "Uttar Pradesh", rite: "Hindu wedding" },
  { test: /uttarakhand|dehradun|haridwar|nainital/, look: "hindu", label: "Uttarakhand", rite: "Hindu wedding" },
  { test: /haryana|gurgaon|gurugram|faridabad|panipat/, look: "hindu", label: "Haryana", rite: "Hindu wedding" },
  { test: /delhi/, look: "hindu", label: "Delhi", rite: "Hindu wedding" },
  { test: /himachal|shimla|dharamshala/, look: "hindu", label: "Himachal Pradesh", rite: "Hindu wedding" },
  { test: /rajasthan|jaipur|udaipur|jodhpur|jaisalmer|bikaner/, look: "hindu", label: "Rajasthan", rite: "Hindu wedding" },
  { test: /gujarat|ahmedabad|surat|vadodara|rajkot/, look: "hindu", label: "Gujarat", rite: "Hindu wedding" },
  { test: /madhya|bhopal|indore|gwalior/, look: "hindu", label: "Madhya Pradesh", rite: "Hindu wedding" },
  { test: /bihar|patna|gaya/, look: "hindu", label: "Bihar", rite: "Hindu wedding" },
  { test: /jharkhand|ranchi|jamshedpur/, look: "hindu", label: "Jharkhand", rite: "Hindu wedding" },
  { test: /chhattisgarh|raipur/, look: "hindu", label: "Chhattisgarh", rite: "Hindu wedding" },
  { test: /maharashtra|mumbai|pune|nagpur|nashik/, look: "hindu", label: "Maharashtra", rite: "Hindu wedding" },
  { test: /tamil|chennai|coimbatore|madurai|puducherry|pondicherry/, look: "hindu-south", label: "Tamil Nadu", rite: "Hindu wedding" },
  { test: /kerala|kochi|thiruvananthapuram|kozhikode/, look: "hindu-south", label: "Kerala", rite: "Hindu wedding" },
  { test: /karnataka|bengaluru|bangalore|mysuru|mangaluru/, look: "hindu-south", label: "Karnataka", rite: "Hindu wedding" },
  { test: /andhra|visakhapatnam|vijayawada|amaravati/, look: "hindu-south", label: "Andhra Pradesh", rite: "Hindu wedding" },
  { test: /telangana|hyderabad/, look: "hindu-south", label: "Telangana", rite: "Hindu wedding" },
  { test: /west bengal|kolkata|calcutta|howrah|bengal/, look: "hindu-east", label: "West Bengal", rite: "Hindu wedding" },
  { test: /odisha|bhubaneswar|cuttack/, look: "hindu-east", label: "Odisha", rite: "Hindu wedding" },
  { test: /assam|guwahati/, look: "hindu-east", label: "Assam", rite: "Hindu wedding" },
  { test: /tripura|agartala/, look: "hindu-east", label: "Tripura", rite: "Hindu wedding" },
  { test: /ladakh|leh/, look: "buddhist", label: "Ladakh", rite: "Buddhist wedding" },
  { test: /kashmir|srinagar|jammu/, look: "muslim", label: "Jammu and Kashmir", rite: "Muslim wedding" },
  { test: /goa|panaji|panjim/, look: "christian", label: "Goa", rite: "Christian wedding" },
  { test: /nagaland|kohima/, look: "christian", label: "Nagaland", rite: "Christian wedding" },
  { test: /mizoram|aizawl/, look: "christian", label: "Mizoram", rite: "Christian wedding" },
  { test: /meghalaya|shillong/, look: "christian", label: "Meghalaya", rite: "Christian wedding" },
  { test: /manipur|imphal/, look: "christian", label: "Manipur", rite: "Christian wedding" },
  { test: /sikkim|gangtok/, look: "buddhist", label: "Sikkim", rite: "Buddhist wedding" },
  { test: /arunachal|itanagar/, look: "buddhist", label: "Arunachal Pradesh", rite: "Buddhist wedding" },
];

export function cultureFromPlace(place: string): CultureMatch {
  const text = place.toLowerCase();
  const found = STATES.find((rule) => rule.test.test(text));
  if (found) return { look: found.look, label: found.label, rite: found.rite };
  if (/india/.test(text)) return { look: "hindu", label: "India", rite: "Hindu wedding" };
  return { look: "plain", label: "", rite: "" };
}

let pending: Promise<CultureMatch> | null = null;

export function detectCulture(): Promise<CultureMatch> {
  if (!pending) {
    pending = fetch("https://get.geojs.io/v1/ip/geo.json")
      .then((response) => {
        if (!response.ok) throw new Error("location unavailable");
        return response.json() as Promise<{ city?: string; region?: string; country?: string }>;
      })
      .then((data) => cultureFromPlace([data.city, data.region, data.country].filter(Boolean).join(", ")))
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}
