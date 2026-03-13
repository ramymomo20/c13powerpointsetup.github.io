import { getSession, isAllowedEditorEmail, onAuthStateChange, signIn, signOut } from "./auth.js?v=20260313e";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js?v=20260313e";
import { DAYS, DEFAULT_ROOM_NAMES, DEFAULT_SETTINGS, PERIODS } from "./utils/constants.js";
import { clearChildren, setMessage, setVisible } from "./utils/dom.js";
import { formatBlockLabel, settingsRowsToObject, sortScheduleItems, toAppSettingRows } from "./utils/schedule.js";
import {
  fromDatetimeLocalToIso,
  getRepresentedWeekDates,
  getRepresentedWeekStartYmd,
  parseYmdToUtcDate,
  resolveDisplayContext,
  toDatetimeLocalValue
} from "./utils/time.js";

const refs = {
  globalMessage: document.getElementById("globalMessage"),
  loginCard: document.getElementById("loginCard"),
  unauthorizedCard: document.getElementById("unauthorizedCard"),
  appShell: document.getElementById("appShell"),
  signedInAs: document.getElementById("signedInAs"),
  signOutBtn: document.getElementById("signOutBtn"),
  loginForm: document.getElementById("loginForm"),
  emailInput: document.getElementById("emailInput"),
  passwordInput: document.getElementById("passwordInput"),
  prevWeekBtn: document.getElementById("prevWeekBtn"),
  currentWeekBtn: document.getElementById("currentWeekBtn"),
  nextWeekBtn: document.getElementById("nextWeekBtn"),
  weekRangeLabel: document.getElementById("weekRangeLabel"),
  daySelect: document.getElementById("daySelect"),
  periodSelect: document.getElementById("periodSelect"),
  blockTitleInput: document.getElementById("blockTitleInput"),
  itemsBody: document.getElementById("itemsBody"),
  saveBlockBtn: document.getElementById("saveBlockBtn"),
  clearBlockBtn: document.getElementById("clearBlockBtn"),
  previewContainer: document.getElementById("previewContainer"),
  previewLabel: document.getElementById("previewLabel"),
  reloadBlockBtn: document.getElementById("reloadBlockBtn"),
  modeSummary: document.getElementById("modeSummary"),
  testModeEnabled: document.getElementById("testModeEnabled"),
  testTimestampInput: document.getElementById("testTimestampInput"),
  testOverrideDaySelect: document.getElementById("testOverrideDaySelect"),
  testOverridePeriodSelect: document.getElementById("testOverridePeriodSelect"),
  testMorningSwitchInput: document.getElementById("testMorningSwitchInput"),
  testEveningSwitchInput: document.getElementById("testEveningSwitchInput"),
  morningSwitchInput: document.getElementById("morningSwitchInput"),
  eveningSwitchInput: document.getElementById("eveningSwitchInput"),
  displayTitleInput: document.getElementById("displayTitleInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  toggleTestToolsBtn: document.getElementById("toggleTestToolsBtn"),
  testToolsPanel: document.getElementById("testToolsPanel"),
  toggleLogsBtn: document.getElementById("toggleLogsBtn"),
  logsPanel: document.getElementById("logsPanel"),
  refreshLogsBtn: document.getElementById("refreshLogsBtn"),
  eventLogList: document.getElementById("eventLogList"),
  resetWeekBtn: document.getElementById("resetWeekBtn")
};

const state = {
  user: null,
  settings: { ...DEFAULT_SETTINGS },
  currentBlockId: null,
  modeSummaryTimer: null
};

function showMessage(text, kind = "info") {
  setMessage(refs.globalMessage, text, kind);
}

function normalizeRoomName(value) {
  return String(value || "").trim().toUpperCase().replace(/^ROOM\s*/i, "");
}

function buildTextInput(value = "", placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function normalizeTimeInput(value) {
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

  const outMeridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${outMeridiem}`;
}

const DEFAULT_ROOM_CODES = new Set(DEFAULT_ROOM_NAMES.map((name) => normalizeRoomName(name)));

function getWeekDates() {
  return getRepresentedWeekDates(state.settings, new Date());
}

function getDayLabel(dayValue) {
  const entry = getWeekDates().find((day) => day.dayOfWeek === Number(dayValue));
  return entry ? `${entry.weekdayLong} (${entry.shortDate})` : DAYS.find((day) => day.value === Number(dayValue))?.label || "Day";
}

function renderWeekRangeLabel() {
  const weekDates = getWeekDates();
  const start = weekDates[0];
  const end = weekDates[6];
  refs.weekRangeLabel.textContent = `${start.weekdayLong}, ${start.shortDate} - ${end.weekdayLong}, ${end.shortDate}`;
}

function populateSelects() {
  const currentDayValue = refs.daySelect.value || String(DAYS[0].value);
  const currentTestDayValue = refs.testOverrideDaySelect.value || "";
  const weekDates = getWeekDates();

  refs.daySelect.innerHTML = weekDates
    .map((day) => `<option value="${day.dayOfWeek}">${day.weekdayLong} (${day.shortDate})</option>`)
    .join("");

  refs.periodSelect.innerHTML = PERIODS.map((period) => `<option value="${period.value}">${period.label}</option>`).join("");

  refs.testOverrideDaySelect.innerHTML = [
    `<option value="">(Clock-driven)</option>`,
    ...weekDates.map((day) => `<option value="${day.dayOfWeek}">${day.weekdayLong} (${day.shortDate})</option>`)
  ].join("");

  refs.testOverridePeriodSelect.innerHTML = [
    `<option value="">(Clock-driven)</option>`,
    ...PERIODS.map((period) => `<option value="${period.value}">${period.label}</option>`)
  ].join("");

  refs.daySelect.value = DAYS.some((day) => String(day.value) === currentDayValue) ? currentDayValue : String(DAYS[0].value);
  refs.testOverrideDaySelect.value = currentTestDayValue;
  renderWeekRangeLabel();
}

function setEditorVisible(visible) {
  setVisible(refs.appShell, visible);
  setVisible(refs.signOutBtn, visible);
  setVisible(refs.signedInAs, visible);
}

function addItemRow(item = {}) {
  const tr = document.createElement("tr");
  const roomName = item.room_name || "Room";
  tr.dataset.roomName = roomName;

  const room = document.createElement("div");
  room.className = "room-fixed";
  room.textContent = roomName;
  const startTime = buildTextInput(item.start_time_text || "", "9:00 AM");
  const eventTitle = buildTextInput(item.event_title || "", "Meeting");
  const notes = buildTextInput(item.notes || "", "Optional notes");
  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = item.is_visible !== false;

  startTime.dataset.field = "start_time_text";
  eventTitle.dataset.field = "event_title";
  notes.dataset.field = "notes";
  visible.dataset.field = "is_visible";

  const cells = [room, startTime, eventTitle, notes, visible];
  for (const fieldElement of cells) {
    const td = document.createElement("td");
    td.append(fieldElement);
    tr.append(td);
  }

  refs.itemsBody.append(tr);
}

function collectItemRows() {
  const rows = [...refs.itemsBody.querySelectorAll("tr")];
  return rows
    .map((row, index) => {
      const roomName = row.dataset.roomName || "Room";
      const startTextRaw = row.querySelector('[data-field="start_time_text"]')?.value.trim() || "";
      const startText = normalizeTimeInput(startTextRaw);
      const eventTitle = row.querySelector('[data-field="event_title"]')?.value.trim() || "";
      const notes = row.querySelector('[data-field="notes"]')?.value.trim() || "";
      const isVisible = row.querySelector('[data-field="is_visible"]')?.checked ?? true;
      const hasContent = startText || eventTitle || notes;
      const include = Boolean(hasContent || (roomName && !DEFAULT_ROOM_CODES.has(normalizeRoomName(roomName))));

      return {
        include,
        room_name: roomName || "Room TBD",
        start_time_text: startText || null,
        end_time_text: null,
        event_title: eventTitle || "Open",
        building_name: null,
        notes: notes || null,
        sort_order: index,
        is_visible: isVisible
      };
    })
    .filter((row) => row.include)
    .map(({ include, ...item }) => item);
}

function setLoadingButtons(disabled) {
  const buttons = [
    refs.prevWeekBtn,
    refs.currentWeekBtn,
    refs.nextWeekBtn,
    refs.saveBlockBtn,
    refs.clearBlockBtn,
    refs.reloadBlockBtn,
    refs.saveSettingsBtn,
    refs.toggleTestToolsBtn,
    refs.toggleLogsBtn,
    refs.refreshLogsBtn,
    refs.resetWeekBtn
  ];

  for (const button of buttons) {
    if (button) {
      button.disabled = disabled;
    }
  }
}

function setButtonWorking(button, workingLabel) {
  if (!button) {
    return;
  }
  if (!button.dataset.originalLabel) {
    button.dataset.originalLabel = button.textContent;
  }
  button.classList.remove("btn-confirmed");
  button.classList.add("btn-working");
  button.textContent = workingLabel;
}

function setButtonConfirmed(button, confirmedLabel) {
  if (!button) {
    return;
  }
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.classList.remove("btn-working");
  button.classList.add("btn-confirmed");
  button.textContent = confirmedLabel;
  window.setTimeout(() => {
    button.classList.remove("btn-confirmed");
    button.textContent = originalLabel;
  }, 850);
}

function resetButtonState(button) {
  if (!button) {
    return;
  }
  button.classList.remove("btn-working");
  button.classList.remove("btn-confirmed");
  if (button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
}

async function fetchSettings() {
  const { data, error } = await supabase.from("app_settings").select("key,value");
  if (error) {
    throw error;
  }
  state.settings = settingsRowsToObject(data || []);
  if (!state.settings.display_week_start_date) {
    state.settings.display_week_start_date = getRepresentedWeekStartYmd(state.settings, new Date());
  }
}

function renderSettingsForm() {
  refs.testModeEnabled.checked = Boolean(state.settings.test_mode_enabled);
  refs.testTimestampInput.value = toDatetimeLocalValue(state.settings.test_effective_timestamp);
  refs.testOverrideDaySelect.value =
    state.settings.test_override_day_of_week === null || state.settings.test_override_day_of_week === ""
      ? ""
      : String(state.settings.test_override_day_of_week);
  refs.testOverridePeriodSelect.value = state.settings.test_override_period || "";
  refs.testMorningSwitchInput.value = state.settings.test_morning_switch_time || "";
  refs.testEveningSwitchInput.value = state.settings.test_evening_switch_time || "";
  refs.morningSwitchInput.value = state.settings.morning_switch_time || "05:00";
  refs.eveningSwitchInput.value = state.settings.evening_switch_time || "17:00";
  refs.displayTitleInput.value = state.settings.display_title || "Today's Events";
  populateSelects();
}

function readSettingsForm() {
  const testOverrideDayRaw = refs.testOverrideDaySelect.value;
  const testOverrideDay = testOverrideDayRaw === "" ? "" : Number(testOverrideDayRaw);
  const testOverridePeriod = refs.testOverridePeriodSelect.value || "";

  return {
    ...state.settings,
    display_timezone: "America/New_York",
    morning_switch_time: refs.morningSwitchInput.value || "05:00",
    evening_switch_time: refs.eveningSwitchInput.value || "17:00",
    display_refresh_seconds: state.settings.display_refresh_seconds || 60,
    display_title: refs.displayTitleInput.value.trim() || "Today's Events",
    display_week_start_date: state.settings.display_week_start_date || getRepresentedWeekStartYmd(state.settings, new Date()),
    test_mode_enabled: refs.testModeEnabled.checked,
    test_effective_timestamp: fromDatetimeLocalToIso(refs.testTimestampInput.value),
    test_override_day_of_week: Number.isInteger(testOverrideDay) ? testOverrideDay : "",
    test_override_period:
      testOverridePeriod === "morning" || testOverridePeriod === "evening" ? testOverridePeriod : "",
    test_morning_switch_time: refs.testMorningSwitchInput.value || "",
    test_evening_switch_time: refs.testEveningSwitchInput.value || ""
  };
}

function renderModeSummary() {
  const context = resolveDisplayContext(state.settings, new Date());
  const label = formatBlockLabel(context.dayOfWeek, context.period);
  refs.modeSummary.textContent =
    `Mode: ${context.mode.toUpperCase()} | Source: ${context.source} | ` +
    `Block: ${label} | Effective Time: ${context.formattedDate} ${context.formattedTime} (${context.timezone})`;
}

async function fetchBlock(dayOfWeek, period) {
  const { data, error } = await supabase
    .from("schedule_blocks")
    .select(`
      id,
      title,
      day_of_week,
      period,
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
    .eq("period", period)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

function renderEditorBlock(block) {
  state.currentBlockId = block?.id ?? null;
  refs.blockTitleInput.value = block?.title || state.settings.display_title || "Today's Events";
  clearChildren(refs.itemsBody);

  const items = [...(block?.schedule_items || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const itemByRoomCode = new Map();
  for (const item of items) {
    const code = normalizeRoomName(item.room_name);
    if (DEFAULT_ROOM_CODES.has(code) && !itemByRoomCode.has(code)) {
      itemByRoomCode.set(code, item);
    }
  }

  for (const roomName of DEFAULT_ROOM_NAMES) {
    const roomItem = itemByRoomCode.get(normalizeRoomName(roomName));
    addItemRow({
      room_name: roomName,
      start_time_text: roomItem?.start_time_text || "",
      event_title: roomItem?.event_title || "",
      notes: roomItem?.notes || "",
      is_visible: roomItem ? roomItem.is_visible !== false : true
    });
  }
}

async function loadSelectedBlock() {
  const dayOfWeek = Number(refs.daySelect.value);
  const period = refs.periodSelect.value;
  const block = await fetchBlock(dayOfWeek, period);
  renderEditorBlock(block);
}

function renderPreview(block, dayOfWeek, period) {
  clearChildren(refs.previewContainer);
  refs.previewLabel.textContent = `Preview: ${getDayLabel(dayOfWeek)} ${period === "morning" ? "Morning" : "Evening"}`;
  const items = sortScheduleItems(block?.schedule_items || []);

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No visible meetings for this block.";
    refs.previewContainer.append(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "preview-item";
    card.innerHTML = `
      <div class="preview-room">${item.room_name || "Room TBD"}</div>
      <div class="preview-title">${item.event_title || "Meeting"}</div>
      <div>${item.start_time_text || ""}</div>
      <div class="muted">${item.notes || ""}</div>
    `;
    refs.previewContainer.append(card);
  }
}

async function previewSelectedBlock() {
  const dayOfWeek = Number(refs.daySelect.value);
  const period = refs.periodSelect.value;
  const block = await fetchBlock(dayOfWeek, period);
  renderPreview(block, dayOfWeek, period);
}

async function writeEventLog(eventType, payload = {}) {
  await supabase.from("event_log").insert({
    event_type: eventType,
    event_source: "admin_page",
    actor_user_id: state.user?.id ?? null,
    actor_email: state.user?.email ?? null,
    payload
  });
}

async function saveSelectedBlock() {
  const dayOfWeek = Number(refs.daySelect.value);
  const period = refs.periodSelect.value;
  const title = refs.blockTitleInput.value.trim() || state.settings.display_title || "Today's Events";

  const { data: upserted, error: blockError } = await supabase
    .from("schedule_blocks")
    .upsert(
      {
        day_of_week: dayOfWeek,
        period,
        title,
        is_active: true,
        updated_by: state.user.id,
        updated_by_email: state.user.email
      },
      { onConflict: "day_of_week,period" }
    )
    .select("id")
    .single();

  if (blockError) {
    throw blockError;
  }

  const blockId = upserted.id;
  state.currentBlockId = blockId;

  const { error: deleteError } = await supabase.from("schedule_items").delete().eq("schedule_block_id", blockId);
  if (deleteError) {
    throw deleteError;
  }

  const itemRows = collectItemRows().map((item) => ({
    ...item,
    schedule_block_id: blockId
  }));

  if (itemRows.length) {
    const { error: insertError } = await supabase.from("schedule_items").insert(itemRows);
    if (insertError) {
      throw insertError;
    }
  }

  await writeEventLog("schedule_updated", {
    day_of_week: dayOfWeek,
    period,
    item_count: itemRows.length,
    display_week_start_date: state.settings.display_week_start_date
  }).catch(() => undefined);
}

async function clearSelectedBlock() {
  if (!window.confirm(`Clear all room entries for ${getDayLabel(refs.daySelect.value)} ${refs.periodSelect.value}?`)) {
    return;
  }

  refs.blockTitleInput.value = state.settings.display_title || "Today's Events";
  clearChildren(refs.itemsBody);
  for (const roomName of DEFAULT_ROOM_NAMES) {
    addItemRow({ room_name: roomName, is_visible: true });
  }

  await saveSelectedBlock();
  await previewSelectedBlock();
  showMessage("Block cleared.", "info");
}

async function saveSettings() {
  const nextSettings = readSettingsForm();
  const rows = toAppSettingRows(nextSettings, state.user);
  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) {
    throw error;
  }

  state.settings = nextSettings;
  renderSettingsForm();
  renderModeSummary();
  await writeEventLog("schedule_updated", {
    settings_changed: true,
    mode: nextSettings.test_mode_enabled ? "test" : "live",
    display_week_start_date: nextSettings.display_week_start_date
  }).catch(() => undefined);
}

async function persistWeekStartDate(nextWeekStartDate) {
  state.settings.display_week_start_date = nextWeekStartDate;
  const { error } = await supabase.from("app_settings").upsert(
    {
      key: "display_week_start_date",
      value: nextWeekStartDate,
      updated_by: state.user?.id ?? null,
      updated_by_email: state.user?.email ?? null
    },
    { onConflict: "key" }
  );

  if (error) {
    throw error;
  }

  populateSelects();
  await previewSelectedBlock();
  await writeEventLog("schedule_updated", {
    display_week_start_date: nextWeekStartDate,
    week_navigation: true
  }).catch(() => undefined);
}

async function shiftDisplayedWeek(offsetWeeks) {
  const currentStart = parseYmdToUtcDate(state.settings.display_week_start_date || getRepresentedWeekStartYmd(state.settings, new Date()));
  const nextStart = new Date(currentStart.getTime() + offsetWeeks * 7 * 24 * 60 * 60 * 1000);
  const nextYmd = nextStart.toISOString().slice(0, 10);
  await persistWeekStartDate(nextYmd);
}

async function jumpToCurrentWeek() {
  await persistWeekStartDate(getRepresentedWeekStartYmd(state.settings, new Date()));
}

async function refreshLogs() {
  const { data, error } = await supabase
    .from("event_log")
    .select("id,event_type,event_source,actor_email,created_at,payload")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    throw error;
  }

  clearChildren(refs.eventLogList);

  if (!data?.length) {
    const li = document.createElement("li");
    li.textContent = "No events logged yet.";
    refs.eventLogList.append(li);
    return;
  }

  for (const event of data) {
    const li = document.createElement("li");
    const timestamp = new Date(event.created_at).toLocaleString();
    li.textContent = `${timestamp} | ${event.event_type} | ${event.event_source} | ${event.actor_email || "system"}`;
    refs.eventLogList.append(li);
  }
}

async function refreshLogsIfVisible() {
  if (refs.logsPanel.classList.contains("hidden")) {
    return;
  }
  await refreshLogs();
}

async function toggleLogsPanel() {
  const shouldShow = refs.logsPanel.classList.contains("hidden");
  setVisible(refs.logsPanel, shouldShow);
  refs.toggleLogsBtn.textContent = shouldShow ? "Hide Events" : "Show Events";
  if (shouldShow) {
    await refreshLogs();
  }
}

function toggleTestToolsPanel() {
  const shouldShow = refs.testToolsPanel.classList.contains("hidden");
  setVisible(refs.testToolsPanel, shouldShow);
  refs.toggleTestToolsBtn.textContent = shouldShow ? "Hide Test Tools" : "Show Test Tools";
}

async function resetWeek() {
  const confirmed = window.confirm("Reset all 14 blocks and remove all schedule rows?");
  if (!confirmed) {
    return;
  }

  const { error: deleteError } = await supabase.from("schedule_blocks").delete().gte("day_of_week", 0);
  if (deleteError) {
    throw deleteError;
  }

  const defaults = [];
  for (const day of DAYS) {
    for (const period of PERIODS) {
      defaults.push({
        day_of_week: day.value,
        period: period.value,
        title: state.settings.display_title || "Today's Events",
        is_active: true,
        updated_by: state.user.id,
        updated_by_email: state.user.email
      });
    }
  }

  const { error: insertError } = await supabase
    .from("schedule_blocks")
    .upsert(defaults, { onConflict: "day_of_week,period" });

  if (insertError) {
    throw insertError;
  }

  await writeEventLog("schedule_updated", { full_week_reset: true }).catch(() => undefined);
  await loadSelectedBlock();
  await previewSelectedBlock();
  await refreshLogsIfVisible();
}

async function bootstrapEditor() {
  await fetchSettings();
  renderSettingsForm();

  const context = resolveDisplayContext(state.settings, new Date());
  refs.daySelect.value = String(context.dayOfWeek);
  refs.periodSelect.value = context.period;

  await loadSelectedBlock();
  await previewSelectedBlock();
  setVisible(refs.testToolsPanel, false);
  refs.toggleTestToolsBtn.textContent = "Show Test Tools";
  setVisible(refs.logsPanel, false);
  refs.toggleLogsBtn.textContent = "Show Events";
  renderModeSummary();

  if (state.modeSummaryTimer) {
    clearInterval(state.modeSummaryTimer);
  }
  state.modeSummaryTimer = setInterval(() => renderModeSummary(), 30000);
}

async function handleSessionChange(session) {
  state.user = session?.user ?? null;
  const email = state.user?.email ?? "";

  if (!session) {
    setVisible(refs.loginCard, true);
    setVisible(refs.unauthorizedCard, false);
    setEditorVisible(false);
    showMessage("Sign in to manage the weekly schedule.", "info");
    return;
  }

  refs.signedInAs.textContent = email;
  if (!isAllowedEditorEmail(email)) {
    setVisible(refs.loginCard, false);
    setVisible(refs.unauthorizedCard, true);
    setEditorVisible(false);
    setVisible(refs.signOutBtn, true);
    setVisible(refs.signedInAs, true);
    showMessage("Signed in account is not authorized for editing.", "error");
    return;
  }

  setVisible(refs.loginCard, false);
  setVisible(refs.unauthorizedCard, false);
  setEditorVisible(true);
  showMessage("Authenticated. You can edit schedule blocks and test settings.", "success");
  await bootstrapEditor();
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = refs.emailInput.value.trim();
  const password = refs.passwordInput.value;

  if (!email || !password) {
    showMessage("Enter both email and password.", "error");
    return;
  }

  const { error } = await signIn(email, password);
  if (error) {
    showMessage(`Sign-in failed: ${error.message}`, "error");
    return;
  }

  refs.passwordInput.value = "";
}

function attachHandlers() {
  refs.loginForm.addEventListener("submit", (event) => {
    setLoadingButtons(true);
    handleLoginSubmit(event)
      .catch((error) => showMessage(`Login error: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.signOutBtn.addEventListener("click", async () => {
    await signOut();
  });

  refs.prevWeekBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    shiftDisplayedWeek(-1)
      .then(() => showMessage("Showing previous represented week.", "info"))
      .catch((error) => showMessage(`Week change failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.currentWeekBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    jumpToCurrentWeek()
      .then(() => showMessage("Returned to the current represented week.", "success"))
      .catch((error) => showMessage(`Week change failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.nextWeekBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    shiftDisplayedWeek(1)
      .then(() => showMessage("Showing next represented week.", "info"))
      .catch((error) => showMessage(`Week change failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.reloadBlockBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    loadSelectedBlock()
      .then(() => previewSelectedBlock())
      .catch((error) => showMessage(`Reload failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.daySelect.addEventListener("change", () => {
    loadSelectedBlock()
      .then(() => previewSelectedBlock())
      .catch((error) => showMessage(error.message, "error"));
  });

  refs.periodSelect.addEventListener("change", () => {
    loadSelectedBlock()
      .then(() => previewSelectedBlock())
      .catch((error) => showMessage(error.message, "error"));
  });

  refs.saveBlockBtn.addEventListener("click", () => {
    setButtonWorking(refs.saveBlockBtn, "Saving...");
    setLoadingButtons(true);
    saveSelectedBlock()
      .then(() => previewSelectedBlock())
      .then(() => refreshLogsIfVisible())
      .then(() => {
        setButtonConfirmed(refs.saveBlockBtn, "Saved");
        showMessage("Block saved.", "success");
      })
      .catch((error) => {
        resetButtonState(refs.saveBlockBtn);
        showMessage(`Save failed: ${error?.message || "unknown"}`, "error");
      })
      .finally(() => setLoadingButtons(false));
  });

  refs.clearBlockBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    clearSelectedBlock()
      .then(() => refreshLogsIfVisible())
      .catch((error) => showMessage(`Clear failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.saveSettingsBtn.addEventListener("click", () => {
    setButtonWorking(refs.saveSettingsBtn, "Saving...");
    setLoadingButtons(true);
    saveSettings()
      .then(() => refreshLogsIfVisible())
      .then(() => {
        setButtonConfirmed(refs.saveSettingsBtn, "Saved");
        showMessage("Settings saved.", "success");
      })
      .catch((error) => {
        resetButtonState(refs.saveSettingsBtn);
        showMessage(`Settings save failed: ${error?.message || "unknown"}`, "error");
      })
      .finally(() => setLoadingButtons(false));
  });

  refs.toggleTestToolsBtn.addEventListener("click", () => {
    toggleTestToolsPanel();
  });

  refs.toggleLogsBtn.addEventListener("click", () => {
    toggleLogsPanel().catch((error) => showMessage(`Logs failed: ${error?.message || "unknown"}`, "error"));
  });

  refs.refreshLogsBtn.addEventListener("click", () => {
    refreshLogs().catch((error) => showMessage(`Logs failed: ${error?.message || "unknown"}`, "error"));
  });

  refs.resetWeekBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    resetWeek()
      .then(() => showMessage("Week reset complete.", "success"))
      .catch((error) => showMessage(`Reset failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });
}

async function init() {
  populateSelects();
  attachHandlers();

  if (!isSupabaseConfigured()) {
    setEditorVisible(false);
    setVisible(refs.loginCard, false);
    setVisible(refs.unauthorizedCard, false);
    showMessage("Supabase is not configured. Update js/config.js first.", "error");
    return;
  }

  const session = await getSession();
  await handleSessionChange(session);
  onAuthStateChange((nextSession) => {
    handleSessionChange(nextSession).catch((error) => {
      showMessage(`Auth update error: ${error?.message || "unknown"}`, "error");
    });
  });
}

init().catch((error) => {
  showMessage(`Initialization failed: ${error?.message || "unknown error"}`, "error");
});
