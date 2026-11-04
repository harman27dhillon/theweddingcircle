import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { DISCOVER_CATEGORIES, type DiscoverCategoryId } from "@/lib/wedding/discover";
import { listDiscoverProducts } from "@/lib/wedding/discover.functions";
import { Mark } from "@/components/wedding/ui";

type Catalog = Awaited<ReturnType<typeof listDiscoverProducts>>;
type Product = Catalog extends { items: infer Items } ? (Items extends Array<infer Item> ? Item : never) : never;

function money(product: Product) {
  if (!product.priceAmount || !product.priceCurrency) return "";
  const amount = Number(product.priceAmount);
  if (!Number.isFinite(amount)) return "";
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: product.priceCurrency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${product.priceCurrency} ${product.priceAmount}`;
  }
}

export function DiscoverScreen() {
  const [category, setCategory] = useState<DiscoverCategoryId>("all");
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Product | null>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void listDiscoverProducts({ data: { category, offset: 0 } })
      .then((result) => {
        if (!live) return;
        setCatalog(result);
      })
      .catch(() => {
        if (live) setError("Discover could not be loaded. No products were invented in its place.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [category]);

  async function loadMore() {
    if (!catalog || catalog.nextOffset == null || loading) return;
    setLoading(true);
    try {
      const result = await listDiscoverProducts({ data: { category, offset: catalog.nextOffset } });
      setCatalog({ ...result, items: [...catalog.items, ...result.items] });
    } catch {
      setError("More products could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const items = catalog?.items ?? [];
  return (
    <main className="min-h-dvh bg-ivory text-ink">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 lg:max-w-6xl lg:px-8">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 font-serif">
          <Mark className="size-8" />
          The Wedding Circle
        </Link>
      </header>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 pb-16 lg:max-w-6xl lg:px-8">
        <div>
          <h1 className="font-serif text-4xl">Discover</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Bridal dresses, jewellery, makeup, footwear, and accessories. Only products returned by a connected source are shown. Nothing here is booked inside a wedding.
          </p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {DISCOVER_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === category ? "min-h-11 shrink-0 rounded-full bg-maroon px-3 text-sm text-on-photo" : "min-h-11 shrink-0 rounded-full border border-line bg-card px-3 text-sm"}
              onClick={() => {
                setSelected(null);
                setCategory(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {error ? <p className="rounded-2xl border border-line bg-card px-4 py-3 text-sm text-maroon">{error}</p> : null}
        {loading && items.length === 0 ? <p className="text-sm text-muted">Loading Discover…</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="rounded-2xl border border-line bg-card px-4 py-6 text-sm leading-relaxed text-muted">
            No products are listed{category === "all" ? "" : " in this category"}. Discovery only shows items from a connected retailer, and the bridal sources are not connected yet.
          </p>
        ) : null}
        {items.length > 0 ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((product) => {
              const price = money(product);
              return (
                <li key={product.id}>
                  <button type="button" className="flex w-full flex-col overflow-hidden rounded-2xl border border-line bg-card text-left" onClick={() => setSelected(product)}>
                    <span className="relative block aspect-square bg-paper">
                      {product.imageUrl ? (
                        <img src={product.imageUrl} alt="" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center px-3 text-center text-sm text-muted">{product.sourceLabel}</span>
                      )}
                      {product.sponsored ? <span className="absolute left-2 top-2 rounded-full bg-ivory px-2 py-1 text-xs text-ink">Sponsored</span> : null}
                    </span>
                    <span className="flex flex-col gap-1 p-3">
                      <span className="line-clamp-2 font-medium">{product.name}</span>
                      <span className="text-sm text-muted">{product.sourceLabel}</span>
                      {price ? <span className="text-sm">{price}</span> : null}
                      {product.availability === "unavailable" ? <span className="text-sm text-maroon">Unavailable</span> : null}
                      {product.trendLabel ? <span className="text-xs text-muted">{product.trendLabel}</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {catalog?.nextOffset != null ? (
          <button type="button" className="min-h-11 self-start rounded-full border border-line bg-card px-4 text-sm" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </div>
      {selected ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="discover-product-title">
          <div className="discover-detail max-h-[86dvh] w-full max-w-lg overflow-auto rounded-3xl border border-line bg-ivory p-5 text-ink lg:max-w-3xl">
            <div className="aspect-square overflow-hidden rounded-2xl bg-paper">
              {selected.imageUrl ? <img src={selected.imageUrl} alt="" className="size-full object-cover" /> : <div className="grid size-full place-items-center text-sm text-muted">{selected.sourceLabel}</div>}
            </div>
            <p className="mt-4 text-sm text-maroon">Found on {selected.sourceLabel}</p>
            <h2 id="discover-product-title" className="mt-1 font-serif text-3xl">{selected.name}</h2>
            {selected.description ? <p className="mt-2 text-sm leading-relaxed">{selected.description}</p> : null}
            {selected.availability === "unavailable" ? (
              <p className="mt-3 text-sm text-maroon">This product is unavailable. A previous price is not shown as current.</p>
            ) : money(selected) ? (
              <p className="mt-3 text-sm">Price {money(selected)}{selected.priceCheckedAt ? ` · checked ${new Date(selected.priceCheckedAt).toLocaleString()}` : ""}</p>
            ) : (
              <p className="mt-3 text-sm text-muted">No verified price is available.</p>
            )}
            {Object.keys(selected.attributes).length > 0 ? (
              <ul className="mt-3 text-sm text-muted">
                {Object.entries(selected.attributes).map(([key, value]) => (
                  <li key={key}>{key}: {value}</li>
                ))}
              </ul>
            ) : null}
            {selected.lastCheckedAt ? <p className="mt-3 text-sm text-muted">Last checked {new Date(selected.lastCheckedAt).toLocaleString()}</p> : null}
            {selected.trendOrigin ? <p className="mt-2 text-sm text-muted">{selected.trendLabel || "Trend signal"} · {selected.trendOrigin}</p> : null}
            <p className="mt-3 text-sm text-muted">The Wedding Circle does not sell this item, and the retailer has not endorsed this app.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {selected.sourceUrl ? (
                <a className="inline-flex min-h-11 items-center rounded-full bg-maroon px-4 text-sm text-on-photo" href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">
                  View original product
                </a>
              ) : (
                <p className="text-sm text-muted">No original product link was recorded.</p>
              )}
              <button type="button" className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
