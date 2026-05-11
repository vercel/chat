/**
 * @chat-adapter/email
 *
 * Email adapter for Chat SDK with pluggable Email Service Provider (ESP)
 * implementations.
 */

import { ValidationError } from "@chat-adapter/shared";
import { ConsoleLogger, type Logger } from "chat";
import { EmailAdapter } from "./adapter";
import { emailDomainOf } from "./threading";
import type {
  EmailAdapterConfig,
  EmailInbound,
  EmailProvider,
  EmailTransport,
} from "./types";

export { EmailAdapter } from "./adapter";
export { EmailFormatConverter } from "./markdown";
export {
  normalizeHeaderKeys,
  parseAddress,
  throwForEspError,
  verifySvixRequest,
  verifySvixSignature,
} from "./providers/utils";
export {
  astToHtml,
  cardToHtml,
  cardToPlainText,
  markdownToHtml,
} from "./render";
export {
  buildReferencesChain,
  decodeEmailThreadId,
  encodeEmailThreadId,
  findThreadRoot,
  generateMessageId,
  MAX_REFERENCES_CHAIN,
  parseReferencesHeader,
  replySubject,
  stripAngleBrackets,
  wrapAngleBrackets,
} from "./threading";
export type {
  EmailAdapterConfig,
  EmailInbound,
  EmailProvider,
  EmailRawMessage,
  EmailSendResult,
  EmailThreadId,
  EmailTransport,
  OutboundEmail,
  OutboundEmailAttachment,
  ParsedInboundAttachment,
  ParsedInboundEmail,
} from "./types";

/**
 * Identity helper for authoring custom providers with full TypeScript
 * inference. Equivalent to constructing the object literal directly, but
 * future-proofs against any additional optional fields the contract may
 * grow.
 *
 * @example
 * ```ts
 * const myProvider = defineEmailProvider({
 *   transport: {
 *     name: "my-esp",
 *     async send(email) { ... },
 *   },
 * });
 * ```
 */
export function defineEmailProvider(provider: EmailProvider): EmailProvider {
  return provider;
}

/**
 * Create an Email adapter.
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
 *
 * @example Mix-and-match transports and inbound parsers
 * ```ts
 * import { createEmailAdapter } from "@chat-adapter/email";
 * import { inbound, resend } from "@chat-adapter/email/providers";
 *
 * createEmailAdapter({
 *   fromAddress: "support@yourdomain.com",
 *   transport: resend().transport,
 *   inbound: inbound().inbound,
 * });
 * ```
 *
 * @throws {ValidationError} when no transport is configured (proactive
 *   `openDM()` and `thread.post()` both require send capability).
 */
export function createEmailAdapter(config: EmailAdapterConfig): EmailAdapter {
  if (!config.fromAddress) {
    throw new ValidationError("email", "`fromAddress` is required.");
  }

  const transport: EmailTransport | undefined =
    config.transport ?? config.provider?.transport;
  const inbound: EmailInbound | undefined =
    config.inbound ?? config.provider?.inbound;

  if (!transport) {
    throw new ValidationError(
      "email",
      "No transport configured. Pass `provider:` or `transport:` to createEmailAdapter() — every email adapter must be able to send (proactive openDM() and thread.post() both require it)."
    );
  }

  const messageIdDomain =
    config.messageIdDomain ?? emailDomainOf(config.fromAddress);
  if (!messageIdDomain) {
    throw new ValidationError(
      "email",
      `Cannot derive Message-ID domain from fromAddress "${config.fromAddress}". Pass an explicit \`messageIdDomain\`.`
    );
  }

  const logger: Logger =
    config.logger ?? new ConsoleLogger("info").child("email");
  const userName = config.userName ?? process.env.BOT_USERNAME ?? "email-bot";

  return new EmailAdapter({
    fromAddress: config.fromAddress,
    fromName: config.fromName,
    replyToAddress: config.replyToAddress,
    messageIdDomain,
    transport,
    inbound,
    userName,
    logger,
  });
}
