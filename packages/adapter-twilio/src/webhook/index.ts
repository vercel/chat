export { parseTwilioWebhookBody } from "./parse";
export type * from "./types";
export {
  TwilioWebhookError,
  TwilioWebhookParseError,
  TwilioWebhookVerificationError,
} from "./types";
export {
  resolveTwilioWebhookUrl,
  signTwilioRequest,
  twilioSignatureBase,
  verifyTwilioRequest,
} from "./verify";

import { parseTwilioWebhookBody } from "./parse";
import type { TwilioReadOptions, TwilioWebhookPayload } from "./types";
import { verifyTwilioRequest } from "./verify";

export async function readTwilioWebhook(
  request: Request,
  options: TwilioReadOptions = {}
): Promise<TwilioWebhookPayload> {
  const verified = await verifyTwilioRequest(request, options);
  return parseTwilioWebhookBody(verified.params);
}
