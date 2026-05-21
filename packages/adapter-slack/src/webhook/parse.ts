import type {
  SlackAction,
  SlackAppMentionPayload,
  SlackBlockActionsPayload,
  SlackBlockSuggestionPayload,
  SlackDirectMessagePayload,
  SlackParseOptions,
  SlackRetry,
  SlackSlashCommandPayload,
  SlackViewClosedPayload,
  SlackViewSubmissionPayload,
  SlackWebhookPayload,
} from "./types";
import {
  getHeader,
  getRetry,
  isFormBody,
  isRecord,
  optionalString,
  parseJsonBody,
  recordValue,
  stringValue,
} from "./utils";

export function parseSlackWebhookBody(
  body: string,
  options: SlackParseOptions = {}
): SlackWebhookPayload {
  const headers = options.headers;
  const contentType =
    options.contentType ?? getHeader(headers, "content-type") ?? "";
  const retry = getRetry(headers);

  if (isFormBody(body, contentType)) {
    return parseFormBody(body, retry);
  }

  const raw = parseJsonBody(body);
  return classifyJsonPayload(raw, retry);
}

function parseFormBody(
  body: string,
  retry: SlackRetry | undefined
): SlackWebhookPayload {
  const params = new URLSearchParams(body);
  const payload = params.get("payload");
  if (payload !== null) {
    const raw = parseJsonBody(payload);
    return classifyInteractionPayload(raw, retry);
  }
  if (params.has("command")) {
    return parseSlashCommand(params, retry);
  }
  return {
    kind: "unsupported",
    raw: Object.fromEntries(params),
    retry,
    type: "form",
  };
}

function classifyJsonPayload(
  raw: unknown,
  retry: SlackRetry | undefined
): SlackWebhookPayload {
  if (!isRecord(raw)) {
    return { kind: "unsupported", raw, retry, type: "unknown" };
  }

  if (raw.type === "url_verification" && typeof raw.challenge === "string") {
    return { challenge: raw.challenge, kind: "url_verification", raw, retry };
  }

  if (raw.type !== "event_callback" || !isRecord(raw.event)) {
    return {
      kind: "unsupported",
      raw,
      retry,
      type: typeof raw.type === "string" ? raw.type : "unknown",
    };
  }

  const event = raw.event;
  if (event.type === "app_mention") {
    return parseMessageEvent("app_mention", raw, event, retry);
  }

  if (event.type === "message" && event.channel_type === "im") {
    return parseMessageEvent("direct_message", raw, event, retry);
  }

  return {
    kind: "unsupported",
    raw,
    retry,
    type: typeof event.type === "string" ? event.type : "event_callback",
  };
}

function classifyInteractionPayload(
  raw: unknown,
  retry: SlackRetry | undefined
): SlackWebhookPayload {
  if (!isRecord(raw)) {
    return { kind: "unsupported", raw, retry, type: "interaction" };
  }

  switch (raw.type) {
    case "block_actions":
      return parseBlockActions(raw, retry);
    case "block_suggestion":
      return parseBlockSuggestion(raw, retry);
    case "view_submission":
      return parseViewSubmission(raw, retry);
    case "view_closed":
      return parseViewClosed(raw, retry);
    default:
      return {
        kind: "unsupported",
        raw,
        retry,
        type: typeof raw.type === "string" ? raw.type : "interaction",
      };
  }
}

function parseMessageEvent(
  kind: "app_mention" | "direct_message",
  envelope: Record<string, unknown>,
  event: Record<string, unknown>,
  retry: SlackRetry | undefined
): SlackAppMentionPayload | SlackDirectMessagePayload {
  const channelId = stringValue(event.channel);
  const ts = stringValue(event.ts);
  const threadTs = stringValue(event.thread_ts) || ts;
  const teamId =
    optionalString(event.team_id) || optionalString(envelope.team_id);
  const enterpriseId =
    optionalString(envelope.enterprise_id) ||
    optionalString(envelope.context_enterprise_id);
  const continuation = channelId
    ? { channelId, enterpriseId, teamId, threadTs }
    : { channelId: "", enterpriseId, teamId, threadTs };
  const base = {
    apiAppId: optionalString(envelope.api_app_id),
    channelId,
    continuation,
    enterpriseId,
    eventId: optionalString(envelope.event_id),
    eventTime:
      typeof envelope.event_time === "number" ? envelope.event_time : undefined,
    eventType: event.type,
    isExtSharedChannel:
      typeof envelope.is_ext_shared_channel === "boolean"
        ? envelope.is_ext_shared_channel
        : undefined,
    raw: event,
    retry,
    teamId,
    text: stringValue(event.text),
    threadTs,
    ts,
    userId: optionalString(event.user),
  };

  if (kind === "app_mention") {
    return { ...base, eventType: "app_mention", kind };
  }

  return {
    ...base,
    botId: optionalString(event.bot_id),
    eventType: "message",
    kind,
    subtype: optionalString(event.subtype),
  };
}

function parseSlashCommand(
  params: URLSearchParams,
  retry: SlackRetry | undefined
): SlackSlashCommandPayload {
  const enterpriseId = params.get("enterprise_id") || undefined;
  const teamId = params.get("team_id") || undefined;
  return {
    channelId: params.get("channel_id") ?? "",
    channelName: params.get("channel_name") || undefined,
    command: params.get("command") ?? "",
    enterpriseId,
    isEnterpriseInstall: params.get("is_enterprise_install") === "true",
    kind: "slash_command",
    raw: Object.fromEntries(params),
    responseUrl: params.get("response_url") || undefined,
    retry,
    teamId,
    text: params.get("text") ?? "",
    triggerId: params.get("trigger_id") || undefined,
    userId: params.get("user_id") ?? "",
    userName: params.get("user_name") || undefined,
  };
}

function parseBlockActions(
  raw: Record<string, unknown>,
  retry: SlackRetry | undefined
): SlackBlockActionsPayload {
  const channel = recordValue(raw.channel);
  const container = recordValue(raw.container);
  const message = recordValue(raw.message);
  const user = recordValue(raw.user);
  const team = recordValue(raw.team);
  const enterprise = recordValue(raw.enterprise);
  const channelId =
    optionalString(channel?.id) || optionalString(container?.channel_id);
  const messageTs =
    optionalString(message?.ts) || optionalString(container?.message_ts);
  const threadTs =
    optionalString(message?.thread_ts) ||
    optionalString(container?.thread_ts) ||
    messageTs;
  const teamId = optionalString(team?.id) || optionalString(user?.team_id);
  const enterpriseId =
    optionalString(enterprise?.id) || optionalString(team?.enterprise_id);
  const continuation =
    channelId && threadTs
      ? { channelId, enterpriseId, teamId, threadTs }
      : undefined;

  return {
    actions: Array.isArray(raw.actions) ? raw.actions.map(parseAction) : [],
    channelId,
    continuation,
    enterpriseId,
    isEnterpriseInstall:
      typeof raw.is_enterprise_install === "boolean"
        ? raw.is_enterprise_install
        : undefined,
    kind: "block_actions",
    messageTs,
    raw,
    responseUrl: optionalString(raw.response_url),
    retry,
    teamId,
    threadTs,
    triggerId: optionalString(raw.trigger_id),
    userId: stringValue(user?.id),
    userName: optionalString(user?.username) || optionalString(user?.name),
  };
}

function parseAction(action: unknown): SlackAction {
  const raw = isRecord(action) ? action : {};
  const selectedOption = recordValue(raw.selected_option);
  const text = recordValue(raw.text);
  return {
    actionId: stringValue(raw.action_id),
    blockId: optionalString(raw.block_id),
    label: optionalString(text?.text),
    raw,
    selectedOptionValue: optionalString(selectedOption?.value),
    type: stringValue(raw.type),
    value: optionalString(raw.value),
  };
}

function parseBlockSuggestion(
  raw: Record<string, unknown>,
  retry: SlackRetry | undefined
): SlackBlockSuggestionPayload {
  const channel = recordValue(raw.channel);
  const team = recordValue(raw.team);
  const enterprise = recordValue(raw.enterprise);
  const user = recordValue(raw.user);
  return {
    actionId: stringValue(raw.action_id),
    blockId: stringValue(raw.block_id),
    channelId: optionalString(channel?.id),
    enterpriseId:
      optionalString(enterprise?.id) || optionalString(team?.enterprise_id),
    kind: "block_suggestion",
    raw,
    retry,
    teamId: optionalString(team?.id),
    userId: stringValue(user?.id),
    value: stringValue(raw.value),
  };
}

function parseViewSubmission(
  raw: Record<string, unknown>,
  retry: SlackRetry | undefined
): SlackViewSubmissionPayload {
  const team = recordValue(raw.team);
  const enterprise = recordValue(raw.enterprise);
  const user = recordValue(raw.user);
  const view = recordValue(raw.view) ?? {};
  return {
    enterpriseId:
      optionalString(enterprise?.id) || optionalString(team?.enterprise_id),
    kind: "view_submission",
    raw,
    responseUrls: Array.isArray(view.response_urls)
      ? view.response_urls
      : undefined,
    retry,
    teamId: optionalString(team?.id),
    userId: stringValue(user?.id),
    view,
  };
}

function parseViewClosed(
  raw: Record<string, unknown>,
  retry: SlackRetry | undefined
): SlackViewClosedPayload {
  const team = recordValue(raw.team);
  const enterprise = recordValue(raw.enterprise);
  const user = recordValue(raw.user);
  return {
    enterpriseId:
      optionalString(enterprise?.id) || optionalString(team?.enterprise_id),
    kind: "view_closed",
    raw,
    retry,
    teamId: optionalString(team?.id),
    userId: stringValue(user?.id),
    view: recordValue(raw.view) ?? {},
  };
}
