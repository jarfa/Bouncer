# Bouncer Reconciler-Core Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite Bouncer's service worker around an idempotent state reconciler, with a URL-preserving blocked page, unified matching logic, input validation, and a node:test suite.

**Architecture:** All extension state (blocked/allowed lists in `chrome.storage.sync`, `pauseEnd` timestamp in `chrome.storage.local`) is reconciled into the complete declarativeNetRequest dynamic rule set by one serialized `reconcile()` function. Pause adds a single high-priority allow-all rule instead of deleting block rules. Pure logic lives in `core.js`, shared by the service worker, the popup, and tests. Spec: `docs/superpowers/specs/2026-07-02-bouncer-rewrite-design.md`.

**Tech Stack:** Chrome extension Manifest V3 (ES modules), vanilla JS, Node built-in test runner (`node --test`). No dependencies, no build step.

---

## File structure

```
package.json         — NEW: {"type":"module"} so node:test can import core.js (no deps)
core.js              — NEW: normalizers, regex compilers, isBlocked, buildRules (pure)
test/core.test.js    — NEW: node:test suite for core.js
service-worker.js    — REWRITTEN: reconciler + event glue (imports core.js)
blocked.html         — REWRITTEN: shows blocked URL
blocked.js           — NEW: renders ?url= param (MV3 forbids inline scripts)
manifest.json        — MODIFIED: v2.0, module worker, web_accessible_resources
popup.html           — MODIFIED: module script tag, inline error elements
popup.css            — MODIFIED: error message style
popup.js             — MODIFIED: validation on add, pauseEnd-derived pause state
README.md            — MODIFIED: reflect new structure and behavior
```

Conventions for every task:
- Run tests with `node --test` from the repo root.
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Chrome APIs are NOT available in tests; anything touching `chrome.*` is glue code verified manually in Task 8.

---

### Task 1: package.json + core.js normalizers

**Files:**
- Create: `package.json`
- Create: `core.js`
- Test: `test/core.test.js`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "bouncer",
  "private": true,
  "version": "2.0.0",
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Write failing tests for normalizers**

Create `test/core.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test`
Expected: FAIL — `Cannot find module ... core.js`

- [ ] **Step 4: Implement the normalizers**

Create `core.js`:

```js
// Pure logic shared by the service worker, popup, and tests.
// No chrome.* APIs allowed in this file.

const DOMAIN_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function stripToHostAndRest(input) {
  let s = String(input).trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.replace(/^www\./, "");
  return s;
}

export function normalizeDomain(input) {
  let s = stripToHostAndRest(input);
  s = s.split(/[/?#]/)[0];
  s = s.replace(/\.$/, "");
  return DOMAIN_RE.test(s) ? s : null;
}

export function normalizePath(input) {
  const s = stripToHostAndRest(input);
  const slash = s.indexOf("/");
  if (slash === -1) return null;
  const host = s.slice(0, slash).replace(/\.$/, "");
  const path = s.slice(slash + 1).replace(/\/+$/, "");
  if (!DOMAIN_RE.test(host)) return null;
  if (path === "" || /\s/.test(path)) return null;
  return host + "/" + path;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test`
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add package.json core.js test/core.test.js
git commit -m "feat: core.js normalizers with node:test suite"
```

---

### Task 2: core.js regex compilers + isBlocked

**Files:**
- Modify: `core.js` (append)
- Test: `test/core.test.js` (append)

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.js` (add `compileDomain`, `compilePath`, `isBlocked` to the existing import from `../core.js`):

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: new tests FAIL — `compileDomain` is not exported

- [ ] **Step 3: Implement compilers and isBlocked**

Append to `core.js`:

```js
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Generated regexes are used BOTH as DNR regexFilter (RE2) and in JS.
// Keep them simple: anchored, no lookarounds.
export function compileDomain(domain) {
  return (
    "^https?://([^/:]*\\.)?" + escapeRegex(domain) + "(:\\d+)?(/.*)?$"
  );
}

export function compilePath(entry) {
  const slash = entry.indexOf("/");
  const host = entry.slice(0, slash);
  const path = entry.slice(slash);
  return (
    "^https?://([^/:]*\\.)?" +
    escapeRegex(host) +
    "(:\\d+)?" +
    escapeRegex(path) +
    "([/?#].*)?$"
  );
}

export function isBlocked(url, blockedDomains, allowedPaths) {
  const target = String(url).split("#")[0];
  if (!/^https?:\/\//i.test(target)) return false;
  for (const p of allowedPaths) {
    if (new RegExp(compilePath(p), "i").test(target)) return false;
  }
  for (const d of blockedDomains) {
    if (new RegExp(compileDomain(d), "i").test(target)) return true;
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add core.js test/core.test.js
git commit -m "feat: shared regex compilers and isBlocked in core.js"
```

---

### Task 3: core.js buildRules

**Files:**
- Modify: `core.js` (append)
- Test: `test/core.test.js` (append)

- [ ] **Step 1: Write failing tests**

Append to `test/core.test.js` (add `buildRules` to the import):

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `node --test`
Expected: new tests FAIL — `buildRules` is not exported

- [ ] **Step 3: Implement buildRules**

Append to `core.js`:

```js
export function buildRules({ blockedDomains, allowedPaths, paused, extensionOrigin }) {
  const rules = [];
  let id = 1;

  for (const domain of blockedDomains) {
    rules.push({
      id: id++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: extensionOrigin + "/blocked.html?url=\\0"
        }
      },
      condition: {
        regexFilter: compileDomain(domain),
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    });
  }

  for (const path of allowedPaths) {
    rules.push({
      id: id++,
      priority: 2,
      action: { type: "allow" },
      condition: {
        regexFilter: compilePath(path),
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    });
  }

  if (paused) {
    rules.push({
      id: id++,
      priority: 9,
      action: { type: "allow" },
      condition: {
        regexFilter: "^https?://",
        resourceTypes: ["main_frame"]
      }
    });
  }

  return rules;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add core.js test/core.test.js
git commit -m "feat: buildRules produces complete DNR rule set incl. pause rule"
```

---

### Task 4: manifest.json + blocked page

**Files:**
- Modify: `manifest.json`
- Rewrite: `blocked.html`
- Create: `blocked.js`

No unit tests (browser-only); verified manually in Task 8.

- [ ] **Step 1: Update manifest.json**

Replace the full file with:

```json
{
  "manifest_version": 3,
  "name": "Bouncer",
  "version": "2.0",
  "description": "Block distracting websites with path-level allowlisting",
  "permissions": [
    "declarativeNetRequest",
    "storage",
    "webNavigation",
    "alarms"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  },
  "web_accessible_resources": [
    {
      "resources": ["blocked.html"],
      "matches": ["<all_urls>"]
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Rewrite blocked.html**

Replace the full file with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Blocked</title>
  <style>
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fff;
      color: #333;
    }
    main {
      max-width: 40rem;
      padding: 0 2rem;
      text-align: center;
    }
    h1 {
      font-size: 2rem;
      font-weight: 400;
      overflow-wrap: break-word;
    }
    #blocked-url {
      font-weight: 600;
    }
  </style>
</head>
<body>
  <main>
    <h1 id="generic" hidden>This site is blocked.</h1>
    <h1 id="with-url" hidden><span id="blocked-url"></span> is blocked.</h1>
  </main>
  <script src="blocked.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create blocked.js**

The URL arrives two ways: unencoded from DNR `regexSubstitution` (contains a
raw `://`), or percent-encoded from JS redirects (SPA/bfcache/sweep). Not a
module on purpose — it needs nothing from core.js.

```js
const PREFIX = "?url=";
let url = "";
if (location.search.startsWith(PREFIX)) {
  url = location.search.slice(PREFIX.length);
  if (!url.includes("://")) {
    try {
      url = decodeURIComponent(url);
    } catch {
      // keep raw value
    }
  }
}

if (url) {
  document.getElementById("blocked-url").textContent = url;
  document.getElementById("with-url").hidden = false;
} else {
  document.getElementById("generic").hidden = false;
}
```

- [ ] **Step 4: Commit**

```bash
git add manifest.json blocked.html blocked.js
git commit -m "feat: v2 manifest (module worker, WAR) and URL-preserving blocked page"
```

---

### Task 5: service-worker.js rewrite

**Files:**
- Rewrite: `service-worker.js`

Glue code over Chrome APIs; no unit tests, verified manually in Task 8. The
only top-level statements are imports and listener registrations (MV3
requirement; the old racy top-level async IIFE must NOT reappear).

- [ ] **Step 1: Replace service-worker.js entirely with:**

```js
import { buildRules, isBlocked, normalizeDomain, normalizePath } from "./core.js";

// --- state access ---

async function readState() {
  const sync = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  const local = await chrome.storage.local.get({ pauseEnd: 0 });
  return { ...sync, pauseEnd: local.pauseEnd };
}

function blockedPageUrl(originalUrl) {
  return (
    chrome.runtime.getURL("blocked.html") +
    "?url=" +
    encodeURIComponent(originalUrl)
  );
}

// --- reconciler ---
// Single source of truth: reads storage, applies the COMPLETE desired
// rule/alarm/badge state. Idempotent. All invocations serialized.

let queue = Promise.resolve();

function reconcile() {
  queue = queue.then(doReconcile).catch((err) => {
    console.error("reconcile failed:", err);
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#e33" });
  });
  return queue;
}

async function doReconcile() {
  const state = await readState();
  const paused = state.pauseEnd > Date.now();

  const rules = buildRules({
    blockedDomains: state.blockedDomains,
    allowedPaths: state.allowedPaths,
    paused,
    extensionOrigin: chrome.runtime.getURL("").replace(/\/$/, "")
  });

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules
  });

  await syncAlarms(state.pauseEnd, paused);
  updateBadge(state.pauseEnd, paused);
}

async function syncAlarms(pauseEnd, paused) {
  if (!paused) {
    await chrome.alarms.clear("pause-end");
    await chrome.alarms.clear("pause-badge");
    await chrome.alarms.clear("pause-warning");
    return;
  }
  chrome.alarms.create("pause-end", { when: pauseEnd });
  chrome.alarms.create("pause-badge", { periodInMinutes: 1 });
  if (pauseEnd - 30000 > Date.now()) {
    chrome.alarms.create("pause-warning", { when: pauseEnd - 30000 });
  } else {
    await chrome.alarms.clear("pause-warning");
  }
}

function updateBadge(pauseEnd, paused) {
  if (!paused) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const remaining = pauseEnd - Date.now();
  if (remaining <= 30000) {
    chrome.action.setBadgeText({ text: "30s" });
    chrome.action.setBadgeBackgroundColor({ color: "#e33" });
  } else {
    chrome.action.setBadgeText({ text: Math.ceil(remaining / 60000) + "m" });
    chrome.action.setBadgeBackgroundColor({ color: "#4a90d9" });
  }
}

// --- pause-expiry sweep: kick tabs off blocked sites, preserving URLs ---

async function sweepBlockedTabs() {
  const { blockedDomains, allowedPaths } = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && isBlocked(tab.url, blockedDomains, allowedPaths)) {
      chrome.tabs.update(tab.id, { url: blockedPageUrl(tab.url) });
    }
  }
}

// --- migration (runs on install and update) ---

async function migrate() {
  const data = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  const blockedDomains = [
    ...new Set(data.blockedDomains.map(normalizeDomain).filter(Boolean))
  ];
  const allowedPaths = [
    ...new Set(data.allowedPaths.map(normalizePath).filter(Boolean))
  ];
  await chrome.storage.sync.set({ blockedDomains, allowedPaths });
  await chrome.storage.local.remove("paused"); // legacy v1 flag
}

// --- event glue ---

chrome.runtime.onInstalled.addListener(() => {
  migrate().then(reconcile);
});

chrome.runtime.onStartup.addListener(() => {
  reconcile();
});

chrome.storage.onChanged.addListener(() => {
  reconcile();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(
    () => sendResponse({ ok: true }),
    (err) => sendResponse({ ok: false, error: err.message })
  );
  return true;
});

async function handleMessage(message) {
  if (message.action === "pause") {
    await chrome.storage.local.set({
      pauseEnd: Date.now() + message.duration
    });
  } else if (message.action === "extendPause") {
    const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
    if (pauseEnd > Date.now()) {
      await chrome.storage.local.set({ pauseEnd: pauseEnd + message.duration });
    }
  } else if (message.action === "resumeBlocking") {
    await chrome.storage.local.remove("pauseEnd");
  } else {
    throw new Error("unknown action: " + message.action);
  }
  await reconcile();
  if (message.action === "resumeBlocking") {
    await sweepBlockedTabs();
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pause-end") {
    await reconcile();
    await sweepBlockedTabs();
  } else if (alarm.name === "pause-badge" || alarm.name === "pause-warning") {
    const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
    updateBadge(pauseEnd, pauseEnd > Date.now());
  }
});

// Catches SPA pushState navigations (onHistoryStateUpdated) and
// back/forward-cache restores (onCommitted) that never hit the network,
// so DNR rules alone can't see them.
async function onNavigation(details) {
  if (details.frameId !== 0) return;
  const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
  if (pauseEnd > Date.now()) return;
  const { blockedDomains, allowedPaths } = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  if (isBlocked(details.url, blockedDomains, allowedPaths)) {
    chrome.tabs.update(details.tabId, { url: blockedPageUrl(details.url) });
  }
}

chrome.webNavigation.onHistoryStateUpdated.addListener(onNavigation);
chrome.webNavigation.onCommitted.addListener(onNavigation);
```

- [ ] **Step 2: Sanity-check module imports**

Run: `node --input-type=module -e "import('./core.js').then(m => console.log(Object.keys(m).join(',')))"`
Expected output includes: `buildRules,compileDomain,compilePath,isBlocked,normalizeDomain,normalizePath`

(Note: `service-worker.js` itself cannot be loaded in Node — it uses `chrome.*`.)

- [ ] **Step 3: Run existing tests to confirm nothing broke**

Run: `node --test`
Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add service-worker.js
git commit -m "feat: rewrite service worker as serialized state reconciler"
```

---

### Task 6: popup validation + pauseEnd-derived state

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`
- Rewrite: `popup.js`

- [ ] **Step 1: Update popup.html**

Change the script tag (last line of `<body>`) from
`<script src="popup.js"></script>` to:

```html
<script type="module" src="popup.js"></script>
```

Add an error line under each form. The two list sections become:

```html
  <section>
    <h2>Blocked Domains</h2>
    <ul id="blocked-list"></ul>
    <form id="blocked-form">
      <input type="text" id="blocked-input" placeholder="example.com" required>
      <button type="submit">Add</button>
    </form>
    <p class="form-error" id="blocked-error" hidden></p>
  </section>

  <section>
    <h2>Allowed Paths</h2>
    <ul id="allowed-list"></ul>
    <form id="allowed-form">
      <input type="text" id="allowed-input" placeholder="reddit.com/r/austin" required>
      <button type="submit">Add</button>
    </form>
    <p class="form-error" id="allowed-error" hidden></p>
  </section>
```

- [ ] **Step 2: Add error style to popup.css (append)**

```css
.form-error {
  color: #c0392b;
  font-size: 12px;
  margin: 4px 0 0;
}
```

- [ ] **Step 3: Rewrite popup.js**

Replace the full file with:

```js
import { normalizeDomain, normalizePath } from "./core.js";

const pauseDefault = document.getElementById("pause-default");
const pauseActive = document.getElementById("pause-active");
const pauseStatus = document.getElementById("pause-status");

let countdownInterval = null;
let pauseActionInProgress = false;

function renderPauseUI(pauseEnd) {
  if (pauseEnd > Date.now()) {
    pauseDefault.hidden = true;
    pauseActive.hidden = false;
    startCountdown(pauseEnd);
  } else {
    pauseDefault.hidden = false;
    pauseActive.hidden = true;
    stopCountdown();
  }
}

function startCountdown(pauseEnd) {
  stopCountdown();
  function tick() {
    const remaining = pauseEnd - Date.now();
    if (remaining <= 0) {
      renderPauseUI(0);
      loadAndRender();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    pauseStatus.textContent =
      "Paused — " + mins + ":" + secs.toString().padStart(2, "0") + " remaining";
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

async function sendPauseAction(action, duration) {
  if (pauseActionInProgress) return;
  pauseActionInProgress = true;
  try {
    const response = await chrome.runtime.sendMessage({ action, duration });
    if (response && !response.ok) {
      console.error("Pause action failed:", response.error);
    }
  } catch (err) {
    console.error("Failed to send pause action:", err);
  }
  const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
  renderPauseUI(pauseEnd);
  pauseActionInProgress = false;
}

document.getElementById("pause-1").addEventListener("click", () => {
  sendPauseAction("pause", 60000);
});

document.getElementById("pause-5").addEventListener("click", () => {
  sendPauseAction("pause", 300000);
});

document.getElementById("extend-1").addEventListener("click", () => {
  sendPauseAction("extendPause", 60000);
});

document.getElementById("extend-5").addEventListener("click", () => {
  sendPauseAction("extendPause", 300000);
});

document.getElementById("resume-btn").addEventListener("click", () => {
  sendPauseAction("resumeBlocking");
});

const blockedList = document.getElementById("blocked-list");
const allowedList = document.getElementById("allowed-list");
const blockedForm = document.getElementById("blocked-form");
const allowedForm = document.getElementById("allowed-form");
const blockedInput = document.getElementById("blocked-input");
const allowedInput = document.getElementById("allowed-input");
const blockedError = document.getElementById("blocked-error");
const allowedError = document.getElementById("allowed-error");

function renderList(ul, items, storageKey) {
  ul.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = item;
    li.appendChild(span);

    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.title = "Remove";
    btn.addEventListener("click", () => removeItem(storageKey, item));
    li.appendChild(btn);

    ul.appendChild(li);
  }
}

async function loadAndRender() {
  const data = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  renderList(blockedList, data.blockedDomains, "blockedDomains");
  renderList(allowedList, data.allowedPaths, "allowedPaths");

  const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
  renderPauseUI(pauseEnd);
}

async function addItem(storageKey, value) {
  const data = await chrome.storage.sync.get({ [storageKey]: [] });
  const list = data[storageKey];
  if (!list.includes(value)) {
    list.push(value);
    await chrome.storage.sync.set({ [storageKey]: list });
  }
  loadAndRender();
}

async function removeItem(storageKey, value) {
  const data = await chrome.storage.sync.get({ [storageKey]: [] });
  const list = data[storageKey].filter((item) => item !== value);
  await chrome.storage.sync.set({ [storageKey]: list });
  loadAndRender();
}

function handleAdd(e, { input, errorEl, normalize, storageKey, message }) {
  e.preventDefault();
  const normalized = normalize(input.value);
  if (normalized === null) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  addItem(storageKey, normalized);
  input.value = "";
}

blockedForm.addEventListener("submit", (e) =>
  handleAdd(e, {
    input: blockedInput,
    errorEl: blockedError,
    normalize: normalizeDomain,
    storageKey: "blockedDomains",
    message: "Not a valid domain (e.g. reddit.com)"
  })
);

allowedForm.addEventListener("submit", (e) =>
  handleAdd(e, {
    input: allowedInput,
    errorEl: allowedError,
    normalize: normalizePath,
    storageKey: "allowedPaths",
    message: "Not a valid domain/path (e.g. reddit.com/r/austin)"
  })
);

loadAndRender();
```

- [ ] **Step 4: Run tests to confirm nothing broke**

Run: `node --test`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: popup input validation and pauseEnd-derived pause state"
```

---

### Task 7: README update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the "How it works" section**

Replace the current bullet list and the sentence after it with:

```markdown
- **Domain blocking** via `declarativeNetRequest` -- Chrome evaluates rules natively, no JavaScript in the request path
- **Path allowlisting** with higher-priority rules that override domain blocks
- **SPA + back/forward blocking** via `webNavigation` catches `history.pushState` navigations and back/forward-cache restores that never hit the network
- **Reconciler architecture** -- one idempotent `reconcile()` derives the complete rule set from storage on every event; pausing adds a single high-priority allow rule instead of deleting block rules

Blocked pages show which URL was blocked, with no bypass option. Pausing (1 or
5 minutes) is only available from the toolbar popup; when a pause expires, tabs
on blocked sites are sent back to the blocked page with their URL preserved.
```

- [ ] **Step 2: Update the "Project structure" section**

Replace the code block with:

```
manifest.json        -- Extension manifest (MV3, module service worker)
core.js              -- Pure shared logic: matching, normalization, rule building
service-worker.js    -- State reconciler + navigation blocking
popup.html/js/css    -- Popup UI for managing lists and pausing
blocked.html/js      -- "This site is blocked" page (shows the blocked URL)
test/core.test.js    -- Unit tests for core.js (`node --test`)
```

And replace the final line ("No build step, no frameworks, no dependencies.") with:

```markdown
No build step, no frameworks, no dependencies. Run tests with `node --test`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: update README for reconciler rewrite"
```

---

### Task 8: Manual verification (human-in-the-loop)

**Files:** none — checklist for loading the extension in Chrome.

- [ ] Reload the unpacked extension at `chrome://extensions/` (service worker should show no errors; storage migration runs on update)
- [ ] Block `reddit.com`; navigating to `https://www.reddit.com` shows "www.reddit.com/… is blocked" with the URL visible
- [ ] Reloading the blocked tab keeps showing the blocked page (with URL) — no longer a mystery trap
- [ ] **The original bug:** hit blocked page → popup → "Pause 1 min" → retype `reddit.com` in the SAME tab/window → loads reddit
- [ ] Badge shows `1m` countdown, turns red `30s` near the end
- [ ] While on reddit, let the pause expire → tab is kicked to the blocked page showing reddit's URL
- [ ] "Resume" button ends the pause immediately and sweeps open blocked tabs
- [ ] Allowed path `reddit.com/r/austin` loads while `reddit.com` stays blocked; `old.reddit.com/r/austin` also loads (subdomain parity)
- [ ] Adding `https://x.com/` as a blocked domain stores `x.com`; adding `garbage` shows the inline error and blocks nothing
- [ ] Back button from an allowed page to a blocked page gets caught (bfcache path)

---

## Self-review notes

- Spec coverage: matching/normalization (Tasks 1–2), rule model (Task 3), manifest/WAR/blocked page incl. both URL encodings (Task 4), reconciler/alarms/badge/sweep/migration/onCommitted (Task 5), popup validation + pauseEnd derivation (Task 6), README (Task 7), manual acceptance incl. the original repro (Task 8).
- `resumeBlocking` also sweeps tabs (spec says expiry kicks tabs out; resume is the same policy applied early — matches "kick tabs out" strictness).
- Type consistency: `buildRules` signature identical in Task 3 tests, Task 3 impl, and Task 5 call site; normalizers used identically in Task 5 migration and Task 6 popup.
