import type { Payment } from "@/lib/wedding/types";

export type PayMethod = "credit" | "debit" | "upi";

export type PaymentIntent = {
  amountInPaise: number;
  currency: "INR";
  description: string;
  method: PayMethod;
  upiApp?: string;
};

export async function chargeCircle(
  intent: PaymentIntent,
  simulate: "paid" | "failed",
): Promise<Payment> {
  await new Promise((resolve) => window.setTimeout(resolve, 700));
  if (simulate === "failed") {
    return { status: "failed", reference: "", provider: "preview", method: intent.method, upiApp: intent.upiApp };
  }
  return {
    status: "paid",
    reference: `WC-${Date.now().toString(36).toUpperCase()}`,
    provider: "preview",
    method: intent.method,
    upiApp: intent.upiApp,
  };
}

export const CIRCLE_FEE_LABEL = "₹499";
export const CIRCLE_FEE_PAISE = 49900;
