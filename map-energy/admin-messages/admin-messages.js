(function () {
  "use strict";

  const API = "/map-energy/admin-messages/api";
  const STORAGE_KEY = "map-admin-active-message-id";
  const POLL_INTERVAL_MS = 7000;
  const countNames = ["pending", "sending", "accepted", "failed", "skipped", "unknown"];

  const elements = {};
  let csrfToken = "";
  let currentMessage = null;
  let pollTimer = null;
  let requestPending = false;

  document.addEventListener("DOMContentLoaded", initialise);

  function initialise() {
    [
      "loginView", "consoleView", "loginError",
      "signOutButton", "refreshButton", "globalNotice", "messageForm", "siteKeyInput", "siteKeyLabel", "siteKeyHint",
      "titleInput", "bodyInput", "titleCount", "bodyCount", "formError", "previewButton", "previewState",
      "previewEmpty", "previewContent", "previewExactTitle", "previewExactBody", "previewAudience", "previewSiteRow",
      "previewSiteKey", "previewRecipients", "previewExpiry", "sendButton", "messageStatus", "statusEmpty", "statusContent",
      "statusTitleText", "statusMeta", "deliveryCounts", "statusExplanation", "recentLoading", "recentEmpty", "recentList",
      "sendDialog", "confirmAudience", "confirmMessageTitle", "confirmMessageBody", "confirmError", "confirmSendButton",
      "cancelSendButton", "year"
    ].forEach((id) => { elements[id] = document.getElementById(id); });

    elements.year.textContent = String(new Date().getFullYear());
    elements.signOutButton.addEventListener("click", logout);
    elements.messageForm.addEventListener("submit", previewMessage);
    elements.sendButton.addEventListener("click", showSendConfirmation);
    elements.confirmSendButton.addEventListener("click", sendMessage);
    elements.refreshButton.addEventListener("click", refreshAll);
    elements.siteKeyInput.addEventListener("input", updateCounters);
    elements.titleInput.addEventListener("input", updateCounters);
    elements.bodyInput.addEventListener("input", updateCounters);
    elements.messageForm.addEventListener("input", invalidatePreview);
    elements.messageForm.addEventListener("change", handleAudienceChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    updateCounters();
    checkSession();
  }

  async function api(path, options = {}) {
    const headers = { Accept: "application/json", ...(options.headers || {}) };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.method && options.method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
    let response;
    try {
      response = await fetch(`${API}${path}`, {
        credentials: "same-origin",
        cache: "no-store",
        ...options,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      const error = new Error("The staging message service could not be reached. Check this message's status before retrying.");
      error.code = "network_error";
      error.status = 0;
      throw error;
    }
    let payload = {};
    try { payload = await response.json(); } catch { payload = { error: "invalid_response" }; }
    if (response.status === 401 && path !== "/session") showLogin();
    if (!response.ok) {
      const error = new Error(errorMessage(payload, response.status));
      error.code = payload.error || "request_failed";
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function checkSession() {
    try {
      const session = await api("/session");
      if (!session.authenticated) return showLogin();
      csrfToken = session.csrf_token;
      showConsole();
      await restoreConsole();
    } catch (error) {
      showLogin();
      showError(elements.loginError, error.message);
    }
  }

  function logout() {
    window.location.assign("/cdn-cgi/access/logout");
  }

  function showLogin() {
    show(elements.loginView);
    hide(elements.consoleView);
    hide(elements.signOutButton);
  }

  function showConsole() {
    hide(elements.loginView);
    show(elements.consoleView);
    show(elements.signOutButton);
  }

  async function restoreConsole() {
    await loadRecent();
    const storedId = sessionStorage.getItem(STORAGE_KEY);
    if (storedId) await loadMessage(storedId, false);
  }

  function formPayload() {
    const audience = document.querySelector('input[name="audience"]:checked').value;
    const payload = {
      audience,
      title: elements.titleInput.value.trim(),
      body: elements.bodyInput.value.trim(),
    };
    if (audience === "site") payload.site_key = elements.siteKeyInput.value.trim().toLowerCase();
    return payload;
  }

  function validate(payload) {
    if (payload.audience === "site" && !/^[0-9a-f]{64}$/.test(payload.site_key || "")) return "Enter a valid 64-character hexadecimal site key.";
    if (!payload.title || payload.title.length > 100) return "Enter a title between 1 and 100 characters.";
    if (!payload.body || payload.body.length > 1000) return "Enter a message between 1 and 1,000 characters.";
    return "";
  }

  async function previewMessage(event) {
    event.preventDefault();
    const payload = formPayload();
    const validationError = validate(payload);
    if (validationError) return showError(elements.formError, validationError);
    hide(elements.formError);
    setBusy(elements.previewButton, true, "Creating preview…");
    try {
      const message = await api("/messages/preview", { method: "POST", body: payload });
      displayMessage(message);
      showNotice("Preview created. Nothing has been sent.", "success");
      await loadRecent();
    } catch (error) {
      showError(elements.formError, error.message);
    } finally {
      setBusy(elements.previewButton, false, "Preview message");
    }
  }

  function invalidatePreview() {
    if (!currentMessage || currentMessage.status !== "draft") return;
    currentMessage = null;
    sessionStorage.removeItem(STORAGE_KEY);
    hide(elements.previewContent);
    show(elements.previewEmpty);
    elements.previewState.textContent = "Needs preview";
    setStateClass(elements.previewState, "neutral");
    elements.previewExpiry.textContent = "";
    renderStatus(null);
    stopPolling();
  }

  function handleAudienceChange() {
    const isSite = document.querySelector('input[name="audience"]:checked').value === "site";
    elements.siteKeyLabel.classList.toggle("hidden", !isSite);
  }

  function updateCounters() {
    elements.siteKeyHint.textContent = `${elements.siteKeyInput.value.length} / 64 characters`;
    elements.titleCount.textContent = `${elements.titleInput.value.length} / 100`;
    elements.bodyCount.textContent = `${elements.bodyInput.value.length} / 1000`;
  }

  function displayMessage(message) {
    currentMessage = message;
    sessionStorage.setItem(STORAGE_KEY, message.id);
    show(elements.previewContent);
    hide(elements.previewEmpty);
    elements.previewExactTitle.textContent = message.title || "";
    elements.previewExactBody.textContent = message.body || "";
    elements.previewAudience.textContent = message.audience === "all" ? "All opted-in sites" : "One site";
    elements.previewSiteRow.classList.toggle("hidden", message.audience !== "site");
    elements.previewSiteKey.textContent = message.site_key || "";
    elements.previewRecipients.textContent = String(message.recipient_count || 0);
    elements.previewState.textContent = humanStatus(message.status);
    setStateClass(elements.previewState, message.status);
    elements.previewExpiry.textContent = message.status === "draft" ? expiryText(message.expires_at) : "";
    elements.sendButton.disabled = !canSend(message) || requestPending;
    renderStatus(message);
    if (message.status === "queued") startPolling(); else stopPolling();
  }

  function canSend(message) {
    return Boolean(message && message.status === "draft" && Number(message.recipient_count) > 0 && Number(message.expires_at) > Date.now() / 1000);
  }

  function showSendConfirmation() {
    if (!canSend(currentMessage)) return;
    const count = Number(currentMessage.recipient_count || 0);
    elements.confirmAudience.textContent = currentMessage.audience === "all"
      ? `All opted-in sites · ${count} eligible ${count === 1 ? "device" : "devices"}.`
      : `One site · ${count} eligible ${count === 1 ? "device" : "devices"}.`;
    elements.confirmMessageTitle.textContent = currentMessage.title || "";
    elements.confirmMessageBody.textContent = currentMessage.body || "";
    hide(elements.confirmError);
    elements.sendDialog.showModal();
  }

  async function sendMessage() {
    if (!currentMessage || requestPending) return;
    const id = currentMessage.id;
    requestPending = true;
    elements.sendButton.disabled = true;
    setBusy(elements.confirmSendButton, true, "Queuing…");
    try {
      const message = await api(`/messages/${encodeURIComponent(id)}/send`, { method: "POST" });
      displayMessage(message);
      elements.sendDialog.close();
      showNotice("Notification queued. Delivery status will update automatically.", "success");
      await loadRecent();
    } catch (error) {
      showError(elements.confirmError, error.message);
      // Sending may have reached the backend even when its response did not reach the browser.
      // Always recover the same ID; never create a replacement preview automatically.
      await loadMessage(id, false);
    } finally {
      requestPending = false;
      setBusy(elements.confirmSendButton, false, "Queue notification");
      if (currentMessage) elements.sendButton.disabled = !canSend(currentMessage);
    }
  }

  async function loadMessage(id, announce = true) {
    try {
      const message = await api(`/messages/${encodeURIComponent(id)}`);
      displayMessage(message);
      if (announce) showNotice("Message status loaded.", "success");
      return message;
    } catch (error) {
      if (error.status === 404) sessionStorage.removeItem(STORAGE_KEY);
      if (announce) showNotice(error.message, "error");
      return null;
    }
  }

  async function loadRecent() {
    show(elements.recentLoading);
    hide(elements.recentEmpty);
    clear(elements.recentList);
    try {
      const payload = await api("/messages");
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      if (!messages.length) show(elements.recentEmpty);
      messages.forEach((message) => elements.recentList.appendChild(recentMessageNode(message)));
    } catch (error) {
      showNotice(error.message, "error");
    } finally {
      hide(elements.recentLoading);
    }
  }

  function recentMessageNode(message) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    const main = document.createElement("span");
    main.className = "recent-main";
    const title = document.createElement("strong");
    title.textContent = message.title || "Untitled message";
    const detail = document.createElement("span");
    detail.textContent = `${message.audience === "all" ? "All opted-in sites" : "One site"} · ${formatTime(message.created_at)}`;
    main.append(title, detail);
    const count = document.createElement("span");
    count.className = "recent-count";
    count.textContent = `${Number(message.recipient_count || 0)} eligible`;
    const status = document.createElement("span");
    status.className = `state-pill state-${message.status || "neutral"}`;
    status.textContent = humanStatus(message.status);
    button.append(main, count, status);
    button.addEventListener("click", () => loadMessage(message.id));
    return button;
  }

  function renderStatus(message) {
    if (!message) {
      show(elements.statusEmpty);
      hide(elements.statusContent);
      elements.messageStatus.textContent = "No message";
      setStateClass(elements.messageStatus, "neutral");
      return;
    }
    hide(elements.statusEmpty);
    show(elements.statusContent);
    elements.messageStatus.textContent = humanStatus(message.status);
    setStateClass(elements.messageStatus, message.status);
    elements.statusTitleText.textContent = message.title || "Untitled message";
    elements.statusMeta.textContent = `Created ${formatTime(message.created_at)} · ${Number(message.recipient_count || 0)} eligible devices`;
    clear(elements.deliveryCounts);
    const counts = message.counts || {};
    countNames.forEach((name) => {
      const item = document.createElement("div");
      item.className = "count-item";
      const label = document.createElement("span");
      label.textContent = name;
      const value = document.createElement("strong");
      value.textContent = String(Number(counts[name] || 0));
      item.append(label, value);
      elements.deliveryCounts.appendChild(item);
    });
    elements.statusExplanation.textContent = statusExplanation(message.status);
  }

  async function refreshAll() {
    setBusy(elements.refreshButton, true, "Refreshing…");
    try {
      await Promise.all([loadRecent(), currentMessage ? loadMessage(currentMessage.id, false) : Promise.resolve()]);
      showNotice("Staging message data refreshed.", "success");
    } finally {
      setBusy(elements.refreshButton, false, "Refresh status");
    }
  }

  function startPolling() {
    stopPolling();
    if (document.hidden || !currentMessage || currentMessage.status !== "queued") return;
    pollTimer = window.setTimeout(async () => {
      const message = await loadMessage(currentMessage.id, false);
      await loadRecent();
      if (message && message.status === "queued") startPolling();
    }, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function handleVisibilityChange() {
    if (document.hidden) stopPolling();
    else if (currentMessage?.status === "queued") {
      loadMessage(currentMessage.id, false).then((message) => {
        if (message?.status === "queued") startPolling();
      });
    }
  }

  function errorMessage(payload, status) {
    const messages = {
      access_required: "Cloudflare Access did not provide a valid administrator identity. Reopen the page and sign in again.",
      admin_not_allowed: "This Cloudflare Access identity is not authorised for MAP Energy administration.",
      invalid_csrf: "The secure form token is no longer valid. Refresh and sign in again.",
      invalid_json: "The server could not read this request.",
      invalid_message: payload.message || "Check the title, message and audience details.",
      site_not_found: "That site key was not found.",
      not_found: "That message could not be found.",
      preview_expired: "This preview has expired. Review the form and create a fresh preview.",
      preview_not_ready: "This preview is not ready to send. Create a fresh preview if it remains unavailable.",
      no_eligible_recipients: "No enabled devices have opted in to system messages for this audience.",
      audience_too_large: "This audience is larger than the current 5,000-device limit. The backend must be extended before sending.",
      request_too_large: "This request is too large.",
      admin_messages_unavailable: "The staging message service is temporarily unavailable. Check this message's status before retrying.",
      admin_proxy_not_configured: "The website server is missing its private staging admin credential.",
      invalid_upstream_response: "The staging message service returned an unexpected response.",
    };
    return messages[payload?.error] || payload?.message || `The request failed (${status}).`;
  }

  function statusExplanation(status) {
    if (status === "draft") return "Preview only. No notification has been queued.";
    if (status === "queued") return "Processing can take several minutes. Accepted means Apple or Google accepted the push request, not that the phone displayed it.";
    if (status === "completed") return "All delivery attempts have resolved. Review each count; completed does not mean every device received the message.";
    if (status === "building") return "The audience snapshot is still being built and cannot be sent yet.";
    return "";
  }

  function humanStatus(status) {
    return ({ building: "Building", draft: "Draft", queued: "Queued", completed: "Completed" })[status] || "Unknown";
  }

  function setStateClass(element, status) {
    element.className = `state-pill state-${["draft", "queued", "completed"].includes(status) ? status : "neutral"}`;
  }

  function expiryText(unixSeconds) {
    const remaining = Math.max(0, Number(unixSeconds || 0) * 1000 - Date.now());
    return remaining ? `Expires in ${Math.max(1, Math.ceil(remaining / 60000))} min` : "Expired";
  }

  function formatTime(unixSeconds) {
    if (!unixSeconds) return "Unknown time";
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(Number(unixSeconds) * 1000));
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = label;
  }

  function showNotice(message, type) {
    elements.globalNotice.textContent = message;
    elements.globalNotice.className = `notice ${type === "error" ? "notice-error" : "notice-success"}`;
    show(elements.globalNotice);
  }

  function showError(element, message) { element.textContent = message; show(element); }
  function show(element) { element.classList.remove("hidden"); }
  function hide(element) { element.classList.add("hidden"); }
  function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
})();
