/**
 * Slack uninstall lifecycle: a signed `app_uninstalled` delivery reaches
 * `chat.onUninstalled`.
 *
 * Payloads follow Slack's documented examples with sanitized IDs; no captured
 * uninstall traffic exists for these event types.
 * https://docs.slack.dev/reference/events/app_uninstalled
 * https://docs.slack.dev/reference/events/tokens_revoked
 */

import { createHmac } from "node:crypto";
import {
  createMockChatInstance,
  createMockState,
  mockLogger,
} from "@chat-adapter/tests";
import { WebClient } from "@slack/web-api";
import {
  Chat,
  type ChatInstance,
  type UninstalledEvent,
  type WebhookOptions,
} from "chat";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { createSlackAdapter, type SlackAdapterConfig } from "./index";

const secret = "test-signing-secret";

const appUninstalled = {
  token: "xAbCdEfGhIjKlMnOpQrStUvW",
  team_id: "T00FAKE00AA",
  api_app_id: "A00FAKEAPP01",
  event: { type: "app_uninstalled" },
  type: "event_callback",
  authorizations: [
    {
      team_id: "T00FAKE00AA",
      user_id: "U00FAKEUSER1",
      is_bot: false,
      is_enterprise_install: false,
    },
  ],
  event_id: "Ev0UNINSTALL1",
  event_time: 1_789_900_000,
};

function tokensRevoked(tokens: { bot?: string[]; oauth?: string[] }) {
  return {
    token: "xAbCdEfGhIjKlMnOpQrStUvW",
    team_id: "T00FAKE00AA",
    api_app_id: "A00FAKEAPP01",
    event: { type: "tokens_revoked", tokens },
    type: "event_callback",
    event_id: "Ev0REVOKED01",
    event_time: 1_789_900_000,
  };
}

function signedRequest(
  payload: unknown,
  {
    headers = {},
    signingSecret = secret,
    timestampOffset = 0,
  }: {
    headers?: Record<string, string>;
    signingSecret?: string;
    timestampOffset?: number;
  } = {}
): Request {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000) + timestampOffset);
  const signature = `v0=${createHmac("sha256", signingSecret)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;
  return new Request("https://example.com/api/webhooks/slack", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
      ...headers,
    },
    body,
  });
}

async function setup(
  config: Partial<SlackAdapterConfig> = {
    botToken: "xoxb-test-token",
    botUserId: "U00FAKEBOT01",
  }
) {
  const adapter = createSlackAdapter({
    signingSecret: secret,
    logger: mockLogger,
    ...config,
  });
  const bot = new Chat({
    userName: "bot",
    adapters: { slack: adapter },
    state: createMockState(),
    logger: mockLogger,
  });
  await bot.initialize();
  const uninstalled = vi.fn<(event: UninstalledEvent) => Promise<void>>();
  bot.onUninstalled(uninstalled);

  /** Deliver a webhook and wait for every task it registered. */
  async function deliver(request: Request): Promise<Response> {
    const pending: Promise<unknown>[] = [];
    const response = await adapter.handleWebhook(request, {
      waitUntil: (task) => pending.push(task),
    });
    await Promise.all(pending);
    return response;
  }

  return { adapter, deliver, uninstalled };
}

describe("Slack app_uninstalled", () => {
  let slackApi: MockInstance;

  beforeEach(() => {
    // The tokens are revoked by the time Slack sends these events, so no
    // test may reach the Slack Web API.
    slackApi = vi
      .spyOn(WebClient.prototype, "apiCall")
      .mockRejectedValue(new Error("unexpected Slack API call"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches a signed delivery to onUninstalled", async () => {
    const { adapter, deliver, uninstalled } = await setup();

    const response = await deliver(signedRequest(appUninstalled));

    expect(response.status).toBe(200);
    expect(uninstalled).toHaveBeenCalledExactlyOnceWith({
      action: "remove",
      adapter,
      conversationId: "T00FAKE00AA",
      id: "Ev0UNINSTALL1",
      raw: appUninstalled,
    });
    expect(slackApi).not.toHaveBeenCalled();
  });

  it("dispatches when the installation provider no longer returns the installation", async () => {
    const getInstallation = vi.fn().mockResolvedValue(null);
    const { deliver, uninstalled } = await setup({
      installationProvider: { getInstallation },
    });

    await deliver(signedRequest(appUninstalled));

    expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ conversationId: "T00FAKE00AA" })
    );
    // The revoked token is useless, so the event skips token resolution.
    expect(getInstallation).not.toHaveBeenCalled();
  });

  it.each([
    {
      install: "a workspace",
      authorization: { team_id: "T00FAKE00AA", is_enterprise_install: false },
      key: "T00FAKE00AA",
    },
    {
      install: "a workspace in an Enterprise Grid org",
      authorization: {
        enterprise_id: "E00FAKEORG01",
        team_id: "T00FAKE00AA",
        is_enterprise_install: false,
      },
      key: "T00FAKE00AA",
    },
    {
      install: "an org-wide app",
      authorization: {
        enterprise_id: "E00FAKEORG01",
        team_id: null,
        is_enterprise_install: true,
      },
      key: "E00FAKEORG01",
    },
  ])("lets the handler delete only $install's stored installation", async ({
    authorization,
    key,
  }) => {
    const { adapter, deliver, uninstalled } = await setup({});
    const keys = ["T00FAKE00AA", "T00FAKE00BB", "E00FAKEORG01"];
    for (const teamId of keys) {
      await adapter.setInstallation(teamId, { botToken: `xoxb-${teamId}` });
    }
    uninstalled.mockImplementation(async (event) => {
      await adapter.deleteInstallation(event.conversationId);
    });

    await deliver(
      signedRequest({
        ...appUninstalled,
        // The top-level team_id still names a workspace, so this checks that
        // the installation identity comes from authorizations.
        ...(authorization.enterprise_id
          ? { enterprise_id: authorization.enterprise_id }
          : {}),
        authorizations: [{ ...authorization, user_id: "U00FAKEUSER1" }],
      })
    );

    expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ conversationId: key })
    );
    for (const teamId of keys) {
      const stored = await adapter.getInstallation(teamId);
      expect(stored === null).toBe(teamId === key);
    }
  });

  it.each([
    ["a forged signature", { signingSecret: "wrong-secret" }],
    ["a replayed timestamp", { timestampOffset: -600 }],
  ])("rejects a delivery with %s", async (_, options) => {
    const { deliver, uninstalled } = await setup();

    const response = await deliver(signedRequest(appUninstalled, options));

    expect(response.status).toBe(401);
    expect(uninstalled).not.toHaveBeenCalled();
  });

  it("dispatches a retried delivery once", async () => {
    const { deliver, uninstalled } = await setup();

    await deliver(signedRequest(appUninstalled));
    await deliver(
      signedRequest(appUninstalled, { headers: { "x-slack-retry-num": "1" } })
    );

    expect(uninstalled).toHaveBeenCalledOnce();
  });

  it.each([
    ["before", true],
    ["after", false],
  ])("dispatches once when tokens_revoked arrives %s app_uninstalled", async (_, revokedFirst) => {
    const { deliver, uninstalled } = await setup();
    const revoked = signedRequest(
      tokensRevoked({ bot: ["U00FAKEBOT01"], oauth: ["U00FAKEUSER1"] })
    );
    const removed = signedRequest(appUninstalled);

    for (const request of revokedFirst
      ? [revoked, removed]
      : [removed, revoked]) {
      await deliver(request);
    }

    expect(uninstalled).toHaveBeenCalledOnce();
  });

  // Slack revokes tokens without uninstalling the app when a user removes
  // their own authorization, and "revoking a bot user token will not
  // uninstall the bot user or the app" (auth.revoke reference).
  it.each([
    ["a user token", { oauth: ["U00FAKEUSER1"] }],
    ["the bot token", { bot: ["U00FAKEBOT01"] }],
  ])("does not treat revoking %s as an uninstall", async (_, tokens) => {
    const { deliver, uninstalled } = await setup();

    const response = await deliver(signedRequest(tokensRevoked(tokens)));

    expect(response.status).toBe(200);
    expect(uninstalled).not.toHaveBeenCalled();
  });

  it("dispatches a Socket Mode delivery", async () => {
    const { adapter, uninstalled } = await setup({
      installationProvider: {
        getInstallation: vi.fn().mockResolvedValue(null),
      },
    });
    const pending: Promise<unknown>[] = [];
    const routing = adapter as unknown as {
      routeSocketEvent(
        body: Record<string, unknown>,
        eventType: string,
        ack: () => Promise<void>,
        options?: WebhookOptions
      ): Promise<void>;
    };

    await routing.routeSocketEvent(
      appUninstalled,
      "events_api",
      async () => {},
      { waitUntil: (task) => pending.push(task) }
    );
    await Promise.all(pending);

    expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        conversationId: "T00FAKE00AA",
        id: "Ev0UNINSTALL1",
      })
    );
  });

  it("ignores a delivery without an installation id", async () => {
    const { deliver, uninstalled } = await setup();

    const response = await deliver(
      signedRequest({
        ...appUninstalled,
        team_id: undefined,
        authorizations: [],
      })
    );

    expect(response.status).toBe(200);
    expect(uninstalled).not.toHaveBeenCalled();
  });

  it("allows older custom Chat instances to omit processUninstalled", async () => {
    const legacy: Partial<ChatInstance> = createMockChatInstance();
    legacy.processUninstalled = undefined;
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      botUserId: "U00FAKEBOT01",
      signingSecret: secret,
      logger: mockLogger,
    });
    await adapter.initialize(legacy as ChatInstance);

    const response = await adapter.handleWebhook(signedRequest(appUninstalled));

    expect(response.status).toBe(200);
  });
});
