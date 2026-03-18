/**
 * Loads the user profile and AI settings from Chrome storage.
 * Returns { provider, apiKey, profile } or throws if incomplete.
 */
async function loadProfile() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["provider", "apiKey", "profile"], (data) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!data.apiKey || !data.profile) {
        return reject(new Error("Missing API key or profile. Open settings to configure."));
      }
      resolve({
        provider: data.provider || "claude",
        apiKey: data.apiKey,
        profile: data.profile,
      });
    });
  });
}
