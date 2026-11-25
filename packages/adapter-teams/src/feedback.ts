import { MessageActivityInput } from "@microsoft/teams.api";
import type { AdapterPostableMessage } from "chat";
import {
  parseTeamsFeedbackInvoke,
  type TeamsUnrecognizedFeedback,
} from "./webhook/feedback";

/** Action ID dispatched to `bot.onAction` for feedback clicks, the same as Slack's default. */
export const FEEDBACK_ACTION_ID = "message_feedback";

/** Key in `ActionEvent.values` holding the comment a user typed with their feedback. */
const FEEDBACK_TEXT_KEY = "feedback";

/** The reaction on a feedback invoke is untrusted, so only this much of it is logged. */
const MAX_LOGGED_REACTION_LENGTH = 32;

/**
 * Adds Teams' native thumbs up/down buttons to an outbound activity when the
 * message opts in with `feedbackButtons: true`. Plain strings and bare card
 * elements can't carry the flag, so they never get the buttons.
 */
export function applyFeedbackButtons(
  activity: { addFeedback(): unknown },
  message: AdapterPostableMessage
): void {
  if (
    typeof message === "object" &&
    (message as { feedbackButtons?: unknown }).feedbackButtons === true
  ) {
    activity.addFeedback();
  }
}

/**
 * A chunk for the native streamer. The streamer builds the final message from
 * the last emitted chunk's entities and every chunk's `channelData`, so each
 * chunk carries the label and the feedback buttons.
 */
export function streamChunkActivity(
  text: string,
  aiGenerated: boolean | undefined,
  feedbackButtons: boolean | undefined
): string | MessageActivityInput {
  if (!(aiGenerated || feedbackButtons)) {
    return text;
  }
  const activity = new MessageActivityInput(text);
  if (aiGenerated) {
    activity.addAiGenerated();
  }
  if (feedbackButtons) {
    activity.addFeedback();
  }
  return activity;
}

/** The `onAction` fields for a `message/submitAction` feedback invoke. */
interface FeedbackAction {
  /** Shape of a comment value that was sent but couldn't be read. */
  unrecognizedFeedback?: TeamsUnrecognizedFeedback;
  value: string;
  values?: Record<string, string>;
}

/**
 * Converts the `value` of a `message/submitAction` feedback invoke into the
 * action value and the typed comment. Returns `undefined` for a reaction
 * Teams doesn't document.
 */
export function feedbackActionFromInvoke(
  value: unknown
): FeedbackAction | undefined {
  const feedback = parseTeamsFeedbackInvoke(value);
  if (!feedback) {
    return undefined;
  }
  return {
    value: feedback.value,
    ...(feedback.comment
      ? { values: { [FEEDBACK_TEXT_KEY]: feedback.comment } }
      : {}),
    ...(feedback.unrecognizedFeedback
      ? { unrecognizedFeedback: feedback.unrecognizedFeedback }
      : {}),
  };
}

/** A feedback reaction Teams doesn't document, cut down to what is safe to log. */
export function reactionForLog(reaction: unknown): string {
  return typeof reaction === "string"
    ? reaction.slice(0, MAX_LOGGED_REACTION_LENGTH)
    : typeof reaction;
}
