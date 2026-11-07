/** Repack compressed bytes only. Never resize, decode pixels, or transcode audio/video. */
const PNG = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_INFLATED = 48 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function boundedBytes(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_INFLATED) throw new Error('Image exceeds optimization budget');
      parts.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
export async function repackPng(file: File): Promise<File> {
  if (file.size < 65536 || file.size > 24 * 1024 * 1024 || typeof CompressionStream === 'undefined') return file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!PNG.every((b, i) => bytes[i] === b)) return file;
  const view = new DataView(bytes.buffer);
  const chunks: { start: number; end: number; type: string }[] = [];
  const data: BlobPart[] = [];
  let seenData = false, endedData = false, ended = false;
  for (let at = 8; at + 12 <= bytes.length;) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    if (end > bytes.length) return file;
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (crc(bytes.subarray(at + 4, end - 4)) !== view.getUint32(end - 4)) return file;
    if (type === 'acTL') return file; // Preserve animation without repacking.
    if (type === 'IDAT') {
      if (endedData) return file;
      seenData = true;
      data.push(bytes.slice(at + 8, end - 4));
    } else if (seenData) endedData = true;
    chunks.push({ start: at, end, type });
    at = end;
    if (type === 'IEND') { ended = at === bytes.length; break; }
  }
  if (!ended || !data.length || chunks[0]?.type !== 'IHDR') return file;
  const raw = await boundedBytes(new Blob(data).stream().pipeThrough(new DecompressionStream('deflate')));
  const packed = await boundedBytes(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate')));
  const chunk = new Uint8Array(packed.length + 12);
  const chunkView = new DataView(chunk.buffer);
  chunkView.setUint32(0, packed.length);
  chunk.set([73, 68, 65, 84], 4);
  chunk.set(packed, 8);
  chunkView.setUint32(chunk.length - 4, crc(chunk.subarray(4, chunk.length - 4)));
  const parts: BlobPart[] = [bytes.slice(0, 8)];
  let inserted = false;
  for (const entry of chunks) {
    if (entry.type === 'IDAT') { if (!inserted) { parts.push(chunk); inserted = true; } }
    else parts.push(bytes.slice(entry.start, entry.end));
  }
  const result = new File(parts, file.name, { type: file.type || 'image/png', lastModified: file.lastModified });
  return result.size < file.size ? result : file;
}

/** Only trailing MP4 padding can be removed without changing sample offsets or encoded tracks. */
export async function trimVideoPadding(file: File): Promise<File> {
  let at = 0, keepThrough = 0, media = false;
  for (let count = 0; at < file.size && count < 512; count++) {
    const head = new Uint8Array(await file.slice(at, at + 16).arrayBuffer());
    if (head.length < 8) return file;
    const view = new DataView(head.buffer);
    const type = String.fromCharCode(...head.subarray(4, 8));
    let length = view.getUint32(0);
    if (length === 1) {
      if (head.length < 16) return file;
      length = Number(view.getBigUint64(8));
      if (length < 16) return file;
    } else if (length === 0) length = file.size - at;
    if (length < 8 || !Number.isSafeInteger(length) || at + length > file.size) return file;
    if (at === 0 && type !== 'ftyp') return file;
    if (type === 'mdat') media = true;
    at += length;
    if (type !== 'free' && type !== 'skip') keepThrough = at;
  }
  if (at !== file.size || !media || keepThrough === file.size || !keepThrough) return file;
  return new File([file.slice(0, keepThrough)], file.name, { type: file.type, lastModified: file.lastModified });
}
export async function losslessMedia(file: File): Promise<File> {
  try {
    if (file.type === 'image/png' || /\.png$/i.test(file.name)) return await repackPng(file);
    if (/^video\/(mp4|quicktime)$/.test(file.type) || /\.(mp4|mov|m4v)$/i.test(file.name)) return await trimVideoPadding(file);
  } catch { /* Unsupported or corrupt media is preserved for normal upload validation. */ }
  return file;
}
