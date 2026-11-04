const KEY = "wc-google-link";

export function googleLink() {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function rememberGoogleLink(id: string) {
  if (typeof window === "undefined" || !/^[a-f0-9]{32}$/.test(id)) return;
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    /* The sign-in cookie still works when the browser keeps it. */
  }
}

export function forgetGoogleLink() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
