export const TEAMS_ADAPTIVE_CARD_CONTENT_TYPE =
  "application/vnd.microsoft.card.adaptive";

export interface TeamsAttachment {
  content?: unknown;
  contentType: string;
  contentUrl?: string;
  name?: string;
}

export interface TeamsActivity {
  attachments?: TeamsAttachment[];
  channelData?: unknown;
  text?: string;
  textFormat?: "markdown" | "plain" | "xml";
  type: "message" | "typing";
  [key: string]: unknown;
}

export interface BuildTeamsMessageActivityOptions {
  adaptiveCard?: unknown;
  attachments?: readonly TeamsAttachment[];
  channelData?: unknown;
  markdownText?: string;
  text?: string;
}

export function buildTeamsMessageActivity(
  options: BuildTeamsMessageActivityOptions
): TeamsActivity {
  if (options.markdownText && options.text) {
    throw new TypeError("markdownText cannot be combined with text");
  }

  const attachments = [...(options.attachments ?? [])];
  if (options.adaptiveCard) {
    attachments.unshift({
      content: options.adaptiveCard,
      contentType: TEAMS_ADAPTIVE_CARD_CONTENT_TYPE,
    });
  }

  return {
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(options.channelData === undefined
      ? {}
      : { channelData: options.channelData }),
    ...(options.markdownText ? { text: options.markdownText } : {}),
    ...(options.text ? { text: options.text } : {}),
    ...(options.markdownText ? { textFormat: "markdown" as const } : {}),
    type: "message",
  };
}

export function buildTeamsTypingActivity(): TeamsActivity {
  return { type: "typing" };
}
