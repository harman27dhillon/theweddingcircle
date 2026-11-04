export const AFFILIATE_SERVICES = [
  {
    id: "amazon",
    title: "Amazon India",
    api: "Product Advertising API (PA-API)",
    bot: "Amazon India Bridal Trends",
    fields: [
      { id: "accessKey", label: "Amazon PA-API Access Key", secret: true, env: "AMAZON_PA_ACCESS_KEY" },
      { id: "secretKey", label: "Amazon PA-API Secret Key", secret: true, env: "AMAZON_PA_SECRET_KEY" },
      { id: "partnerTag", label: "Amazon Partner Tag", secret: false, env: "AMAZON_PARTNER_TAG" },
    ],
  },
  {
    id: "flipkart",
    title: "Flipkart Affiliate",
    api: "Flipkart Affiliate API",
    bot: "Flipkart Bridal Trends",
    fields: [
      { id: "affiliateId", label: "Flipkart Affiliate ID", secret: false, env: "FLIPKART_AFFILIATE_ID" },
      { id: "token", label: "Flipkart Affiliate Token", secret: true, env: "FLIPKART_AFFILIATE_TOKEN" },
    ],
  },
  {
    id: "meesho",
    title: "Meesho Catalog",
    api: "Meesho catalog",
    bot: "Meesho Bridal Trends",
    fields: [{ id: "token", label: "Meesho Catalog Token", secret: true, env: "MEESHO_CATALOG_TOKEN" }],
  },
] as const;

export type AffiliateServiceId = (typeof AFFILIATE_SERVICES)[number]["id"];
export type AffiliateStatus = "configured" | "not_configured" | "needs_attention";

const LIMITS: Record<string, [number, number]> = {
  accessKey: [16, 128],
  secretKey: [20, 256],
  partnerTag: [2, 64],
  affiliateId: [2, 80],
  token: [8, 256],
};

export function affiliateService(id: string) {
  return AFFILIATE_SERVICES.find((item) => item.id === id) ?? null;
}

export function cleanAffiliateFields(serviceId: string, input: Record<string, unknown>) {
  const service = affiliateService(serviceId);
  if (!service) return { ok: false as const, error: "That affiliate service is not part of Discover." };
  const fields: Record<string, string> = {};
  for (const field of service.fields) {
    const raw = input[field.id];
    const value = typeof raw === "string" ? raw.trim() : "";
    const [min, max] = LIMITS[field.id] ?? [1, 200];
    if (value.length < min || value.length > max || /\s/.test(value)) {
      return { ok: false as const, error: `${field.label} is missing or not in the expected shape. Nothing was saved.` };
    }
    fields[field.id] = value;
  }
  return { ok: true as const, service, fields };
}

export function redactSecrets(message: string, secrets: string[]) {
  let next = message.replace(/[\r\n]+/g, " ").trim();
  for (const secret of secrets) {
    if (secret.length >= 4) next = next.split(secret).join("••••");
  }
  return next.slice(0, 180);
}

export function meeshoBlock() {
  return "Unavailable / Additional access required. Meesho does not provide an authorized catalog API for this app, so no products were requested or invented.";
}

export function interpretAffiliateHttp(serviceId: AffiliateServiceId, status: number, body: string, secrets: string[]) {
  const text = redactSecrets(body, secrets);
  if (serviceId === "meesho") return { status: "needs_attention" as const, message: meeshoBlock() };
  if (status === 200 && serviceId === "flipkart" && /apiListings|Affiliate API/i.test(body)) {
    return { status: "configured" as const, message: "Flipkart accepted the affiliate credentials. This test did not publish any Discover products." };
  }
  if (status === 200 && serviceId === "amazon" && /SearchResult|Items/i.test(body) && !/"Errors"/i.test(body)) {
    return { status: "configured" as const, message: "Amazon accepted the Product Advertising API credentials. This test did not publish any Discover products." };
  }
  if (status === 401 || status === 403) {
    return { status: "needs_attention" as const, message: "The service refused these credentials. Check the affiliate account permissions. No products were added." };
  }
  const code = text.match(/"Code"\s*:\s*"([A-Za-z0-9]+)"/)?.[1];
  return {
    status: "needs_attention" as const,
    message: code
      ? `Connection needs attention (${code}). No products were added.`
      : `Connection needs attention (HTTP ${status}). No products were added.`,
  };
}

export function publicServiceView(input: {
  id: AffiliateServiceId;
  complete: boolean;
  source: "environment" | "server" | "none";
  attention: string;
}) {
  const service = affiliateService(input.id);
  if (!service) return null;
  let status: AffiliateStatus = "not_configured";
  let label = "Not configured";
  let guidance = `Set ${service.fields.map((field) => field.env).join(", ")} as server environment variables, or save them here once a server vault key is available. Values are never shown again and are not stored in this browser.`;
  if (input.id === "meesho" && input.complete) {
    status = "needs_attention";
    label = "Connection needs attention";
    guidance = meeshoBlock();
  } else if (input.complete && input.attention) {
    status = "needs_attention";
    label = "Connection needs attention";
    guidance = input.attention;
  } else if (input.complete) {
    status = "configured";
    label = "Configured";
    guidance =
      input.source === "environment"
        ? "Read from server environment variables. The values are not shown. Saving here does not turn the bot on."
        : "Saved on the server. The values are not shown again. Saving here does not turn the bot on.";
  }
  return {
    id: service.id,
    title: service.title,
    api: service.api,
    bot: service.bot,
    status,
    label,
    guidance,
    source: input.complete ? input.source : "none",
    fields: service.fields.map((field) => ({ id: field.id, label: field.label, secret: field.secret, env: field.env })),
  };
}
