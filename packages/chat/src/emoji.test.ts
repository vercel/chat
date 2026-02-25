import { describe, expect, it } from "vitest";
import {
  convertEmojiPlaceholders,
  createEmoji,
  DEFAULT_EMOJI_MAP,
  defaultEmojiResolver,
  EmojiResolver,
  emoji,
  getEmoji,
} from "./emoji";

describe("EmojiResolver", () => {
  describe("fromSlack", () => {
    it("should convert Slack emoji to normalized EmojiValue", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("+1").name).toBe("thumbs_up");
      expect(resolver.fromSlack("thumbsup").name).toBe("thumbs_up");
      expect(resolver.fromSlack("-1").name).toBe("thumbs_down");
      expect(resolver.fromSlack("heart").name).toBe("heart");
      expect(resolver.fromSlack("fire").name).toBe("fire");
    });

    it("should handle colons around emoji names", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack(":+1:").name).toBe("thumbs_up");
      expect(resolver.fromSlack(":fire:").name).toBe("fire");
    });

    it("should be case-insensitive", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromSlack("FIRE").name).toBe("fire");
      expect(resolver.fromSlack("Heart").name).toBe("heart");
    });

    it("should return EmojiValue with raw name if no mapping exists", () => {
      const resolver = new EmojiResolver();
      const result = resolver.fromSlack("custom_emoji");
      expect(result.name).toBe("custom_emoji");
      expect(result.toString()).toBe("{{emoji:custom_emoji}}");
    });
  });

  describe("fromGChat", () => {
    it("should convert GChat unicode emoji to normalized EmojiValue", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("👍").name).toBe("thumbs_up");
      expect(resolver.fromGChat("👎").name).toBe("thumbs_down");
      expect(resolver.fromGChat("❤️").name).toBe("heart");
      expect(resolver.fromGChat("🔥").name).toBe("fire");
      expect(resolver.fromGChat("🚀").name).toBe("rocket");
    });

    it("should handle multiple unicode variants", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromGChat("❤").name).toBe("heart");
      expect(resolver.fromGChat("❤️").name).toBe("heart");
      expect(resolver.fromGChat("✅").name).toBe("check");
      expect(resolver.fromGChat("✔️").name).toBe("check");
    });

    it("should return EmojiValue with raw emoji as name if no mapping exists", () => {
      const resolver = new EmojiResolver();
      const result = resolver.fromGChat("🦄");
      expect(result.name).toBe("🦄");
      expect(result.toString()).toBe("{{emoji:🦄}}");
    });
  });

  describe("fromTeams", () => {
    it("should convert Teams reaction types to normalized EmojiValue", () => {
      const resolver = new EmojiResolver();
      expect(resolver.fromTeams("like").name).toBe("thumbs_up");
      expect(resolver.fromTeams("heart").name).toBe("heart");
      expect(resolver.fromTeams("laugh").name).toBe("laugh");
      expect(resolver.fromTeams("surprised").name).toBe("surprised");
      expect(resolver.fromTeams("sad").name).toBe("sad");
      expect(resolver.fromTeams("angry").name).toBe("angry");
    });

    it("should return EmojiValue with raw name if no mapping exists", () => {
      const resolver = new EmojiResolver();
      const result = resolver.fromTeams("custom_reaction");
      expect(result.name).toBe("custom_reaction");
    });
  });

  describe("toSlack", () => {
    it("should convert normalized emoji to Slack format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toSlack("thumbs_up")).toBe("+1");
      expect(resolver.toSlack("fire")).toBe("fire");
      expect(resolver.toSlack("heart")).toBe("heart");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toSlack("custom")).toBe("custom");
    });
  });

  describe("toGChat", () => {
    it("should convert normalized emoji to GChat format", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toGChat("thumbs_up")).toBe("👍");
      expect(resolver.toGChat("fire")).toBe("🔥");
      expect(resolver.toGChat("rocket")).toBe("🚀");
    });

    it("should return raw emoji if no mapping exists", () => {
      const resolver = new EmojiResolver();
      expect(resolver.toGChat("custom")).toBe("custom");
    });
  });

  describe("matches", () => {
    it("should match Slack format to normalized emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("+1", "thumbs_up")).toBe(true);
      expect(resolver.matches("thumbsup", "thumbs_up")).toBe(true);
      expect(resolver.matches(":+1:", "thumbs_up")).toBe(true);
      expect(resolver.matches("fire", "fire")).toBe(true);
    });

    it("should match GChat format to normalized emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("👍", "thumbs_up")).toBe(true);
      expect(resolver.matches("🔥", "fire")).toBe(true);
      expect(resolver.matches("❤️", "heart")).toBe(true);
    });

    it("should not match different emoji", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("+1", "thumbs_down")).toBe(false);
      expect(resolver.matches("👍", "fire")).toBe(false);
    });

    it("should match unmapped emoji by equality", () => {
      const resolver = new EmojiResolver();
      expect(resolver.matches("custom", "custom")).toBe(true);
      expect(resolver.matches("custom", "other")).toBe(false);
    });
  });

  describe("extend", () => {
    it("should add new emoji mappings", () => {
      const resolver = new EmojiResolver();
      resolver.extend({
        unicorn: { slack: "unicorn_face", gchat: "🦄" },
      });

      expect(resolver.fromSlack("unicorn_face").name).toBe("unicorn");
      expect(resolver.fromGChat("🦄").name).toBe("unicorn");
      expect(resolver.toSlack("unicorn")).toBe("unicorn_face");
      expect(resolver.toGChat("unicorn")).toBe("🦄");
    });

    it("should override existing mappings", () => {
      const resolver = new EmojiResolver();
      resolver.extend({
        fire: { slack: "flames", gchat: "🔥" },
      });

      expect(resolver.fromSlack("flames").name).toBe("fire");
      expect(resolver.toSlack("fire")).toBe("flames");
    });
  });

  describe("defaultEmojiResolver", () => {
    it("should be a pre-configured resolver instance", () => {
      expect(defaultEmojiResolver).toBeInstanceOf(EmojiResolver);
      expect(defaultEmojiResolver.fromSlack("+1").name).toBe("thumbs_up");
    });
  });

  describe("DEFAULT_EMOJI_MAP", () => {
    it("should contain all well-known emoji", () => {
      const expectedEmoji = [
        // Reactions & Gestures
        "thumbs_up",
        "thumbs_down",
        "clap",
        "wave",
        "pray",
        "muscle",
        "ok_hand",
        "point_up",
        "point_down",
        "point_left",
        "point_right",
        "raised_hands",
        "shrug",
        "facepalm",
        // Emotions & Faces
        "heart",
        "smile",
        "laugh",
        "thinking",
        "sad",
        "cry",
        "angry",
        "love_eyes",
        "cool",
        "wink",
        "surprised",
        "worried",
        "confused",
        "neutral",
        "sleeping",
        "sick",
        "mind_blown",
        "relieved",
        "grimace",
        "rolling_eyes",
        "hug",
        "zany",
        // Status & Symbols
        "check",
        "x",
        "question",
        "exclamation",
        "warning",
        "stop",
        "info",
        "100",
        "fire",
        "star",
        "sparkles",
        "lightning",
        "boom",
        "eyes",
        // Status Indicators
        "green_circle",
        "yellow_circle",
        "red_circle",
        "blue_circle",
        "white_circle",
        "black_circle",
        // Objects & Tools
        "rocket",
        "party",
        "confetti",
        "balloon",
        "gift",
        "trophy",
        "medal",
        "lightbulb",
        "gear",
        "wrench",
        "hammer",
        "bug",
        "link",
        "lock",
        "unlock",
        "key",
        "pin",
        "memo",
        "clipboard",
        "calendar",
        "clock",
        "hourglass",
        "bell",
        "megaphone",
        "speech_bubble",
        "email",
        "inbox",
        "outbox",
        "package",
        "folder",
        "file",
        "chart_up",
        "chart_down",
        "coffee",
        "pizza",
        "beer",
        // Arrows & Directions
        "arrow_up",
        "arrow_down",
        "arrow_left",
        "arrow_right",
        "refresh",
        // Nature & Weather
        "sun",
        "cloud",
        "rain",
        "snow",
        "rainbow",
      ];

      for (const e of expectedEmoji) {
        expect(DEFAULT_EMOJI_MAP[e]).toBeDefined();
        expect(DEFAULT_EMOJI_MAP[e].slack).toBeDefined();
        expect(DEFAULT_EMOJI_MAP[e].gchat).toBeDefined();
      }
    });
  });
});

describe("emoji helper", () => {
  it("should provide EmojiValue objects for well-known emoji", () => {
    expect(emoji.thumbs_up.name).toBe("thumbs_up");
    expect(emoji.fire.name).toBe("fire");
    expect(emoji.rocket.name).toBe("rocket");
    expect(emoji["100"].name).toBe("100");
  });

  it("should convert to placeholder string via toString()", () => {
    expect(emoji.thumbs_up.toString()).toBe("{{emoji:thumbs_up}}");
    expect(emoji.fire.toString()).toBe("{{emoji:fire}}");
    expect(`${emoji.rocket}`).toBe("{{emoji:rocket}}");
  });

  it("should have object identity (same emoji returns same object)", () => {
    expect(emoji.thumbs_up).toBe(emoji.thumbs_up);
    expect(emoji.fire).toBe(emoji.fire);
    // getEmoji also returns the same singleton
    expect(getEmoji("thumbs_up")).toBe(emoji.thumbs_up);
  });

  it("should have a custom() method that returns EmojiValue", () => {
    const unicorn = emoji.custom("unicorn");
    expect(unicorn.name).toBe("unicorn");
    expect(unicorn.toString()).toBe("{{emoji:unicorn}}");

    const custom = emoji.custom("custom_team_emoji");
    expect(custom.name).toBe("custom_team_emoji");
    expect(`${custom}`).toBe("{{emoji:custom_team_emoji}}");
  });

  it("should return same object from custom() for same name", () => {
    const first = emoji.custom("test_emoji");
    const second = emoji.custom("test_emoji");
    expect(first).toBe(second);
  });
});

describe("convertEmojiPlaceholders", () => {
  it("should convert placeholders to Slack format", () => {
    const text = `Thanks! ${emoji.thumbs_up} Great work! ${emoji.fire}`;
    const result = convertEmojiPlaceholders(text, "slack");
    expect(result).toBe("Thanks! :+1: Great work! :fire:");
  });

  it("should convert placeholders to GChat format", () => {
    const text = `Thanks! ${emoji.thumbs_up} Great work! ${emoji.fire}`;
    const result = convertEmojiPlaceholders(text, "gchat");
    expect(result).toBe("Thanks! 👍 Great work! 🔥");
  });

  it("should convert placeholders to Teams format (unicode)", () => {
    const text = `Thanks! ${emoji.thumbs_up} Great work! ${emoji.fire}`;
    const result = convertEmojiPlaceholders(text, "teams");
    expect(result).toBe("Thanks! 👍 Great work! 🔥");
  });

  it("should handle unknown emoji by passing through", () => {
    const text = "Check this {{emoji:unknown_emoji}}!";
    const result = convertEmojiPlaceholders(text, "slack");
    expect(result).toBe("Check this :unknown_emoji:!");
  });

  it("should handle multiple emoji in a message", () => {
    const text = `${emoji.wave} Hello! ${emoji.smile} How are you? ${emoji.thumbs_up}`;
    const result = convertEmojiPlaceholders(text, "gchat");
    expect(result).toBe("👋 Hello! 😊 How are you? 👍");
  });

  it("should handle text with no emoji", () => {
    const text = "Just a regular message";
    const result = convertEmojiPlaceholders(text, "slack");
    expect(result).toBe("Just a regular message");
  });
});

describe("createEmoji", () => {
  it("should create emoji helper with well-known EmojiValue objects", () => {
    const e = createEmoji();
    expect(e.thumbs_up.name).toBe("thumbs_up");
    expect(e.fire.name).toBe("fire");
    expect(e.rocket.name).toBe("rocket");
    expect(`${e.thumbs_up}`).toBe("{{emoji:thumbs_up}}");
  });

  it("should include custom() method returning EmojiValue", () => {
    const e = createEmoji();
    const unicorn = e.custom("unicorn");
    expect(unicorn.name).toBe("unicorn");
    expect(unicorn.toString()).toBe("{{emoji:unicorn}}");
  });

  it("should add custom emoji to the helper as EmojiValue objects", () => {
    const e = createEmoji({
      unicorn: { slack: "unicorn_face", gchat: "🦄" },
      company_logo: { slack: "company", gchat: "🏢" },
    });

    // Custom emoji are accessible as EmojiValue objects
    expect(e.unicorn.name).toBe("unicorn");
    expect(e.company_logo.name).toBe("company_logo");
    expect(`${e.unicorn}`).toBe("{{emoji:unicorn}}");
    expect(`${e.company_logo}`).toBe("{{emoji:company_logo}}");

    // Well-known emoji still work
    expect(e.thumbs_up.name).toBe("thumbs_up");
  });

  it("should automatically register custom emoji with default resolver", () => {
    const e = createEmoji({
      custom_test: { slack: "custom_slack", gchat: "🎯" },
    });

    const text = `${e.custom_test} Magic!`;
    // No need to manually extend resolver - createEmoji does it automatically
    expect(convertEmojiPlaceholders(text, "slack")).toBe(
      ":custom_slack: Magic!"
    );
    expect(convertEmojiPlaceholders(text, "gchat")).toBe("🎯 Magic!");
  });

  it("should return same EmojiValue singleton as emoji helper", () => {
    const e = createEmoji();
    // Both should return the same frozen singleton object
    expect(e.thumbs_up).toBe(emoji.thumbs_up);
    expect(e.fire).toBe(emoji.fire);
  });
});
