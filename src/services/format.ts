import type { ResponseFormat, ToolResponse } from "../types.js";
import { redactErrorMessage, redactSensitive } from "./redaction.js";

export function makeResponse<T>(data: T, format: ResponseFormat, markdown: string): ToolResponse<T> {
  const safeData = redactSensitive(data) as T;
  const safeMarkdown = redactErrorMessage(markdown);
  return {
    content: [{ type: "text", text: format === "json" ? JSON.stringify(safeData, null, 2) : safeMarkdown }],
    structuredContent: safeData
  };
}

export function makeError(message: string): ToolResponse<{ error: string }> {
  const safeMessage = redactErrorMessage(message);
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${safeMessage}` }],
    structuredContent: { error: safeMessage }
  };
}

export function bulletList(title: string, fields: Record<string, unknown>): string {
  const lines = [`# ${title}`, ""];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    lines.push(`- **${key}**: ${formatMarkdownValue(value)}`);
  }
  return lines.join("\n");
}

const SKIP_KEYS = new Set(["id", "id_str"]);

const PREVIEW_KEYS = [
  "name",
  "day",
  "timestamp",
  "bedtime_start",
  "bedtime_end",
  "start_datetime",
  "end_datetime",
  "start_date",
  "created_at",
  "score",
  "bpm",
  "source",
  "activity",
  "intensity",
  "type",
  "sport_type",
  "contributors",
  "steps",
  "active_calories",
  "efficiency",
  "average_hrv",
  "lowest_heart_rate",
  "distance",
  "moving_time",
  "total_elevation_gain",
  "spo2_percentage",
  "breathing_disturbance_index",
  "temperature_deviation",
  "temperature_trend_deviation",
  "day_summary",
  "recovery_high",
  "stress_high",
  "level",
  "vascular_age",
  "vo2_max",
  "hardware_type",
  "firmware_version",
  "tag_type_code",
  "recommendation",
  "status"
];

export function formatCollection(title: string, records: unknown[], meta: Record<string, unknown>): string {
  const metaLines = Object.entries(meta)
    .filter(([key, value]) => key !== "records" && value !== undefined && value !== null)
    .map(([key, value]) => `- **${key}**: ${formatMarkdownValue(value)}`);
  const lines = [`# ${title}`, "", ...metaLines, ""];
  const preview = records.slice(0, 8);
  for (const [index, record] of preview.entries()) {
    if (record && typeof record === "object") {
      const object = record as Record<string, unknown>;
      const id = object.id ?? object.id_str ?? `item-${index + 1}`;
      lines.push(`## ${String(id)}`);
      for (const [key, value] of previewFields(object)) {
        lines.push(`- **${key}**: ${formatMarkdownValue(value)}`);
      }
      lines.push("");
    } else {
      lines.push(`- ${JSON.stringify(record)}`);
    }
  }
  if (records.length > preview.length) lines.push(`... ${records.length - preview.length} more records omitted from markdown preview.`);
  return lines.join("\n");
}

function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

function previewFields(object: Record<string, unknown>): Array<[string, unknown]> {
  const seen = new Set<string>();
  const fields: Array<[string, unknown]> = [];
  const emit = (key: string, value: unknown) => {
    if (!isPresent(value) || seen.has(key) || SKIP_KEYS.has(key)) return;
    seen.add(key);
    if (isAverageObject(value)) {
      fields.push([`${key}.average`, value.average]);
      return;
    }
    fields.push([key, value]);
  };

  for (const key of PREVIEW_KEYS) emit(key, object[key]);
  for (const key of Object.keys(object).sort()) emit(key, object[key]);
  return fields;
}

function isAverageObject(value: unknown): value is { average: unknown } {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    "average" in value
  );
}

function formatMarkdownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "none";
    if (value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) {
      return value.map((item) => String(item)).join(", ");
    }
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}
