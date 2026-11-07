import { losslessMedia } from './lossless-media';
self.onmessage = async (event: MessageEvent<File>) => {
  self.postMessage(await losslessMedia(event.data));
};
