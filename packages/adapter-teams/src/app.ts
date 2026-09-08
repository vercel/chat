import type {
  ActivityLike,
  ConversationReference,
  SentActivity,
} from "@microsoft/teams.api";
import {
  Client as ConnectorClient,
  toActivityParams,
} from "@microsoft/teams.api";
import { App } from "@microsoft/teams.apps";
import type { TeamsThreadId } from "./types";

/** Bot Framework service URLs are compared and sent without a trailing slash. */
export function normalizeServiceUrl(serviceUrl: string): string {
  let end = serviceUrl.length;
  while (end > 0 && serviceUrl[end - 1] === "/") {
    end--;
  }
  return serviceUrl.slice(0, end);
}

/**
 * Teams SDK `App` that can address any Bot Framework service URL.
 *
 * `App.send` and `App.api` are bound to one process-wide service URL. Teams
 * thread IDs encode the service URL each conversation actually lives on
 * (regional hosts, sovereign clouds), so the adapter sends through these
 * helpers instead of the app-wide default.
 */
export class TeamsApp extends App {
  /**
   * An explicit `apiUrl` (`TEAMS_API_URL`) pins every outbound call to that
   * endpoint, for example a gateway or emulator. Without one the SDK default
   * is only a fallback, and the thread's own service URL wins.
   */
  private get hasServiceUrlOverride(): boolean {
    return Boolean(this.options.serviceUrl);
  }

  /** Connector API client for the given service URL, sharing the app's bot token. */
  apiFor(serviceUrl: string): ConnectorClient {
    const target = normalizeServiceUrl(serviceUrl);
    if (
      !target ||
      this.hasServiceUrlOverride ||
      target === normalizeServiceUrl(this.api.serviceUrl)
    ) {
      return this.api;
    }
    return new ConnectorClient(
      target,
      this.client.clone({ token: () => this.getBotToken() })
    );
  }

  /** Send an activity to the conversation a Teams thread ID points at. */
  async sendTo(
    target: TeamsThreadId,
    activity: ActivityLike
  ): Promise<SentActivity> {
    if (!this.id) {
      throw new Error("Teams app has no credentials configured");
    }
    // Like App.send, put only what the thread ID knows on the wire; the SDK
    // type requires conversationType but the connector accepts its absence.
    const conversation = {
      id: target.conversationId,
      ...(target.conversationType
        ? { conversationType: target.conversationType }
        : {}),
    } as ConversationReference["conversation"];
    const threadServiceUrl = this.hasServiceUrlOverride
      ? ""
      : normalizeServiceUrl(target.serviceUrl);
    const ref: ConversationReference = {
      channelId: "msteams",
      serviceUrl: threadServiceUrl || this.api.serviceUrl,
      bot: { id: this.id, role: "bot" },
      conversation,
    };
    return await this.activitySender.send(toActivityParams(activity), ref);
  }
}
