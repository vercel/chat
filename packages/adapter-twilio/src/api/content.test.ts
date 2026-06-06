import { describe, expect, it, vi } from "vitest";
import { createTwilioContent } from "./content";

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
