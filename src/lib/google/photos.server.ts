import { DRIVE_ABOUT, driveStatusError } from "@/lib/google/drive";
import { getRequest } from "@tanstack/react-start/server";

export const GOOGLE_COOKIE = "wc_google";
const STATE_COOKIE = "wc_google_state";
const DRIVE = "https://www.googleapis.com/drive/v3";

type Connection = {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  refresh_token: string;
  albums: Record<string, string> | string;
};

type OAuthState = { state?: string; verifier?: string; next?: string; popup?: boolean; redirect?: string };

type AppCreds = { clientId: string; clientSecret: string; redirectUri: string };

let savedCreds: { at: number; value: AppCreds | null } | null = null;
const driveProbe = new Map<string, { at: number; ok: boolean; email: string; error: string }>();

export async function googleConfigured() {
  const creds = await appCreds();
  return Boolean(creds.clientId && creds.clientSecret);
}

export async function redirectUri(request: Request) {
  const creds = await appCreds();
  if (creds.redirectUri) return creds.redirectUri;
  const url = new URL(request.url);
  return `${url.origin}/api/google/callback`;
}

export function safeNext(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 200) return "/account";
  return value;
}

export async function beginOAuth(request: Request) {
  void request;
  return new Response("Google Drive is no longer used for wedding media. Nothing was connected.", {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function finishOAuth(_request: Request) {
  return new Response("Google Drive is no longer used for wedding media. Nothing was connected.", {
    status: 410,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function googleStatus(link = "") {
  const creds = await appCreds();
  const configured = Boolean(creds.clientId && creds.clientSecret);
  if (!configured) {
    return {
      configured: false,
      connected: false,
      email: "",
      name: "",
      sub: "",
      error: "Add the Google OAuth client in Developer before Google Drive can connect.",
    };
  }
  const connection = await currentConnection(link);
  if (!connection) return { configured: true, connected: false, email: "", name: "", sub: "", error: "" };
  const cached = driveProbe.get(connection.id);
  if (cached && Date.now() - cached.at < 30_000) {
    return {
      configured: true,
      connected: cached.ok,
      email: cached.ok ? cached.email : "",
      name: connection.name,
      sub: connection.google_sub,
      error: cached.ok ? "" : cached.error,
    };
  }
  const live = await probeDrive(connection);
  return {
    configured: true,
    connected: live.ok,
    email: live.ok ? live.email : "",
    name: connection.name,
    sub: connection.google_sub,
    error: live.ok ? "" : live.error,
  };
}

export async function testGoogleDrive(link = "") {
  const creds = await appCreds();
  if (!creds.clientId || !creds.clientSecret) {
    return { ok: false as const, error: "Add the Google OAuth client before testing Google Drive." };
  }
  const connection = await currentConnection(link);
  if (!connection) return { ok: false as const, error: "Connect Google Drive before testing. Nothing has been authorized yet." };
  driveProbe.delete(connection.id);
  const live = await probeDrive(connection);
  if (!live.ok) return { ok: false as const, error: live.error };
  return { ok: true as const, email: live.email };
}

export async function googleAppPublic() {
  const creds = await appCreds();
  const fromEnvironment = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
  return {
    configured: Boolean(creds.clientId && creds.clientSecret),
    fromEnvironment,
    clientIdHint: creds.clientId ? `${creds.clientId.slice(0, 12)}…` : "",
    redirectUri: creds.redirectUri,
  };
}

export async function saveGoogleApp(input: { clientId: string; clientSecret: string; redirectUri: string }) {
  const clientId = input.clientId.trim();
  const clientSecret = input.clientSecret.trim();
  const redirectUri = input.redirectUri.trim();
  if (!/^[\w-]{10,200}\.apps\.googleusercontent\.com$/.test(clientId)) {
    return { ok: false as const, error: "That is not a Google OAuth client ID." };
  }
  if (clientSecret.length < 16 || clientSecret.length > 256 || /\s/.test(clientSecret)) {
    return { ok: false as const, error: "Enter the client secret from the same OAuth client." };
  }
  if (redirectUri && !/^https?:\/\/[a-z0-9.-]+(?::\d+)?\/api\/google\/callback$/i.test(redirectUri)) {
    return { ok: false as const, error: "Redirect URI must be https and end with /api/google/callback." };
  }
  const sql = await sqlReady();
  await sql`
    insert into google_app (id, client_id, client_secret, redirect_uri)
    values ('app', ${clientId}, ${clientSecret}, ${redirectUri})
    on conflict (id) do update
    set client_id = excluded.client_id,
        client_secret = excluded.client_secret,
        redirect_uri = excluded.redirect_uri,
        updated_at = now()
  `;
  savedCreds = null;
  return { ok: true as const, clientIdHint: `${clientId.slice(0, 12)}…` };
}

export async function clearGoogleApp() {
  if (process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim()) {
    return { ok: true as const, fromEnvironment: true };
  }
  const sql = await sqlReady();
  await sql`delete from google_app where id = 'app'`;
  savedCreds = null;
  return { ok: true as const, fromEnvironment: false };
}

export async function disconnectGoogle(link = "") {
  const connection = await currentConnection(link);
  if (connection) {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: connection.refresh_token }),
    }).catch(() => undefined);
    const sql = await sqlReady();
    await sql`delete from google_connections where id = ${connection.id}`;
    driveProbe.delete(connection.id);
  }
  const { setCookie } = await import("@tanstack/react-start/server");
  setCookie(GOOGLE_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
}

export async function startUpload(_input: { slug: string; mime: string; size: number; name: string; link?: string }) {
  return { ok: false as const, error: "New photos and videos are saved in private wedding storage, not Google Drive." };
}

export async function acceptChunk(_request: Request, _id: string, _offset: number, _bytes: Uint8Array) {
  return { ok: false as const, error: "New photos and videos are saved in private wedding storage, not Google Drive." };
}

export async function openMedia(slug: string, id: string, _intent: "view" | "download") {
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || !id || id.length > 512 || id.includes("/") || /\s/.test(id)) return { ok: false as const, error: "That photo could not be opened." };
  const sql = await sqlReady();
  const rows = await sql<{ connection_id: string; mime: string; kind: string }>`
    select connection_id, mime, kind from google_media where media_item_id = ${id} and slug = ${slug} limit 1
  `;
  const row = rows[0];
  if (!row) return { ok: false as const, error: "That file is not in this circle." };
  const connections = await sql<Connection>`select id, google_sub, email, name, refresh_token, albums from google_connections where id = ${row.connection_id} limit 1`;
  const connection = connections[0];
  if (!connection) return { ok: false as const, error: "The person who added this disconnected Google Drive. The file stays in their Drive." };
  try {
    const token = await accessToken(connection);
    const got = await fetch(`${DRIVE}/files/${encodeURIComponent(id)}?fields=id,trashed,mimeType`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (got.status === 401 || got.status === 403) return { ok: false as const, error: driveStatusError(got.status) };
    if (got.status === 404) return { ok: false as const, error: driveStatusError(404) };
    if (!got.ok) return { ok: false as const, error: "Google Drive could not open that file." };
    const item = (await got.json()) as { trashed?: boolean };
    if (item.trashed) return { ok: false as const, error: "That file was removed from Google Drive." };
    await sql`delete from google_view_tickets where expires_at < now()`;
    const ticket = randomId();
    await sql`
      insert into google_view_tickets (token, media_item_id, slug, expires_at)
      values (${ticket}, ${id}, ${slug}, now() + interval '45 minutes')
    `;
    return { ok: true as const, url: `/api/google/file?ticket=${ticket}`, pending: false, kind: row.kind };
  } catch {
    return { ok: false as const, error: "The person who added this needs to reconnect Google Drive. The file stays in their Drive." };
  }
}

export async function releaseMedia(slug: string, id: string) {
  if (!/^[a-z0-9-]{3,80}$/.test(slug) || !id) return { ok: false as const, remainsInDrive: true };
  const sql = await sqlReady();
  await sql`delete from google_media where media_item_id = ${id} and slug = ${slug}`;
  await sql`delete from google_view_tickets where media_item_id = ${id} and slug = ${slug}`;
  return { ok: true as const, remainsInDrive: true };
}

export async function openDriveFile(request: Request) {
  const ticket = new URL(request.url).searchParams.get("ticket") || "";
  if (!/^[a-f0-9]{32}$/.test(ticket)) return new Response("Not found", { status: 404 });
  const sql = await sqlReady();
  const tickets = await sql<{ media_item_id: string; slug: string; expires_at: string | Date }>`
    select media_item_id, slug, expires_at from google_view_tickets where token = ${ticket} limit 1
  `;
  const view = tickets[0];
  if (!view || new Date(view.expires_at).getTime() < Date.now()) {
    return new Response("That link expired. Open the photo again.", { status: 401, headers: { "cache-control": "no-store" } });
  }
  const media = await sql<{ connection_id: string; mime: string }>`
    select connection_id, mime from google_media where media_item_id = ${view.media_item_id} and slug = ${view.slug} limit 1
  `;
  const row = media[0];
  if (!row) return new Response("That file is not in this circle.", { status: 404 });
  const connections = await sql<Connection>`select id, google_sub, email, name, refresh_token, albums from google_connections where id = ${row.connection_id} limit 1`;
  const connection = connections[0];
  if (!connection) return new Response("The person who added this disconnected Google Drive.", { status: 401 });
  let token = "";
  try {
    token = await accessToken(connection);
  } catch {
    return new Response("Google Drive authorization expired. The person who added this needs to connect again.", { status: 401 });
  }
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  const range = request.headers.get("range");
  if (range) headers.range = range;
  const upstream = await fetch(`${DRIVE}/files/${encodeURIComponent(view.media_item_id)}?alt=media`, { headers });
  if (upstream.status === 401 || upstream.status === 403 || upstream.status === 404) {
    return new Response(driveStatusError(upstream.status), { status: upstream.status === 404 ? 404 : 401, headers: { "cache-control": "no-store" } });
  }
  if (!upstream.ok && upstream.status !== 206) {
    return new Response("Google Drive could not open that file.", { status: 502, headers: { "cache-control": "no-store" } });
  }
  const out = new Headers();
  out.set("content-type", upstream.headers.get("content-type") || row.mime || "application/octet-stream");
  out.set("cache-control", "private, max-age=60");
  out.set("accept-ranges", "bytes");
  out.set("content-disposition", "inline");
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) out.set("content-range", contentRange);
  const length = upstream.headers.get("content-length");
  if (length) out.set("content-length", length);
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

async function sqlReady() {
  const { getSql } = await import("@/lib/db");
  const sql = await getSql();
  await sql`create table if not exists google_connections (
    id text primary key,
    google_sub text not null unique,
    email text not null,
    name text not null default '',
    refresh_token text not null,
    albums jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists google_media (
    media_item_id text primary key,
    connection_id text not null,
    album_id text not null,
    slug text not null,
    mime text not null,
    kind text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists google_uploads (
    id text primary key,
    connection_id text not null,
    upload_url text not null,
    access_token text not null,
    mime text not null,
    size bigint not null,
    file_name text not null,
    slug text not null,
    created_at timestamptz not null default now()
  )`;
  await sql`create table if not exists google_app (
    id text primary key,
    client_id text not null,
    client_secret text not null,
    redirect_uri text not null default '',
    updated_at timestamptz not null default now()
  )`;
  await sql`create table if not exists google_view_tickets (
    token text primary key,
    media_item_id text not null,
    slug text not null,
    expires_at timestamptz not null
  )`;
  return sql;
}

async function appCreds(): Promise<AppCreds> {
  const envId = process.env.GOOGLE_CLIENT_ID?.trim() || "";
  const envSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || "";
  const envRedirect = process.env.GOOGLE_REDIRECT_URI?.trim() || "";
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, redirectUri: envRedirect };
  const saved = await loadSavedCreds();
  return saved || { clientId: "", clientSecret: "", redirectUri: envRedirect };
}

async function loadSavedCreds() {
  if (savedCreds && Date.now() - savedCreds.at < 5000) return savedCreds.value;
  try {
    const sql = await sqlReady();
    const rows = await sql<{ client_id: string; client_secret: string; redirect_uri: string }>`
      select client_id, client_secret, redirect_uri from google_app where id = 'app' limit 1
    `;
    const row = rows[0];
    const value =
      row?.client_id && row.client_secret
        ? { clientId: row.client_id, clientSecret: row.client_secret, redirectUri: row.redirect_uri || "" }
        : null;
    savedCreds = { at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

async function currentConnection(link = "") {
  try {
    return await connectionFrom(getRequest(), link);
  } catch {
    if (!validLink(link)) return null;
    const sql = await sqlReady();
    const rows = await sql<Connection>`select id, google_sub, email, name, refresh_token, albums from google_connections where id = ${link} limit 1`;
    return rows[0] ?? null;
  }
}

async function connectionFrom(request: Request, link = "") {
  const cookieId = readCookie(request.headers.get("cookie"), GOOGLE_COOKIE);
  const headerId = request.headers.get("x-wc-google") || "";
  const id = validLink(cookieId) ? cookieId : validLink(headerId) ? headerId : validLink(link) ? link : "";
  if (!id) return null;
  const sql = await sqlReady();
  const rows = await sql<Connection>`select id, google_sub, email, name, refresh_token, albums from google_connections where id = ${id} limit 1`;
  return rows[0] ?? null;
}

async function accessToken(connection: Connection) {
  const creds = await appCreds();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!res.ok || !json.access_token) throw new Error("revoked");
  if (json.refresh_token && json.refresh_token !== connection.refresh_token) {
    const sql = await sqlReady();
    await sql`update google_connections set refresh_token = ${json.refresh_token}, updated_at = now() where id = ${connection.id}`;
    connection.refresh_token = json.refresh_token;
  }
  return json.access_token;
}

async function probeDrive(connection: Connection) {
  try {
    const token = await accessToken(connection);
    const about = await fetch(DRIVE_ABOUT, { headers: { authorization: `Bearer ${token}` } });
    if (!about.ok) {
      const error = driveStatusError(about.status);
      driveProbe.set(connection.id, { at: Date.now(), ok: false, email: "", error });
      return { ok: false as const, email: "", error };
    }
    const body = (await about.json()) as { user?: { emailAddress?: string } };
    const email = body.user?.emailAddress || connection.email;
    driveProbe.set(connection.id, { at: Date.now(), ok: true, email, error: "" });
    return { ok: true as const, email, error: "" };
  } catch {
    const error = "Google Drive authorization expired or was revoked. Connect again.";
    driveProbe.set(connection.id, { at: Date.now(), ok: false, email: "", error });
    return { ok: false as const, email: "", error };
  }
}

function randomId() {
  return crypto.randomUUID().replace(/-/g, "");
}

function readCookie(header: string | null, name: string) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function readJsonCookie(request: Request, name: string) {
  try {
    const value = readCookie(request.headers.get("cookie"), name);
    return value ? (JSON.parse(value) as OAuthState) : null;
  } catch {
    return null;
  }
}

function validLink(id: string) {
  return /^[a-f0-9]{32}$/.test(id);
}

function popupResponse(status: string, connectionId: string, request: Request, headers = new Headers()) {
  const safeStatus = status === "connected" || status === "declined" || status === "unconfigured" ? status : "error";
  const safeId = validLink(connectionId) ? connectionId : "";
  const message = JSON.stringify({ source: "wc-google", status: safeStatus, connectionId: safeId });
  const line =
    safeStatus === "connected"
      ? "Connected. This window can close."
      : safeStatus === "declined"
        ? "Not connected. You can close this window."
        : safeStatus === "unconfigured"
          ? "Add the Google client on the developer profile first."
          : "Could not connect. You can close this window.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive</title></head><body style="margin:0;background:#f6f1e8;color:#241c16;font-family:Georgia,serif"><main style="max-width:28rem;margin:4rem auto;padding:1.5rem"><h1 style="font-weight:normal">Google Drive</h1><p>${line}</p><p><a href="/account">Return to your profile</a></p></main><script>var msg=${message};try{localStorage.setItem("wc-google-oauth",JSON.stringify({status:msg.status,connectionId:msg.connectionId,at:Date.now()}))}catch(e){}try{if(window.opener&&!window.opener.closed)window.opener.postMessage(msg,location.origin)}catch(e){}setTimeout(function(){window.close()},600);</script></body></html>`;
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (!headers.has("set-cookie")) headers.append("set-cookie", cookie(STATE_COOKIE, "", 0, request));
  return new Response(html, { status: 200, headers });
}

export function cookie(name: string, value: string, maxAge: number, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function redirect(location: string, request: Request) {
  return new Response(null, { status: 302, headers: { location, "set-cookie": cookie(STATE_COOKIE, "", 0, request) } });
}
