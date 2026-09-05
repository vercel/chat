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
      code: "AUTH_FAILED",
      errorCode: 190,
      status: 401,
      providerMessage: "Invalid token",
      type: "OAuthException",
      subcode: 463,
      details: raw.error.error_data.details,
      traceId: "trace123",
      raw,
      message: "WhatsApp API error: 401 Invalid token",
    });
  });

  it.each([
    { status: 400, code: 130_429, expected: "RATE_LIMITED" },
    { status: 400, code: 80_007, expected: "RATE_LIMITED" },
    { status: 429, code: 100, expected: "RATE_LIMITED" },
    { status: 400, code: 190, expected: "AUTH_FAILED" },
    { status: 401, code: 100, expected: "AUTH_FAILED" },
    { status: 400, code: 10, expected: "PERMISSION_DENIED" },
    { status: 400, code: 200, expected: "PERMISSION_DENIED" },
    { status: 403, code: 100, expected: "PERMISSION_DENIED" },
    { status: 404, code: 100, expected: "NOT_FOUND" },
    { status: 400, code: 131_047, expected: undefined },
    { status: 500, code: undefined, expected: undefined },
  ])("maps status $status and Meta code $code to $expected", ({
    status,
    code,
    expected,
  }) => {
    const error = new WhatsAppApiError(
      "WhatsApp API error",
      status,
      JSON.stringify({ error: { code } })
    );

    expect(error.code).toBe(expected);
    expect(error.errorCode).toBe(code);
  });

  it("accepts numeric strings from proxies in front of the Cloud API", () => {
    const error = new WhatsAppApiError(
      "WhatsApp API error",
      400,
      JSON.stringify({ error: { code: "130429", error_subcode: "2494055" } })
    );

    expect(error.code).toBe("RATE_LIMITED");
    expect(error.errorCode).toBe(130_429);
    expect(error.subcode).toBe(2_494_055);
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
    expect(error.errorCode).toBeUndefined();
    expect(error.message).toBe(`WhatsApp API error: 502 ${body}`);
  });

  it("bounds a long non-JSON body in the message and keeps it whole in raw", () => {
    const body = "x".repeat(2000);
    const error = new WhatsAppApiError("WhatsApp API error", 502, body);

    expect(error.raw).toBe(body);
    expect(error.message).toBe(`WhatsApp API error: 502 ${"x".repeat(500)}…`);
  });

  it("falls back to the body when Meta omits a message", () => {
    const body = JSON.stringify({ error: { code: 100 } });
    const error = new WhatsAppApiError("WhatsApp API error", 400, body);

    expect(error.providerMessage).toBeUndefined();
    expect(error.message).toBe(`WhatsApp API error: 400 ${body}`);
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
        error_subcode: "4.5",
        error_data: { details: [] },
        fbtrace_id: 123,
        message: ["nope"],
        type: 7,
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
    expect(error.errorCode).toBeUndefined();
    expect(error.providerMessage).toBeUndefined();
    expect(error.type).toBeUndefined();
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

    expect(error.errorCode).toBe(0);
    expect(error.code).toBe("AUTH_FAILED");
    expect(error.details).toBeUndefined();
    expect(error.subcode).toBeUndefined();
    expect(error.traceId).toBeUndefined();
  });
});
