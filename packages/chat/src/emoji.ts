import type {
  CustomEmojiMap,
  EmojiFormats,
  EmojiMapConfig,
  EmojiValue,
  WellKnownEmoji,
} from "./types";

// Re-export EmojiValue for convenience
export type { EmojiValue } from "./types";

// =============================================================================
// EmojiValue - Immutable singleton emoji objects with object identity
// =============================================================================

/** Internal emoji registry for singleton instances */
const emojiRegistry = new Map<string, EmojiValue>();

/**
 * Get or create an immutable singleton EmojiValue.
 *
 * Always returns the same frozen object for the same name,
 * enabling `===` comparison for emoji identity.
 *
 * @example
 * ```typescript
 * const e1 = getEmoji("thumbs_up");
 * const e2 = getEmoji("thumbs_up");
 * console.log(e1 === e2); // true - same object
 * ```
 */
export function getEmoji(name: string): EmojiValue {
  let emojiValue = emojiRegistry.get(name);
  if (!emojiValue) {
    emojiValue = Object.freeze({
      name,
      toString: () => `{{emoji:${name}}}`,
      toJSON: () => `{{emoji:${name}}}`,
    });
    emojiRegistry.set(name, emojiValue);
  }
  return emojiValue;
}

// =============================================================================
// Emoji Map - Platform-specific formats
// =============================================================================

/**
 * Default emoji map for well-known emoji.
 * Maps normalized emoji names to platform-specific formats.
 */
export const DEFAULT_EMOJI_MAP: Record<string, EmojiFormats> = {
  // Reactions & Gestures
  thumbs_up: { slack: ["+1", "thumbsup"], gchat: "👍" },
  thumbs_down: { slack: ["-1", "thumbsdown"], gchat: "👎" },
  clap: { slack: "clap", gchat: "👏" },
  wave: { slack: "wave", gchat: "👋" },
  pray: { slack: "pray", gchat: "🙏" },
  muscle: { slack: "muscle", gchat: "💪" },
  ok_hand: { slack: "ok_hand", gchat: "👌" },
  point_up: { slack: "point_up", gchat: "👆" },
  point_down: { slack: "point_down", gchat: "👇" },
  point_left: { slack: "point_left", gchat: "👈" },
  point_right: { slack: "point_right", gchat: "👉" },
  raised_hands: { slack: "raised_hands", gchat: "🙌" },
  shrug: { slack: "shrug", gchat: "🤷" },
  facepalm: { slack: "facepalm", gchat: "🤦" },

  // Emotions & Faces
  heart: { slack: "heart", gchat: ["❤️", "❤"] },
  smile: { slack: ["smile", "slightly_smiling_face"], gchat: "😊" },
  laugh: { slack: ["laughing", "satisfied", "joy"], gchat: ["😂", "😆"] },
  thinking: { slack: "thinking_face", gchat: "🤔" },
  sad: { slack: ["cry", "sad", "white_frowning_face"], gchat: "😢" },
  cry: { slack: "sob", gchat: "😭" },
  angry: { slack: "angry", gchat: "😠" },
  love_eyes: { slack: "heart_eyes", gchat: "😍" },
  cool: { slack: "sunglasses", gchat: "😎" },
  wink: { slack: "wink", gchat: "😉" },
  surprised: { slack: "open_mouth", gchat: "😮" },
  worried: { slack: "worried", gchat: "😟" },
  confused: { slack: "confused", gchat: "😕" },
  neutral: { slack: "neutral_face", gchat: "😐" },
  sleeping: { slack: "sleeping", gchat: "😴" },
  sick: { slack: "nauseated_face", gchat: "🤢" },
  mind_blown: { slack: "exploding_head", gchat: "🤯" },
  relieved: { slack: "relieved", gchat: "😌" },
  grimace: { slack: "grimacing", gchat: "😬" },
  rolling_eyes: { slack: "rolling_eyes", gchat: "🙄" },
  hug: { slack: "hugging_face", gchat: "🤗" },
  zany: { slack: "zany_face", gchat: "🤪" },

  // Status & Symbols
  check: {
    slack: ["white_check_mark", "heavy_check_mark"],
    gchat: ["✅", "✔️"],
  },
  x: { slack: ["x", "heavy_multiplication_x"], gchat: ["❌", "✖️"] },
  question: { slack: "question", gchat: ["❓", "?"] },
  exclamation: { slack: "exclamation", gchat: "❗" },
  warning: { slack: "warning", gchat: "⚠️" },
  stop: { slack: "octagonal_sign", gchat: "🛑" },
  info: { slack: "information_source", gchat: "ℹ️" },
  "100": { slack: "100", gchat: "💯" },
  fire: { slack: "fire", gchat: "🔥" },
  star: { slack: "star", gchat: "⭐" },
  sparkles: { slack: "sparkles", gchat: "✨" },
  lightning: { slack: "zap", gchat: "⚡" },
  boom: { slack: "boom", gchat: "💥" },
  eyes: { slack: "eyes", gchat: "👀" },

  // Status Indicators (colored circles)
  green_circle: { slack: "large_green_circle", gchat: "🟢" },
  yellow_circle: { slack: "large_yellow_circle", gchat: "🟡" },
  red_circle: { slack: "red_circle", gchat: "🔴" },
  blue_circle: { slack: "large_blue_circle", gchat: "🔵" },
  white_circle: { slack: "white_circle", gchat: "⚪" },
  black_circle: { slack: "black_circle", gchat: "⚫" },

  // Objects & Tools
  rocket: { slack: "rocket", gchat: "🚀" },
  party: { slack: ["tada", "partying_face"], gchat: ["🎉", "🥳"] },
  confetti: { slack: "confetti_ball", gchat: "🎊" },
  balloon: { slack: "balloon", gchat: "🎈" },
  gift: { slack: "gift", gchat: "🎁" },
  trophy: { slack: "trophy", gchat: "🏆" },
  medal: { slack: "first_place_medal", gchat: "🥇" },
  lightbulb: { slack: "bulb", gchat: "💡" },
  gear: { slack: "gear", gchat: "⚙️" },
  wrench: { slack: "wrench", gchat: "🔧" },
  hammer: { slack: "hammer", gchat: "🔨" },
  bug: { slack: "bug", gchat: "🐛" },
  link: { slack: "link", gchat: "🔗" },
  lock: { slack: "lock", gchat: "🔒" },
  unlock: { slack: "unlock", gchat: "🔓" },
  key: { slack: "key", gchat: "🔑" },
  pin: { slack: "pushpin", gchat: "📌" },
  memo: { slack: "memo", gchat: "📝" },
  clipboard: { slack: "clipboard", gchat: "📋" },
  calendar: { slack: "calendar", gchat: "📅" },
  clock: { slack: "clock1", gchat: "🕐" },
  hourglass: { slack: "hourglass", gchat: "⏳" },
  bell: { slack: "bell", gchat: "🔔" },
  megaphone: { slack: "mega", gchat: "📢" },
  speech_bubble: { slack: "speech_balloon", gchat: "💬" },
  email: { slack: "email", gchat: "📧" },
  inbox: { slack: "inbox_tray", gchat: "📥" },
  outbox: { slack: "outbox_tray", gchat: "📤" },
  package: { slack: "package", gchat: "📦" },
  folder: { slack: "file_folder", gchat: "📁" },
  file: { slack: "page_facing_up", gchat: "📄" },
  chart_up: { slack: "chart_with_upwards_trend", gchat: "📈" },
  chart_down: { slack: "chart_with_downwards_trend", gchat: "📉" },
  coffee: { slack: "coffee", gchat: "☕" },
  pizza: { slack: "pizza", gchat: "🍕" },
  beer: { slack: "beer", gchat: "🍺" },

  // Arrows & Directions
  arrow_up: { slack: "arrow_up", gchat: "⬆️" },
  arrow_down: { slack: "arrow_down", gchat: "⬇️" },
  arrow_left: { slack: "arrow_left", gchat: "⬅️" },
  arrow_right: { slack: "arrow_right", gchat: "➡️" },
  refresh: { slack: "arrows_counterclockwise", gchat: "🔄" },

  // Nature & Weather
  sun: { slack: "sunny", gchat: "☀️" },
  cloud: { slack: "cloud", gchat: "☁️" },
  rain: { slack: "rain_cloud", gchat: "🌧️" },
  snow: { slack: "snowflake", gchat: "❄️" },
  rainbow: { slack: "rainbow", gchat: "🌈" },
};

/**
 * Emoji resolver that handles conversion between platform formats and normalized names.
 */
export class EmojiResolver {
  private emojiMap: Record<string, EmojiFormats>;
  private slackToNormalized: Map<string, string>;
  private gchatToNormalized: Map<string, string>;

  constructor(customMap?: EmojiMapConfig) {
    this.emojiMap = { ...DEFAULT_EMOJI_MAP, ...customMap };
    this.slackToNormalized = new Map();
    this.gchatToNormalized = new Map();
    this.buildReverseMaps();
  }

  private buildReverseMaps(): void {
    for (const [normalized, formats] of Object.entries(this.emojiMap)) {
      // Build Slack reverse map
      const slackFormats = Array.isArray(formats.slack)
        ? formats.slack
        : [formats.slack];
      for (const slack of slackFormats) {
        this.slackToNormalized.set(slack.toLowerCase(), normalized);
      }

      // Build GChat reverse map
      const gchatFormats = Array.isArray(formats.gchat)
        ? formats.gchat
        : [formats.gchat];
      for (const gchat of gchatFormats) {
        this.gchatToNormalized.set(gchat, normalized);
      }
    }
  }

  /**
   * Convert a Slack emoji name to normalized EmojiValue.
   * Returns an EmojiValue for the raw emoji if no mapping exists.
   */
  fromSlack(slackEmoji: string): EmojiValue {
    // Remove colons if present (e.g., ":+1:" -> "+1")
    const cleaned = slackEmoji.replace(/^:|:$/g, "").toLowerCase();
    const normalized = this.slackToNormalized.get(cleaned) ?? slackEmoji;
    return getEmoji(normalized);
  }

  /**
   * Convert a Google Chat unicode emoji to normalized EmojiValue.
   * Returns an EmojiValue for the raw emoji if no mapping exists.
   */
  fromGChat(gchatEmoji: string): EmojiValue {
    const normalized = this.gchatToNormalized.get(gchatEmoji) ?? gchatEmoji;
    return getEmoji(normalized);
  }

  /**
   * Convert a Teams reaction type to normalized EmojiValue.
   * Teams uses specific names: like, heart, laugh, surprised, sad, angry
   * Returns an EmojiValue for the raw reaction if no mapping exists.
   */
  fromTeams(teamsReaction: string): EmojiValue {
    const teamsMap: Record<string, string> = {
      like: "thumbs_up",
      heart: "heart",
      laugh: "laugh",
      surprised: "surprised",
      sad: "sad",
      angry: "angry",
    };
    const normalized = teamsMap[teamsReaction] ?? teamsReaction;
    return getEmoji(normalized);
  }

  /**
   * Convert a normalized emoji (or EmojiValue) to Slack format.
   * Returns the first Slack format if multiple exist.
   */
  toSlack(emoji: EmojiValue | string): string {
    const name = typeof emoji === "string" ? emoji : emoji.name;
    const formats = this.emojiMap[name];
    if (!formats) return name;
    return Array.isArray(formats.slack) ? formats.slack[0] : formats.slack;
  }

  /**
   * Convert a normalized emoji (or EmojiValue) to Google Chat format.
   * Returns the first GChat format if multiple exist.
   */
  toGChat(emoji: EmojiValue | string): string {
    const name = typeof emoji === "string" ? emoji : emoji.name;
    const formats = this.emojiMap[name];
    if (!formats) return name;
    return Array.isArray(formats.gchat) ? formats.gchat[0] : formats.gchat;
  }

  /**
   * Convert a normalized emoji (or EmojiValue) to Discord format (unicode).
   * Discord uses unicode emoji, same as Google Chat.
   */
  toDiscord(emoji: EmojiValue | string): string {
    // Discord uses unicode emoji like GChat
    return this.toGChat(emoji);
  }

  /**
   * Check if an emoji (in any format) matches a normalized emoji name or EmojiValue.
   */
  matches(rawEmoji: string, normalized: EmojiValue | string): boolean {
    const name = typeof normalized === "string" ? normalized : normalized.name;
    const formats = this.emojiMap[name];
    if (!formats) return rawEmoji === name;

    const slackFormats = Array.isArray(formats.slack)
      ? formats.slack
      : [formats.slack];
    const gchatFormats = Array.isArray(formats.gchat)
      ? formats.gchat
      : [formats.gchat];

    const cleanedRaw = rawEmoji.replace(/^:|:$/g, "").toLowerCase();

    return (
      slackFormats.some((s) => s.toLowerCase() === cleanedRaw) ||
      gchatFormats.includes(rawEmoji)
    );
  }

  /**
   * Add or override emoji mappings.
   */
  extend(customMap: EmojiMapConfig): void {
    Object.assign(this.emojiMap, customMap);
    this.buildReverseMaps();
  }
}

/**
 * Default emoji resolver instance.
 */
export const defaultEmojiResolver = new EmojiResolver();

/** Placeholder pattern for emoji in text: {{emoji:name}} */
const EMOJI_PLACEHOLDER_REGEX = /\{\{emoji:([a-z0-9_]+)\}\}/gi;

/**
 * Convert emoji placeholders in text to platform-specific format.
 *
 * @example
 * ```typescript
 * convertEmojiPlaceholders("Thanks! {{emoji:thumbs_up}}", "slack");
 * // Returns: "Thanks! :+1:"
 *
 * convertEmojiPlaceholders("Thanks! {{emoji:thumbs_up}}", "gchat");
 * // Returns: "Thanks! 👍"
 * ```
 */
export function convertEmojiPlaceholders(
  text: string,
  platform: "slack" | "gchat" | "teams" | "discord" | "github" | "linear",
  resolver: EmojiResolver = defaultEmojiResolver,
): string {
  return text.replace(EMOJI_PLACEHOLDER_REGEX, (_, emojiName: string) => {
    switch (platform) {
      case "slack":
        return `:${resolver.toSlack(emojiName)}:`;
      case "gchat":
        return resolver.toGChat(emojiName);
      case "teams":
        // Teams uses unicode emoji
        return resolver.toGChat(emojiName);
      case "discord":
        // Discord uses unicode emoji
        return resolver.toDiscord(emojiName);
      case "github":
        // GitHub uses unicode emoji
        return resolver.toGChat(emojiName);
      case "linear":
        // Linear uses unicode emoji
        return resolver.toGChat(emojiName);
      default:
        return resolver.toGChat(emojiName);
    }
  });
}

// =============================================================================
// Emoji Helper Types
// =============================================================================

/** Base emoji object with well-known emoji as EmojiValue singletons */
type BaseEmojiHelper = {
  [K in WellKnownEmoji]: EmojiValue;
} & {
  /** Create an EmojiValue for a custom emoji name */
  custom: (name: string) => EmojiValue;
};

/** Extended emoji object including custom emoji from module augmentation */
type ExtendedEmojiHelper = BaseEmojiHelper & {
  [K in keyof CustomEmojiMap]: EmojiValue;
};

/**
 * Create a type-safe emoji helper with custom emoji.
 *
 * Returns immutable singleton EmojiValue objects that support:
 * - Object identity comparison (`event.emoji === emoji.thumbs_up`)
 * - Template string interpolation (`${emoji.thumbs_up}` → "{{emoji:thumbs_up}}")
 *
 * Custom emoji are automatically registered with the default resolver,
 * so placeholders will convert correctly in messages.
 *
 * @example
 * ```typescript
 * // First, extend the CustomEmojiMap type (usually in a .d.ts file)
 * declare module "chat" {
 *   interface CustomEmojiMap {
 *     unicorn: EmojiFormats;
 *     company_logo: EmojiFormats;
 *   }
 * }
 *
 * // Then create the emoji helper with your custom emoji
 * const emoji = createEmoji({
 *   unicorn: { slack: "unicorn_face", gchat: "🦄" },
 *   company_logo: { slack: "company", gchat: "🏢" },
 * });
 *
 * // Object identity works for comparisons
 * if (event.emoji === emoji.unicorn) { ... }
 *
 * // Template strings work for messages
 * await thread.post(`${emoji.unicorn} Magic!`);
 * // Slack: ":unicorn_face: Magic!"
 * // GChat: "🦄 Magic!"
 * ```
 */
export function createEmoji<
  T extends Record<
    string,
    { slack: string | string[]; gchat: string | string[] }
  >,
>(customEmoji?: T): BaseEmojiHelper & { [K in keyof T]: EmojiValue } {
  // All well-known emoji names
  const wellKnownEmoji: WellKnownEmoji[] = [
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

  // Build the emoji helper object with EmojiValue singletons
  const helper: Record<string, EmojiValue | ((name: string) => EmojiValue)> = {
    custom: (name: string): EmojiValue => getEmoji(name),
  };

  // Add all well-known emoji
  for (const name of wellKnownEmoji) {
    helper[name] = getEmoji(name);
  }

  // Add custom emoji if provided
  if (customEmoji) {
    for (const key of Object.keys(customEmoji)) {
      helper[key] = getEmoji(key);
    }
    // Extend the default resolver so placeholders convert correctly
    defaultEmojiResolver.extend(customEmoji as EmojiMapConfig);
  }

  return helper as BaseEmojiHelper & {
    [K in keyof T]: EmojiValue;
  };
}

/**
 * Type-safe emoji helper for embedding emoji in messages.
 *
 * @example
 * ```typescript
 * import { emoji } from "chat";
 *
 * await thread.post(`Great job! ${emoji.thumbs_up} ${emoji.fire}`);
 * // Slack: "Great job! :+1: :fire:"
 * // GChat: "Great job! 👍 🔥"
 * ```
 *
 * For custom emoji, use `createEmoji()` with module augmentation:
 * @example
 * ```typescript
 * // types.d.ts
 * declare module "chat" {
 *   interface CustomEmojiMap {
 *     unicorn: EmojiFormats;
 *   }
 * }
 *
 * // bot.ts
 * const emoji = createEmoji({ unicorn: { slack: "unicorn", gchat: "🦄" } });
 * await thread.post(`${emoji.unicorn} Magic!`);
 * ```
 */
export const emoji: ExtendedEmojiHelper = createEmoji() as ExtendedEmojiHelper;
