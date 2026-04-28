/**
 * Tests for Discord Gateway client configuration.
 *
 * Verifies that the gateway Client is constructed with the correct
 * intents and partials for receiving DM events.
 */

import { GatewayIntentBits, Partials } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { createDiscordAdapter } from "./index";

const { MockClient, mockClientInstance } = vi.hoisted(() => {
  const mockClientInstance = {
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

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  child: vi.fn().mockReturnThis(),
};

const mockChat = {
  getLogger: vi.fn().mockReturnValue(mockLogger),
  getState: vi.fn(),
  getUserName: vi.fn().mockReturnValue("bot"),
  handleIncomingMessage: vi.fn(),
  processAction: vi.fn(),
  processOptionsLoad: vi.fn().mockResolvedValue(undefined),
  processAppHomeOpened: vi.fn(),
  processAssistantContextChanged: vi.fn(),
  processAssistantThreadStarted: vi.fn(),
  processMessage: vi.fn(),
  processModalClose: vi.fn(),
  processModalSubmit: vi.fn(),
  processReaction: vi.fn(),
};

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

    await adapter.initialize(mockChat as never);

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
});
