const PREFIX = "?url=";
let url = "";
if (location.search.startsWith(PREFIX)) {
  url = location.search.slice(PREFIX.length);
  if (!url.includes("://")) {
    try {
      url = decodeURIComponent(url);
    } catch {
      // keep raw value
    }
  }
}

if (url) {
  document.getElementById("blocked-url").textContent = url;
  document.getElementById("with-url").hidden = false;
} else {
  document.getElementById("generic").hidden = false;
}
