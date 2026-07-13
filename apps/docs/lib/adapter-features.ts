export type AdapterFeatureStatus = "yes" | "no" | "partial";

export type AdapterFeatureValue =
  | AdapterFeatureStatus
  | {
      status: AdapterFeatureStatus;
      label?: string;
    };

export interface AdapterFeature {
  key: string;
  label: string;
}

export interface AdapterFeatureCategory {
  features: AdapterFeature[];
  id: string;
  label: string;
}

export const PLATFORM_FEATURE_CATEGORIES: AdapterFeatureCategory[] = [
  {
    id: "messaging",
    label: "Messaging",
    features: [
      { key: "postMessage", label: "Post message" },
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
];

export const STATE_FEATURE_CATEGORIES: AdapterFeatureCategory[] = [
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
];

export const getFeatureCategories = (
  type: "platform" | "state"
): AdapterFeatureCategory[] =>
  type === "platform" ? PLATFORM_FEATURE_CATEGORIES : STATE_FEATURE_CATEGORIES;

export const normalizeFeatureValue = (
  value: AdapterFeatureValue | undefined
): { status: AdapterFeatureStatus; label?: string } => {
  if (!value) {
    return { status: "no" };
  }
  if (typeof value === "string") {
    return { status: value };
  }
  return value;
};
