/**
 * Test helpers for `@chat-adapter/notion`.
 *
 * Import from `@chat-adapter/notion/testing` in Vitest suites.
 */

import type { NotionComment, NotionWebhookEvent } from "./types";
import { signNotionBody } from "./utils";

export { signNotionBody, verifyNotionSignature } from "./utils";

const DEFAULT_PAGE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DEFAULT_DISCUSSION_ID = "11111111-2222-3333-4444-555555555555";
const DEFAULT_COMMENT_ID = "99999999-8888-7777-6666-555555555555";
const DEFAULT_USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/** Build a signed Notion webhook Request. */
export function buildSignedNotionWebhook(
  body: unknown,
  verificationToken: string,
  options: { url?: string; headers?: Record<string, string> } = {}
): Request {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  headers.set("x-notion-signature", signNotionBody(raw, verificationToken));
  return new Request(options.url ?? "https://example.com/api/webhooks/notion", {
    method: "POST",
    headers,
    body: raw,
  });
}

/** One-time verification handshake payload (unsigned). */
export function buildVerificationHandshake(
  verificationToken = "secret_notion_verification_token"
): { verification_token: string } {
  return { verification_token: verificationToken };
}

/** Sparse `comment.created` webhook event fixture. */
export function buildCommentCreatedEvent(
  overrides: Partial<NotionWebhookEvent> = {}
): NotionWebhookEvent {
  return {
    id: "event-fixture-1",
    timestamp: "2026-07-01T12:00:00.000Z",
    workspace_id: "workspace-fixture",
    subscription_id: "subscription-fixture",
    integration_id: "integration-fixture",
    type: "comment.created",
    entity: { id: DEFAULT_COMMENT_ID, type: "comment" },
    data: {
      page_id: DEFAULT_PAGE_ID,
      parent: { id: DEFAULT_PAGE_ID, type: "page" },
    },
    ...overrides,
  };
}

/** Defensive batched webhook envelope `{ events: [...] }`. */
export function buildAggregatedEventsEnvelope(events: NotionWebhookEvent[]): {
  events: NotionWebhookEvent[];
} {
  return { events };
}

/** Full Comment API object fixture. */
export function buildCommentFixture(
  overrides: Partial<NotionComment> = {}
): NotionComment {
  return {
    object: "comment",
    id: DEFAULT_COMMENT_ID,
    parent: { type: "page_id", page_id: DEFAULT_PAGE_ID },
    discussion_id: DEFAULT_DISCUSSION_ID,
    created_time: "2026-07-01T12:00:00.000Z",
    last_edited_time: "2026-07-01T12:00:00.000Z",
    created_by: {
      object: "user",
      id: DEFAULT_USER_ID,
      name: "Alice",
      type: "person",
    },
    rich_text: [
      {
        type: "text",
        plain_text: "Hello from Notion",
        annotations: {
          bold: false,
          italic: false,
          strikethrough: false,
          underline: false,
          code: false,
          color: "default",
        },
        text: { content: "Hello from Notion" },
      },
    ],
    ...overrides,
  };
}

/** Bot user fixture for GET /v1/users/me. */
export function buildBotUserFixture(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    object: "user",
    id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    name: "Docs Bot",
    avatar_url: null,
    type: "bot",
    bot: {
      owner: { type: "workspace", workspace: true },
      workspace_id: "workspace-fixture",
      workspace_name: "Acme",
      workspace_limits: { max_file_upload_size_in_bytes: 5_242_880 },
    },
    ...overrides,
  };
}

export const NOTION_TEST_IDS = {
  pageId: DEFAULT_PAGE_ID,
  discussionId: DEFAULT_DISCUSSION_ID,
  commentId: DEFAULT_COMMENT_ID,
  userId: DEFAULT_USER_ID,
} as const;
