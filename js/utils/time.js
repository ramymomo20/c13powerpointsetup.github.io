const WEEKDAY_TO_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function parseTimeToMinutes(timeText, fallbackMinutes) {
  if (!timeText || typeof timeText !== "string") {
    return fallbackMinutes;
  }

  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(timeText.trim());
  if (!match) {
    return fallbackMinutes;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function parseNullableDate(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDateInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function formatTimeInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(date);
}

export function getTimeZoneClockParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const rawParts = formatter.formatToParts(date);
  const partMap = {};
  for (const part of rawParts) {
    if (part.type !== "literal") {
      partMap[part.type] = part.value;
    }
  }

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
    hour: Number(partMap.hour),
    minute: Number(partMap.minute),
    second: Number(partMap.second),
    weekdayShort: partMap.weekday,
    dayOfWeek: WEEKDAY_TO_INDEX[partMap.weekday]
  };
}

export function resolveDayPeriodForClockParts(parts, morningSwitch, eveningSwitch) {
  const currentMinutes = parts.hour * 60 + parts.minute;
  const morningMinutes = parseTimeToMinutes(morningSwitch, 5 * 60);
  const eveningMinutes = parseTimeToMinutes(eveningSwitch, 17 * 60);

  let dayOfWeek = parts.dayOfWeek;
  let period = "morning";

  if (currentMinutes < morningMinutes) {
    dayOfWeek = (dayOfWeek + 6) % 7;
    period = "evening";
  } else if (currentMinutes >= eveningMinutes) {
    period = "evening";
  } else {
    period = "morning";
  }

  return {
    dayOfWeek,
    period,
    currentMinutes,
    morningMinutes,
    eveningMinutes
  };
}

export function resolveDisplayContext(settings, nowDate = new Date()) {
  const timezone = settings.display_timezone || "America/New_York";
  const officialMorning = settings.morning_switch_time || "05:00";
  const officialEvening = settings.evening_switch_time || "17:00";
  const testModeEnabled = Boolean(settings.test_mode_enabled);
  const testMorning = settings.test_morning_switch_time || officialMorning;
  const testEvening = settings.test_evening_switch_time || officialEvening;
  const effectiveMorning = testModeEnabled ? testMorning : officialMorning;
  const effectiveEvening = testModeEnabled ? testEvening : officialEvening;

  let source = "live_clock";
  let effectiveDate = nowDate;

  if (testModeEnabled) {
    const parsed = parseNullableDate(settings.test_effective_timestamp);
    if (parsed) {
      source = "test_timestamp";
      effectiveDate = parsed;
    }
  }

  const parts = getTimeZoneClockParts(effectiveDate, timezone);
  const resolved = resolveDayPeriodForClockParts(parts, effectiveMorning, effectiveEvening);
  let dayOfWeek = resolved.dayOfWeek;
  let period = resolved.period;

  const hasManualDay = Number.isInteger(settings.test_override_day_of_week);
  const hasManualPeriod = settings.test_override_period === "morning" || settings.test_override_period === "evening";
  if (testModeEnabled && hasManualDay && hasManualPeriod) {
    dayOfWeek = settings.test_override_day_of_week;
    period = settings.test_override_period;
    source = "test_manual";
  }

  return {
    mode: testModeEnabled ? "test" : "live",
    source,
    timezone,
    effectiveDate,
    dayOfWeek,
    period,
    currentMinutes: resolved.currentMinutes,
    morningMinutes: resolved.morningMinutes,
    eveningMinutes: resolved.eveningMinutes,
    formattedDate: formatDateInTimeZone(effectiveDate, timezone),
    formattedTime: formatTimeInTimeZone(effectiveDate, timezone),
    switchTimes: {
      morning: effectiveMorning,
      evening: effectiveEvening
    }
  };
}

export function toDatetimeLocalValue(isoValue) {
  const parsed = parseNullableDate(isoValue);
  if (!parsed) {
    return "";
  }

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  const hh = String(parsed.getHours()).padStart(2, "0");
  const min = String(parsed.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function fromDatetimeLocalToIso(localValue) {
  if (!localValue) {
    return "";
  }

  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}
