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
