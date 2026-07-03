# Bouncer rewrite: reconciler core

**Date:** 2026-07-02
**Status:** Approved

## Motivation

A bug audit found that the current service worker has structural problems that
cause the extension's flagship "pause" feature to fail intermittently and its
blocked page to act as a trap:

1. **Lost URL.** The DNR redirect sends blocked navigations to a static
   `blocked.html` that doesn't know the original URL. Reloading that tab
   reloads the block page forever, so a pause *looks* like it failed unless
   the user retypes the URL (typically in a new window).
2. **Startup race.** Init runs as a bare top-level async IIFE on every MV3
   service-worker wake, racing the very message that woke the worker. Its
   `syncRules()` can re-add blocking rules immediately after `startPause()`
   cleared them.
3. **Concurrent rule writes.** Rule IDs are always 1..N and `syncRules()` can
   run concurrently from three call sites; the loser throws a duplicate-ID
   error into a console nobody reads, leaving rules in a wrong state.
4. **Silent total failure.** One malformed list entry (e.g. `https://reddit.com`)
   makes the entire `updateDynamicRules` call throw: all rules removed, none
   re-added, no visible error.
5. **Semantic drift.** DNR `urlFilter` matching and the hand-rolled JS
   `isBlocked()` disagree (subdomains, `www.`, case), so fresh navigations and
   SPA navigations enforce different policies.
6. **Destructive expiry & bfcache bypass.** Pause expiry stomps open tabs with
   the dead-end block page (losing URL/state), and back/forward-cache
   restores bypass both enforcement layers.

## Decisions (user-confirmed)

- **Pause is popup-only.** The blocked page gets no pause/continue buttons and
  does not auto-navigate anywhere. After pausing, the user re-opens the site
  manually — and that must work reliably in the same tab/window.
- **Pause expiry kicks tabs out but keeps the URL.** Tabs on blocked sites are
  redirected to the block page, which displays the URL that was blocked.
- **Tests: yes,** using Node's built-in `node:test` runner. Zero dependencies,
  no build step (`node --test`).
- **Architecture: state reconciler** (chosen over patching the existing
  structure or a full burn-down including the popup).

## File layout

```
manifest.json        — v2.0; background.type = "module";
                       web_accessible_resources for blocked.html
core.js              — NEW: pure shared logic, no chrome.* APIs
service-worker.js    — REWRITTEN: reconciler + thin event glue
blocked.html         — REWRITTEN: shows blocked URL; no bypass controls
blocked.js           — NEW: reads ?url= and renders it (MV3 forbids inline JS)
popup.html/css       — unchanged (plus a spot for an inline error message)
popup.js             — kept; adds normalization/validation on add + error UI
test/core.test.js    — NEW: node:test suite for core.js
```

`docs/plans/` remains gitignored; specs live in `docs/superpowers/specs/`.

## core.js — one source of truth for matching

Each list entry compiles to a regex used **both** as the DNR `regexFilter`
(native enforcement) and by `isBlocked()` in JS (SPA navigations, bfcache
restores, pause-expiry sweep). One compiler, two consumers — the semantic
drift class of bug becomes impossible.

Semantics, defined once:

- A blocked domain matches itself and all subdomains: `reddit.com` matches
  `reddit.com`, `www.reddit.com`, `old.reddit.com`.
- An allowed path matches the same host rule plus a path prefix:
  `reddit.com/r/austin` allows `www.reddit.com/r/austin/comments/...`.
- Matching is case-insensitive (`isUrlFilterCaseSensitive: false` set
  explicitly on rules; JS side lowercases).
- Regex metacharacters in entries are escaped; regexes must satisfy RE2
  (no lookahead) and DNR's per-rule regex memory limit — the generated
  patterns are simple anchored expressions, e.g.
  `^https?://([^/]*\.)?reddit\.com(/.*)?$`.

Exports (all pure):

- `normalizeDomain(input)` → normalized domain or `null` if invalid.
  Trim, lowercase, strip scheme / leading `www.` / path / trailing slash;
  reject empty, whitespace, invalid characters, no dot.
- `normalizePath(input)` → normalized `domain/path` or `null`.
  Same host handling; requires a non-empty path segment.
- `compileEntry(entry)` → regex source string (shared by both consumers).
- `isBlocked(url, blockedDomains, allowedPaths)` → boolean; allow beats block.
- `buildRules({blockedDomains, allowedPaths, paused, extensionOrigin})` →
  complete DNR rule array (see below).

## Rule model

`buildRules` returns the **complete desired rule set**; rule IDs are the array
index + 1, deterministic on every run. All rules are `main_frame`-only.

| Priority | Rule | Action |
|---|---|---|
| 1 | one per blocked domain | `redirect` with `regexSubstitution` → `<extensionOrigin>/blocked.html?url=\0` (`\0` = full matched URL) |
| 2 | one per allowed path | `allow` |
| 9 | single rule, present **only while paused** | `allow`, matches everything |

Pause therefore *adds* one rule rather than deleting the block rules. No
failure mode — crash, race, or partial write — can leave the user unprotected
(block rules were never removed) or stuck blocked (reconcile is idempotent and
re-runs on every event).

`regexSubstitution` does not URL-encode `\0`, while the JS-initiated redirects
(SPA/bfcache/sweep paths) pass the URL through `encodeURIComponent`. So
`blocked.js` takes everything after the first `?url=`
(`location.search.slice("?url=".length)`) — safe because `url` is the only
query param and URL fragments never reach the network layer — then applies
`decodeURIComponent` when the value contains no raw `://` (i.e. it arrived
encoded). Both arrival paths render correctly.

## service-worker.js — the reconciler

One idempotent function; every invocation funneled through a promise queue so
executions never interleave:

```
reconcile():
  state  = read chrome.storage.sync {blockedDomains, allowedPaths}
           + chrome.storage.local {pauseEnd}
  paused = state.pauseEnd > Date.now()        // derived; no separate flag
  rules  = buildRules(...)
  one atomic updateDynamicRules({ removeRuleIds: <all existing>, addRules: rules })
  ensure alarms match state (create while paused, clear when not)
  ensure badge matches state ("Nm" countdown / red "30s" / cleared)
```

Event glue (each handler mutates storage if needed, then calls `reconcile()`):

- `chrome.runtime.onInstalled` — migration (below) + reconcile.
- `chrome.runtime.onStartup` — reconcile.
- `chrome.storage.onChanged` — reconcile (any area; reconcile is cheap and
  idempotent, no need to special-case).
- `chrome.runtime.onMessage` — `pause` sets `pauseEnd = now + duration`;
  `extendPause` sets `pauseEnd += duration` (no-op if not paused);
  `resumeBlocking` removes `pauseEnd`; each then reconciles and responds.
- `chrome.alarms.onAlarm` — `pause-end`: reconcile (rules revert) then run the
  tab sweep; `pause-badge` (1-min period) / `pause-warning` (T−30s): badge
  update only.
- `chrome.webNavigation.onHistoryStateUpdated` **and** `onCommitted`
  (frame 0 only) — if not paused and `isBlocked(url)`, redirect the tab to
  `blocked.html?url=<encoded url>`. `onCommitted` closes the
  back/forward-cache bypass; the JS-initiated redirect URL-encodes properly.

**No top-level async init.** Listener registration is the only top-level code,
as MV3 requires; the old IIFE race disappears.

**Tab sweep** (pause expiry only): `tabs.query({})`, redirect every tab whose
URL `isBlocked()` to `blocked.html?url=<encoded original>`. The URL survives
on screen; strictness is preserved. The existing 30-second red badge warning
remains the heads-up.

**Alarm minimums:** Chrome clamps alarms to ≥30s. For a 1-minute pause the
T−30s warning sits exactly at the clamp; acceptable, and unpacked extensions
are exempt anyway.

**Error visibility:** if `updateDynamicRules` throws despite validation,
reconcile catches, `console.error`s, and sets a red `!` badge instead of
failing silently.

## blocked page

Renders "**{url}** is blocked." as plain text — deliberately not a link, per
the no-bypass decision. If `?url=` is absent (e.g. a stale bookmark), it falls
back to the current generic message. No other controls.

## popup changes

On add: run `normalizeDomain` / `normalizePath`; insert the normalized value
or show a small inline error ("not a valid domain") without clearing the
input. Dedupe against the normalized list. Pause UI is unchanged, except the
service worker now derives paused-ness from `pauseEnd` alone, so the popup
reads `{pauseEnd}` from `chrome.storage.local` instead of `{paused, pauseEnd}`.
Popup scripts load as ES modules to import `core.js`.

## Migration

On `onInstalled` (`reason: "update"` or `"install"`):

- Map existing `blockedDomains` / `allowedPaths` through the normalizers;
  drop entries that normalize to `null`; de-duplicate; write back.
- Delete the legacy `paused` boolean from `chrome.storage.local` (pauseEnd,
  if present and future-dated, keeps working unchanged).

## Testing

`test/core.test.js`, run with `node --test` (no deps, no build):

- **Normalizers:** scheme/`www.`/slash stripping, lowercasing, rejects
  (empty, spaces, bad chars, `https://` pasted URLs, dotless strings).
- **Matching:** subdomain matching both directions, case-insensitivity,
  allow-beats-block, path-prefix boundaries, `www.` equivalence,
  non-blocked domains pass, invalid URLs return false.
- **buildRules:** deterministic IDs, correct priorities, pause rule present
  only when paused, redirect target shape, regex escaping for entries with
  metacharacters.

Chrome-glue behavior (reconciler, sweep, badge) is verified manually by
loading the unpacked extension; the reported repro (block reddit → hit it →
pause 1 min → retype reddit.com in the *same* window) is the primary manual
acceptance test.

## Out of scope

- Popup redesign, options page, schedules/quotas, per-site pause.
- Blocking subresources (rules stay `main_frame`-only, as today).
- Firefox/Safari portability.
