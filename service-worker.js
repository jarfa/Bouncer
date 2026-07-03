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
  migrate().then(reconcile).catch((err) => {
    console.error("migration failed:", err);
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#e33" });
  });
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
  // reconcile() never rejects (errors surface via the "!" badge), so
  // ok:true reports the storage write, not successful rule application.
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
