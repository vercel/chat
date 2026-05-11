/**
 * Inbound (inbound.new) provider for {@link createEmailAdapter}.
 *
 * Implements:
 * - {@link EmailTransport} via `POST /api/e2/emails`. The adapter's
 *   composed `Message-ID`, `In-Reply-To`, and `References` are forwarded
 *   through Inbound's `headers` passthrough so threading works the same
 *   as Resend.
 * - {@link EmailInbound} verifying the `X-Webhook-Verification-Token`
 *   header (constant-time compare against the configured token) and
 *   parsing `email.received` events. Inbound's payload is self-contained
 *   — body text/HTML and attachment metadata arrive inline so the
 *   provider does not need a follow-up API call.
 *
 * @see https://inbound.new/docs/api-reference/emails/send-an-email
 * @see https://inbound.new/docs/api-reference/webhooks/email-received
 */

import { ValidationError } from "@chat-adapter/shared";
import {
  parseReferencesHeader,
  stripAngleBrackets,
  wrapAngleBrackets,
} from "../threading";
import type {
  EmailInbound,
  EmailProvider,
  EmailSendResult,
  EmailTransport,
  OutboundEmail,
  ParsedInboundAttachment,
  ParsedInboundEmail,
} from "../types";
import {
  normalizeHeaderKeys,
  throwForEspError,
  verifyConstantTimeToken,
} from "./utils";

const INBOUND_API_BASE_DEFAULT = "https://inbound.new/api/e2";

/**
 * Configuration for the {@link inbound} provider.
 */
export interface InboundProviderConfig {
  /** API key for outbound and attachment download calls. Falls back to `INBOUND_API_KEY`. */
  apiKey?: string;
  /** Override the API base URL (defaults to `https://inbound.new/api/e2`). */
  apiUrl?: string;
  /** Custom fetch implementation (for testing). */
  fetch?: typeof globalThis.fetch;
  /**
   * Verification token configured on the Inbound endpoint. Falls back to
   * `INBOUND_VERIFICATION_TOKEN`. When omitted, no inbound handler is
   * exported (the provider becomes send-only).
   */
  verificationToken?: string;
}

/**
 * Build an Inbound provider bundle.
 *
 * Naming note: the function is named after the brand (`inbound`), not the
 * direction. To avoid confusion in mix-and-match setups, use it as
 * `provider: inbound()` rather than reaching into its fields.
 *
 * @example
 * ```ts
 * import { createEmailAdapter } from "@chat-adapter/email";
 * import { inbound } from "@chat-adapter/email/providers";
 *
 * createEmailAdapter({
 *   fromAddress: "support@yourdomain.com",
 *   provider: inbound(),
 * });
 * ```
 */
export function inbound(config: InboundProviderConfig = {}): EmailProvider {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const apiUrl = config.apiUrl ?? INBOUND_API_BASE_DEFAULT;
  const apiKey = config.apiKey ?? process.env.INBOUND_API_KEY;
  const verificationToken =
    config.verificationToken ?? process.env.INBOUND_VERIFICATION_TOKEN;

  const transport: EmailTransport | undefined = apiKey
    ? createTransport({ apiKey, apiUrl, fetch: fetchImpl })
    : undefined;

  const inboundHandler: EmailInbound | undefined = verificationToken
    ? createInbound({ apiKey, verificationToken, fetch: fetchImpl })
    : undefined;

  return {
    transport,
    inbound: inboundHandler,
  };
}

// =============================================================================
// Outbound transport
// =============================================================================

interface InboundSendResponse {
  id: string;
  message_id?: string;
  scheduled_at?: string;
  status?: "sent" | "scheduled";
}

function createTransport(args: {
  apiKey: string;
  apiUrl: string;
  fetch: typeof globalThis.fetch;
}): EmailTransport {
  return {
    name: "inbound",
    async send(email: OutboundEmail): Promise<EmailSendResult> {
      const headers: Record<string, string> = {
        "Message-ID": wrapAngleBrackets(email.messageId),
      };
      if (email.inReplyTo) {
        headers["In-Reply-To"] = wrapAngleBrackets(email.inReplyTo);
      }
      if (email.references && email.references.length > 0) {
        headers.References = email.references.map(wrapAngleBrackets).join(" ");
      }

      const body = {
        from: email.from.name
          ? `${email.from.name} <${email.from.address}>`
          : email.from.address,
        to: email.to,
        cc: email.cc,
        bcc: email.bcc,
        reply_to: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers,
        attachments: email.attachments?.map((att) => ({
          filename: att.filename,
          content: att.content.toString("base64"),
          content_type: att.contentType,
        })),
      };

      const response = await args.fetch(`${args.apiUrl}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        await throwForEspError({
          response,
          provider: "Inbound",
          operation: "send email",
        });
      }

      const json = (await response.json()) as InboundSendResponse;
      return {
        providerMessageId: json.id,
        raw: json,
      };
    },
  };
}

// =============================================================================
// Inbound webhook
// =============================================================================

interface InboundAddress {
  address: string;
  name: string | null;
}

interface InboundAddressGroup {
  addresses?: InboundAddress[];
  text?: string;
}

interface InboundAttachmentPayload {
  contentDisposition?: string;
  contentId?: string;
  contentType?: string;
  downloadUrl?: string;
  filename?: string;
  size?: number;
}

interface InboundParsedData {
  attachments?: InboundAttachmentPayload[];
  bcc?: InboundAddressGroup | null;
  cc?: InboundAddressGroup | null;
  date?: string;
  from?: InboundAddressGroup;
  headers?: Record<string, string>;
  htmlBody?: string | null;
  inReplyTo?: string;
  messageId?: string;
  references?: string | string[];
  replyTo?: InboundAddressGroup | null;
  subject?: string;
  textBody?: string | null;
  to?: InboundAddressGroup;
}

interface InboundWebhookEmail {
  from?: InboundAddressGroup;
  id: string;
  messageId: string;
  parsedData?: InboundParsedData;
  receivedAt?: string;
  recipient?: string;
  subject?: string;
  to?: InboundAddressGroup;
}

interface InboundWebhookEnvelope {
  email: InboundWebhookEmail;
  event: string;
  timestamp: string;
}

function createInbound(args: {
  apiKey: string | undefined;
  verificationToken: string;
  fetch: typeof globalThis.fetch;
}): EmailInbound {
  return {
    name: "inbound",
    verifySignature(request: Request, _body: string): boolean {
      return verifyConstantTimeToken(
        request.headers.get("x-webhook-verification-token"),
        args.verificationToken
      );
    },
    parse(_request: Request, body: string): ParsedInboundEmail | null {
      let envelope: InboundWebhookEnvelope;
      try {
        envelope = JSON.parse(body) as InboundWebhookEnvelope;
      } catch (cause) {
        throw new ValidationError(
          "email",
          `Inbound webhook body is not valid JSON: ${(cause as Error).message}`
        );
      }
      if (envelope.event !== "email.received") {
        return null;
      }
      return parseInboundEnvelope(envelope, {
        apiKey: args.apiKey,
        fetch: args.fetch,
      });
    },
  };
}

function parseInboundEnvelope(
  envelope: InboundWebhookEnvelope,
  ctx: { apiKey: string | undefined; fetch: typeof globalThis.fetch }
): ParsedInboundEmail {
  const email = envelope.email;
  const parsed = email.parsedData ?? {};

  const messageId = stripAngleBrackets(
    parsed.messageId ?? email.messageId ?? ""
  );

  // Inbound exposes `parsedData.inReplyTo` and `parsedData.references`
  // when the parser surfaces them, plus a raw headers map. Try the
  // structured fields first, then fall back to the headers map so we
  // tolerate future schema changes.
  const headers = normalizeHeaderKeys(parsed.headers);
  const inReplyToRaw = parsed.inReplyTo ?? headers["in-reply-to"] ?? undefined;
  const inReplyTo = inReplyToRaw ? stripAngleBrackets(inReplyToRaw) : undefined;

  let references: string[] = [];
  if (Array.isArray(parsed.references)) {
    references = parsed.references.map(stripAngleBrackets).filter(Boolean);
  } else if (typeof parsed.references === "string") {
    references = parseReferencesHeader(parsed.references);
  } else if (headers.references) {
    references = parseReferencesHeader(headers.references);
  }

  const from = extractFirstAddress(parsed.from ?? email.from) ?? {
    address: "unknown@unknown",
  };
  const to = (parsed.to?.addresses ?? email.to?.addresses ?? [])
    .map((a) => a.address)
    .filter(Boolean);
  const cc = parsed.cc?.addresses?.map((a) => a.address).filter(Boolean);

  const receivedAt = new Date(
    parsed.date ?? email.receivedAt ?? envelope.timestamp
  );

  const attachments: ParsedInboundAttachment[] = (parsed.attachments ?? []).map(
    (att) => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      url: att.downloadUrl,
      fetchData: att.downloadUrl
        ? () => fetchAttachment(att.downloadUrl as string, ctx)
        : undefined,
    })
  );

  return {
    messageId,
    inReplyTo,
    references,
    from,
    to: to.length > 0 ? to : [email.recipient ?? ""].filter(Boolean),
    cc,
    subject: parsed.subject ?? email.subject ?? "",
    text: parsed.textBody ?? undefined,
    html: parsed.htmlBody ?? undefined,
    attachments,
    receivedAt,
    raw: envelope,
  };
}

function extractFirstAddress(
  group: InboundAddressGroup | undefined | null
): { address: string; name?: string } | null {
  if (!group) {
    return null;
  }
  const first = group.addresses?.[0];
  if (!first?.address) {
    return null;
  }
  return first.name
    ? { address: first.address, name: first.name }
    : {
        address: first.address,
      };
}

async function fetchAttachment(
  downloadUrl: string,
  ctx: { apiKey: string | undefined; fetch: typeof globalThis.fetch }
): Promise<Buffer> {
  const response = await ctx.fetch(downloadUrl, {
    method: "GET",
    headers: ctx.apiKey ? { Authorization: `Bearer ${ctx.apiKey}` } : {},
  });
  if (!response.ok) {
    await throwForEspError({
      response,
      provider: "Inbound",
      operation: "download attachment",
    });
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
