import { DAYS, DEFAULT_SETTINGS } from "./constants.js";

export function settingsRowsToObject(rows) {
  const merged = { ...DEFAULT_SETTINGS };

  for (const row of rows || []) {
    merged[row.key] = row.value;
  }

  if (!Number.isFinite(Number(merged.display_refresh_seconds))) {
    merged.display_refresh_seconds = DEFAULT_SETTINGS.display_refresh_seconds;
  } else {
    merged.display_refresh_seconds = Number(merged.display_refresh_seconds);
  }

  if (typeof merged.test_override_day_of_week === "string" && merged.test_override_day_of_week !== "") {
    merged.test_override_day_of_week = Number(merged.test_override_day_of_week);
  }

  if (!Number.isInteger(merged.test_override_day_of_week)) {
    merged.test_override_day_of_week = null;
  }

  if (merged.test_override_period !== "morning" && merged.test_override_period !== "evening") {
    merged.test_override_period = null;
  }

  merged.test_mode_enabled = Boolean(merged.test_mode_enabled);
  merged.test_effective_timestamp = typeof merged.test_effective_timestamp === "string"
    ? merged.test_effective_timestamp
    : "";
  merged.test_morning_switch_time = merged.test_morning_switch_time || "";
  merged.test_evening_switch_time = merged.test_evening_switch_time || "";
  return merged;
}

export function toAppSettingRows(settings, actor) {
  const keys = Object.keys(DEFAULT_SETTINGS);
  return keys.map((key) => ({
    key,
    value: settings[key] === null || settings[key] === undefined ? "" : settings[key],
    updated_by: actor?.id ?? null,
    updated_by_email: actor?.email ?? null
  }));
}

export function blockKey(dayOfWeek, period) {
  return `${dayOfWeek}-${period}`;
}

export function formatBlockLabel(dayOfWeek, period) {
  const day = DAYS.find((entry) => entry.value === Number(dayOfWeek))?.label ?? `Day ${dayOfWeek}`;
  const periodLabel = period === "morning" ? "Morning" : "Evening";
  return `${day} ${periodLabel}`;
}

export function sortScheduleItems(items) {
  return [...(items || [])]
    .filter((item) => item && item.is_visible !== false)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}
