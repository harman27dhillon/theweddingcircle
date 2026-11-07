import test from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_QUALITY, PHOTO_TARGET_BYTES, isHeicPhoto, nextPhotoDimensions, photoDimensions } from './photo-policy.ts';
test('photo policy uses high quality and a preferred size target', () => {
  assert.equal(PHOTO_QUALITY, 0.9);assert.equal(PHOTO_TARGET_BYTES, 1_500_000);
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

test('original fallback formats remain uploadable within the existing media limits', async () => {
  const { authorizeMedia, MEDIA_LIMITS } = await import('../infra/media-policy.ts');
  for (const mime of ['image/heic', 'image/heif', 'image/avif', 'image/bmp', 'image/tiff', 'video/x-matroska', 'video/x-msvideo']) {
    assert.ok(authorizeMedia({role:'host',member:true,weddingId:'test-room',purpose:'album',mime,bytes:3_000_000}).ok);
  }
  assert.equal(authorizeMedia({role:'host',member:true,weddingId:'test-room',purpose:'album',mime:'image/jpeg',bytes:MEDIA_LIMITS.image+1}).ok,false);
  assert.equal(authorizeMedia({role:'host',member:true,weddingId:'test-room',purpose:'album',mime:'image/svg+xml',bytes:1000}).ok,false);
});
