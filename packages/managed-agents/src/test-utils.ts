import {
  type Message,
  type SentMessage,
  type StreamChunk,
  StreamingPlan,
  type Thread,
} from "chat";
import { vi } from "vitest";
import type { ManagedAgentEvent } from "./types";

export interface PostedStream {
  chunks: Array<string | StreamChunk>;
  kind: "stream";
  options?: unknown;
  text: string;
}

export type Posted = PostedStream | { kind: "message"; value: unknown };

export interface FakeThread {
  abort: () => void;
  edits: unknown[];
  posted: Posted[];
  state: Record<string, unknown> | null;
  thread: Thread;
}

export function createFakeThread(
  initialState: Record<string, unknown> | null = null
): FakeThread {
  const controller = new AbortController();
  const fake: FakeThread = {
    abort: () => controller.abort(),
    edits: [],
    posted: [],
    state: initialState,
    thread: undefined as unknown as Thread,
  };

  const sent = {
    edit: vi.fn((content: unknown) => {
      fake.edits.push(content);
      return Promise.resolve(sent);
    }),
  } as unknown as SentMessage;

  fake.thread = {
    id: "slack:C1:1.2",
    post: vi.fn(async (message: unknown) => {
      const plan = message instanceof StreamingPlan ? message : undefined;
      const iterable = plan ? plan.stream : message;
      if (
        iterable !== null &&
        typeof iterable === "object" &&
        Symbol.asyncIterator in iterable
      ) {
        const posted: PostedStream = plan
          ? { chunks: [], kind: "stream", options: plan.options, text: "" }
          : { chunks: [], kind: "stream", text: "" };
        fake.posted.push(posted);
        for await (const chunk of iterable as AsyncIterable<
          string | StreamChunk
        >) {
          if (controller.signal.aborted) {
            break;
          }
          posted.chunks.push(chunk);
          if (typeof chunk === "string") {
            posted.text += chunk;
          }
        }
        return plan ?? sent;
      }
      fake.posted.push({ kind: "message", value: message });
      return sent;
    }),
    setState: vi.fn((state: Record<string, unknown>) => {
      fake.state = { ...fake.state, ...state };
      return Promise.resolve();
    }),
    get signal() {
      return controller.signal;
    },
    startTyping: vi.fn(() => Promise.resolve()),
    get state() {
      return Promise.resolve(fake.state);
    },
  } as unknown as Thread;

  return fake;
}

export function fakeMessage(text: string, isMe = false): Message {
  return { author: { isMe }, text } as unknown as Message;
}

export async function* fromEvents(
  events: ManagedAgentEvent[]
): AsyncGenerator<ManagedAgentEvent> {
  for (const event of events) {
    yield event;
  }
}

export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}
