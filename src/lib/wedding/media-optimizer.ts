import { compressPhoto } from './photo-compression';
import { losslessMedia } from './lossless-media';
const prepared = new WeakMap<File, Promise<File>>();
let work: Promise<unknown> = Promise.resolve();
/** Try background encoders, browser fallbacks, and lossless repacking; preserve the upload when they fail. */
export function optimiseMedia(file: File): Promise<File> {
  const cached = prepared.get(file);
  if (cached) return cached;
  const photo = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name);
  const result = work.then(() => new Promise<File>((resolve) => {
    const bounded = (job: Promise<File>, ms: number) => new Promise<File>((done) => {
      const timer = setTimeout(() => done(file), ms);
      void job.then(done, () => done(file)).finally(() => clearTimeout(timer));
    });
    const lastResort = () => { void bounded(losslessMedia(file), 1500).then(resolve); };
    const fallback = () => {
      if (!photo) { lastResort(); return; }
      void bounded(compressPhoto(file), 12_000).then((next) => next === file ? lastResort() : resolve(next));
    };
    if (typeof Worker === 'undefined') { fallback(); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./media-optimize.worker.ts', import.meta.url), { type: 'module' }); }
    catch { fallback(); return; }
    const finish = (next?: File, error?: string) => {
      clearTimeout(timer);worker.terminate();
      if (error) fallback(); else resolve(next || file);
    };
    const timer = setTimeout(() => { worker.terminate();lastResort(); }, photo ? 45_000 : 1500);
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
