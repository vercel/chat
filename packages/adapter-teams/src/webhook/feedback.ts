/** Normalized reaction of a feedback click, the same values Slack's feedback buttons default to. */
export type TeamsFeedbackValue = "positive" | "negative";

/** Shape of a feedback comment that isn't in Teams' documented envelope. Never holds the text. */
export interface TeamsUnrecognizedFeedback {
  /** Set for strings only. */
  length?: number;
  type: string;
}

export interface TeamsFeedbackInvoke {
  /** The comment the user typed, when they left one. */
  comment?: string;
  /** Set when a comment value was sent but couldn't be read, so `comment` is unset. */
  unrecognizedFeedback?: TeamsUnrecognizedFeedback;
  value: TeamsFeedbackValue;
}

/**
 * Reads the `value` of a `message/submitAction` feedback invoke. Returns
 * `undefined` for a reaction Teams doesn't document. The caller checks
 * `actionName`.
 */
export function parseTeamsFeedbackInvoke(
  invokeValue: unknown
): TeamsFeedbackInvoke | undefined {
  const actionValue = readProperty(invokeValue, "actionValue");
  const reaction = readProperty(actionValue, "reaction");
  let value: TeamsFeedbackValue;
  if (reaction === "like") {
    value = "positive";
  } else if (reaction === "dislike") {
    value = "negative";
  } else {
    return undefined;
  }
  return {
    value,
    ...parseFeedbackComment(readProperty(actionValue, "feedback")),
  };
}

function readProperty(source: unknown, key: string): unknown {
  return typeof source === "object" && source !== null
    ? (source as Record<string, unknown>)[key]
    : undefined;
}

/** Teams sends the comment as a JSON string, `{"feedbackText":"..."}`. */
function parseFeedbackComment(
  feedback: unknown
): Pick<TeamsFeedbackInvoke, "comment" | "unrecognizedFeedback"> {
  if (feedback === undefined || feedback === null || feedback === "") {
    return {};
  }
  if (typeof feedback !== "string") {
    return { unrecognizedFeedback: { type: typeof feedback } };
  }
  try {
    const feedbackText = readProperty(JSON.parse(feedback), "feedbackText");
    if (typeof feedbackText === "string") {
      return feedbackText.trim() === "" ? {} : { comment: feedbackText };
    }
  } catch {
    // Not JSON, so not the documented envelope.
  }
  return { unrecognizedFeedback: { type: "string", length: feedback.length } };
}
