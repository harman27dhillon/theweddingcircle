import { Figure } from "@/components/wedding/characters";
import { LibraryPhoto } from "@/components/wedding/library-photo";
import { THEME_CHOICES } from "@/lib/wedding/traditions";

export type ThemeId = (typeof THEME_CHOICES)[number]["id"];

type Cast = {
  cloth: string;
  accent: string;
  dress: "lehenga" | "sherwani" | "sari" | "gown" | "suit" | "silk";
  headwear: "veil" | "turban" | "sehra" | "jasmine" | "topi" | "topor" | "none";
  beard?: boolean;
  skin: string;
  hair: string;
};

type Look = {
  label: string;
  sky: string;
  ground: string;
  heart: string;
  petal: string;
  bride: Cast;
  groom: Cast;
  brideX: number;
  groomX: number;
  hearts: number;
  blooms: number;
  petals: number;
  arch?: boolean;
  garland?: boolean;
  lanterns?: boolean;
};

const brideLehenga: Cast = {
  cloth: "#8c2f39",
  accent: "#a68456",
  dress: "lehenga",
  headwear: "veil",
  skin: "#e2b392",
  hair: "#8a4b32",
};
const groomSherwani: Cast = {
  cloth: "#f7efe4",
  accent: "#8c2f39",
  dress: "sherwani",
  headwear: "turban",
  beard: true,
  skin: "#c9956c",
  hair: "#241814",
};

const LOOKS: Record<ThemeId, Look> = {
  hearts: {
    label: "Hearts",
    sky: "#f8efe8",
    ground: "#edd9cf",
    heart: "#8c2f39",
    petal: "#d98996",
    bride: brideLehenga,
    groom: groomSherwani,
    brideX: 310,
    groomX: 500,
    hearts: 16,
    blooms: 5,
    petals: 0,
  },
  marigolds: {
    label: "Marigolds",
    sky: "#fbf3e4",
    ground: "#e7c98a",
    heart: "#c45c2a",
    petal: "#e39b2b",
    bride: { ...brideLehenga, cloth: "#c45c2a", accent: "#f4efe8" },
    groom: { ...groomSherwani, cloth: "#f4efe8", accent: "#c45c2a", headwear: "sehra", beard: false },
    brideX: 300,
    groomX: 510,
    hearts: 6,
    blooms: 14,
    petals: 4,
  },
  jasmine: {
    label: "Jasmine",
    sky: "#f7f4ef",
    ground: "#e4ddd4",
    heart: "#8c2f39",
    petal: "#fffdfb",
    bride: { ...brideLehenga, cloth: "#8c2f39", accent: "#a68456", dress: "silk", headwear: "jasmine" },
    groom: { ...groomSherwani, cloth: "#f7f1ea", accent: "#a68456", dress: "silk", headwear: "none", beard: false },
    brideX: 305,
    groomX: 495,
    hearts: 7,
    blooms: 12,
    petals: 3,
  },
  roses: {
    label: "Roses",
    sky: "#f8eef1",
    ground: "#e7cfd6",
    heart: "#8c2f39",
    petal: "#d46a86",
    bride: { ...brideLehenga, cloth: "#fffdfb", accent: "#d46a86", dress: "gown", headwear: "veil" },
    groom: { ...groomSherwani, cloth: "#1c1412", accent: "#f4efe8", dress: "suit", headwear: "none", beard: false },
    brideX: 300,
    groomX: 505,
    hearts: 8,
    blooms: 10,
    petals: 5,
  },
  petals: {
    label: "Petals",
    sky: "#f6efe9",
    ground: "#e8d3c4",
    heart: "#a68456",
    petal: "#e7b4a0",
    bride: { ...brideLehenga, cloth: "#6e2430" },
    groom: { ...groomSherwani, headwear: "sehra", beard: false },
    brideX: 290,
    groomX: 520,
    hearts: 8,
    blooms: 6,
    petals: 14,
  },
  garland: {
    label: "Garland",
    sky: "#f7f1e8",
    ground: "#e4d2be",
    heart: "#8c2f39",
    petal: "#e39b2b",
    bride: brideLehenga,
    groom: { ...groomSherwani, headwear: "sehra", beard: false },
    brideX: 315,
    groomX: 490,
    hearts: 6,
    blooms: 12,
    petals: 2,
    garland: true,
  },
  lanterns: {
    label: "Lanterns",
    sky: "#2a211e",
    ground: "#3a2c28",
    heart: "#f2c572",
    petal: "#f4efe8",
    bride: { ...brideLehenga, cloth: "#8c2f39", accent: "#f2c572" },
    groom: { ...groomSherwani, cloth: "#f7efe4", accent: "#f2c572" },
    brideX: 300,
    groomX: 500,
    hearts: 10,
    blooms: 8,
    petals: 0,
    lanterns: true,
  },
  mehndi: {
    label: "Mehndi",
    sky: "#f3f6ee",
    ground: "#d5e0c8",
    heart: "#8c2f39",
    petal: "#6e8a4e",
    bride: { ...brideLehenga, cloth: "#6e2430", accent: "#6e8a4e" },
    groom: { ...groomSherwani, cloth: "#f7f1ea", accent: "#6e8a4e", headwear: "none", beard: false },
    brideX: 330,
    groomX: 470,
    hearts: 6,
    blooms: 13,
    petals: 3,
  },
  procession: {
    label: "Procession",
    sky: "#f8f1e6",
    ground: "#e6d2b4",
    heart: "#8c2f39",
    petal: "#e39b2b",
    bride: { ...brideLehenga, headwear: "veil" },
    groom: { ...groomSherwani, headwear: "turban" },
    brideX: 250,
    groomX: 470,
    hearts: 7,
    blooms: 11,
    petals: 8,
  },
  blessing: {
    label: "Blessing",
    sky: "#f6efe8",
    ground: "#ead8c8",
    heart: "#8c2f39",
    petal: "#fffdfb",
    bride: brideLehenga,
    groom: { ...groomSherwani, headwear: "sehra", beard: false },
    brideX: 340,
    groomX: 490,
    hearts: 9,
    blooms: 14,
    petals: 2,
    arch: true,
  },
};

const HEART_SPOTS: Array<[number, number, number]> = [
  [48, 70, 0.7],
  [120, 130, 0.5],
  [90, 210, 0.4],
  [180, 54, 0.55],
  [230, 150, 0.35],
  [40, 280, 0.45],
  [560, 60, 0.6],
  [640, 120, 0.45],
  [700, 48, 0.7],
  [740, 180, 0.4],
  [610, 200, 0.35],
  [760, 90, 0.5],
  [300, 40, 0.3],
  [460, 70, 0.35],
  [150, 300, 0.4],
  [680, 260, 0.45],
];

const BLOOM_SPOTS: Array<[number, number, number]> = [
  [54, 390, 0.7],
  [110, 400, 0.55],
  [168, 382, 0.8],
  [220, 404, 0.5],
  [620, 388, 0.75],
  [680, 402, 0.55],
  [740, 378, 0.65],
  [36, 360, 0.4],
  [260, 408, 0.45],
  [560, 406, 0.5],
  [790, 396, 0.6],
  [200, 368, 0.35],
  [500, 400, 0.4],
  [430, 410, 0.3],
];

function Heart({ x, y, scale, fill, delay }: { x: number; y: number; scale: number; fill: string; delay: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="heart-rise" style={{ animationDelay: delay }}>
        <path d="M8 14 C2 8 0 5 0 3.2 A4 4 0 0 1 8 3.2 A4 4 0 0 1 16 3.2 C16 5 14 8 8 14 Z" fill={fill} />
      </g>
    </g>
  );
}

function Bloom({ x, y, scale, petal, delay }: { x: number; y: number; scale: number; petal: string; delay: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="flower-sway" style={{ animationDelay: delay }}>
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <ellipse key={angle} cx="0" cy="-9" rx="4.2" ry="7" fill={petal} transform={`rotate(${angle})`} />
        ))}
        <circle r="3.4" fill="#a68456" />
      </g>
    </g>
  );
}

function Petal({ x, y, fill, delay }: { x: number; y: number; fill: string; delay: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className="petal-drift" style={{ animationDelay: delay }}>
        <ellipse rx="5" ry="9" fill={fill} />
      </g>
    </g>
  );
}

export function ThemeScene({ id, className = "", label }: { id: string; className?: string; label?: string }) {
  const look = LOOKS[id as ThemeId] ?? LOOKS.hearts;
  return (
    <svg
      viewBox="0 0 800 520"
      preserveAspectRatio="xMidYMid slice"
      className={className}
      role="img"
      aria-label={label ?? `${look.label} theme`}
    >
      <rect width="800" height="520" fill={look.sky} />
      <rect y="408" width="800" height="112" fill={look.ground} />
      {look.arch ? (
        <g fill="none" stroke={look.petal} strokeWidth="10" opacity="0.9">
          <path d="M180 400 V180 Q400 70 620 180 V400" />
        </g>
      ) : null}
      {look.lanterns
        ? [180, 400, 620].map((x, i) => (
            <g key={x} transform={`translate(${x} 0)`}>
              <g className="heart-rise" style={{ animationDelay: `${i * 0.4}s` }}>
                <path d="M0 20 V70" stroke="#f2c572" strokeWidth="2" />
                <ellipse cx="0" cy="92" rx="16" ry="22" fill="#f2c572" />
                <ellipse cx="0" cy="92" rx="8" ry="12" fill="#8c2f39" opacity="0.35" />
              </g>
            </g>
          ))
        : null}
      {BLOOM_SPOTS.slice(0, look.blooms).map(([x, y, scale], i) => (
        <Bloom key={`b${x}`} x={x} y={y} scale={scale} petal={i % 3 === 0 ? "#fffdfb" : look.petal} delay={`${(i % 5) * 0.25}s`} />
      ))}
      {look.garland ? (
        <g>
          <path d="M330 250 Q400 300 470 250" fill="none" stroke="#6e8a4e" strokeWidth="3" />
          {[340, 370, 400, 430, 460].map((x, i) => (
            <Bloom key={x} x={x} y={268 - (i === 2 ? 0 : 8)} scale={0.45} petal={look.petal} delay={`${i * 0.15}s`} />
          ))}
        </g>
      ) : null}
      <Figure
        x={look.brideX}
        skin={look.bride.skin}
        hair={look.bride.hair}
        cloth={look.bride.cloth}
        accent={look.bride.accent}
        dress={look.bride.dress}
        headwear={look.bride.headwear}
      />
      <Figure
        x={look.groomX}
        skin={look.groom.skin}
        hair={look.groom.hair}
        cloth={look.groom.cloth}
        accent={look.groom.accent}
        dress={look.groom.dress}
        headwear={look.groom.headwear}
        beard={look.groom.beard}
        delay="0.45s"
      />
      {HEART_SPOTS.slice(0, look.hearts).map(([x, y, scale], i) => (
        <Heart key={`h${x}`} x={x} y={y} scale={scale} fill={i % 2 ? look.heart : "#a68456"} delay={`${(i % 6) * 0.28}s`} />
      ))}
      {Array.from({ length: look.petals }, (_, i) => (
        <Petal key={`p${i}`} x={80 + ((i * 97) % 640)} y={40 + ((i * 53) % 220)} fill={look.petal} delay={`${(i % 7) * 0.35}s`} />
      ))}
    </svg>
  );
}

export function CoverVisual({ src, alt, className, priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  if (src.startsWith("theme:")) {
    return <ThemeScene id={src.slice(6)} className={className} label={alt || "Wedding theme"} />;
  }
  return <LibraryPhoto src={src} alt={alt} className={className} priority={priority} />;
}
