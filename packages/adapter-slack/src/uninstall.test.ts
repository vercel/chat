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
  createMockLogger,
  createMockState,
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

const appUninstalledTeam = {
  token: "xAbCdEfGhIjKlMnOpQrStUvW",
  team_id: "T00FAKE00AA",
  api_app_id: "A00FAKEAPP01",
  event: {
    type: "app_uninstalled_team",
    app_id: "A00OTHERAPP1",
    app_name: "another-app",
    team_id: "T00FAKE00AA",
  },
  type: "event_callback",
  authorizations: [
    {
      team_id: "T00FAKE00AA",
      user_id: "U00FAKEUSER1",
      is_bot: false,
      is_enterprise_install: false,
    },
  ],
  event_id: "Ev0OTHERAPP1",
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
  const logger = createMockLogger();
  const adapter = createSlackAdapter({
    signingSecret: secret,
    logger,
    ...config,
  });
  const bot = new Chat({
    userName: "bot",
    adapters: { slack: adapter },
    state: createMockState(),
    logger,
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

  return { adapter, deliver, logger, uninstalled };
}

describe("Slack app_uninstalled", () => {
  let slackApi: MockInstance;

  beforeEach(() => {
    // Lifecycle events must be handled without calling the Slack Web API.
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
    const { deliver, logger, uninstalled } = await setup({
      installationProvider: { getInstallation },
    });

    await deliver(signedRequest(appUninstalled));

    expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ conversationId: "T00FAKE00AA" })
    );
    // The revoked token is useless, so the event skips token resolution.
    expect(getInstallation).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(slackApi).not.toHaveBeenCalled();
  });

  it.each([
    {
      install: "a workspace",
      // Each conflicting top-level field would pick another installation, so
      // these rows check that authorizations[0] takes precedence over them.
      envelope: { team_id: "T00FAKE00BB", is_enterprise_install: true },
      authorizations: [
        { team_id: "T00FAKE00AA", is_enterprise_install: false },
      ],
      key: "T00FAKE00AA",
      tenantId: undefined,
    },
    {
      install: "a workspace in an Enterprise Grid org",
      envelope: {
        enterprise_id: "E00FAKEORG02",
        team_id: "T00FAKE00BB",
        is_enterprise_install: true,
      },
      authorizations: [
        {
          enterprise_id: "E00FAKEORG01",
          team_id: "T00FAKE00AA",
          is_enterprise_install: false,
        },
      ],
      key: "T00FAKE00AA",
      tenantId: "E00FAKEORG01",
    },
    {
      install: "an org-wide app",
      envelope: {
        enterprise_id: "E00FAKEORG02",
        team_id: "T00FAKE00BB",
        is_enterprise_install: false,
      },
      // Synthetic authorization shape, unverified against live uninstall traffic.
      authorizations: [
        {
          enterprise_id: "E00FAKEORG01",
          team_id: null,
          is_enterprise_install: true,
        },
      ],
      key: "E00FAKEORG01",
      tenantId: "E00FAKEORG01",
    },
    {
      install: "a workspace named only by top-level fields",
      envelope: { team_id: "T00FAKE00BB" },
      authorizations: undefined,
      key: "T00FAKE00BB",
      tenantId: undefined,
    },
    {
      install: "an org-wide app named only by top-level fields",
      envelope: {
        enterprise_id: "E00FAKEORG02",
        team_id: "T00FAKE00BB",
        is_enterprise_install: true,
      },
      authorizations: undefined,
      key: "E00FAKEORG02",
      tenantId: "E00FAKEORG02",
    },
  ])("lets the handler delete only the stored installation for $install", async ({
    envelope,
    authorizations,
    key,
    tenantId,
  }) => {
    const { adapter, deliver, uninstalled } = await setup({});
    const keys = ["T00FAKE00AA", "T00FAKE00BB", "E00FAKEORG01", "E00FAKEORG02"];
    for (const teamId of keys) {
      await adapter.setInstallation(teamId, { botToken: `xoxb-${teamId}` });
    }
    uninstalled.mockImplementation(async (event) => {
      // Yield a macrotask first, so the deletion is only observed if the
      // handler's task was handed to waitUntil.
      await new Promise((resolve) => setTimeout(resolve));
      await adapter.deleteInstallation(event.conversationId);
    });

    await deliver(
      signedRequest({
        ...appUninstalled,
        ...envelope,
        authorizations: authorizations?.map((authorization) => ({
          ...authorization,
          user_id: "U00FAKEUSER1",
        })),
      })
    );

    expect(uninstalled).toHaveBeenCalledOnce();
    const [event] = uninstalled.mock.calls[0] ?? [];
    expect(event?.conversationId).toBe(key);
    expect(event?.tenantId).toBe(tenantId);
    expect(event && "tenantId" in event).toBe(tenantId !== undefined);
    for (const teamId of keys) {
      const stored = await adapter.getInstallation(teamId);
      expect(stored === null).toBe(teamId === key);
    }
    expect(slackApi).not.toHaveBeenCalled();
  });

  it.each([
    ["a forged signature", { signingSecret: "wrong-secret" }],
    ["a replayed timestamp", { timestampOffset: -600 }],
  ])("rejects a delivery with %s", async (_, options) => {
    const { deliver, uninstalled } = await setup();

    const response = await deliver(signedRequest(appUninstalled, options));

    expect(response.status).toBe(401);
    expect(uninstalled).not.toHaveBeenCalled();
    expect(slackApi).not.toHaveBeenCalled();
  });

  it("dispatches a retried delivery once", async () => {
    const { deliver, uninstalled } = await setup();

    await deliver(signedRequest(appUninstalled));
    await deliver(
      signedRequest(appUninstalled, { headers: { "x-slack-retry-num": "1" } })
    );

    expect(uninstalled).toHaveBeenCalledOnce();
    expect(slackApi).not.toHaveBeenCalled();
  });

  // app_uninstalled_team reports another app's removal to org-wide admin apps
  // (https://docs.slack.dev/reference/events/app_uninstalled_team), so it
  // must neither dispatch nor skip token resolution like app_uninstalled.
  it("resolves the installation for app_uninstalled_team without dispatching it", async () => {
    const getInstallation = vi.fn().mockResolvedValue(null);
    const { deliver, logger, uninstalled } = await setup({
      installationProvider: { getInstallation },
    });

    const response = await deliver(signedRequest(appUninstalledTeam));

    expect(response.status).toBe(200);
    expect(getInstallation).toHaveBeenCalledExactlyOnceWith(
      "T00FAKE00AA",
      false
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "Could not resolve token for installation",
      { installationId: "T00FAKE00AA", isEnterpriseInstall: false }
    );
    expect(uninstalled).not.toHaveBeenCalled();
    expect(slackApi).not.toHaveBeenCalled();
  });

  // Single-workspace mode never resolves installations, so only
  // multi-workspace mode can show that tokens_revoked skips the lookup.
  describe("tokens_revoked in multi-workspace mode", () => {
    async function setupWithInstallation() {
      const context = await setup({});
      const installation = { botToken: "xoxb-stored-token" };
      await context.adapter.setInstallation(
        appUninstalled.team_id,
        installation
      );
      const getInstallation = vi.spyOn(context.adapter, "getInstallation");
      return { ...context, installation, getInstallation };
    }

    it.each([
      ["before", true],
      ["after", false],
    ])("dispatches once when tokens_revoked arrives %s app_uninstalled", async (_, revokedFirst) => {
      const {
        adapter,
        deliver,
        logger,
        uninstalled,
        installation,
        getInstallation,
      } = await setupWithInstallation();
      uninstalled.mockImplementation(async (event) => {
        await adapter.deleteInstallation(event.conversationId);
      });
      const revoked = tokensRevoked({
        bot: ["U00FAKEBOT01"],
        oauth: ["U00FAKEUSER1"],
      });

      for (const payload of revokedFirst
        ? [revoked, appUninstalled]
        : [appUninstalled, revoked]) {
        const response = await deliver(signedRequest(payload));
        expect(response.status).toBe(200);

        if (payload.event.type === "tokens_revoked") {
          expect(uninstalled).toHaveBeenCalledTimes(revokedFirst ? 0 : 1);
          await expect(
            adapter.getInstallation(appUninstalled.team_id)
          ).resolves.toEqual(revokedFirst ? installation : null);
          getInstallation.mockClear();
        }
      }

      // Neither event looks up the installation, so the one deleted by the
      // handler doesn't produce missing-installation warnings.
      expect(getInstallation).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();

      expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ conversationId: appUninstalled.team_id })
      );
      await expect(
        adapter.getInstallation(appUninstalled.team_id)
      ).resolves.toBeNull();
      expect(slackApi).not.toHaveBeenCalled();
    });

    // Slack revokes tokens without uninstalling the app when a user removes
    // their own authorization, and "revoking a bot user token will not
    // uninstall the bot user or the app" (auth.revoke reference).
    it.each([
      ["a user token", { oauth: ["U00FAKEUSER1"] }],
      ["the bot token", { bot: ["U00FAKEBOT01"] }],
    ])("does not treat revoking %s as an uninstall", async (_, tokens) => {
      const { adapter, deliver, uninstalled, installation, getInstallation } =
        await setupWithInstallation();

      const response = await deliver(signedRequest(tokensRevoked(tokens)));

      expect(response.status).toBe(200);
      expect(uninstalled).not.toHaveBeenCalled();
      expect(getInstallation).not.toHaveBeenCalled();
      await expect(
        adapter.getInstallation(appUninstalled.team_id)
      ).resolves.toEqual(installation);
      expect(slackApi).not.toHaveBeenCalled();
    });
  });

  it("dispatches a Socket Mode delivery once across retries", async () => {
    const getInstallation = vi.fn().mockResolvedValue(null);
    const { adapter, uninstalled } = await setup({
      installationProvider: { getInstallation },
    });
    const pending: Promise<unknown>[] = [];
    const options: WebhookOptions = {
      waitUntil: (task) => pending.push(task),
    };
    const ack = vi.fn().mockResolvedValue(undefined);
    const routing = adapter as unknown as {
      routeSocketEvent(
        body: Record<string, unknown>,
        eventType: string,
        ack: () => Promise<void>,
        options?: WebhookOptions,
        retryNum?: number
      ): Promise<void>;
    };

    await routing.routeSocketEvent(appUninstalled, "events_api", ack, options);
    await Promise.all(pending.splice(0));

    expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        conversationId: "T00FAKE00AA",
        id: "Ev0UNINSTALL1",
      })
    );
    expect(ack).toHaveBeenCalledOnce();

    await routing.routeSocketEvent(
      appUninstalled,
      "events_api",
      ack,
      options,
      1
    );
    await Promise.all(pending.splice(0));

    expect(ack).toHaveBeenCalledTimes(2);
    expect(uninstalled).toHaveBeenCalledOnce();
    expect(getInstallation).not.toHaveBeenCalled();
    expect(slackApi).not.toHaveBeenCalled();
  });

  it("ignores a delivery before the adapter is initialized", async () => {
    const logger = createMockLogger();
    const adapter = createSlackAdapter({ signingSecret: secret, logger });

    const response = await adapter.handleWebhook(signedRequest(appUninstalled));

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "Chat instance not initialized, ignoring app_uninstalled"
    );
    expect(slackApi).not.toHaveBeenCalled();
  });

  it("dispatches an empty id when event_id is missing", async () => {
    const { deliver, uninstalled } = await setup();

    const response = await deliver(
      signedRequest({ ...appUninstalled, event_id: undefined })
    );

    expect(response.status).toBe(200);
    expect(uninstalled).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        id: "",
        conversationId: appUninstalled.team_id,
      })
    );
    expect(slackApi).not.toHaveBeenCalled();
  });

  it("ignores a delivery without an installation id", async () => {
    const { deliver, logger, uninstalled } = await setup();

    const response = await deliver(
      signedRequest({
        ...appUninstalled,
        team_id: undefined,
        authorizations: [],
      })
    );

    expect(response.status).toBe(200);
    expect(uninstalled).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "Ignoring app_uninstalled: missing installation id"
    );
    expect(slackApi).not.toHaveBeenCalled();
  });

  it("allows older custom Chat instances to omit processUninstalled", async () => {
    const legacy: Partial<ChatInstance> = createMockChatInstance();
    legacy.processUninstalled = undefined;
    const adapter = createSlackAdapter({
      botToken: "xoxb-test-token",
      botUserId: "U00FAKEBOT01",
      signingSecret: secret,
      logger: createMockLogger(),
    });
    await adapter.initialize(legacy as ChatInstance);

    const response = await adapter.handleWebhook(signedRequest(appUninstalled));

    expect(response.status).toBe(200);
    expect(slackApi).not.toHaveBeenCalled();
  });
});
