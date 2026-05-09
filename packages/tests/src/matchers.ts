import type { MatcherState, SyncExpectationResult } from "@vitest/expect";
import type { Adapter, ChatInstance, StateAdapter } from "chat";

const PROCESS_HANDLERS = [
  "processMessage",
  "processReaction",
  "processAction",
  "processSlashCommand",
  "processOptionsLoad",
  "processModalSubmit",
  "processModalClose",
  "processMemberJoinedChannel",
  "processAppHomeOpened",
  "processAssistantThreadStarted",
  "processAssistantContextChanged",
] as const;

export type ChatHandler = (typeof PROCESS_HANDLERS)[number];

interface MockableFn {
  mock?: { calls: unknown[][] };
}

function isMock(
  value: unknown
): value is MockableFn & { mock: { calls: unknown[][] } } {
  return (
    typeof value === "function" &&
    typeof (value as MockableFn).mock === "object" &&
    Array.isArray((value as MockableFn).mock?.calls)
  );
}

function matchText(actual: unknown, expected: string | RegExp): boolean {
  if (typeof actual !== "string") {
    return false;
  }
  return expected instanceof RegExp
    ? expected.test(actual)
    : actual === expected;
}

function getCalls(fn: unknown): unknown[][] {
  return isMock(fn) ? fn.mock.calls : [];
}

/**
 * Assert that a mock `Adapter` posted to a given thread.
 *
 * Inspects `adapter.postMessage` calls (which receive `(thread, message, options?)`).
 * If `textPattern` is provided, the message's `.text` must match it (string equality
 * or `RegExp.test`).
 */
export function toHavePosted(
  this: MatcherState,
  received: Adapter,
  threadId: string,
  textPattern?: string | RegExp
): SyncExpectationResult {
  const calls = getCalls(received?.postMessage);
  const matching = calls.filter((args) => {
    const thread = args[0] as { id?: string } | undefined;
    if (thread?.id !== threadId) {
      return false;
    }
    if (textPattern === undefined) {
      return true;
    }
    const message = args[1] as { text?: string } | undefined;
    return matchText(message?.text, textPattern);
  });
  const pass = matching.length > 0;
  return {
    pass,
    message: () =>
      pass
        ? `expected adapter not to have posted to ${threadId}${
            textPattern !== undefined ? ` matching ${String(textPattern)}` : ""
          }`
        : `expected adapter to have posted to ${threadId}${
            textPattern !== undefined ? ` matching ${String(textPattern)}` : ""
          }, but ${calls.length === 0 ? "postMessage was never called" : `it was called with: ${this.utils.stringify(calls.map((c) => c[0]))}`}`,
  };
}

/**
 * Assert that a mock `ChatInstance` dispatched an event through a given handler.
 *
 * Useful for adapter authors verifying their adapter routes through the right
 * `process*` method.
 */
export function toHaveDispatched(
  this: MatcherState,
  received: ChatInstance,
  handler: ChatHandler
): SyncExpectationResult {
  if (!PROCESS_HANDLERS.includes(handler)) {
    return {
      pass: false,
      message: () =>
        `unknown handler "${handler}". Valid handlers: ${PROCESS_HANDLERS.join(", ")}`,
    };
  }
  const fn = (received as unknown as Record<string, unknown>)[handler];
  const calls = getCalls(fn);
  const pass = calls.length > 0;
  return {
    pass,
    message: () =>
      pass
        ? `expected chat not to have dispatched ${handler}`
        : `expected chat to have dispatched ${handler}, but it was never called`,
  };
}

/**
 * Assert that a mock `StateAdapter` is currently subscribed to a thread.
 *
 * Calls the adapter's own `isSubscribed` so this matcher works against any
 * state adapter shape — including real adapters in integration tests, not
 * just `createMockState()`.
 */
export async function toBeSubscribedTo(
  this: MatcherState,
  received: StateAdapter,
  threadId: string
): Promise<SyncExpectationResult> {
  const subscribed = await received.isSubscribed(threadId);
  return {
    pass: subscribed,
    message: () =>
      subscribed
        ? `expected state not to be subscribed to ${threadId}`
        : `expected state to be subscribed to ${threadId}`,
  };
}

export const matchers = {
  toHavePosted,
  toHaveDispatched,
  toBeSubscribedTo,
};

interface ChatMatchers<R = unknown> {
  toBeSubscribedTo(threadId: string): Promise<R>;
  toHaveDispatched(handler: ChatHandler): R;
  toHavePosted(threadId: string, textPattern?: string | RegExp): R;
}

declare module "vitest" {
  // biome-ignore lint/suspicious/noExplicitAny: matches Vitest's own augmentation pattern
  interface Assertion<T = any> extends ChatMatchers<T> {}
  interface AsymmetricMatchersContaining extends ChatMatchers {}
}
