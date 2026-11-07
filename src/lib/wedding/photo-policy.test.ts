import test from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_QUALITY, PHOTO_MAX_BYTES, PHOTO_TARGET_BYTES, isHeicPhoto, nextPhotoDimensions, photoDimensions } from './photo-policy.ts';
test('photo policy uses high quality within a bounded upload budget', () => {
  assert.equal(PHOTO_QUALITY, 0.9);assert.ok(PHOTO_TARGET_BYTES < PHOTO_MAX_BYTES);assert.equal(PHOTO_MAX_BYTES, 2_000_000);
});
test('photo dimensions preserve aspect ratio and never upscale', () => {
  assert.deepEqual(photoDimensions(8000,6000),{width:4096,height:3072});
  assert.deepEqual(photoDimensions(600,800),{width:600,height:800});
  const next=nextPhotoDimensions(4096,3072,5_000_000,1_500_000);assert.ok(next.width<4096);assert.ok(Math.abs(next.width/next.height-4/3)<0.001);
  assert.deepEqual(nextPhotoDimensions(800,600,3_000_000,1_500_000),{width:800,height:600});assert.throws(()=>photoDimensions(0,100));
});
test('HEIC detection accepts phone MIME and extension variations', () => {
  assert.ok(isHeicPhoto({type:'image/heic',name:'photo'}));assert.ok(isHeicPhoto({type:'application/octet-stream',name:'IMG_123.HEIF'}));assert.equal(isHeicPhoto({type:'image/jpeg',name:'photo.jpg'}),false);
});
