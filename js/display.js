import { isSupabaseConfigured, supabase } from "./supabaseClient.js?v=20260313f";
import { DEFAULT_ROOM_NAMES, DEFAULT_SETTINGS } from "./utils/constants.js";
import { clearChildren, setVisible } from "./utils/dom.js";
import { blockKey, formatBlockLabel, settingsRowsToObject, sortScheduleItems } from "./utils/schedule.js";
import { getRepresentedWeekDates, resolveDisplayContext } from "./utils/time.js";

const refs = {
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  viewToggleBtn: document.getElementById("viewToggleBtn"),
  title: document.getElementById("displayTitle"),
  viewDescription: document.getElementById("viewDescription"),
  date: document.getElementById("displayDate"),
  time: document.getElementById("displayTime"),
  modeBadge: document.getElementById("modeBadge"),
  eventsContainer: document.getElementById("eventsContainer"),
  emptyState: document.getElementById("emptyState"),
  statusText: document.getElementById("statusText"),
  shell: document.querySelector(".display-shell")
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  lastBlockKey: null,
  refreshTimer: null,
  refreshAlignmentTimer: null,
  isLoading: false,
  viewMode: "daily"
};

function normalizeRoomName(value) {
  return String(value || "").trim().toUpperCase().replace(/^ROOM\s+/i, "");
}

const DEFAULT_ROOM_CODES = new Set(DEFAULT_ROOM_NAMES.map((name) => normalizeRoomName(name)));
const ROOM_LABEL_BY_CODE = new Map(DEFAULT_ROOM_NAMES.map((label) => [normalizeRoomName(label), label]));
const spareWatermark = document.createElement("div");
spareWatermark.className = "spare-watermark hidden";
spareWatermark.setAttribute("aria-hidden", "true");

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

function toMinutesForSort(value) {
  const normalized = normalizeTimeLabel(value);
  const match = normalized.match(/^(\d{1,2}):(\d{2})\s([AP]M)$/);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const ampm = match[3];
  if (hour === 12 && ampm === "AM") {
    hour = 0;
  } else if (hour !== 12 && ampm === "PM") {
    hour += 12;
  }
  return hour * 60 + minute;
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

function hasTimePassed(period, timeMinutes, context) {
  if (timeMinutes === null) {
    return false;
  }
  if (period === "morning") {
    if (context.period === "morning") {
      return context.currentMinutes >= timeMinutes;
    }
    return context.period === "evening";
  }
  if (context.period !== "evening") {
    return false;
  }
  if (context.currentMinutes < context.morningMinutes) {
    return true;
  }
  return context.currentMinutes >= timeMinutes;
}

function buildTimeRows(items) {
  const byTime = new Map();
  for (const item of items) {
    const roomCode = normalizeRoomName(item.room_name);
    if (!DEFAULT_ROOM_CODES.has(roomCode)) {
      continue;
    }
    const label = normalizeTimeLabel(item.start_time_text) || "Time TBD";
    const minutes = toMinutesForSort(label);
    const key = minutes === null ? `tbd:${label}` : `m:${minutes}`;
    if (!byTime.has(key)) {
      byTime.set(key, { label, minutes, cellMap: new Map() });
    }
    const row = byTime.get(key);
    const existing = row.cellMap.get(roomCode) || [];
    existing.push(item);
    row.cellMap.set(roomCode, existing);
  }

  return [...byTime.values()].sort((a, b) => {
    if (a.minutes === null && b.minutes === null) {
      return a.label.localeCompare(b.label);
    }
    if (a.minutes === null) {
      return 1;
    }
    if (b.minutes === null) {
      return -1;
    }
    return a.minutes - b.minutes;
  });
}

function buildEventTile(eventItem, compact = false) {
  const tile = document.createElement("div");
  tile.className = compact ? "event-tile compact" : "event-tile";
  const colorClasses = ["chip-blue", "chip-green", "chip-gold", "chip-orange"];
  const hashSource = `${eventItem.event_title || ""}|${eventItem.start_time_text || ""}|${eventItem.room_name || ""}`;
  let hash = 0;
  for (let i = 0; i < hashSource.length; i += 1) {
    hash = (hash * 31 + hashSource.charCodeAt(i)) >>> 0;
  }
  tile.classList.add(colorClasses[hash % colorClasses.length]);

  const title = document.createElement("div");
  title.className = "event-name";
  title.textContent = eventItem.event_title || "No meeting scheduled";
  tile.append(title);

  const time = normalizeTimeLabel(eventItem.start_time_text);
  if (time) {
    const timeText = document.createElement("div");
    timeText.className = "event-time";
    timeText.textContent = time;
    tile.append(timeText);
  }

  if (eventItem.notes) {
    const notes = document.createElement("div");
    notes.className = "event-note";
    notes.textContent = eventItem.notes;
    tile.append(notes);
  }

  return tile;
}

function renderPeriodGrid(period, items, context) {
  const section = document.createElement("section");
  section.className = "period-section";

  const heading = document.createElement("h2");
  heading.className = "period-title";
  heading.textContent = period === "morning" ? "Morning Schedule" : "Evening Schedule";
  section.append(heading);

  const grid = document.createElement("div");
  grid.className = "period-grid";

  const timeHead = document.createElement("div");
  timeHead.className = "grid-head time-head";
  timeHead.textContent = "Time";
  grid.append(timeHead);

  for (const roomName of DEFAULT_ROOM_NAMES) {
    const roomHead = document.createElement("div");
    roomHead.className = "grid-head room-head";
    roomHead.textContent = roomName;
    grid.append(roomHead);
  }

  const rows = buildTimeRows(items);
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "period-empty";
    empty.textContent = "No meetings scheduled.";
    grid.append(empty);
    section.append(grid);
    return section;
  }

  for (const row of rows) {
    const timeCell = document.createElement("div");
    timeCell.className = "time-cell";
    const passed = hasTimePassed(period, row.minutes, context);
    timeCell.innerHTML = `<span class="time-text">${row.label}</span>${passed ? '<span class="time-check">&#10003;</span>' : ""}`;
    grid.append(timeCell);

    for (const [roomCode] of ROOM_LABEL_BY_CODE) {
      const cell = document.createElement("div");
      cell.className = "event-cell";
      const events = row.cellMap.get(roomCode) || [];
      for (const eventItem of events) {
        cell.append(buildEventTile(eventItem, true));
      }
      grid.append(cell);
    }
  }

  section.append(grid);
  return section;
}

function getDayRoomItems(weekBlocks, dayOfWeek, roomCode) {
  const dayBlocks = weekBlocks?.[dayOfWeek] || { morning: null, evening: null };
  const morningItems = sortScheduleItems(dayBlocks.morning?.schedule_items || []).map((item) => ({
    ...item,
    period: "morning"
  }));
  const eveningItems = sortScheduleItems(dayBlocks.evening?.schedule_items || []).map((item) => ({
    ...item,
    period: "evening"
  }));
  const allItems = [...morningItems, ...eveningItems].filter((item) => normalizeRoomName(item.room_name) === roomCode);

  return allItems.sort((a, b) => {
    const periodOrder = { morning: 0, evening: 1 };
    const periodDelta = (periodOrder[a.period] ?? 99) - (periodOrder[b.period] ?? 99);
    if (periodDelta !== 0) {
      return periodDelta;
    }
    const left = toMinutesForSort(a.start_time_text);
    const right = toMinutesForSort(b.start_time_text);
    if (left === null && right === null) {
      return (a.event_title || "").localeCompare(b.event_title || "");
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return left - right;
  });
}

function getVisibleWeeklyRooms(weekBlocks) {
  const visibleRooms = DEFAULT_ROOM_NAMES.filter((roomName) => {
    const roomCode = normalizeRoomName(roomName);
    return Array.from({ length: 7 }, (_, dayIndex) => getDayRoomItems(weekBlocks, dayIndex, roomCode)).some((items) => items.length);
  });

  return visibleRooms.length ? visibleRooms : DEFAULT_ROOM_NAMES;
}

function renderWeeklyGrid(weekBlocks, context) {
  const section = document.createElement("section");
  section.className = "period-section weekly-section";

  const heading = document.createElement("h2");
  heading.className = "period-title";
  heading.textContent = "Weekly Room Calendar";
  section.append(heading);

  const weekDays = getRepresentedWeekDates(state.settings, context.effectiveDate);
  const boardWrap = document.createElement("div");
  boardWrap.className = "weekly-board-wrap";

  const board = document.createElement("div");
  board.className = "weekly-board";

  const corner = document.createElement("div");
  corner.className = "weekly-corner";
  corner.textContent = "Room";
  board.append(corner);

  for (const day of weekDays) {
    const dayHead = document.createElement("div");
    dayHead.className = "weekly-day-head";
    dayHead.innerHTML = `<span class="day-name">${day.weekdayLong}</span><span class="day-date">${day.monthDay}</span>`;
    board.append(dayHead);
  }

  getVisibleWeeklyRooms(weekBlocks).forEach((roomName, roomIndex) => {
    const roomCode = normalizeRoomName(roomName);
    const roomCell = document.createElement("div");
    roomCell.className = "weekly-room-label";
    roomCell.textContent = roomName;
    board.append(roomCell);

    for (const day of weekDays) {
      const cell = document.createElement("div");
      cell.className = "weekly-day-cell";
      cell.dataset.dayIndex = String(day.dayOfWeek);
      cell.dataset.roomIndex = String(roomIndex);
      const events = getDayRoomItems(weekBlocks, day.dayOfWeek, roomCode);

      for (const eventItem of events) {
        const card = buildEventTile(eventItem);
        card.classList.add("weekly-event-tile");

        const periodTag = document.createElement("div");
        periodTag.className = "weekly-period-tag";
        periodTag.textContent = eventItem.period === "evening" ? "Evening" : "Morning";
        card.append(periodTag);
        cell.append(card);
      }

      if (!events.length) {
        const empty = document.createElement("div");
        empty.className = "weekly-empty-cell";
        empty.setAttribute("aria-hidden", "true");
        cell.append(empty);
      }

      board.append(cell);
    }
  });

  boardWrap.append(board);
  section.append(boardWrap);
  return section;
}

function appendWatermarkCard() {
  refs.eventsContainer.append(spareWatermark);
}

function renderDaily(weekBlocks, context) {
  const weekDays = getRepresentedWeekDates(state.settings, context.effectiveDate);
  const dayBlocks = weekBlocks?.[context.dayOfWeek] || { morning: null, evening: null };
  const activeBlock = dayBlocks[context.period];
  refs.title.textContent = activeBlock?.title || state.settings.display_title || "Today's Events";
  refs.viewDescription.textContent = `Daily room schedule for the represented week ${weekDays[0].monthDay} through ${weekDays[6].monthDay}.`;

  const morningItems = sortScheduleItems(dayBlocks.morning?.schedule_items || []);
  const eveningItems = sortScheduleItems(dayBlocks.evening?.schedule_items || []);
  clearChildren(refs.eventsContainer);
  refs.eventsContainer.append(
    renderPeriodGrid("morning", morningItems, context),
    renderPeriodGrid("evening", eveningItems, context)
  );
  appendWatermarkCard();
}

function renderWeekly(weekBlocks, context) {
  const weekDays = getRepresentedWeekDates(state.settings, context.effectiveDate);
  refs.title.textContent = "Weekly Events";
  refs.viewDescription.textContent = `Room calendar for ${weekDays[0].monthDay} through ${weekDays[6].monthDay}.`;
  clearChildren(refs.eventsContainer);
  refs.eventsContainer.append(renderWeeklyGrid(weekBlocks, context));
  appendWatermarkCard();
}

function renderDisplay(weekBlocks, context) {
  refs.date.textContent = context.formattedDate;
  refs.time.textContent = context.formattedTime;
  setModeBadge(context.mode);
  setVisible(refs.emptyState, false);

  if (state.viewMode === "weekly") {
    renderWeekly(weekBlocks, context);
  } else {
    renderDaily(weekBlocks, context);
  }
}

function updateViewToggleLabel() {
  const isWeekly = state.viewMode === "weekly";
  refs.viewToggleBtn.textContent = isWeekly ? "Switch To Daily View" : "Switch To Weekly View";
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

    const height = Math.max(110, Math.min(260, Math.floor(spareHeight - 28)));
    spareWatermark.style.setProperty("--watermark-height", `${height}px`);
  });
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
    const settings = await fetchSettings();
    state.settings = settings;
    const context = resolveDisplayContext(settings, new Date());
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

  refs.viewToggleBtn.addEventListener("click", () => {
    state.viewMode = state.viewMode === "weekly" ? "daily" : "weekly";
    updateViewToggleLabel();
    runRefreshCycle().catch(() => undefined);
  });

  document.addEventListener("fullscreenchange", updateFullscreenButtonText);
  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "f") {
      toggleFullscreen().catch(() => undefined);
    }
  });

  updateViewToggleLabel();
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
