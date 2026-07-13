/**
 * Slack adapter types.
 */

import type { WebClientOptions } from "@slack/web-api";
import type { AppContextEntity, Logger } from "chat";
import type { SlackWebhookVerifier } from "./webhook/index";

export type SlackAdapterMode = "webhook" | "socket";

/**
 * Bot token configuration. Can be a static string, or a function that returns
 * a token (optionally asynchronously). The function is invoked each time a
 * token is needed, enabling rotation or lazy retrieval from a secret manager.
 */
export type SlackBotToken = string | (() => string | Promise<string>);

/** Data stored per Slack workspace installation */
export interface SlackInstallation {
  botToken: string;
  botUserId?: string;
  teamName?: string;
}

/** Options for the feedback buttons appended to streamed replies. */
export interface SlackFeedbackButtonsOptions {
  /**
   * `action_id` dispatched to `bot.onAction` when a button is clicked.
   * Defaults to "message_feedback".
   */
  actionId?: string;
  /** Label for the negative button. Defaults to "Bad response". */
  negativeLabel?: string;
  /** Action value dispatched for negative clicks. Defaults to "negative". */
  negativeValue?: string;
  /** Label for the positive button. Defaults to "Good response". */
  positiveLabel?: string;
  /** Action value dispatched for positive clicks. Defaults to "positive". */
  positiveValue?: string;
}

/** A single suggested prompt shown in an assistant/agent thread. */
export interface SlackSuggestedPrompt {
  /** Full prompt text sent as the user's message when the prompt is clicked. */
  message: string;
  /** Short label shown on the prompt button. */
  title: string;
}

/** Suggested prompts payload applied when an assistant/agent thread opens. */
export interface SlackSuggestedPromptsOptions {
  /** The prompts to display. Slack shows at most 4. */
  prompts: SlackSuggestedPrompt[];
  /** Optional heading shown above the prompts. */
  title?: string;
}

/** Context passed to a dynamic `suggestedPrompts` resolver. */
export interface SlackSuggestedPromptsContext {
  /** The DM channel the assistant/agent thread lives in. */
  channelId: string;
  /** Enterprise the user opened the thread from (legacy assistant_view). */
  enterpriseId?: string;
  /** Active-view context entities (agent_view, when Slack folds context in). */
  entities?: AppContextEntity[];
  /** Team the user opened the thread from (legacy assistant_view). */
  teamId?: string;
  /** Assistant thread root (legacy assistant_view; absent under agent_view). */
  threadTs?: string;
  /** The user who opened the thread. */
  userId: string;
}

/**
 * Suggested prompts configuration: a static payload, or a resolver invoked
 * each time an assistant/agent thread opens. Return null/undefined from the
 * resolver to skip setting prompts for that thread.
 */
export type SlackSuggestedPrompts =
  | SlackSuggestedPromptsOptions
  | ((
      context: SlackSuggestedPromptsContext
    ) =>
      | SlackSuggestedPromptsOptions
      | null
      | undefined
      | Promise<SlackSuggestedPromptsOptions | null | undefined>);

export interface SlackAdapterConfig {
  /**
   * Enable Slack's Agent messaging experience (`agent_view` manifest mode).
   * When true, `app_home_opened` is treated as the DM-open signal regardless of
   * tab and folded active-view context is surfaced. Defaults to false (legacy
   * `assistant_view`).
   */
  agentView?: boolean;
  /** Override the Slack API base URL (e.g. "https://slack-gov.com/api/" for GovSlack). Defaults to SLACK_API_URL env var. */
  apiUrl?: string;
  /** App-level token (xapp-...). Required for socket mode. */
  appToken?: string;
  /**
   * Bot token (xoxb-...). Required for single-workspace mode. Omit for multi-workspace.
   * May be a string, or a function returning a string or Promise<string> (called
   * on each use to support rotation or deferred resolution).
   */
  botToken?: SlackBotToken;
  /** Bot user ID (will be fetched if not provided) */
  botUserId?: string;
  /** Slack app client ID (required for OAuth / multi-workspace) */
  clientId?: string;
  /** Slack app client secret (required for OAuth / multi-workspace) */
  clientSecret?: string;
  /**
   * Base64-encoded 32-byte AES-256-GCM encryption key.
   * If provided, bot tokens stored via setInstallation() will be encrypted at rest.
   */
  encryptionKey?: string;
  /**
   * Append Slack's native feedback buttons (a `context_actions` block with a
   * `feedback_buttons` element) to every streamed reply, attached when the
   * stream finishes. Clicks dispatch to `bot.onAction` with the configured
   * `actionId` and a positive/negative value. Pass `true` for defaults, or an
   * options object to customize labels, values, and the action id. Skipped
   * when a stream falls back to post-and-edit.
   */
  feedbackButtons?: boolean | SlackFeedbackButtonsOptions;
  /**
   * Prefix for the state key used to store workspace installations.
   * Defaults to `slack:installation`. The full key will be `{prefix}:{teamId}`.
   */
  installationKeyPrefix?: string;
  /**
   * External installation provider for multi-workspace apps using external
   * token management (e.g., Vercel Connect). When set, the adapter bypasses
   * internal StateAdapter storage for token lookups.
   *
   * For Enterprise Grid org-wide installs, `installationId` will be the
   * enterprise ID; otherwise it will be the team ID.
   */
  installationProvider?: {
    getInstallation: (
      installationId: string,
      isEnterpriseInstall: boolean
    ) => Promise<SlackInstallation | null>;
  };
  /**
   * Default rotating loading messages for the assistant thinking indicator
   * (`assistant.threads.setStatus` `loading_messages`). Used by `startTyping`
   * and `setAssistantStatus` when no explicit status/messages are passed.
   */
  loadingMessages?: string[];
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Connection mode: "webhook" (default) or "socket" */
  mode?: SlackAdapterMode;
  /**
   * Use Slack's native streaming API (`chat.startStream` / `chat.appendStream`
   * / `chat.stopStream`) for streamed posts. Defaults to true. Set false on
   * Slack flavours without the streaming methods (e.g. GovSlack) to always
   * stream via post-and-edit; the adapter also falls back automatically when
   * the workspace rejects the first native call.
   */
  nativeStreaming?: boolean;
  /** Signing secret for webhook verification. Defaults to SLACK_SIGNING_SECRET env var. */
  signingSecret?: string;
  /** Shared secret for authenticating forwarded socket mode events. Auto-detected from SLACK_SOCKET_FORWARDING_SECRET. Falls back to appToken if not set. */
  socketForwardingSecret?: string;
  /**
   * Suggested prompts to pin automatically when an assistant/agent thread
   * opens. Applied on `assistant_thread_started` (legacy `assistant_view`)
   * and on Messages-tab `app_home_opened` (with `agentView` enabled, where
   * prompts sit at the top of the agent conversation). Pass a static payload
   * or a resolver that receives the thread context (user, channel,
   * active-view entities) and returns prompts per thread.
   */
  suggestedPrompts?: SlackSuggestedPrompts;
  /** Override bot username (optional) */
  userName?: string;
  /**
   * Options forwarded to the underlying `@slack/web-api` `WebClient` instances, both the
   * default client and the per-token clients used for multi-workspace requests.
   *
   * Use this to tune Web API behavior the adapter does not otherwise expose, most
   * notably `retryConfig` and `timeout`. By default the WebClient retries rate-limited
   * (429) requests with `retryPolicies.tenRetriesInAboutThirtyMinutes`, so a single
   * `chat.update`/`chat.postMessage` can block for ~30 minutes under sustained rate
   * limiting. Callers that stream frequent edits (where a hung call can stall a whole
   * turn) will typically want a bounded policy and/or a timeout. `timeout` applies to
   * each HTTP request attempt, not the total retry period. Set
   * `rejectRateLimitedCalls` to reject 429 responses without waiting for `Retry-After`.
   *
   * ```ts
   * import { retryPolicies } from "@slack/web-api";
   * createSlackAdapter({
   *   signingSecret,
   *   webClientOptions: { retryConfig: retryPolicies.fiveRetriesInFiveMinutes, timeout: 15_000 },
   * });
   * ```
   *
   * Use `apiUrl` to override the Slack Web API base URL.
   */
  webClientOptions?: Omit<WebClientOptions, "slackApiUrl">;
  /**
   * Custom webhook verifier. Used in place of `signingSecret`.
   * Receives the incoming `Request` and the raw body text already
   * read by the adapter. To reject the request, either
   * return a falsy value (sync or async) or throw/reject; the adapter will
   * respond with `401 Invalid signature`. Any truthy return value is treated
   * as a successful verification. If a string is returned, it replaces the
   * raw body for downstream parsing — useful when the verifier needs to
   * canonicalize or substitute the verified payload.
   *
   * `webhookVerifier` takes precedence over `signingSecret` and the
   * `SLACK_SIGNING_SECRET` env var; when it is set, those are ignored.
   *
   * SECURITY: When this is used in place of `signingSecret`, the built-in
   * Slack timestamp tolerance check is NOT performed. Implementations are
   * responsible for verifying the `x-slack-request-timestamp` header (or an
   * equivalent freshness signal) to prevent replay of captured signed
   * requests.
   */
  webhookVerifier?: SlackWebhookVerifier;
}
