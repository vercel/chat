import { beforeEach, describe, expect, it } from "vitest";
import { Chat } from "../chat";
import { runInConversation } from "../context";
import {
  createMockAdapter,
  createMockState,
  mockLogger,
} from "../mock-adapter";
import { createScopeGuard } from "./scope";

const THREAD = "slack:C123:1234.5678";
const FOREIGN = "slack:C999:1111.2222";
const MISSING = /Tool call blocked: no conversation scope/;
const OUTSIDE = /tools are scoped to/;
const EMPTY = /Invalid tool scope: `scope` is an empty id/;

describe("scope guard", () => {
  let chat: Chat;

  beforeEach(async () => {
    chat = new Chat({
      userName: "testbot",
      adapters: { slack: createMockAdapter("slack") },
      state: createMockState(),
      logger: mockLogger,
    });
    await chat.initialize();
  });

  it.each([
    undefined,
    "",
  ])("rejects an inherited scope of %s", (conversation) => {
    const guard = createScopeGuard(chat, undefined);
    expect(() =>
      runInConversation(conversation, () => guard?.(FOREIGN))
    ).toThrow(MISSING);
  });

  it.each(["", { id: "" }])("rejects an empty explicit scope %j", (scope) => {
    expect(() => createScopeGuard(chat, scope)).toThrow(EMPTY);
  });

  it("defers resolving an explicit scope's channel until a call", () => {
    const adapter = chat.getAdapter("slack");
    if (!adapter) {
      throw new Error("slack adapter missing");
    }
    adapter.channelIdFromThreadId = () => {
      throw new Error("malformed id");
    };
    const guard = createScopeGuard(chat, "slack:bad");
    expect(() => guard?.(THREAD)).toThrow("malformed id");
  });

  it("does not inherit an outer conversation inside an unscoped dispatch", () => {
    const guard = createScopeGuard(chat, undefined);
    runInConversation(THREAD, () => {
      expect(() => runInConversation(undefined, () => guard?.(THREAD))).toThrow(
        MISSING
      );
    });
  });

  it.each([
    THREAD,
    { id: THREAD },
  ])("accepts an explicit background scope %j", (scope) => {
    const guard = createScopeGuard(chat, scope);
    expect(() => guard?.(THREAD)).not.toThrow();
    expect(() => guard?.(FOREIGN)).toThrow(OUTSIDE);
  });

  it("resolves inherited scope on every call", () => {
    const guard = createScopeGuard(chat, undefined);
    runInConversation(THREAD, () => {
      expect(() => guard?.(THREAD)).not.toThrow();
      expect(() => guard?.(FOREIGN)).toThrow(OUTSIDE);
    });
    runInConversation(FOREIGN, () => {
      expect(() => guard?.(FOREIGN)).not.toThrow();
      expect(() => guard?.(THREAD)).toThrow(OUTSIDE);
    });
    expect(() => runInConversation(undefined, () => guard?.(THREAD))).toThrow(
      MISSING
    );
    expect(() => guard?.(THREAD)).not.toThrow();
  });

  it("requires an explicit opt-out for unrestricted tools", () => {
    expect(createScopeGuard(chat, false)).toBeUndefined();
  });
});
