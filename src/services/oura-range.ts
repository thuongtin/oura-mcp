export type OuraRangeMode = "date" | "datetime";

const DATETIME_PATHS = [/\/heartrate(?:\/|$)/i, /\/ring_battery/i];

export function rangeModeFor(path: string): OuraRangeMode {
  return DATETIME_PATHS.some((pattern) => pattern.test(path)) ? "datetime" : "date";
}

export function hasClock(value?: string): boolean {
  return Boolean(value && /T\d{2}:\d{2}/.test(value));
}

const EXCLUSIVE_START_PATHS = [/\/daily_activity(?:\/|$)/i];
const SAME_DAY_EMPTY_PATHS = [/\/usercollection\/sleep(?:\/|$)/i, /\/daily_activity(?:\/|$)/i];

export function shiftOuraDate(date: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid Oura date range value: ${date}`);
  const shifted = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return shifted.toISOString().slice(0, 10);
}

export function ouraRangeQuery(path: string, params: { after?: string; before?: string }): Record<string, string> {
  const range: Record<string, string> = {};
  if (rangeModeFor(path) === "datetime") {
    if (params.after) range.start_datetime = toDateTime(params.after);
    if (params.before) range.end_datetime = toDateTime(params.before);
    return range;
  }
  if (params.after) range.start_date = toDate(params.after);
  if (params.before) range.end_date = toDate(params.before);
  // Live Oura v2: daily_activity treats start_date as exclusive. Shift back one day
  // so after=D still includes the document whose day is D.
  if (EXCLUSIVE_START_PATHS.some((pattern) => pattern.test(path)) && range.start_date) {
    range.start_date = shiftOuraDate(range.start_date, -1);
  } else if (
    SAME_DAY_EMPTY_PATHS.some((pattern) => pattern.test(path)) &&
    range.start_date &&
    range.start_date === range.end_date
  ) {
    // /sleep (and activity) return an empty page when start_date === end_date.
    range.start_date = shiftOuraDate(range.start_date, -1);
  }
  return range;
}

/** Calendar days the caller asked for, used after expanding a degenerate sleep/activity window. */
export function requestedCalendarDays(params: { after?: string; before?: string }): string[] | undefined {
  if (!params.after || !params.before) return undefined;
  const start = toDate(params.after);
  const end = toDate(params.before);
  if (start !== end) return undefined;
  return [start];
}

export function filterRecordsByDay(records: unknown[], days?: string[]): unknown[] {
  if (!days?.length) return records;
  const allowed = new Set(days);
  return records.filter((record) => {
    const day = recordDay(record);
    return day === undefined || allowed.has(day);
  });
}

function recordDay(record: unknown): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const day = (record as Record<string, unknown>).day;
  return typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
}

export function toDate(value: string): string {
  if (value === "today") return value;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) throw new Error(`Invalid Oura date range value: ${value}`);

  const date = `${match[1]}-${match[2]}-${match[3]}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid Oura date range value: ${value}`);
  }
  return date;
}

export function toDateTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`Invalid Oura datetime range value: ${value}`);
  }
  return parsed.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function filterRecordsByTimeWindow(
  records: unknown[],
  params: { after?: string; before?: string }
): unknown[] {
  const afterMs = params.after ? Date.parse(params.after) : Number.NaN;
  const beforeMs = params.before ? Date.parse(params.before) : Number.NaN;
  const hasAfter = Number.isFinite(afterMs);
  const hasBefore = Number.isFinite(beforeMs);
  if (!hasAfter && !hasBefore) return records;

  return records.filter((record) => {
    const instant = recordInstant(record);
    if (instant === undefined) return true;
    if (hasAfter && instant < afterMs) return false;
    if (hasBefore && instant >= beforeMs) return false;
    return true;
  });
}

function recordInstant(record: unknown): number | undefined {
  if (!record || typeof record !== "object") return undefined;
  const object = record as Record<string, unknown>;
  for (const key of ["timestamp", "start_datetime", "bedtime_start"]) {
    const value = object[key];
    if (typeof value !== "string") continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return ms;
  }
  return undefined;
}
