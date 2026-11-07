import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { losslessMedia } from './lossless-media.ts';
function chunk(type: string, data: Buffer) {
  const b = Buffer.alloc(data.length + 12); b.writeUInt32BE(data.length); b.write(type, 4); data.copy(b, 8);
  let c = 0xffffffff;
  for (const byte of b.subarray(4, -4)) { c ^= byte; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  b.writeUInt32BE((c ^ 0xffffffff) >>> 0, b.length - 4); return b;
}
function png() {
  const raw = Buffer.alloc((256 * 4 + 1) * 256, 127);
  for (let y = 0; y < 256; y++) raw[y * 1025] = 0;
  const header = Buffer.alloc(13); header.writeUInt32BE(256); header.writeUInt32BE(256, 4); header[8] = 8; header[9] = 6;
  return { raw, file: new File([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('tEXt', Buffer.from('Comment\0Keep my metadata')), chunk('IDAT', deflateSync(raw, { level: 0 })), chunk('IEND', Buffer.alloc(0))], 'original.png', { type: 'image/png', lastModified: 12345 }) };
}
test('PNG shrinks without changing any filtered pixel bytes, dimensions or ancillary metadata', async () => {
  const { raw, file } = png(); const result = await losslessMedia(file);
  assert.ok(result.size < file.size / 10); assert.equal(result.lastModified, file.lastModified);
  const bytes = Buffer.from(await result.arrayBuffer()); const data: Buffer[] = [];
  assert.ok(bytes.includes(Buffer.from('Keep my metadata')));
  for (let at = 8; at < bytes.length;) { const len = bytes.readUInt32BE(at); if (bytes.toString('ascii', at+4, at+8) === 'IDAT') data.push(bytes.subarray(at+8, at+8+len)); at += len+12; }
  assert.deepEqual(inflateSync(Buffer.concat(data)), raw);
});
function box(type: string, bytes: Buffer) { const b=Buffer.alloc(bytes.length+8);b.writeUInt32BE(b.length);b.write(type,4);bytes.copy(b,8);return b; }
test('video removes trailing padding only; every encoded track and offset remains unchanged', async () => {
  const media = Buffer.concat([box('ftyp',Buffer.from('isom0000')),box('free',Buffer.alloc(32)),box('mdat',Buffer.from('original audio and video')),box('moov',Buffer.from('sample offsets'))]);
  const file = new File([media,box('free',Buffer.alloc(4096))], 'clip.mp4',{type:'video/mp4'});
  const result = await losslessMedia(file); assert.deepEqual(Buffer.from(await result.arrayBuffer()), media);
  const already = new File([media],'clip.mp4',{type:'video/mp4'}); assert.equal(await losslessMedia(already),already);
});
test('JPEG, GIF, WebM and invalid or corrupt PNG stay byte-for-byte original', async () => {
  for (const [name,type] of [['photo.jpg','image/jpeg'],['animation.gif','image/gif'],['video.webm','video/webm'],['broken.png','image/png']]) {
    const file=new File([new Uint8Array(70000)],name,{type});assert.equal(await losslessMedia(file),file);
  }
  const {file}=png();const corrupt=new Uint8Array(await file.arrayBuffer());corrupt[60]^=1;const broken=new File([corrupt],'bad.png',{type:'image/png'});assert.equal(await losslessMedia(broken),broken);
});
