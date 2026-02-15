# Website Blocker Chrome Extension — Design

## Problem

Block distracting websites for productivity, with the ability to allow specific paths on blocked domains (e.g., block reddit.com but allow reddit.com/r/austin).

## Requirements

- Chrome extension (Manifest V3)
- Always-on blocking — no sessions or schedules
- General-purpose domain blocklist
- Path-level allowlist on blocked domains
- Blocked pages show a simple "This site is blocked" message, no bypass
- User manages blocklist/allowlist through the extension popup

## Approach

**Manifest V3 with `declarativeNetRequest`**

Chrome evaluates blocking/allowing rules natively — no JavaScript in the request path. Rules have priorities: block rules at priority 1, allow rules at priority 2. Higher priority wins, so allowed paths override blocked domains.

Chosen over:
- MV3 `webRequest` listener — service worker suspension causes gaps; `webRequest` is read-only in MV3 for most extensions
- MV2 — deprecated, will stop working, can't be published

## Architecture

### Rule evaluation

```
User visits reddit.com/r/funny
  -> "block reddit.com" matches (priority 1)
  -> "allow reddit.com/r/austin" does NOT match
  -> Redirected to blocked.html

User visits reddit.com/r/austin
  -> "block reddit.com" matches (priority 1)
  -> "allow reddit.com/r/austin" matches (priority 2, wins)
  -> Allowed through
```

### Components

1. **manifest.json** — MV3 manifest with `declarativeNetRequest` and `storage` permissions
2. **service-worker.js** — Reads from `chrome.storage.sync`, calls `updateDynamicRules()` to keep blocking rules in sync
3. **popup.html + popup.js + popup.css** — Popup UI to add/remove blocked domains and allowed paths
4. **blocked.html** — Static "This site is blocked" page (no JS, inline CSS)

### Popup UI

Two sections:
- **Blocked Domains** — list with delete buttons, text input + add button
- **Allowed Paths** — list with delete buttons, text input + add button

### Rule mapping

- Blocked domain `reddit.com` -> `{ urlFilter: "||reddit.com", action: { type: "redirect", redirect: { extensionPath: "/blocked.html" } }, priority: 1 }`
- Allowed path `reddit.com/r/austin` -> `{ urlFilter: "||reddit.com/r/austin", action: { type: "allow" }, priority: 2 }`

### Storage

`chrome.storage.sync` stores `{ blockedDomains: [...], allowedPaths: [...] }`. Syncs across Chrome instances.

## File structure

```
my_website_blocker/
├── manifest.json
├── service-worker.js
├── popup.html
├── popup.js
├── popup.css
├── blocked.html
└── icons/
```

No build step, no frameworks, no dependencies. Plain HTML/CSS/JS.
