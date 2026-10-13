/**
 * Encoding for button and quick-reply callback payloads.
 *
 * Format: `chat:{json}` where json is `{ a: actionId, v?: value }`.
 */

const CALLBACK_DATA_PREFIX = "chat:";

interface CallbackDataPayload {
  a: string;
  v?: string;
}

/** Decoded callback data. */
export interface DecodedCallbackData {
  actionId: string;
  value: string | undefined;
}

/**
 * Encode an action ID and optional value into a callback data string.
 */
export function encodeCallbackData(actionId: string, value?: string): string {
  const payload: CallbackDataPayload = { a: actionId };
  if (typeof value === "string") {
    payload.v = value;
  }
  return `${CALLBACK_DATA_PREFIX}${JSON.stringify(payload)}`;
}

/**
 * Decode callback data produced by {@link encodeCallbackData}.
 *
 * Missing data decodes to `fallbackActionId` with no value. Data without the
 * `chat:` prefix, or with malformed JSON after it, is passed through as both
 * the action ID and the value so legacy and third-party payloads still route.
 */
export function decodeCallbackData(
  data: string | undefined,
  fallbackActionId: string
): DecodedCallbackData {
  if (!data) {
    return { actionId: fallbackActionId, value: undefined };
  }
  if (!data.startsWith(CALLBACK_DATA_PREFIX)) {
    return { actionId: data, value: data };
  }
  try {
    const decoded = JSON.parse(
      data.slice(CALLBACK_DATA_PREFIX.length)
    ) as CallbackDataPayload;
    if (typeof decoded.a === "string" && decoded.a) {
      return {
        actionId: decoded.a,
        value: typeof decoded.v === "string" ? decoded.v : undefined,
      };
    }
  } catch {
    // Malformed JSON after the prefix falls through to passthrough.
  }
  return { actionId: data, value: data };
}
