# Bouncer

A Chrome extension that blocks distracting websites, with path-level allowlisting. Block `reddit.com` but still access `reddit.com/r/austin`.

## How it works

- **Domain blocking** via `declarativeNetRequest` -- Chrome evaluates rules natively, no JavaScript in the request path
- **Path allowlisting** with higher-priority rules that override domain blocks
- **SPA navigation blocking** catches `history.pushState`/`replaceState` navigations that bypass network requests

Blocked pages show a simple "This site is blocked" message with no bypass option.

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
manifest.json        -- Extension manifest (MV3)
service-worker.js    -- Rule sync + SPA navigation blocking
popup.html/js/css    -- Popup UI for managing lists
blocked.html         -- "This site is blocked" page
icons/               -- Extension icons
```

No build step, no frameworks, no dependencies.
