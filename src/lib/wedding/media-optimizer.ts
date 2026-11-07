const prepared = new WeakMap<File, Promise<File>>();
let work: Promise<unknown> = Promise.resolve();
/** File blobs are cloned lazily to one worker. The UI never waits for pixel decoding. */
export function optimiseLosslessly(file: File): Promise<File> {
  const cached = prepared.get(file);
  if (cached) return cached;
  const result = work.then(() => new Promise<File>((resolve) => {
    if (typeof Worker === 'undefined' || !(/\.png$|\.(mp4|mov|m4v)$/i.test(file.name) || /image\/png|video\/(mp4|quicktime)/.test(file.type))) { resolve(file); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./media-optimize.worker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve(file); return; }
    const finish = (next: File) => { clearTimeout(timer); worker.terminate(); resolve(next.size < file.size ? next : file); };
    const timer = setTimeout(() => finish(file), 1500);
    worker.onmessage = (event: MessageEvent<File>) => finish(event.data);
    worker.onerror = () => finish(file);
    try { worker.postMessage(file); } catch { finish(file); }
  }));
  work = result.catch(() => undefined);
  prepared.set(file, result);
  return result;
}
