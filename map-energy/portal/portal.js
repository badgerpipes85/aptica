"use strict";

const params = new URLSearchParams(window.location.search);
const isStaging = params.get("environment") === "staging";
const API_BASE = isStaging
  ? "https://powerwake-backend-staging.mapenergy.workers.dev"
  : "https://powerwake-backend-production.mapenergy.workers.dev";
const SESSION_KEY = `map_energy_portal_session_${isStaging ? "staging" : "production"}`;
const SITE_KEY = `map_energy_portal_site_${isStaging ? "staging" : "production"}`;
let accessToken = sessionStorage.getItem(SESSION_KEY) || "";
let currentOverview = null;

const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 2 });
const nf1 = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });
const nodeNumber = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

function showError(id, message) {
  const element = $(id);
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("hidden", !message);
}

function friendlyError(error) {
  const message = error instanceof Error ? error.message : String(error || "Something went wrong.");
  const translations = {
    premium_required: "An active MAP Energy Premium subscription is required.",
    invalid_username_or_password: "The username or password is incorrect.",
    portal_link_expired: "This secure app link has expired. Please open the portal from the app again.",
    portal_link_invalid: "This secure app link is no longer valid. Please open the portal from the app again.",
    unauthorized: "Your portal session has ended. Please sign in again."
  };
  return translations[message] || message.replaceAll("_", " ");
}

async function api(path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== "/v1/web-auth/login") clearSession();
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return data;
}

function saveSession(token) {
  accessToken = String(token || "");
  if (accessToken) sessionStorage.setItem(SESSION_KEY, accessToken);
}

function clearSession() {
  accessToken = "";
  sessionStorage.removeItem(SESSION_KEY);
}

function showLogin(message = "") {
  document.body.classList.remove("portal-active");
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("headerSignOut").classList.add("hidden");
  showError("loginError", message);
}

function showApp() {
  document.body.classList.add("portal-active");
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("headerSignOut").classList.remove("hidden");
}

function fmtKw(value) {
  const number = Number(value);
  return Number.isFinite(number) ? (Math.abs(number) >= 10 ? nf1.format(number) : nf.format(number)) : "--";
}

function fmtKwh(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${nf1.format(number)} kWh` : "--";
}

function fmtNodeKw(value, absolute = false) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return nodeNumber.format(absolute ? Math.abs(number) : number);
}

function fmtKwhNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? nf1.format(number) : "--";
}

function fmtRate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${nf1.format(number)}p/kWh` : "--";
}

function fmtMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(number) : "--";
}

function fmtTime(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? new Date(number * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "--";
}

function fmtDate(value, fallback = "--") {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? new Date(number * 1000).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : fallback;
}

function prettyMode(value) {
  const mode = String(value || "").toLowerCase();
  return { self_consumption: "Self-Powered", autonomous: "Savings", backup: "Backup" }[mode] || value || "--";
}

function prettyExport(value) {
  return { battery_ok: "Everything", pv_only: "Solar", never: "Nothing", no_export: "Nothing" }[String(value || "").toLowerCase()] || value || "--";
}

function liveInsight(live) {
  const solar = Number(live?.solar_kw) || 0;
  const home = Number(live?.home_kw) || 0;
  const grid = Number(live?.grid_kw) || 0;
  const battery = Number(live?.battery_kw) || 0;
  const ev = Number(live?.ev_kw) || 0;
  const active = value => value > .05;
  const gridHome = active(grid) && active(home);
  const gridEv = active(grid) && active(ev);
  const gridBattery = active(grid) && battery < -.05;
  const solarHome = active(solar) && active(home);
  const solarEv = active(solar) && active(ev);
  const solarBattery = active(solar) && battery < -.05;
  const solarExport = active(solar) && grid < -.05;
  const batteryHome = battery > .05 && active(home);
  const batteryEv = battery > .05 && active(ev);
  const batteryExport = battery > .05 && grid < -.05;
  if (gridBattery && gridEv && gridHome) return { text: "Grid is supplying the home, charging EV and charging the Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && gridEv && solarHome) return { text: "Solar is supplying the home while grid charges EV and Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && gridEv) return { text: "Grid is charging EV and the Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && gridHome) return { text: "Grid is supplying the home and charging the Powerwall", tone: "blue", icon: "battery" };
  if (gridEv && gridHome) return { text: "Grid is supplying the home and charging EV", tone: "blue", icon: "car" };
  if (solarHome && solarEv && solarBattery) return { text: "Solar is supplying the home, charging EV and charging the Powerwall", tone: "yellow", icon: "solar" };
  if (solarHome && solarEv) return { text: "Solar is supplying the home and charging EV", tone: "yellow", icon: "solar" };
  if (solarHome && solarBattery) return { text: "Solar is powering home and charging the Powerwall", tone: "yellow", icon: "solar" };
  if (batteryHome && batteryEv && batteryExport) return { text: "Powerwall is supplying home, charging EV and exporting to the grid", tone: "green", icon: "battery" };
  if (batteryHome && batteryEv) return { text: "Powerwall is supplying home and charging EV", tone: "green", icon: "battery" };
  if (solarHome && solarExport) return { text: "Solar is supplying the home and exporting surplus energy", tone: "yellow", icon: "solar" };
  if (gridEv) return { text: "Grid is charging EV", tone: "blue", icon: "car" };
  if (gridHome) return { text: "The grid is supplying the home", tone: "blue", icon: "bolt" };
  if (gridBattery) return { text: "The grid is charging the Powerwall", tone: "blue", icon: "battery" };
  if (solarEv) return { text: "Solar is charging EV", tone: "yellow", icon: "car" };
  if (solarHome) return { text: "Solar is supplying the home", tone: "yellow", icon: "solar" };
  if (batteryEv) return { text: "Powerwall is charging EV", tone: "green", icon: "car" };
  if (batteryHome) return { text: "The Powerwall is supplying the home", tone: "green", icon: "battery" };
  if (solarExport) return { text: "Solar is exporting surplus energy to the grid", tone: "yellow", icon: "solar" };
  if (batteryExport) return { text: "The Powerwall is exporting energy to the grid", tone: "green", icon: "battery" };
  return { text: "Monitoring live home energy flow", tone: "neutral", icon: "bolt" };
}

function setCardTone(id, tone) {
  const card = $(id);
  if (!card) return;
  card.classList.remove("green", "blue", "yellow", "red", "grey");
  card.classList.add(tone);
}

function updateFlows(live, hasLive) {
  const solar = Number(live?.solar_kw) || 0;
  const home = Number(live?.home_kw) || 0;
  const grid = Number(live?.grid_kw) || 0;
  const battery = Number(live?.battery_kw) || 0;
  const ev = Number(live?.ev_kw) || 0;
  const sources = new Set();
  const destinations = new Set();
  if (solar > .05) sources.add("solar");
  if (battery > .05) sources.add("battery");
  if (grid > .05) sources.add("grid");
  if (home > .05) destinations.add("home");
  if (ev > .05) destinations.add("ev");
  if (battery < -.05) destinations.add("battery");
  if (grid < -.05) destinations.add("grid");
  document.querySelectorAll("#flowNetwork g").forEach(path => {
    const active = hasLive && sources.has(path.dataset.from) && destinations.has(path.dataset.to);
    path.classList.toggle("active", active);
  });
  document.querySelector(".energy-node.grid")?.classList.toggle("is-active", hasLive && grid < -.05);
  document.querySelector(".energy-node.battery")?.classList.toggle("is-active", hasLive && battery < -.05);
  document.querySelector(".energy-node.ev")?.classList.toggle("is-active", hasLive && ev > .05);
}

async function signIn(event) {
  event.preventDefault();
  const button = $("loginButton");
  button.disabled = true;
  showError("loginError", "");
  try {
    const result = await api("/v1/web-auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("usernameInput").value, password: $("passwordInput").value })
    });
    saveSession(result.access_token);
    $("passwordInput").value = "";
    await boot();
  } catch (error) {
    showError("loginError", friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

async function exchangeAppLink() {
  const portalToken = params.get("portal_token");
  if (!portalToken) return;
  try {
    const result = await api("/v1/web/portal-session", {
      method: "POST",
      body: JSON.stringify({ portal_token: portalToken })
    });
    saveSession(result.access_token);
  } catch (error) {
    showError("loginError", friendlyError(error));
  } finally {
    params.delete("portal_token");
    params.delete("environment");
    const cleanUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", cleanUrl);
  }
}

async function signOut() {
  try { await api("/v1/web-auth/logout", { method: "POST" }); } catch (_) { /* local sign-out still succeeds */ }
  clearSession();
  showLogin();
}

async function loadSites() {
  const data = await api("/v1/web/sites");
  const select = $("siteSelect");
  select.replaceChildren();
  for (const site of data.sites || []) {
    const option = document.createElement("option");
    option.value = site.site_key;
    option.textContent = site.display_name || `Site ${String(site.site_key || "").slice(0, 6)}`;
    select.append(option);
  }
  const saved = sessionStorage.getItem(SITE_KEY);
  if (saved && (data.sites || []).some(site => site.site_key === saved)) select.value = saved;
  if (!select.value && data.sites?.[0]) select.value = data.sites[0].site_key;
  if (!select.value) showError("appError", "No energy sites are connected to this MAP Energy account.");
  return select.value;
}

async function loadOverview(siteKey) {
  if (!siteKey) return;
  showError("appError", "");
  const data = await api(`/v1/web/overview?site_key=${encodeURIComponent(siteKey)}`);
  currentOverview = data;
  const live = data.live || {};
  const hasLive = live.source === "tesla_live_status";
  const siteName = data.site?.display_name || $("siteSelect").selectedOptions[0]?.textContent || "Energy site";
  if ($("siteSelect").selectedOptions[0]) $("siteSelect").selectedOptions[0].textContent = siteName;
  setText("accountSiteName", siteName);
  setText("liveSiteName", siteName);
  setText("siteTimezone", data.timezone || data.site?.timezone || "UTC");
  setText("solarKw", hasLive ? fmtNodeKw(live.solar_kw) : "--");
  setText("homeKw", hasLive ? fmtNodeKw(live.home_kw) : "--");
  setText("gridKw", hasLive ? fmtNodeKw(live.grid_kw) : "--");
  setText("evNodeKw", hasLive ? fmtNodeKw(live.ev_kw) : "--");
  setText("batteryPowerKw", hasLive ? fmtNodeKw(live.battery_kw, true) : "--");
  const soc = hasLive && Number.isFinite(Number(live.battery_soc)) ? Math.round(Number(live.battery_soc)) : null;
  setText("batterySummarySoc", soc ?? "--");
  setText("solarToday", fmtKwhNumber(data.today?.solar_kwh));
  setText("importToday", fmtKwhNumber(data.today?.import_kwh));
  setText("exportToday", fmtKwhNumber(data.today?.export_kwh));
  setText("backupReserve", data.tesla_settings?.backup_reserve_percent == null ? "--" : `${Math.round(Number(data.tesla_settings.backup_reserve_percent))}%`);
  setText("operationMode", prettyMode(data.tesla_settings?.operation_mode));
  setText("exportRule", prettyExport(data.tesla_settings?.export_rule));
  const insight = liveInsight(live);
  setText("liveStateText", insight.text);
  $("liveState").classList.remove("blue", "yellow", "green", "neutral");
  $("liveState").classList.add(insight.tone);
  $("liveStateIcon").setAttribute("href", `assets/map-energy-icons.svg#${insight.icon}`);
  setCardTone("backupCard", "green");
  setCardTone("modeCard", ({ autonomous: "blue", self_consumption: "green", backup: "red" })[String(data.tesla_settings?.operation_mode || "").toLowerCase()] || "grey");
  setCardTone("exportCard", ({ pv_only: "yellow", battery_ok: "green", never: "red", no_export: "red" })[String(data.tesla_settings?.export_rule || "").toLowerCase()] || "grey");
  setText("teslaStatus", data.connection?.tesla_status || "Not connected");
  setText("teslaHealth", data.connection?.tesla_health || "Unknown");
  setText("telemetryAge", data.connection?.last_telemetry_age_seconds == null ? "--" : `${Math.round(data.connection.last_telemetry_age_seconds / 60)} min`);
  setText("automationCount", data.automations?.active_count ?? 0);
  setText("automationRuns", data.automations?.recent_runs ?? 0);
  setText("updatedAt", `Updated ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
  const pill = $("livePill");
  pill.classList.toggle("offline", !hasLive);
  pill.querySelector("span").textContent = hasLive ? "Live" : "Not live";
  updateFlows(live, hasLive);
}

function nodeLabel(node) {
  return ({ solar: "Solar generation", home: "Home usage", grid: "Grid energy", battery: "Battery charge", ev: "EV charging" })[node] || "Energy";
}

function nodeValue(slot, node) {
  if (node === "solar") return Number(slot.solar_kwh) || 0;
  if (node === "home") return Number(slot.home_kwh) || 0;
  if (node === "grid") return Math.max(Number(slot.import_kwh) || 0, Number(slot.export_kwh) || 0);
  if (node === "battery") return Number(slot.battery_soc);
  if (node === "ev") return Number(slot.ev_kw) || 0;
  return 0;
}

async function loadNodeChart(node) {
  const siteKey = $("siteSelect").value;
  if (!siteKey || !currentOverview?.day_start_utc) return;
  const data = await api(`/v1/web/history-day?site_key=${encodeURIComponent(siteKey)}&day_start_utc=${encodeURIComponent(currentOverview.day_start_utc)}`);
  const slots = data.slots || [];
  const values = slots.map(slot => nodeValue(slot, node)).filter(Number.isFinite);
  const max = Math.max(.01, ...values);
  setText("nodeChartTitle", nodeLabel(node));
  setText("nodeChartSub", `Today in 30-minute intervals · ${node === "battery" ? "%" : node === "ev" ? "kW" : "kWh"}`);
  $("nodeChartBars").innerHTML = slots.map(slot => {
    const value = nodeValue(slot, node);
    const height = Number.isFinite(value) ? Math.max(3, value / max * 150) : 3;
    return `<i class="chart-bar ${escapeHtml(node)}" style="height:${height.toFixed(0)}px"></i>`;
  }).join("");
  $("nodeChart").classList.remove("hidden");
  $("nodeChart").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function tariffCard(tariff) {
  const slots = Array.isArray(tariff.slots) ? tariff.slots : [];
  const values = slots.map(Number).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const currentIndex = Math.max(0, Math.min(47, Math.floor((Date.now() / 1000 - Number(tariff.day_start_utc || 0)) / 1800)));
  const bars = slots.map((value, index) => {
    const number = Number(value);
    const height = Number.isFinite(number) && max > min ? 18 + (number - min) / (max - min) * 78 : 42;
    return `<i class="tariff-bar ${index === currentIndex ? "current" : ""}" title="${escapeHtml(fmtRate(number))}" style="height:${height.toFixed(0)}%"></i>`;
  }).join("");
  const title = tariff.kind === "export" ? "Export tariff" : "Import tariff";
  return `<article class="glass panel"><span class="eyebrow">${escapeHtml(tariff.kind || "Tariff")}</span><div class="panel-heading"><div><h2>${title}</h2><p>${escapeHtml(tariff.display_name || tariff.source || "Supplier tariff")}</p></div><strong>${escapeHtml(fmtRate(tariff.current_rate_pence))}</strong></div><div class="tariff-bars">${bars}</div><dl><div><dt>Lowest today</dt><dd>${escapeHtml(fmtRate(tariff.lowest_rate_pence))}</dd></div><div><dt>Highest today</dt><dd>${escapeHtml(fmtRate(tariff.highest_rate_pence))}</dd></div><div><dt>Updated</dt><dd>${escapeHtml(fmtTime(tariff.updated_at))}</dd></div></dl></article>`;
}

async function loadSupplier(siteKey) {
  const data = await api(`/v1/web/supplier?site_key=${encodeURIComponent(siteKey)}`);
  $("supplierCards").innerHTML = data.tariffs?.length ? data.tariffs.map(tariffCard).join("") : `<div class="empty">No supplier tariffs are available for this site yet.</div>`;
}

async function loadHistory(siteKey) {
  const data = await api(`/v1/web/history?site_key=${encodeURIComponent(siteKey)}`);
  $("historyList").innerHTML = data.days?.length ? data.days.map(day => `<article class="glass list-card clickable" data-day="${escapeHtml(day.day_start_utc)}"><div><strong>${escapeHtml(fmtDate(day.first_ts, day.date_utc))}</strong><small>Solar ${escapeHtml(fmtKwh(day.solar_kwh))} · Import ${escapeHtml(fmtKwh(day.import_kwh))} · Export ${escapeHtml(fmtKwh(day.export_kwh))}</small></div><span class="badge">View details</span></article>`).join("") : `<div class="empty">No recent energy history is available.</div>`;
  document.querySelectorAll("[data-day]").forEach(element => element.addEventListener("click", () => loadHistoryDay(siteKey, element.dataset.day).catch(handlePageError)));
}

async function loadHistoryDay(siteKey, dayStart) {
  const data = await api(`/v1/web/history-day?site_key=${encodeURIComponent(siteKey)}&day_start_utc=${encodeURIComponent(dayStart)}`);
  const slots = data.slots || [];
  const totals = slots.reduce((result, slot) => ({
    importKwh: result.importKwh + (Number(slot.import_kwh) || 0), exportKwh: result.exportKwh + (Number(slot.export_kwh) || 0),
    importCost: result.importCost + (Number(slot.import_cost) || 0), exportRevenue: result.exportRevenue + (Number(slot.export_revenue) || 0)
  }), { importKwh: 0, exportKwh: 0, importCost: 0, exportRevenue: 0 });
  $("historyList").insertAdjacentHTML("afterbegin", `<article class="glass panel"><div class="panel-heading"><div><span class="eyebrow">Daily detail</span><h2>${escapeHtml(fmtDate(data.day_start_utc))}</h2><p>Energy totals from 30-minute intervals</p></div><button id="closeDay" class="button button-quiet" type="button">Close</button></div><div class="slot-grid"><div><span>Imported</span><strong>${escapeHtml(fmtKwh(totals.importKwh))}</strong></div><div><span>Import cost</span><strong>${escapeHtml(fmtMoney(totals.importCost))}</strong></div><div><span>Exported</span><strong>${escapeHtml(fmtKwh(totals.exportKwh))}</strong></div><div><span>Export value</span><strong>${escapeHtml(fmtMoney(totals.exportRevenue))}</strong></div></div></article>`);
  $("closeDay").addEventListener("click", () => loadHistory(siteKey).catch(handlePageError));
}

function automationName(payload, fallback) {
  return payload?.name || payload?.trigger?.event || fallback || "Automation";
}

function triggerText(payload) {
  const trigger = payload?.trigger;
  if (!trigger) return "No trigger information";
  if (trigger.type === "schedule") return `Scheduled at ${String(trigger.hour ?? "--").padStart(2, "0")}:${String(trigger.minute ?? "--").padStart(2, "0")}`;
  if (trigger.type === "ev") return `EV ${String(trigger.event || "").replaceAll("_", " ")}`;
  if (trigger.type === "battery") return `Battery ${String(trigger.condition || "").replaceAll("_", " ")} ${trigger.value ?? ""}`;
  return String(trigger.type || "Trigger");
}

function automationCard(automation, historical = false) {
  const status = historical ? automation.status || "--" : automation.paused ? "Paused" : "Active";
  const detail = historical ? `${automation.message || triggerText(automation.payload)} · ${fmtTime(automation.executed_at)}` : `${automation.message || triggerText(automation.payload)}${automation.next_fire_at ? ` · Next ${fmtTime(automation.next_fire_at)}` : ""}`;
  return `<article class="glass list-card"><div><strong>${escapeHtml(automationName(automation.payload, automation.type))}</strong><small>${escapeHtml(detail)}</small></div><span class="badge ${escapeHtml(String(status).toLowerCase())}">${escapeHtml(status)}</span></article>`;
}

async function loadAutomations(siteKey) {
  const data = await api(`/v1/web/automations?site_key=${encodeURIComponent(siteKey)}`);
  const rules = data.automations || [];
  const history = data.history || [];
  $("automationList").innerHTML = `<article class="glass panel"><span class="eyebrow">Configured</span><h2>Automation rules</h2><div class="stack">${rules.length ? rules.map(rule => automationCard(rule)).join("") : `<div class="empty">No automations are configured.</div>`}</div></article><article class="glass panel"><span class="eyebrow">Latest activity</span><h2>Recent runs</h2><div class="stack">${history.length ? history.map(run => automationCard(run, true)).join("") : `<div class="empty">No recent automation runs.</div>`}</div></article>`;
}

function settingsCard(title, eyebrow, rows) {
  return `<article class="glass panel"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "--")}</dd></div>`).join("")}</dl></article>`;
}

async function loadSettings(siteKey) {
  const data = await api(`/v1/web/settings?site_key=${encodeURIComponent(siteKey)}`);
  const imported = data.supplier?.import;
  const exported = data.supplier?.export;
  $("settingsCards").innerHTML = settingsCard("Portal access", "Account", [["Access", "Premium"], ["Portal mode", "Read only"], ["Selected site", $("siteSelect").selectedOptions[0]?.textContent]]) + settingsCard("Site configuration", "Energy", [["Timezone", data.timezone], ["EV charger", data.ev_charger_type]]) + settingsCard("Tesla connection", "Inverter", [["Status", data.tesla?.status || "Not connected"], ["Health", data.tesla?.health], ["Site ID", data.tesla?.site_id_suffix], ["Last error", data.tesla?.last_error]]) + settingsCard("Energy supplier", "Tariffs", [["Import", imported ? imported.display_name || imported.source : "--"], ["Export", exported ? exported.display_name || exported.source : "--"]]) + settingsCard("Tesla tariff sync", "Sync", [["Enabled", data.tesla_tariff_sync?.enabled ? "Yes" : "No"], ["Last synced", fmtTime(data.tesla_tariff_sync?.last_synced_at)], ["Last reason", data.tesla_tariff_sync?.last_sync_reason], ["Last error", data.tesla_tariff_sync?.last_error]]);
}

const pageCopy = {
  live: ["Live energy", "A real-time view of power moving through your home"],
  supplier: ["Supplier", "Your current import and export tariff information"],
  history: ["Energy history", "Recent daily usage, generation and grid totals"],
  automations: ["Automations", "Your active rules and their latest activity"],
  settings: ["Portal settings", "A read-only summary of your site configuration"]
};

async function showPage(page) {
  document.querySelectorAll(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.page === page));
  document.querySelectorAll(".page").forEach(section => section.classList.toggle("active", section.id === `page-${page}`));
  const copy = pageCopy[page] || pageCopy.live;
  setText("pageTitle", copy[0]);
  setText("pageSubtitle", copy[1]);
  const siteKey = $("siteSelect").value;
  if (!siteKey) return;
  if (page === "supplier") await loadSupplier(siteKey);
  if (page === "history") await loadHistory(siteKey);
  if (page === "automations") await loadAutomations(siteKey);
  if (page === "settings") await loadSettings(siteKey);
}

function handlePageError(error) {
  showError("appError", friendlyError(error));
}

async function boot() {
  if (!accessToken) return showLogin();
  try {
    await api("/v1/web/me");
    showApp();
    const siteKey = await loadSites();
    await loadOverview(siteKey);
  } catch (error) {
    showLogin(friendlyError(error));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  setText("year", new Date().getFullYear());
  $("loginForm").addEventListener("submit", signIn);
  $("headerSignOut").addEventListener("click", signOut);
  $("closeNodeChart").addEventListener("click", () => $("nodeChart").classList.add("hidden"));
  document.querySelectorAll(".energy-node").forEach(button => button.addEventListener("click", () => loadNodeChart(button.dataset.node).catch(handlePageError)));
  document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page).catch(handlePageError)));
  $("siteSelect").addEventListener("change", async event => {
    sessionStorage.setItem(SITE_KEY, event.target.value);
    $("nodeChart").classList.add("hidden");
    try {
      await loadOverview(event.target.value);
      const activePage = document.querySelector(".nav-button.active")?.dataset.page || "live";
      if (activePage !== "live") await showPage(activePage);
    } catch (error) { handlePageError(error); }
  });
  await exchangeAppLink();
  await boot();
  window.setInterval(() => {
    const siteKey = $("siteSelect").value;
    if (siteKey && !$("appView").classList.contains("hidden")) loadOverview(siteKey).catch(handlePageError);
  }, 30000);
});
