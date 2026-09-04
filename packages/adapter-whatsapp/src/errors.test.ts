import { AdapterError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import { WhatsAppApiError } from "./index";

describe("WhatsAppApiError", () => {
  it("preserves the error contract and raw Meta response", () => {
    const raw = {
      error: {
        message: "Invalid token",
        type: "OAuthException",
        code: 190,
        error_subcode: 463,
        error_data: { details: "The access token has expired" },
        fbtrace_id: "trace123",
        extra: { retained: true },
      },
    };
    const body = JSON.stringify(raw);
    const error = new WhatsAppApiError("WhatsApp API error", 401, body);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({
      name: "WhatsAppApiError",
      adapter: "whatsapp",
      code: "190",
      status: 401,
      subcode: 463,
      details: raw.error.error_data.details,
      traceId: "trace123",
      raw,
      message: `WhatsApp API error: 401 ${body}`,
    });
  });

  it.each([
    "",
    "<html>Bad gateway</html>",
    '{"error":',
  ])("retains non-JSON response %j without masking the HTTP error", (body) => {
    const error = new WhatsAppApiError("WhatsApp API error", 502, body);

    expect(error.raw).toBe(body);
    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
    expect(error.message).toBe(`WhatsApp API error: 502 ${body}`);
  });

  it.each([
    null,
    [],
    "unexpected",
    { error: null },
    { error: [] },
    { error: "unexpected" },
    {
      error: {
        code: { value: 190 },
        error_subcode: "463",
        error_data: { details: [] },
        fbtrace_id: 123,
      },
    },
  ])("ignores invalid field shapes in %j", (raw) => {
    const error = new WhatsAppApiError(
      "WhatsApp API error",
      500,
      JSON.stringify(raw)
    );

    expect(error.raw).toEqual(raw);
    expect(error.code).toBeUndefined();
    expect(error.details).toBeUndefined();
    expect(error.subcode).toBeUndefined();
    expect(error.traceId).toBeUndefined();
  });

  it("preserves error code zero without requiring optional fields", () => {
    const error = new WhatsAppApiError(
      "WhatsApp API error",
      400,
      JSON.stringify({ error: { code: 0 } })
    );

    expect(error.code).toBe("0");
    expect(error.details).toBeUndefined();
    expect(error.subcode).toBeUndefined();
    expect(error.traceId).toBeUndefined();
  });
});
