import { createMockChatInstance, threadIdContract } from "@chat-adapter/tests";
import { Message } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createTwilioAdapter, type TwilioThreadId } from "./index";

describe("TwilioAdapter", () => {
  it("derives the channel id from a thread's sender", () => {
    // Encode/decode round-trips and pinned encoded strings live in the shared
    // `threadIdContract` at the bottom of this file; channelIdFromThreadId is
    // not covered by the contract, so it stays asserted here.
    const adapter = createTwilioAdapter();

    expect(
      adapter.channelIdFromThreadId(
        "twilio:whatsapp%3A%2B15550000001:whatsapp%3A%2B15550000002"
      )
    ).toBe("twilio:whatsapp%3A%2B15550000001");
  });

  it("opens dms with the configured phone number", async () => {
    const adapter = createTwilioAdapter({ phoneNumber: "+15550000001" });

    await expect(adapter.openDM("+15550000002")).resolves.toBe(
      "twilio:%2B15550000001:%2B15550000002"
    );
  });

  it("routes incoming message webhooks to chat processing", async () => {
    const chat = createMockChatInstance();
    const adapter = createTwilioAdapter({
      fetch: mockFetch("media"),
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      formRequest({
        Body: "hello",
        From: "+15550000002",
        MediaContentType0: "image/jpeg",
        MediaUrl0: "https://api.twilio.com/media/photo",
        MessageSid: "SM123",
        NumMedia: "1",
        To: "+15550000001",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<Response></Response>");
    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId, message] = chat.processMessage.mock.calls[0] ?? [];
    expect(threadId).toBe("twilio:%2B15550000001:%2B15550000002");
    expect(message).toBeInstanceOf(Message);
    expect(message.text).toBe("hello");
    expect(message.attachments[0]).toMatchObject({
      mimeType: "image/jpeg",
      type: "image",
      url: "https://api.twilio.com/media/photo",
    });
  });

  it("rehydrates private media fetchers with adapter credentials", async () => {
    const fetch = mockFetch("photo");
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
    });
    const attachment = adapter.rehydrateAttachment({
      fetchMetadata: { twilioMediaUrl: "https://api.twilio.com/media/photo" },
      type: "image",
    });

    const data = await attachment.fetchData?.();

    expect(data?.toString()).toBe("photo");
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      authorization: "Basic QUMxMjM6dG9rZW4=",
    });
  });

  it("posts SMS messages through the Messages API", async () => {
    const fetch = mockFetch({
      body: "hello",
      direction: "outbound-api",
      from: "+15550000001",
      sid: "SM123",
      to: "+15550000002",
    });
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      phoneNumber: "+15550000001",
    });

    const result = await adapter.postMessage(
      "twilio:%2B15550000001:%2B15550000002",
      "hello"
    );

    expect(result).toMatchObject({
      id: "SM123",
      threadId: "twilio:%2B15550000001:%2B15550000002",
    });
    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Body")).toBe("hello");
    expect(body.get("From")).toBe("+15550000001");
    expect(body.get("To")).toBe("+15550000002");
  });

  it("keeps messaging service threads stable after sending", async () => {
    const fetch = mockFetch({
      body: "hello",
      direction: "outbound-api",
      from: "+15550000001",
      messaging_service_sid: "MG123",
      sid: "SM123",
      to: "+15550000002",
    });
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
    });

    const result = await adapter.postMessage(
      "twilio:MG123:%2B15550000002",
      "hello"
    );

    expect(result.threadId).toBe("twilio:MG123:%2B15550000002");
  });

  it("parses inbound REST messages with the sender as author", () => {
    const adapter = createTwilioAdapter();

    const message = adapter.parseMessage({
      body: "hello",
      date_created: "Tue, 01 Apr 2025 12:00:00 +0000",
      direction: "inbound",
      from: "+15550000002",
      sid: "SM123",
      to: "+15550000001",
    });

    expect(message.author.userId).toBe("+15550000002");
    expect(message.author.isMe).toBe(false);
    expect(message.threadId).toBe("twilio:%2B15550000001:%2B15550000002");
  });

  it("posts MMS messages from attachment URLs", async () => {
    const fetch = mockFetch({
      body: "photo",
      direction: "outbound-api",
      from: "+15550000001",
      sid: "SM123",
      to: "+15550000002",
    });
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
    });

    await adapter.postMessage("twilio:%2B15550000001:%2B15550000002", {
      attachments: [
        {
          type: "image",
          url: "https://example.com/photo.jpg",
        },
      ],
      markdown: "photo",
    });

    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("MediaUrl")).toBe("https://example.com/photo.jpg");
  });

  it("posts media-only MMS messages without a blank body", async () => {
    const fetch = mockFetch({
      direction: "outbound-api",
      from: "+15550000001",
      sid: "SM123",
      to: "+15550000002",
    });
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
    });

    await adapter.postMessage("twilio:%2B15550000001:%2B15550000002", {
      attachments: [
        {
          type: "image",
          url: "https://example.com/photo.jpg",
        },
      ],
      markdown: "",
    });

    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.has("Body")).toBe(false);
    expect(body.get("MediaUrl")).toBe("https://example.com/photo.jpg");
  });

  it("rejects media attachments without public URLs", async () => {
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch: mockFetch({ sid: "SM123" }),
    });

    await expect(
      adapter.postMessage("twilio:%2B15550000001:%2B15550000002", {
        attachments: [
          {
            type: "image",
          },
        ],
        markdown: "photo",
      })
    ).rejects.toThrow("public URL");
  });

  it("uses messaging service senders", async () => {
    const fetch = mockFetch({
      body: "hello",
      direction: "outbound-api",
      from: "MG123",
      messaging_service_sid: "MG123",
      sid: "SM123",
      to: "+15550000002",
    });
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      messagingServiceSid: "MG123",
    });

    await adapter.postMessage("twilio:MG123:%2B15550000002", "hello");

    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("MessagingServiceSid")).toBe("MG123");
    expect(body.has("From")).toBe(false);
  });
});

const threadIdAdapter = createTwilioAdapter();

threadIdContract<TwilioThreadId>({
  name: "twilio",
  encode: (decoded) => threadIdAdapter.encodeThreadId(decoded),
  decode: (id) => threadIdAdapter.decodeThreadId(id),
  cases: [
    {
      // Plain SMS phone numbers: the leading `+` is URL-encoded to `%2B`.
      decoded: { recipient: "+15550000002", sender: "+15550000001" },
      encoded: "twilio:%2B15550000001:%2B15550000002",
    },
    {
      // Channel-addressed ids (e.g. WhatsApp) also encode the `:` as `%3A`.
      decoded: {
        recipient: "whatsapp:+15550000002",
        sender: "whatsapp:+15550000001",
      },
      encoded: "twilio:whatsapp%3A%2B15550000001:whatsapp%3A%2B15550000002",
    },
    {
      // Messaging-service senders (`MG…`) survive the round-trip untouched.
      decoded: { recipient: "+15550000002", sender: "MG123" },
      encoded: "twilio:MG123:%2B15550000002",
    },
  ],
});

function formRequest(fields: Record<string, string>): Request {
  return new Request("https://example.com/twilio", {
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function mockFetch(body: unknown) {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      })
  );
}
