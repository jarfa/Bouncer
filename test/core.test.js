import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, normalizePath } from "../core.js";

test("normalizeDomain accepts a plain domain", () => {
  assert.equal(normalizeDomain("reddit.com"), "reddit.com");
});

test("normalizeDomain trims, lowercases, strips scheme/www/path/trailing dot", () => {
  assert.equal(normalizeDomain("  HTTPS://WWW.Reddit.com/r/all/  "), "reddit.com");
  assert.equal(normalizeDomain("http://news.ycombinator.com"), "news.ycombinator.com");
  assert.equal(normalizeDomain("reddit.com."), "reddit.com");
  assert.equal(normalizeDomain("reddit.com?utm=1"), "reddit.com");
});

test("normalizeDomain keeps non-www subdomains", () => {
  assert.equal(normalizeDomain("old.reddit.com"), "old.reddit.com");
});

test("normalizeDomain rejects invalid input", () => {
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("   "), null);
  assert.equal(normalizeDomain("reddit"), null);          // no dot
  assert.equal(normalizeDomain("red dit.com"), null);     // space
  assert.equal(normalizeDomain("reddit..com"), null);     // empty label
  assert.equal(normalizeDomain("-reddit.com"), null);     // bad label start
  assert.equal(normalizeDomain("chrome://extensions"), null);
});

test("normalizePath accepts host/path and normalizes like normalizeDomain", () => {
  assert.equal(normalizePath("reddit.com/r/austin"), "reddit.com/r/austin");
  assert.equal(normalizePath("HTTPS://WWW.Reddit.com/R/Austin/"), "reddit.com/r/austin");
});

test("normalizePath rejects input without a path segment", () => {
  assert.equal(normalizePath("reddit.com"), null);
  assert.equal(normalizePath("reddit.com/"), null);
  assert.equal(normalizePath("reddit.com///"), null);
});

test("normalizePath rejects invalid hosts or whitespace paths", () => {
  assert.equal(normalizePath("not a host/path"), null);
  assert.equal(normalizePath("reddit.com/r/has space"), null);
  assert.equal(normalizePath(""), null);
});
