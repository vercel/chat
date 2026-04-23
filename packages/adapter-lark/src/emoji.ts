import { ValidationError } from "@chat-adapter/shared";
import type { EmojiValue } from "chat";

/**
 * Complete set of valid Lark/Feishu emoji type strings for reactions.
 *
 * Sourced from the official Feishu emoji documentation.
 * @see https://go.feishu.cn/s/670vFWbA804
 *
 * Any string in this set can be passed directly to the reaction API; mapping
 * from chat-SDK normalized names happens in {@link toLarkEmojiType}.
 */
export const VALID_LARK_EMOJI_TYPES: ReadonlySet<string> = new Set([
  // Gestures / actions
  "OK",
  "THUMBSUP",
  "THANKS",
  "MUSCLE",
  "FINGERHEART",
  "APPLAUSE",
  "FISTBUMP",
  "JIAYI",
  "DONE",
  // Faces / expressions
  "SMILE",
  "BLUSH",
  "LAUGH",
  "SMIRK",
  "LOL",
  "FACEPALM",
  "LOVE",
  "WINK",
  "PROUD",
  "WITTY",
  "SMART",
  "SCOWL",
  "THINKING",
  "SOB",
  "CRY",
  "ERROR",
  "NOSEPICK",
  "HAUGHTY",
  "SLAP",
  "SPITBLOOD",
  "TOASTED",
  "GLANCE",
  "DULL",
  "INNOCENTSMILE",
  "JOYFUL",
  "WOW",
  "TRICK",
  "YEAH",
  "ENOUGH",
  "TEARS",
  "EMBARRASSED",
  "KISS",
  "SMOOCH",
  "DROOL",
  "OBSESSED",
  "MONEY",
  "TEASE",
  "SHOWOFF",
  "COMFORT",
  "CLAP",
  "PRAISE",
  "STRIVE",
  "XBLUSH",
  "SILENT",
  "WAVE",
  "WHAT",
  "FROWN",
  "SHY",
  "DIZZY",
  "LOOKDOWN",
  "CHUCKLE",
  "WAIL",
  "CRAZY",
  "WHIMPER",
  "HUG",
  "BLUBBER",
  "WRONGED",
  "HUSKY",
  "SHHH",
  "SMUG",
  "ANGRY",
  "HAMMER",
  "SHOCKED",
  "TERROR",
  "PETRIFIED",
  "SKULL",
  "SWEAT",
  "SPEECHLESS",
  "SLEEP",
  "DROWSY",
  "YAWN",
  "SICK",
  "PUKE",
  "BETRAYED",
  "HEADSET",
  "EatingFood",
  "MeMeMe",
  "Sigh",
  "Typing",
  "SLIGHT",
  "TONGUE",
  "EYESCLOSED",
  "RoarForYou",
  "CALF",
  "BEAR",
  "BULL",
  "RAINBOWPUKE",
  // Objects / food / drinks
  "Lemon",
  "ROSE",
  "HEART",
  "PARTY",
  "LIPS",
  "BEER",
  "CAKE",
  "GIFT",
  "CUCUMBER",
  "Drumstick",
  "Pepper",
  "CANDIEDHAWS",
  "BubbleTea",
  "Coffee",
  // Symbols / marks
  "Get",
  "LGTM",
  "OnIt",
  "OneSecond",
  "VRHeadset",
  "YouAreTheBest",
  "SALUTE",
  "SHAKE",
  "HIGHFIVE",
  "UPPERLEFT",
  "ThumbsDown",
  "Yes",
  "No",
  "OKR",
  "CheckMark",
  "CrossMark",
  "MinusOne",
  "Hundred",
  "AWESOMEN",
  "Pin",
  "Alarm",
  "Loudspeaker",
  "Trophy",
  "Fire",
  "BOMB",
  "Music",
  // Holidays / seasons
  "XmasTree",
  "Snowman",
  "XmasHat",
  "FIREWORKS",
  "2022",
  "REDPACKET",
  "FORTUNE",
  "LUCK",
  "FIRECRACKER",
  "StickyRiceBalls",
  // Miscellaneous
  "HEARTBROKEN",
  "POOP",
  "StatusFlashOfInspiration",
  "18X",
  "CLEAVER",
  "Soccer",
  "Basketball",
  // Status
  "GeneralDoNotDisturb",
  "Status_PrivateMessage",
  "GeneralInMeetingBusy",
  "StatusReading",
  "StatusInFlight",
  "GeneralBusinessTrip",
  "GeneralWorkFromHome",
  "StatusEnjoyLife",
  "GeneralTravellingCar",
  "StatusBus",
  "GeneralSun",
  "GeneralMoonRest",
  // Holiday extras
  "MoonRabbit",
  "Mooncake",
  "JubilantRabbit",
  "TV",
  "Movie",
  "Pumpkin",
  // Newer additions
  "BeamingFace",
  "Delighted",
  "ColdSweat",
  "FullMoonFace",
  "Partying",
  "GoGoGo",
  "ThanksFace",
  "SaluteFace",
  "Shrug",
  "ClownFace",
  "HappyDragon",
]);

/**
 * Mapping from chat-SDK normalized emoji names to Lark `emoji_type` strings.
 *
 * Only common reactions are mapped. Callers can always bypass the map by
 * passing a valid Lark emoji_type directly — see passthrough behavior in
 * {@link toLarkEmojiType}.
 */
const CHAT_TO_LARK: Record<string, string> = {
  thumbs_up: "THUMBSUP",
  thumbs_down: "ThumbsDown",
  heart: "HEART",
  fire: "Fire",
  clap: "CLAP",
  party: "PARTY",
  rocket: "GoGoGo",
  eyes: "EYESCLOSED",
  muscle: "MUSCLE",
  pray: "HIGHFIVE",
  wave: "WAVE",
  "100": "Hundred",
  check: "CheckMark",
  x: "CrossMark",
  smile: "SMILE",
  laugh: "LAUGH",
  cry: "CRY",
  angry: "ANGRY",
  surprised: "SHOCKED",
  sad: "SOB",
  thinking: "THINKING",
  facepalm: "FACEPALM",
  ok_hand: "OK",
  trophy: "Trophy",
};

/** Reverse map: lowercased Lark emoji_type → chat-SDK normalized name. */
const LARK_TO_CHAT: Record<string, string> = Object.fromEntries(
  Object.entries(CHAT_TO_LARK).map(([k, v]) => [v.toLowerCase(), k])
);

/**
 * Convert a chat-SDK emoji (EmojiValue or normalized name string) to a Lark
 * `emoji_type` string for the Reaction API.
 *
 * Accepts three input forms:
 *  1. Normalized chat-SDK name (e.g. `"thumbs_up"`) → looked up in CHAT_TO_LARK
 *  2. Valid Lark emoji_type (e.g. `"THUMBSUP"`) → passed through unchanged
 *  3. Anything else → throws ValidationError
 */
export function toLarkEmojiType(emoji: EmojiValue | string): string {
  const name = typeof emoji === "string" ? emoji : emoji.name;
  if (VALID_LARK_EMOJI_TYPES.has(name)) {
    return name;
  }
  const mapped = CHAT_TO_LARK[name];
  if (!mapped) {
    throw new ValidationError(
      "lark",
      `No Lark emoji_type mapping for "${name}". Pass a valid Lark emoji_type directly (see VALID_LARK_EMOJI_TYPES) or extend the mapping.`
    );
  }
  return mapped;
}

/** Build an immutable EmojiValue singleton (same contract as chat SDK's `getEmoji`). */
const emojiCache = new Map<string, EmojiValue>();
function buildEmojiValue(name: string): EmojiValue {
  let value = emojiCache.get(name);
  if (!value) {
    value = Object.freeze({
      name,
      toString: () => `{{emoji:${name}}}`,
      toJSON: () => `{{emoji:${name}}}`,
    });
    emojiCache.set(name, value);
  }
  return value;
}

/**
 * Convert an incoming Lark `emoji_type` (e.g. `"THUMBSUP"`) into an EmojiValue
 * for chat SDK ReactionEvent consumers.
 *
 * Unknown Lark emoji types fall back to using the raw string as the normalized
 * name — still a valid EmojiValue, just without cross-platform identity.
 */
export function fromLarkEmojiType(larkEmojiType: string): EmojiValue {
  const normalized = LARK_TO_CHAT[larkEmojiType.toLowerCase()] ?? larkEmojiType;
  return buildEmojiValue(normalized);
}

/** True if the given string is a documented Lark emoji_type. */
export function isValidLarkEmoji(emojiType: string): boolean {
  return VALID_LARK_EMOJI_TYPES.has(emojiType);
}
