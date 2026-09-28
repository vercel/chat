import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTwilioContent,
  getOrCreateTwilioContent,
  resetTwilioContentCacheForTests,
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

// Identity used by previously created remote templates; changing it would
// create duplicates after a deploy instead of reusing the existing ContentSid.
const EXISTING_TEMPLATE_NAME = "chat_sdk_quick-reply_fde60981109a4c7b";

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

  function emptyLibraryRequest(sid = "HX123") {
    // GET is the friendly_name lookup (empty library), POST is the create.
    return vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) =>
      init?.method === "GET"
        ? Response.json({ contents: [], meta: {} })
        : Response.json({ sid })
    );
  }

  it("uses a stable friendly_name derived from content hash", async () => {
    const request = emptyLibraryRequest();

    await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    const createCall = request.mock.calls.find(
      ([, init]) => init?.method === "POST"
    );
    const body = JSON.parse(createCall?.[1]?.body as string);
    expect(body.friendly_name).toBe(EXISTING_TEMPLATE_NAME);
  });

  it("reuses cached ContentSid for identical content bodies", async () => {
    const request = emptyLibraryRequest();

    const options = {
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    };

    const first = await getOrCreateTwilioContent(options);
    const second = await getOrCreateTwilioContent(options);

    expect(first.sid).toBe("HX123");
    expect(second.sid).toBe("HX123");
    // One lookup plus one create; the second call is served from cache.
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not share cached ContentSids across accounts", async () => {
    const requestA = emptyLibraryRequest("HX_A");
    const requestB = emptyLibraryRequest("HX_B");

    const first = await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC_A", authToken: "token" },
      fetch: requestA,
    });
    const second = await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC_B", authToken: "token" },
      fetch: requestB,
    });

    expect(first.sid).toBe("HX_A");
    expect(second.sid).toBe("HX_B");
    expect(requestB).toHaveBeenCalledTimes(2);
  });

  it("reuses a template created by a previous process", async () => {
    const request = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        if (init?.method === "GET") {
          return Response.json({
            contents: [
              {
                friendly_name: EXISTING_TEMPLATE_NAME,
                sid: "HX999",
              },
            ],
            meta: {},
          });
        }
        throw new Error("create should not be called");
      }
    );

    const result = await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    expect(result.sid).toBe("HX999");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("recovers the existing template when create reports a duplicate", async () => {
    let listCalls = 0;
    const request = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        if (init?.method === "GET") {
          listCalls += 1;
          return listCalls === 1
            ? Response.json({ contents: [], meta: {} })
            : Response.json({
                contents: [
                  {
                    friendly_name: EXISTING_TEMPLATE_NAME,
                    sid: "HX999",
                  },
                ],
                meta: {},
              });
        }
        return Response.json(
          { message: "Friendly Name exists" },
          { status: 400 }
        );
      }
    );

    const result = await getOrCreateTwilioContent({
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    expect(result.sid).toBe("HX999");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("honors the apiUrl override when contentApiUrl is not set", async () => {
    const request = emptyLibraryRequest();

    await getOrCreateTwilioContent({
      apiUrl: "https://twilio.mock.test",
      contentBody: sampleContentBody,
      credentials: { accountSid: "AC123", authToken: "token" },
      fetch: request,
    });

    for (const [url] of request.mock.calls) {
      expect(String(url)).toContain("https://twilio.mock.test/v1/Content");
    }
  });
});
