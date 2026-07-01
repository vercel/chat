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

  if (status && !body) {
    return {
      accountSid: value(params, "AccountSid"),
      from,
      kind: "status",
      messageSid,
      messageStatus: status,
      raw: params,
      to,
    };
  }

  if (
    from &&
    to &&
    (body !== undefined || Number(value(params, "NumMedia") ?? 0) > 0)
  ) {
    return {
      accountSid: value(params, "AccountSid"),
      body: body ?? "",
      from,
      kind: "text",
      media: mediaPayloads(params),
      messageSid,
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
