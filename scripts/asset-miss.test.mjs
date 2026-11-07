import assert from "node:assert/strict";
import test from "node:test";
import { assetCacheable, rewriteMissingAsset } from "./asset-miss.mjs";

test("missing asset URLs become a no-store 404 and never keep the HTML shell", () => {
  const html = rewriteMissingAsset({ pathname: "/assets/index-DFZdCwFD.js", status: 200, contentType: "text/html; charset=utf-8" });
  assert.equal(html?.status, 404);
  assert.equal(html?.cacheControl, "no-store");
  assert.equal(html?.contentType.startsWith("text/plain"), true);
  assert.equal(html?.body.includes("<"), false);
  const missing = rewriteMissingAsset({ pathname: "/assets/styles-Cj5jXX5R.css", status: 404, contentType: "text/html" });
  assert.equal(missing?.status, 404);
  assert.equal(missing?.cacheControl, "no-store");
});

test("real javascript and css responses are left alone", () => {
  assert.equal(rewriteMissingAsset({ pathname: "/assets/index-DFZdCwFD.js", status: 200, contentType: "text/javascript" }), null);
  assert.equal(rewriteMissingAsset({ pathname: "/assets/styles-Cj5jXX5R.css", status: 200, contentType: "text/css; charset=utf-8" }), null);
  assert.equal(rewriteMissingAsset({ pathname: "/assets/developer/landing/rose-garden.webp", status: 200, contentType: "image/png" }), null);
  assert.equal(rewriteMissingAsset({ pathname: "/", status: 200, contentType: "text/html" }), null);
});

test("only a real 200 script, style, or other asset may be cached", () => {
  assert.equal(assetCacheable(200, "text/javascript"), true);
  assert.equal(assetCacheable(200, "text/css"), true);
  assert.equal(assetCacheable(200, "image/webp"), true);
  assert.equal(assetCacheable(200, "text/html"), false);
  assert.equal(assetCacheable(404, "text/javascript"), false);
  assert.equal(assetCacheable(200, "text/html", false), false);
  assert.equal(assetCacheable(200, "text/css", true), false);
});
