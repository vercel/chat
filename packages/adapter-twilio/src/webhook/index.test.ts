import { describe, expect, it } from "vitest";
import {
  parseTwilioWebhookBody,
  readTwilioWebhook,
  signTwilioRequest,
  TwilioWebhookVerificationError,
  twilioSignatureBase,
} from "./index";

describe("Twilio webhook verification", () => {
  it("matches Twilio's documented form signature example", async () => {
    const params = new URLSearchParams({
      CallSid: "CA1234567890ABCDE",
      Caller: "+12349013030",
      Digits: "1234",
      From: "+12349013030",
      To: "+18005551212",
    });

    const signature = await signTwilioRequest({
      authToken: "12345",
      params,
      url: "https://mycompany.com/myapp",
    });

    expect(signature).toBe("3KI2uRuYyAdhZIJXcpU0izDUzWI=");
  });

  it("builds a form POST signature base with sorted parameters", () => {
    const params = new URLSearchParams();
    params.set("To", "+15550000002");
    params.set("From", "+15550000001");
    params.set("Body", "hello");

    expect(twilioSignatureBase("https://example.com/twilio", params)).toBe(
      "https://example.com/twilioBodyhelloFrom+15550000001To+15550000002"
    );
  });

  it("sorts duplicate form parameters like twilio-node", () => {
    const params = new URLSearchParams();
    params.append("MediaUrl", "https://example.com/b.jpg");
    params.append("MediaUrl", "https://example.com/a.jpg");

    expect(twilioSignatureBase("https://example.com/twilio", params)).toBe(
      "https://example.com/twilioMediaUrlhttps://example.com/a.jpgMediaUrlhttps://example.com/b.jpg"
    );
  });

  it("reads verified POST form webhooks", async () => {
    const body = new URLSearchParams({
      Body: "hello",
      From: "+15550000001",
      MessageSid: "SM123",
      NumMedia: "0",
      To: "+15550000002",
    });
    const signature = await signTwilioRequest({
      authToken: "token",
      params: body,
      url: "https://example.com/twilio",
    });

    const payload = await readTwilioWebhook(
      new Request("https://example.com/twilio", {
        body,
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": signature,
        },
        method: "POST",
      }),
      { authToken: "token" }
    );

    expect(payload).toMatchObject({
      body: "hello",
      from: "+15550000001",
      kind: "text",
      messageSid: "SM123",
      to: "+15550000002",
    });
  });

  it("reads verified GET webhooks", async () => {
    const url =
      "https://example.com/twilio?Body=hello&From=%2B15550000001&To=%2B15550000002";
    const signature = await signTwilioRequest({
      authToken: "token",
      params: null,
      url,
    });

    const payload = await readTwilioWebhook(
      new Request(url, {
        headers: { "x-twilio-signature": signature },
        method: "GET",
      }),
      { authToken: "token" }
    );

    expect(payload).toMatchObject({
      body: "hello",
      from: "+15550000001",
      kind: "text",
      to: "+15550000002",
    });
  });

  it("rejects invalid signatures", async () => {
    await expect(
      readTwilioWebhook(
        new Request("https://example.com/twilio", {
          body: "Body=hello",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-twilio-signature": "invalid",
          },
          method: "POST",
        }),
        { authToken: "token" }
      )
    ).rejects.toThrow(TwilioWebhookVerificationError);
  });
});

describe("Twilio webhook parsing", () => {
  it("parses MMS media parameters", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        Body: "photo",
        From: "+15550000001",
        MediaContentType0: "image/jpeg",
        MediaUrl0: "https://api.twilio.com/media/one",
        MessageSid: "SM123",
        NumMedia: "1",
        To: "+15550000002",
      })
    );

    expect(payload).toMatchObject({
      kind: "text",
      media: [
        {
          contentType: "image/jpeg",
          url: "https://api.twilio.com/media/one",
        },
      ],
    });
  });

  it("parses status callbacks separately", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        From: "+15550000002",
        MessageSid: "SM123",
        MessageStatus: "delivered",
        To: "+15550000001",
      })
    );

    expect(payload).toMatchObject({
      kind: "status",
      messageStatus: "delivered",
    });
  });

  it("parses ButtonPayload as action kind", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        ButtonPayload: 'chat:{"a":"approve","v":"yes"}',
        ButtonText: "Approve",
        From: "rcs:+15550000002",
        MessageSid: "SM789",
        To: "rcs:+15550000001",
      })
    );

    expect(payload).toMatchObject({
      kind: "action",
      buttonPayload: 'chat:{"a":"approve","v":"yes"}',
      buttonText: "Approve",
      from: "rcs:+15550000002",
    });
  });

  it("parses location share with latitude and longitude", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        Address: "123 Main St",
        Body: "",
        From: "rcs:+15550000002",
        Label: "Home",
        Latitude: "37.7749",
        Longitude: "-122.4194",
        MessageSid: "SM456",
        NumMedia: "0",
        To: "rcs:+15550000001",
      })
    );

    expect(payload).toMatchObject({
      kind: "text",
      latitude: "37.7749",
      longitude: "-122.4194",
      address: "123 Main St",
      label: "Home",
    });
  });

  it("parses MessagingServiceSid on inbound payloads", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        Body: "hello",
        From: "+15550000002",
        MessageSid: "SM123",
        MessagingServiceSid: "MG123",
        To: "+15550000001",
      })
    );

    expect(payload.kind).toBe("text");
    if (payload.kind === "text") {
      expect(payload.messagingServiceSid).toBe("MG123");
    }
  });

  it("parses ChannelMetadata JSON", () => {
    const metadata = JSON.stringify({ type: "rcs" });
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        Body: "hello",
        ChannelMetadata: metadata,
        From: "+15550000002",
        MessageSid: "SM123",
        To: "+15550000001",
      })
    );

    expect(payload.kind).toBe("text");
    if (payload.kind === "text") {
      expect(payload.channelMetadata).toEqual({ type: "rcs" });
    }
  });

  it("includes ChannelMetadata in action payloads", () => {
    const metadata = JSON.stringify({ type: "rcs" });
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        ButtonPayload: "approve",
        ChannelMetadata: metadata,
        From: "+15550000002",
        MessageSid: "SM123",
        To: "+15550000001",
      })
    );

    expect(payload.kind).toBe("action");
    if (payload.kind === "action") {
      expect(payload.channelMetadata).toEqual({ type: "rcs" });
    }
  });

  it("parses status with EventType and ChannelPrefix", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        ChannelPrefix: "rcs",
        EventType: "READ",
        From: "+15550000002",
        MessageSid: "SM123",
        MessageStatus: "delivered",
        To: "+15550000001",
      })
    );

    expect(payload).toMatchObject({
      kind: "status",
      eventType: "READ",
      channelPrefix: "rcs",
      messageStatus: "delivered",
    });
  });

  it("parses location-only messages without body", () => {
    const payload = parseTwilioWebhookBody(
      new URLSearchParams({
        From: "+15550000002",
        Latitude: "40.7128",
        Longitude: "-74.0060",
        MessageSid: "SM789",
        To: "+15550000001",
      })
    );

    expect(payload.kind).toBe("text");
    if (payload.kind === "text") {
      expect(payload.latitude).toBe("40.7128");
      expect(payload.longitude).toBe("-74.0060");
      expect(payload.body).toBe("");
    }
  });
});
