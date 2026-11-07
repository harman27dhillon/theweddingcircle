import { compressPhoto } from './photo-compression';
const prepared = new WeakMap<File, Promise<File>>();
let work: Promise<unknown> = Promise.resolve();
/** Serialize photo preparation to keep phone memory bounded; never upload an unprocessed large photo. */
export function optimiseMedia(file: File): Promise<File> {
  const cached = prepared.get(file);
  if (cached) return cached;
  const photo = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name);
  const result = work.then(() => new Promise<File>((resolve, reject) => {
    const fallback = () => { if (photo) compressPhoto(file).then(resolve, reject); else resolve(file); };
    if (typeof Worker === 'undefined') { fallback(); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./media-optimize.worker.ts', import.meta.url), { type: 'module' }); }
    catch { fallback(); return; }
    const finish = (next?: File, error?: string) => {
      clearTimeout(timer);worker.terminate();
      if (error) reject(new Error(error)); else resolve(next || file);
    };
    const timer = setTimeout(() => photo ? finish(undefined, 'Photo preparation took too long. Try again. Nothing was uploaded.') : finish(file), photo ? 45_000 : 1500);
    worker.onmessage = (event: MessageEvent<{ ok: boolean; file?: File; error?: string }>) => {
      if (!event.data.ok || !(event.data.file instanceof File)) finish(undefined, event.data.error || 'Photo compression failed. Nothing was uploaded.');
      else finish(event.data.file);
    };
    worker.onerror = (event) => { event.preventDefault();clearTimeout(timer);worker.terminate();fallback(); };
    try { worker.postMessage(file); } catch { clearTimeout(timer);worker.terminate();fallback(); }
  }));
  work = result.catch(() => undefined);
  prepared.set(file, result);
  void result.catch(() => prepared.delete(file));
  return result;
}
