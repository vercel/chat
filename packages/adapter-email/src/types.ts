/**
 * Type definitions for the Email adapter.
 *
 * The adapter owns the email-shaped behavior (RFC-822 threading, MIME
 * composition, HTML/text rendering). Email Service Provider (ESP) specific
 * wire formats are delegated to pluggable providers conforming to the
 * {@link EmailProvider} contract.
 */

import type { Logger } from "chat";

// =============================================================================
// Outbound email composed by the adapter and handed to a transport
// =============================================================================

/**
 * An attachment to send with an outbound email.
 */
export interface OutboundEmailAttachment {
  /** Binary contents. */
  content: Buffer;
  /** MIME type (e.g. "application/pdf"). Optional; provider may infer. */
  contentType?: string;
  /** Filename shown to the recipient. */
  filename: string;
}

/**
 * Outbound email composed by {@link EmailAdapter} before handoff to a transport.
 *
 * The adapter sets `messageId`, `inReplyTo`, and `references` so providers
 * stay dumb — they just forward these as RFC-822 headers if their API
 * supports header passthrough.
 */
export interface OutboundEmail {
  /** Optional attachments. */
  attachments?: OutboundEmailAttachment[];
  /** Bcc recipients. */
  bcc?: string[];
  /** Cc recipients. */
  cc?: string[];
  /** From mailbox. */
  from: { address: string; name?: string };
  /** Pre-rendered HTML body. */
  html: string;
  /** RFC-822 In-Reply-To header (without angle brackets), if a reply. */
  inReplyTo?: string;
  /**
   * RFC-822 Message-ID for this outbound email, without angle brackets.
   * Adapters generate this so threading works even on providers that don't
   * return their own Message-ID.
   */
  messageId: string;
  /** RFC-822 References chain (without angle brackets), oldest-first. */
  references?: string[];
  /** Optional Reply-To override. */
  replyTo?: string;
  /** Subject line (already includes "Re: " prefix on replies). */
  subject: string;
  /** Plain-text fallback body. */
  text: string;
  /** Stable thread-root Message-ID. Equal to `messageId` for new threads. */
  threadRootMessageId: string;
  /** Primary recipients (typically a single address for 1:1 conversations). */
  to: string[];
}

/**
 * Result of {@link EmailTransport.send}.
 */
export interface EmailSendResult {
  /** Provider's own message identifier, if returned. */
  providerMessageId?: string;
  /** Provider-specific raw response. Surfaced via `message.raw` on the bot side. */
  raw: unknown;
}

// =============================================================================
// Inbound email parsed from a webhook
// =============================================================================

/**
 * A parsed inbound attachment.
 */
export interface ParsedInboundAttachment {
  /** MIME type, if known. */
  contentType?: string;
  /** Inline binary, if the webhook delivered it. */
  data?: Buffer;
  /** Optional async fetcher (e.g., authenticated download). */
  fetchData?: () => Promise<Buffer>;
  /** Original filename, if present. */
  filename?: string;
  /** Size in bytes, if known. */
  size?: number;
  /** Download URL, if the provider hosts the attachment. */
  url?: string;
}

/**
 * Normalized inbound email shape produced by {@link EmailInbound.parse}.
 */
export interface ParsedInboundEmail {
  /** Inbound attachments. */
  attachments?: ParsedInboundAttachment[];
  /** Cc addresses, if any. */
  cc?: string[];
  /** Sender mailbox. */
  from: { address: string; name?: string };
  /** HTML body. */
  html?: string;
  /** In-Reply-To header value (without angle brackets), if present. */
  inReplyTo?: string;
  /**
   * RFC-822 Message-ID of this inbound message, without angle brackets.
   * Required so the adapter can place the message in the correct thread.
   */
  messageId: string;
  /** Provider-specific raw payload, surfaced via `message.raw`. */
  raw: unknown;
  /** Receive timestamp. */
  receivedAt: Date;
  /** References chain (without angle brackets), oldest-first, if present. */
  references?: string[];
  /** Subject line as received. */
  subject: string;
  /** Plain-text body. */
  text?: string;
  /** Resolved To addresses. */
  to: string[];
}

// =============================================================================
// Provider contract
// =============================================================================

/**
 * Outbound side of an ESP integration.
 *
 * Implementations receive a fully composed {@link OutboundEmail} and forward
 * it through their HTTP API.
 */
export interface EmailTransport {
  /** Display name (e.g. "resend", "inbound"). Used for logs and errors. */
  readonly name: string;
  /** Send an outbound email. */
  send(email: OutboundEmail): Promise<EmailSendResult>;
}

/**
 * Inbound side of an ESP integration.
 *
 * Implementations verify the platform's webhook signature scheme and parse
 * the platform-specific payload into a {@link ParsedInboundEmail}.
 */
export interface EmailInbound {
  /** Display name (e.g. "resend"). Used for logs and errors. */
  readonly name: string;
  /**
   * Parse the verified webhook body into a normalized inbound email.
   *
   * Return `null` to skip processing without an error (e.g. for delivery
   * status events that aren't actually inbound messages).
   */
  parse(
    request: Request,
    body: string
  ): Promise<ParsedInboundEmail | null> | ParsedInboundEmail | null;
  /**
   * Verify the webhook signature against the raw request body.
   *
   * Return `false` to reject the request with a 401.
   */
  verifySignature(request: Request, body: string): boolean | Promise<boolean>;
}

/**
 * Bundle of optional transport and inbound implementations.
 *
 * Pass via `provider:` for the simple case where one ESP handles both
 * directions, or pass `transport:` and/or `inbound:` directly for
 * mix-and-match setups.
 */
export interface EmailProvider {
  inbound?: EmailInbound;
  transport?: EmailTransport;
}

// =============================================================================
// Adapter configuration
// =============================================================================

/**
 * Public configuration accepted by {@link createEmailAdapter}.
 */
export interface EmailAdapterConfig {
  /** Mailbox the bot sends from. Required. */
  fromAddress: string;
  /** Display name shown in the From header. */
  fromName?: string;
  /** Override or supply the inbound webhook parser directly. */
  inbound?: EmailInbound;
  /** Logger instance. Defaults to a `ConsoleLogger` namespaced "email". */
  logger?: Logger;
  /**
   * Domain used to generate `Message-ID` headers for outbound emails.
   * Defaults to the domain part of `fromAddress`.
   */
  messageIdDomain?: string;
  /**
   * Bundled transport + inbound. Equivalent to setting `transport` and/or
   * `inbound` to its respective fields, but easier when one ESP does both.
   */
  provider?: EmailProvider;
  /** Optional Reply-To override. Defaults to `fromAddress`. */
  replyToAddress?: string;
  /** Override or supply the outbound transport directly. */
  transport?: EmailTransport;
  /** Bot username (defaults to chat's global `userName`). */
  userName?: string;
}

// =============================================================================
// Thread ID
// =============================================================================

/**
 * Decoded email thread ID.
 *
 * Email threads are rooted on the first message's `Message-ID`. The thread
 * ID encodes that root so that even if the state adapter is reset, the
 * threading still works as long as the participant replies preserve the
 * `References` chain.
 */
export interface EmailThreadId {
  /**
   * Email address of the human participant. Optional; included so the
   * adapter can post replies to a thread it discovered during inbound
   * parsing without re-fetching state.
   */
  participantAddress?: string;
  /** RFC-822 Message-ID of the thread root, without angle brackets. */
  rootMessageId: string;
}

// =============================================================================
// Raw message type stored on Message.raw
// =============================================================================

/**
 * Raw message payload exposed to user handlers via `message.raw`.
 *
 * Direction is preserved so handlers can distinguish inbound replies from
 * outbound copies of their own posts.
 */
export type EmailRawMessage =
  | {
      direction: "inbound";
      email: ParsedInboundEmail;
    }
  | {
      direction: "outbound";
      email: OutboundEmail;
      result: EmailSendResult;
    };
