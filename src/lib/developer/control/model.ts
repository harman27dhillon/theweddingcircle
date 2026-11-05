export const CONFIG_FIELDS = [
  { name: "SUPABASE_URL", secret: false },
  { name: "SUPABASE_PUBLISHABLE_KEY", secret: true },
  { name: "SUPABASE_SERVICE_ROLE_KEY", secret: true },
  { name: "SUPABASE_DB_URL", secret: true },
] as const;

export type ConfigName = (typeof CONFIG_FIELDS)[number]["name"];
export type ConfigDraft = Partial<Record<ConfigName, string>>;

export const CHECKS = [
  ["api", "Test Supabase API connection"],
  ["connect", "Test Supabase connection"],
  ["inspect", "Inspect existing database"],
  ["initialize", "Initialize required database schema"],
  ["schema", "Verify database schema"],
  ["read", "Test database read"],
  ["write", "Test database write"],
  ["rls", "Check row level security"],
  ["permissions", "Check database permissions"],
  ["verify", "Run all verification checks"],
] as const;

export type Check = (typeof CHECKS)[number][0];
export type Diagnostic = {
  ok: boolean;
  message: string;
  details?: string[];
  checkedAt?: string;
};
