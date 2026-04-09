import { extractCard, ValidationError } from "@chat-adapter/shared";
import type { AdapterPostableMessage } from "chat";
import { convertEmojiPlaceholders } from "chat";
import { cardToLinearMarkdown } from "./cards";
import type { LinearFormatConverter } from "./markdown";
import type { LinearAgentSessionThreadId, LinearThreadId } from "./types";

export function renderMessageToLinearMarkdown(
  message: AdapterPostableMessage,
  formatConverter: LinearFormatConverter
): string {
  const card = extractCard(message);
  const rendered = card
    ? cardToLinearMarkdown(card)
    : formatConverter.renderPostable(message);

  return convertEmojiPlaceholders(rendered, "linear");
}

/**
 * Narrow a decoded thread to the agent-session case before session-only work.
 */
export function assertAgentSessionThread(
  thread: LinearThreadId
): asserts thread is LinearAgentSessionThreadId {
  if (!thread.agentSessionId) {
    throw new ValidationError(
      "linear",
      "Expected a Linear agent session thread"
    );
  }
}

const PROFILE_URL_REGEX = /^https:\/\/linear\.app\/\S+\/profiles\/([^/?#]+)/;

/**
 * Get a user display name from its profile URL.
 * Bit of a hack to avoid fetching the user just to get the display name.
 */
export function getUserNameFromProfileUrl(url: string): string {
  const match = url.match(PROFILE_URL_REGEX);
  if (!match) {
    return "";
  }

  return match[1];
}

/**
 * Calculate an expiry timestamp given an optional expiresIn duration in seconds.
 */
export function calculateExpiry(expiresIn?: number): number | null {
  return typeof expiresIn === "number" ? Date.now() + expiresIn * 1000 : null;
}
