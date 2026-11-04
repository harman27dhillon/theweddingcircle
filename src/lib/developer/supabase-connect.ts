import { rootCertificates } from "node:tls";
import { parse } from "pg-connection-string";
import { SUPABASE_ROOT_CA } from "./supabase-root-ca.ts";

export type DbConnectStatus =
  | "configuration_missing"
  | "invalid_uri"
  | "ready"
  | "dns_failure"
  | "network_tls"
  | "authentication_rejected"
  | "permission_denied"
  | "connected";

export type UsernameFormat = "missing" | "short_postgres" | "pooler_project" | "other";
export type HostMode = "unset" | "direct" | "session_pooler" | "transaction_pooler" | "dedicated_pooler" | "other";

/** Safe to return to the developer UI. No password, username, project ref, or URI. */
export type SafeDbUri = {
  status: DbConnectStatus;
  variablePresent: boolean;
  schemeValid: boolean;
  host: string;
  port: number | null;
  database: string;
  mode: HostMode;
  usernameFormat: UsernameFormat;
  passwordPresent: boolean;
  passwordLooksDoubleEncoded: boolean;
  sslSpecified: boolean;
  detail: string;
};

const PRIVILEGED = /service_role|BEGIN [A-Z ]*PRIVATE KEY|private_key|service_account|sb_secret_/i;

/** Verify the pooler certificate. Adds the published Supabase root without dropping public CAs. */
export function trustedSupabaseSsl(): { rejectUnauthorized: true; ca: string[] } {
  return {
    rejectUnauthorized: true,
    ca: [...rootCertificates, SUPABASE_ROOT_CA],
  };
}

function emptyUri(status: DbConnectStatus, detail: string): SafeDbUri {
  return {
    status,
    variablePresent: status !== "configuration_missing",
    schemeValid: false,
    host: "",
    port: null,
    database: "",
    mode: "unset",
    usernameFormat: "missing",
    passwordPresent: false,
    passwordLooksDoubleEncoded: false,
    sslSpecified: false,
    detail,
  };
}

function hostMode(host: string, port: number): HostMode {
  if (host.startsWith("db.") && host.endsWith(".supabase.co")) return port === 6543 ? "dedicated_pooler" : "direct";
  if (host.endsWith(".pooler.supabase.com")) return port === 6543 ? "transaction_pooler" : "session_pooler";
  return "other";
}

function usernameFormat(user: string): UsernameFormat {
  if (!user) return "missing";
  if (user === "postgres") return "short_postgres";
  if (/^postgres\.[a-z0-9]{10,40}$/.test(user)) return "pooler_project";
  return "other";
}

function formatLabel(format: UsernameFormat) {
  if (format === "short_postgres") return "the short username postgres";
  if (format === "pooler_project") return "the pooler username postgres.<project-ref>";
  if (format === "other") return "a custom username";
  return "a missing username";
}

/** Inspect SUPABASE_DB_URL without changing it and without returning secrets. */
export function safeSupabaseUri(connectionString: string): SafeDbUri {
  const raw = connectionString.trim();
  if (!raw) {
    return emptyUri("configuration_missing", "SUPABASE_DB_URL is not set in this server process. The published app reads that exact name after publish. This process did not query Supabase. Nothing was copied.");
  }
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL is wrapped in quotes. Remove the quotes and publish again. Nothing was queried.");
  }
  if (PRIVILEGED.test(raw) || raw.startsWith("eyJ") || raw.startsWith("sb_") || raw.startsWith("https://") || raw.startsWith("http://")) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL is not a PostgreSQL URI. The https project URL and API keys belong in their own variables. Nothing was queried.");
  }
  if (!/^postgres(ql)?:\/\//i.test(raw)) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL must start with postgresql://. Nothing was queried.");
  }
  if (/\s/.test(raw)) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL contains whitespace or a line break. Paste the URI as a single line. Nothing was queried.");
  }
  if (raw.includes("#") || (raw.split("@").length - 1) !== 1) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL is not a single user:password@host URI. Encode @ as %40 and # as %23 in the password only, then publish. Nothing was queried.");
  }
  if (/your-password|\[password\]/i.test(raw)) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL still contains the [YOUR-PASSWORD] placeholder. Put the generated session-pooler URI in the server secret. Do not send the password in chat. Nothing was queried.");
  }
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(raw);
  } catch {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL could not be parsed. Nothing was queried.");
  }
  const host = String(parsed.host || "").toLowerCase();
  const port = Number(parsed.port || 5432);
  const database = String(parsed.database || "");
  const user = String(parsed.user || "");
  const password = String(parsed.password || "");
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !database || !user || !password) {
    return emptyUri("invalid_uri", "SUPABASE_DB_URL is missing the host, port, database, username, or password. Nothing was queried.");
  }
  const mode = hostMode(host, port);
  const format = usernameFormat(user);
  const passwordLooksDoubleEncoded = /%[0-9a-f]{2}/i.test(password);
  const sslSpecified = /(?:\?|&)sslmode=/i.test(raw);
  let detail = `${mode.replaceAll("_", " ")} ${host}:${port}, database ${database}. Username format: ${formatLabel(format)}. Password is present and is not shown.`;
  if ((mode === "session_pooler" || mode === "transaction_pooler") && format === "short_postgres") {
    detail += " The pooler rejects the short username postgres even when the password is correct. Paste the generated session-pooler URI, whose username is postgres.<project-ref>. This server will not rewrite it.";
  } else if (mode === "direct" && format === "short_postgres") {
    detail += " The short username postgres is the direct-connection user. A later authentication error would be the password in this secret, not the username.";
  } else if (passwordLooksDoubleEncoded) {
    detail += " After the normal single decode, the password still contains percent-encoding. It may have been encoded twice. This server will not decode it again.";
  }
  detail += " This describes the saved URI only. It is not a connection result.";
  return {
    status: "ready",
    variablePresent: true,
    schemeValid: true,
    host,
    port,
    database,
    mode,
    usernameFormat: format,
    passwordPresent: true,
    passwordLooksDoubleEncoded,
    sslSpecified,
    detail,
  };
}

export function classifyDatabaseError(error: { code?: string; message?: string }, uri: SafeDbUri): { status: DbConnectStatus; code: string; detail: string } {
  const code = error.code || "";
  const message = (error.message || "").replace(/\s+/g, " ").trim();
  const dns = code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENOTFOUND" || /getaddrinfo ENOTFOUND/i.test(message);
  if (dns) {
    const where = uri.host ? ` for ${uri.host}` : "";
    return {
      status: "dns_failure",
      code: code || "ENOTFOUND",
      detail: `DNS failure${where} (${code || "ENOTFOUND"}). This is not an authentication result. Nothing was copied and traffic did not move.`,
    };
  }
  if (code === "ECONNREFUSED" || code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "ECONNRESET" || /certificate|tls|ssl|no encryption/i.test(message)) {
    return {
      status: "network_tls",
      code: code || "TLS",
      detail: `The server reached the network step but not a successful login (${code || "TLS"}). This is not a password match. Nothing was copied and traffic did not move.`,
    };
  }
  if (code === "28P01" || /password authentication failed/i.test(message)) {
    if ((uri.mode === "session_pooler" || uri.mode === "transaction_pooler") && uri.usernameFormat === "short_postgres") {
      return {
        status: "authentication_rejected",
        code: code || "28P01",
        detail: "Authentication rejected (28P01). The URI uses the short username postgres on a Supabase pooler host. The pooler expects postgres.<project-ref>, so this failure does not prove the password itself is wrong. Paste the generated session-pooler URI into SUPABASE_DB_URL and publish. This server will not change the username. Do not reset the database password yet. Nothing was copied.",
      };
    }
    if (uri.passwordLooksDoubleEncoded) {
      return {
        status: "authentication_rejected",
        code: code || "28P01",
        detail: "Authentication rejected (28P01). The password still contains percent-encoding after one decode, so SUPABASE_DB_URL was probably encoded twice. The server did not decode it again. Paste the generated session-pooler URI with the password encoded once and publish. Do not reset the database password yet. Nothing was copied.",
      };
    }
    return {
      status: "authentication_rejected",
      code: code || "28P01",
      detail: `Authentication rejected (${code || "28P01"}). The username format is ${formatLabel(uri.usernameFormat)} and the password was sent once, unchanged from the URI. The secret does not match the database password. Updating the password in the Supabase dashboard does not change this secret. Paste the current session-pooler URI into SUPABASE_DB_URL and publish. Do not reset the database password unless that exact URI still fails. Nothing was copied.`,
    };
  }
  if (code === "42501" || code === "28000") {
    return {
      status: "permission_denied",
      code,
      detail: `The database accepted the connection but denied the session (${code}). Nothing was copied and traffic did not move.`,
    };
  }
  return {
    status: "network_tls",
    code: code || "error",
    detail: "The read-only connection did not succeed. No secret is included in this result. Nothing was copied and traffic did not move.",
  };
}
