import { describe, expect, it, vi } from "vitest";
import {
  callTwilioApi,
  deleteTwilioMessage,
  fetchTwilioMedia,
  fetchTwilioMessage,
  listTwilioMessages,
  sendTwilioMessage,
  TwilioApiError,
  updateTwilioCall,
} from "./index";

describe("Twilio api helpers", () => {
  it("supports object-shaped raw API calls", async () => {
    const request = mockFetch({ ok: true });

    const response = await callTwilioApi({
      apiBaseUrl: "https://twilio.test",
      body: { Body: "hello", Optional: undefined, To: "+15550000002" },
      credentials: credentials(),
      fetch: request,
      path: "/2010-04-01/Accounts/AC123/Messages.json",
    });

    expect(response.ok).toBe(true);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://twilio.test/2010-04-01/Accounts/AC123/Messages.json"
    );
    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({
      Body: "hello",
      To: "+15550000002",
    });
  });

  it("sends form encoded messages with phone number sender", async () => {
    const request = mockFetch({ sid: "SM123" });

    const message = await sendTwilioMessage({
      body: "hello",
      credentials: credentials(),
      fetch: request,
      from: "+15550000001",
      mediaUrl: ["https://example.com/photo.jpg"],
      statusCallbackUrl: "https://example.com/status",
      to: "+15550000002",
    });

    expect(message.sid).toBe("SM123");
    expect(request).toHaveBeenCalledWith(
      new URL("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json"),
      expect.objectContaining({
        body: expect.any(URLSearchParams),
        method: "POST",
      })
    );
    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Body")).toBe("hello");
    expect(body.get("From")).toBe("+15550000001");
    expect(body.get("MediaUrl")).toBe("https://example.com/photo.jpg");
    expect(body.get("StatusCallback")).toBe("https://example.com/status");
    expect(body.get("To")).toBe("+15550000002");
  });

  it("sends messages with a messaging service sid", async () => {
    const request = mockFetch({ sid: "SM123" });

    await sendTwilioMessage({
      body: "hello",
      credentials: credentials(),
      fetch: request,
      messagingServiceSid: "MG123",
      to: "+15550000002",
    });

    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("MessagingServiceSid")).toBe("MG123");
    expect(body.has("From")).toBe(false);
  });

  it("fetches messages by sid", async () => {
    const request = mockFetch({ sid: "SM123" });

    await fetchTwilioMessage({
      credentials: credentials(),
      fetch: request,
      messageSid: "SM123",
    });

    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/SM123.json"
    );
    expect(request.mock.calls[0]?.[1]?.method).toBe("GET");
  });

  it("lists messages with from and to filters", async () => {
    const request = mockFetch({
      messages: [{ sid: "SM123" }, { sid: "SM124" }],
    });

    const messages = await listTwilioMessages({
      credentials: credentials(),
      fetch: request,
      from: "+15550000001",
      limit: 1,
      pageSize: 50,
      to: "+15550000002",
    });

    expect(messages).toEqual([{ sid: "SM123" }]);
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json?From=%2B15550000001&PageSize=50&To=%2B15550000002"
    );
  });

  it("deletes messages by sid", async () => {
    const request = mockFetch(null);

    await deleteTwilioMessage({
      credentials: credentials(),
      fetch: request,
      messageSid: "SM123",
    });

    expect(request.mock.calls[0]?.[1]?.method).toBe("DELETE");
  });

  it("updates live calls with TwiML", async () => {
    const request = mockFetch({ sid: "CA123" });

    const call = await updateTwilioCall({
      callSid: "CA123",
      credentials: credentials(),
      fetch: request,
      twiml: "<Response><Say>hello</Say></Response>",
    });

    expect(call.sid).toBe("CA123");
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://api.twilio.com/2010-04-01/Accounts/AC123/Calls/CA123.json"
    );
    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Twiml")).toBe("<Response><Say>hello</Say></Response>");
  });

  it("updates live calls with a redirect URL", async () => {
    const request = mockFetch({ sid: "CA123" });

    await updateTwilioCall({
      callSid: "CA123",
      credentials: credentials(),
      fetch: request,
      method: "GET",
      url: "https://example.com/voice",
    });

    const body = request.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Method")).toBe("GET");
    expect(body.get("Url")).toBe("https://example.com/voice");
  });

  it("fetches media with basic auth", async () => {
    const request = vi.fn(async () => new Response("photo"));

    const media = await fetchTwilioMedia({
      credentials: credentials(),
      fetch: request,
      url: "https://api.twilio.com/media/photo",
    });

    expect(new TextDecoder().decode(media)).toBe("photo");
    expect(request.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Basic QUMxMjM6dG9rZW4=",
    });
  });

  it("throws TwilioApiError for non-ok responses", async () => {
    const request = mockFetch({ message: "bad" }, 400);

    await expect(
      sendTwilioMessage({
        body: "hello",
        credentials: credentials(),
        fetch: request,
        from: "+15550000001",
        to: "+15550000002",
      })
    ).rejects.toBeInstanceOf(TwilioApiError);
  });

  it("rejects ambiguous call updates", async () => {
    await expect(
      updateTwilioCall({
        callSid: "CA123",
        credentials: credentials(),
        fetch: mockFetch({ sid: "CA123" }),
        twiml: "<Response></Response>",
        url: "https://example.com/voice",
      })
    ).rejects.toThrow("mutually exclusive");
  });
});

function credentials() {
  return {
    accountSid: "AC123",
    authToken: "token",
  };
}

function mockFetch(body: unknown, status = 200) {
  return vi.fn(
    async () =>
      new Response(body === null ? null : JSON.stringify(body), {
        headers: { "content-type": "application/json" },
        status,
      })
  );
}
