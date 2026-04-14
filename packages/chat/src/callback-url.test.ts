import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeCallbackValue,
  encodeCallbackValue,
  postToCallbackUrl,
  processCardCallbackUrls,
  resolveCallbackUrl,
} from "./callback-url";
import { Actions, Button, Card, Text } from "./cards";
import type { MockStateAdapter } from "./mock-adapter";
import { createMockState } from "./mock-adapter";

const TOKEN_ONLY_RE = /^__cb:[a-f0-9]+$/;
const TOKEN_WITH_VALUE_RE = /^__cb:[a-f0-9]+\|order-456$/;

describe("callback-url encoding", () => {
  it("encodes a token with no original value", () => {
    const encoded = encodeCallbackValue("abc123");
    expect(encoded).toBe("__cb:abc123");
  });

  it("encodes a token with an original value", () => {
    const encoded = encodeCallbackValue("abc123", "order-456");
    expect(encoded).toBe("__cb:abc123|order-456");
  });

  it("encodes a token with empty string original value as no value", () => {
    const encoded = encodeCallbackValue("abc123", "");
    expect(encoded).toBe("__cb:abc123");
  });

  it("decodes a value with no callback token", () => {
    const result = decodeCallbackValue("order-456");
    expect(result).toEqual({
      callbackToken: undefined,
      originalValue: "order-456",
    });
  });

  it("decodes undefined value", () => {
    const result = decodeCallbackValue(undefined);
    expect(result).toEqual({
      callbackToken: undefined,
      originalValue: undefined,
    });
  });

  it("decodes a token-only value", () => {
    const result = decodeCallbackValue("__cb:abc123");
    expect(result).toEqual({
      callbackToken: "abc123",
      originalValue: undefined,
    });
  });

  it("decodes a token with original value", () => {
    const result = decodeCallbackValue("__cb:abc123|order-456");
    expect(result).toEqual({
      callbackToken: "abc123",
      originalValue: "order-456",
    });
  });

  it("preserves pipe characters in original value", () => {
    const result = decodeCallbackValue("__cb:abc123|value|with|pipes");
    expect(result).toEqual({
      callbackToken: "abc123",
      originalValue: "value|with|pipes",
    });
  });

  it("round-trips encode/decode with value", () => {
    const encoded = encodeCallbackValue("tok123", "my-value");
    const decoded = decodeCallbackValue(encoded);
    expect(decoded).toEqual({
      callbackToken: "tok123",
      originalValue: "my-value",
    });
  });

  it("round-trips encode/decode without value", () => {
    const encoded = encodeCallbackValue("tok123");
    const decoded = decodeCallbackValue(encoded);
    expect(decoded).toEqual({
      callbackToken: "tok123",
      originalValue: undefined,
    });
  });
});

describe("processCardCallbackUrls", () => {
  let state: MockStateAdapter;

  beforeEach(() => {
    state = createMockState();
  });

  it("returns the same card if no buttons have callbackUrl", async () => {
    const card = Card({
      title: "Test",
      children: [
        Text({ content: "Hello" }),
        Actions([Button({ id: "approve", label: "Approve" })]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    expect(result).toBe(card);
    expect(state.cache.size).toBe(0);
  });

  it("stores callbackUrl and encodes token in button value", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            callbackUrl: "https://example.com/hook/123",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);

    expect(result).not.toBe(card);
    const actions = result.children[0];
    expect(actions.type).toBe("actions");
    if (actions.type !== "actions") {
      throw new Error("expected actions");
    }
    const button = actions.children[0];
    expect(button.type).toBe("button");
    if (button.type !== "button") {
      throw new Error("expected button");
    }

    expect(button.callbackUrl).toBeUndefined();
    expect(button.value).toMatch(TOKEN_ONLY_RE);

    expect(state.cache.size).toBe(1);
    const storedUrl = [...state.cache.values()][0];
    expect(storedUrl).toBe("https://example.com/hook/123");
  });

  it("preserves original button value alongside token", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            value: "order-456",
            callbackUrl: "https://example.com/hook/123",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    const actions = result.children[0];
    if (actions.type !== "actions") {
      throw new Error("expected actions");
    }
    const button = actions.children[0];
    if (button.type !== "button") {
      throw new Error("expected button");
    }

    expect(button.value).toMatch(TOKEN_WITH_VALUE_RE);

    const decoded = decodeCallbackValue(button.value);
    expect(decoded.originalValue).toBe("order-456");
  });

  it("processes multiple buttons independently", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            callbackUrl: "https://example.com/approve",
          }),
          Button({
            id: "reject",
            label: "Reject",
            callbackUrl: "https://example.com/reject",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    const actions = result.children[0];
    if (actions.type !== "actions") {
      throw new Error("expected actions");
    }

    const btn1 = actions.children[0];
    const btn2 = actions.children[1];
    if (btn1.type !== "button" || btn2.type !== "button") {
      throw new Error("expected buttons");
    }

    expect(btn1.value).not.toBe(btn2.value);
    expect(state.cache.size).toBe(2);
    expect([...state.cache.values()]).toContain("https://example.com/approve");
    expect([...state.cache.values()]).toContain("https://example.com/reject");
  });

  it("leaves buttons without callbackUrl unchanged", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            callbackUrl: "https://example.com/hook",
          }),
          Button({ id: "cancel", label: "Cancel", value: "plain" }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    const actions = result.children[0];
    if (actions.type !== "actions") {
      throw new Error("expected actions");
    }

    const cancelBtn = actions.children[1];
    if (cancelBtn.type !== "button") {
      throw new Error("expected button");
    }
    expect(cancelBtn.value).toBe("plain");
    expect(cancelBtn.callbackUrl).toBeUndefined();
    expect(state.cache.size).toBe(1);
  });

  it("preserves non-action card children", async () => {
    const card = Card({
      title: "My Card",
      children: [
        Text({ content: "Hello world" }),
        Actions([
          Button({
            id: "go",
            label: "Go",
            callbackUrl: "https://example.com/hook",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    expect(result.title).toBe("My Card");
    expect(result.children[0].type).toBe("text");
    expect(result.children[1].type).toBe("actions");
  });
});

describe("resolveCallbackUrl", () => {
  it("returns the stored URL for a valid token", async () => {
    const state = createMockState();
    state.cache.set("chat:callback:mytoken", "https://example.com/hook");

    const url = await resolveCallbackUrl("mytoken", state);
    expect(url).toBe("https://example.com/hook");
  });

  it("returns null for an unknown token", async () => {
    const state = createMockState();
    const url = await resolveCallbackUrl("unknown", state);
    expect(url).toBeNull();
  });
});

describe("postToCallbackUrl", () => {
  it("POSTs JSON payload to the URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await postToCallbackUrl("https://example.com/hook", {
      type: "action",
      actionId: "approve",
    });

    expect(result.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "action", actionId: "approve" }),
    });

    vi.unstubAllGlobals();
  });

  it("returns error on fetch failure without throwing", async () => {
    const fetchError = new Error("network error");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(fetchError));

    const result = await postToCallbackUrl("https://example.com/hook", {
      type: "action",
    });

    expect(result.error).toBe(fetchError);

    vi.unstubAllGlobals();
  });
});
