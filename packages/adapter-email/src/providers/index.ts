/**
 * Built-in providers for `@chat-adapter/email`.
 *
 * Import the providers you use here, then pass them to `createEmailAdapter`:
 *
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
 * To build a custom provider, see {@link defineEmailProvider} on the main
 * entry point and the {@link EmailProvider} contract in `types.ts`.
 */

export { type InboundProviderConfig, inbound } from "./inbound";
export { type ResendProviderConfig, resend } from "./resend";
