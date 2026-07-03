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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Generated regexes are used BOTH as DNR regexFilter (RE2) and in JS.
// Keep them simple: anchored, no lookarounds.
export function compileDomain(domain) {
  return (
    "^https?://([^/]*@)?([^/:]*\\.)?" + escapeRegex(domain) + "(:\\d+)?(/.*)?$"
  );
}

export function compilePath(entry) {
  const slash = entry.indexOf("/");
  if (slash === -1) {
    throw new Error("compilePath: entry must contain '/': " + entry);
  }
  const host = entry.slice(0, slash);
  const path = entry.slice(slash);
  return (
    "^https?://([^/]*@)?([^/:]*\\.)?" +
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
        isUrlFilterCaseSensitive: false,
        resourceTypes: ["main_frame"]
      }
    });
  }

  return rules;
}
