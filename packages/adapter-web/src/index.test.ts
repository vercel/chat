import { ValidationError } from "@chat-adapter/shared";
import { createMemoryState } from "@chat-adapter/state-memory";
import { Chat, type Message, parseMarkdown, type StreamChunk } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createWebAdapter, WebAdapter } from "./index";
import { createSseResponse, webProtocols } from "./protocol";
import type { WebMessage, WebUser } from "./types";

const TEST_USER: WebUser = { id: "u-test", name: "Test User" };

function makeUserMessage(text: string, id = "msg-1"): WebMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function makeWebRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("https://example.com/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
}

function parseSseFromText(text: string): Array<{
  type: string;
  delta?: string;
  errorText?: string;
  id?: string;
}> {
  const events: Array<{
    type: string;
    delta?: string;
    errorText?: string;
    id?: string;
  }> = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }
    const payload = line.slice(6).trim();
    if (!payload || payload === "[DONE]") {
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      // skip malformed lines
    }
  }
  return events;
}

async function readSseEvents(response: Response): Promise<unknown[]> {
  if (!response.body) {
    throw new Error("Response has no body");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: unknown[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") {
            continue;
          }
          events.push(JSON.parse(payload));
        }
      }
      idx = buffer.indexOf("\n\n");
    }
  }
  return events;
}

function buildChat(opts: {
  getUser?: WebAdapter["resolveUser"] | null;
  userName?: string;
}) {
  const adapter = createWebAdapter({
    userName: opts.userName ?? "testbot",
    getUser: (opts.getUser ?? (() => TEST_USER)) as never,
  });
  const state = createMemoryState();
  const chat = new Chat({
    userName: opts.userName ?? "testbot",
    adapters: { web: adapter },
    state,
  });
  return { chat, adapter, state };
}

describe("createWebAdapter — construction", () => {
  it("throws when userName is missing", () => {
    expect(() =>
      createWebAdapter({ getUser: () => TEST_USER } as never)
    ).toThrow(ValidationError);
  });

  it("throws when getUser is missing", () => {
    expect(() => createWebAdapter({ userName: "testbot" } as never)).toThrow(
      ValidationError
    );
  });

  it("constructs successfully with required options", () => {
    const adapter = createWebAdapter({
      userName: "testbot",
      getUser: () => TEST_USER,
    });
    expect(adapter).toBeInstanceOf(WebAdapter);
    expect(adapter.name).toBe("web");
    expect(adapter.userName).toBe("testbot");
    expect(adapter.persistMessageHistory).toBe(true);
  });
});

describe("WebAdapter — thread id encoding", () => {
  const adapter = createWebAdapter({
    userName: "testbot",
    getUser: () => TEST_USER,
  });

  it("encodes and decodes thread ids round-trip", () => {
    const data = { userId: "u-test", conversationId: "abc-123" };
    const encoded = adapter.encodeThreadId(data);
    expect(encoded).toBe("web:u-test:abc-123");
    expect(adapter.decodeThreadId(encoded)).toEqual(data);
  });

  it("rejects malformed thread ids", () => {
    expect(() => adapter.decodeThreadId("not-a-web-thread")).toThrow();
    expect(() => adapter.decodeThreadId("slack:C123:1.2")).toThrow();
  });

  it("uses thread id as channel id (no separate channel concept on web)", () => {
    expect(adapter.channelIdFromThreadId("web:u-test:abc")).toBe(
      "web:u-test:abc"
    );
  });

  it("reports isDM as true for any thread", () => {
    expect(adapter.isDM("web:u-test:any")).toBe(true);
  });
});

describe("WebAdapter.handleWebhook — input validation", () => {
  it("returns 400 on invalid JSON", async () => {
    const { chat } = buildChat({});
    await chat.webhooks.web(
      new Request("https://example.com/api/chat", { method: "POST" })
    );

    const response = await chat.webhooks.web(
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when messages array is missing", async () => {
    const { chat } = buildChat({});
    await chat.webhooks.web(makeWebRequest({ id: "x" })); // initialize
    const response = await chat.webhooks.web(makeWebRequest({ id: "x" }));
    expect(response.status).toBe(400);
  });

  it("returns 400 when there is no user message", async () => {
    const { chat } = buildChat({});
    await chat.webhooks.web(makeWebRequest({ messages: [] })); // init
    const response = await chat.webhooks.web(
      makeWebRequest({
        messages: [
          {
            id: "asst-1",
            role: "assistant",
            parts: [{ type: "text", text: "hi" }],
          },
        ],
      })
    );
    expect(response.status).toBe(400);
  });

  it("returns 400 when conversation id contains a colon", async () => {
    const { chat } = buildChat({});
    await chat.webhooks.web(makeWebRequest({ messages: [] }));
    const response = await chat.webhooks.web(
      makeWebRequest({ id: "bad:id", messages: [makeUserMessage("hello")] })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("conversation id");
  });

  it("returns 400 when user id contains a colon", async () => {
    const { chat } = buildChat({
      getUser: (() => ({ id: "user:bad" })) as never,
    });
    await chat.webhooks.web(makeWebRequest({ messages: [] }));
    const response = await chat.webhooks.web(
      makeWebRequest({ messages: [makeUserMessage("hello")] })
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("user id");
  });

  it("returns 401 when getUser returns null", async () => {
    const { chat } = buildChat({ getUser: (() => null) as never });
    await chat.webhooks.web(makeWebRequest({ messages: [] })); // init
    const response = await chat.webhooks.web(
      makeWebRequest({ messages: [makeUserMessage("hello")] })
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when getUser throws", async () => {
    const { chat } = buildChat({
      getUser: (() => {
        throw new Error("auth boom");
      }) as never,
    });
    await chat.webhooks.web(makeWebRequest({ messages: [] })); // init
    const response = await chat.webhooks.web(
      makeWebRequest({ messages: [makeUserMessage("hello")] })
    );
    expect(response.status).toBe(401);
  });
});

describe("WebAdapter.handleWebhook — request shape", () => {
  it("returns 400 when the last message is not a user message", async () => {
    const { chat } = buildChat({});
    const handler = vi.fn();
    chat.onDirectMessage(handler);

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-1",
        messages: [
          makeUserMessage("hello"),
          {
            id: "asst-1",
            role: "assistant",
            parts: [{ type: "text", text: "hi" }],
          },
        ],
      })
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The last entry in messages must be a user message",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 when the conversation id is not a string", async () => {
    const { chat } = buildChat({});
    const handler = vi.fn();
    chat.onDirectMessage(handler);

    const response = await chat.webhooks.web(
      makeWebRequest({ id: 42, messages: [makeUserMessage("hello")] })
    );
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("points at the protocol option when the body is an AG-UI request", async () => {
    const { chat } = buildChat({});
    const response = await chat.webhooks.web(
      makeWebRequest({
        threadId: "conv-1",
        messages: [{ id: "msg-1", role: "user", content: "hello" }],
      })
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain('"ag-ui"');
  });

  it("uses a fresh assistant message id for each response", async () => {
    const { chat } = buildChat({});
    chat.onDirectMessage(async (thread) => {
      await thread.post("ok");
    });

    const startIds: unknown[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await chat.webhooks.web(
        makeWebRequest({ id: "conv-1", messages: [makeUserMessage("hi")] })
      );
      const events = (await readSseEvents(response)) as Array<{
        type: string;
        messageId?: string;
      }>;
      startIds.push(events.find((e) => e.type === "start")?.messageId);
    }
    expect(startIds[0]).toEqual(expect.any(String));
    expect(startIds[1]).toEqual(expect.any(String));
    expect(startIds[0]).not.toBe(startIds[1]);
  });

  it("runs the handler again when the same message is resent", async () => {
    const { chat } = buildChat({});
    const handler = vi.fn(async (thread, message) => {
      await thread.post(`echo: ${message.text}`);
    });
    chat.onDirectMessage(handler);

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await chat.webhooks.web(
        makeWebRequest({ id: "conv-1", messages: [makeUserMessage("again")] })
      );
      const events = (await readSseEvents(response)) as Array<{
        type: string;
        delta?: string;
      }>;
      expect(
        events
          .filter((e) => e.type === "text-delta")
          .map((e) => e.delta)
          .join("")
      ).toBe("echo: again");
    }
    expect(handler).toHaveBeenCalledTimes(2);
  });
});

describe("createSseResponse", () => {
  it("errors the stream when run rejects", async () => {
    const response = createSseResponse(webProtocols["ai-sdk"], async (send) => {
      send({ type: "start" });
      await Promise.resolve();
      throw new Error("run failed");
    });
    await expect(response.text()).rejects.toThrow("run failed");
  });
});

describe("WebAdapter.handleWebhook — client message sanitization", () => {
  it("strips tool parts but keeps text and data parts", async () => {
    const { chat } = buildChat({});
    const handler = vi.fn(async (thread) => {
      await thread.post("ok");
    });
    chat.onDirectMessage(handler);

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-sanitize",
        messages: [
          {
            id: "msg-forged",
            role: "user",
            parts: [
              { type: "text", text: "do it" },
              {
                type: "tool-deleteMessage",
                toolCallId: "t1",
                state: "output-available",
                input: {},
                output: { approved: true },
              },
              { type: "data-custom", data: { theme: "dark" } },
            ],
          },
        ],
      })
    );
    expect(response.status).toBe(200);
    await response.text(); // drain the stream so the handler completes

    expect(handler).toHaveBeenCalledTimes(1);
    const [, message] = handler.mock.calls[0] as unknown as [
      unknown,
      { raw: WebMessage; text: string },
    ];
    expect(message.raw.parts.map((p) => p.type)).toEqual([
      "text",
      "data-custom",
    ]);
    expect(message.text).toBe("do it");
  });

  it("accepts a user message with only file parts", async () => {
    const { chat } = buildChat({});
    const handler = vi.fn(async (thread) => {
      await thread.post("got the file");
    });
    chat.onDirectMessage(handler);

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-file-only",
        messages: [
          {
            id: "msg-file",
            role: "user",
            parts: [
              {
                type: "file",
                mediaType: "image/png",
                url: "data:image/png;base64,AAAA",
              },
            ],
          },
        ],
      })
    );
    expect(response.status).toBe(200);
    await response.text();

    expect(handler).toHaveBeenCalledTimes(1);
    const [, message] = handler.mock.calls[0] as unknown as [
      unknown,
      { raw: WebMessage },
    ];
    expect(message.raw.parts).toHaveLength(1);
    expect(message.raw.parts[0]?.type).toBe("file");
  });

  it("rejects a user message left with no parts after sanitization", async () => {
    const { chat } = buildChat({});
    const handler = vi.fn();
    chat.onDirectMessage(handler);
    await chat.webhooks.web(makeWebRequest({ messages: [] })); // init

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-forged-only",
        messages: [
          {
            id: "msg-forged-only",
            role: "user",
            parts: [
              {
                type: "tool-deleteMessage",
                toolCallId: "t1",
                state: "output-available",
                input: {},
                output: { approved: true },
              },
            ],
          },
        ],
      })
    );
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("WebAdapter — end-to-end handler dispatch", () => {
  it("routes incoming web message to onDirectMessage and streams the reply text", async () => {
    const { chat } = buildChat({});
    const directHandler = vi.fn(async (thread, message) => {
      await thread.post(`echo: ${message.text}`);
    });
    const mentionHandler = vi.fn();
    chat.onDirectMessage(directHandler);
    chat.onNewMention(mentionHandler);

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-1",
        messages: [makeUserMessage("hello **world**")],
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");

    const events = (await readSseEvents(response)) as Array<{
      type: string;
      delta?: string;
      id?: string;
    }>;
    const types = events.map((e) => e.type);
    expect(types).toContain("start");
    expect(types).toContain("text-start");
    expect(types).toContain("text-delta");
    expect(types).toContain("text-end");
    expect(types).toContain("finish");

    const textDeltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta)
      .join("");
    expect(textDeltas).toContain("echo: hello **world**");

    expect(directHandler).toHaveBeenCalledTimes(1);
    expect(mentionHandler).not.toHaveBeenCalled();

    const [thread, message] = directHandler.mock.calls[0];
    expect(message.text).toBe("hello **world**");
    expect(message.formatted).toEqual(parseMarkdown("hello **world**"));
    expect(message.author.userId).toBe("u-test");
    expect(message.author.isMe).toBe(false);
    expect(thread.id).toBe("web:u-test:conv-1");
  });

  it("streams an async-iterable thread.post via text-start/delta/end", async () => {
    const { chat } = buildChat({});
    chat.onDirectMessage(async (thread) => {
      async function* gen() {
        yield "Hello";
        yield ", ";
        yield "world!";
      }
      await thread.post(gen());
    });

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-2",
        messages: [makeUserMessage("trigger")],
      })
    );
    expect(response.status).toBe(200);

    const raw = await response.text();
    const events = parseSseFromText(raw);
    const deltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta);
    expect(deltas.join("")).toBe("Hello, world!");

    const startCount = events.filter((e) => e.type === "text-start").length;
    const endCount = events.filter((e) => e.type === "text-end").length;
    expect(startCount).toBeGreaterThanOrEqual(1);
    expect(endCount).toBe(startCount);
  });

  it("returns a SentMessage whose id matches the streamed text-* event id", async () => {
    const { chat } = buildChat({});
    const captured: { id?: string } = {};
    chat.onDirectMessage(async (thread) => {
      async function* gen() {
        yield "Hello ";
        yield "world";
      }
      const sent = await thread.post(gen());
      captured.id = sent.id;
    });

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-id",
        messages: [makeUserMessage("trigger")],
      })
    );
    expect(response.status).toBe(200);

    const events = (await readSseEvents(response)) as Array<{
      type: string;
      id?: string;
      delta?: string;
    }>;
    const textStart = events.find((e) => e.type === "text-start");
    const textEnd = events.find((e) => e.type === "text-end");
    expect(captured.id).toBeDefined();
    expect(textStart?.id).toBe(captured.id);
    expect(textEnd?.id).toBe(captured.id);
  });

  it("short-circuits stream iteration when request.signal aborts", async () => {
    const { chat } = buildChat({});
    const ctrl = new AbortController();
    const seen: string[] = [];
    chat.onDirectMessage(async (thread) => {
      async function* gen() {
        yield "first";
        ctrl.abort();
        yield "second";
        yield "third";
      }
      await thread.post(gen());
      seen.push("done");
    });

    const response = await chat.webhooks.web(
      makeWebRequest(
        { id: "conv-abort", messages: [makeUserMessage("trigger")] },
        ctrl.signal
      )
    );
    expect(response.status).toBe(200);

    const events = (await readSseEvents(response)) as Array<{
      type: string;
      delta?: string;
    }>;
    const deltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta);
    expect(deltas.join("")).toBe("first");
    expect(events.filter((e) => e.type === "text-end")).toHaveLength(1);
    expect(seen).toEqual(["done"]);
  });

  it("drops non-text StreamChunks (task_update / plan_update) silently", async () => {
    const { chat } = buildChat({});
    chat.onDirectMessage(async (thread) => {
      async function* gen(): AsyncGenerator<string | StreamChunk> {
        yield "before";
        yield {
          type: "task_update",
          id: "t1",
          title: "tool call",
          status: "in_progress",
        };
        yield {
          type: "plan_update",
          title: "step 1",
        };
        yield "after";
      }
      await thread.post(gen());
    });

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-chunks",
        messages: [makeUserMessage("trigger")],
      })
    );
    expect(response.status).toBe(200);

    const events = (await readSseEvents(response)) as Array<{
      type: string;
      delta?: string;
    }>;
    const deltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta);
    expect(deltas.join("")).toBe("beforeafter");
    expect(deltas).toHaveLength(2);
  });

  it("propagates handler errors as an error chunk", async () => {
    const { chat } = buildChat({});
    chat.onDirectMessage(async () => {
      throw new Error("handler exploded");
    });

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-err",
        messages: [makeUserMessage("trigger")],
      })
    );
    expect(response.status).toBe(200);

    const events = (await readSseEvents(response)) as Array<{
      type: string;
      errorText?: string;
    }>;
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.errorText).toContain("handler exploded");
  });
});

describe("WebAdapter — AG-UI protocol", () => {
  function buildAgUiChat() {
    const adapter = createWebAdapter({
      userName: "testbot",
      getUser: () => TEST_USER,
      protocol: "ag-ui",
    });
    const chat = new Chat({
      userName: "testbot",
      adapters: { web: adapter },
      state: createMemoryState(),
    });
    return { chat, adapter };
  }

  function agUiBody(content: unknown, overrides: Record<string, unknown> = {}) {
    return {
      threadId: "conv-agui",
      runId: "run-1",
      state: {},
      messages: [
        { id: "asst-0", role: "assistant", content: "earlier" },
        { id: "msg-1", role: "user", content },
      ],
      tools: [],
      context: [],
      forwardedProps: {},
      ...overrides,
    };
  }

  it("throws on an unknown protocol", () => {
    expect(() =>
      createWebAdapter({
        userName: "testbot",
        getUser: () => TEST_USER,
        protocol: "nope" as never,
      })
    ).toThrow(ValidationError);
  });

  it("streams AG-UI run and text message events", async () => {
    const { chat } = buildAgUiChat();
    const handler = vi.fn(async (thread, message) => {
      async function* gen() {
        yield "Hello, ";
        yield message.text;
      }
      await thread.post(gen());
    });
    chat.onDirectMessage(handler);

    const response = await chat.webhooks.web(makeWebRequest(agUiBody("world")));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBeNull();

    const events = (await readSseEvents(response)) as Array<{
      type: string;
      delta?: string;
      messageId?: string;
      runId?: string;
      threadId?: string;
    }>;
    expect(events.map((e) => e.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
    expect(events[0]).toMatchObject({ threadId: "conv-agui", runId: "run-1" });
    expect(events.at(-1)).toMatchObject({
      threadId: "conv-agui",
      runId: "run-1",
    });
    const messageId = events[1]?.messageId;
    expect(messageId).toBeDefined();
    expect(
      events
        .filter((e) => e.type.startsWith("TEXT_MESSAGE_"))
        .every((e) => e.messageId === messageId)
    ).toBe(true);
    expect(
      events
        .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
        .map((e) => e.delta)
        .join("")
    ).toBe("Hello, world");

    const [thread, message] = handler.mock.calls[0];
    expect(thread.id).toBe("web:u-test:conv-agui");
    expect(message.id).toBe("msg-1");
    expect(message.raw).toEqual({
      id: "msg-1",
      role: "user",
      parts: [{ type: "text", text: "world" }],
    });
  });

  it("keeps text and media content parts and drops the rest", async () => {
    const { chat } = buildAgUiChat();
    const handler = vi.fn(async (thread) => {
      await thread.post("ok");
    });
    chat.onDirectMessage(handler);

    const image = {
      type: "image",
      source: { type: "url", value: "https://example.com/a.png" },
    };
    const response = await chat.webhooks.web(
      makeWebRequest(
        agUiBody([
          { type: "text", text: "look" },
          image,
          { type: "tool-call", id: "t1", name: "deleteMessage" },
        ])
      )
    );
    expect(response.status).toBe(200);
    await response.text();

    const [, message] = handler.mock.calls[0] as unknown as [
      unknown,
      { raw: WebMessage; text: string },
    ];
    expect(message.text).toBe("look");
    expect(message.raw.parts).toEqual([{ type: "text", text: "look" }, image]);
  });

  it("rejects a user message with no usable content", async () => {
    const { chat } = buildAgUiChat();
    const handler = vi.fn();
    chat.onDirectMessage(handler);
    await chat.webhooks.web(makeWebRequest({ messages: [] })); // init

    const response = await chat.webhooks.web(makeWebRequest(agUiBody("")));
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 when the last message is a tool result", async () => {
    const { chat } = buildAgUiChat();
    const handler = vi.fn();
    chat.onDirectMessage(handler);

    const body = agUiBody("hi");
    body.messages.push({
      id: "tool-1",
      role: "tool",
      content: "{}",
    } as (typeof body.messages)[number]);
    const response = await chat.webhooks.web(makeWebRequest(body));
    expect(response.status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 400 when threadId is not a string", async () => {
    const { chat } = buildAgUiChat();
    const response = await chat.webhooks.web(
      makeWebRequest(agUiBody("hi", { threadId: 7 }))
    );
    expect(response.status).toBe(400);
  });

  it("points at the protocol option when the body is an AI SDK request", async () => {
    const { chat } = buildAgUiChat();
    const response = await chat.webhooks.web(
      makeWebRequest({ id: "conv-1", messages: [makeUserMessage("hello")] })
    );
    expect(response.status).toBe(400);
    const { error } = (await response.json()) as { error: string };
    expect(error).toContain('"ai-sdk"');
  });

  it("runs the handler again when the same message is resent", async () => {
    const { chat } = buildAgUiChat();
    const handler = vi.fn(async (thread) => {
      await thread.post("ok");
    });
    chat.onDirectMessage(handler);

    for (const runId of ["run-1", "run-2"]) {
      const response = await chat.webhooks.web(
        makeWebRequest(agUiBody("retry me", { runId }))
      );
      const events = (await readSseEvents(response)) as Array<{
        type: string;
      }>;
      expect(events.map((e) => e.type)).toContain("TEXT_MESSAGE_CONTENT");
    }
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when threadId contains a colon", async () => {
    const { chat } = buildAgUiChat();
    await chat.webhooks.web(makeWebRequest({ messages: [] })); // init
    const response = await chat.webhooks.web(
      makeWebRequest(agUiBody("hi", { threadId: "bad:id" }))
    );
    expect(response.status).toBe(400);
  });

  it("ends the run with RUN_ERROR instead of RUN_FINISHED on handler errors", async () => {
    const { chat } = buildAgUiChat();
    chat.onDirectMessage(async () => {
      throw new Error("handler exploded");
    });

    const response = await chat.webhooks.web(makeWebRequest(agUiBody("hi")));
    const events = (await readSseEvents(response)) as Array<{
      type: string;
      message?: string;
    }>;
    expect(events.map((e) => e.type)).toEqual(["RUN_STARTED", "RUN_ERROR"]);
    expect(events[1]?.message).toBe("handler exploded");
  });
});

function unparsed(value: string) {
  return {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value }] }],
  };
}

const NORMAL_MARKDOWN =
  "**bold** text\n\n> quoted\n\n| a | b |\n| - | - |\n| 1 | 2 |";
const UNPARSED_CASES = [
  ["too many emphasis markers", "*a".repeat(8192)],
  ["nesting too deep", ">".repeat(6000)],
  ["a footnote opening 40 nested lists", `[^a]: ${"- ".repeat(40)}a`],
  ["65 www. autolinks in one word", "www.example.com/".repeat(65)],
];

describe("WebAdapter — inbound markdown parsing", () => {
  async function deliver(text: string) {
    const { chat } = buildChat({});
    const handler = vi.fn(async (_thread, _message) => {});
    chat.onDirectMessage(handler);

    const response = await chat.webhooks.web(
      makeWebRequest({ id: "conv-parse", messages: [makeUserMessage(text)] })
    );
    await readSseEvents(response);
    return {
      messages: handler.mock.calls.map((call) => call[1] as Message),
      status: response.status,
    };
  }

  it("parses markdown in a user message", async () => {
    const { messages, status } = await deliver(NORMAL_MARKDOWN);
    expect(status).toBe(200);
    expect(messages).toHaveLength(1);
    const [message] = messages;

    expect(message.text).toBe(NORMAL_MARKDOWN);
    expect(message.formatted).toEqual(parseMarkdown(NORMAL_MARKDOWN));
  });

  it.each(
    UNPARSED_CASES
  )("keeps a user message with %s as plain text", async (_label, text) => {
    const { messages, status } = await deliver(text);
    expect(status).toBe(200);
    expect(messages).toHaveLength(1);
    const [message] = messages;

    expect(message.text).toBe(text);
    expect(message.formatted).toEqual(unparsed(text));
    expect(() => JSON.stringify(message.formatted)).not.toThrow();
  });
});

describe("WebAdapter.parseMessage — inbound markdown parsing", () => {
  const adapter = createWebAdapter({
    userName: "testbot",
    getUser: () => TEST_USER,
  });

  it("parses markdown in a user message", () => {
    const message = adapter.parseMessage(makeUserMessage(NORMAL_MARKDOWN));

    expect(message.text).toBe(NORMAL_MARKDOWN);
    expect(message.formatted).toEqual(parseMarkdown(NORMAL_MARKDOWN));
  });

  it.each(
    UNPARSED_CASES
  )("keeps a user message with %s as plain text", (_label, text) => {
    const message = adapter.parseMessage(makeUserMessage(text));

    expect(message.text).toBe(text);
    expect(message.formatted).toEqual(unparsed(text));
    expect(() => JSON.stringify(message.formatted)).not.toThrow();
  });
});
