import { afterEach, describe, expect, it, vi } from "vitest";
import { readBoundedResponseBody, sanitizeHeaderValue } from "./recorder";

afterEach(() => {
  vi.useRealTimers();
});

describe("recording boundary", () => {
  it.each([
    "authorization",
    "cookie",
    "linear-signature",
    "x-discord-gateway-token",
    "x-hub-signature-256",
    "x-notion-signature",
    "x-slack-signature",
    "x-slack-socket-token",
    "x-telegram-bot-api-secret-token",
    "x-twilio-signature",
    "x-twitter-webhooks-signature",
  ])("fully redacts %s", (name) => {
    expect(sanitizeHeaderValue(name, "reusable-secret-value")).toBe(
      "[REDACTED]"
    );
  });

  it("preserves non-sensitive headers", () => {
    expect(sanitizeHeaderValue("content-type", "application/json")).toBe(
      "application/json"
    );
  });

  it("rejects oversized response bodies while streaming", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(128 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
    });

    await expect(
      readBoundedResponseBody(new Response(stream))
    ).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects an oversized declared response before reading", async () => {
    const getReader = vi.fn();
    const response = {
      body: { getReader },
      headers: new Headers({ "content-length": String(300 * 1024) }),
    } as unknown as Response;

    await expect(readBoundedResponseBody(response)).resolves.toBeNull();
    expect(getReader).not.toHaveBeenCalled();
  });

  it("stops recording a stalled response body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));

    const body = readBoundedResponseBody(response);
    await vi.advanceTimersByTimeAsync(5000);

    await expect(body).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });
});
