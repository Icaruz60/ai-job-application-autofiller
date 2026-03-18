const autofillBtn = document.getElementById("autofill");
const settingsBtn = document.getElementById("open-settings");
const errorEl = document.getElementById("error");

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.add("visible");
}

function clearError() {
  errorEl.textContent = "";
  errorEl.classList.remove("visible");
}

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

autofillBtn.addEventListener("click", async () => {
  clearError();
  autofillBtn.disabled = true;
  autofillBtn.textContent = "Working…";

  try {
    // Check that settings are configured
    const data = await chrome.storage.local.get(["provider", "apiKey", "profile"]);
    if (!data.apiKey || !data.profile) {
      showError("Configure your API key and profile in settings first.");
      return;
    }

    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      showError("No active tab found.");
      return;
    }

    // Send message to background to orchestrate the flow
    const response = await chrome.runtime.sendMessage({
      action: "autofill",
      tabId: tab.id,
    });

    if (response?.error) {
      showError(response.error);
    }
  } catch (err) {
    showError(err.message || "Something went wrong.");
  } finally {
    autofillBtn.disabled = false;
    autofillBtn.textContent = "Autofill";
  }
});
