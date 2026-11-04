import type { CultureLook } from "@/lib/wedding/culture";

type Headwear = "veil" | "turban" | "sehra" | "jasmine" | "topi" | "topor" | "none";
type Dress = "lehenga" | "sherwani" | "sari" | "gown" | "suit" | "silk";

export function Figure({
  x,
  skin,
  hair,
  cloth,
  accent,
  dress,
  headwear,
  beard = false,
  delay = "0s",
}: {
  x: number;
  skin: string;
  hair: string;
  cloth: string;
  accent: string;
  dress: Dress;
  headwear: Headwear;
  beard?: boolean;
  delay?: string;
}) {
  const wide = dress === "lehenga" || dress === "gown" || dress === "sari" || dress === "silk";
  return (
    <g transform={`translate(${x} 438)`}>
      <g className="person-breathe" style={{ animationDelay: delay }}>
        <ellipse cx="0" cy="10" rx="48" ry="10" fill="#1c1412" opacity="0.08" />
        <path d="M-14 -8 v22 M14 -8 v22" stroke={skin} strokeWidth="9" strokeLinecap="round" />
        {wide ? (
          <path d={`M-26 -158 C-48 -90 -72 -8 -54 4 H54 C72 -8 48 -90 26 -158 Z`} fill={cloth} />
        ) : (
          <path d="M-30 -168 H30 L34 4 H-34 Z" fill={cloth} />
        )}
        {dress === "sari" || dress === "silk" ? <path d="M8 -150 L22 4" stroke={accent} strokeWidth="8" /> : null}
        {dress === "lehenga" ? <path d="M-8 -150 L-18 4 M8 -150 L18 4" stroke={accent} strokeWidth="3" opacity="0.8" /> : null}
        <path d="M-24 -172 Q0 -150 24 -172 L16 -128 H-16 Z" fill={dress === "suit" ? "#1c1412" : cloth} />
        <g className="arm-swing" style={{ animationDelay: delay }}>
          <path d="M-20 -158 C-52 -110 -40 -48 -22 -28" fill="none" stroke={cloth} strokeWidth="11" strokeLinecap="round" />
          <circle cx="-22" cy="-24" r="7" fill={skin} />
        </g>
        <path d="M20 -158 C44 -120 36 -70 22 -48" fill="none" stroke={cloth} strokeWidth="11" strokeLinecap="round" />
        <circle cx="22" cy="-44" r="7" fill={skin} />
        <rect x="-7" y="-196" width="14" height="26" rx="6" fill={skin} />
        <ellipse cx="-27" cy="-222" rx="5" ry="8" fill={skin} />
        <ellipse cx="27" cy="-222" rx="5" ry="8" fill={skin} />
        <ellipse cx="0" cy="-224" rx="26" ry="32" fill={skin} />
        <path d="M-24 -236 C-16 -268 18 -270 26 -234 C14 -250 -14 -250 -24 -236" fill={hair} />
        <path d="M-22 -230 C-28 -180 -18 -150 -8 -142" fill={hair} />
        <ellipse cx="-10" cy="-226" rx="4.2" ry="3.4" fill="#1c1412" />
        <ellipse cx="10" cy="-226" rx="4.2" ry="3.4" fill="#1c1412" />
        <circle cx="-8.6" cy="-227" r="1.2" fill="#fffdfb" />
        <circle cx="11.4" cy="-227" r="1.2" fill="#fffdfb" />
        <g className="eyelid">
          <rect x="-15" y="-232" width="11" height="9" rx="3" fill={skin} />
          <rect x="4" y="-232" width="11" height="9" rx="3" fill={skin} />
        </g>
        <path d="M-16 -236 Q-10 -242 -4 -236" fill="none" stroke={hair} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M4 -236 Q10 -242 16 -236" fill="none" stroke={hair} strokeWidth="1.7" strokeLinecap="round" />
        <path d="M0 -220 v12" stroke="#8c2f39" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
        <path d="M-7 -202 Q0 -196 7 -202" fill="none" stroke="#8c2f39" strokeWidth="1.6" strokeLinecap="round" />
        {beard ? <path d="M-18 -208 Q0 -178 18 -208 Q8 -198 -18 -208" fill={hair} /> : null}
        {headwear === "turban" ? (
          <path d="M-32 -236 C-8 -286 34 -274 32 -230 C12 -214 -18 -218 -32 -236" fill={accent} />
        ) : null}
        {headwear === "turban" ? <circle cx="0" cy="-248" r="5" fill="#a68456" /> : null}
        {headwear === "veil" ? (
          <path d="M-6 -250 C-40 -220 -46 -120 -30 -30" fill="none" stroke={accent} strokeWidth="14" strokeLinecap="round" />
        ) : null}
        {headwear === "sehra" ? (
          <g stroke={accent} strokeWidth="1.4" opacity="0.85">
            <path d="M-18 -240 v36 M-9 -246 v48 M0 -248 v52 M9 -246 v48 M18 -240 v36" />
          </g>
        ) : null}
        {headwear === "jasmine" ? (
          <g fill="#fffdfb">
            <circle cx="18" cy="-214" r="3" />
            <circle cx="20" cy="-204" r="3" />
            <circle cx="18" cy="-194" r="3" />
          </g>
        ) : null}
        {headwear === "topi" ? <path d="M-18 -246 H18 L12 -258 H-12 Z" fill={accent} /> : null}
        {headwear === "topor" ? <path d="M-16 -244 L0 -292 L16 -244 Z" fill="#fffdfb" stroke={accent} strokeWidth="2" /> : null}
        {dress === "gown" ? <path d="M-18 -168 H18 L10 -128 H-10 Z" fill="#fffdfb" /> : null}
      </g>
    </g>
  );
}

const CAST: Record<
  CultureLook,
  {
    bride: { cloth: string; accent: string; headwear: Headwear; dress: Dress };
    groom: { cloth: string; accent: string; headwear: Headwear; dress: Dress; beard?: boolean };
    hall: "mandap" | "arch" | "quiet";
  }
> = {
  sikh: {
    bride: { cloth: "#8c2f39", accent: "#a68456", headwear: "veil", dress: "lehenga" },
    groom: { cloth: "#f4efe6", accent: "#8c2f39", headwear: "turban", dress: "sherwani", beard: true },
    hall: "mandap",
  },
  hindu: {
    bride: { cloth: "#8c2f39", accent: "#a68456", headwear: "veil", dress: "lehenga" },
    groom: { cloth: "#f7efe4", accent: "#a68456", headwear: "sehra", dress: "sherwani" },
    hall: "mandap",
  },
  "hindu-south": {
    bride: { cloth: "#8c2f39", accent: "#a68456", headwear: "jasmine", dress: "silk" },
    groom: { cloth: "#f7f1ea", accent: "#a68456", headwear: "none", dress: "silk" },
    hall: "mandap",
  },
  "hindu-east": {
    bride: { cloth: "#fffdfb", accent: "#8c2f39", headwear: "veil", dress: "sari" },
    groom: { cloth: "#f7f1ea", accent: "#8c2f39", headwear: "topor", dress: "sherwani" },
    hall: "mandap",
  },
  muslim: {
    bride: { cloth: "#f4efe8", accent: "#a68456", headwear: "veil", dress: "lehenga" },
    groom: { cloth: "#6e2430", accent: "#a68456", headwear: "topi", dress: "sherwani", beard: true },
    hall: "quiet",
  },
  christian: {
    bride: { cloth: "#fffdfb", accent: "#a68456", headwear: "veil", dress: "gown" },
    groom: { cloth: "#1c1412", accent: "#f4efe8", headwear: "none", dress: "suit" },
    hall: "arch",
  },
  buddhist: {
    bride: { cloth: "#f3e4d4", accent: "#a68456", headwear: "none", dress: "silk" },
    groom: { cloth: "#f7f1ea", accent: "#8c2f39", headwear: "none", dress: "sherwani" },
    hall: "quiet",
  },
  plain: {
    bride: { cloth: "#8c2f39", accent: "#a68456", headwear: "none", dress: "gown" },
    groom: { cloth: "#1c1412", accent: "#f4efe8", headwear: "none", dress: "suit" },
    hall: "quiet",
  },
};

export function CoupleScene({ className = "", look = "plain" }: { className?: string; look?: CultureLook }) {
  const cast = CAST[look];
  return (
    <svg viewBox="0 0 800 520" className={className} role="img" aria-label="An illustrated couple">
      <rect width="800" height="520" fill="#f4efe8" />
      <rect x="0" y="400" width="800" height="120" fill="#e7d3c4" />
      {cast.hall === "mandap" ? (
        <g>
          <rect x="150" y="78" width="16" height="330" fill="#a68456" />
          <rect x="634" y="78" width="16" height="330" fill="#a68456" />
          <path d="M150 96 H650" stroke="#8c2f39" strokeWidth="18" />
          <path d="M170 96 Q400 168 630 96" fill="#8c2f39" opacity="0.35" />
        </g>
      ) : null}
      {cast.hall === "arch" ? (
        <path d="M180 390 V150 Q400 48 620 150 V390" fill="none" stroke="#fffdfb" strokeWidth="14" />
      ) : null}
      {cast.hall === "quiet" ? (
        <g fill="#a68456" opacity="0.35">
          <circle cx="180" cy="120" r="8" />
          <circle cx="620" cy="140" r="6" />
          <circle cx="400" cy="80" r="5" />
        </g>
      ) : null}
      <Figure
        x={300}
        skin="#e2b392"
        hair="#8a4b32"
        cloth={cast.bride.cloth}
        accent={cast.bride.accent}
        dress={cast.bride.dress}
        headwear={cast.bride.headwear}
      />
      <Figure
        x={500}
        skin="#c9956c"
        hair="#241814"
        cloth={cast.groom.cloth}
        accent={cast.groom.accent}
        dress={cast.groom.dress}
        headwear={cast.groom.headwear}
        beard={cast.groom.beard}
        delay="0.4s"
      />
    </svg>
  );
}
