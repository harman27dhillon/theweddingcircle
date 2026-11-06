/** Extract only the one-time code from our Firebase-hosted verification URL. */
export function verificationCodeFromLink(link: string, authDomain: string) {
  if (!authDomain || link.length > 4096) return "";
  try {
    const url = new URL(link.trim());
    if (url.origin !== `https://${authDomain.toLowerCase()}` || url.username || url.password ||
        url.pathname !== "/__/auth/action" || url.hash) return "";
    const modes = url.searchParams.getAll("mode");
    const codes = url.searchParams.getAll("oobCode");
    if (modes.length !== 1 || modes[0] !== "verifyEmail" || codes.length !== 1) return "";
    return /^[A-Za-z0-9_-]{8,2048}$/.test(codes[0]) ? codes[0] : "";
  } catch {
    return "";
  }
}
