export const DAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" }
];

export const PERIODS = [
  { value: "morning", label: "Morning" },
  { value: "evening", label: "Evening" }
];

export const DEFAULT_ROOM_NAMES = ["Room A", "Room B", "Room C", "Room D", "Room E", "Room G"];

export const DEFAULT_SETTINGS = Object.freeze({
  display_timezone: "America/New_York",
  morning_switch_time: "05:00",
  evening_switch_time: "17:00",
  display_refresh_seconds: 60,
  display_title: "Today's Events",
  test_mode_enabled: false,
  test_effective_timestamp: "",
  test_override_day_of_week: "",
  test_override_period: "",
  test_morning_switch_time: "",
  test_evening_switch_time: ""
});
