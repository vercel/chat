import { describe, expect, it } from "vitest";
import {
  TWILIO_MESSAGE_LIMIT,
  truncateTwilioText,
  twilioTextOrPlaceholder,
} from "./index";

describe("Twilio format helpers", () => {
  it("keeps text within the Twilio message limit", () => {
    const text = "x".repeat(TWILIO_MESSAGE_LIMIT);
    expect(truncateTwilioText(text)).toEqual({ text, truncated: false });
  });

  it("truncates text over the Twilio message limit", () => {
    const result = truncateTwilioText("x".repeat(TWILIO_MESSAGE_LIMIT + 1));
    expect(result.text).toHaveLength(TWILIO_MESSAGE_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it("rejects invalid limits", () => {
    expect(() => truncateTwilioText("hello", { limit: 0 })).toThrow(TypeError);
  });

  it("uses a placeholder for empty bodies", () => {
    expect(twilioTextOrPlaceholder("")).toBe(" ");
    expect(twilioTextOrPlaceholder("hello")).toBe("hello");
  });
});
