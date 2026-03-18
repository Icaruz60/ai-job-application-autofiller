const providerEl = document.getElementById("provider");
const apiKeyEl = document.getElementById("apiKey");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const profileEl = document.getElementById("profile");
const saveBtn = document.getElementById("save");
const statusEl = document.getElementById("status");

const LABELS = {
  claude: "Anthropic API Key",
  openai: "OpenAI API Key",
};

const PLACEHOLDERS = {
  claude: "sk-ant-...",
  openai: "sk-...",
};

function updateKeyUI() {
  const p = providerEl.value;
  apiKeyLabel.textContent = LABELS[p];
  apiKeyEl.placeholder = PLACEHOLDERS[p];
}

providerEl.addEventListener("change", updateKeyUI);

// Load saved settings
chrome.storage.local.get(["provider", "apiKey", "profile"], (data) => {
  if (data.provider) providerEl.value = data.provider;
  if (data.apiKey) apiKeyEl.value = data.apiKey;
  if (data.profile) profileEl.value = data.profile;
  updateKeyUI();
});

// Save
saveBtn.addEventListener("click", () => {
  const provider = providerEl.value;
  const apiKey = apiKeyEl.value.trim();
  const profile = profileEl.value.trim();

  if (!apiKey) {
    statusEl.textContent = "API key is required.";
    statusEl.style.color = "#dc2626";
    return;
  }
  if (!profile) {
    statusEl.textContent = "Profile data is required.";
    statusEl.style.color = "#dc2626";
    return;
  }

  chrome.storage.local.set({ provider, apiKey, profile }, () => {
    statusEl.textContent = "Saved!";
    statusEl.style.color = "#16a34a";
    setTimeout(() => (statusEl.textContent = ""), 2000);
  });
});
