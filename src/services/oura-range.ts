export type OuraRangeMode = "date" | "datetime";

const DATETIME_PATHS = [/\/heartrate(?:\/|$)/i, /\/ring_battery/i];

export function rangeModeFor(path: string): OuraRangeMode {
  return DATETIME_PATHS.some((pattern) => pattern.test(path)) ? "datetime" : "date";
}

export function hasClock(value?: string): boolean {
  return Boolean(value && /T\d{2}:\d{2}/.test(value));
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
  return range;
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
