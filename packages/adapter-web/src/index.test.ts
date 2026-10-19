import { ValidationError } from "@chat-adapter/shared";
import { createMemoryState } from "@chat-adapter/state-memory";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { Chat, type StreamChunk } from "chat";
import { describe, expect, it, vi } from "vitest";
import { createWebAdapter, WebAdapter } from "./index";
import type { WebUser } from "./types";

const TEST_USER: WebUser = { id: "u-test", name: "Test User" };

function makeUserMessage(text: string, id = "msg-1"): UIMessage {
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
      { raw: UIMessage; text: string },
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
      { raw: UIMessage },
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
        messages: [makeUserMessage("hello world")],
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
    expect(textDeltas).toContain("echo: hello world");

    expect(directHandler).toHaveBeenCalledTimes(1);
    expect(mentionHandler).not.toHaveBeenCalled();

    const [thread, message] = directHandler.mock.calls[0];
    expect(message.text).toBe("hello world");
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
      async function* gen(): AsyncGenerator<string | StreamChunk> {
        yield "first";
        yield {
          type: "task_update",
          id: "t1",
          title: "Work",
          status: "pending",
        };
        ctrl.abort();
        yield {
          type: "task_update",
          id: "t1",
          title: "Work",
          status: "complete",
        };
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
      data?: { status?: string };
    }>;
    const deltas = events
      .filter((e) => e.type === "text-delta")
      .map((e) => e.delta);
    expect(deltas.join("")).toBe("first");
    expect(
      events.filter((e) => e.type === "data-task").map((e) => e.data?.status)
    ).toEqual(["pending"]);
    expect(events.filter((e) => e.type === "text-end")).toHaveLength(1);
    expect(seen).toEqual(["done"]);
  });

  it("streams task_update and plan_update chunks as data parts in order", async () => {
    const { chat } = buildChat({});
    const captured: { id?: string } = {};
    chat.onDirectMessage(async (thread) => {
      async function* gen(): AsyncGenerator<string | StreamChunk> {
        yield { type: "plan_update", title: "Research" };
        yield "before";
        yield {
          type: "task_update",
          id: "t1",
          title: "Search",
          status: "in_progress",
        };
        yield { type: "markdown_text", text: "after" };
        yield {
          type: "task_update",
          id: "t1",
          title: "Search",
          status: "complete",
        };
      }
      const sent = await thread.post(gen());
      captured.id = sent.id;
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
    }>;
    const id = captured.id;
    expect(
      events.filter(
        (e) => e.type.startsWith("text-") || e.type.startsWith("data-")
      )
    ).toEqual([
      {
        type: "data-plan",
        id,
        data: { title: "Research" },
      },
      { type: "text-start", id },
      { type: "text-delta", id, delta: "before" },
      { type: "text-end", id },
      {
        type: "data-task",
        id: "t1",
        data: { id: "t1", title: "Search", status: "in_progress" },
      },
      { type: "text-start", id: `${id}-1` },
      { type: "text-delta", id: `${id}-1`, delta: "after" },
      { type: "text-end", id: `${id}-1` },
      {
        type: "data-task",
        id: "t1",
        data: { id: "t1", title: "Search", status: "complete" },
      },
    ]);
  });

  it("streams reasoning chunks as reasoning parts that close when text resumes", async () => {
    const { chat } = buildChat({});
    const captured: { id?: string; text?: string } = {};
    chat.onDirectMessage(async (thread) => {
      async function* gen(): AsyncGenerator<string | StreamChunk> {
        yield { type: "reasoning", text: "Let me " };
        yield { type: "reasoning", text: "think." };
        yield "Answer";
        yield { type: "reasoning", text: "Check a tool." };
        yield {
          type: "task_update",
          id: "t1",
          title: "Search",
          status: "complete",
        };
        yield { type: "reasoning", text: "Done." };
      }
      const sent = await thread.post(gen());
      captured.id = sent.id;
      captured.text = sent.text;
    });

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-reasoning",
        messages: [makeUserMessage("trigger")],
      })
    );

    const events = (await readSseEvents(response)) as Array<{
      type: string;
    }>;
    const id = captured.id;
    expect(
      events.filter(
        (e) =>
          e.type.startsWith("text-") ||
          e.type.startsWith("reasoning-") ||
          e.type.startsWith("data-")
      )
    ).toEqual([
      { type: "reasoning-start", id: `${id}-reasoning-0` },
      { type: "reasoning-delta", id: `${id}-reasoning-0`, delta: "Let me " },
      { type: "reasoning-delta", id: `${id}-reasoning-0`, delta: "think." },
      { type: "reasoning-end", id: `${id}-reasoning-0` },
      { type: "text-start", id },
      { type: "text-delta", id, delta: "Answer" },
      { type: "text-end", id },
      { type: "reasoning-start", id: `${id}-reasoning-1` },
      {
        type: "reasoning-delta",
        id: `${id}-reasoning-1`,
        delta: "Check a tool.",
      },
      { type: "reasoning-end", id: `${id}-reasoning-1` },
      {
        type: "data-task",
        id: "t1",
        data: { id: "t1", title: "Search", status: "complete" },
      },
      { type: "reasoning-start", id: `${id}-reasoning-2` },
      { type: "reasoning-delta", id: `${id}-reasoning-2`, delta: "Done." },
      { type: "reasoning-end", id: `${id}-reasoning-2` },
    ]);
    // Reasoning stays out of the message text.
    expect(captured.text).toBe("Answer");

    // The AI SDK client assembles the parts in the order they were yielded.
    let message: UIMessage | undefined;
    for await (const snapshot of readUIMessageStream({
      stream: new ReadableStream<UIMessageChunk>({
        start(controller) {
          for (const event of events) {
            controller.enqueue(event as UIMessageChunk);
          }
          controller.close();
        },
      }),
    })) {
      message = snapshot;
    }
    expect(
      message?.parts.flatMap((part) => {
        if (part.type === "reasoning" || part.type === "text") {
          return [{ type: part.type, text: part.text, state: part.state }];
        }
        return part.type === "data-task" ? [{ type: part.type }] : [];
      })
    ).toEqual([
      { type: "reasoning", text: "Let me think.", state: "done" },
      { type: "text", text: "Answer", state: "done" },
      { type: "reasoning", text: "Check a tool.", state: "done" },
      { type: "data-task" },
      { type: "reasoning", text: "Done.", state: "done" },
    ]);
  });

  it("emits one empty text part for a stream with no text", async () => {
    const { chat } = buildChat({});
    chat.onDirectMessage(async (thread) => {
      const empty: AsyncIterable<string> = {
        [Symbol.asyncIterator]: () => ({
          next: () =>
            Promise.resolve({ done: true as const, value: undefined }),
        }),
      };
      await thread.post(empty);
    });

    const response = await chat.webhooks.web(
      makeWebRequest({
        id: "conv-empty",
        messages: [makeUserMessage("trigger")],
      })
    );
    const events = (await readSseEvents(response)) as Array<{ type: string }>;
    expect(
      events.filter((e) => e.type.startsWith("text-")).map((e) => e.type)
    ).toEqual(["text-start", "text-end"]);
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
