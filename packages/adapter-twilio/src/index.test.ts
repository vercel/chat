import type { ChatInstance } from "chat";
import { Message } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTwilioContentCacheForTests } from "./api/content";
import { createTwilioAdapter } from "./index";

describe("TwilioAdapter", () => {
  beforeEach(() => {
    resetTwilioContentCacheForTests();
  });
  it("encodes and decodes phone and channel-address thread ids", () => {
    const adapter = createTwilioAdapter();
    const thread = {
      recipient: "whatsapp:+15550000002",
      sender: "whatsapp:+15550000001",
    };

    const threadId = adapter.encodeThreadId(thread);

    expect(threadId).toBe(
      "twilio:whatsapp%3A%2B15550000001:whatsapp%3A%2B15550000002"
    );
    expect(adapter.decodeThreadId(threadId)).toEqual(thread);
    expect(adapter.channelIdFromThreadId(threadId)).toBe(
      "twilio:whatsapp%3A%2B15550000001"
    );
  });

  it("opens dms with the configured phone number", async () => {
    const adapter = createTwilioAdapter({ phoneNumber: "+15550000001" });

    await expect(adapter.openDM("+15550000002")).resolves.toBe(
      "twilio:%2B15550000001:%2B15550000002"
    );
  });

  it("routes incoming message webhooks to chat processing", async () => {
    const chat = mockChat();
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

  it("routes button webhook to processAction", async () => {
    const chat = mockChat();
    const adapter = createTwilioAdapter({
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      formRequest({
        ButtonPayload: 'chat:{"a":"approve","v":"prod"}',
        ButtonText: "Approve",
        From: "rcs:+15550000002",
        MessageSid: "SM789",
        To: "rcs:+15550000001",
      })
    );

    expect(response.status).toBe(200);
    expect(chat.processAction).toHaveBeenCalledOnce();
    const call = chat.processAction.mock.calls[0]?.[0];
    expect(call.actionId).toBe("approve");
    expect(call.value).toBe("prod");
    expect(call.user.userId).toBe("rcs:+15550000002");
  });

  it("uses buttonText as value fallback for prefixed payloads without value", async () => {
    const chat = mockChat();
    const adapter = createTwilioAdapter({
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      formRequest({
        ButtonPayload: 'chat:{"a":"confirm"}',
        ButtonText: "Confirm",
        From: "+15550000002",
        MessageSid: "SM789",
        To: "+15550000001",
      })
    );

    const call = chat.processAction.mock.calls[0]?.[0];
    expect(call.actionId).toBe("confirm");
    expect(call.value).toBe("Confirm");
  });

  it("passes through non-prefixed button payloads", async () => {
    const chat = mockChat();
    const adapter = createTwilioAdapter({
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      formRequest({
        ButtonPayload: "legacy_id",
        ButtonText: "Click Me",
        From: "+15550000002",
        MessageSid: "SM789",
        To: "+15550000001",
      })
    );

    const call = chat.processAction.mock.calls[0]?.[0];
    expect(call.actionId).toBe("legacy_id");
    expect(call.value).toBe("legacy_id");
  });

  it("includes location attachment for webhook with coordinates", async () => {
    const chat = mockChat();
    const adapter = createTwilioAdapter({
      fetch: mockFetch("data"),
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      formRequest({
        Address: "123 Main St",
        Body: "",
        From: "rcs:+15550000002",
        Label: "Office",
        Latitude: "37.7749",
        Longitude: "-122.4194",
        MessageSid: "SM456",
        NumMedia: "0",
        To: "rcs:+15550000001",
      })
    );

    expect(chat.processMessage).toHaveBeenCalledOnce();
    const message = chat.processMessage.mock.calls[0]?.[2];
    const locationAttachment = message.attachments.find((a: { url?: string }) =>
      a.url?.startsWith("geo:")
    );
    expect(locationAttachment).toBeDefined();
    expect(locationAttachment.fetchMetadata).toMatchObject({
      latitude: "37.7749",
      longitude: "-122.4194",
      address: "123 Main St",
      label: "Office",
    });
  });

  it("posts RCS cards via Content API for messaging service senders", async () => {
    let callIndex = 0;
    const fetch = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
        return Response.json({ sid: "HX123" });
      }
      return Response.json({
        body: null,
        direction: "outbound-api",
        from: "MG123",
        messaging_service_sid: "MG123",
        sid: "SM456",
        to: "+15550000002",
      });
    });

    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      messagingServiceSid: "MG123",
    });

    const result = await adapter.postMessage("twilio:MG123:%2B15550000002", {
      card: {
        children: [
          {
            children: [{ id: "yes", label: "Yes", type: "button" as const }],
            type: "actions" as const,
          },
        ],
        title: "Confirm?",
        type: "card" as const,
      },
    });

    expect(result.id).toBe("SM456");
    expect(fetch).toHaveBeenCalledTimes(2);
    const contentCall = fetch.mock.calls[0];
    expect(String(contentCall?.[0])).toContain("content.twilio.com");
    const messageCall = fetch.mock.calls[1];
    const body = messageCall?.[1]?.body as URLSearchParams;
    expect(body.get("ContentSid")).toBe("HX123");
  });

  it("reuses ContentSid cache for identical RCS cards", async () => {
    let callIndex = 0;
    const fetch = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
        return Response.json({ sid: "HX123" });
      }
      return Response.json({
        body: null,
        direction: "outbound-api",
        from: "MG123",
        sid: `SM${callIndex}`,
        to: "+15550000002",
      });
    });

    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      messagingServiceSid: "MG123",
    });

    const cardMessage = {
      card: {
        children: [
          {
            children: [{ id: "yes", label: "Yes", type: "button" as const }],
            type: "actions" as const,
          },
        ],
        title: "Confirm?",
        type: "card" as const,
      },
    };

    await adapter.postMessage("twilio:MG123:%2B15550000002", cardMessage);
    await adapter.postMessage("twilio:MG123:%2B15550000002", cardMessage);

    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("content.twilio.com");
    expect(String(fetch.mock.calls[1]?.[0])).toContain("Messages.json");
    expect(String(fetch.mock.calls[2]?.[0])).toContain("Messages.json");
  });

  it("falls back to text when Content API fails", async () => {
    let callIndex = 0;
    const fetch = vi.fn(async () => {
      callIndex++;
      if (callIndex === 1) {
        return Response.json({ error: "fail" }, { status: 500 });
      }
      return Response.json({
        body: "Confirm?",
        direction: "outbound-api",
        from: "MG123",
        sid: "SM789",
        to: "+15550000002",
      });
    });

    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      messagingServiceSid: "MG123",
    });

    const result = await adapter.postMessage("twilio:MG123:%2B15550000002", {
      card: {
        children: [
          {
            children: [{ id: "yes", label: "Yes", type: "button" as const }],
            type: "actions" as const,
          },
        ],
        title: "Confirm?",
        type: "card" as const,
      },
    });

    expect(result.id).toBe("SM789");
    const messageBody = fetch.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(messageBody.get("Body")).toContain("Confirm?");
    expect(messageBody.has("ContentSid")).toBe(false);
  });

  it("sends plain text cards for non-RCS senders", async () => {
    const fetch = mockFetch({
      body: "Card text",
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

    await adapter.postMessage("twilio:%2B15550000001:%2B15550000002", {
      card: {
        children: [
          {
            children: [{ id: "ok", label: "OK", type: "button" as const }],
            type: "actions" as const,
          },
        ],
        title: "Alert",
        type: "card" as const,
      },
    });

    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Body")).toContain("Alert");
    expect(body.has("ContentSid")).toBe(false);
  });

  it("returns TwiML for status webhooks", async () => {
    const chat = mockChat();
    const adapter = createTwilioAdapter({
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    const response = await adapter.handleWebhook(
      formRequest({
        ChannelPrefix: "rcs",
        EventType: "READ",
        From: "+15550000002",
        MessageSid: "SM123",
        MessageStatus: "delivered",
        To: "+15550000001",
      })
    );

    expect(response.status).toBe(200);
    expect(chat.processMessage).not.toHaveBeenCalled();
    expect(chat.processAction).not.toHaveBeenCalled();
  });

  it("throws on parsing action webhooks as messages", () => {
    const adapter = createTwilioAdapter();
    expect(() =>
      adapter.parseMessage({
        buttonPayload: "test",
        from: "+1",
        kind: "action",
        raw: new URLSearchParams(),
        to: "+2",
      } as never)
    ).toThrow("Cannot parse action webhook");
  });
});

function formRequest(fields: Record<string, string>): Request {
  return new Request("https://example.com/twilio", {
    body: new URLSearchParams(fields),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
  });
}

function mockChat() {
  return {
    getLogger: () => ({ child: () => console }),
    processAction: vi.fn(),
    processMessage: vi.fn(),
  } as unknown as ChatInstance & {
    processAction: ReturnType<typeof vi.fn>;
    processMessage: ReturnType<typeof vi.fn>;
  };
}

function mockFetch(body: unknown) {
  return vi.fn(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      })
  );
}
