import { describe, expect, it } from "vitest";
import {
  ChatError,
  LockError,
  NotImplementedError,
  RateLimitError,
} from "./errors";

describe("ChatError", () => {
  it("should set message, code, and name", () => {
    const err = new ChatError("something broke", "SOME_CODE");
    expect(err.message).toBe("something broke");
    expect(err.code).toBe("SOME_CODE");
    expect(err.name).toBe("ChatError");
  });

  it("should be instanceof Error", () => {
    const err = new ChatError("fail", "ERR");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ChatError);
  });

  it("should propagate cause", () => {
    const cause = new Error("root cause");
    const err = new ChatError("wrapped", "WRAP", cause);
    expect(err.cause).toBe(cause);
  });

  it("should allow undefined cause", () => {
    const err = new ChatError("no cause", "NC");
    expect(err.cause).toBeUndefined();
  });
});

describe("RateLimitError", () => {
  it("should set code to RATE_LIMITED", () => {
    const err = new RateLimitError("slow down");
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.name).toBe("RateLimitError");
  });

  it("should store retryAfterMs", () => {
    const err = new RateLimitError("slow down", 5000);
    expect(err.retryAfterMs).toBe(5000);
  });

  it("should allow undefined retryAfterMs", () => {
    const err = new RateLimitError("slow down");
    expect(err.retryAfterMs).toBeUndefined();
  });

  it("should be instanceof ChatError and Error", () => {
    const err = new RateLimitError("slow down");
    expect(err).toBeInstanceOf(ChatError);
    expect(err).toBeInstanceOf(Error);
  });

  it("should propagate cause", () => {
    const cause = new Error("api error");
    const err = new RateLimitError("rate limited", 1000, cause);
    expect(err.cause).toBe(cause);
  });
});

describe("LockError", () => {
  it("should set code to LOCK_FAILED", () => {
    const err = new LockError("lock failed");
    expect(err.code).toBe("LOCK_FAILED");
    expect(err.name).toBe("LockError");
  });

  it("should be instanceof ChatError", () => {
    const err = new LockError("lock failed");
    expect(err).toBeInstanceOf(ChatError);
  });

  it("should propagate cause", () => {
    const cause = new Error("redis down");
    const err = new LockError("lock failed", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("NotImplementedError", () => {
  it("should set code to NOT_IMPLEMENTED", () => {
    const err = new NotImplementedError("not yet");
    expect(err.code).toBe("NOT_IMPLEMENTED");
    expect(err.name).toBe("NotImplementedError");
  });

  it("should store feature field", () => {
    const err = new NotImplementedError("not yet", "reactions");
    expect(err.feature).toBe("reactions");
  });

  it("should allow undefined feature", () => {
    const err = new NotImplementedError("not yet");
    expect(err.feature).toBeUndefined();
  });

  it("should be instanceof ChatError", () => {
    const err = new NotImplementedError("not yet");
    expect(err).toBeInstanceOf(ChatError);
  });

  it("should propagate cause", () => {
    const cause = new Error("underlying");
    const err = new NotImplementedError("not yet", "modals", cause);
    expect(err.cause).toBe(cause);
  });
});
