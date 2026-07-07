import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTwilioContent,
  getOrCreateTwilioContent,
  resetTwilioContentCacheForTests,
  twilioContentCacheKey,
  twilioContentFriendlyName,
} from "./content";

const sampleContentBody = {
  language: "en",
  types: {
    "twilio/quick-reply": {
      body: "Pick one",
      actions: [{ id: 'chat:{"a":"yes"}', title: "Yes", type: "quick_reply" }],
    },
    "twilio/text": { body: "Pick one: Yes" },
  },
} as const;

const STABLE_FRIENDLY_NAME_PATTERN = /^chat_sdk_quick-reply_[a-f0-9]{16}$/;

describe("createTwilioContent", () => {
  it("posts JSON to the Content API", async () => {
    const request = vi.fn(async () =>
      Response.json({ sid: "HX123", friendly_name: "test" })
    );

    const result = await createTwilioContent({
      contentBody: {
        friendly_name: "test",
        language: "en",
        types: {
          "twilio/quick-reply": {
            body: "Pick one",
            actions: [
              { id: 'chat:{"a":"yes"}', title: "Yes", type: "quick_reply" },
            ],
          },
          "twilio/text": { body: "Pick one: Yes" },
        },
      },
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    expect(result.sid).toBe("HX123");
    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://content.twilio.com/v1/Content"
    );
    const options = request.mock.calls[0]?.[1];
    expect(options?.method).toBe("POST");
    expect(options?.headers).toMatchObject({
      authorization: "Basic QUMxMjM6dG9rZW4=",
      "content-type": "application/json",
    });
    const body = JSON.parse(options?.body as string);
    expect(body.friendly_name).toBe("test");
  });

  it("uses custom contentApiUrl when provided", async () => {
    const request = vi.fn(async () => Response.json({ sid: "HX456" }));

    await createTwilioContent({
      contentApiUrl: "https://content.test",
      contentBody: {
        friendly_name: "test",
        language: "en",
        types: { "twilio/text": { body: "hello" } },
      },
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    expect(String(request.mock.calls[0]?.[0])).toBe(
      "https://content.test/v1/Content"
    );
  });

  it("throws on non-ok responses", async () => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "bad request" }), {
          headers: { "content-type": "application/json" },
          status: 400,
        })
    );

    await expect(
      createTwilioContent({
        contentBody: {
          friendly_name: "test",
          language: "en",
          types: {},
        },
        credentials: { accountSid: "AC123", authToken: "token" },
        fetch: request,
      })
    ).rejects.toThrow("Content API returned HTTP 400");
  });
});

describe("getOrCreateTwilioContent", () => {
  beforeEach(() => {
    resetTwilioContentCacheForTests();
  });

  it("uses a stable friendly_name derived from content hash", async () => {
    const request = vi.fn(async () => Response.json({ sid: "HX123" }));

    await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    const body = JSON.parse(request.mock.calls[0]?.[1]?.body as string);
    expect(body.friendly_name).toBe(
      twilioContentFriendlyName(sampleContentBody)
    );
    expect(body.friendly_name).toMatch(STABLE_FRIENDLY_NAME_PATTERN);
  });

  it("reuses cached ContentSid for identical content bodies", async () => {
    const request = vi.fn(async () => Response.json({ sid: "HX123" }));

    const options = {
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    };

    const first = await getOrCreateTwilioContent(options);
    const second = await getOrCreateTwilioContent(options);

    expect(first.sid).toBe("HX123");
    expect(second.sid).toBe("HX123");
    expect(request).toHaveBeenCalledTimes(1);
    expect(twilioContentCacheKey(sampleContentBody)).toHaveLength(64);
  });

  it("looks up existing templates when friendly_name already exists", async () => {
    const request = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/v1/Content") && !href.includes("PageSize")) {
        return Response.json(
          { message: "Friendly Name exists" },
          { status: 400 }
        );
      }
      return Response.json({
        contents: [
          {
            friendly_name: twilioContentFriendlyName(sampleContentBody),
            sid: "HX999",
          },
        ],
        meta: {},
      });
    });

    const result = await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    expect(result.sid).toBe("HX999");
    expect(request).toHaveBeenCalledTimes(2);
  });
});
