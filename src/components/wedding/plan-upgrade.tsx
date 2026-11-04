import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/wedding/ui";
import { isCircleOwner, coupleTitle } from "@/lib/wedding/format";
import { PREMIUM_STORAGE_LABEL, isPremiumWedding } from "@/lib/wedding/plan";
import { PREMIUM_THEME_COUNT } from "@/lib/wedding/card-themes";
import { CIRCLE_FEE_PAISE, chargeCircle } from "@/lib/wedding/payments";
import { useWeddingStore } from "@/lib/wedding/store";
import type { Wedding } from "@/lib/wedding/types";

export function PremiumUpgrade({ wedding }: { wedding: Wedding }) {
  const account = useWeddingStore((s) => s.account);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const owner = Boolean(account?.email && wedding.ownerEmail && wedding.ownerEmail.toLowerCase() === account.email.toLowerCase()) || isCircleOwner(wedding);
  if (isPremiumWedding(wedding) || !owner) return null;
  async function pay(simulate: "paid" | "failed") {
    setBusy(true);
    setFailed(false);
    const result = await chargeCircle(
      {
        amountInPaise: CIRCLE_FEE_PAISE,
        currency: "INR",
        description: coupleTitle(wedding),
        method: "upi",
        upiApp: "GPay",
      },
      simulate,
    );
    if (result.status !== "paid") {
      setFailed(true);
      setBusy(false);
      return;
    }
    setBusy(false);
    toast("Nothing was charged. Google Play Billing is not connected, so this preview cannot unlock Premium.");
    setOpen(false);
  }
  return (
    <div className="mt-3">
      <button type="button" className="min-h-11 text-sm text-maroon" onClick={() => setOpen(true)}>
        Upgrade · ₹499 once
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 md:items-center" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
          <div className="w-full max-w-md rounded-card border border-line bg-ivory p-4 text-ink">
            <h2 id="upgrade-title" className="font-serif text-2xl">Premium · ₹499</h2>
            <p className="mt-2 text-sm text-muted">One-time for this wedding. Not a subscription. {PREMIUM_STORAGE_LABEL} of storage and {PREMIUM_THEME_COUNT} premium themes, after a verified purchase. One live stream at a time. This preview does not charge you.</p>
            {failed ? <p className="mt-3 text-sm text-maroon">Payment was not completed. This wedding is still Free.</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" disabled={busy} onClick={() => void pay("paid")}>{busy ? "Processing" : "Pay ₹499"}</Button>
              <Button type="button" variant="line" disabled={busy} onClick={() => void pay("failed")}>Preview a failed payment</Button>
              <Button type="button" variant="line" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
