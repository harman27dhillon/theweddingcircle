import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { livingStyle, type BitKind, type PageMotion } from "@/lib/wedding/backgrounds";
import { cn } from "@/lib/utils";

const SEEDS = [
  { left: "7%", delay: "0s", size: 12 },
  { left: "22%", delay: "5s", size: 16 },
  { left: "36%", delay: "2s", size: 10 },
  { left: "51%", delay: "8s", size: 14 },
  { left: "66%", delay: "3s", size: 11 },
  { left: "79%", delay: "10s", size: 18 },
  { left: "90%", delay: "6s", size: 9 },
];

export function useReducedMotion() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setOn(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);
  return on;
}

/** Plays once per page visit. Clearing the class after it finishes stops a later section change from restarting it. */
export function usePageEntrance(resetKey = "page") {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(true);
  useEffect(() => {
    if (reduce) {
      setActive(false);
      return;
    }
    setActive(true);
    const timer = window.setTimeout(() => setActive(false), 980);
    return () => window.clearTimeout(timer);
  }, [reduce, resetKey]);
  return !reduce && active ? "home-unlock" : "";
}

export function LivingCanvas({
  styleId,
  motion = "subtle",
  fixed = false,
  className,
  wash,
}: {
  styleId?: string;
  motion?: PageMotion;
  fixed?: boolean;
  className?: string;
  wash?: string;
}) {
  const style = livingStyle(styleId);
  const moving = style.animated && motion !== "static";
  const level = moving ? motion : "static";
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const canvas = (
    <div
      className={cn("living-canvas", fixed && "living-fixed", `living-${style.id}`, `living-motion-${level}`, className)}
      aria-hidden
    >
      <div className={cn("living-base", style.drift && "living-shift")} style={wash ? { background: wash } : undefined} />
      {style.id === "mehndi" || style.id === "mandala" || style.id === "phulkari" || style.id === "textile" || style.id === "paisley" || style.id === "geo" ? (
        <div className={cn("living-pattern", style.id === "mandala" && "living-spin")} />
      ) : null}
      {style.bits ? <Bits kind={style.bits} glow={style.bits === "dot" || style.bits === "star" || style.bits === "ring"} moving={moving} /> : null}
      {style.id === "clouds" ? <Clouds moving={moving} /> : null}
    </div>
  );
  if (fixed && mounted) return createPortal(canvas, document.body);
  return canvas;
}

function Bits({ kind, glow, moving }: { kind: BitKind; glow: boolean; moving: boolean }) {
  return (
    <>
      {SEEDS.map((seed, index) => (
        <span
          key={seed.left}
          className={cn("living-bit", moving && (glow ? "living-glow" : "living-fall"))}
          style={{
            left: seed.left,
            top: moving ? "-8%" : `${8 + index * 12}%`,
            width: seed.size,
            height: kind === "drop" ? seed.size * 2.4 : seed.size,
            animationDelay: seed.delay,
          }}
        >
          <Bit kind={kind} />
        </span>
      ))}
    </>
  );
}

function Clouds({ moving }: { moving: boolean }) {
  return (
    <>
      {[
        { top: "18%", left: "8%", delay: "0s" },
        { top: "46%", left: "42%", delay: "4s" },
        { top: "68%", left: "70%", delay: "2s" },
      ].map((cloud) => (
        <span
          key={cloud.left}
          className={cn("living-cloud", moving && "living-cloud-drift")}
          style={{ top: cloud.top, left: cloud.left, animationDelay: cloud.delay }}
        />
      ))}
    </>
  );
}

function Bit({ kind }: { kind: BitKind }) {
  if (kind === "heart") {
    return (
      <svg viewBox="0 0 20 18" aria-hidden>
        <path d="M10 16 C2 10 1 5 5 3 C7 2 9 4 10 6 C11 4 13 2 15 3 C19 5 18 10 10 16 Z" fill="#c96b78" />
      </svg>
    );
  }
  if (kind === "leaf") {
    return (
      <svg viewBox="0 0 16 20" aria-hidden>
        <path d="M8 1 C14 6 14 14 8 19 C2 14 2 6 8 1 Z" fill="#6e8a4e" />
      </svg>
    );
  }
  if (kind === "drop") {
    return (
      <svg viewBox="0 0 6 16" aria-hidden>
        <rect x="2" width="1.4" height="16" rx="1" fill="#7f96a3" opacity="0.55" />
      </svg>
    );
  }
  if (kind === "star") {
    return (
      <svg viewBox="0 0 12 12" aria-hidden>
        <circle cx="6" cy="6" r="2.2" fill="#f2c572" />
      </svg>
    );
  }
  if (kind === "ring") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="12" r="8" fill="none" stroke="#fff" strokeWidth="1.5" opacity="0.7" />
      </svg>
    );
  }
  if (kind === "square") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden>
        <rect x="2" y="2" width="12" height="12" fill="none" stroke="#8c2f39" strokeWidth="1" opacity="0.45" />
      </svg>
    );
  }
  if (kind === "dot") {
    return (
      <svg viewBox="0 0 16 16" aria-hidden>
        <circle cx="8" cy="8" r="5" fill="#e7c2a4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 14 18" aria-hidden>
      <ellipse cx="7" cy="9" rx="5" ry="8" fill="#d98996" />
    </svg>
  );
}
