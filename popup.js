import { normalizeDomain, normalizePath } from "./core.js";

const pauseDefault = document.getElementById("pause-default");
const pauseActive = document.getElementById("pause-active");
const pauseStatus = document.getElementById("pause-status");

let countdownInterval = null;
let pauseActionInProgress = false;

function renderPauseUI(pauseEnd) {
  if (pauseEnd > Date.now()) {
    pauseDefault.hidden = true;
    pauseActive.hidden = false;
    startCountdown(pauseEnd);
  } else {
    pauseDefault.hidden = false;
    pauseActive.hidden = true;
    stopCountdown();
  }
}

function startCountdown(pauseEnd) {
  stopCountdown();
  function tick() {
    const remaining = pauseEnd - Date.now();
    if (remaining <= 0) {
      renderPauseUI(0);
      loadAndRender();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    pauseStatus.textContent =
      "Paused — " + mins + ":" + secs.toString().padStart(2, "0") + " remaining";
  }
  tick();
  countdownInterval = setInterval(tick, 1000);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

async function sendPauseAction(action, duration) {
  if (pauseActionInProgress) return;
  pauseActionInProgress = true;
  try {
    const response = await chrome.runtime.sendMessage({ action, duration });
    if (response && !response.ok) {
      console.error("Pause action failed:", response.error);
    }
  } catch (err) {
    console.error("Failed to send pause action:", err);
  }
  const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
  renderPauseUI(pauseEnd);
  pauseActionInProgress = false;
}

document.getElementById("pause-1").addEventListener("click", () => {
  sendPauseAction("pause", 60000);
});

document.getElementById("pause-5").addEventListener("click", () => {
  sendPauseAction("pause", 300000);
});

document.getElementById("extend-1").addEventListener("click", () => {
  sendPauseAction("extendPause", 60000);
});

document.getElementById("extend-5").addEventListener("click", () => {
  sendPauseAction("extendPause", 300000);
});

document.getElementById("resume-btn").addEventListener("click", () => {
  sendPauseAction("resumeBlocking");
});

const blockedList = document.getElementById("blocked-list");
const allowedList = document.getElementById("allowed-list");
const blockedForm = document.getElementById("blocked-form");
const allowedForm = document.getElementById("allowed-form");
const blockedInput = document.getElementById("blocked-input");
const allowedInput = document.getElementById("allowed-input");
const blockedError = document.getElementById("blocked-error");
const allowedError = document.getElementById("allowed-error");

function renderList(ul, items, storageKey) {
  ul.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = item;
    li.appendChild(span);

    const btn = document.createElement("button");
    btn.textContent = "×";
    btn.title = "Remove";
    btn.addEventListener("click", () => removeItem(storageKey, item));
    li.appendChild(btn);

    ul.appendChild(li);
  }
}

async function loadAndRender() {
  const data = await chrome.storage.sync.get({
    blockedDomains: [],
    allowedPaths: []
  });
  renderList(blockedList, data.blockedDomains, "blockedDomains");
  renderList(allowedList, data.allowedPaths, "allowedPaths");

  const { pauseEnd } = await chrome.storage.local.get({ pauseEnd: 0 });
  renderPauseUI(pauseEnd);
}

async function addItem(storageKey, value) {
  const data = await chrome.storage.sync.get({ [storageKey]: [] });
  const list = data[storageKey];
  if (!list.includes(value)) {
    list.push(value);
    await chrome.storage.sync.set({ [storageKey]: list });
  }
  loadAndRender();
}

async function removeItem(storageKey, value) {
  const data = await chrome.storage.sync.get({ [storageKey]: [] });
  const list = data[storageKey].filter((item) => item !== value);
  await chrome.storage.sync.set({ [storageKey]: list });
  loadAndRender();
}

function handleAdd(e, { input, errorEl, normalize, storageKey, message }) {
  e.preventDefault();
  const normalized = normalize(input.value);
  if (normalized === null) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    return;
  }
  errorEl.hidden = true;
  addItem(storageKey, normalized);
  input.value = "";
}

blockedForm.addEventListener("submit", (e) =>
  handleAdd(e, {
    input: blockedInput,
    errorEl: blockedError,
    normalize: normalizeDomain,
    storageKey: "blockedDomains",
    message: "Not a valid domain (e.g. reddit.com)"
  })
);

allowedForm.addEventListener("submit", (e) =>
  handleAdd(e, {
    input: allowedInput,
    errorEl: allowedError,
    normalize: normalizePath,
    storageKey: "allowedPaths",
    message: "Not a valid domain/path (e.g. reddit.com/r/austin)"
  })
);

loadAndRender();
