import { useEffect, useState } from "react";
import { toast } from "sonner";
import { generateWeddingVouchers, listWeddingVouchers, revokeWeddingVoucher } from "@/lib/wedding/vouchers.functions";

type VoucherRow = {
  id: string;
  hint: string;
  status: string;
  createdAt: string;
  expiresAt: string | null;
  redeemedAt: string | null;
  weddingId: string | null;
  weddingSlug: string | null;
};

function when(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export function DeveloperVouchers({ token }: { token: string }) {
  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [fresh, setFresh] = useState<{ code: string; hint: string }[]>([]);
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const result = await listWeddingVouchers({ data: { token } });
    if (!result.ok) {
      setError(result.error);
      setRows([]);
      return;
    }
    setError("");
    setRows(result.vouchers);
  }

  useEffect(() => {
    void load();
  }, [token]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await generateWeddingVouchers({ data: { token, count, expiresAt: "" } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setFresh(result.vouchers);
      toast(result.vouchers.length === 1 ? "Voucher generated. Copy it now — it is not shown again." : "Vouchers generated. Copy them now — they are not shown again.");
      await load();
    } catch {
      setError("The vouchers could not be generated.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast("Voucher code copied.");
    } catch {
      toast("Copy the code from the field. Clipboard access was blocked.");
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      const result = await revokeWeddingVoucher({ data: { token, id } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast("Unused voucher revoked.");
      await load();
    } catch {
      setError("That voucher could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1 className="font-serif text-4xl">Wedding vouchers</h1>
      <p className="mt-2 max-w-2xl text-sm text-on-photo/70">
        One code covers one premium wedding: ₹499, 10 GB, and a verified purchase for that wedding only. It is not a subscription and it does not make a guest premium. The full code is shown only when it is generated.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          How many
          <input
            className="mt-1 block w-24 rounded-2xl border border-on-photo/20 bg-ink px-3 py-2"
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(event) => setCount(Number(event.target.value) || 1)}
          />
        </label>
        <button type="button" disabled={busy} onClick={() => void generate()} className="min-h-11 rounded-full bg-maroon px-4 text-sm">
          {busy ? "Working…" : "Generate voucher"}
        </button>
      </div>
      {error ? <p className="mt-3 text-sm text-gold">{error}</p> : null}
      {fresh.length > 0 ? (
        <ul className="mt-4 grid gap-2">
          {fresh.map((item) => (
            <li key={item.code} className="flex flex-wrap items-center gap-3 rounded-2xl border border-gold/40 px-3 py-3">
              <code className="font-mono text-lg tracking-widest">{item.code}</code>
              <button type="button" className="min-h-11 rounded-full border border-on-photo/20 px-3 text-sm" onClick={() => void copy(item.code)}>
                Copy code
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead>
            <tr className="text-on-photo/60">
              <th className="py-2 pr-3 font-medium">Code</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Created</th>
              <th className="py-2 pr-3 font-medium">Expires</th>
              <th className="py-2 pr-3 font-medium">Redeemed</th>
              <th className="py-2 pr-3 font-medium">Wedding</th>
              <th className="py-2 font-medium"> </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-on-photo/10">
                <td className="py-2 pr-3 font-mono">····{row.hint}</td>
                <td className="py-2 pr-3 capitalize">{row.status}</td>
                <td className="py-2 pr-3">{when(row.createdAt)}</td>
                <td className="py-2 pr-3">{when(row.expiresAt)}</td>
                <td className="py-2 pr-3">{when(row.redeemedAt)}</td>
                <td className="py-2 pr-3">{row.weddingId || row.weddingSlug || "—"}</td>
                <td className="py-2">
                  {row.status === "unused" ? (
                    <button type="button" className="min-h-11 text-gold" disabled={busy} onClick={() => void revoke(row.id)}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="mt-3 text-sm text-on-photo/60">No vouchers yet.</p> : null}
      </div>
    </section>
  );
}
