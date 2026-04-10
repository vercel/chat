import { describe, expect, it, vi } from "vitest";
import type { PubSubPushMessage } from "./workspace-events";
import {
  createSpaceSubscription,
  decodePubSubMessage,
  deleteSpaceSubscription,
  listSpaceSubscriptions,
} from "./workspace-events";

vi.mock("@googleapis/workspaceevents", () => ({
  workspaceevents: vi.fn(),
  auth: {
    JWT: vi.fn(function MockJWT() {}),
    GoogleAuth: vi.fn(function MockGoogleAuth() {}),
  },
}));

function makePubSubMessage(
  payload: Record<string, unknown>,
  attributes?: Record<string, string>
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
      "projects/my-project/subscriptions/my-sub"
    );
  });

  it("should extract CloudEvents attributes", () => {
    const push = makePubSubMessage(
      { message: { text: "test" } },
      {
        "ce-type": "google.workspace.chat.message.v1.created",
        "ce-subject": "//chat.googleapis.com/spaces/ABC",
        "ce-time": "2024-01-15T10:00:00Z",
      }
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
      }
    );

    const result = decodePubSubMessage(push);
    expect(result.reaction?.name).toBe("spaces/ABC/messages/123/reactions/456");
    expect(result.reaction?.emoji?.unicode).toBe("\u{1F44D}");
  });
});

describe("createSpaceSubscription", () => {
  it("should return name and expireTime when operation is done", async () => {
    const { workspaceevents } = await import("@googleapis/workspaceevents");
    const mockCreate = vi.fn().mockResolvedValue({
      data: {
        done: true,
        response: {
          name: "subscriptions/sub-abc123",
          expireTime: "2024-01-16T10:00:00Z",
        },
      },
    });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: mockCreate, list: vi.fn(), delete: vi.fn() },
    });

    const result = await createSpaceSubscription(
      {
        spaceName: "spaces/AAABBBCCC",
        pubsubTopic: "projects/my-project/topics/chat-events",
      },
      {
        credentials: {
          client_email: "bot@project.iam.gserviceaccount.com",
          private_key:
            "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        },
      }
    );

    expect(result.name).toBe("subscriptions/sub-abc123");
    expect(result.expireTime).toBe("2024-01-16T10:00:00Z");
  });

  it("should return pending name when operation is not done", async () => {
    const { workspaceevents } = await import("@googleapis/workspaceevents");
    const mockCreate = vi.fn().mockResolvedValue({
      data: {
        done: false,
        name: "operations/op-xyz",
      },
    });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: mockCreate, list: vi.fn(), delete: vi.fn() },
    });

    const result = await createSpaceSubscription(
      {
        spaceName: "spaces/AAABBBCCC",
        pubsubTopic: "projects/my-project/topics/chat-events",
      },
      {
        credentials: {
          client_email: "bot@project.iam.gserviceaccount.com",
          private_key:
            "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
        },
      }
    );

    expect(result.name).toBe("operations/op-xyz");
    expect(result.expireTime).toBe("");
  });

  it("should use GoogleAuth when useApplicationDefaultCredentials is true", async () => {
    const { workspaceevents, auth } = await import(
      "@googleapis/workspaceevents"
    );
    const mockCreate = vi.fn().mockResolvedValue({
      data: {
        done: true,
        response: {
          name: "subscriptions/sub-adc",
          expireTime: "2024-01-16T10:00:00Z",
        },
      },
    });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: mockCreate, list: vi.fn(), delete: vi.fn() },
    });
    const GoogleAuthMock = auth.GoogleAuth as ReturnType<typeof vi.fn>;
    GoogleAuthMock.mockClear();

    await createSpaceSubscription(
      {
        spaceName: "spaces/AAABBBCCC",
        pubsubTopic: "projects/my-project/topics/chat-events",
      },
      { useApplicationDefaultCredentials: true }
    );

    expect(GoogleAuthMock).toHaveBeenCalledOnce();
  });

  it("should pass custom auth client directly", async () => {
    const { workspaceevents } = await import("@googleapis/workspaceevents");
    const mockCreate = vi.fn().mockResolvedValue({
      data: {
        done: true,
        response: {
          name: "subscriptions/sub-custom",
          expireTime: "2024-01-16T10:00:00Z",
        },
      },
    });
    const capturedArgs: Parameters<typeof workspaceevents>[] = [];
    (workspaceevents as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: Parameters<typeof workspaceevents>) => {
        capturedArgs.push(args);
        return {
          subscriptions: { create: mockCreate, list: vi.fn(), delete: vi.fn() },
        };
      }
    );

    const customAuth = { getAccessToken: vi.fn() };

    await createSpaceSubscription(
      {
        spaceName: "spaces/AAABBBCCC",
        pubsubTopic: "projects/my-project/topics/chat-events",
      },
      { auth: customAuth as never }
    );

    expect(capturedArgs[0][0].auth).toBe(customAuth);
  });
});

describe("listSpaceSubscriptions", () => {
  it("should return mapped subscriptions", async () => {
    const { workspaceevents } = await import("@googleapis/workspaceevents");
    const mockList = vi.fn().mockResolvedValue({
      data: {
        subscriptions: [
          {
            name: "subscriptions/sub-1",
            expireTime: "2024-01-16T10:00:00Z",
            eventTypes: [
              "google.workspace.chat.message.v1.created",
              "google.workspace.chat.message.v1.updated",
            ],
          },
          {
            name: "subscriptions/sub-2",
            expireTime: "2024-01-17T10:00:00Z",
            eventTypes: ["google.workspace.chat.reaction.v1.created"],
          },
        ],
      },
    });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: vi.fn(), list: mockList, delete: vi.fn() },
    });

    const result = await listSpaceSubscriptions("spaces/AAABBBCCC", {
      credentials: {
        client_email: "bot@project.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("subscriptions/sub-1");
    expect(result[0].expireTime).toBe("2024-01-16T10:00:00Z");
    expect(result[0].eventTypes).toEqual([
      "google.workspace.chat.message.v1.created",
      "google.workspace.chat.message.v1.updated",
    ]);
    expect(result[1].name).toBe("subscriptions/sub-2");
  });

  it("should return empty array when no subscriptions exist", async () => {
    const { workspaceevents } = await import("@googleapis/workspaceevents");
    const mockList = vi.fn().mockResolvedValue({
      data: { subscriptions: undefined },
    });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: vi.fn(), list: mockList, delete: vi.fn() },
    });

    const result = await listSpaceSubscriptions("spaces/AAABBBCCC", {
      useApplicationDefaultCredentials: true,
    });

    expect(result).toEqual([]);
  });
});

describe("deleteSpaceSubscription", () => {
  it("should call delete with the correct subscription name", async () => {
    const { workspaceevents } = await import("@googleapis/workspaceevents");
    const mockDelete = vi.fn().mockResolvedValue({ data: {} });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: vi.fn(), list: vi.fn(), delete: mockDelete },
    });

    await deleteSpaceSubscription("subscriptions/sub-abc123", {
      credentials: {
        client_email: "bot@project.iam.gserviceaccount.com",
        private_key:
          "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
      },
    });

    expect(mockDelete).toHaveBeenCalledWith({
      name: "subscriptions/sub-abc123",
    });
  });

  it("should work with ADC auth", async () => {
    const { workspaceevents, auth } = await import(
      "@googleapis/workspaceevents"
    );
    const mockDelete = vi.fn().mockResolvedValue({ data: {} });
    (workspaceevents as ReturnType<typeof vi.fn>).mockReturnValue({
      subscriptions: { create: vi.fn(), list: vi.fn(), delete: mockDelete },
    });
    const GoogleAuthMock = auth.GoogleAuth as ReturnType<typeof vi.fn>;
    GoogleAuthMock.mockClear();

    await deleteSpaceSubscription("subscriptions/sub-abc123", {
      useApplicationDefaultCredentials: true,
    });

    expect(mockDelete).toHaveBeenCalledWith({
      name: "subscriptions/sub-abc123",
    });
    expect(GoogleAuthMock).toHaveBeenCalledOnce();
  });
});
