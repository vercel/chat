import { AdapterError } from "@chat-adapter/shared";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export class WhatsAppApiError extends AdapterError {
  readonly status: number;
  readonly details?: string;
  readonly subcode?: number;
  readonly traceId?: string;
  readonly raw: unknown;

  constructor(message: string, status: number, body: string) {
    let raw: unknown = body;
    try {
      raw = JSON.parse(body);
    } catch {
      raw = body;
    }

    const error = record(record(raw)?.error);
    const code = error?.code;
    super(
      `${message}: ${status} ${body}`,
      "whatsapp",
      typeof code === "number" && Number.isInteger(code)
        ? String(code)
        : undefined
    );
    this.name = "WhatsAppApiError";
    this.status = status;
    this.raw = raw;

    const details = record(error?.error_data)?.details;
    if (typeof details === "string") {
      this.details = details;
    }
    if (
      typeof error?.error_subcode === "number" &&
      Number.isInteger(error.error_subcode)
    ) {
      this.subcode = error.error_subcode;
    }
    if (typeof error?.fbtrace_id === "string") {
      this.traceId = error.fbtrace_id;
    }
  }
}
