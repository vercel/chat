import {
  type SlackHeaders,
  type SlackRetry,
  SlackWebhookParseError,
} from "./types";

export function getHeader(
  headers: SlackHeaders | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  if (isIterableHeaders(headers)) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() === lower) {
        return value;
      }
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return headerValue(value);
    }
  }
  return undefined;
}

export function getRetry(
  headers: SlackHeaders | undefined
): SlackRetry | undefined {
  const retryNum = getHeader(headers, "x-slack-retry-num");
  if (!retryNum) {
    return undefined;
  }
  const num = Number(retryNum);
  if (!Number.isFinite(num)) {
    return undefined;
  }
  return {
    num,
    reason: getHeader(headers, "x-slack-retry-reason"),
  };
}

export function isFormBody(body: string, contentType: string): boolean {
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return true;
  }
  if (contentType.includes("application/json")) {
    return false;
  }
  const trimmed = body.trimStart();
  return !trimmed.startsWith("{") && body.includes("=");
}

export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new SlackWebhookParseError("Slack webhook body is invalid JSON");
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordValue(
  value: unknown
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function optionalString(value: unknown): string | undefined {
  const text = stringValue(value);
  return text || undefined;
}

function isIterableHeaders(
  headers: SlackHeaders
): headers is Iterable<readonly [string, string]> {
  return (
    typeof (headers as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
    "function"
  );
}

function headerValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value[0];
  }
  return undefined;
}
