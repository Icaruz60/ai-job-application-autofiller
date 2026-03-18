// Import helpers (service worker scope)
importScripts("profile.js", "api.js");

// ─── System prompt builder ───────────────────────────────────────────────────

function buildSystemPrompt(profileText) {
  const today = new Date();
  const iso = today.toISOString().split("T")[0]; // YYYY-MM-DD
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const yyyy = today.getFullYear();

  return `You are an assistant filling out job application forms. Here is the applicant's personal data:

${profileText}

Today's date: ${iso} (also expressible as ${mm}/${dd}/${yyyy} or ${mm}-${dd}-${yyyy})

Rules:
- Return ONLY valid JSON, no explanation, no markdown, no code blocks
- Map each field id to the exact value to fill in
- For yes/no work authorization questions, always answer Yes
- For select/radio fields, return a value that exactly matches one of the provided options
- For every field, always attempt a best-guess answer using context, the field label, and the available options — even if the answer is not explicitly in the profile. Only fall back to an empty string when you genuinely have no basis for any reasonable guess and leaving it blank is clearly better than guessing wrong

Phone number handling:
- The applicant's full phone number including country code is in the profile
- If a field is specifically for a country code, dial code, or phone prefix (label contains words like "country code", "dial code", "code", "prefix", "+1"), fill it with only the country code (e.g. "+1" or "1")
- For the main phone number field, strip the country code and provide only the local number (e.g. "(660) 620 6614" not "+1 (660) 620 6614")
- Match the format already implied by the field's placeholder if visible

EEO / diversity fields (race, ethnicity, gender, disability, veteran status):
- Use semantic understanding to match the applicant's stated preference to the available option that carries the same meaning — do not require an exact string match
- "Prefer not to say", "I do not wish to identify", "Decline to answer", "Choose not to disclose", "I prefer not to answer", "I do not wish to provide this information" etc. are all semantically equivalent opt-out choices; pick whichever one appears in the provided options list
- For race/ethnicity: if no opt-out option exists at all, pick the most neutral or inclusive option available (e.g. "Other", "Multiracial") rather than guessing a specific ethnicity

"How did you hear about us" / referral source:
- Use best-guess reasoning based on the available options; default to "LinkedIn" for free-text fields or the closest equivalent for select/radio

Date fields:
- For any field asking for today's date, the current date, application date, or submission date, use today's date formatted to match the field: YYYY-MM-DD for date inputs, MM/DD/YYYY for US text fields
- Today is ${iso}`;
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
