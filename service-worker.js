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

syncRules();
