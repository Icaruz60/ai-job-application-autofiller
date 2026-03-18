// ─── Shadow DOM traversal ────────────────────────────────────────────────────

/**
 * Recursively queries all elements matching a selector, diving into shadow roots.
 * Returns a flat array of matching elements.
 */
function deepQuerySelectorAll(root, selector) {
  const results = [];

  function walk(node) {
    if (node.querySelectorAll) {
      results.push(...node.querySelectorAll(selector));
    }
    // Dive into shadow roots
    if (node.shadowRoot) {
      walk(node.shadowRoot);
    }
    // Also check children that may have their own shadow roots
    const children = node.querySelectorAll ? node.querySelectorAll("*") : [];
    for (const child of children) {
      if (child.shadowRoot) {
        walk(child.shadowRoot);
      }
    }
  }

  walk(root);
  return results;
}

// ─── Label detection ─────────────────────────────────────────────────────────

/**
 * Determines the human-readable label for a form field.
 * Priority: <label for=id> → aria-label → placeholder → nearest text.
 */
function getFieldLabel(el) {
  // 1. Explicit <label for="...">
  if (el.id) {
    const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }

  // Also check shadow root context for labels
  const root = el.getRootNode();
  if (root !== document && el.id) {
    const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }

  // 2. aria-label
  if (el.getAttribute("aria-label")) {
    return el.getAttribute("aria-label").trim();
  }

  // 3. aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const refEl = (root === document ? document : root).getElementById(labelledBy);
    if (refEl) return refEl.textContent.trim();
  }

  // 4. placeholder
  if (el.placeholder) {
    return el.placeholder.trim();
  }

  // 5. Wrapping <label>
  const parentLabel = el.closest("label");
  if (parentLabel) {
    // Get label text excluding the input's own text
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll("input, select, textarea").forEach((c) => c.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // 6. Nearest preceding sibling or parent text
  let sibling = el.previousElementSibling;
  if (sibling && sibling.textContent.trim()) {
    return sibling.textContent.trim().slice(0, 100);
  }

  // 7. name attribute as last resort
  if (el.name) return el.name;

  return "unknown";
}

// ─── Field scanning ──────────────────────────────────────────────────────────

/**
 * Scans the page for all fillable form fields.
 * Returns { fields: FieldDescriptor[], fileInput: Element|null }
 */
function scanFields() {
  const allInputs = deepQuerySelectorAll(document, "input, select, textarea");
  const fields = [];
  let fileInput = null;
  let idCounter = 0;

  for (const el of allInputs) {
    const type = el.type?.toLowerCase() || "text";
    const tag = el.tagName.toLowerCase();

    // Skip hidden, submit, button, image, and file inputs
    if (["hidden", "submit", "button", "image", "reset"].includes(type)) continue;
    if (tag === "input" && type === "file") {
      fileInput = fileInput || el; // keep first file input reference
      continue;
    }

    // Skip invisible elements
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue;
    if (el.disabled || el.readOnly) continue;

    const label = getFieldLabel(el);
    const fieldId = el.id || el.name || `__autofill_${idCounter++}`;

    // Tag element with our internal ID for lookup during fill
    el.dataset.autofillId = fieldId;

    const descriptor = {
      id: fieldId,
      label: label,
      type: tag === "select" ? "select" : tag === "textarea" ? "textarea" : type,
    };

    // For select, radio, and checkbox — include options
    if (tag === "select") {
      descriptor.options = [...el.options]
        .filter((o) => o.value) // skip blank placeholder options
        .map((o) => o.textContent.trim());
    }

    if (type === "radio") {
      // Group all radios with same name
      const groupName = el.name;
      if (groupName && fields.some((f) => f.id === groupName)) continue; // already added
      const radios = deepQuerySelectorAll(document, `input[type="radio"][name="${CSS.escape(groupName)}"]`);
      descriptor.id = groupName || fieldId;
      descriptor.options = radios.map((r) => {
        const lbl = getFieldLabel(r);
        return lbl !== "unknown" ? lbl : r.value;
      });
      // Tag all radios in the group
      radios.forEach((r) => (r.dataset.autofillId = descriptor.id));
    }

    fields.push(descriptor);
  }

  return { fields, fileInput };
}

// ─── Synthetic events ────────────────────────────────────────────────────────

function dispatchEvents(el) {
  // Fire focus first — many frameworks only mark a field as "touched" after
  // a real focus event, which is what causes the red-border validation state
  // when we skip it. Without this the field looks dirty-but-never-focused.
  el.dispatchEvent(new Event("focus", { bubbles: true }));
  el.dispatchEvent(new Event("focusin", { bubbles: true }));
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
  el.dispatchEvent(new Event("focusout", { bubbles: true }));
}

// ─── Fill logic ──────────────────────────────────────────────────────────────

/**
 * Applies AI-generated fill data to the page.
 * @param {Object} fillData - { fieldId: value, ... }
 */
function fillFields(fillData) {
  let filledCount = 0;

  for (const [fieldId, value] of Object.entries(fillData)) {
    if (value === "" || value === null || value === undefined) continue;

    // Find all elements with this autofill ID
    const elements = deepQuerySelectorAll(document, `[data-autofill-id="${CSS.escape(fieldId)}"]`);
    if (elements.length === 0) {
      console.warn(`[Autofill] No element found for field: ${fieldId}`);
      continue;
    }

    for (const el of elements) {
      const tag = el.tagName.toLowerCase();
      const type = el.type?.toLowerCase() || "text";

      try {
        if (tag === "select") {
          fillSelect(el, value);
        } else if (type === "radio") {
          fillRadio(fieldId, value);
        } else if (type === "checkbox") {
          fillCheckbox(el, value);
        } else {
          // text, textarea, email, tel, url, number, etc.
          fillTextInput(el, value);
        }
        filledCount++;
      } catch (err) {
        console.warn(`[Autofill] Error filling ${fieldId}:`, err);
      }
    }
  }

  console.log(`[Autofill] Filled ${filledCount} fields.`);
  return filledCount;
}

function fillTextInput(el, value) {
  // Use native setter to bypass React's synthetic event system
  const nativeSetter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value"
  )?.set || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

  if (nativeSetter) {
    nativeSetter.call(el, String(value));
  } else {
    el.value = String(value);
  }
  dispatchEvents(el);
}

function fillSelect(el, value) {
  const strValue = String(value).toLowerCase();
  let matched = false;

  for (const option of el.options) {
    if (
      option.value.toLowerCase() === strValue ||
      option.textContent.trim().toLowerCase() === strValue
    ) {
      el.selectedIndex = option.index;
      matched = true;
      break;
    }
  }

  // Fuzzy fallback: partial match
  if (!matched) {
    for (const option of el.options) {
      if (
        option.textContent.trim().toLowerCase().includes(strValue) ||
        strValue.includes(option.textContent.trim().toLowerCase())
      ) {
        el.selectedIndex = option.index;
        matched = true;
        break;
      }
    }
  }

  if (matched) dispatchEvents(el);
  else console.warn(`[Autofill] No matching option for select: "${value}"`);
}

function fillRadio(groupId, value) {
  const radios = deepQuerySelectorAll(document, `[data-autofill-id="${CSS.escape(groupId)}"]`);
  const strValue = String(value).toLowerCase();

  for (const radio of radios) {
    const radioLabel = getFieldLabel(radio).toLowerCase();
    if (
      radio.value.toLowerCase() === strValue ||
      radioLabel === strValue ||
      radioLabel.includes(strValue)
    ) {
      radio.checked = true;
      dispatchEvents(radio);
      return;
    }
  }
  console.warn(`[Autofill] No matching radio for "${groupId}": "${value}"`);
}

function fillCheckbox(el, value) {
  const shouldCheck =
    value === true || value === "true" || value === "yes" || value === "Yes" || value === 1;
  if (el.checked !== shouldCheck) {
    el.checked = shouldCheck;
    dispatchEvents(el);
  }
}

// ─── Resume highlight ────────────────────────────────────────────────────────

function highlightFileInput(fileInput) {
  if (!fileInput) return;

  // Scroll into view
  fileInput.scrollIntoView({ behavior: "smooth", block: "center" });

  // Apply highlight — target the input or its nearest visible parent
  const target = fileInput.offsetParent === null ? fileInput.closest("div, label, button") || fileInput : fileInput;

  const styleId = "__autofill-highlight-style";
  if (!document.getElementById(styleId)) {
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      @keyframes autofill-pulse {
        0%, 100% { box-shadow: 0 0 8px 2px rgba(234, 88, 12, 0.6); }
        50% { box-shadow: 0 0 20px 6px rgba(234, 88, 12, 0.9); }
      }
      .autofill-highlight {
        outline: 3px solid #ea580c !important;
        animation: autofill-pulse 1.5s ease-in-out infinite !important;
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  }

  target.classList.add("autofill-highlight");

  // Remove highlight after 10 seconds
  setTimeout(() => target.classList.remove("autofill-highlight"), 10000);
}

// ─── MutationObserver for dynamic forms ──────────────────────────────────────

let pendingRescan = null;

function setupMutationObserver(callback) {
  const observer = new MutationObserver((mutations) => {
    // Check if any new input/select/textarea were added
    let hasNewFields = false;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.("input, select, textarea") || node.querySelector?.("input, select, textarea")) {
          hasNewFields = true;
          break;
        }
      }
      if (hasNewFields) break;
    }

    if (hasNewFields) {
      // Debounce: wait 500ms after last mutation before re-scanning
      clearTimeout(pendingRescan);
      pendingRescan = setTimeout(callback, 500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}

// ─── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "scanFields") {
    const { fields, fileInput } = scanFields();
    // Store fileInput reference globally for later highlight
    window.__autofillFileInput = fileInput;
    sendResponse({ fields, hasFileInput: !!fileInput });
    return true;
  }

  if (msg.action === "fillFields") {
    try {
      const count = fillFields(msg.data);
      // Highlight file input after filling
      highlightFileInput(window.__autofillFileInput);

      // Set up observer for dynamically added fields
      setupMutationObserver(() => {
        console.log("[Autofill] New fields detected after fill — may need re-run.");
        // We could auto-rescan here, but for v1 just log it.
        // The user can click Autofill again if new fields appear.
      });

      sendResponse({ success: true, filledCount: count });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
    return true;
  }
});
