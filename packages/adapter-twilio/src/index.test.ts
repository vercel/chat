import {
  createMockChatInstance,
  createMockLogger,
  createMockState,
  createTestMessage,
  threadIdContract,
} from "@chat-adapter/tests";
import { Chat, Message } from "chat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTwilioContentCacheForTests } from "./api/content";
import { createTwilioAdapter, type TwilioThreadId } from "./index";

describe("TwilioAdapter", () => {
  beforeEach(() => {
    resetTwilioContentCacheForTests();
  });

  it("uses the full DM thread id as its channel id", () => {
    // Encode/decode round-trips and pinned encoded strings live in the shared
    // `threadIdContract` at the bottom of this file; channelIdFromThreadId is
    // not covered by the contract, so it stays asserted here.
    const adapter = createTwilioAdapter();

    expect(
      adapter.channelIdFromThreadId(
        "twilio:whatsapp%3A%2B15550000001:whatsapp%3A%2B15550000002"
      )
    ).toBe("twilio:whatsapp%3A%2B15550000001:whatsapp%3A%2B15550000002");
  });

  it("isolates concurrent recipients with thread-scoped locks", async () => {
    const state = createMockState();
    const adapter = createTwilioAdapter();
    const chat = new Chat({
      adapters: { twilio: adapter },
      logger: createMockLogger(),
      state,
      userName: "bot",
    });
    const first = "twilio:%2B15550000001:%2B15550000002";
    const second = "twilio:%2B15550000001:%2B15550000003";
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let resume = () => {};
    const started = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const handled = vi.fn(async (_thread, message) => {
      if (message.id === "SM1") {
        resume();
        await hold;
      }
    });
    chat.onDirectMessage(handled);

    const task = chat.handleIncomingMessage(
      adapter,
      first,
      createTestMessage("SM1", "first", { threadId: first })
    );
    await started;

    try {
      await expect(
        chat.handleIncomingMessage(
          adapter,
          second,
          createTestMessage("SM2", "second", { threadId: second })
        )
      ).resolves.toBeUndefined();
    } finally {
      release();
      await task;
    }

    expect(adapter.channelIdFromThreadId(first)).toBe(first);
    expect(adapter.channelIdFromThreadId(second)).toBe(second);
    expect(adapter.channelIdFromThreadId(first)).not.toBe(
      adapter.channelIdFromThreadId(second)
    );
    expect(state.acquireLock).toHaveBeenCalledWith(first, expect.any(Number));
    expect(state.acquireLock).toHaveBeenCalledWith(second, expect.any(Number));
    expect(handled).toHaveBeenCalledTimes(2);
  });

  it("opens dms with the configured phone number", async () => {
    const adapter = createTwilioAdapter({ phoneNumber: "+15550000001" });

    await expect(adapter.openDM("+15550000002")).resolves.toBe(
      "twilio:%2B15550000001:%2B15550000002"
    );
  });

  it("opens dms with the configured rcs sender id", async () => {
    const adapter = createTwilioAdapter({ rcsSenderId: "brand_agent" });

    await expect(adapter.openDM("+15550000002")).resolves.toBe(
      "twilio:rcs%3Abrand_agent:%2B15550000002"
    );
  });

  it("prefers the phone number for openDM when every sender is configured", async () => {
    // Matches the adapter's pre-RCS behavior so upgrades don't change the
    // thread ids of proactive DMs.
    const adapter = createTwilioAdapter({
      messagingServiceSid: "MG123",
      phoneNumber: "+15550000001",
      rcsSenderId: "brand_agent",
    });

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

  it("passes location attachments through rehydration untouched", () => {
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
    });
    const attachment = {
      fetchMetadata: {
        address: "123 Main St",
        latitude: "37.7749",
        longitude: "-122.4194",
      },
      type: "file" as const,
      url: "geo:37.7749,-122.4194",
    };

    const rehydrated = adapter.rehydrateAttachment(attachment);

    expect(rehydrated).toBe(attachment);
    expect(rehydrated.fetchData).toBeUndefined();
  });

  it("rejects rehydrated media from an untrusted origin", async () => {
    const fetch = mockFetch("photo");
    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
    });
    const attachment = adapter.rehydrateAttachment({
      fetchMetadata: {
        twilioMediaUrl: "https://attacker.example/media/photo",
      },
      type: "image",
    });

    await expect(attachment.fetchData?.()).rejects.toThrow(
      "configured Twilio API origin"
    );
    expect(fetch).not.toHaveBeenCalled();
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
    const chat = createMockChatInstance();
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
    const chat = createMockChatInstance();
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
    const chat = createMockChatInstance();
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
    const chat = createMockChatInstance();
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
    const fetch = mockRcsFetch({
      messageResource: {
        body: null,
        direction: "outbound-api",
        from: "MG123",
        messaging_service_sid: "MG123",
        sid: "SM456",
        to: "+15550000002",
      },
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
    // Lookup, create, then send.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[0]?.[0])).toContain("content.twilio.com");
    const body = messageCalls(fetch)[0]?.[1]?.body as URLSearchParams;
    expect(body.get("ContentSid")).toBe("HX123");
  });

  it("posts RCS cards when replying to inbound RCS on a phone-number To", async () => {
    const fetch = mockRcsFetch({
      messageResource: {
        body: null,
        direction: "outbound-api",
        from: "MG123",
        messaging_service_sid: "MG123",
        sid: "SM456",
        to: "+15550000002",
      },
    });

    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      messagingServiceSid: "MG123",
    });

    const threadId = "twilio:MG123:%2B15550000002";
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

    const result = await adapter.postMessage(threadId, cardMessage);

    expect(result.id).toBe("SM456");
    const messageBody = messageCalls(fetch)[0]?.[1]?.body as URLSearchParams;
    expect(messageBody.get("ContentSid")).toBe("HX123");
    expect(messageBody.get("MessagingServiceSid")).toBe("MG123");
  });

  it("propagates send failures after a content template resolves", async () => {
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).includes("/v1/Content")) {
        return init?.method === "GET"
          ? Response.json({ contents: [], meta: {} })
          : Response.json({ sid: "HX123" });
      }
      return Response.json({ error: "boom" }, { status: 500 });
    });

    const adapter = createTwilioAdapter({
      accountSid: "AC123",
      authToken: "token",
      fetch,
      messagingServiceSid: "MG123",
    });

    await expect(
      adapter.postMessage("twilio:MG123:%2B15550000002", {
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
      })
    ).rejects.toThrow();

    // A failed send must not fall back to a text message: the RCS card may
    // have been delivered, and a fallback would duplicate it.
    expect(messageCalls(fetch)).toHaveLength(1);
  });

  it("keeps plain SMS threads keyed by phone number under a messaging service", async () => {
    // Twilio attaches MessagingServiceSid to every inbound webhook for
    // numbers in a Messaging Service; non-RCS threads must not be rekeyed.
    const chat = createMockChatInstance();
    const adapter = createTwilioAdapter({
      messagingServiceSid: "MG123",
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      formRequest({
        Body: "hello",
        From: "+15550000002",
        MessageSid: "SM122",
        MessagingServiceSid: "MG123",
        NumMedia: "0",
        To: "+15550000001",
      })
    );

    const [, threadId] = chat.processMessage.mock.calls[0] ?? [];
    expect(threadId).toBe("twilio:%2B15550000001:%2B15550000002");
  });

  it("routes inbound RCS webhooks to messaging-service thread ids", async () => {
    const chat = createMockChatInstance();
    const adapter = createTwilioAdapter({
      messagingServiceSid: "MG123",
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      formRequest({
        Body: "hello",
        ChannelMetadata: JSON.stringify({ type: "rcs" }),
        From: "+15550000002",
        MessageSid: "SM123",
        MessagingServiceSid: "MG123",
        NumMedia: "0",
        To: "+15550000001",
      })
    );

    expect(chat.processMessage).toHaveBeenCalledOnce();
    const [, threadId] = chat.processMessage.mock.calls[0] ?? [];
    expect(threadId).toBe("twilio:MG123:%2B15550000002");
  });

  it("uses configured messaging service when inbound RCS metadata lacks MG", async () => {
    const chat = createMockChatInstance();
    const adapter = createTwilioAdapter({
      messagingServiceSid: "MG123",
      webhookVerifier: () => true,
    });
    await adapter.initialize(chat);

    await adapter.handleWebhook(
      formRequest({
        Body: "hello",
        ChannelMetadata: JSON.stringify({ type: "rcs" }),
        From: "+15550000002",
        MessageSid: "SM124",
        NumMedia: "0",
        To: "+15550000001",
      })
    );

    const [, threadId] = chat.processMessage.mock.calls[0] ?? [];
    expect(threadId).toBe("twilio:MG123:%2B15550000002");
  });

  it("reuses ContentSid cache for identical RCS cards", async () => {
    let messageIndex = 0;
    const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).includes("/v1/Content")) {
        return init?.method === "GET"
          ? Response.json({ contents: [], meta: {} })
          : Response.json({ sid: "HX123" });
      }
      messageIndex++;
      return Response.json({
        body: null,
        direction: "outbound-api",
        from: "MG123",
        sid: `SM${messageIndex}`,
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

    // Lookup + create once, then one Messages.json call per post.
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(messageCalls(fetch)).toHaveLength(2);
  });

  it("falls back to text when Content API fails", async () => {
    const fetch = vi.fn(async (url: URL | RequestInfo) => {
      if (String(url).includes("/v1/Content")) {
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
    const messageBody = messageCalls(fetch)[0]?.[1]?.body as URLSearchParams;
    expect(messageBody.get("Body")).toContain("Confirm?");
    expect(messageBody.has("ContentSid")).toBe(false);
  });

  it("posts actions-only cards as non-empty fallback text", async () => {
    const fetch = mockFetch({
      body: "Message from bot",
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
        type: "card" as const,
      },
    });

    const body = fetch.mock.calls[0]?.[1]?.body as URLSearchParams;
    expect(body.get("Body")).toBe("Message from bot");
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
    const chat = createMockChatInstance();
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

// Content API calls answer the friendly_name lookup (GET, empty library) and
// the create (POST); everything else gets the message resource.
function mockRcsFetch(options: {
  contentSid?: string;
  messageResource: Record<string, unknown>;
}) {
  return vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    if (String(url).includes("/v1/Content")) {
      return init?.method === "GET"
        ? Response.json({ contents: [], meta: {} })
        : Response.json({ sid: options.contentSid ?? "HX123" });
    }
    return Response.json(options.messageResource);
  });
}

function messageCalls(
  mocked: ReturnType<typeof vi.fn>
): [URL | RequestInfo, RequestInit | undefined][] {
  return mocked.mock.calls.filter((call) =>
    String(call[0]).includes("Messages.json")
  ) as [URL | RequestInfo, RequestInit | undefined][];
}
