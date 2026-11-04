export type RlsMarker = "on" | "off" | "unread" | "na";

export type RlsTable = { name: string; rls: boolean };
export type RlsPolicy = { table: string; roles: string; qual: string };
export type RlsGrant = { table: string; grantee: string; privilege: string };

export const WEDDING_TABLES = ["circles", "circle_members", "circle_auth", "ceremony_invites", "couple_access"] as const;

const OPEN_ROLE = /\b(anon|authenticated|public)\b/i;

export function securityTag(detail: string, key: string) {
  const found = new RegExp(`\\[wc-${key}:([a-z0-9-]+)\\]`).exec(detail || "");
  return found?.[1] || "";
}

export function interpretRls(input: { tables: RlsTable[]; policies: RlsPolicy[]; grants: RlsGrant[] }) {
  const present = new Set(input.tables.map((table) => table.name));
  const missing = WEDDING_TABLES.filter((name) => !present.has(name));
  if (missing.length === WEDDING_TABLES.length) {
    return {
      marker: "unread" as const,
      detail: "Supabase did not show the wedding tables, so row level security was not marked complete.",
    };
  }
  const off = WEDDING_TABLES.filter((name) => {
    const table = input.tables.find((item) => item.name === name);
    return table ? !table.rls : false;
  });
  const granted = input.grants.filter((grant) => OPEN_ROLE.test(grant.grantee) && WEDDING_TABLES.includes(grant.table as (typeof WEDDING_TABLES)[number]));
  const open = input.policies.filter((policy) => OPEN_ROLE.test(policy.roles) && WEDDING_TABLES.includes(policy.table as (typeof WEDDING_TABLES)[number]));
  if (off.length || granted.length || open.length || missing.length) {
    const reason = [
      off.length ? `row level security is off for ${off.join(", ")}` : "",
      missing.length ? `missing ${missing.join(", ")}` : "",
      granted.length ? "the publishable key still has a table grant" : "",
      open.length ? "a policy still names anon, authenticated, or public" : "",
    ].filter(Boolean).join("; ");
    return {
      marker: "off" as const,
      detail: `Security audit required. ${reason}. Wedding rows were not read.`,
    };
  }
  return {
    marker: "on" as const,
    detail: "Row level security is on for the wedding tables. No public policy and no anon, authenticated, or public grant was found. The database owner used by the server bypasses those rules, so the server still checks membership itself.",
  };
}
