import { isSupabaseConfigured, supabase } from "./supabaseClient.js?v=20260312c";
import { DEFAULT_ROOM_NAMES, DEFAULT_SETTINGS } from "./utils/constants.js";
import { clearChildren, setVisible } from "./utils/dom.js";
import { blockKey, formatBlockLabel, settingsRowsToObject, sortScheduleItems } from "./utils/schedule.js";
import { resolveDisplayContext } from "./utils/time.js";

const refs = {
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  title: document.getElementById("displayTitle"),
  logoImage: document.getElementById("logoImage"),
  bannerSection: document.getElementById("bannerSection"),
  bannerImage: document.getElementById("bannerImage"),
  date: document.getElementById("displayDate"),
  time: document.getElementById("displayTime"),
  modeBadge: document.getElementById("modeBadge"),
  eventsContainer: document.getElementById("eventsContainer"),
  emptyState: document.getElementById("emptyState"),
  statusText: document.getElementById("statusText"),
  activeBlockText: document.getElementById("activeBlockText"),
  lastRefreshText: document.getElementById("lastRefreshText")
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  lastBlockKey: null,
  refreshTimer: null,
  refreshSeconds: null,
  isLoading: false
};

function normalizeRoomName(value) {
  return String(value || "").trim().toUpperCase().replace(/^ROOM\s+/i, "");
}

const DEFAULT_ROOM_CODES = new Set(DEFAULT_ROOM_NAMES.map((name) => normalizeRoomName(name)));

function setStatus(text) {
  refs.statusText.textContent = text;
}

function setModeBadge(mode) {
  refs.modeBadge.textContent = mode === "test" ? "TEST MODE" : "LIVE";
  refs.modeBadge.classList.toggle("mode-test", mode === "test");
  refs.modeBadge.classList.toggle("mode-live", mode !== "test");
}

function showConfigError() {
  setStatus("Supabase config missing or stale. Confirm js/config.js and hard refresh the page (Ctrl+F5).");
  refs.activeBlockText.textContent = "Block: --";
  refs.lastRefreshText.textContent = "Refresh: --";
}

async function fetchSettings() {
  const { data, error } = await supabase.from("app_settings").select("key,value");
  if (error) {
    throw error;
  }
  return settingsRowsToObject(data);
}

async function fetchBlock(dayOfWeek, period) {
  const query = supabase
    .from("schedule_blocks")
    .select(`
      id,
      day_of_week,
      period,
      title,
      is_active,
      schedule_items (
        id,
        room_name,
        start_time_text,
        end_time_text,
        event_title,
        notes,
        sort_order,
        is_visible
      )
    `)
    .eq("day_of_week", dayOfWeek)
    .eq("period", period)
    .eq("is_active", true)
    .maybeSingle();

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  return data;
}

function getItemTimeText(item) {
  const start = String(item.start_time_text || "").trim();
  const end = String(item.end_time_text || "").trim();
  return start && end ? `${start} - ${end}` : start || end || "";
}

function renderRoomCard(roomName, item) {
  const article = document.createElement("article");
  article.className = "room-card";

  const header = document.createElement("div");
  header.className = "room-head";
  const roomLabel = document.createElement("div");
  roomLabel.className = "room-label";
  roomLabel.textContent = roomName;
  const roomTime = document.createElement("div");
  roomTime.className = "room-time";
  roomTime.textContent = item ? getItemTimeText(item) || "Time TBD" : "No Time";
  header.append(roomLabel, roomTime);

  const title = document.createElement("div");
  title.className = "room-title";
  title.textContent = item?.event_title || "No meeting scheduled";

  article.append(header, title);

  if (item?.notes) {
    const notes = document.createElement("div");
    notes.className = "room-notes";
    notes.textContent = item.notes;
    article.append(notes);
  } else if (!item) {
    const empty = document.createElement("div");
    empty.className = "room-empty";
    empty.textContent = "Add a title and optional time in Admin.";
    article.append(empty);
  }

  return article;
}

function renderExtraRooms(items) {
  if (!items.length) {
    return null;
  }
  const section = document.createElement("section");
  section.className = "extra-rooms";
  const heading = document.createElement("h3");
  heading.textContent = "Additional Rooms";
  const list = document.createElement("div");
  list.className = "extra-rooms-list";

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "extra-room-item";
    row.innerHTML = `
      <strong>${item.room_name || "Room"}</strong>
      <div>${item.event_title || "Meeting"}</div>
      <div>${getItemTimeText(item) || "Time TBD"}</div>
      <div>${item.notes || ""}</div>
    `;
    list.append(row);
  }

  section.append(heading, list);
  return section;
}

function renderMediaFromSettings() {
  const logoUrl = String(state.settings.display_logo_url || "").trim();
  const bannerUrl = String(state.settings.display_banner_url || "").trim();

  if (logoUrl) {
    refs.logoImage.src = logoUrl;
    setVisible(refs.logoImage, true);
  } else {
    refs.logoImage.removeAttribute("src");
    setVisible(refs.logoImage, false);
  }

  if (bannerUrl) {
    refs.bannerImage.src = bannerUrl;
    setVisible(refs.bannerSection, true);
  } else {
    refs.bannerImage.removeAttribute("src");
    setVisible(refs.bannerSection, false);
  }
}

function renderSchedule(block, context) {
  refs.title.textContent = block?.title || state.settings.display_title || "Today's Events";
  refs.date.textContent = context.formattedDate;
  refs.time.textContent = context.formattedTime;
  setModeBadge(context.mode);
  renderMediaFromSettings();

  const items = sortScheduleItems(block?.schedule_items || []);
  clearChildren(refs.eventsContainer);
  setVisible(refs.emptyState, false);

  const defaultRoomMap = new Map();
  const extraRooms = [];
  for (const item of items) {
    const normalized = normalizeRoomName(item.room_name);
    if (DEFAULT_ROOM_CODES.has(normalized) && !defaultRoomMap.has(normalized)) {
      defaultRoomMap.set(normalized, item);
    } else {
      extraRooms.push(item);
    }
  }

  for (const roomName of DEFAULT_ROOM_NAMES) {
    refs.eventsContainer.append(renderRoomCard(roomName, defaultRoomMap.get(normalizeRoomName(roomName))));
  }

  const extrasNode = renderExtraRooms(extraRooms);
  if (extrasNode) {
    refs.eventsContainer.append(extrasNode);
  }
}

async function logBlockChange(previousKey, nextKey, context) {
  if (!previousKey || previousKey === nextKey) {
    return;
  }

  const payload = {
    p_from_block: previousKey,
    p_to_block: nextKey,
    p_mode: context.mode,
    p_effective_timestamp: context.effectiveDate.toISOString(),
    p_timezone: context.timezone
  };

  const rpcResult = await supabase.rpc("log_display_block_change", payload);
  if (!rpcResult.error) {
    return;
  }

  await supabase.from("event_log").insert({
    event_type: "display_block_changed",
    event_source: "display_page",
    payload: {
      from: previousKey,
      to: nextKey,
      mode: context.mode,
      effective_timestamp: context.effectiveDate.toISOString(),
      timezone: context.timezone
    }
  });
}

function ensureRefreshTimer(seconds) {
  if (state.refreshSeconds === seconds && state.refreshTimer) {
    return;
  }

  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
  }

  state.refreshSeconds = seconds;
  state.refreshTimer = setInterval(() => {
    runRefreshCycle().catch(() => undefined);
  }, seconds * 1000);
}

function updateFullscreenButtonText() {
  refs.fullscreenBtn.textContent = document.fullscreenElement ? "Exit Fullscreen" : "Enter Fullscreen";
}

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
  updateFullscreenButtonText();
}

async function runRefreshCycle() {
  if (state.isLoading) {
    return;
  }

  state.isLoading = true;
  try {
    const settings = await fetchSettings();
    state.settings = settings;
    const context = resolveDisplayContext(settings, new Date());
    const block = await fetchBlock(context.dayOfWeek, context.period);
    const currentKey = blockKey(context.dayOfWeek, context.period);

    renderSchedule(block, context);
    refs.activeBlockText.textContent = `Block: ${formatBlockLabel(context.dayOfWeek, context.period)}`;
    refs.lastRefreshText.textContent = `Refresh: ${new Date().toLocaleTimeString()}`;
    setStatus(`Source: ${context.source} (${context.timezone})`);

    await logBlockChange(state.lastBlockKey, currentKey, context).catch(() => undefined);
    state.lastBlockKey = currentKey;

    const refreshSeconds = Math.max(15, Number(settings.display_refresh_seconds || 60));
    ensureRefreshTimer(refreshSeconds);
  } catch (error) {
    const message = error?.message || "Unable to load schedule.";
    setStatus(`Error: ${message}`);
  } finally {
    state.isLoading = false;
  }
}

async function init() {
  refs.fullscreenBtn.addEventListener("click", () => {
    toggleFullscreen().catch((error) => {
      setStatus(`Fullscreen failed: ${error?.message || "unknown error"}`);
    });
  });
  document.addEventListener("fullscreenchange", updateFullscreenButtonText);
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "f") {
      toggleFullscreen().catch(() => undefined);
    }
  });

  if (!isSupabaseConfigured()) {
    showConfigError();
    return;
  }

  await runRefreshCycle();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      runRefreshCycle().catch(() => undefined);
    }
  });
  window.addEventListener("focus", () => runRefreshCycle().catch(() => undefined));
}

init().catch((error) => {
  setStatus(`Initialization error: ${error?.message || "Unknown error"}`);
});
