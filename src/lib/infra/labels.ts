export const INFRA_STATES = ["not_configured", "incomplete", "ready", "verified", "disabled", "error"] as const;
export type InfraState = (typeof INFRA_STATES)[number];

export const STATE_LABEL: Record<InfraState, string> = {
  not_configured: "Not configured",
  incomplete: "Configuration incomplete",
  ready: "Credentials saved",
  verified: "Connection test successful",
  disabled: "Service unavailable",
  error: "Connection failed",
};

/** Verified means the last server test passed. Operational also requires the feature switch. */
export function providerStatusLabel(state: string, operational = false) {
  if (state === "verified") return operational ? "Service operational" : "Connection test successful";
  if (state === "ready") return "Credentials saved";
  if (state === "incomplete") return "Configuration incomplete";
  if (state === "error") return "Connection failed";
  if (state === "disabled") return "Service unavailable";
  if (state === "not_configured") return "Not configured";
  return "Configuration incomplete";
}

export function securityStatusLabel(value: string) {
  if (value === "operational") return "Security operational";
  if (value === "audit") return "Security audit required";
  if (value === "na") return "Not applicable";
  return "";
}

export function cdnStatusLabel(status: string, enabled: boolean, domain: string) {
  if (status === "error") return "Connection failed";
  if (status === "verified") return enabled ? "Service operational" : "Connection test successful";
  if (!enabled) return domain ? "Credentials saved" : "Not configured";
  if (status === "incomplete") return "Configuration incomplete";
  if (status === "disabled") return "Service unavailable";
  return "Not configured";
}

export const FLAG_IDS = [
  "firebaseAuth",
  "cloudDatabase",
  "r2Media",
  "livestream",
  "playBilling",
  "pushNotifications",
  "mediaMigration",
  "productionMode",
] as const;
export type FlagId = (typeof FLAG_IDS)[number];

export const FLAG_LABEL: Record<FlagId, string> = {
  firebaseAuth: "Firebase authentication integration",
  cloudDatabase: "Cloud database integration",
  r2Media: "R2 media storage",
  livestream: "Livestream provider",
  playBilling: "Google Play Billing",
  pushNotifications: "Push notifications",
  mediaMigration: "Media migration",
  productionMode: "Production mode",
};

export const PRODUCTION_PHRASE = "ENABLE PRODUCTION";
export const MIGRATION_PHRASE = "START MEDIA MIGRATION";

export const PACKAGING_NOTE =
  "This app is a web app with a service worker. It is not a native Android project, so the Play Billing Library cannot be added to these screens. A later Trusted Web Activity or other wrapper, plus server-side purchase checks, is required. No purchase was created.";
