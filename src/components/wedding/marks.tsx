import type { Wedding } from "@/lib/wedding/types";
import { personMarks, type BadgeKind } from "@/lib/wedding/format";
import { cn } from "@/lib/utils";

export function Crown({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-3.5 shrink-0", className)} aria-hidden="true">
      <path d="M2 12.5h12L13 6.2 10 9 8 4 6 9 3 6.2 2 12.5z" fill="var(--color-gold)" />
      <path d="M2.5 13.6h11" stroke="var(--color-gold)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function RoleBadge({ kind }: { kind: BadgeKind }) {
  const label = kind === "gold" ? "Host" : kind === "silver" ? "Co-host" : kind === "diamond" ? "Family" : "Guest";
  if (kind === "diamond") {
    return (
      <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" role="img" aria-label={label}>
        <path d="M8 1.5 14 6.5 8 14.5 2 6.5 8 1.5z" fill="#f4efe8" stroke="var(--color-gold)" strokeWidth="1.2" />
        <path d="M2 6.5h12M8 1.5 6 6.5 8 14.5 10 6.5 8 1.5" fill="none" stroke="var(--color-gold)" strokeWidth="0.8" />
      </svg>
    );
  }
  const fill = kind === "gold" ? "var(--color-gold)" : kind === "silver" ? "#c5c1b8" : "#8c5a3c";
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" role="img" aria-label={label}>
      <circle cx="8" cy="8" r="6" fill={fill} />
      <circle cx="8" cy="8" r="2.4" fill="none" stroke="#fffdfb" strokeWidth="1.1" />
    </svg>
  );
}

export function PersonName({
  wedding,
  name,
  className,
}: {
  wedding: Wedding;
  name: string;
  className?: string;
}) {
  const marks = personMarks(wedding, name);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {marks.crown ? <Crown /> : null}
      <RoleBadge kind={marks.badge} />
      <span>{name}</span>
    </span>
  );
}
