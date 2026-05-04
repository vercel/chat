import { ValidationError } from "@chat-adapter/shared";
import { createMemoryState } from "@chat-adapter/state-memory";
import type { UIMessage } from "ai";
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
