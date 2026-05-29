import {
  assertSlackOk,
  callSlackApi,
  type SlackApiOptions,
  type SlackApiResponse,
} from "./client";

export interface SlackThreadRepliesOptions extends SlackApiOptions {
  channel: string;
  cursor?: string;
  includeAllMetadata?: boolean;
  inclusive?: boolean;
  latest?: string;
  limit?: number;
  oldest?: string;
  ts: string;
}

export interface SlackThreadRepliesResult {
  messages: unknown[];
  nextCursor?: string;
  raw: SlackApiResponse;
}

export interface SlackOpenViewOptions extends SlackApiOptions {
  interactivityPointer?: string;
  triggerId?: string;
  view: unknown;
}

export interface SlackOpenViewResult {
  raw: SlackApiResponse;
  view?: unknown;
}

export async function fetchSlackThreadReplies(
  options: SlackThreadRepliesOptions
): Promise<SlackThreadRepliesResult> {
  const raw = await callSlackApi(
    "conversations.replies",
    {
      channel: options.channel,
      cursor: options.cursor,
      include_all_metadata: options.includeAllMetadata,
      inclusive: options.inclusive,
      latest: options.latest,
      limit: options.limit,
      oldest: options.oldest,
      ts: options.ts,
    },
    options
  );
  assertSlackOk("conversations.replies", raw);
  return {
    messages: Array.isArray(raw.messages) ? raw.messages : [],
    nextCursor: nextCursor(raw),
    raw,
  };
}

export async function openSlackView(
  options: SlackOpenViewOptions
): Promise<SlackOpenViewResult> {
  if (!(options.triggerId || options.interactivityPointer)) {
    throw new TypeError("triggerId or interactivityPointer is required");
  }
  const raw = await callSlackApi(
    "views.open",
    {
      interactivity_pointer: options.interactivityPointer,
      trigger_id: options.triggerId,
      view: options.view,
    },
    options
  );
  assertSlackOk("views.open", raw);
  return { raw, view: raw.view };
}

function nextCursor(response: SlackApiResponse): string | undefined {
  const cursor = response.response_metadata?.next_cursor;
  return typeof cursor === "string" && cursor.length > 0 ? cursor : undefined;
}
