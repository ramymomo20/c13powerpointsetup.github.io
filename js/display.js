import { isSupabaseConfigured, supabase } from "./supabaseClient.js?v=20260313a";
import { DEFAULT_ROOM_NAMES, DEFAULT_SETTINGS } from "./utils/constants.js";
import { clearChildren, setVisible } from "./utils/dom.js";
import { blockKey, formatBlockLabel, settingsRowsToObject, sortScheduleItems } from "./utils/schedule.js";
import { resolveDisplayContext } from "./utils/time.js";

const refs = {
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  title: document.getElementById("displayTitle"),
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
  refreshAlignmentTimer: null,
  isLoading: false
};

function normalizeRoomName(value) {
  return String(value || "").trim().toUpperCase().replace(/^ROOM\s+/i, "");
}

const DEFAULT_ROOM_CODES = new Set(DEFAULT_ROOM_NAMES.map((name) => normalizeRoomName(name)));
const ROOM_LABEL_BY_CODE = new Map(DEFAULT_ROOM_NAMES.map((label) => [normalizeRoomName(label), label]));

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

async function fetchBlock(dayOfWeek) {
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
        event_title,
        notes,
        sort_order,
        is_visible
      )
    `)
    .eq("day_of_week", dayOfWeek)
    .eq("is_active", true)
    .in("period", ["morning", "evening"]);

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const blockMap = { morning: null, evening: null };
  for (const row of data || []) {
    if (row.period === "morning" || row.period === "evening") {
      blockMap[row.period] = row;
    }
  }
  return blockMap;
}

function getItemTimeText(item) {
  const start = String(item.start_time_text || "").trim();
  return start || "";
}

function parseStartTimeToMinutes(timeText) {
  const raw = String(timeText || "").trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const ampm = (match[3] || "").toUpperCase();

  if (ampm) {
    if (hour === 12 && ampm === "AM") {
      hour = 0;
    } else if (hour !== 12 && ampm === "PM") {
      hour += 12;
    }
  } else if (hour > 23) {
    return null;
  }

  return hour * 60 + minute;
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

  const byTime = new Map();
  for (const item of items) {
    const roomCode = normalizeRoomName(item.room_name);
    if (!DEFAULT_ROOM_CODES.has(roomCode)) {
      continue;
    }

    const label = getItemTimeText(item) || "Time TBD";
    const minutes = parseStartTimeToMinutes(label);
    const key = minutes === null ? `tbd:${label}` : `m:${minutes}`;
    if (!byTime.has(key)) {
      byTime.set(key, { label, minutes, cellMap: new Map() });
    }

    const row = byTime.get(key);
    const existing = row.cellMap.get(roomCode) || [];
    existing.push(item);
    row.cellMap.set(roomCode, existing);
  }

  const rows = [...byTime.values()].sort((a, b) => {
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
    timeCell.innerHTML = `<span class="time-text">${row.label}</span>${passed ? `<span class="time-check">✓</span>` : ""}`;
    grid.append(timeCell);

    for (const [roomCode] of ROOM_LABEL_BY_CODE) {
      const cell = document.createElement("div");
      cell.className = "event-cell";
      const events = row.cellMap.get(roomCode) || [];

      for (const eventItem of events) {
        const entry = document.createElement("div");
        entry.className = "event-entry";
        const title = document.createElement("span");
        title.className = "entry-title";
        title.textContent = eventItem.event_title || "";
        entry.append(title);

        if (eventItem.notes) {
          const notes = document.createElement("span");
          notes.className = "entry-notes";
          notes.textContent = ` - ${eventItem.notes}`;
          entry.append(notes);
        }

        cell.append(entry);
      }

      grid.append(cell);
    }
  }

  section.append(grid);
  return section;
}

function renderSchedule(dayBlocks, context) {
  const activeBlock = dayBlocks?.[context.period];
  refs.title.textContent = activeBlock?.title || state.settings.display_title || "Today's Events";
  refs.date.textContent = context.formattedDate;
  refs.time.textContent = context.formattedTime;
  setModeBadge(context.mode);

  const morningItems = sortScheduleItems(dayBlocks?.morning?.schedule_items || []);
  const eveningItems = sortScheduleItems(dayBlocks?.evening?.schedule_items || []);
  clearChildren(refs.eventsContainer);
  setVisible(refs.emptyState, false);
  refs.eventsContainer.append(
    renderPeriodGrid("morning", morningItems, context),
    renderPeriodGrid("evening", eveningItems, context)
  );
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
    const dayBlocks = await fetchBlock(context.dayOfWeek);
    const currentKey = blockKey(context.dayOfWeek, context.period);

    renderSchedule(dayBlocks, context);
    refs.activeBlockText.textContent = `Block: ${formatBlockLabel(context.dayOfWeek, context.period)}`;
    refs.lastRefreshText.textContent = `Refresh: ${new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date())}`;
    setStatus(`Source: ${context.source} (${context.timezone})`);

    await logBlockChange(state.lastBlockKey, currentKey, context).catch(() => undefined);
    state.lastBlockKey = currentKey;

    ensureRefreshTimer();
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
