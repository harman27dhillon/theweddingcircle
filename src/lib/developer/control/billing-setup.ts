export const BILLING_SETUP = {
  play: {
    description: "Google Play purchases for the Android app",
    fields: [
      "GOOGLE_PLAY_PACKAGE_NAME",
      "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
      "PLAY_PRODUCT_PREMIUM_THEMES",
      "PLAY_PRODUCT_EXTRA_STORAGE",
      "PLAY_PRODUCT_PREMIUM_MEMBERSHIP",
    ],
    optional: ["PLAY_PRODUCT_EXTRA_STORAGE", "PLAY_PRODUCT_PREMIUM_MEMBERSHIP"],
    guide: "https://developers.google.com/android-publisher/getting_started",
    note: "Create the products in Play Console and grant the service account access to the app. This check reads the product catalogue. Android purchase testing is a separate step.",
  },
  razorpay: {
    description: "Razorpay payments for website checkout",
    fields: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"],
    optional: ["RAZORPAY_WEBHOOK_SECRET"],
    guide: "https://razorpay.com/docs/api/authentication/",
    note: "Add the key ID and key secret from the same Razorpay mode to the production Worker. Save the webhook signing secret when configuring payment callbacks. This check reads account orders to verify API access.",
  },
} as const;

export type BillingProvider = keyof typeof BILLING_SETUP;
