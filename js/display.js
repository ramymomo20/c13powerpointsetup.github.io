import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import { DEFAULT_SETTINGS } from "./utils/constants.js";
import { clearChildren, setVisible } from "./utils/dom.js";
import { blockKey, formatBlockLabel, settingsRowsToObject, sortScheduleItems } from "./utils/schedule.js";
import { resolveDisplayContext } from "./utils/time.js";

const refs = {
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
  refreshSeconds: null,
  isLoading: false
};

function setStatus(text) {
  refs.statusText.textContent = text;
}

function setModeBadge(mode) {
  refs.modeBadge.textContent = mode === "test" ? "TEST MODE" : "LIVE";
  refs.modeBadge.classList.toggle("mode-test", mode === "test");
  refs.modeBadge.classList.toggle("mode-live", mode !== "test");
}

function showConfigError() {
  setStatus("Supabase is not configured. Update js/config.js with your project URL and anon key.");
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
        building_name,
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

function renderEventItem(item) {
  const article = document.createElement("article");
  article.className = "event-card";

  const room = document.createElement("div");
  room.className = "event-room";
  room.textContent = item.room_name || "Room TBD";

  const time = document.createElement("div");
  time.className = "event-time";
  const start = item.start_time_text?.trim();
  const end = item.end_time_text?.trim();
  time.textContent = start && end ? `${start} - ${end}` : start || end || "Time TBD";

  const title = document.createElement("div");
  title.className = "event-title";
  title.textContent = item.event_title || "Meeting";

  const building = document.createElement("div");
  building.className = "event-building";
  building.textContent = item.building_name || "";

  article.append(room, time, title, building);

  if (item.notes) {
    const notes = document.createElement("div");
    notes.className = "event-notes";
    notes.textContent = item.notes;
    article.append(notes);
  }

  return article;
}

function renderSchedule(block, context) {
  refs.title.textContent = block?.title || state.settings.display_title || "Today's Events";
  refs.date.textContent = context.formattedDate;
  refs.time.textContent = context.formattedTime;
  setModeBadge(context.mode);

  const items = sortScheduleItems(block?.schedule_items || []);
  clearChildren(refs.eventsContainer);

  if (!items.length) {
    setVisible(refs.emptyState, true);
  } else {
    setVisible(refs.emptyState, false);
    for (const item of items) {
      refs.eventsContainer.append(renderEventItem(item));
    }
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
