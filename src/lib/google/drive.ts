/** Google Drive file scope: files this app creates, or files a person explicitly opens with Google. */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

export const DRIVE_SCOPES = ["openid", "email", "profile", DRIVE_FILE_SCOPE].join(" ");

export const DRIVE_ABOUT = "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)";

export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,mimeType";

/** Resumable Drive chunks must be a multiple of 256 KiB, except the last one. */
export const DRIVE_CHUNK = 256 * 1024 * 8;

export function contentRangeHeader(offset: number, byteLength: number, total: number) {
  const end = offset + byteLength - 1;
  return `bytes ${offset}-${end}/${total}`;
}

export function driveStatusError(status: number) {
  if (status === 401) return "Google Drive authorization expired. Connect again.";
  if (status === 403) return "Google Drive rejected the permission. Enable the Google Drive API, then connect again.";
  if (status === 404) return "That file is not in Google Drive. A copy saved earlier in Google Photos stays in that library and is not opened here.";
  return "Google Drive did not answer. Try again.";
}
