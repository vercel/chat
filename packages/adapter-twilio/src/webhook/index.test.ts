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
});
