import type { AdapterPostableMessage } from "chat";

/** Action ID dispatched to `bot.onAction` for feedback clicks, the same as Slack's default. */
export const FEEDBACK_ACTION_ID = "message_feedback";

/** Action value for a thumbs-up click, the same as Slack's default. */
const FEEDBACK_POSITIVE_VALUE = "positive";

/** Action value for a thumbs-down click, the same as Slack's default. */
const FEEDBACK_NEGATIVE_VALUE = "negative";

/** Key in `ActionEvent.values` holding the comment a user typed with their feedback. */
const FEEDBACK_TEXT_KEY = "feedback";

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

/** The `onAction` fields for a `message/submitAction` feedback invoke. */
interface FeedbackAction {
  value: string;
  values?: Record<string, string>;
}

/**
 * Converts the `value` of a `message/submitAction` feedback invoke into the
 * action value and the typed comment. Returns `undefined` for a reaction
 * Teams doesn't document.
 */
export function feedbackActionFromInvoke(value: {
  actionValue?: { feedback?: unknown; reaction?: unknown };
}): FeedbackAction | undefined {
  const reaction = value.actionValue?.reaction;
  let actionValue: string;
  if (reaction === "like") {
    actionValue = FEEDBACK_POSITIVE_VALUE;
  } else if (reaction === "dislike") {
    actionValue = FEEDBACK_NEGATIVE_VALUE;
  } else {
    return undefined;
  }

  const text = feedbackText(value.actionValue?.feedback);
  return text
    ? { value: actionValue, values: { [FEEDBACK_TEXT_KEY]: text } }
    : { value: actionValue };
}

/**
 * Teams sends the comment as a JSON string, `{"feedbackText":"..."}`. Anything
 * else carries no comment.
 */
function feedbackText(feedback: unknown): string | undefined {
  if (typeof feedback !== "string" || feedback === "") {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(feedback);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "feedbackText" in parsed &&
      typeof parsed.feedbackText === "string" &&
      parsed.feedbackText.trim() !== ""
    ) {
      return parsed.feedbackText;
    }
  } catch {
    // Not the documented envelope; treated as no comment.
  }
  return undefined;
}
