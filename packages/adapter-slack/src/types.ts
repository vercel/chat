/**
 * Slack adapter types.
 */

import type { Logger } from "chat";
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

export interface SlackAdapterConfig {
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
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /** Connection mode: "webhook" (default) or "socket" */
  mode?: SlackAdapterMode;
  /** Signing secret for webhook verification. Defaults to SLACK_SIGNING_SECRET env var. */
  signingSecret?: string;
  /** Shared secret for authenticating forwarded socket mode events. Auto-detected from SLACK_SOCKET_FORWARDING_SECRET. Falls back to appToken if not set. */
  socketForwardingSecret?: string;
  /** Override bot username (optional) */
  userName?: string;
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
