export const PHOTO_QUALITY = 0.90;
export const PHOTO_TARGET_BYTES = 1_500_000;
export const PHOTO_MAX_EDGE = 4096;
export const PHOTO_SMALL_BYTES = 128_000;
export function photoDimensions(width: number, height: number, edge = PHOTO_MAX_EDGE) {
  if (!(width > 0 && height > 0) || !Number.isFinite(width * height)) throw new Error('That photo could not be decoded.');
  const scale = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function nextPhotoDimensions(width: number, height: number, bytes: number, target: number) {
  const factor = Math.max(0.5, Math.min(0.9, Math.sqrt(target / bytes) * 0.96));
  return photoDimensions(width, height, Math.max(1280, Math.round(Math.max(width, height) * factor)));
}
export function isHeicPhoto(file: { type: string; name: string }) {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}
