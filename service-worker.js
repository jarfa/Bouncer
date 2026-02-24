// --- Pause state ---

async function isPaused() {
  const { paused } = await chrome.storage.local.get({ paused: false });
  return paused;
}

function updateBadge(pauseEnd) {
  const remaining = pauseEnd - Date.now();
  if (remaining <= 0) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  const mins = Math.ceil(remaining / 60000);
  chrome.action.setBadgeText({ text: mins + "m" });
  chrome.action.setBadgeBackgroundColor({ color: "#4a90d9" });
}

async function schedulePauseAlarms(pauseEnd) {
  await chrome.alarms.clear("pause-end");
  await chrome.alarms.clear("pause-badge");
  await chrome.alarms.clear("pause-warning");

  chrome.alarms.create("pause-end", { when: pauseEnd });

  const remaining = pauseEnd - Date.now();
  if (remaining > 60000) {
    chrome.alarms.create("pause-badge", {
      delayInMinutes: 1,
      periodInMinutes: 1
    });
  }

  const warningTime = pauseEnd - 30000;
  if (warningTime > Date.now()) {
    chrome.alarms.create("pause-warning", { when: warningTime });
  }

  updateBadge(pauseEnd);
}

async function clearRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map(r => r.id);
  if (removeRuleIds.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  }
}

async function redirectBlockedTabs() {
  const data = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && isBlocked(tab.url, data.blockedDomains, data.allowedPaths)) {
      chrome.tabs.update(tab.id, {
        url: chrome.runtime.getURL("/blocked.html")
      });
    }
  }
}

async function startPause(durationMs) {
  const pauseEnd = Date.now() + durationMs;
  await chrome.storage.local.set({ paused: true, pauseEnd });
  await clearRules();
  await schedulePauseAlarms(pauseEnd);
}

async function extendPause(durationMs) {
  const { pauseEnd } = await chrome.storage.local.get("pauseEnd");
  if (!pauseEnd) return;
  const newEnd = pauseEnd + durationMs;
  await chrome.storage.local.set({ pauseEnd: newEnd });
  await schedulePauseAlarms(newEnd);
}

async function endPause() {
  try {
    await chrome.alarms.clear("pause-end");
    await chrome.alarms.clear("pause-badge");
    await chrome.alarms.clear("pause-warning");
    await chrome.storage.local.set({ paused: false });
    await chrome.storage.local.remove("pauseEnd");
    chrome.action.setBadgeText({ text: "" });
    await syncRules();
    await redirectBlockedTabs();
  } catch (error) {
    console.error("Failed to end pause:", error);
  }
}

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
  try {
    if (await isPaused()) return;

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
  } catch (error) {
    console.error("Failed to sync rules:", error);
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") {
    syncRules();
  }
});

(async () => {
  const { paused, pauseEnd } = await chrome.storage.local.get({
    paused: false,
    pauseEnd: 0
  });
  if (paused && pauseEnd > Date.now()) {
    await clearRules();
    await schedulePauseAlarms(pauseEnd);
  } else if (paused) {
    await endPause();
  } else {
    await syncRules();
  }
})();

function isBlocked(url, blockedDomains, allowedPaths) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.replace(/^www\./, "");
  const hostAndPath = hostname + parsed.pathname.toLowerCase();

  for (const path of allowedPaths) {
    if (hostAndPath.startsWith(path)) {
      return false;
    }
  }

  for (const domain of blockedDomains) {
    if (hostname === domain || hostname.endsWith("." + domain)) {
      return true;
    }
  }

  return false;
}

chrome.webNavigation.onHistoryStateUpdated.addListener(async (details) => {
  if (details.frameId !== 0) return;
  if (await isPaused()) return;

  const data = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });

  if (isBlocked(details.url, data.blockedDomains, data.allowedPaths)) {
    chrome.tabs.update(details.tabId, {
      url: chrome.runtime.getURL("/blocked.html")
    });
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pause-end") {
    await endPause();
  } else if (alarm.name === "pause-badge") {
    const { pauseEnd } = await chrome.storage.local.get("pauseEnd");
    if (pauseEnd) {
      updateBadge(pauseEnd);
    }
  } else if (alarm.name === "pause-warning") {
    chrome.action.setBadgeText({ text: "30s" });
    chrome.action.setBadgeBackgroundColor({ color: "#e33" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "pause") {
    startPause(message.duration)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  } else if (message.action === "extendPause") {
    extendPause(message.duration)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  } else if (message.action === "resumeBlocking") {
    endPause()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
