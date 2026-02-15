# Website Blocker Chrome Extension — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Chrome extension that blocks distracting websites with domain-level blocking and path-level allowlisting.

**Architecture:** MV3 extension using `declarativeNetRequest` for native rule evaluation. Block rules at priority 1, allow rules at priority 2 (higher wins). Service worker syncs rules from `chrome.storage.sync`. Popup UI for managing blocklist/allowlist.

**Tech Stack:** Chrome Extension Manifest V3, declarativeNetRequest API, chrome.storage.sync, plain HTML/CSS/JS

**Design doc:** `docs/plans/2026-02-15-website-blocker-design.md`

---

### Task 1: Create manifest.json and blocked.html

**Files:**
- Create: `manifest.json`
- Create: `blocked.html`

**Step 1: Create manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Website Blocker",
  "version": "1.0",
  "description": "Block distracting websites with path-level allowlisting",
  "permissions": [
    "declarativeNetRequest",
    "storage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "service-worker.js"
  },
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

**Step 2: Create blocked.html**

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
    h1 {
      font-size: 2rem;
      font-weight: 400;
    }
  </style>
</head>
<body>
  <h1>This site is blocked.</h1>
</body>
</html>
```

**Step 3: Create placeholder icons**

Create `icons/` directory with placeholder PNG files (16x16, 48x48, 128x128). Simple red circle or shield shape. These can be generated with any image tool or replaced later.

**Step 4: Verify extension loads in Chrome**

1. Open `chrome://extensions/`
2. Enable "Developer mode" (toggle top-right)
3. Click "Load unpacked" and select the project directory
4. Expected: Extension appears in list. It will show an error about missing service-worker.js — that's expected, we'll create it next.

**Step 5: Commit**

```bash
git add manifest.json blocked.html icons/
git commit -m "feat: add manifest.json, blocked page, and placeholder icons"
```

---

### Task 2: Create service-worker.js — rule management

**Files:**
- Create: `service-worker.js`

The service worker has one job: read blocklist/allowlist from `chrome.storage.sync` and convert them into `declarativeNetRequest` dynamic rules.

**Step 1: Create service-worker.js**

```js
function buildRules(blockedDomains, allowedPaths) {
  const rules = [];
  let id = 1;

  for (const domain of blockedDomains) {
    rules.push({
      id: id++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: { extensionPath: "/blocked.html" }
      },
      condition: {
        urlFilter: "||" + domain,
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
        urlFilter: "||" + path,
        resourceTypes: ["main_frame"]
      }
    });
  }

  return rules;
}

async function syncRules() {
  const data = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });

  const newRules = buildRules(data.blockedDomains, data.allowedPaths);

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map(r => r.id);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: newRules
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    syncRules();
  }
});

syncRules();
```

**Step 2: Reload extension in Chrome and verify no errors**

1. Go to `chrome://extensions/`
2. Click the reload button on the extension
3. Click "Service worker" link to open DevTools for the background script
4. Expected: No errors in console. Service worker loaded successfully.

**Step 3: Commit**

```bash
git add service-worker.js
git commit -m "feat: add service worker for declarativeNetRequest rule management"
```

---

### Task 3: Create popup UI — HTML and CSS

**Files:**
- Create: `popup.html`
- Create: `popup.css`

**Step 1: Create popup.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>Website Blocker</h1>

  <section>
    <h2>Blocked Domains</h2>
    <ul id="blocked-list"></ul>
    <form id="blocked-form">
      <input type="text" id="blocked-input" placeholder="example.com" required>
      <button type="submit">Add</button>
    </form>
  </section>

  <section>
    <h2>Allowed Paths</h2>
    <ul id="allowed-list"></ul>
    <form id="allowed-form">
      <input type="text" id="allowed-input" placeholder="reddit.com/r/austin" required>
      <button type="submit">Add</button>
    </form>
  </section>

  <script src="popup.js"></script>
</body>
</html>
```

**Step 2: Create popup.css**

```css
body {
  width: 320px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  padding: 16px;
  margin: 0;
}

h1 {
  font-size: 16px;
  margin: 0 0 16px;
}

h2 {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #666;
  margin: 16px 0 8px;
}

ul {
  list-style: none;
  padding: 0;
  margin: 0 0 8px;
}

li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 8px;
  background: #f5f5f5;
  border-radius: 4px;
  margin-bottom: 4px;
}

li span {
  word-break: break-all;
}

li button {
  background: none;
  border: none;
  cursor: pointer;
  color: #999;
  font-size: 16px;
  padding: 0 0 0 8px;
}

li button:hover {
  color: #e33;
}

form {
  display: flex;
  gap: 8px;
}

input[type="text"] {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 14px;
}

button[type="submit"] {
  padding: 6px 12px;
  background: #4a90d9;
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

button[type="submit"]:hover {
  background: #357abd;
}
```

**Step 3: Reload extension, click icon, verify popup renders**

1. Reload extension at `chrome://extensions/`
2. Click the extension icon in the toolbar
3. Expected: Popup opens showing "Website Blocker" heading, two sections with empty lists and input fields. No JS errors (popup.js doesn't exist yet, so there will be a console error for that — expected).

**Step 4: Commit**

```bash
git add popup.html popup.css
git commit -m "feat: add popup UI markup and styling"
```

---

### Task 4: Create popup.js — add/remove logic

**Files:**
- Create: `popup.js`

**Step 1: Create popup.js**

```js
const blockedList = document.getElementById("blocked-list");
const allowedList = document.getElementById("allowed-list");
const blockedForm = document.getElementById("blocked-form");
const allowedForm = document.getElementById("allowed-form");
const blockedInput = document.getElementById("blocked-input");
const allowedInput = document.getElementById("allowed-input");

function renderList(ul, items, storageKey) {
  ul.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = item;
    li.appendChild(span);

    const btn = document.createElement("button");
    btn.textContent = "\u00d7";
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
  const list = data[storageKey].filter(item => item !== value);
  await chrome.storage.sync.set({ [storageKey]: list });
  loadAndRender();
}

blockedForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = blockedInput.value.trim().toLowerCase();
  if (value) {
    addItem("blockedDomains", value);
    blockedInput.value = "";
  }
});

allowedForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = allowedInput.value.trim().toLowerCase();
  if (value) {
    addItem("allowedPaths", value);
    allowedInput.value = "";
  }
});

loadAndRender();
```

**Step 2: Reload extension, verify popup works**

1. Reload extension
2. Open popup, type `reddit.com` in blocked domains, click Add
3. Expected: "reddit.com" appears in the blocked list with an x button
4. Type `reddit.com/r/austin` in allowed paths, click Add
5. Expected: "reddit.com/r/austin" appears in the allowed list
6. Close and reopen popup — entries should persist

**Step 3: Commit**

```bash
git add popup.js
git commit -m "feat: add popup logic for managing blocklist and allowlist"
```

---

### Task 5: End-to-end verification

**No new files.** This task verifies everything works together.

**Step 1: Reload extension and add test rules**

1. Reload extension at `chrome://extensions/`
2. Open popup, add `reddit.com` to blocked domains
3. Add `reddit.com/r/austin` to allowed paths

**Step 2: Verify blocking works**

1. Navigate to `https://www.reddit.com`
2. Expected: Redirected to blocked.html showing "This site is blocked."
3. Navigate to `https://www.reddit.com/r/funny`
4. Expected: Redirected to blocked.html

**Step 3: Verify allowlisting works**

1. Navigate to `https://www.reddit.com/r/austin`
2. Expected: Page loads normally (not blocked)

**Step 4: Verify removal works**

1. Open popup, click x next to `reddit.com`
2. Navigate to `https://www.reddit.com`
3. Expected: Page loads normally (no longer blocked)

**Step 5: Fix any issues found during verification**

If any step above fails, debug using:
- `chrome://extensions/` → Service worker → DevTools console
- Popup DevTools (right-click popup → Inspect)
- `chrome.declarativeNetRequest.getDynamicRules()` in service worker console to inspect active rules

**Step 6: Commit if any fixes were made**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```

---

### Task 6: Generate proper extension icons

**Files:**
- Create/replace: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

**Step 1: Generate icons**

Create simple shield or block icon in red/gray. Three sizes: 16x16, 48x48, 128x128 pixels. Can use any image tool, or generate programmatically with a canvas script.

**Step 2: Reload extension and verify icons appear**

1. Reload extension
2. Expected: Custom icon visible in toolbar and on `chrome://extensions/` page

**Step 3: Commit**

```bash
git add icons/
git commit -m "feat: add extension icons"
```
