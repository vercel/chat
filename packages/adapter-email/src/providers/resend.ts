/**
 * Resend provider for {@link createEmailAdapter}.
 *
 * Implements:
 * - {@link EmailTransport} via POST /emails on api.resend.com.
 * - {@link EmailInbound} verifying Svix-style HMAC-SHA256 signatures and
 *   parsing `email.received` events. Resend's webhook delivers metadata
 *   only, so we fetch the body and headers via the Retrieve Received Email
 *   API to populate text/html and `In-Reply-To` / `References`.
 *
 * @see https://resend.com/docs/api-reference/emails/send-email
 * @see https://resend.com/docs/api-reference/emails/retrieve-received-email
 * @see https://resend.com/docs/webhooks/verify-webhooks-requests
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
  parseAddress,
  throwForEspError,
  verifySvixRequest,
} from "./utils";

const RESEND_API_BASE_DEFAULT = "https://api.resend.com";

/**
 * Configuration for the {@link resend} provider.
 */
export interface ResendProviderConfig {
  /** API key used for outbound and Receiving API calls. Falls back to `RESEND_API_KEY`. */
  apiKey?: string;
  /** Override the API base URL (e.g. for staging). */
  apiUrl?: string;
  /** Custom fetch implementation (for testing). */
  fetch?: typeof globalThis.fetch;
  /** Webhook signing secret. Falls back to `RESEND_WEBHOOK_SECRET`. */
  webhookSecret?: string;
}

/**
 * Build a Resend provider bundle.
 *
 * @example
 * ```ts
 * import { createEmailAdapter } from "@chat-adapter/email";
 * import { resend } from "@chat-adapter/email/providers";
 *
 * createEmailAdapter({
 *   fromAddress: "support@yourdomain.com",
 *   provider: resend(),
 * });
 * ```
 */
export function resend(config: ResendProviderConfig = {}): EmailProvider {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const apiUrl = config.apiUrl ?? RESEND_API_BASE_DEFAULT;
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  const webhookSecret =
    config.webhookSecret ?? process.env.RESEND_WEBHOOK_SECRET;

  const transport: EmailTransport | undefined = apiKey
    ? createTransport({ apiKey, apiUrl, fetch: fetchImpl })
    : undefined;

  const inbound: EmailInbound | undefined =
    apiKey && webhookSecret
      ? createInbound({ apiKey, webhookSecret, apiUrl, fetch: fetchImpl })
      : undefined;

  return {
    transport,
    inbound,
  };
}

// =============================================================================
// Outbound transport
// =============================================================================

interface ResendSendResponse {
  id: string;
}

function createTransport(args: {
  apiKey: string;
  apiUrl: string;
  fetch: typeof globalThis.fetch;
}): EmailTransport {
  return {
    name: "resend",
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
          provider: "Resend",
          operation: "send email",
        });
      }

      const json = (await response.json()) as ResendSendResponse;
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

interface ResendWebhookEnvelope {
  created_at: string;
  data: ResendWebhookData;
  type: string;
}

interface ResendWebhookData {
  bcc?: string[];
  cc?: string[];
  created_at?: string;
  email_id: string;
  from: string;
  message_id: string;
  subject: string;
  to: string[];
}

interface ResendReceivingResponse {
  attachments: ResendReceivingAttachment[];
  bcc: string[];
  cc: string[];
  created_at: string;
  from: string;
  headers: Record<string, string>;
  html: string | null;
  id: string;
  message_id: string;
  reply_to: string[];
  subject: string;
  text: string | null;
  to: string[];
}

interface ResendReceivingAttachment {
  content_disposition: string | null;
  content_id: string | null;
  content_type: string;
  filename: string;
  id: string;
}

function createInbound(args: {
  apiKey: string;
  webhookSecret: string;
  apiUrl: string;
  fetch: typeof globalThis.fetch;
}): EmailInbound {
  return {
    name: "resend",
    verifySignature(request: Request, body: string): boolean {
      return verifySvixRequest({
        request,
        body,
        secret: args.webhookSecret,
      });
    },
    async parse(
      _request: Request,
      body: string
    ): Promise<ParsedInboundEmail | null> {
      let envelope: ResendWebhookEnvelope;
      try {
        envelope = JSON.parse(body) as ResendWebhookEnvelope;
      } catch (cause) {
        throw new ValidationError(
          "email",
          `Resend webhook body is not valid JSON: ${(cause as Error).message}`
        );
      }
      if (envelope.type !== "email.received") {
        return null;
      }

      const data = envelope.data;
      const detail = await fetchReceivedEmail({
        emailId: data.email_id,
        apiKey: args.apiKey,
        apiUrl: args.apiUrl,
        fetch: args.fetch,
      });

      return parseResendDetail(envelope, detail);
    },
  };
}

function parseResendDetail(
  envelope: ResendWebhookEnvelope,
  detail: ResendReceivingResponse
): ParsedInboundEmail {
  const messageId = stripAngleBrackets(
    detail.message_id || envelope.data.message_id
  );
  const headers = normalizeHeaderKeys(detail.headers);
  const inReplyTo = headers["in-reply-to"]
    ? stripAngleBrackets(headers["in-reply-to"])
    : undefined;
  const references = parseReferencesHeader(headers.references);
  const from = parseAddress(detail.from || envelope.data.from);
  const attachments: ParsedInboundAttachment[] = detail.attachments.map(
    (att) => ({
      filename: att.filename,
      contentType: att.content_type,
    })
  );

  return {
    messageId,
    inReplyTo,
    references,
    from,
    to: detail.to,
    cc: detail.cc,
    subject: detail.subject,
    text: detail.text ?? undefined,
    html: detail.html ?? undefined,
    attachments,
    receivedAt: new Date(detail.created_at ?? envelope.created_at),
    raw: { envelope, detail },
  };
}

async function fetchReceivedEmail(args: {
  emailId: string;
  apiKey: string;
  apiUrl: string;
  fetch: typeof globalThis.fetch;
}): Promise<ResendReceivingResponse> {
  const response = await args.fetch(
    `${args.apiUrl}/emails/receiving/${encodeURIComponent(args.emailId)}`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${args.apiKey}` },
    }
  );
  if (!response.ok) {
    await throwForEspError({
      response,
      provider: "Resend",
      operation: "retrieve received email",
    });
  }
  return (await response.json()) as ResendReceivingResponse;
}
