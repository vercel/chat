/**
 * Tests for Discord Gateway client configuration.
 *
 * Verifies that the gateway Client is constructed with the correct
 * intents and partials for receiving DM events.
 */

import { createMockChatInstance, mockLogger } from "@chat-adapter/tests";
import { GatewayIntentBits, Partials } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDiscordAdapter } from "./index";

const { MockClient, mockClientInstance } = vi.hoisted(() => {
  const mockClientInstance = {
    channels: { fetch: vi.fn() },
    on: vi.fn(),
    login: vi.fn().mockResolvedValue("token"),
    destroy: vi.fn(),
    user: { username: "testbot", id: "bot123" },
  };
  const MockClient = vi.fn().mockImplementation(function (
    this: typeof mockClientInstance
  ) {
    Object.assign(this, mockClientInstance);
    return this;
  });
  return { MockClient, mockClientInstance };
});

vi.mock("discord.js", async () => {
  const actual = await vi.importActual("discord.js");
  return {
    ...actual,
    Client: MockClient,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gateway client configuration", () => {
  it("includes Partials.Channel for DM support", async () => {
    MockClient.mockClear();
    mockClientInstance.on.mockClear();
    mockClientInstance.login.mockClear();
    mockClientInstance.destroy.mockClear();

    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: "a".repeat(64),
      applicationId: "test-app-id",
      logger: mockLogger,
    });

    await adapter.initialize(createMockChatInstance());

    // Use a pre-aborted signal so the listener resolves immediately
    const controller = new AbortController();
    controller.abort();

    let listenerPromise: Promise<unknown> | undefined;
    const response = await adapter.startGatewayListener(
      {
        waitUntil: (p) => {
          listenerPromise = p as Promise<unknown>;
        },
      },
      1000,
      controller.signal
    );

    expect(response.status).toBe(200);

    // Wait for the background listener to finish
    await listenerPromise;

    expect(MockClient).toHaveBeenCalledOnce();

    const clientOptions = MockClient.mock.calls[0][0] as {
      intents: number[];
      partials: number[];
    };

    expect(clientOptions.partials).toContain(Partials.Channel);
    expect(clientOptions.intents).toContain(GatewayIntentBits.DirectMessages);
  });

  it("forwards the parent channel only for allowlisted thread messages", async () => {
    mockClientInstance.on.mockClear();
    mockClientInstance.channels.fetch.mockResolvedValue({
      id: "thread789",
      parentId: "channel456",
      isThread: () => true,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createDiscordAdapter({
      botToken: "test-token",
      publicKey: "a".repeat(64),
      applicationId: "test-app-id",
      logger: mockLogger,
      respondToChannelIds: ["channel456"],
    });
    await adapter.initialize(createMockChatInstance());

    const controller = new AbortController();
    let listenerPromise: Promise<unknown> | undefined;
    await adapter.startGatewayListener(
      {
        waitUntil: (promise) => {
          listenerPromise = promise as Promise<unknown>;
        },
      },
      1000,
      controller.signal,
      "https://example.com/webhook"
    );

    const rawHandler = mockClientInstance.on.mock.calls.find(
      ([event]) => event === "raw"
    )?.[1] as (packet: { t: string; d: unknown }) => Promise<void>;
    await rawHandler({
      t: "MESSAGE_CREATE",
      d: { channel_id: "thread789", author: { bot: false } },
    });

    expect(mockClientInstance.channels.fetch).toHaveBeenCalledWith("thread789");
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(request.body as string)).toMatchObject({
      data: {
        channel_id: "thread789",
        author: { bot: false },
        thread: { id: "thread789", parent_id: "channel456" },
      },
    });

    mockClientInstance.channels.fetch.mockResolvedValue({
      id: "thread000",
      parentId: "other-channel",
      isThread: () => true,
    });
    await rawHandler({
      t: "MESSAGE_CREATE",
      d: { channel_id: "thread000", author: { bot: false } },
    });
    const otherRequest = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(otherRequest.body as string).data).toEqual({
      channel_id: "thread000",
      author: { bot: false },
    });

    controller.abort();
    await listenerPromise;
  });
});
