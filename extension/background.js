// Import helpers (service worker scope)
importScripts("profile.js", "api.js");

// ─── System prompt builder ───────────────────────────────────────────────────

function buildSystemPrompt(profileText) {
  return `You are an assistant filling out job application forms. Here is the applicant's personal data:

${profileText}

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no code blocks
- Map each field id to the exact value to fill in
- For yes/no work authorization questions, always answer Yes
- For race, gender, disability, veteran status — use "Prefer not to say" or equivalent option unless specified otherwise in the profile
- If you cannot determine a value, use an empty string
- For select/radio fields, return a value that exactly matches one of the provided options`;
}

function buildUserMessage(fields) {
  return `Here are the form fields on this job application. Return a JSON object mapping each field id to the correct fill value:

${JSON.stringify(fields, null, 2)}`;
}

// ─── Main orchestration ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action !== "autofill") return;

  handleAutofill(msg.tabId)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ error: err.message }));

  return true; // keep message channel open for async response
});

async function handleAutofill(tabId) {
  // 1. Load profile and settings
  const { provider, apiKey, profile } = await loadProfile();

  // 2. Inject content script if not already present (for pages opened before extension install)
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (_) {
    // Content script may already be injected via manifest — that's fine
  }

  // 3. Ask content script to scan fields
  const scanResult = await sendTabMessage(tabId, { action: "scanFields" });
  if (!scanResult?.fields?.length) {
    return { error: "No form fields found on this page." };
  }

  console.log(`[Autofill] Found ${scanResult.fields.length} fields. Calling AI...`);

  // 4. Call AI
  const systemPrompt = buildSystemPrompt(profile);
  const userMessage = buildUserMessage(scanResult.fields);
  const rawResponse = await callAI(provider, apiKey, systemPrompt, userMessage);

  // 5. Parse AI response
  let fillData;
  try {
    // Strip markdown code fences if AI wraps its response
    const cleaned = rawResponse.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    fillData = JSON.parse(cleaned);
  } catch (parseErr) {
    console.error("[Autofill] Failed to parse AI response:", rawResponse);
    return { error: "AI returned invalid JSON. Check console for details." };
  }

  // 6. Send fill data to content script
  const fillResult = await sendTabMessage(tabId, { action: "fillFields", data: fillData });
  if (!fillResult?.success) {
    return { error: fillResult?.error || "Fill failed." };
  }

  return { success: true, filledCount: fillResult.filledCount };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}
