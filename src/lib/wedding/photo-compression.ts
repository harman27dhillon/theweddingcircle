import { PHOTO_MAX_BYTES, PHOTO_QUALITY, PHOTO_SMALL_BYTES, PHOTO_TARGET_BYTES, isHeicPhoto, nextPhotoDimensions, photoDimensions } from './photo-policy';
async function animated(file: File) {
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) return true;
  const head = new Uint8Array(await file.slice(0, 65536).arrayBuffer());
  if (head[0] === 0x89 && head[1] === 0x50) {
    const view = new DataView(head.buffer);
    for (let at = 8; at + 12 <= head.length;) {
      const type = String.fromCharCode(...head.subarray(at + 4, at + 8));
      if (type === 'acTL') return true;
      if (type === 'IDAT') return false;
      at += view.getUint32(at) + 12;
    }
  }
  return head.length >= 21 && String.fromCharCode(...head.subarray(12, 16)) === 'VP8X' && Boolean(head[20] & 2);
}
async function decodePhoto(file: File): Promise<ImageBitmap> {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    if (!isHeicPhoto(file)) throw new Error('This photo could not be prepared. Try another photo. Nothing was uploaded.');
    const { heicTo } = await import('heic-to/next');
    return heicTo({ blob: file, type: 'bitmap', options: { imageOrientation: 'from-image' } });
  }
}
async function encode(bitmap: ImageBitmap, width: number, height: number, mime: string): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Photo compression is unavailable.');
      ctx.drawImage(bitmap, 0, 0, width, height);
      return await canvas.convertToBlob({ type: mime, quality: PHOTO_QUALITY });
    } finally { canvas.width = 1; canvas.height = 1; }
  }
  if (typeof document === 'undefined') throw new Error('Photo compression is unavailable.');
  const canvas = document.createElement('canvas');canvas.width = width;canvas.height = height;
  try {
    const ctx = canvas.getContext('2d');if (!ctx) throw new Error('Photo compression is unavailable.');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Photo compression failed.')), mime, PHOTO_QUALITY));
  } finally { canvas.width = 1;canvas.height = 1; }
}
/** Only optimized photos reach the uploader; a failed large conversion never falls back to its original. */
export async function compressPhoto(file: File): Promise<File> {
  if (await animated(file)) {
    if (file.size > PHOTO_MAX_BYTES) throw new Error('This animation is too large. Choose one under 2 MB. Nothing was uploaded.');
    return file;
  }
  const heic = isHeicPhoto(file);
  if (!heic && file.size <= PHOTO_SMALL_BYTES && /image\/(jpeg|png|webp)/i.test(file.type)) return file;
  const bitmap = await decodePhoto(file);
  try {
    let { width, height } = photoDimensions(bitmap.width, bitmap.height);
    const target = Math.min(PHOTO_TARGET_BYTES, Math.max(PHOTO_SMALL_BYTES, Math.round(file.size * 0.8)));
    let result = await encode(bitmap, width, height, 'image/webp');
    if (result.type !== 'image/webp') result = await encode(bitmap, width, height, /image\/(png|webp)/i.test(file.type) ? 'image/png' : 'image/jpeg');
    for (let attempt = 0; attempt < 3 && result.size > target; attempt++) {
      const next = nextPhotoDimensions(width, height, result.size, target);
      if (next.width === width && next.height === height) break;
      ({ width, height } = next);
      result = await encode(bitmap, width, height, result.type);
    }
    if (!heic && result.size >= file.size && file.size <= PHOTO_MAX_BYTES && /image\/(jpeg|png|webp)/i.test(file.type)) return file;
    if (result.size > PHOTO_MAX_BYTES) throw new Error('This photo could not be made small enough. Try a different photo. Nothing was uploaded.');
    const ext = result.type === 'image/webp' ? 'webp' : result.type === 'image/png' ? 'png' : 'jpg';
    return new File([result], `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.${ext}`, { type: result.type, lastModified: file.lastModified });
  } finally { bitmap.close(); }
}
