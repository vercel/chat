export type TwilioChannel = "rcs" | "sms" | "unknown" | "whatsapp";

export interface TwilioChannelMetadata {
  type?: string;
  [key: string]: unknown;
}

const RCS_PREFIX = "rcs:";
const WHATSAPP_PREFIX = "whatsapp:";
const PHONE_NUMBER_PATTERN = /^\+?\d/;

export function isRcsAddress(address: string): boolean {
  return address.startsWith(RCS_PREFIX);
}

export function parseChannelMetadata(
  raw: string | undefined
): TwilioChannelMetadata | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as TwilioChannelMetadata;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export function inferTwilioChannel(payload: {
  channelMetadata?: TwilioChannelMetadata;
  from?: string;
  to?: string;
}): TwilioChannel {
  const metaType = payload.channelMetadata?.type;
  if (typeof metaType === "string") {
    const lower = metaType.toLowerCase();
    if (lower === "rcs") {
      return "rcs";
    }
    if (lower === "sms" || lower === "mms") {
      return "sms";
    }
    if (lower === "whatsapp") {
      return "whatsapp";
    }
  }

  const addresses = [payload.from, payload.to].filter(Boolean) as string[];
  for (const addr of addresses) {
    if (addr.startsWith(RCS_PREFIX)) {
      return "rcs";
    }
    if (addr.startsWith(WHATSAPP_PREFIX)) {
      return "whatsapp";
    }
  }

  return addresses.some((a) => PHONE_NUMBER_PATTERN.test(a))
    ? "sms"
    : "unknown";
}

export function isRcsCapableSender(sender: string): boolean {
  return sender.startsWith("MG") || isRcsAddress(sender);
}

export function normalizeRcsSenderId(senderId: string): string {
  return senderId.startsWith(RCS_PREFIX)
    ? senderId
    : `${RCS_PREFIX}${senderId}`;
}

export function resolveInboundThreadSender(options: {
  channelMetadata?: TwilioChannelMetadata;
  messagingServiceSid?: string;
  messagingServiceSidConfig?: string;
  rcsSenderIdConfig?: string;
  to: string;
}): string {
  if (options.messagingServiceSid?.startsWith("MG")) {
    return options.messagingServiceSid;
  }
  if (isRcsCapableSender(options.to)) {
    return options.to;
  }
  if (
    inferTwilioChannel({
      channelMetadata: options.channelMetadata,
      to: options.to,
    }) === "rcs"
  ) {
    if (options.messagingServiceSidConfig) {
      return options.messagingServiceSidConfig;
    }
    if (options.rcsSenderIdConfig) {
      return normalizeRcsSenderId(options.rcsSenderIdConfig);
    }
  }
  return options.to;
}
