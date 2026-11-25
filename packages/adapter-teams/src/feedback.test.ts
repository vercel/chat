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
    ).toStrictEqual({ value: "positive" });
    expect(
      feedbackActionFromInvoke({ actionValue: { reaction: "dislike" } })
    ).toStrictEqual({ value: "negative" });
  });

  it("reads the comment from Teams' feedbackText envelope", () => {
    expect(
      feedbackActionFromInvoke({
        actionValue: {
          reaction: "dislike",
          feedback: '{"feedbackText":"Missing last week."}',
        },
      })
    ).toStrictEqual({
      value: "negative",
      values: { feedback: "Missing last week." },
    });
  });

  it.each([
    ["a missing feedback", undefined],
    ["a null feedback", null],
    ["an empty string", ""],
    ["an empty comment", '{"feedbackText":""}'],
    ["a blank comment", '{"feedbackText":"   "}'],
  ])("carries no comment and no signal for %s", (_kind, feedback) => {
    expect(
      feedbackActionFromInvoke({ actionValue: { reaction: "like", feedback } })
    ).toStrictEqual({ value: "positive" });
  });

  it.each([
    [
      "text that isn't JSON",
      "Missing last week.",
      { type: "string", length: 18 },
    ],
    [
      "JSON without feedbackText",
      '{"comment":"Missing last week."}',
      { type: "string", length: 32 },
    ],
    [
      "a non-string feedbackText",
      '{"feedbackText":42}',
      { type: "string", length: 19 },
    ],
    ["JSON that isn't an object", '"Missing"', { type: "string", length: 9 }],
    ["a number", 42, { type: "number" }],
    ["an object", { feedbackText: "Missing last week." }, { type: "object" }],
  ])("carries no comment but reports the shape of %s", (_kind, feedback, shape) => {
    expect(
      feedbackActionFromInvoke({ actionValue: { reaction: "like", feedback } })
    ).toStrictEqual({ value: "positive", unrecognizedFeedback: shape });
  });

  it.each([
    ["an unknown reaction", { actionValue: { reaction: "laugh" } }],
    ["a missing reaction", { actionValue: {} }],
    ["a missing actionValue", {}],
  ])("returns undefined for %s", (_kind, value) => {
    expect(feedbackActionFromInvoke(value)).toBeUndefined();
  });
});
