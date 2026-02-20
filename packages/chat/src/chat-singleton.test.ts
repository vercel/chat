import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ChatSingleton,
  clearChatSingleton,
  getChatSingleton,
  hasChatSingleton,
  setChatSingleton,
} from "./chat-singleton";

describe("Chat Singleton", () => {
  beforeEach(() => {
    clearChatSingleton();
  });

  it("should have no singleton by default", () => {
    expect(hasChatSingleton()).toBe(false);
  });

  it("should throw when getting unregistered singleton", () => {
    expect(() => getChatSingleton()).toThrow(
      "No Chat singleton registered. Call chat.registerSingleton() first.",
    );
  });

  it("should set and get a singleton", () => {
    const mock: ChatSingleton = {
      getAdapter: vi.fn(),
      getState: vi.fn(),
    };
    setChatSingleton(mock);
    expect(hasChatSingleton()).toBe(true);
    expect(getChatSingleton()).toBe(mock);
  });

  it("should clear the singleton", () => {
    const mock: ChatSingleton = {
      getAdapter: vi.fn(),
      getState: vi.fn(),
    };
    setChatSingleton(mock);
    expect(hasChatSingleton()).toBe(true);

    clearChatSingleton();
    expect(hasChatSingleton()).toBe(false);
  });

  it("should allow overwriting the singleton", () => {
    const mock1: ChatSingleton = {
      getAdapter: vi.fn(),
      getState: vi.fn(),
    };
    const mock2: ChatSingleton = {
      getAdapter: vi.fn(),
      getState: vi.fn(),
    };
    setChatSingleton(mock1);
    setChatSingleton(mock2);
    expect(getChatSingleton()).toBe(mock2);
  });
});
