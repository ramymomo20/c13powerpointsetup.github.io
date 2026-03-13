import { isSupabaseConfigured, supabase } from "./supabaseClient.js?v=20260313h";
import { DEFAULT_ROOM_NAMES, DEFAULT_SETTINGS } from "./utils/constants.js";
import { clearChildren, setVisible } from "./utils/dom.js";
import { blockKey, formatBlockLabel, settingsRowsToObject, sortScheduleItems } from "./utils/schedule.js";
import { resolveDisplayContext } from "./utils/time.js";

const DEFAULT_LOGO_URL = "./assets/AFSCME-Logo-112531210.png";

const refs = {
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  title: document.getElementById("displayTitle"),
  viewDescription: document.getElementById("viewDescription"),
  date: document.getElementById("displayDate"),
  time: document.getElementById("displayTime"),
  modeBadge: document.getElementById("modeBadge"),
  displayLogo: document.getElementById("displayLogo"),
  displayPhoto: document.getElementById("displayPhoto"),
  displayPhotoCard: document.getElementById("displayPhotoCard"),
  eventsContainer: document.getElementById("eventsContainer"),
  emptyState: document.getElementById("emptyState"),
  statusText: document.getElementById("statusText")
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  lastBlockKey: null,
  refreshTimer: null,
  refreshAlignmentTimer: null,
  isLoading: false
};

const spareWatermark = document.createElement("div");
spareWatermark.className = "spare-watermark hidden";
spareWatermark.setAttribute("aria-hidden", "true");

function normalizeRoomName(value) {
  return String(value || "").trim().toUpperCase().replace(/^ROOM\s+/i, "");
}

function normalizeTimeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const match = raw.match(/^(\d{1,2})(?::?(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) {
    return raw;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = (match[3] || "").toUpperCase();
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return raw;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return raw;
    }
    if (hour === 12 && meridiem === "AM") {
      hour = 0;
    } else if (hour !== 12 && meridiem === "PM") {
      hour += 12;
    }
  } else if (hour > 23) {
    return raw;
  }

  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

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
}

async function fetchSettings() {
  const { data, error } = await supabase.from("app_settings").select("key,value");
  if (error) {
    throw error;
  }
  return settingsRowsToObject(data);
}

async function fetchWeekBlocks() {
  const { data, error } = await supabase
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
        event_title,
        notes,
        sort_order,
        is_visible
      )
    `)
    .eq("is_active", true)
    .gte("day_of_week", 0)
    .lte("day_of_week", 6)
    .in("period", ["morning", "evening"]);

  if (error) {
    throw error;
  }

  const weekMap = {};
  for (let day = 0; day <= 6; day += 1) {
    weekMap[day] = { morning: null, evening: null };
  }
  for (const row of data || []) {
    if ((row.period === "morning" || row.period === "evening") && weekMap[row.day_of_week]) {
      weekMap[row.day_of_week][row.period] = row;
    }
  }
  return weekMap;
}

function applyBranding() {
  refs.displayLogo.src = state.settings.display_logo_url || DEFAULT_LOGO_URL;
  const photoUrl = String(state.settings.display_photo_url || "").trim();
  setVisible(refs.displayPhotoCard, Boolean(photoUrl));
  if (photoUrl) {
    refs.displayPhoto.src = photoUrl;
  } else {
    refs.displayPhoto.removeAttribute("src");
  }
}

function buildRoomRows(items) {
  const itemByRoom = new Map();
  for (const item of sortScheduleItems(items || [])) {
    const roomCode = normalizeRoomName(item.room_name);
    if (!itemByRoom.has(roomCode)) {
      itemByRoom.set(roomCode, item);
    }
  }

  return DEFAULT_ROOM_NAMES.map((roomName, index) => {
    const item = itemByRoom.get(normalizeRoomName(roomName)) || null;
    return { roomName, item, toneIndex: index };
  });
}

function renderSimpleRows(activeBlock, context) {
  const wrap = document.createElement("section");
  wrap.className = "display-board";

  const label = document.createElement("div");
  label.className = "display-board-label";
  label.textContent = `${formatBlockLabel(context.dayOfWeek, context.period)} Schedule`;
  wrap.append(label);

  const rows = buildRoomRows(activeBlock?.schedule_items || []);
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "room-row";
    article.dataset.tone = String(row.toneIndex);

    const timeCell = document.createElement("div");
    timeCell.className = "room-time";
    timeCell.textContent = row.item?.start_time_text ? normalizeTimeLabel(row.item.start_time_text) : "";

    const eventCell = document.createElement("div");
    eventCell.className = "room-event";

    const title = document.createElement("div");
    title.className = "room-event-title";
    title.textContent = row.item?.event_title || "";
    eventCell.append(title);

    const notes = document.createElement("div");
    notes.className = "room-event-notes";
    notes.textContent = row.item?.notes || "";
    eventCell.append(notes);

    const roomCell = document.createElement("div");
    roomCell.className = "room-name";
    roomCell.textContent = row.roomName;

    article.append(timeCell, eventCell, roomCell);
    wrap.append(article);
  }

  clearChildren(refs.eventsContainer);
  refs.eventsContainer.append(wrap, spareWatermark);
}

function updateSpareWatermark() {
  requestAnimationFrame(() => {
    const spareHeight = refs.eventsContainer.clientHeight - refs.eventsContainer.scrollHeight;
    const shouldShow = document.body.classList.contains("fullscreen-active") && spareHeight > 120;
    setVisible(spareWatermark, shouldShow);
    if (!shouldShow) {
      spareWatermark.style.removeProperty("--watermark-height");
      return;
    }

    const height = Math.max(110, Math.min(240, Math.floor(spareHeight - 24)));
    spareWatermark.style.setProperty("--watermark-height", `${height}px`);
  });
}

function renderDisplay(weekBlocks, context) {
  const activeBlock = weekBlocks?.[context.dayOfWeek]?.[context.period] || null;
  refs.title.textContent = activeBlock?.title || state.settings.display_title || "Today's Events";
  refs.viewDescription.textContent = `${formatBlockLabel(context.dayOfWeek, context.period)}. Automatically switches at 5:00 AM and 5:00 PM Eastern.`;
  refs.date.textContent = context.formattedDate;
  refs.time.textContent = context.formattedTime;
  setModeBadge(context.mode);
  setVisible(refs.emptyState, false);
  applyBranding();
  renderSimpleRows(activeBlock, context);
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

function ensureRefreshTimer() {
  if (state.refreshTimer || state.refreshAlignmentTimer) {
    return;
  }

  const now = Date.now();
  const msUntilNextMinute = 60000 - (now % 60000);
  state.refreshAlignmentTimer = setTimeout(() => {
    runRefreshCycle().catch(() => undefined);
    state.refreshTimer = setInterval(() => {
      runRefreshCycle().catch(() => undefined);
    }, 60000);
    state.refreshAlignmentTimer = null;
  }, msUntilNextMinute);
}

function updateFullscreenButtonText() {
  const isFullscreen = Boolean(document.fullscreenElement);
  refs.fullscreenBtn.textContent = isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen";
  document.body.classList.toggle("fullscreen-active", isFullscreen);
  updateSpareWatermark();
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
    state.settings = await fetchSettings();
    const context = resolveDisplayContext(state.settings, new Date());
    const weekBlocks = await fetchWeekBlocks();
    const currentKey = blockKey(context.dayOfWeek, context.period);

    renderDisplay(weekBlocks, context);
    updateSpareWatermark();
    setStatus(`Block: ${formatBlockLabel(context.dayOfWeek, context.period)} | ${context.source}`);
    await logBlockChange(state.lastBlockKey, currentKey, context).catch(() => undefined);
    state.lastBlockKey = currentKey;
    ensureRefreshTimer();
  } catch (error) {
    setStatus(`Error: ${error?.message || "Unable to load schedule."}`);
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

  updateFullscreenButtonText();

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
  window.addEventListener("resize", updateSpareWatermark);
}

init().catch((error) => {
  setStatus(`Initialization error: ${error?.message || "Unknown error"}`);
});
