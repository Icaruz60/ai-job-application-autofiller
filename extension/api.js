/**
 * Provider-agnostic AI call. Returns the raw text response.
 *
 * @param {"claude"|"openai"} provider
 * @param {string} apiKey
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function callAI(provider, apiKey, systemPrompt, userMessage) {
  if (provider === "claude") {
    return callClaude(apiKey, systemPrompt, userMessage);
  }
  if (provider === "openai") {
    return callOpenAI(apiKey, systemPrompt, userMessage);
  }
  throw new Error(`Unknown AI provider: ${provider}`);
}

async function callClaude(apiKey, systemPrompt, userMessage) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

async function callOpenAI(apiKey, systemPrompt, userMessage) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}
