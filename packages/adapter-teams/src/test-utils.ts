import type { WebhookOptions } from "chat";
import { vi } from "vitest";
import { TeamsAdapter } from "./index";

export const appId = "11111111-2222-3333-4444-555555555555";
export const botId = `28:${appId}`;
export const serviceUrl = "https://smba.trafficmanager.net/amer/";

/** Token the SDK would have validated from the inbound JWT. */
export const token = {
  appId,
  serviceUrl,
  from: "azure" as const,
  fromId: appId,
  isExpired: () => false,
  toString: () => "test-token",
};

/** TeamsAdapter with hooks to drive the Microsoft SDK router without a network. */
export class TestTeamsAdapter extends TeamsAdapter {
  /** Return fixed WebhookOptions from the bridge instead of the real map. */
  stubWebhookOptions(options?: WebhookOptions) {
    return vi
      .spyOn(this.bridgeAdapter, "getWebhookOptions")
      .mockReturnValue(options);
  }

  /** The SDK looks up a user token per activity; keep that off the network. */
  private stubUserToken() {
    vi.spyOn(this.app.api.users, "getToken").mockRejectedValue(
      new Error("no user token in tests")
    );
  }

  /** Stub outbound Bot Framework calls so posts do not hit the network. */
  stubOutbound() {
    this.stubUserToken();
    return vi
      .spyOn(this.app, "sendTo")
      .mockResolvedValue({ id: "sent", type: "message" });
  }

  /** Observe the SDK transport send, including the resolved conversation reference. */
  spyActivitySender() {
    const app = this.app as unknown as {
      activitySender: { send: (...args: unknown[]) => Promise<unknown> };
    };
    this.stubUserToken();
    return vi
      .spyOn(app.activitySender, "send")
      .mockResolvedValue({ id: "sent", type: "message" });
  }

  /** Accept webhooks without a JWT so handleWebhook can be driven end to end. */
  allowUnauthenticatedWebhooks() {
    const server = this.app.server as unknown as {
      authorize: () => Promise<unknown>;
    };
    vi.spyOn(server, "authorize").mockResolvedValue({ success: true, token });
  }

  receive(body: { type: string; [key: string]: unknown }) {
    return this.app.process({ body, token });
  }
}
