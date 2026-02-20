import { describe, expect, it } from "vitest";
import type { PubSubPushMessage } from "./workspace-events";
import { decodePubSubMessage, verifyPubSubRequest } from "./workspace-events";

function makePubSubMessage(
  payload: Record<string, unknown>,
  attributes?: Record<string, string>,
): PubSubPushMessage {
  return {
    message: {
      data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      messageId: "msg-123",
      publishTime: "2024-01-15T10:00:00Z",
      attributes,
    },
    subscription: "projects/my-project/subscriptions/my-sub",
  };
}

describe("decodePubSubMessage", () => {
  it("should decode base64 message payload", () => {
    const push = makePubSubMessage({
      message: { text: "Hello world", name: "spaces/ABC/messages/123" },
    });

    const result = decodePubSubMessage(push);
    expect(result.message?.text).toBe("Hello world");
    expect(result.subscription).toBe(
      "projects/my-project/subscriptions/my-sub",
    );
  });

  it("should extract CloudEvents attributes", () => {
    const push = makePubSubMessage(
      { message: { text: "test" } },
      {
        "ce-type": "google.workspace.chat.message.v1.created",
        "ce-subject": "//chat.googleapis.com/spaces/ABC",
        "ce-time": "2024-01-15T10:00:00Z",
      },
    );

    const result = decodePubSubMessage(push);
    expect(result.eventType).toBe("google.workspace.chat.message.v1.created");
    expect(result.targetResource).toBe("//chat.googleapis.com/spaces/ABC");
    expect(result.eventTime).toBe("2024-01-15T10:00:00Z");
  });

  it("should handle missing attributes", () => {
    const push = makePubSubMessage({ message: { text: "test" } });

    const result = decodePubSubMessage(push);
    expect(result.eventType).toBe("");
    expect(result.targetResource).toBe("");
    expect(result.eventTime).toBe("2024-01-15T10:00:00Z"); // falls back to publishTime
  });

  it("should decode reaction payload", () => {
    const push = makePubSubMessage(
      {
        reaction: {
          name: "spaces/ABC/messages/123/reactions/456",
          emoji: { unicode: "\u{1F44D}" },
        },
      },
      {
        "ce-type": "google.workspace.chat.reaction.v1.created",
      },
    );

    const result = decodePubSubMessage(push);
    expect(result.reaction?.name).toBe("spaces/ABC/messages/123/reactions/456");
    expect(result.reaction?.emoji?.unicode).toBe("\u{1F44D}");
  });
});

describe("verifyPubSubRequest", () => {
  it("should reject non-POST requests", () => {
    const req = new Request("https://example.com/webhook", {
      method: "GET",
    });
    expect(verifyPubSubRequest(req)).toBe(false);
  });

  it("should reject wrong content-type", () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "text/plain" },
    });
    expect(verifyPubSubRequest(req)).toBe(false);
  });

  it("should accept valid POST with JSON content-type", () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(verifyPubSubRequest(req)).toBe(true);
  });

  it("should accept application/json with charset", () => {
    const req = new Request("https://example.com/webhook", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
    });
    expect(verifyPubSubRequest(req)).toBe(true);
  });
});
