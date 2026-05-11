/**
 * Email threading helpers.
 *
 * Email threading is governed by RFC-2822 / RFC-5322:
 * - Each message has a `Message-ID` header (a globally unique opaque token).
 * - Replies set `In-Reply-To` to the parent's Message-ID.
 * - Replies set `References` to the parent's References chain plus its
 *   Message-ID, so mail clients can reconstruct the thread.
 *
 * This module implements:
 * - {@link generateMessageId}: a fresh Message-ID for outbound emails.
 * - {@link stripAngleBrackets}: header value normalization.
 * - {@link findThreadRoot}: resolve a thread root from References /
 *   In-Reply-To headers.
 * - {@link buildReferencesChain}: produce the References list for a reply,
 *   capped at {@link MAX_REFERENCES_CHAIN} entries.
 * - {@link encodeEmailThreadId} / {@link decodeEmailThreadId}: thread ID
 *   marshalling that survives addresses with `:` characters.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc5322#section-3.6.4
 */

import { randomUUID } from "node:crypto";
import { ValidationError } from "@chat-adapter/shared";
import type { EmailThreadId } from "./types";

/**
 * Maximum number of entries kept in the `References` header chain.
 *
 * Long chains can exceed the 998-character RFC-5322 line limit and are
 * routinely truncated by mail relays, so we cap at a conservative number
 * that comfortably fits in a single header line for typical Message-IDs.
 */
export const MAX_REFERENCES_CHAIN = 10;

// Forbid `<` and whitespace inside the token so the regex fails fast on
// adversarial inputs like `<<<<<<...` (avoids polynomial-time backtracking
// across global match attempts). Real RFC-5322 Message-IDs are dot-atom
// strings and never contain either character.
const ANGLE_TOKEN_PATTERN = /<[^<>\s]+>/g;
const REFERENCES_FALLBACK_SPLIT = /[\s,]+/;
const RE_PREFIX_PATTERN = /^re:/i;

/**
 * Generate a fresh RFC-822 Message-ID without angle brackets.
 *
 * Format: `<random-uuid>@<domain>`. The `@<domain>` part is required by
 * RFC-5322; the random UUID guarantees uniqueness without coordinating
 * across processes or hosts.
 *
 * @example
 * generateMessageId("yourdomain.com")
 * // "550e8400-e29b-41d4-a716-446655440000@yourdomain.com"
 */
export function generateMessageId(domain: string): string {
  if (!domain) {
    throw new ValidationError(
      "email",
      "messageIdDomain is required to generate a Message-ID"
    );
  }
  return `${randomUUID()}@${domain}`;
}

/**
 * Remove angle brackets from a header value if present.
 *
 * RFC-5322 header values are wrapped in `<...>`, but providers handle this
 * inconsistently. We always store and pass Message-IDs without brackets
 * internally so comparisons are consistent.
 */
export function stripAngleBrackets(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Wrap a Message-ID in angle brackets for use as an outbound header value.
 */
export function wrapAngleBrackets(messageId: string): string {
  return `<${stripAngleBrackets(messageId)}>`;
}

/**
 * Parse a `References` header into an oldest-first array of Message-IDs
 * without angle brackets.
 *
 * Tolerates both whitespace-separated and comma-separated input, since
 * different ESPs/parsers normalize differently.
 */
export function parseReferencesHeader(header: string | undefined): string[] {
  if (!header) {
    return [];
  }
  // Match each <id> token. Fall back to whitespace split if no brackets.
  const matches = header.match(ANGLE_TOKEN_PATTERN);
  if (matches && matches.length > 0) {
    return matches.map(stripAngleBrackets).filter(Boolean);
  }
  return header
    .split(REFERENCES_FALLBACK_SPLIT)
    .map(stripAngleBrackets)
    .filter(Boolean);
}

/**
 * Resolve the thread-root Message-ID from header values.
 *
 * Resolution order:
 * 1. The first (oldest) entry in `References`, when present.
 * 2. The `In-Reply-To` value, when present.
 * 3. `null` — caller should treat the current message as a new root.
 */
export function findThreadRoot(args: {
  references?: string[];
  inReplyTo?: string;
}): string | null {
  if (args.references && args.references.length > 0) {
    const first = args.references[0];
    if (first) {
      return first;
    }
  }
  if (args.inReplyTo) {
    return args.inReplyTo;
  }
  return null;
}

/**
 * Build the outbound `References` chain for a reply.
 *
 * @param previousReferences - References chain on the message being replied
 *   to (oldest-first). May be empty when replying to a thread root.
 * @param parentMessageId - Message-ID of the message being replied to.
 * @returns oldest-first chain capped at {@link MAX_REFERENCES_CHAIN}. When
 *   trimming is required, the oldest entry (the thread root) is preserved
 *   per the recommendation in RFC-5322 §3.6.4.
 */
export function buildReferencesChain(
  previousReferences: string[],
  parentMessageId: string
): string[] {
  const combined = [...previousReferences, parentMessageId]
    .map(stripAngleBrackets)
    .filter(Boolean);

  if (combined.length <= MAX_REFERENCES_CHAIN) {
    return combined;
  }

  // Preserve the thread root (first entry) and the most recent N-1 entries.
  const root = combined[0] as string;
  const tail = combined.slice(combined.length - (MAX_REFERENCES_CHAIN - 1));
  return [root, ...tail];
}

/**
 * Encode an email thread ID.
 *
 * Format: `email:<base64url(rootMessageId)>[:<base64url(participantAddress)>]`.
 *
 * Both segments are base64url-encoded because Message-IDs and email
 * addresses can contain `:`, `@`, `+`, `=`, and other characters that
 * conflict with the colon-delimited thread ID convention.
 */
export function encodeEmailThreadId(data: EmailThreadId): string {
  const root = base64urlEncode(data.rootMessageId);
  if (data.participantAddress) {
    const addr = base64urlEncode(data.participantAddress);
    return `email:${root}:${addr}`;
  }
  return `email:${root}`;
}

/**
 * Decode an email thread ID produced by {@link encodeEmailThreadId}.
 */
export function decodeEmailThreadId(threadId: string): EmailThreadId {
  if (!threadId.startsWith("email:")) {
    throw new ValidationError("email", `Invalid email thread ID: ${threadId}`);
  }
  const remainder = threadId.slice("email:".length);
  if (!remainder) {
    throw new ValidationError(
      "email",
      `Invalid email thread ID format: ${threadId}`
    );
  }
  const parts = remainder.split(":");
  const rootSegment = parts[0];
  if (!rootSegment) {
    throw new ValidationError(
      "email",
      `Invalid email thread ID format: ${threadId}`
    );
  }
  const rootMessageId = base64urlDecode(rootSegment);
  if (!rootMessageId) {
    throw new ValidationError(
      "email",
      `Invalid email thread ID encoding: ${threadId}`
    );
  }
  if (parts.length === 1) {
    return { rootMessageId };
  }
  if (parts.length !== 2 || !parts[1]) {
    throw new ValidationError(
      "email",
      `Invalid email thread ID format: ${threadId}`
    );
  }
  const participantAddress = base64urlDecode(parts[1]);
  return { rootMessageId, participantAddress };
}

/**
 * Extract the host portion of an email address (the part after the `@`).
 *
 * Returns `null` for malformed input rather than throwing so callers can
 * decide whether to fall back or surface a validation error.
 */
export function emailDomainOf(address: string): string | null {
  const idx = address.lastIndexOf("@");
  if (idx === -1 || idx === address.length - 1) {
    return null;
  }
  return address.slice(idx + 1);
}

/**
 * Generate a default reply Subject by adding `Re: ` if not already present.
 */
export function replySubject(originalSubject: string | undefined): string {
  const trimmed = (originalSubject ?? "").trim();
  if (!trimmed) {
    return "Re:";
  }
  if (RE_PREFIX_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

function base64urlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}
