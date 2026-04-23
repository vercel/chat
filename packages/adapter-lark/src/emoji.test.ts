import { ValidationError } from "@chat-adapter/shared";
import { describe, expect, it } from "vitest";
import {
  fromLarkEmojiType,
  isValidLarkEmoji,
  toLarkEmojiType,
  VALID_LARK_EMOJI_TYPES,
} from "./emoji";

describe("toLarkEmojiType", () => {
  it("maps common chat-SDK names to Lark emoji_type", () => {
    expect(toLarkEmojiType("thumbs_up")).toBe("THUMBSUP");
    expect(toLarkEmojiType("heart")).toBe("HEART");
    expect(toLarkEmojiType("fire")).toBe("Fire");
    expect(toLarkEmojiType("clap")).toBe("CLAP");
  });

  it("passes through valid Lark emoji_type unchanged", () => {
    expect(toLarkEmojiType("THUMBSUP")).toBe("THUMBSUP");
    expect(toLarkEmojiType("CheckMark")).toBe("CheckMark");
  });

  it("throws ValidationError for unknown emoji names", () => {
    expect(() => toLarkEmojiType("totally_made_up_emoji")).toThrow(
      ValidationError
    );
  });
});

describe("fromLarkEmojiType", () => {
  it("maps Lark emoji_type to chat-SDK normalized EmojiValue", () => {
    expect(fromLarkEmojiType("THUMBSUP").name).toBe("thumbs_up");
    expect(fromLarkEmojiType("HEART").name).toBe("heart");
  });

  it("returns same object identity for same emoji (singleton)", () => {
    expect(fromLarkEmojiType("THUMBSUP")).toBe(fromLarkEmojiType("THUMBSUP"));
  });

  it("falls back to raw emoji_type as name when no mapping exists", () => {
    expect(fromLarkEmojiType("JubilantRabbit").name).toBe("JubilantRabbit");
  });
});

describe("isValidLarkEmoji", () => {
  it("returns true for documented Lark emoji_types", () => {
    expect(isValidLarkEmoji("THUMBSUP")).toBe(true);
    expect(isValidLarkEmoji("Fire")).toBe(true);
    expect(isValidLarkEmoji("CheckMark")).toBe(true);
  });

  it("returns false for unknown strings", () => {
    expect(isValidLarkEmoji("not_a_real_emoji")).toBe(false);
  });

  it("VALID_LARK_EMOJI_TYPES is non-empty", () => {
    expect(VALID_LARK_EMOJI_TYPES.size).toBeGreaterThan(50);
  });
});
