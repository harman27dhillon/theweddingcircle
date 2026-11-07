import { themeUsesCeremonyCovers } from "./card-themes.ts";

/** Built-in ceremony pictures. Each file belongs to one ceremony and is not reused. */
export const CEREMONY_COVERS = {
	haldi: "/ceremony-covers/haldi.webp",
	mehndi: "/ceremony-covers/mehndi.webp",
	engagement: "/ceremony-covers/engagement.webp",
	sangeet: "/ceremony-covers/sangeet.webp",
	jaggo: "/ceremony-covers/jaggo.webp",
	chooda: "/ceremony-covers/chooda.webp",
	shagun: "/ceremony-covers/shagun.webp",
	baraat: "/ceremony-covers/baraat.webp",
	nikah: "/ceremony-covers/nikah.webp",
	"anand-karaj": "/ceremony-covers/anand-karaj.webp",
	paath: "/ceremony-covers/paath.webp",
	church: "/ceremony-covers/church.webp",
	phere: "/ceremony-covers/phere.webp",
	walima: "/ceremony-covers/walima.webp",
	reception: "/ceremony-covers/reception.webp",
	doli: "/ceremony-covers/doli.webp"
};
/** Quiet floral picture for a ceremony name that matches none of the known ones. */
export type CeremonyCoverKind = keyof typeof CEREMONY_COVERS;
export type CeremonyCoverChoice = CeremonyCoverKind | "none";

export const GENERIC_CEREMONY_COVER = "/ceremony-covers/generic.webp";
export const CEREMONY_COVER_LIMIT = 350_000;
export const CEREMONY_PICTURE_ORDER = [
	"haldi",
	"mehndi",
	"engagement",
	"sangeet",
	"jaggo",
	"chooda",
	"shagun",
	"baraat",
	"nikah",
	"anand-karaj",
	"paath",
	"church",
	"phere",
	"walima",
	"reception",
	"doli"
] as const satisfies readonly CeremonyCoverKind[];
export const CEREMONY_PICTURE_LABELS = {
	haldi: "Haldi",
	mehndi: "Mehndi / Henna",
	engagement: "Engagement / Roka",
	sangeet: "Sangeet",
	jaggo: "Jaggo",
	chooda: "Chooda",
	shagun: "Shagun",
	baraat: "Baraat",
	nikah: "Nikah",
	"anand-karaj": "Anand Karaj",
	paath: "Paath",
	church: "Church ceremony",
	phere: "Pheere",
	walima: "Walima",
	reception: "Reception",
	doli: "Doli"
};
/**
 * Default ceremony pictures are a classic-theme setting.
 * The flag lives on the theme record. An empty or unknown id stays plain.
 */
export function isClassicCeremonyTheme(themeId?: string | null) {
	return themeUsesCeremonyCovers(themeId);
}
var ALIASES: Record<CeremonyCoverKind, readonly string[]> = {
	haldi: [
		"haldi",
		"haldhi",
		"huldi",
		"haldi ceremony",
		"haldi night",
		"haldi function",
		"haldi rasam",
		"pithi",
		"pitthi",
		"mandha",
		"ubtan"
	],
	mehndi: [
		"mehndi",
		"mehendi",
		"mehandi",
		"mehnadi",
		"mehandhi",
		"mendhi",
		"mahendi",
		"henna",
		"heena",
		"hinna",
		"henne",
		"hina",
		"henna ceremony",
		"henna night",
		"henna party",
		"henna function",
		"mehndi night",
		"mehndi raat",
		"mehndi rasam",
		"mehndi ceremony",
		"mehndi function",
		"mehndi ki raat",
		"raat ki mehndi",
		"laylat al henna",
		"lailat al henna",
		"laylat al hina",
		"lailat al hinna",
		"kina gecesi",
		"maruthani",
		"mailanchi",
		"madarangi",
		"gorintaku"
	],
	engagement: [
		"engagement",
		"engagement ceremony",
		"roka",
		"rokka",
		"sagai",
		"mangni",
		"mangani",
		"ring ceremony"
	],
	sangeet: [
		"sangeet",
		"sangit",
		"sangeet night",
		"sangeet ceremony",
		"sangeet function",
		"goan sangeet"
	],
	jaggo: [
		"jaggo",
		"jaago",
		"jago",
		"jaggo night",
		"jaggo ceremony"
	],
	chooda: [
		"chooda",
		"chooda ceremony",
		"chooda rasam",
		"chura",
		"chura ceremony",
		"choora"
	],
	shagun: [
		"shagun",
		"sagun",
		"shagun ceremony",
		"shagun rasam",
		"shagun thali",
		"sagun ceremony"
	],
	baraat: [
		"baraat",
		"barat",
		"baarat",
		"baraat ceremony",
		"ghodi",
		"ghodi ceremony"
	],
	nikah: [
		"nikah",
		"nikaah",
		"nikkah",
		"nikha",
		"nekah",
		"nikah ceremony",
		"nikah nama",
		"nikkah ceremony",
		"aqd nikah",
		"aqdun nikah",
		"aqd al nikah",
		"katb kitab",
		"katb al kitab",
		"katb el kitab",
		"katb ketab",
		"ijab qabool",
		"ijab e qabool"
	],
	"anand-karaj": [
		"anand karaj",
		"anand kaaraj",
		"anandkaraj",
		"anand karaj sahib",
		"laavan",
		"lavaan",
		"lavan",
		"char lavan",
		"char laavan"
	],
	paath: [
		"paath",
		"paath sahib",
		"paath ceremony",
		"akhand paath",
		"akhand path",
		"sukhmani",
		"sukhmani sahib",
		"path ceremony"
	],
	church: [
		"church",
		"church ceremony",
		"church wedding",
		"christian wedding",
		"christian ceremony",
		"nuptial mass",
		"holy matrimony"
	],
	phere: [
		"phere",
		"pheere",
		"pheras",
		"saat phere",
		"saat pheras",
		"sat phere",
		"seven pheras",
		"seven phere",
		"phera ceremony"
	],
	walima: [
		"walima",
		"walimah",
		"valima",
		"valimah",
		"walima dinner"
	],
	reception: [
		"reception",
		"wedding reception",
		"reception night",
		"grand reception"
	],
	doli: [
		"doli",
		"doli ceremony",
		"doli rasam",
		"doli night",
		"doli vidaai",
		"vidaai",
		"vidai",
		"vidaayi",
		"bidaai",
		"bidai",
		"rukhsati",
		"rukhsat",
		"rukhsti"
	]
};
export function normalizeCeremonyName(value: string) {
	return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ı/g, "i").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
function includesPhrase(tokens: string[], phrase: string[]) {
	if (phrase.length === 0 || phrase.length > tokens.length) return false;
	for (let i = 0; i <= tokens.length - phrase.length; i += 1) {
		let same = true;
		for (let j = 0; j < phrase.length; j += 1) if (tokens[i + j] !== phrase[j]) {
			same = false;
			break;
		}
		if (same) return true;
	}
	return false;
}
/** Known aliases only. Two different ceremonies in one name stay unresolved. */
export function matchCeremonyName(name: string): { kind: CeremonyCoverKind } | { ambiguous: true } | null {
	const tokens = normalizeCeremonyName(name).split(" ").filter(Boolean);
	if (tokens.length === 0) return null;
	const found: CeremonyCoverKind[] = [];
	for (const kind of Object.keys(ALIASES) as CeremonyCoverKind[]) if (ALIASES[kind].some((alias) => {
		const parts = alias.split(" ").filter(Boolean);
		if (parts.length === 1 && parts[0].length < 4) return tokens.length === 1 && tokens[0] === parts[0];
		return includesPhrase(tokens, parts);
	})) found.push(kind);
	if (found.length === 1) return { kind: found[0] };
	if (found.length > 1) return { ambiguous: true };
	return null;
}
var KIND_VALUES = new Set(Object.keys(CEREMONY_COVERS));
export function ceremonyCoverKindOf(value: unknown): CeremonyCoverChoice | undefined {
	if (value === "none") return "none";
	if (typeof value === "string" && KIND_VALUES.has(value)) return value as CeremonyCoverChoice;
}
export function ceremonyCoverValue(value: unknown) {
	if (typeof value !== "string") return undefined;
	const src = value.trim();
	if (!src) return undefined;
	if (/^\/ceremony-covers\/[a-z0-9.-]+$/.test(src) && src.length < 80) return src;
	if (/^idb:[0-9a-f-]{36}$/i.test(src)) return src;
	if (src.startsWith("data:image/jpeg;base64,") && src.length <= CEREMONY_COVER_LIMIT && src.length > 40) return src;
}
type CoverInput = {
	name: string;
	cover?: string;
	coverKind?: string;
};

/**
 * Picture for one ceremony bar.
 * A custom cover or an explicit picture choice wins on every theme.
 * Name defaults and the generic picture are only for themes that enable ceremony covers.
 */
export function ceremonyCoverFor(fn: CoverInput, themeId?: string | null) {
	const custom = ceremonyCoverValue(fn.cover);
	if (custom) return custom;
	if (fn.coverKind === "none") return null;
	const chosen = ceremonyCoverKindOf(fn.coverKind);
	if (chosen && chosen !== "none") return CEREMONY_COVERS[chosen];
	if (!isClassicCeremonyTheme(themeId)) return null;
	const match = matchCeremonyName(fn.name);
	if (match && "ambiguous" in match) return null;
	if (!match) return GENERIC_CEREMONY_COVER;
	return CEREMONY_COVERS[match.kind];
}
