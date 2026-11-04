import { bareCloudflareToken } from "./config.ts";

export type LiveAction = "create" | "start" | "stop" | "watch" | "status";

/** External livestream decisions. This does not start or stop the in-app camera. */
export function decideLive(input: {
  providerReady: boolean;
  action: LiveAction;
  role: string;
  member: boolean;
}) {
  const role = input.role.trim().toLowerCase();
  if (!input.member || !role || role === "none") {
    return { ok: false as const, error: "This livestream is private to the wedding." };
  }
  if (input.action === "watch" || input.action === "status") {
    if (role !== "host" && role !== "cohost" && role !== "guest" && role !== "family") {
      return { ok: false as const, error: "This livestream is private to the wedding." };
    }
    return { ok: true as const };
  }
  if (role !== "host" && role !== "cohost") {
    return { ok: false as const, error: "Only a host can control the livestream." };
  }
  if (!input.providerReady) {
    return { ok: false as const, error: "The livestream provider is not configured. The in-app camera in Live is unchanged. No meeting was created." };
  }
  return { ok: true as const };
}

/** One Bearer prefix. A saved value that already says Bearer is not prefixed again. */
export function realtimeAuthorizationHeader(token: string) {
  const bare = bareCloudflareToken(token);
  return bare ? `Bearer ${bare}` : "";
}

export function realtimeConfigGap(account: string, appId: string, token: string) {
  if (!account.trim() || !appId.trim() || !bareCloudflareToken(token)) {
    return "Cloudflare RealtimeKit needs the account id, app id, and its own API token. No meeting was created.";
  }
  return "";
}
