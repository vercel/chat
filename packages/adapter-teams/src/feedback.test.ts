import { describe, expect, it, vi } from "vitest";
import { applyFeedbackButtons, feedbackActionFromInvoke } from "./feedback";

describe("applyFeedbackButtons", () => {
  it("adds the buttons only when feedbackButtons is true", () => {
    const withFlag = { addFeedback: vi.fn() };
    applyFeedbackButtons(withFlag, {
      markdown: "Answer",
      feedbackButtons: true,
    });
    expect(withFlag.addFeedback).toHaveBeenCalledOnce();

    for (const message of [
      "Answer",
      { markdown: "Answer" },
      { markdown: "Answer", feedbackButtons: false },
    ]) {
      const activity = { addFeedback: vi.fn() };
      applyFeedbackButtons(activity, message);
      expect(activity.addFeedback).not.toHaveBeenCalled();
    }
  });
});

describe("feedbackActionFromInvoke", () => {
  it("maps like and dislike to Slack's default values", () => {
    expect(
      feedbackActionFromInvoke({ actionValue: { reaction: "like" } })
    ).toEqual({ value: "positive" });
    expect(
      feedbackActionFromInvoke({ actionValue: { reaction: "dislike" } })
    ).toEqual({ value: "negative" });
  });

  it("reads the comment from Teams' feedbackText envelope", () => {
    expect(
      feedbackActionFromInvoke({
        actionValue: {
          reaction: "dislike",
          feedback: '{"feedbackText":"Missing last week."}',
        },
      })
    ).toEqual({
      value: "negative",
      values: { feedback: "Missing last week." },
    });
  });

  it.each([
    ["an empty string", ""],
    ["a blank comment", '{"feedbackText":"   "}'],
    ["text that isn't JSON", "Missing last week."],
    ["JSON without feedbackText", '{"comment":"Missing last week."}'],
    ["a non-string feedbackText", '{"feedbackText":42}'],
    ["a non-string feedback", 42],
  ])("carries no comment for %s", (_kind, feedback) => {
    expect(
      feedbackActionFromInvoke({ actionValue: { reaction: "like", feedback } })
    ).toEqual({ value: "positive" });
  });

  it.each([
    ["an unknown reaction", { actionValue: { reaction: "laugh" } }],
    ["a missing reaction", { actionValue: {} }],
    ["a missing actionValue", {}],
  ])("returns undefined for %s", (_kind, value) => {
    expect(feedbackActionFromInvoke(value)).toBeUndefined();
  });
});
