"use strict";

let perksRequest = 0;
let perksResponse = null;
let perksMetrics = new Map();
let perksConfirmEvent = null;
let perksSaving = false;
let perksLoading = false;
const perksDayCache = new Map();

function resetPowerPerksView() {
  perksRequest++;
  perksResponse = null;
  perksMetrics.clear();
  perksDayCache.clear();
  perksConfirmEvent = null;
  perksLoading = false;
  $("powerPerksButton").classList.add("hidden");
  if ($("powerPerksDialog").open) $("powerPerksDialog").close();
  $("powerPerksTotals").replaceChildren();
  $("powerPerksContent").replaceChildren();
  $("powerPerksConfirm").classList.add("hidden");
  showError("powerPerksError", "");
}

function updatePowerPerksAccess(data) {
  const eligible = data.power_perks?.eligible === true;
  $("powerPerksButton").classList.toggle("hidden", !eligible);
  if (!eligible && $("powerPerksDialog").open) resetPowerPerksView();
}

function perksDayStart(epoch, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const parts = value => Object.fromEntries(formatter.formatToParts(new Date(value * 1000)).map(part => [part.type, part.value]));
  const date = parts(epoch);
  const target = Date.UTC(+date.year, +date.month - 1, +date.day) / 1000;
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const local = parts(guess);
    const represented = Date.UTC(+local.year, +local.month - 1, +local.day, +local.hour, +local.minute, +local.second) / 1000;
    const correction = target - represented;
    guess += correction;
    if (!correction) break;
  }
  return guess;
}

function perksEventDays(event, timeZone, now = Date.now() / 1000) {
  const end = Math.min(Number(event.end_at) - 1, now);
  const days = [];
  if (Number(event.start_at) > end) return days;
  let day = perksDayStart(Number(event.start_at), timeZone);
  while (day <= end && days.length < 93) {
    days.push(day);
    day = perksDayStart(day + 36 * 3600, timeZone);
  }
  return days;
}

function powerPerksMetric(event, days, timeZone, now = Date.now() / 1000) {
  let energy = 0, saving = 0, energyAvailable = true, savingAvailable = true;
  for (const day of perksEventDays(event, timeZone, now)) {
    const data = days.get(day);
    if (!data?.slots?.length) { energyAvailable = false; savingAvailable = false; continue; }
    for (const slot of data.slots) {
      const start = Number(slot.start_ts), end = start + 1800;
      const overlap = Math.max(0, Math.min(Number(event.end_at), end) - Math.max(Number(event.start_at), start));
      if (!overlap || start > now) continue;
      if (slot.data_available === false || slot.import_kwh == null || !Number.isFinite(Number(slot.import_kwh))) {
        energyAvailable = false; savingAvailable = false; continue;
      }
      const kwh = Number(slot.import_kwh) * overlap / 1800;
      energy += kwh;
      if (slot.import_rate_pence == null || !Number.isFinite(Number(slot.import_rate_pence))) savingAvailable = false;
      else saving += kwh * Number(slot.import_rate_pence) / 100;
    }
  }
  return { energy: energyAvailable ? energy : null, saving: savingAvailable ? saving : null };
}

function powerPerksBadge(event, metric, now = Date.now() / 1000) {
  if (now < Number(event.start_at)) return event.participating ? { label: "Ready", tone: "green" } : null;
  if (now < Number(event.end_at)) return { label: "In Progress", tone: event.participating ? "green" : "red" };
  if (metric?.energy == null) return { label: "Unavailable", tone: "grey" };
  return metric.energy <= 0.05 ? { label: "Missed", tone: "red" } : { label: `${fmtKwhNumber(metric.energy)} kWh`, tone: "green" };
}

function canConfirmPowerPerks(event, metric, now = Date.now() / 1000) {
  return now >= Number(event.end_at) && !event.participating && metric?.energy != null && metric.energy <= 0.05;
}

function powerPerksLabel(event) {
  const zone = event.timezone || "Europe/London";
  const start = new Date(Number(event.start_at) * 1000), end = new Date(Number(event.end_at) * 1000);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "long" });
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const endDate = date.format(start) === date.format(end) ? "" : `${date.format(end)} `;
  return `${date.format(start)} ${time.format(start)} – ${endDate}${time.format(end)}`;
}

function renderPowerPerks() {
  const events = perksResponse?.events || [];
  const now = Date.now() / 1000;
  const upcoming = events.filter(event => Number(event.end_at) > now).sort((a, b) => a.start_at - b.start_at);
  const history = events.filter(event => Number(event.end_at) <= now).sort((a, b) => b.start_at - a.start_at);
  const metrics = events.map(event => perksMetrics.get(event.id));
  const energy = metrics.every(metric => metric?.energy != null) ? metrics.reduce((sum, metric) => sum + metric.energy, 0) : null;
  const saving = metrics.every(metric => metric?.saving != null) ? metrics.reduce((sum, metric) => sum + metric.saving, 0) : null;
  $("powerPerksTotals").classList.toggle("hidden", !events.length);
  $("powerPerksTotals").innerHTML = `<div><span>FREE ENERGY</span><strong>${energy == null ? "--" : `${fmtKwhNumber(energy)} kWh`}</strong></div><div><span>EST. SAVING</span><strong>${fmtMoney(saving)}</strong></div>`;
  const section = (title, list) => !list.length ? "" : `<section class="perks-section"><h3>${title}</h3>${list.map(event => {
    const metric = perksMetrics.get(event.id), badge = powerPerksBadge(event, metric, now);
    const confirmable = canConfirmPowerPerks(event, metric, now), tag = confirmable ? "button" : "div";
    return `<${tag} class="perks-event" ${confirmable ? `type="button" data-perks-event="${escapeHtml(event.id)}" aria-label="Confirm participation: ${escapeHtml(powerPerksLabel(event))}"` : ""}><img src="/map-energy/assets/power-perks-event.png" alt=""><span class="perks-event-label">${escapeHtml(powerPerksLabel(event))}</span>${badge ? `<span class="perks-badge ${badge.tone}">${escapeHtml(badge.label)}</span>` : ""}</${tag}>`;
  }).join("")}</section>`;
  $("powerPerksContent").innerHTML = events.length ? section("CURRENT & UPCOMING", upcoming) + section("RECENT HISTORY", history) : '<div class="empty"><strong>No Power Perks events yet</strong><p>New events announced by EDF will appear here.</p></div>';
  $("powerPerksContent").querySelectorAll("[data-perks-event]").forEach(button => button.addEventListener("click", () => {
    if (perksSaving) return;
    const event = events.find(item => item.id === button.dataset.perksEvent);
    if (!event || !canConfirmPowerPerks(event, perksMetrics.get(event.id))) return;
    perksConfirmEvent = event;
    setText("powerPerksConfirmEvent", powerPerksLabel(event));
    $("powerPerksConfirm").classList.remove("hidden");
    $("powerPerksConfirm").focus();
  }));
}

async function loadPowerPerks({ fresh = false } = {}) {
  const siteKey = $("siteSelect").value;
  if (!siteKey || currentOverview?.power_perks?.eligible !== true || perksSaving) return;
  const request = ++perksRequest;
  perksLoading = true;
  perksConfirmEvent = null;
  $("powerPerksConfirm").classList.add("hidden");
  $("refreshPowerPerks").disabled = true;
  $("powerPerksTotals").classList.add("hidden");
  $("powerPerksContent").innerHTML = '<div class="empty">Loading Power Perks events…</div>';
  showError("powerPerksError", "");
  try {
    const response = await api(`/v1/edf/power-perks?site_key=${encodeURIComponent(siteKey)}`);
    if (request !== perksRequest) return;
    if (response.registration_status !== "registered") { resetPowerPerksView(); return; }
    const events = response.events || [...(response.upcoming || []), ...(response.history || [])];
    const timeZone = siteTimezone();
    const dayKeys = [...new Set(events.flatMap(event => perksEventDays(event, timeZone)))];
    const days = new Map();
    const today = perksDayStart(Date.now() / 1000, timeZone);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, dayKeys.length) }, async () => {
      while (cursor < dayKeys.length && request === perksRequest) {
        const day = dayKeys[cursor++];
        const cache = perksDayCache.get(day);
        if (!fresh && cache && Date.now() - cache.loadedAt < (day === today ? 30000 : Infinity)) { days.set(day, cache.data); continue; }
        try {
          const data = await api(`/v1/web/history-day?site_key=${encodeURIComponent(siteKey)}&day_start_utc=${day}`);
          if (request !== perksRequest) return;
          days.set(day, data);
          perksDayCache.set(day, { data, loadedAt: Date.now() });
        } catch (error) { if (error.name === "AbortError" || request !== perksRequest) return; }
      }
    }));
    if (request !== perksRequest) return;
    perksResponse = { ...response, events };
    perksMetrics = new Map(events.map(event => [event.id, powerPerksMetric(event, days, timeZone)]));
    renderPowerPerks();
    if ([...perksMetrics.values()].some(metric => metric.energy == null || metric.saving == null)) showError("powerPerksError", "Some energy or tariff history is unavailable. Refresh to try again; incomplete totals are shown as --.");
  } catch (error) {
    if (error.name !== "AbortError" && request === perksRequest) {
      $("powerPerksContent").replaceChildren();
      showError("powerPerksError", `${friendlyError(error)} Use Refresh events to try again.`);
    }
  } finally {
    if (request === perksRequest) { perksLoading = false; $("refreshPowerPerks").disabled = false; }
  }
}

async function confirmPowerPerksParticipation() {
  const event = perksConfirmEvent, version = contextVersion, siteKey = $("siteSelect").value;
  if (!event || perksSaving || !canConfirmPowerPerks(event, perksMetrics.get(event.id)) || currentOverview?.power_perks?.eligible !== true) return;
  perksSaving = true;
  for (const id of ["savePowerPerksConfirm", "cancelPowerPerksConfirm", "closePowerPerks", "refreshPowerPerks"]) $(id).disabled = true;
  showError("powerPerksError", "");
  let saved = false;
  try {
    await api("/v1/edf/power-perks/participation", { method: "POST", body: JSON.stringify({ site_key: siteKey, event_id: event.id }) });
    if (version !== contextVersion) return;
    saved = true;
    event.participating = true;
    perksConfirmEvent = null;
    $("powerPerksConfirm").classList.add("hidden");
  } catch (error) {
    if (error.name !== "AbortError" && version === contextVersion) showError("powerPerksError", `${friendlyError(error)} Participation could not be confirmed. Refresh events before trying again.`);
  } finally {
    perksSaving = false;
    for (const id of ["savePowerPerksConfirm", "cancelPowerPerksConfirm", "closePowerPerks", "refreshPowerPerks"]) $(id).disabled = false;
  }
  if (saved) { renderPowerPerks(); await loadPowerPerks({ fresh: true }); }
}

document.addEventListener("DOMContentLoaded", () => {
  $("powerPerksButton").addEventListener("click", () => { $("powerPerksDialog").showModal(); loadPowerPerks(); });
  $("refreshPowerPerks").addEventListener("click", () => loadPowerPerks({ fresh: true }));
  $("closePowerPerks").addEventListener("click", () => { if (!perksSaving) $("powerPerksDialog").close(); });
  $("powerPerksDialog").addEventListener("cancel", event => { if (perksSaving) event.preventDefault(); });
  $("powerPerksDialog").addEventListener("close", () => { perksRequest++; perksLoading = false; perksConfirmEvent = null; });
  $("cancelPowerPerksConfirm").addEventListener("click", () => { perksConfirmEvent = null; $("powerPerksConfirm").classList.add("hidden"); });
  $("savePowerPerksConfirm").addEventListener("click", confirmPowerPerksParticipation);
  window.setInterval(() => {
    if (!document.hidden && $("powerPerksDialog").open && !perksLoading && !perksSaving && !perksConfirmEvent) loadPowerPerks();
  }, 30000);
});
