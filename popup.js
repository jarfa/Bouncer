const pauseDefault = document.getElementById("pause-default");
const pauseActive = document.getElementById("pause-active");
const pauseStatus = document.getElementById("pause-status");

let countdownInterval = null;

function renderPauseUI(paused, pauseEnd) {
  if (paused && pauseEnd > Date.now()) {
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
      renderPauseUI(false, 0);
      loadAndRender();
      return;
    }
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    pauseStatus.textContent =
      "Paused \u2014 " + mins + ":" + secs.toString().padStart(2, "0") + " remaining";
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
  await chrome.runtime.sendMessage({ action, duration });
  const { paused, pauseEnd } = await chrome.storage.local.get({
    paused: false,
    pauseEnd: 0
  });
  renderPauseUI(paused, pauseEnd);
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

function renderList(ul, items, storageKey) {
  ul.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = item;
    li.appendChild(span);

    const btn = document.createElement("button");
    btn.textContent = "\u00d7";
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

  const { paused, pauseEnd } = await chrome.storage.local.get({
    paused: false,
    pauseEnd: 0
  });
  renderPauseUI(paused, pauseEnd);
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
  const list = data[storageKey].filter(item => item !== value);
  await chrome.storage.sync.set({ [storageKey]: list });
  loadAndRender();
}

blockedForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = blockedInput.value.trim().toLowerCase();
  if (value) {
    addItem("blockedDomains", value);
    blockedInput.value = "";
  }
});

allowedForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = allowedInput.value.trim().toLowerCase();
  if (value) {
    addItem("allowedPaths", value);
    allowedInput.value = "";
  }
});

loadAndRender();
