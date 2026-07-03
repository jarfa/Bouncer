# Bouncer

A Chrome extension that blocks distracting websites, with path-level allowlisting. Block `reddit.com` but still access `reddit.com/r/austin`.

## How it works

- **Domain blocking** via `declarativeNetRequest` -- Chrome evaluates rules natively, no JavaScript in the request path
- **Path allowlisting** with higher-priority rules that override domain blocks
- **SPA + back/forward blocking** via `webNavigation` catches `history.pushState` navigations and back/forward-cache restores that never hit the network
- **Reconciler architecture** -- one idempotent `reconcile()` derives the complete rule set from storage on every event; pausing adds a single high-priority allow rule instead of deleting block rules

Blocked pages show which URL was blocked, with no bypass option. Pausing (1 or
5 minutes) is only available from the toolbar popup; when a pause expires, tabs
on blocked sites are sent back to the blocked page with their URL preserved.

## Install

1. Clone this repo
2. Open `chrome://extensions/`
3. Enable **Developer mode**
4. Click **Load unpacked** and select this directory

## Usage

Click the extension icon to open the popup:

- **Blocked Domains** -- add domains to block (e.g. `reddit.com`)
- **Allowed Paths** -- add specific paths to allow on blocked domains (e.g. `reddit.com/r/austin`)

Settings sync across Chrome instances via `chrome.storage.sync`.

## Project structure

```
manifest.json        -- Extension manifest (MV3, module service worker)
core.js              -- Pure shared logic: matching, normalization, rule building
service-worker.js    -- State reconciler + navigation blocking
popup.html/js/css    -- Popup UI for managing lists and pausing
blocked.html/js      -- "This site is blocked" page (shows the blocked URL)
test/core.test.js    -- Unit tests for core.js (`node --test`)
```

No build step, no frameworks, no dependencies. Run tests with `node --test`.
