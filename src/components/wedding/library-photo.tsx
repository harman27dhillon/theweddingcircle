import { useEffect, useState } from "react";
import { useMediaUrl } from "@/components/wedding/ui";
import { resolveLibrarySrc, useLibrary } from "@/lib/wedding/library";

function needsCatalog(src: string) {
  return src.startsWith("/library/") || src.startsWith("library:");
}

export function LibraryPhoto({ src, alt, className, priority = false }: { src: string; alt: string; className?: string; priority?: boolean }) {
  if (needsCatalog(src)) return <CatalogPhoto src={src} alt={alt} className={className} priority={priority} />;
  return <PlainPhoto src={src} alt={alt} className={className} priority={priority} />;
}

function CoverFallback({ className }: { className?: string }) {
  return <div className={className ? `cover-fallback ${className}` : "cover-fallback"} aria-hidden />;
}

function PlainPhoto({ src, alt, className, priority }: { src: string; alt: string; className?: string; priority: boolean }) {
  const resolved = useMediaUrl(src);
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <CoverFallback className={className} />;
  if (resolved.note) return <p className={className ? `${className} bg-paper px-3 py-4 text-sm text-muted` : "bg-paper px-3 py-4 text-sm text-muted"}>{resolved.note}</p>;
  if (!resolved.url) return <CoverFallback className={className} />;
  return (
    <img
      src={resolved.url}
      alt={alt}
      className={className}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      onError={() => setFailed(true)}
    />
  );
}

function CatalogPhoto({ src, alt, className, priority }: { src: string; alt: string; className?: string; priority: boolean }) {
  const { assets } = useLibrary();
  const resolved = resolveLibrarySrc(src, assets);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
  }, [resolved]);

  const shown = step === 0 ? resolved : step === 1 && resolved !== src ? src : "";
  if (!shown) return <CoverFallback className={className} />;

  return (
    <img
      src={shown}
      alt={alt}
      className={className}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      onError={() => setStep((current) => (current < 2 ? current + 1 : current))}
    />
  );
}