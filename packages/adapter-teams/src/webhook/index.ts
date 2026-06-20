export {
  extractTeamsAttachments,
  extractTeamsContinuation,
  extractTeamsUser,
  isTeamsMention,
} from "./continuation";
export { parseTeamsWebhookBody, TeamsWebhookParseError } from "./parse";
export type * from "./types";

import { parseTeamsWebhookBody } from "./parse";
import type { TeamsParseOptions, TeamsWebhookPayload } from "./types";

export async function readTeamsWebhook(
  request: Request,
  options: TeamsParseOptions = {}
): Promise<TeamsWebhookPayload> {
  const body = await request.text();
  return parseTeamsWebhookBody(body, options);
}
