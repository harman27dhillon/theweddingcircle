import { losslessMedia } from './lossless-media';
import { compressPhoto } from './photo-compression';
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const photo = file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i.test(file.name);
    self.postMessage({ ok: true, file: photo ? await compressPhoto(file) : await losslessMedia(file) });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : 'Photo compression failed. Nothing was uploaded.' });
  }
};
