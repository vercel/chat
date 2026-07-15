/**
 * Google Chat adapter types.
 */

import type { chat } from "@googleapis/chat";
import type { Logger } from "chat";

/** Service account credentials for JWT auth */
export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

/** Base config options shared by all auth methods */
export interface GoogleChatAdapterBaseConfig {
  /** Override the Google Chat API root URL. Defaults to GOOGLE_CHAT_API_URL env var. */
  apiUrl?: string;
  /**
   * Explicit opt-in to disable webhook signature verification. Required to
   * accept incoming webhooks when neither `googleChatProjectNumber` nor
   * `pubsubAudience` is configured. Without this flag set the constructor
   * throws — fail-closed by default. Only enable in development or when an
   * upstream layer (e.g. Cloud Run authenticated invocations) is providing
   * equivalent guarantees.
   */
  disableSignatureVerification?: boolean;
  /**
   * HTTP endpoint URL for button click action routing, and an accepted JWT
   * audience for direct-webhook verification.
   *
   * - **Button click routing**: required for HTTP-endpoint Chat apps —
   *   button clicks are dispatched back to this URL.
   * - **Webhook verification**: when set, this value is accepted as a valid
   *   `aud` claim for incoming direct webhooks. Configure this when the Chat
   *   app's authentication audience is "HTTP endpoint URL" (always the case
   *   for Workspace Add-on Chat apps, where Google issues OIDC tokens whose
   *   `aud` is the endpoint URL and whose `email` is
   *   `service-{projectNumber}@gcp-sa-gsuiteaddons.iam.gserviceaccount.com`).
   *
   * One of `endpointUrl`, `googleChatProjectNumber`, `pubsubAudience`, or
   * `disableSignatureVerification: true` is required. May be combined with
   * `googleChatProjectNumber` — when both are set, either audience verifies.
   *
   * Should be the full URL of your webhook endpoint, e.g.
   * `https://your-app.vercel.app/api/webhooks/gchat`.
   */
  endpointUrl?: string;
  /**
   * Google Cloud project number for verifying direct webhook JWTs.
   * When set, the adapter verifies the Bearer token on incoming Google Chat webhooks
   * by checking the JWT audience matches this project number.
   * Defaults to GOOGLE_CHAT_PROJECT_NUMBER env var.
   */
  googleChatProjectNumber?: string;
  /**
   * User email to impersonate for Workspace Events API calls.
   * Required when using domain-wide delegation.
   * This user must have access to the Chat spaces you want to subscribe to.
   * Defaults to GOOGLE_CHAT_IMPERSONATE_USER env var.
   */
  impersonateUser?: string;
  /** Logger instance for error reporting. Defaults to ConsoleLogger. */
  logger?: Logger;
  /**
   * Expected audience for Pub/Sub push message JWT verification.
   * Typically the push endpoint URL configured in your Pub/Sub subscription.
   * When set, the adapter verifies the Authorization Bearer token on Pub/Sub messages.
   * Defaults to GOOGLE_CHAT_PUBSUB_AUDIENCE env var.
   */
  pubsubAudience?: string;
  /**
   * Pub/Sub topic for receiving all messages via Workspace Events.
   * When set, the adapter will automatically create subscriptions when added to a space.
   * Format: "projects/my-project/topics/my-topic"
   * Defaults to GOOGLE_CHAT_PUBSUB_TOPIC env var.
   */
  pubsubTopic?: string;
  /** Override bot username (optional) */
  userName?: string;
}

/** Config using service account credentials (JSON key file) */
export interface GoogleChatAdapterServiceAccountConfig
  extends GoogleChatAdapterBaseConfig {
  auth?: never;
  /** Service account credentials JSON. Defaults to GOOGLE_CHAT_CREDENTIALS env var (JSON). */
  credentials: ServiceAccountCredentials;
  useApplicationDefaultCredentials?: never;
}

/** Config using Application Default Credentials (ADC) or Workload Identity Federation */
export interface GoogleChatAdapterADCConfig
  extends GoogleChatAdapterBaseConfig {
  auth?: never;
  credentials?: never;
  /**
   * Use Application Default Credentials.
   * Works with:
   * - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a JSON key file
   * - Workload Identity Federation (external_account JSON)
   * - GCE/Cloud Run/Cloud Functions default service account
   * - gcloud auth application-default login (local development)
   * Defaults to GOOGLE_CHAT_USE_ADC env var.
   */
  useApplicationDefaultCredentials: true;
}

/** Config using a custom auth client */
export interface GoogleChatAdapterCustomAuthConfig
  extends GoogleChatAdapterBaseConfig {
  /** Custom auth client (JWT, OAuth2, GoogleAuth, etc.) */
  auth: Parameters<typeof chat>[0]["auth"];
  credentials?: never;
  useApplicationDefaultCredentials?: never;
}

/** Config with no auth fields - will auto-detect from env vars */
export interface GoogleChatAdapterAutoConfig
  extends GoogleChatAdapterBaseConfig {
  auth?: never;
  credentials?: never;
  useApplicationDefaultCredentials?: never;
}

export type GoogleChatAdapterConfig =
  | GoogleChatAdapterServiceAccountConfig
  | GoogleChatAdapterADCConfig
  | GoogleChatAdapterCustomAuthConfig
  | GoogleChatAdapterAutoConfig;
