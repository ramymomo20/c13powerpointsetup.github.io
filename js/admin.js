import { getSession, isAllowedEditorEmail, onAuthStateChange, signIn, signOut } from "./auth.js";
import { isSupabaseConfigured, supabase } from "./supabaseClient.js";
import { DAYS, DEFAULT_ROOM_NAMES, DEFAULT_SETTINGS, PERIODS } from "./utils/constants.js";
import { clearChildren, setMessage, setVisible } from "./utils/dom.js";
import { formatBlockLabel, settingsRowsToObject, sortScheduleItems, toAppSettingRows } from "./utils/schedule.js";
import { fromDatetimeLocalToIso, resolveDisplayContext, toDatetimeLocalValue } from "./utils/time.js";

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
  daySelect: document.getElementById("daySelect"),
  periodSelect: document.getElementById("periodSelect"),
  blockTitleInput: document.getElementById("blockTitleInput"),
  itemsBody: document.getElementById("itemsBody"),
  addRowBtn: document.getElementById("addRowBtn"),
  saveBlockBtn: document.getElementById("saveBlockBtn"),
  clearBlockBtn: document.getElementById("clearBlockBtn"),
  previewBtn: document.getElementById("previewBtn"),
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
  refreshSecondsInput: document.getElementById("refreshSecondsInput"),
  displayTitleInput: document.getElementById("displayTitleInput"),
  logoImageUrlInput: document.getElementById("logoImageUrlInput"),
  bannerImageUrlInput: document.getElementById("bannerImageUrlInput"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
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

function populateSelects() {
  refs.daySelect.innerHTML = DAYS.map((day) => `<option value="${day.value}">${day.label}</option>`).join("");
  refs.periodSelect.innerHTML = PERIODS.map((period) => `<option value="${period.value}">${period.label}</option>`).join("");

  refs.testOverrideDaySelect.innerHTML = [
    `<option value="">(Clock-driven)</option>`,
    ...DAYS.map((day) => `<option value="${day.value}">${day.label}</option>`)
  ].join("");

  refs.testOverridePeriodSelect.innerHTML = [
    `<option value="">(Clock-driven)</option>`,
    ...PERIODS.map((period) => `<option value="${period.value}">${period.label}</option>`)
  ].join("");
}

function setEditorVisible(visible) {
  setVisible(refs.appShell, visible);
  setVisible(refs.signOutBtn, visible);
  setVisible(refs.signedInAs, visible);
}

function buildTextInput(value = "", placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function normalizeRoomName(value) {
  return String(value || "").trim().toUpperCase();
}

function addDefaultRoomRows() {
  clearChildren(refs.itemsBody);
  for (const roomName of DEFAULT_ROOM_NAMES) {
    addItemRow({ room_name: roomName, is_visible: true });
  }
}

function addItemRow(item = {}) {
  const tr = document.createElement("tr");

  const room = buildTextInput(item.room_name || "", "A");
  const startTime = buildTextInput(item.start_time_text || "", "9:00 AM");
  const endTime = buildTextInput(item.end_time_text || "", "10:00 AM");
  const eventTitle = buildTextInput(item.event_title || "", "Meeting");
  const building = buildTextInput(item.building_name || "", "HQ");
  const notes = buildTextInput(item.notes || "", "Optional notes");
  const visible = document.createElement("input");
  visible.type = "checkbox";
  visible.checked = item.is_visible !== false;

  room.dataset.field = "room_name";
  startTime.dataset.field = "start_time_text";
  endTime.dataset.field = "end_time_text";
  eventTitle.dataset.field = "event_title";
  building.dataset.field = "building_name";
  notes.dataset.field = "notes";
  visible.dataset.field = "is_visible";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn btn-small";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    tr.remove();
    if (!refs.itemsBody.children.length) {
      addDefaultRoomRows();
    }
  });

  const cells = [room, startTime, endTime, eventTitle, building, notes, visible];
  for (const fieldElement of cells) {
    const td = document.createElement("td");
    td.append(fieldElement);
    tr.append(td);
  }

  const actionCell = document.createElement("td");
  actionCell.append(removeBtn);
  tr.append(actionCell);

  refs.itemsBody.append(tr);
}

function collectItemRows() {
  const rows = [...refs.itemsBody.querySelectorAll("tr")];
  return rows
    .map((row, index) => {
      const roomName = row.querySelector('[data-field="room_name"]')?.value.trim() || "";
      const startText = row.querySelector('[data-field="start_time_text"]')?.value.trim() || "";
      const endText = row.querySelector('[data-field="end_time_text"]')?.value.trim() || "";
      const eventTitle = row.querySelector('[data-field="event_title"]')?.value.trim() || "";
      const building = row.querySelector('[data-field="building_name"]')?.value.trim() || "";
      const notes = row.querySelector('[data-field="notes"]')?.value.trim() || "";
      const isVisible = row.querySelector('[data-field="is_visible"]')?.checked ?? true;
      const hasContent = startText || endText || eventTitle || building || notes;
      const isDefaultTemplateRoom = DEFAULT_ROOM_NAMES.includes(normalizeRoomName(roomName));
      const include = Boolean(hasContent || (roomName && !isDefaultTemplateRoom));

      return {
        include,
        room_name: roomName || "TBD",
        start_time_text: startText || null,
        end_time_text: endText || null,
        event_title: eventTitle || "Open",
        building_name: building || null,
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
    refs.saveBlockBtn,
    refs.clearBlockBtn,
    refs.previewBtn,
    refs.reloadBlockBtn,
    refs.saveSettingsBtn,
    refs.toggleLogsBtn,
    refs.refreshLogsBtn,
    refs.resetWeekBtn,
    refs.addRowBtn
  ];
  for (const button of buttons) {
    if (button) {
      button.disabled = disabled;
    }
  }
}

async function fetchSettings() {
  const { data, error } = await supabase.from("app_settings").select("key,value");
  if (error) {
    throw error;
  }
  state.settings = settingsRowsToObject(data || []);
}

function renderSettingsForm() {
  refs.testModeEnabled.checked = Boolean(state.settings.test_mode_enabled);
  refs.testTimestampInput.value = toDatetimeLocalValue(state.settings.test_effective_timestamp);
  refs.testOverrideDaySelect.value =
    state.settings.test_override_day_of_week === null ? "" : String(state.settings.test_override_day_of_week);
  refs.testOverridePeriodSelect.value = state.settings.test_override_period || "";
  refs.testMorningSwitchInput.value = state.settings.test_morning_switch_time || "";
  refs.testEveningSwitchInput.value = state.settings.test_evening_switch_time || "";
  refs.morningSwitchInput.value = state.settings.morning_switch_time || "05:00";
  refs.eveningSwitchInput.value = state.settings.evening_switch_time || "17:00";
  refs.refreshSecondsInput.value = String(state.settings.display_refresh_seconds || 60);
  refs.displayTitleInput.value = state.settings.display_title || "Today's Events";
  refs.logoImageUrlInput.value = state.settings.display_logo_url || "";
  refs.bannerImageUrlInput.value = state.settings.display_banner_url || "";
}

function readSettingsForm() {
  const parsedRefresh = Number(refs.refreshSecondsInput.value || "60");
  const refreshSeconds = Number.isFinite(parsedRefresh) ? Math.min(Math.max(parsedRefresh, 15), 3600) : 60;
  const testOverrideDayRaw = refs.testOverrideDaySelect.value;
  const testOverrideDay = testOverrideDayRaw === "" ? null : Number(testOverrideDayRaw);
  const testOverridePeriod = refs.testOverridePeriodSelect.value || null;

  return {
    ...state.settings,
    display_timezone: "America/New_York",
    morning_switch_time: refs.morningSwitchInput.value || "05:00",
    evening_switch_time: refs.eveningSwitchInput.value || "17:00",
    display_refresh_seconds: refreshSeconds,
    display_title: refs.displayTitleInput.value.trim() || "Today's Events",
    display_logo_url: refs.logoImageUrlInput.value.trim() || null,
    display_banner_url: refs.bannerImageUrlInput.value.trim() || null,
    test_mode_enabled: refs.testModeEnabled.checked,
    test_effective_timestamp: fromDatetimeLocalToIso(refs.testTimestampInput.value),
    test_override_day_of_week: Number.isInteger(testOverrideDay) ? testOverrideDay : null,
    test_override_period:
      testOverridePeriod === "morning" || testOverridePeriod === "evening" ? testOverridePeriod : null,
    test_morning_switch_time: refs.testMorningSwitchInput.value || null,
    test_evening_switch_time: refs.testEveningSwitchInput.value || null
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
  if (!items.length) {
    addDefaultRoomRows();
    return;
  }

  const existingRooms = new Set(items.map((item) => normalizeRoomName(item.room_name)));
  for (const item of items) {
    addItemRow(item);
  }
  for (const roomName of DEFAULT_ROOM_NAMES) {
    if (!existingRooms.has(normalizeRoomName(roomName))) {
      addItemRow({ room_name: roomName, is_visible: true });
    }
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
  refs.previewLabel.textContent = `Preview: ${formatBlockLabel(dayOfWeek, period)}`;
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
      <div>${item.start_time_text || ""}${item.end_time_text ? ` - ${item.end_time_text}` : ""}</div>
      <div class="muted">${item.building_name || ""}</div>
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
    item_count: itemRows.length
  }).catch(() => undefined);
}

async function clearSelectedBlock() {
  if (!window.confirm("Clear all rows for this day/period block?")) {
    return;
  }

  refs.blockTitleInput.value = state.settings.display_title || "Today's Events";
  addDefaultRoomRows();
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
  renderModeSummary();
  await writeEventLog("schedule_updated", {
    settings_changed: true,
    mode: nextSettings.test_mode_enabled ? "test" : "live"
  }).catch(() => undefined);
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

  refs.reloadBlockBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    loadSelectedBlock()
      .then(() => previewSelectedBlock())
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

  refs.addRowBtn.addEventListener("click", () => addItemRow());

  refs.saveBlockBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    saveSelectedBlock()
      .then(() => previewSelectedBlock())
      .then(() => refreshLogsIfVisible())
      .then(() => showMessage("Block saved.", "success"))
      .catch((error) => showMessage(`Save failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.clearBlockBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    clearSelectedBlock()
      .then(() => refreshLogsIfVisible())
      .catch((error) => showMessage(`Clear failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.previewBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    previewSelectedBlock()
      .catch((error) => showMessage(`Preview failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
  });

  refs.saveSettingsBtn.addEventListener("click", () => {
    setLoadingButtons(true);
    saveSettings()
      .then(() => refreshLogsIfVisible())
      .then(() => showMessage("Settings saved.", "success"))
      .catch((error) => showMessage(`Settings save failed: ${error?.message || "unknown"}`, "error"))
      .finally(() => setLoadingButtons(false));
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
