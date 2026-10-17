import type { AdapterType } from "./types";

/**
 * One capability shown in an adapter's feature matrix.
 */
export interface FeatureDefinition<Key extends string = FeatureKey> {
  /**
   * Stable key used in {@link AdapterFeatures}.
   */
  readonly key: Key;
  /**
   * Display label.
   */
  readonly label: string;
}

/**
 * A titled group of related capabilities.
 */
export interface FeatureCategory<Key extends string = FeatureKey> {
  /**
   * Capabilities in display order.
   */
  readonly features: readonly FeatureDefinition<Key>[];
  /**
   * Stable category identifier.
   */
  readonly id: string;
  /**
   * Display label.
   */
  readonly label: string;
}

/**
 * Capability categories for platform adapters, in display order.
 */
export const PLATFORM_FEATURE_CATEGORIES = [
  {
    id: "messaging",
    label: "Messaging",
    features: [
      { key: "postMessage", label: "Post message" },
      { key: "messageReplies", label: "Message replies" },
      { key: "editMessage", label: "Edit message" },
      { key: "deleteMessage", label: "Delete message" },
      { key: "fileUploads", label: "File uploads" },
      { key: "streaming", label: "Streaming" },
      { key: "scheduledMessages", label: "Scheduled messages" },
    ],
  },
  {
    id: "richContent",
    label: "Rich content",
    features: [
      { key: "cardFormat", label: "Card format" },
      { key: "buttons", label: "Buttons" },
      { key: "linkButtons", label: "Link buttons" },
      { key: "selectMenus", label: "Select menus" },
      { key: "tables", label: "Tables" },
      { key: "charts", label: "Charts" },
      { key: "fields", label: "Fields" },
      { key: "imagesInCards", label: "Images in cards" },
      { key: "modals", label: "Modals" },
    ],
  },
  {
    id: "conversations",
    label: "Conversations",
    features: [
      { key: "slashCommands", label: "Slash commands" },
      { key: "mentions", label: "Mentions" },
      { key: "addReactions", label: "Add reactions" },
      { key: "removeReactions", label: "Remove reactions" },
      { key: "typingIndicator", label: "Typing indicator" },
      { key: "markAsRead", label: "Mark as read" },
      { key: "messageUpdatedEvents", label: "Message edit events" },
      { key: "messageDeletedEvents", label: "Message delete events" },
      { key: "directMessages", label: "DMs" },
      { key: "ephemeralMessages", label: "Ephemeral messages" },
      { key: "userLookup", label: "User lookup" },
      { key: "parentSubject", label: "Parent subject" },
      { key: "nativeClient", label: "Native client" },
      { key: "customApiEndpoint", label: "Custom API endpoint" },
    ],
  },
  {
    id: "messageHistory",
    label: "Message history",
    features: [
      { key: "fetchMessages", label: "Fetch messages" },
      { key: "fetchSingleMessage", label: "Fetch single message" },
      { key: "fetchThreadInfo", label: "Fetch thread info" },
      { key: "fetchChannelMessages", label: "Fetch channel messages" },
      { key: "listThreads", label: "List threads" },
      { key: "fetchChannelInfo", label: "Fetch channel info" },
      { key: "postChannelMessage", label: "Post channel message" },
    ],
  },
] as const satisfies readonly FeatureCategory<string>[];

/**
 * Capability categories for state adapters, in display order.
 */
export const STATE_FEATURE_CATEGORIES = [
  {
    id: "capabilities",
    label: "Capabilities",
    features: [
      { key: "persistence", label: "Persistence" },
      { key: "multiInstance", label: "Multi-instance" },
      { key: "subscriptions", label: "Subscriptions" },
      { key: "distributedLocking", label: "Distributed locking" },
      { key: "keyValueCache", label: "Key-value caching" },
      { key: "lists", label: "Lists" },
      { key: "queues", label: "Queues" },
      { key: "automaticReconnect", label: "Automatic reconnect" },
      { key: "cluster", label: "Cluster support" },
      { key: "sentinel", label: "Sentinel support" },
      { key: "keyPrefix", label: "Key prefix namespacing" },
    ],
  },
] as const satisfies readonly FeatureCategory<string>[];

/**
 * Capability key for platform adapters.
 */
export type PlatformFeatureKey =
  (typeof PLATFORM_FEATURE_CATEGORIES)[number]["features"][number]["key"];

/**
 * Capability key for state adapters.
 */
export type StateFeatureKey =
  (typeof STATE_FEATURE_CATEGORIES)[number]["features"][number]["key"];

/**
 * Any capability key.
 */
export type FeatureKey = PlatformFeatureKey | StateFeatureKey;

/**
 * Whether an adapter supports a capability.
 */
export type FeatureStatus = "yes" | "no" | "partial";

/**
 * Normalized support entry for one capability.
 */
export interface FeatureSupport {
  /**
   * Short qualifier, such as `"Native"` or `"Block Kit"`.
   */
  label?: string;
  status: FeatureStatus;
}

/**
 * Authored support value: a bare status or a status with a label.
 */
export type FeatureValue = FeatureStatus | FeatureSupport;

/**
 * Capability support declared by an adapter. Omitted keys mean `"no"`.
 */
export type AdapterFeatures = Partial<Record<FeatureKey, FeatureValue>>;

/**
 * Return the capability categories that apply to an adapter type.
 *
 * @param type - Adapter type.
 * @returns Platform or state categories in display order.
 */
export const getFeatureCategories = (
  type: AdapterType
): readonly FeatureCategory[] =>
  type === "platform" ? PLATFORM_FEATURE_CATEGORIES : STATE_FEATURE_CATEGORIES;

/**
 * Normalize an authored support value. Missing values mean `"no"`.
 *
 * @param value - Bare status, status with a label, or `undefined`.
 * @returns A {@link FeatureSupport} object.
 */
export const normalizeFeatureValue = (
  value: FeatureValue | undefined
): FeatureSupport => {
  if (!value) {
    return { status: "no" };
  }
  if (typeof value === "string") {
    return { status: value };
  }
  return value;
};
