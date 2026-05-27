export interface TwilioVoiceCallPayload {
  accountSid?: string;
  callSid?: string;
  from: string;
  raw: URLSearchParams;
  to?: string;
}

export interface TwilioVoiceTranscriptionPayload {
  accountSid?: string;
  callSid?: string;
  confidence?: number;
  final?: boolean;
  from?: string;
  raw: URLSearchParams;
  sequenceId?: string;
  text: string;
  timestamp?: string;
  to?: string;
  track?: string;
  transcriptionEvent?: string;
  transcriptionSid?: string;
}

export interface TwilioGatherSpeechResponseOptions {
  actionOnEmptyResult?: boolean;
  actionUrl: string;
  hints?: readonly string[] | string;
  language?: string;
  method?: "GET" | "POST";
  profanityFilter?: boolean;
  prompt: string;
  speechModel?: string;
  speechTimeout?: "auto" | string;
  timeoutSeconds?: number;
  voice?: string;
}

export function parseTwilioVoiceCall(
  params: URLSearchParams
): TwilioVoiceCallPayload | null {
  const from = value(params, "From") ?? value(params, "Caller");
  if (!from) {
    return null;
  }
  return {
    accountSid: value(params, "AccountSid"),
    callSid: value(params, "CallSid"),
    from,
    raw: params,
    to: value(params, "To") ?? value(params, "Called"),
  };
}

export function parseTwilioVoiceTranscription(
  params: URLSearchParams
): TwilioVoiceTranscriptionPayload | null {
  const data = parseTranscriptionData(value(params, "TranscriptionData"));
  const final = parseBoolean(value(params, "Final"));
  if (final === false) {
    return null;
  }
  const text =
    value(params, "SpeechResult") ??
    value(params, "TranscriptionText") ??
    data?.transcript ??
    "";
  if (text.trim().length === 0) {
    return null;
  }
  return {
    accountSid: value(params, "AccountSid"),
    callSid: value(params, "CallSid"),
    confidence: parseNumber(value(params, "Confidence") ?? data?.confidence),
    final,
    from: value(params, "From") ?? value(params, "Caller"),
    raw: params,
    sequenceId: value(params, "SequenceId"),
    text,
    timestamp: value(params, "Timestamp"),
    to: value(params, "To") ?? value(params, "Called"),
    track: value(params, "Track"),
    transcriptionEvent: value(params, "TranscriptionEvent"),
    transcriptionSid: value(params, "TranscriptionSid"),
  };
}

export function emptyTwilioResponse(): Response {
  return twilioResponse("<Response></Response>");
}

export function sayTwilioResponse(message: string): Response {
  return twilioResponse(
    `<Response><Say>${escapeXml(message)}</Say></Response>`
  );
}

export function gatherSpeechTwilioResponse(
  options: TwilioGatherSpeechResponseOptions
): Response {
  const hints =
    typeof options.hints === "string"
      ? options.hints
      : options.hints?.join(",");
  const attributes = [
    `input="speech"`,
    `action="${escapeXml(options.actionUrl)}"`,
    `method="${options.method ?? "POST"}"`,
    `actionOnEmptyResult="${options.actionOnEmptyResult === false ? "false" : "true"}"`,
    options.language ? `language="${escapeXml(options.language)}"` : undefined,
    options.speechModel
      ? `speechModel="${escapeXml(options.speechModel)}"`
      : undefined,
    options.timeoutSeconds === undefined
      ? undefined
      : `timeout="${options.timeoutSeconds}"`,
    options.speechTimeout
      ? `speechTimeout="${escapeXml(options.speechTimeout)}"`
      : undefined,
    hints ? `hints="${escapeXml(hints)}"` : undefined,
    options.profanityFilter === undefined
      ? undefined
      : `profanityFilter="${options.profanityFilter ? "true" : "false"}"`,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ");
  const sayAttributes = [
    options.voice ? `voice="${escapeXml(options.voice)}"` : undefined,
    options.language ? `language="${escapeXml(options.language)}"` : undefined,
  ]
    .filter((attribute): attribute is string => attribute !== undefined)
    .join(" ");
  const sayOpen = sayAttributes ? `<Say ${sayAttributes}>` : "<Say>";
  return twilioResponse(
    `<Response><Gather ${attributes}>${sayOpen}${escapeXml(
      options.prompt
    )}</Say></Gather></Response>`
  );
}

export function twilioResponse(twiml: string): Response {
  return new Response(twiml, {
    headers: { "content-type": "text/xml;charset=UTF-8" },
    status: 200,
  });
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseTranscriptionData(
  data: string | undefined
): { confidence?: string; transcript?: string } | null {
  if (!data) {
    return null;
  }
  try {
    const parsed = JSON.parse(data) as {
      confidence?: unknown;
      transcript?: unknown;
    };
    return {
      confidence:
        typeof parsed.confidence === "number" ||
        typeof parsed.confidence === "string"
          ? String(parsed.confidence)
          : undefined,
      transcript:
        typeof parsed.transcript === "string" ? parsed.transcript : undefined,
    };
  } catch {
    return null;
  }
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function value(params: URLSearchParams, name: string): string | undefined {
  const result = params.get(name);
  return result === null || result.length === 0 ? undefined : result;
}
