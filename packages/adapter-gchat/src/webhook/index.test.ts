import { describe, expect, it, vi } from "vitest";
import {
  decodeGoogleChatPubSubMessage,
  getGoogleChatFormInputValue,
  parseGoogleChatWebhookBody,
  readGoogleChatWebhook,
} from ".";

describe("Google Chat webhook primitives", () => {
  it("classifies direct message events", () => {
    const payload = parseGoogleChatWebhookBody({
      chat: {
        messagePayload: {
          message: {
            createTime: "2026-01-01T00:00:00Z",
            name: "spaces/AAAA/messages/1",
            sender: {
              displayName: "Ada",
              name: "users/1",
              type: "HUMAN",
            },
            text: "hello",
            thread: { name: "spaces/AAAA/threads/t1" },
          },
          space: { name: "spaces/AAAA", type: "ROOM" },
        },
      },
    });

    expect(payload).toMatchObject({
      continuation: {
        spaceName: "spaces/AAAA",
        threadName: "spaces/AAAA/threads/t1",
        transport: "direct",
      },
      kind: "message",
    });
  });

  it("decodes and classifies Workspace Events Pub/Sub messages", () => {
    const pushMessage = {
      message: {
        attributes: {
          "ce-subject": "//chat.googleapis.com/spaces/AAAA",
          "ce-time": "2026-01-01T00:00:00Z",
          "ce-type": "google.workspace.chat.message.v1.created",
        },
        data: Buffer.from(
          JSON.stringify({
            message: {
              createTime: "2026-01-01T00:00:00Z",
              name: "spaces/AAAA/messages/1",
              sender: {
                displayName: "Ada",
                name: "users/1",
                type: "HUMAN",
              },
              text: "hello",
            },
          })
        ).toString("base64"),
        messageId: "1",
        publishTime: "2026-01-01T00:00:00Z",
      },
      subscription: "subscriptions/1",
    };

    expect(decodeGoogleChatPubSubMessage(pushMessage)).toMatchObject({
      eventType: "google.workspace.chat.message.v1.created",
      targetResource: "//chat.googleapis.com/spaces/AAAA",
    });
    expect(parseGoogleChatWebhookBody(pushMessage)).toMatchObject({
      kind: "workspace_message",
      continuation: { spaceName: "spaces/AAAA", transport: "pubsub" },
    });
  });

  it("extracts form input values by action ID", () => {
    expect(
      getGoogleChatFormInputValue(
        { "input:choice": { stringInputs: { value: ["yes"] } } },
        "input:choice"
      )
    ).toBe("yes");
  });

  it("verifies bearer tokens when reading requests", async () => {
    const verifier = vi.fn(() => true);
    const request = new Request("https://example.com/webhook", {
      body: JSON.stringify({
        chat: {
          addedToSpacePayload: {
            space: { name: "spaces/AAAA", type: "ROOM" },
          },
        },
      }),
      headers: { authorization: "Bearer token" },
      method: "POST",
    });

    await expect(
      readGoogleChatWebhook(request, {
        googleChatProjectNumber: "123",
        tokenVerifier: verifier,
      })
    ).resolves.toMatchObject({ kind: "added_to_space" });
    expect(verifier).toHaveBeenCalledWith("token", "123");
  });
});
