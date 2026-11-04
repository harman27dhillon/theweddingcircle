import assert from "node:assert/strict";
import test from "node:test";
import {
  addressesArePublic,
  bodyTooLarge,
  extractImages,
  isPrivateIp,
  nextRedirect,
  publicHttpUrl,
} from "./html-import.ts";

const page = "https://example.com/weddings/look.html";

test("html import reads img, srcset, lazy sources and open graph images", () => {
  const images = extractImages(`
    <img src="photos/hall.jpg" alt="Hall & flowers" width="1200" height="800">
    <img data-src="/photos/lazy.jpg" alt="Lazy">
    <img srcset="small.jpg 400w, photos/wide.jpg 1200w" alt="Wide">
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
  `, page);
  assert.equal(images.some((item) => item.url === "https://example.com/weddings/photos/hall.jpg" && item.alt === "Hall & flowers" && item.width === 1200), true);
  assert.equal(images.some((item) => item.url === "https://example.com/photos/lazy.jpg"), true);
  assert.equal(images.some((item) => item.url === "https://example.com/weddings/photos/wide.jpg"), true);
  assert.equal(images.some((item) => item.url === "https://cdn.example.com/og.jpg" && item.sourceUrl === page), true);
  assert.equal(new Set(images.map((item) => item.id)).size, images.length);
});

test("html import drops duplicates, tiny images, missing images and broken markup", () => {
  const images = extractImages(`
    <<<not html
    <img src="photos/hall.jpg" alt="One">
    <img src="photos/hall.jpg" alt="Again">
    <img src="pixel.gif" width="1" height="1" alt="">
    <img src="data:image/gif;base64,aaaa" alt="inline">
    <img src="http://127.0.0.1/secret.jpg" alt="local">
    <p>No pictures here</p>
  `, page);
  assert.equal(images.length, 1);
  assert.equal(images[0]?.url, "https://example.com/weddings/photos/hall.jpg");
  assert.deepEqual(extractImages("<p>Nothing</p>", page), []);
  assert.deepEqual(extractImages("", "not a url"), []);
});

test("html import refuses private hosts, unsafe redirects and oversized pages", () => {
  assert.equal(Boolean(publicHttpUrl("https://example.com/a")), true);
  assert.equal(publicHttpUrl("http://localhost/a"), null);
  assert.equal(publicHttpUrl("http://127.0.0.1/a"), null);
  assert.equal(publicHttpUrl("http://169.254.169.254/latest"), null);
  assert.equal(publicHttpUrl("http://metadata.google.internal/"), null);
  assert.equal(publicHttpUrl("file:///etc/passwd"), null);
  assert.equal(publicHttpUrl("http://user:pass@example.com/"), null);
  assert.equal(isPrivateIp("10.1.2.3"), true);
  assert.equal(isPrivateIp("192.168.0.4"), true);
  assert.equal(isPrivateIp("172.16.5.5"), true);
  assert.equal(isPrivateIp("::1"), true);
  assert.equal(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.equal(addressesArePublic(["8.8.8.8"]), true);
  assert.equal(addressesArePublic(["8.8.8.8", "10.0.0.2"]), false);
  assert.equal(addressesArePublic([]), false);
  assert.equal(nextRedirect(page, "https://cdn.example.com/next", 0).ok, true);
  assert.equal(nextRedirect(page, "http://192.168.1.8/next", 0).ok, false);
  assert.equal(nextRedirect(page, "/other", 2).ok, true);
  assert.equal(nextRedirect(page, "/other", 3).ok, false);
  assert.equal(bodyTooLarge(1_500_000), false);
  assert.equal(bodyTooLarge(1_500_001), true);
});
