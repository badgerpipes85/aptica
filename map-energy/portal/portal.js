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
let contextVersion = 0;
let viewRequest = 0;
let chartRequest = 0;
let overviewRequest = 0;
let activePage = "live";
let lastUpdated = null;

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
  const version = contextVersion;
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (version !== contextVersion) throw new DOMException("Site changed", "AbortError");
  if (!response.ok) {
    if (response.status === 401 && path !== "/v1/web-auth/login") {
      clearSession();
      showLogin("Your session has ended. Please sign in again.");
    }
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }
  return data;
}

function saveSession(token) {
  accessToken = String(token || "");
  if (accessToken) sessionStorage.setItem(SESSION_KEY, accessToken);
}

function clearSession() {
  contextVersion++;
  resetSiteView();
  accessToken = "";
  sessionStorage.removeItem(SESSION_KEY);
}

function showLogin(message = "") {
  $("portalBadge").classList.add("hidden");
  if ($("nodeChart").open) $("nodeChart").close();
  document.body.classList.remove("portal-active");
  $("loginView").classList.remove("hidden");
  $("appView").classList.add("hidden");
  $("headerSignOut").classList.add("hidden");
  showError("loginError", message);
}

function showApp() {
  $("portalBadge").classList.remove("hidden");
  document.body.classList.add("portal-active");
  $("loginView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("headerSignOut").classList.remove("hidden");
}

function fmtKw(value) {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) ? (Math.abs(number) >= 10 ? nf1.format(number) : nf.format(number)) : "--";
}

function fmtKwh(value) {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) ? `${nf1.format(number)} kWh` : "--";
}

function fmtNodeKw(value, absolute = false) {
  const number = value == null || value === "" ? NaN : Number(value);
  if (!Number.isFinite(number)) return "--";
  return nodeNumber.format(absolute ? Math.abs(number) : number);
}

function fmtKwhNumber(value) {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) ? nf1.format(number) : "--";
}

function fmtRate(value) {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) ? `${nf1.format(number)}p/kWh` : "--";
}

function fmtMoney(value) {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(number) : "--";
}

function fmtTime(value) {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) && number > 0
    ? new Date(number * 1000).toLocaleString("en-GB", { timeZone: siteTimezone(), day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "--";
}

function fmtDate(value, fallback = "--") {
  const number = value == null || value === "" ? NaN : Number(value);
  return Number.isFinite(number) && number > 0
    ? new Date(number * 1000).toLocaleDateString("en-GB", { timeZone: siteTimezone(), weekday: "short", day: "numeric", month: "short" })
    : fallback;
}

function prettyMode(value) {
  const mode = String(value || "").toLowerCase();
  return { self_consumption: "Self-Powered", autonomous: "Savings", backup: "Backup" }[mode] || value || "--";
}

function prettyExport(value) {
  return { battery_ok: "Everything", pv_only: "Solar", never: "Nothing", no_export: "Nothing" }[String(value || "").toLowerCase()] || value || "--";
}

function allocateLiveFlows(live) {
  let solar = Math.max(Number(live?.solar_kw) || 0, 0);
  let home = Math.max(Number(live?.home_kw) || 0, 0);
  let ev = Math.max(Number(live?.ev_kw) || 0, 0);
  let grid = Math.max(Number(live?.grid_kw) || 0, 0);
  let gridExport = Math.max(-(Number(live?.grid_kw) || 0), 0);
  let batteryDischarge = Math.max(Number(live?.battery_kw) || 0, 0);
  let batteryCharge = Math.max(-(Number(live?.battery_kw) || 0), 0);
  const flows = new Map();
  const add = (from, to, available) => {
    const power = Math.max(available, 0);
    if (power > .05) flows.set(`${from}:${to}`, power);
    return power;
  };

  let used = add("solar", "grid", Math.min(solar, gridExport));
  solar -= used; gridExport -= used;
  used = add("battery", "grid", Math.min(batteryDischarge, gridExport));
  batteryDischarge -= used; gridExport -= used;

  used = add("solar", "home", Math.min(solar, home));
  solar -= used; home -= used;
  used = add("solar", "ev", Math.min(solar, ev));
  solar -= used; ev -= used;
  used = add("solar", "battery", Math.min(solar, batteryCharge));
  solar -= used; batteryCharge -= used;

  used = add("battery", "home", Math.min(batteryDischarge, home));
  batteryDischarge -= used; home -= used;
  used = add("battery", "ev", Math.min(batteryDischarge, ev));
  batteryDischarge -= used; ev -= used;

  used = add("grid", "home", Math.min(grid, home));
  grid -= used; home -= used;
  used = add("grid", "ev", Math.min(grid, ev));
  grid -= used; ev -= used;
  add("grid", "battery", Math.min(grid, batteryCharge));
  return flows;
}

function liveInsight(live, flows = allocateLiveFlows(live)) {
  const has = (from, to) => flows.has(`${from}:${to}`);
  const gridHome = has("grid", "home");
  const gridEv = has("grid", "ev");
  const gridBattery = has("grid", "battery");
  const solarHome = has("solar", "home");
  const solarEv = has("solar", "ev");
  const solarBattery = has("solar", "battery");
  const solarExport = has("solar", "grid");
  const batteryHome = has("battery", "home");
  const batteryEv = has("battery", "ev");
  const batteryExport = has("battery", "grid");
  if (gridBattery && gridEv && gridHome) return { text: "Grid is supplying the home, charging EV and charging the Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && gridEv && solarHome) return { text: "Solar is supplying the home while grid charges EV and Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && gridEv) return { text: "Grid is charging EV and the Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && gridHome) return { text: "Grid is supplying the home and charging the Powerwall", tone: "blue", icon: "battery" };
  if (gridBattery && solarHome) return { text: "Solar is supplying the home while the grid charges the Powerwall", tone: "blue", icon: "battery" };
  if (gridEv && gridHome && !solarEv && !batteryEv) return { text: "Grid is supplying the home and charging EV", tone: "blue", icon: "car" };
  if (gridEv && solarHome && !solarEv && !batteryEv) return { text: "Solar is supplying the home while grid charges EV", tone: "blue", icon: "car" };
  if (solarHome && solarEv && solarBattery) return { text: "Solar is supplying the home, charging EV and charging the Powerwall", tone: "yellow", icon: "solar" };
  if (solarHome && solarEv) return { text: "Solar is supplying the home and charging EV", tone: "yellow", icon: "solar" };
  if (solarHome && solarBattery) return { text: "Solar is powering home and charging the Powerwall", tone: "yellow", icon: "solar" };
  if (solarHome && batteryHome) return { text: "Solar and the Powerwall are supplying the home", tone: "yellow", icon: "solar" };
  if (solarEv && solarExport) return { text: "Solar is charging EV and exporting surplus energy", tone: "yellow", icon: "solar" };
  if (batteryHome && batteryEv && batteryExport) return { text: "Powerwall is supplying home, charging EV and exporting to the grid", tone: "green", icon: "battery" };
  if (batteryHome && batteryEv) return { text: "Powerwall is supplying home and charging EV", tone: "green", icon: "battery" };
  if (batteryEv && batteryExport) return { text: "Powerwall is charging EV and exporting to the grid", tone: "green", icon: "battery" };
  if (batteryHome && solarExport && !solarHome) return { text: "Powerwall is supplying home while Solar exports", tone: "green", icon: "battery" };
  if (solarHome && solarExport) return { text: "Solar is supplying the home and exporting surplus energy", tone: "yellow", icon: "solar" };
  if (solarHome && gridHome) return { text: "Solar is supplying the home while the grid supports demand", tone: "yellow", icon: "solar" };
  if (gridHome && solarBattery) return { text: "The grid is supplying the home while Solar charges the Powerwall", tone: "blue", icon: "battery" };
  if (batteryHome && batteryExport) return { text: "Powerwall is supplying home and exporting to the grid", tone: "green", icon: "battery" };
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
  const flows = allocateLiveFlows(live);
  document.querySelectorAll("#flowNetwork g").forEach(path => {
    const active = hasLive && flows.has(`${path.dataset.from}:${path.dataset.to}`);
    path.classList.toggle("active", active);
  });
  document.querySelector(".energy-node.grid")?.classList.toggle("is-active", hasLive && [...flows.keys()].some(key => key.endsWith(":grid")));
  document.querySelector(".energy-node.battery")?.classList.toggle("is-active", hasLive && [...flows.keys()].some(key => key.endsWith(":battery")));
  document.querySelector(".energy-node.ev")?.classList.toggle("is-active", hasLive && [...flows.keys()].some(key => key.endsWith(":ev")));
  return flows;
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
    // Keep the staging selector so a reload uses the same session environment.
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
  $("noSite").classList.toggle("hidden", !!select.value);
  $("refreshButton").disabled = false;
  return select.value;
}

async function loadOverview(siteKey) {
  if (!siteKey) return;
  const request = ++overviewRequest;
  const data = await api(`/v1/web/overview?site_key=${encodeURIComponent(siteKey)}`);
  if (request !== overviewRequest) return;
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
  const soc = hasLive && live.battery_soc != null && Number.isFinite(Number(live.battery_soc)) ? Math.round(Number(live.battery_soc)) : null;
  setText("batterySummarySoc", soc ?? "--");
  setText("solarToday", fmtKwhNumber(data.today?.solar_kwh));
  setText("importToday", fmtKwhNumber(data.today?.import_kwh));
  setText("exportToday", fmtKwhNumber(data.today?.export_kwh));
  setText("backupReserve", data.tesla_settings?.backup_reserve_percent == null ? "--" : `${Math.round(Number(data.tesla_settings.backup_reserve_percent))}%`);
  setText("operationMode", prettyMode(data.tesla_settings?.operation_mode));
  setText("exportRule", prettyExport(data.tesla_settings?.export_rule));
  const flows = allocateLiveFlows(live);
  const insight = liveInsight(live, flows);
  setText("liveStateText", hasLive ? insight.text : "Live readings are unavailable. Check your Tesla connection in the MAP Energy app.");
  setText("batteryState", !hasLive || live.battery_kw == null ? "No live battery data" : live.battery_kw > .05 ? "Battery discharging" : live.battery_kw < -.05 ? "Battery charging" : "Battery idle");
  document.querySelector(".energy-node.grid").classList.toggle("exporting", hasLive && live.grid_kw < -.05);
  for (const node of ["solar", "home", "grid", "battery", "ev"]) {
    const value = hasLive ? fmtNodeKw(live[`${node}_kw`], node === "battery") : "--";
    document.querySelector(`[data-node="${node}"]`).setAttribute("aria-label", `${nodeLabel(node)}: ${value} kW. View today's history`);
  }
  $("liveState").classList.remove("blue", "yellow", "green", "neutral");
  $("liveState").classList.add(hasLive ? insight.tone : "neutral");
  $("liveStateIcon").setAttribute("href", `/map-energy/assets/map-energy-icons.svg#${insight.icon}`);
  setCardTone("backupCard", "green");
  setCardTone("modeCard", ({ autonomous: "blue", self_consumption: "green", backup: "red" })[String(data.tesla_settings?.operation_mode || "").toLowerCase()] || "grey");
  setCardTone("exportCard", ({ pv_only: "yellow", battery_ok: "green", never: "red", no_export: "red" })[String(data.tesla_settings?.export_rule || "").toLowerCase()] || "grey");
  setText("teslaStatus", data.connection?.tesla_status || "Not connected");
  setText("teslaHealth", data.connection?.tesla_health || "Unknown");
  setText("telemetryAge", data.connection?.last_telemetry_age_seconds == null ? "--" : `${Math.round(data.connection.last_telemetry_age_seconds / 60)} min`);
  setText("automationCount", data.automations?.active_count ?? 0);
  setText("automationRuns", data.automations?.recent_runs ?? 0);
  if (activePage === "live") showError("appError", "");
  lastUpdated = new Date();
  updateTimestamp();
  const pill = $("livePill");
  pill.classList.toggle("offline", !hasLive);
  pill.querySelector("span").textContent = hasLive ? "Live" : "Not live";
  updateFlows(live, hasLive);
}

function nodeLabel(node) {
  return ({ solar: "Solar generation", home: "Home usage", grid: "Net grid energy", battery: "Battery charge", ev: "EV charging" })[node] || "Energy";
}

function nodeValue(slot, node) {
  const value = node === "grid"
    ? (slot.import_kwh == null && slot.export_kwh == null ? null : Number(slot.import_kwh || 0) - Number(slot.export_kwh || 0))
    : slot[{ solar: "solar_kwh", home: "home_kwh", battery: "battery_soc", ev: "ev_kw" }[node]];
  return value == null ? NaN : Number(value);
}

async function loadNodeChart(node) {
  const siteKey = $("siteSelect").value;
  if (!siteKey || !currentOverview?.day_start_utc) return;
  const request = ++chartRequest;
  setText("nodeChartTitle", nodeLabel(node));
  setText("nodeChartSub", `Today · ${siteTimezone()} · ${node === "grid" ? "Net import above / net export below zero" : "30-minute readings"}`);
  $("nodeChartBars").innerHTML = '<div class="empty">Loading readings…</div>';
  if (!$("nodeChart").open) $("nodeChart").showModal();
  try {
    const data = await api(`/v1/web/history-day?site_key=${encodeURIComponent(siteKey)}&day_start_utc=${encodeURIComponent(currentOverview.day_start_utc)}`);
    if (request !== chartRequest || !$("nodeChart").open) return;
    const slots = data.slots || [];
    const unit = node === "battery" ? "%" : node === "ev" ? "kW" : "kWh";
    const values = slots.map(slot => nodeValue(slot, node));
    if (!values.some(Number.isFinite)) {
      $("nodeChartBars").innerHTML = '<div class="empty">No readings available for this part of your system today.</div>';
      return;
    }
    const limit = Math.max(.01, ...values.filter(Number.isFinite).map(Math.abs));
    const negative = values.some(v => v < 0);
    const baseline = negative ? 110 : 200;
    const scale = negative ? 90 : 180;
    const step = 600 / Math.max(slots.length, 1);
    const bars = values.map((value, i) => {
      if (!Number.isFinite(value)) return "";
      const height = Math.abs(value) / limit * scale;
      const label = slots[i].start_ts ? fmtTime(slots[i].start_ts) : `Interval ${i + 1}`;
      return `<rect class="timeline-bar ${node}" x="${(i * step + 1).toFixed(2)}" y="${(value < 0 ? baseline : baseline - height).toFixed(2)}" width="${Math.max(1, step - 2).toFixed(2)}" height="${height.toFixed(2)}" rx="2"><title>${escapeHtml(label)}: ${nf1.format(value)} ${unit}</title></rect>`;
    }).join("");
    $("nodeChartBars").innerHTML = `<div class="chart-scale"><span>${nf1.format(limit)} ${unit}</span><span>${negative ? "±" : "From zero"}</span></div><svg class="timeline-svg" viewBox="0 0 600 220" role="img" aria-label="${escapeHtml(nodeLabel(node))} over ${slots.length} intervals"><line x1="0" x2="600" y1="${baseline}" y2="${baseline}" class="chart-baseline"/>${bars}</svg><div class="chart-scale"><span>Start of day</span><span>End of day</span></div>`;
  } catch (error) {
    if (error.name !== "AbortError" && request === chartRequest) $("nodeChartBars").innerHTML = `<div class="empty">${escapeHtml(friendlyError(error))}. Close and select the node to retry.</div>`;
  }
}

function siteHalfHourIndex(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date());
    const part = type => Number(parts.find(item => item.type === type)?.value || 0);
    return Math.max(0, Math.min(47, part("hour") * 2 + Math.floor(part("minute") / 30)));
  } catch {
    const now = new Date();
    return now.getHours() * 2 + Math.floor(now.getMinutes() / 30);
  }
}

function tariffCard(tariff, timeZone) {
  const slots = Array.isArray(tariff.slots) ? tariff.slots : [];
  const values = slots.filter(value => value != null).map(Number).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const range = Math.max(Math.abs(min), Math.abs(max), .01);
  const currentIndex = siteHalfHourIndex(timeZone);
  const isExport = tariff.kind === "export";
  const bars = slots.map((value, index) => {
    const number = value == null || value === "" ? NaN : Number(value);
    const height = Number.isFinite(number) ? Math.max(5, Math.abs(number) / range * 116) : 0;
    let band = isExport ? "export" : "mid";
    if (!isExport && number <= min + .01) band = "offpeak";
    if (!isExport && number >= max - .01 && max > min + .01) band = "peak";
    if (number < 0) band = "negative";
    if (!Number.isFinite(number)) band = "missing";
    const heightClass = `h${Math.max(0, Math.min(20, Math.round(height / 6)))}`;
    return `<i class="tariff-bar ${band} ${heightClass} ${index === currentIndex ? "current" : ""}" title="${escapeHtml(fmtRate(number))}"></i>`;
  }).join("");
  const title = isExport ? "Export" : "Import";
  const accent = isExport ? "export" : "import";
  const currentRate = slots[currentIndex] != null && Number.isFinite(Number(slots[currentIndex])) ? Number(slots[currentIndex]) : tariff.current_rate_pence;
  const source = tariff.display_name || ({ edf: "EDF", octopus: "Octopus Energy", amber: "Amber Electric", comed: "ComEd", manual: "Custom tariff" })[String(tariff.source || "").toLowerCase()] || tariff.source || "Supplier tariff";
  return `<article class="glass supplier-card ${accent}">
    <div class="tariff-heading"><span class="tariff-icon"><svg><use href="/map-energy/assets/map-energy-icons.svg#${isExport ? "export" : "import"}"></use></svg></span><div><h2>${title}</h2><p>${escapeHtml(source)}</p></div></div>
    <div class="tariff-chart"><div class="tariff-bars">${bars}</div><div class="tariff-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>
    <div class="chart-legend">${isExport ? '<span class="legend-rate">Export rate</span>' : '<span class="legend-low">Low / negative</span><span class="legend-high">Highest</span>'}<span class="legend-now">Current interval</span></div>
    <div class="tariff-footer"><div><strong>${escapeHtml(fmtRate(tariff.lowest_rate_pence))}</strong><small>Lowest today</small></div><div class="current-rate"><strong>${escapeHtml(fmtRate(currentRate))}</strong><small>Current rate</small></div></div>
    <div class="tariff-updated">Highest ${escapeHtml(fmtRate(tariff.highest_rate_pence))} · Updated ${escapeHtml(fmtTime(tariff.updated_at))}</div>
  </article>`;
}

async function loadSupplier(siteKey) {
  const data = await api(`/v1/web/supplier?site_key=${encodeURIComponent(siteKey)}`);
  $("supplierCards").innerHTML = data.tariffs?.length ? data.tariffs.map(tariff => tariffCard(tariff, data.timezone)).join("") : `<div class="empty">No supplier tariffs are available for this site yet.</div>`;
}

async function loadHistory(siteKey) {
  const version = contextVersion;
  const data = await api(`/v1/web/history?site_key=${encodeURIComponent(siteKey)}`);
  const days = Array.isArray(data.days) ? data.days.slice(0, 7) : [];
  const details = await Promise.all(days.map(day => api(`/v1/web/history-day?site_key=${encodeURIComponent(siteKey)}&day_start_utc=${encodeURIComponent(day.day_start_utc)}`).catch(() => null)));
  if (version !== contextVersion) return;
  $("historyList").innerHTML = days.length ? days.map((day, index) => {
    const detailSlots = details[index]?.slots || [];
    const costs = detailSlots.reduce((result, slot) => ({
      imported: result.imported + (Number(slot.import_cost) || 0),
      exported: result.exported + (Number(slot.export_revenue) || 0)
    }), { imported: 0, exported: 0 });
    const hasCosts = detailSlots.some(slot => slot.import_cost != null || slot.export_revenue != null);
    return `<button type="button" class="glass history-day clickable" data-day="${escapeHtml(day.day_start_utc)}">
    <span class="history-day-head"><span class="history-calendar"><svg><use href="/map-energy/assets/map-energy-icons.svg#calendar"></use></svg></span><span><strong>${escapeHtml(fmtDate(day.first_ts, day.date_utc))}</strong><small>Daily energy summary</small></span><span class="history-chevron">›</span></span>
    <span class="history-metrics"><span class="import"><span><svg><use href="/map-energy/assets/map-energy-icons.svg#import"></use></svg>Import</span><strong>${escapeHtml(fmtKwh(day.import_kwh))}</strong></span><span class="solar"><span><svg><use href="/map-energy/assets/map-energy-icons.svg#solar"></use></svg>PV</span><strong>${escapeHtml(fmtKwh(day.solar_kwh))}</strong></span><span class="export"><span><svg><use href="/map-energy/assets/map-energy-icons.svg#export"></use></svg>Export</span><strong>${escapeHtml(fmtKwh(day.export_kwh))}</strong></span><span class="net"><span>Net cost</span><strong>${hasCosts ? escapeHtml(fmtMoney(costs.imported - costs.exported)) : "--"}</strong></span></span>
  </button>`;
  }).join("") : `<div class="empty">No completed energy history is available yet.</div>`;
  document.querySelectorAll("[data-day]").forEach(element => element.addEventListener("click", () => loadHistoryDay(siteKey, element.dataset.day).catch(handlePageError)));
}

async function loadHistoryDay(siteKey, dayStart) {
  const data = await api(`/v1/web/history-day?site_key=${encodeURIComponent(siteKey)}&day_start_utc=${encodeURIComponent(dayStart)}`);
  const slots = data.slots || [];
  const totals = slots.reduce((result, slot) => ({
    importKwh: result.importKwh + (Number(slot.import_kwh) || 0), exportKwh: result.exportKwh + (Number(slot.export_kwh) || 0), solarKwh: result.solarKwh + (Number(slot.solar_kwh) || 0),
    importCost: result.importCost + (Number(slot.import_cost) || 0), exportRevenue: result.exportRevenue + (Number(slot.export_revenue) || 0)
  }), { importKwh: 0, exportKwh: 0, solarKwh: 0, importCost: 0, exportRevenue: 0 });
  const energyTotals = data.totals ? {
    importKwh: Number(data.totals.import_kwh) || 0,
    exportKwh: Number(data.totals.export_kwh) || 0,
    solarKwh: Number(data.totals.solar_kwh) || 0
  } : totals;
  const maxFlow = Math.max(.01, ...slots.flatMap(slot => [Number(slot.import_kwh) || 0, Number(slot.export_kwh) || 0]));
  const bars = slots.map(slot => {
    const imported = Math.max(Number(slot.import_kwh) || 0, 0);
    const exported = Math.max(Number(slot.export_kwh) || 0, 0);
    const importHeight = Math.max(0, Math.min(20, Math.round(imported / maxFlow * 20)));
    const exportHeight = Math.max(0, Math.min(20, Math.round(exported / maxFlow * 20)));
    return `<i><b class="history-import h${importHeight}"></b><b class="history-export h${exportHeight}"></b></i>`;
  }).join("");
  const hasCosts = slots.some(slot => slot.import_cost != null || slot.export_revenue != null);
  const net = totals.importCost - totals.exportRevenue;
  $("historyList").innerHTML = `<article class="glass history-detail"><div class="history-detail-head"><div><span class="eyebrow">Daily detail</span><h2>${escapeHtml(fmtDate(data.day_start_utc))}</h2><p>${escapeHtml(fmtKwh(energyTotals.importKwh))} imported · ${escapeHtml(fmtKwh(energyTotals.solarKwh))} solar</p></div><button id="closeDay" class="button button-quiet" type="button">Close</button></div>
    <section class="history-flow"><div class="history-section-title"><span class="history-chart-icon">▥</span><div><strong>30-minute grid flow</strong><small>Import and export by slot</small></div></div><div class="history-flow-chart">${bars}</div><div class="tariff-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></section>
    <section class="history-summary"><div class="history-section-title"><span class="history-calendar"><svg><use href="/map-energy/assets/map-energy-icons.svg#bolt"></use></svg></span><div><strong>Energy Summary</strong><small>Energy costs exclude standing charges</small></div></div><div class="history-summary-grid"><div class="import"><span>Import kWh</span><strong>${escapeHtml(fmtKwh(energyTotals.importKwh))}</strong></div><div class="export"><span>Export kWh</span><strong>${escapeHtml(fmtKwh(energyTotals.exportKwh))}</strong></div><div class="import"><span>Import cost</span><strong>${hasCosts ? escapeHtml(fmtMoney(totals.importCost)) : "--"}</strong></div><div class="export"><span>Export value</span><strong>${hasCosts ? escapeHtml(fmtMoney(totals.exportRevenue)) : "--"}</strong></div><div><span>Solar</span><strong>${escapeHtml(fmtKwh(energyTotals.solarKwh))}</strong></div><div><span>Net</span><strong>${hasCosts ? escapeHtml(fmtMoney(net)) : "--"}</strong></div></div></section></article>`;
  $("closeDay").addEventListener("click", () => loadHistory(siteKey).catch(handlePageError));
}

function triggerText(payload) {
  const trigger = payload?.trigger;
  if (!trigger) return "Automation executed";
  if (trigger.type === "schedule") return "Scheduled automation";
  if (trigger.type === "ev") return trigger.event === "starts_charging" ? "EV started charging" : "EV stopped charging";
  if (trigger.type === "battery") return `Battery SOC went ${trigger.condition === "soc_below" ? "below" : "above"} ${trigger.value ?? 0}%`;
  if (trigger.type === "solar") return `Solar forecast ${trigger.condition === "below" ? "below" : "above"} ${trigger.value_kwh ?? 0} kWh`;
  return "Automation executed";
}

function automationName(run) {
  const payload = run.payload || {};
  if (run.type === "grouped_actions") return payload.name?.trim() || "Grouped Automation";
  if (run.status === "success" && run.error_message && run.type !== "notification_only") return run.error_message;
  const names = { tesla_export: "Export Rule Adjusted", adjust_backup_reserve: "Backup Reserve Adjusted", freeze_battery_soc: "Backup Reserve Frozen", set_op_mode: "Operational Mode Changed", set_grid_charging: "Grid Charging Updated" };
  return payload.name?.trim() || names[run.type] || String(run.type || "Automation").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function actionText(action) {
  if (action?.type === "adjust_backup_reserve") return `Battery reserve → ${action.backup_reserve_percent ?? 0}%`;
  if (action?.type === "freeze_battery_soc") return "Freeze backup reserve at current SOC";
  if (action?.type === "restore_backup_reserve") return "Restore previous backup reserve";
  if (action?.type === "tesla_export") return `Export → ${{ pv_only: "Solar Only", battery_ok: "Everything", never: "Nothing", no_export: "Nothing" }[action.export_policy] || action.export_policy || "Unknown"}`;
  if (action?.type === "set_op_mode") return `Mode → ${{ autonomous: "Savings", self_consumption: "Self-Powered", backup: "Backup" }[action.op_mode] || action.op_mode || "Unknown"}`;
  if (action?.type === "set_grid_charging") return `Grid charging → ${action.enabled ? "ON" : "OFF"}`;
  if (action?.type === "home_assistant_event") return "Send a Home Assistant event";
  if (action?.type === "notification_only") return "Send notification";
  return String(action?.type || "Action").replaceAll("_", " ");
}

function runSummary(run) {
  if (["blocked", "partial", "error", "failed", "skipped"].includes(run.status)) return run.error_message || `Automation ${run.status}`;
  return triggerText(run.payload);
}

function ruleCard(rule) {
  const status = rule.paused ? "Paused" : "Active";
  const detail = `${rule.message || triggerText(rule.payload)}${rule.next_fire_at ? ` · Next ${fmtTime(rule.next_fire_at)}` : ""}`;
  return `<article class="automation-rule-card"><span class="automation-rule-icon"><svg><use href="/map-energy/assets/map-energy-icons.svg#automation"></use></svg></span><div><strong>${escapeHtml(automationName(rule))}</strong><small>${escapeHtml(detail)}</small></div><span class="automation-status ${status.toLowerCase()}">${status}</span></article>`;
}

function runCard(run, timezone) {
  const name = automationName(run);
  const actions = run.type === "grouped_actions" && Array.isArray(run.payload?.actions) ? run.payload.actions.map(actionText) : [];
  const summary = runSummary(run);
  const status = run.status === "error" || run.status === "failed" ? "Failed" : `${run.status || "unknown"}`.replace(/^./, c => c.toUpperCase());
  const time = new Date(Number(run.executed_at) * 1000).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
  return `<article class="automation-run-card ${escapeHtml(String(run.status || "failed"))}"><span class="run-status-icon">${run.status === "success" ? "✓" : run.status === "skipped" ? "›" : "!"}</span><div class="run-copy"><strong>${escapeHtml(name)}</strong>${actions.map(line => `<small>${escapeHtml(line)}</small>`).join("")}${summary !== name ? `<small class="run-summary">${escapeHtml(summary)}</small>` : ""}<span class="run-time">●&nbsp; ${escapeHtml(time)}</span></div><span class="automation-status ${escapeHtml(String(run.status || "failed"))}">${escapeHtml(status)}</span></article>`;
}

function dayKeyAndLabel(timestamp, timezone) {
  const date = new Date(Number(timestamp) * 1000);
  const key = date.toLocaleDateString("en-CA", { timeZone: timezone });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"}).formatToParts(new Date());
  const part = type => Number(parts.find(item => item.type === type).value);
  const yesterdayDate = new Date(Date.UTC(part("year"), part("month") - 1, part("day") - 1, 12));
  const yesterday = yesterdayDate.toLocaleDateString("en-CA", {timeZone: "UTC"});
  return { key, label: key === today ? "Today" : key === yesterday ? "Yesterday" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: timezone }) };
}

async function loadAutomations(siteKey) {
  const data = await api(`/v1/web/automations?site_key=${encodeURIComponent(siteKey)}`);
  const rules = data.automations || [];
  const history = data.history || [];
  const smart = data.smart_charging;
  const smartCard = smart ? `<article class="smart-scheduling-card"><span class="smart-scheduling-icon"><svg><use href="/map-energy/assets/map-energy-icons.svg#car"></use></svg></span><div><h2>${escapeHtml(smart.title)}</h2><p>${escapeHtml(smart.summary)}</p></div><span class="automation-status ${smart.enabled ? "active" : "paused"}">${smart.enabled ? "Enabled" : "Paused"}</span></article>` : "";
  const rulesContent = rules.length ? `<div class="automation-rules">${rules.map(ruleCard).join("")}</div>` : `<div class="automation-empty"><span><svg><use href="/map-energy/assets/map-energy-icons.svg#automation"></use></svg></span><h2>${smart ? "No other automations yet" : "No automations yet"}</h2><p>${smart ? "Create another automation in the MAP Energy app." : "Create your first automation in the MAP Energy app."}</p></div>`;
  const groups = new Map();
  history.forEach(run => { const day = dayKeyAndLabel(run.executed_at, data.timezone); const group = groups.get(day.key) || { label: day.label, runs: [] }; group.runs.push(run); groups.set(day.key, group); });
  const historyContent = history.length ? Array.from(groups.values()).map(group => `<section class="run-day"><header><h3>${escapeHtml(group.label)}</h3><span>${group.runs.length}</span></header><div>${group.runs.map(run => runCard(run, data.timezone)).join("")}</div></section>`).join("") : `<div class="automation-empty compact"><h2>No automation history yet</h2><p>Executed automations will appear here.</p></div>`;
  $("automationList").innerHTML = `<div class="automation-overview"><div><strong>${rules.filter(rule => !rule.paused).length}</strong><span>Active rules</span></div><div><strong>${rules.filter(rule => rule.paused).length}</strong><span>Paused</span></div><div><strong>${history.filter(run => ["failed", "error", "partial", "blocked"].includes(run.status)).length}</strong><span>Runs to review</span></div></div><div class="automation-config">${smartCard}${rulesContent}</div><article class="run-log"><div class="run-log-heading"><span><svg><use href="/map-energy/assets/map-energy-icons.svg#history"></use></svg></span><div><h2>Run Log</h2><p>${history.length} recent run${history.length === 1 ? "" : "s"}</p></div></div><div class="segmented" aria-label="Filter automation activity"><button type="button" data-run-filter="all" aria-pressed="true">All activity</button><button type="button" data-run-filter="attention" aria-pressed="false">Needs attention</button></div>${historyContent}<p id="noAttention" class="empty hidden">No failed, partial or blocked runs in this history.</p></article>`;
  document.querySelectorAll("[data-run-filter]").forEach(button => button.addEventListener("click", () => {
    const attention = button.dataset.runFilter === "attention";
    document.querySelectorAll("[data-run-filter]").forEach(item => item.setAttribute("aria-pressed", String(item === button)));
    let visible = 0;
    document.querySelectorAll(".automation-run-card").forEach(card => {
      const show = !attention || ["failed", "error", "partial", "blocked"].some(status => card.classList.contains(status));
      card.classList.toggle("hidden", !show);
      if (show) visible++;
    });
    document.querySelectorAll(".run-day").forEach(day => day.classList.toggle("hidden", !day.querySelector(".automation-run-card:not(.hidden)")));
    $("noAttention").classList.toggle("hidden", !attention || visible > 0);
  }));
}

function settingsCard(title, eyebrow, rows) {
  return `<article class="glass panel"><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2><dl>${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "--")}</dd></div>`).join("")}</dl></article>`;
}

async function loadSettings(siteKey) {
  const data = await api(`/v1/web/settings?site_key=${encodeURIComponent(siteKey)}`);
  const imported = data.supplier?.import;
  const exported = data.supplier?.export;
  $("settingsCards").innerHTML = settingsCard("Portal access", "Account", [["Access", "Premium"], ["Portal mode", "Read only"], ["Selected site", $("siteSelect").selectedOptions[0]?.textContent]]) + settingsCard("Site configuration", "Energy", [["Timezone", data.timezone], ["EV charger", ({wallConnector: "Tesla Wall Connector", zappi: "myenergi Zappi", hypervolt: "Hypervolt", ohme: "Ohme", none: "Not connected"})[data.ev_charger_type] || data.ev_charger_type]]) + settingsCard("Tesla connection", "Inverter", [["Status", data.tesla?.status || "Not connected"], ["Health", data.tesla?.health], ["Site ID", data.tesla?.site_id_suffix], ["Last error", data.tesla?.last_error]]) + settingsCard("Energy supplier", "Tariffs", [["Import", imported ? imported.display_name || imported.source : "--"], ["Export", exported ? exported.display_name || exported.source : "--"]]) + settingsCard("Tesla tariff sync", "Sync", [["Enabled", data.tesla_tariff_sync?.enabled ? "Yes" : "No"], ["Last synced", fmtTime(data.tesla_tariff_sync?.last_synced_at)], ["Last reason", data.tesla_tariff_sync?.last_sync_reason], ["Last error", data.tesla_tariff_sync?.last_error]]);
}

const pageCopy = {
  live: ["Live energy", "A real-time view of power moving through your home"],
  supplier: ["Supplier", "Your current import and export tariff information"],
  history: ["Energy history", "Recent daily usage, generation and grid totals"],
  automations: ["Automations", "View configured automations and their run history"],
  settings: ["Portal settings", "A read-only summary of your site configuration"]
};

function siteTimezone() {
  return currentOverview?.timezone || currentOverview?.site?.timezone || "UTC";
}

function updateTimestamp() {
  setText("updatedAt", lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString("en-GB", {hour: "2-digit", minute: "2-digit"})}` : "Waiting for data");
}

function resetSiteView() {
  currentOverview = null;
  lastUpdated = null;
  overviewRequest++;
  chartRequest++;
  if ($("nodeChart").open) $("nodeChart").close();
  for (const id of ["solarKw", "homeKw", "gridKw", "evNodeKw", "batteryPowerKw", "batterySummarySoc", "solarToday", "importToday", "exportToday", "backupReserve", "operationMode", "exportRule"]) setText(id, "--");
  for (const id of ["supplierCards", "historyList", "automationList", "settingsCards"]) $(id).replaceChildren();
  setText("siteTimezone", "");
  setText("batteryState", "Waiting for data");
  setText("liveStateText", "Waiting for your site's energy readings…");
  $("livePill").classList.add("offline");
  $("livePill").querySelector("span").textContent = "Connecting";
  updateFlows({}, false);
  updateTimestamp();
}

async function showPage(page, { refreshOverview = false, focus = false } = {}) {
  if (!pageCopy[page]) page = "live";
  activePage = page;
  const request = ++viewRequest;
  document.querySelectorAll(".nav-button").forEach(button => {
    const selected = button.dataset.page === page;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  document.querySelectorAll(".page").forEach(section => section.classList.toggle("active", section.id === `page-${page}`));
  setText("pageTitle", pageCopy[page][0]);
  setText("pageSubtitle", pageCopy[page][1]);
  if (focus) $("pageTitle").focus({ preventScroll: true });
  const siteKey = $("siteSelect").value;
  if (!siteKey) {
    document.querySelectorAll(".page").forEach(section => section.classList.remove("active"));
    return;
  }
  showError("appError", "");
  $("pageLoading").classList.remove("hidden");
  document.querySelector(".workspace").setAttribute("aria-busy", "true");
  $("refreshButton").disabled = true;
  try {
    if (refreshOverview) await loadOverview(siteKey);
    if (page === "supplier") await loadSupplier(siteKey);
    if (page === "history") await loadHistory(siteKey);
    if (page === "automations") await loadAutomations(siteKey);
    if (page === "settings") await loadSettings(siteKey);
  } catch (error) {
    if (request === viewRequest) handlePageError(error);
  } finally {
    if (request === viewRequest) {
      $("pageLoading").classList.add("hidden");
      document.querySelector(".workspace").setAttribute("aria-busy", "false");
      $("refreshButton").disabled = false;
    }
  }
}

function handlePageError(error) {
  if (error.name === "AbortError") return;
  showError("appError", `${friendlyError(error)} Use Refresh to try again.`);
  if (activePage === "live") {
    $("livePill").classList.add("offline");
    $("livePill").querySelector("span").textContent = "Not updating";
    updateFlows({}, false);
    setText("liveStateText", "Connection interrupted. Readings may be out of date. Refresh to reconnect.");
  }
}

async function boot() {
  if (!accessToken) return showLogin($("loginError").textContent);
  try {
    await api("/v1/web/me");
    resetSiteView();
    showApp();
    const siteKey = await loadSites();
    if (siteKey) await showPage(location.hash.slice(1) || "live", {refreshOverview: true});
    else document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  } catch (error) {
    if (error.name !== "AbortError") showLogin(friendlyError(error));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  setText("year", new Date().getFullYear());
  $("loginForm").addEventListener("submit", signIn);
  $("headerSignOut").addEventListener("click", signOut);
  $("closeNodeChart").addEventListener("click", () => $("nodeChart").close());
  $("nodeChart").addEventListener("close", () => chartRequest++);
  document.querySelectorAll(".energy-node").forEach(button => button.addEventListener("click", () => loadNodeChart(button.dataset.node).catch(handlePageError)));
  document.querySelectorAll(".nav-button").forEach(button => button.addEventListener("click", () => {
    history.replaceState({}, "", `#${button.dataset.page}`);
    showPage(button.dataset.page, { focus: true });
  }));
  $("refreshButton").addEventListener("click", () => $("siteSelect").value ? showPage(activePage, {refreshOverview: true}) : boot());
  $("siteSelect").addEventListener("change", async event => {
    contextVersion++;
    sessionStorage.setItem(SITE_KEY, event.target.value);
    resetSiteView();
    await showPage(activePage, {refreshOverview: true});
  });
  await exchangeAppLink();
  await boot();
  let refreshing = false;
  window.setInterval(async () => {
    const siteKey = $("siteSelect").value;
    if (!siteKey || document.hidden || refreshing || $("appView").classList.contains("hidden") || $("refreshButton").disabled) return;
    refreshing = true;
    try { await loadOverview(siteKey); } catch (error) { handlePageError(error); }
    finally { refreshing = false; }
  }, 30000);
});
