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
