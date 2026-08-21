import type { PrivacyMode, OuraConfig } from "../types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pickDefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null));
}

export type PrivacyEscalationOpts = {
  explicit_user_intent?: boolean;
};

/**
 * Agent-requested privacy_mode=raw requires explicit_user_intent=true.
 * Config-default raw (env) is allowed without per-call intent.
 */
export function resolvePrivacyMode(
  config: { privacyMode: PrivacyMode },
  override?: PrivacyMode,
  opts?: PrivacyEscalationOpts
): PrivacyMode {
  if (override === "raw" && opts?.explicit_user_intent !== true) {
    throw new Error(
      "USER_ACTION_REQUIRED: privacy_mode=raw requires explicit_user_intent=true after the user explicitly asked for unredacted payloads."
    );
  }
  return override ?? config.privacyMode;
}

export function applyPrivacy(endpoint: string, payload: unknown, mode: PrivacyMode): unknown {
  if (mode === "raw") return payload;
  if (isObject(payload) && Array.isArray(payload.records)) {
    return { ...payload, privacy_mode: mode, records: payload.records.map((record) => normalizeRecord(endpoint, record, mode)) };
  }
  if (Array.isArray(payload)) return payload.map((record) => normalizeRecord(endpoint, record, mode));
  return normalizeRecord(endpoint, payload, mode);
}

export function normalizeRecord(endpoint: string, record: unknown, mode: PrivacyMode): unknown {
  if (!isObject(record)) return record;
  if (endpoint.includes("personal_info")) return normalizePersonalInfo(record, mode);
  if (endpoint.includes("daily_activity")) return normalizeOuraDailyActivity(record, mode);
  if (endpoint.includes("workout")) return normalizeOuraActivity(record, mode);
  if (endpoint.includes("daily_readiness")) return normalizeOuraReadiness(record, mode);
  if (endpoint.includes("daily_stress")) return normalizeOuraDailyStress(record, mode);
  if (endpoint.includes("daily_resilience")) return normalizeDailyResilience(record, mode);
  if (endpoint.includes("daily_cardiovascular_age")) return normalizeCardiovascularAge(record, mode);
  if (endpoint.includes("vO2_max") || endpoint.includes("vo2_max")) return normalizeVo2Max(record, mode);
  if (endpoint.includes("ring_battery")) return normalizeRingBattery(record, mode);
  if (endpoint.includes("ring_configuration")) return normalizeRingConfiguration(record, mode);
  if (endpoint.includes("sleep_time")) return normalizeSleepTime(record, mode);
  if (endpoint.includes("rest_mode")) return normalizeRestMode(record, mode);
  if (endpoint.includes("enhanced_tag")) return normalizeEnhancedTag(record, mode);
  if (endpoint.includes("sleep")) return normalizeOuraSleep(record, mode);
  if (endpoint.includes("heartrate") || endpoint.includes("spo2")) return normalizeVitals(record, mode);
  if (endpoint.includes("session") || endpoint.includes("tag")) return mode === "summary" ? summarizeUnknown(record) : removeSensitive(record);
  return mode === "summary" ? summarizeUnknown(record) : removeSensitive(record);
}

export function normalizeStreams(payload: unknown, mode: PrivacyMode, includeGps: boolean): unknown {
  if (mode === "raw") return payload;
  if (!isObject(payload)) return payload;
  const clean = removeSensitive(payload);
  if (!includeGps) { delete clean["activities-tracker-gps"]; delete clean.latlng; delete clean.gps; }
  if (mode === "summary") return summarizeUnknown(clean);
  return clean;
}

function normalizeProfile(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const user = isObject(record.user) ? record.user : record;
  const base = pickDefined({
    encodedId: user.encodedId,
    displayName: user.displayName,
    memberSince: user.memberSince,
    timezone: user.timezone,
    locale: user.locale,
    clockTimeDisplayFormat: user.clockTimeDisplayFormat,
    distanceUnit: user.distanceUnit,
    weightUnit: user.weightUnit
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...user, email: undefined, avatar: undefined, avatar150: undefined });
}

function normalizePersonalInfo(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    age: record.age,
    height: record.height,
    weight: record.weight,
    biological_sex: record.biological_sex
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, email: undefined });
}

const SLEEP_DURATION_KEYS = [
  "total_sleep_duration",
  "deep_sleep_duration",
  "rem_sleep_duration",
  "light_sleep_duration",
  "awake_time",
  "time_in_bed",
  "latency"
] as const;

const ACTIVITY_TIME_KEYS = [
  "high_activity_time",
  "medium_activity_time",
  "low_activity_time",
  "sedentary_time",
  "resting_time",
  "non_wear_time"
] as const;

function convertSecondFields(record: Record<string, unknown>, keys: readonly string[]): Record<string, number> {
  const converted: Record<string, number> = {};
  for (const key of keys) {
    const minutes = secondsToRoundedMinutes(record[key]);
    if (minutes !== undefined) converted[key] = minutes;
  }
  return converted;
}

function normalizeOuraActivity(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    score: record.score,
    steps: record.steps,
    active_calories: record.active_calories,
    total_calories: record.total_calories,
    equivalent_walking_distance: record.equivalent_walking_distance,
    activity: record.activity,
    start_datetime: record.start_datetime,
    end_datetime: record.end_datetime
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeOuraDailyActivity(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const converted = convertSecondFields(record, ACTIVITY_TIME_KEYS);
  const base = pickDefined({
    id: record.id,
    day: record.day,
    score: record.score,
    steps: record.steps,
    active_calories: record.active_calories,
    total_calories: record.total_calories,
    equivalent_walking_distance: record.equivalent_walking_distance,
    ...converted
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeOuraReadiness(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    score: record.score,
    contributors: record.contributors,
    temperature_deviation: record.temperature_deviation
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

/**
 * Oura Cloud v2 sends recovery_high / stress_high in seconds. Tool output uses
 * rounded minutes so agents do not treat the raw second counts as minute totals.
 * day_summary is the upstream enum: restored | normal | stressful.
 */
export function secondsToRoundedMinutes(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.round(value / 60);
}

function normalizeOuraDailyStress(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    day_summary: record.day_summary,
    recovery_high: secondsToRoundedMinutes(record.recovery_high),
    stress_high: secondsToRoundedMinutes(record.stress_high)
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeOuraSleep(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const converted = convertSecondFields(record, SLEEP_DURATION_KEYS);
  const base = pickDefined({
    id: record.id,
    day: record.day,
    score: record.score,
    type: record.type,
    bedtime_start: record.bedtime_start,
    bedtime_end: record.bedtime_end,
    efficiency: record.efficiency,
    average_hrv: record.average_hrv,
    lowest_heart_rate: record.lowest_heart_rate,
    ...converted
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeDailyResilience(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    level: record.level,
    contributors: record.contributors
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeCardiovascularAge(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    vascular_age: record.vascular_age
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeVo2Max(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    vo2_max: record.vo2_max,
    timestamp: record.timestamp
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeRingConfiguration(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: mode === "summary" ? undefined : record.id,
    hardware_type: record.hardware_type,
    firmware_version: record.firmware_version,
    color: record.color,
    design: record.design,
    size: record.size,
    set_up_at: record.set_up_at
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeRingBattery(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    timestamp: record.timestamp,
    level: record.level,
    charging: record.charging,
    in_charger: record.in_charger
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeSleepTime(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    day: record.day,
    recommendation: record.recommendation,
    status: record.status,
    optimal_bedtime: record.optimal_bedtime
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeRestMode(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    start_day: record.start_day,
    end_day: record.end_day,
    start_time: record.start_time,
    end_time: record.end_time
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeEnhancedTag(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    id: record.id,
    start_day: record.start_day,
    start_time: record.start_time,
    end_day: record.end_day,
    end_time: record.end_time,
    tag_type_code: record.tag_type_code,
    custom_name: record.custom_name,
    comment: mode === "summary" ? undefined : record.comment
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeDevices(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const devices = Array.isArray(record) ? record : [record];
  const normalized = devices.map((device) => isObject(device) ? pickDefined({
    id: mode === "summary" ? undefined : device.id,
    deviceVersion: device.deviceVersion,
    type: device.type,
    battery: device.battery,
    lastSyncTime: device.lastSyncTime
  }) : device);
  return Array.isArray(record) ? normalized : normalized[0];
}

function normalizeActivity(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    activityId: record.activityId,
    logId: record.logId,
    name: record.name,
    activityName: record.activityName,
    startTime: record.startTime,
    duration: record.duration,
    distance: record.distance,
    steps: record.steps,
    calories: record.calories,
    activeDuration: record.activeDuration,
    averageHeartRate: record.averageHeartRate
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeActivityDetail(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return normalizeActivity(record, mode);
  return removeSensitive(record);
}

function normalizeSleep(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (Array.isArray(record.sleep)) return { ...record, sleep: record.sleep.map((item) => isObject(item) ? normalizeSleepLog(item, mode) : item) };
  return normalizeSleepLog(record, mode);
}

function normalizeSleepLog(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  const base = pickDefined({
    logId: record.logId,
    dateOfSleep: record.dateOfSleep,
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration,
    minutesAsleep: record.minutesAsleep,
    minutesAwake: record.minutesAwake,
    efficiency: record.efficiency,
    type: record.type
  });
  if (mode === "summary") return base;
  return removeSensitive({ ...record, ...base });
}

function normalizeVitals(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return summarizeUnknown(record);
  return removeSensitive(record);
}

function normalizeWeight(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (Array.isArray(record.weight)) return { weight: record.weight.map((item) => isObject(item) ? normalizeWeight(item, mode) : item) };
  return mode === "summary" ? pickDefined({ date: record.date, weight: record.weight, bmi: record.bmi }) : removeSensitive(record);
}

function normalizeNutrition(record: Record<string, unknown>, mode: PrivacyMode): unknown {
  if (mode === "summary") return summarizeUnknown(record);
  return removeSensitive(record);
}

function summarizeUnknown(record: Record<string, unknown>): Record<string, unknown> {
  return pickDefined({
    id: record.id ?? record.logId ?? record.activityId,
    date: record.date ?? record.dateTime ?? record.dateOfSleep ?? record.day,
    name: record.name ?? record.activityName,
    score: record.score,
    summary: record.summary,
    value: record.value
  });
}

function removeSensitive(record: Record<string, unknown>): Record<string, unknown> {
  const clone = { ...record };
  for (const key of ["email", "fullName", "firstName", "lastName", "avatar", "avatar150", "features", "access_token", "refresh_token", "start_latlng", "end_latlng", "latlng", "map", "polyline", "summary_polyline", "gps", "tcxLink"] ) delete clone[key];
  return clone;
}
