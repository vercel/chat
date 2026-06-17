export const TWILIO_MESSAGE_LIMIT = 1600;

export interface TwilioTextOptions {
  limit?: number;
}

export interface TwilioTextResult {
  text: string;
  truncated: boolean;
}

export function truncateTwilioText(
  text: string,
  options: TwilioTextOptions = {}
): TwilioTextResult {
  const limit = options.limit ?? TWILIO_MESSAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError("limit must be a positive integer");
  }
  if (text.length <= limit) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, limit), truncated: true };
}

export function twilioTextOrPlaceholder(text: string): string {
  return text.length > 0 ? text : " ";
}
