import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDomain, normalizePath, compileDomain, compilePath, isBlocked, buildRules } from "../core.js";

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

test("compileDomain matches domain, subdomains, any path, optional port", () => {
  const re = new RegExp(compileDomain("reddit.com"), "i");
  assert.ok(re.test("https://reddit.com"));
  assert.ok(re.test("https://reddit.com/"));
  assert.ok(re.test("http://www.reddit.com/r/all"));
  assert.ok(re.test("https://old.reddit.com/r/nba?x=1"));
  assert.ok(re.test("https://REDDIT.com/R/ALL"));
  assert.ok(re.test("https://reddit.com:8080/r/all"));
  assert.ok(!re.test("https://notreddit.com"));
  assert.ok(!re.test("https://reddit.com.evil.io"));
});

test("compilePath matches host+path prefix on path boundaries", () => {
  const re = new RegExp(compilePath("reddit.com/r/austin"), "i");
  assert.ok(re.test("https://reddit.com/r/austin"));
  assert.ok(re.test("https://www.reddit.com/r/austin/comments/abc"));
  assert.ok(re.test("https://old.reddit.com/r/austin?sort=new"));
  assert.ok(!re.test("https://reddit.com/r/austintexas"));
  assert.ok(!re.test("https://reddit.com/r/aus"));
});

test("compilers escape regex metacharacters", () => {
  const re = new RegExp(compilePath("example.com/a+b(c)"), "i");
  assert.ok(re.test("https://example.com/a+b(c)"));
  assert.ok(!re.test("https://example.com/aab-c-"));
});

test("isBlocked: allow beats block; subdomains and case covered", () => {
  const blocked = ["reddit.com"];
  const allowed = ["reddit.com/r/austin"];
  assert.equal(isBlocked("https://reddit.com/", blocked, allowed), true);
  assert.equal(isBlocked("https://old.reddit.com/r/nba", blocked, allowed), true);
  assert.equal(isBlocked("https://WWW.Reddit.com/R/Austin", blocked, allowed), false);
  assert.equal(isBlocked("https://reddit.com/r/austin/comments/x", blocked, allowed), false);
  assert.equal(isBlocked("https://example.com/", blocked, allowed), false);
});

test("isBlocked ignores fragments and tolerates garbage input", () => {
  assert.equal(isBlocked("https://reddit.com/page#frag", ["reddit.com"], []), true);
  assert.equal(isBlocked("not a url", ["reddit.com"], []), false);
  assert.equal(isBlocked("", ["reddit.com"], []), false);
});

test("compilers are not fooled by userinfo in the URL", () => {
  assert.equal(isBlocked("https://evil.com@reddit.com/", ["reddit.com"], []), true);
  assert.equal(isBlocked("https://user:pass@reddit.com/x", ["reddit.com"], []), true);
  assert.equal(isBlocked("https://reddit.com@evil.com/", ["reddit.com"], []), false);
  assert.equal(
    isBlocked("https://a@www.reddit.com/r/austin", ["reddit.com"], ["reddit.com/r/austin"]),
    false
  );
});

test("compilePath throws on entries without a slash", () => {
  assert.throws(() => compilePath("reddit"), /must contain '\/'/);
});

const ORIGIN = "chrome-extension://abcdefgh";

test("buildRules: block rules redirect with regexSubstitution, priority 1", () => {
  const rules = buildRules({
    blockedDomains: ["reddit.com", "x.com"],
    allowedPaths: [],
    paused: false,
    extensionOrigin: ORIGIN
  });
  assert.equal(rules.length, 2);
  assert.deepEqual(rules.map(r => r.id), [1, 2]);
  const r = rules[0];
  assert.equal(r.priority, 1);
  assert.equal(r.action.type, "redirect");
  assert.equal(
    r.action.redirect.regexSubstitution,
    ORIGIN + "/blocked.html?url=\\0"
  );
  assert.equal(r.condition.regexFilter, compileDomain("reddit.com"));
  assert.equal(r.condition.isUrlFilterCaseSensitive, false);
  assert.deepEqual(r.condition.resourceTypes, ["main_frame"]);
});

test("buildRules: allow rules at priority 2 after block rules", () => {
  const rules = buildRules({
    blockedDomains: ["reddit.com"],
    allowedPaths: ["reddit.com/r/austin"],
    paused: false,
    extensionOrigin: ORIGIN
  });
  assert.equal(rules.length, 2);
  const allow = rules[1];
  assert.equal(allow.id, 2);
  assert.equal(allow.priority, 2);
  assert.equal(allow.action.type, "allow");
  assert.equal(allow.condition.regexFilter, compilePath("reddit.com/r/austin"));
});

test("buildRules: pause adds one allow-all rule at priority 9, only when paused", () => {
  const base = {
    blockedDomains: ["reddit.com"],
    allowedPaths: [],
    extensionOrigin: ORIGIN
  };
  const unpaused = buildRules({ ...base, paused: false });
  assert.equal(unpaused.length, 1);
  const paused = buildRules({ ...base, paused: true });
  assert.equal(paused.length, 2);
  const pauseRule = paused[1];
  assert.equal(pauseRule.priority, 9);
  assert.equal(pauseRule.action.type, "allow");
  assert.equal(pauseRule.condition.regexFilter, "^https?://");
});

test("buildRules: empty state yields no rules (or only pause rule)", () => {
  assert.deepEqual(
    buildRules({ blockedDomains: [], allowedPaths: [], paused: false, extensionOrigin: ORIGIN }),
    []
  );
});
