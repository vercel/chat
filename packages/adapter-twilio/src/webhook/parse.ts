import { parseChannelMetadata } from "../channel";
import type { TwilioMediaPayload, TwilioWebhookPayload } from "./types";

export function parseTwilioWebhookBody(
  params: URLSearchParams
): TwilioWebhookPayload {
  const status = value(params, "MessageStatus") ?? value(params, "SmsStatus");
  const body = value(params, "Body");
  const from = value(params, "From");
  const to = value(params, "To");
  const messageSid =
    value(params, "MessageSid") ?? value(params, "SmsMessageSid");
  const messagingServiceSid = value(params, "MessagingServiceSid");
  const channelMetadata = parseChannelMetadata(
    value(params, "ChannelMetadata")
  );

  if (status && !body) {
    return {
      accountSid: value(params, "AccountSid"),
      channelPrefix: value(params, "ChannelPrefix"),
      eventType: value(params, "EventType"),
      from,
      kind: "status",
      messageSid,
      messageStatus: status,
      raw: params,
      to,
    };
  }

  const buttonPayload = value(params, "ButtonPayload");
  if (from && to && buttonPayload) {
    return {
      accountSid: value(params, "AccountSid"),
      buttonPayload,
      buttonText: value(params, "ButtonText"),
      channelMetadata,
      from,
      kind: "action",
      messageSid,
      messagingServiceSid,
      raw: params,
      to,
    };
  }

  const hasLocation =
    value(params, "Latitude") !== undefined &&
    value(params, "Longitude") !== undefined;

  if (
    from &&
    to &&
    (body !== undefined ||
      Number(value(params, "NumMedia") ?? 0) > 0 ||
      hasLocation)
  ) {
    return {
      accountSid: value(params, "AccountSid"),
      address: value(params, "Address"),
      body: body ?? "",
      channelMetadata,
      from,
      kind: "text",
      label: value(params, "Label"),
      latitude: value(params, "Latitude"),
      longitude: value(params, "Longitude"),
      media: mediaPayloads(params),
      messageSid,
      messagingServiceSid,
      raw: params,
      to,
    };
  }

  return { kind: "unsupported", raw: params };
}

function mediaPayloads(params: URLSearchParams): TwilioMediaPayload[] {
  const count = Number(value(params, "NumMedia") ?? 0);
  const media: TwilioMediaPayload[] = [];
  for (let index = 0; index < count; index++) {
    const url = value(params, `MediaUrl${index}`);
    if (!url) {
      continue;
    }
    media.push({
      contentType: value(params, `MediaContentType${index}`),
      url,
    });
  }
  return media;
}

function value(params: URLSearchParams, name: string): string | undefined {
  const result = params.get(name);
  return result === null || result.length === 0 ? undefined : result;
}
