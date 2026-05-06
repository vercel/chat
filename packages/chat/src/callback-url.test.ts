import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  decodeCallbackValue,
  encodeCallbackValue,
  postToCallbackUrl,
  processCardCallbackUrls,
  resolveCallbackUrl,
} from "./callback-url";
import { Actions, Button, Card, CardText, Section } from "./cards";
import { createMockState } from "./mock-adapter";

const CALLBACK_TOKEN_PATTERN = /^__cb:[a-f0-9]{16}$/;
const CALLBACK_PREFIX_PATTERN = /^__cb:/;

describe("encodeCallbackValue / decodeCallbackValue", () => {
  it("encodes token", () => {
    const encoded = encodeCallbackValue("abc123");
    expect(encoded).toBe("__cb:abc123");
  });

  it("decodes token from encoded value", () => {
    const decoded = decodeCallbackValue("__cb:abc123");
    expect(decoded.callbackToken).toBe("abc123");
  });

  it("returns no token for regular values", () => {
    const decoded = decodeCallbackValue("regular-value");
    expect(decoded.callbackToken).toBeUndefined();
  });

  it("returns no token for undefined value", () => {
    const decoded = decodeCallbackValue(undefined);
    expect(decoded.callbackToken).toBeUndefined();
  });

  it("round-trips encode/decode", () => {
    const encoded = encodeCallbackValue("tok123");
    const decoded = decodeCallbackValue(encoded);
    expect(decoded.callbackToken).toBe("tok123");
  });
});

describe("processCardCallbackUrls", () => {
  let state: ReturnType<typeof createMockState>;

  beforeEach(() => {
    state = createMockState();
  });

  it("returns card unchanged when no buttons have callbackUrl", async () => {
    const card = Card({
      title: "Test",
      children: [
        CardText("Hello"),
        Actions([Button({ id: "btn", label: "Click" })]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    expect(result).toBe(card);
  });

  it("encodes callbackUrl into button value and stores in state", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "approve",
            label: "Approve",
            callbackUrl: "https://example.com/webhook/123",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);

    const actions = result.children.find((c) => c.type === "actions");
    expect(actions).toBeDefined();
    const button = actions?.children[0];
    expect(button?.type).toBe("button");
    expect(button?.value).toMatch(CALLBACK_TOKEN_PATTERN);
    expect(button?.callbackUrl).toBeUndefined();

    const decoded = decodeCallbackValue(button?.value);
    expect(decoded.callbackToken).toBeDefined();

    const token = decoded.callbackToken ?? "";
    const resolved = await resolveCallbackUrl(token, state);
    expect(resolved?.url).toBe("https://example.com/webhook/123");
  });

  it("stores original value in state alongside callback URL", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "btn",
            label: "Go",
            value: "item-99",
            callbackUrl: "https://hook.example.com",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    const button = result.children.find((c) => c.type === "actions")
      ?.children[0];

    expect(button?.value).toMatch(CALLBACK_TOKEN_PATTERN);

    const decoded = decodeCallbackValue(button?.value);
    const token = decoded.callbackToken ?? "";
    const resolved = await resolveCallbackUrl(token, state);
    expect(resolved?.url).toBe("https://hook.example.com");
    expect(resolved?.originalValue).toBe("item-99");
  });

  it("only processes buttons with callbackUrl, leaves others untouched", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({ id: "normal", label: "Normal", value: "keep" }),
          Button({
            id: "callback",
            label: "Callback",
            callbackUrl: "https://example.com",
          }),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    const actions = result.children.find((c) => c.type === "actions");
    const normalBtn = actions?.children[0];
    const callbackBtn = actions?.children[1];

    expect(normalBtn?.value).toBe("keep");
    expect(callbackBtn?.value).toMatch(CALLBACK_PREFIX_PATTERN);
  });

  it("processes buttons nested inside sections", async () => {
    const card = Card({
      title: "Test",
      children: [
        Section([
          CardText("Nested"),
          Actions([
            Button({
              id: "nested-btn",
              label: "Go",
              callbackUrl: "https://example.com/nested",
            }),
          ]),
        ]),
      ],
    });

    const result = await processCardCallbackUrls(card, state);
    const section = result.children.find((c) => c.type === "section");
    expect(section).toBeDefined();
    if (section?.type !== "section") {
      throw new Error("expected section");
    }
    const actions = section.children.find((c) => c.type === "actions");
    if (actions?.type !== "actions") {
      throw new Error("expected actions");
    }
    const button = actions.children[0];
    if (button?.type !== "button") {
      throw new Error("expected button");
    }

    expect(button.value).toMatch(CALLBACK_TOKEN_PATTERN);
    expect(button.callbackUrl).toBeUndefined();

    const decoded = decodeCallbackValue(button.value);
    const token = decoded.callbackToken ?? "";
    const resolved = await resolveCallbackUrl(token, state);
    expect(resolved?.url).toBe("https://example.com/nested");
  });

  it("does not mutate the original card", async () => {
    const card = Card({
      title: "Test",
      children: [
        Actions([
          Button({
            id: "btn",
            label: "Go",
            callbackUrl: "https://example.com",
          }),
        ]),
      ],
    });

    const original = JSON.parse(JSON.stringify(card));
    await processCardCallbackUrls(card, state);
    expect(card).toEqual(original);
  });
});

describe("resolveCallbackUrl", () => {
  let state: ReturnType<typeof createMockState>;

  beforeEach(() => {
    state = createMockState();
  });

  it("returns null for unknown token", async () => {
    const result = await resolveCallbackUrl("nonexistent", state);
    expect(result).toBeNull();
  });

  it("resolves stored callback with URL and original value", async () => {
    await state.set("chat:callback:test-token", {
      url: "https://example.com/hook",
      originalValue: "item-42",
    });
    const result = await resolveCallbackUrl("test-token", state);
    expect(result?.url).toBe("https://example.com/hook");
    expect(result?.originalValue).toBe("item-42");
  });

  it("handles legacy string format", async () => {
    await state.set("chat:callback:legacy-token", "https://example.com/hook");
    const result = await resolveCallbackUrl("legacy-token", state);
    expect(result?.url).toBe("https://example.com/hook");
    expect(result?.originalValue).toBeUndefined();
  });
});

describe("postToCallbackUrl", () => {
  it("POSTs JSON payload to the URL", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("ok"));

    const result = await postToCallbackUrl("https://example.com/hook", {
      type: "action",
      actionId: "approve",
    });

    expect(result.error).toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "action", actionId: "approve" }),
    });

    fetchSpy.mockRestore();
  });

  it("returns error for non-2xx responses", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const result = await postToCallbackUrl("https://example.com/hook", {});
    expect(result.error).toBeInstanceOf(Error);
    expect(result.status).toBe(404);

    fetchSpy.mockRestore();
  });

  it("catches fetch errors and returns them", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await postToCallbackUrl("https://example.com/hook", {});
    expect(result.error).toBeInstanceOf(Error);

    fetchSpy.mockRestore();
  });
});
