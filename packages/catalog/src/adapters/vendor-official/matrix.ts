import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const matrix = {
  author: "Beeper",
  description: "Matrix adapter for Chat SDK, built and maintained by Beeper.",
  env: {
    config: [
      "recoveryKey",
      "commandPrefix",
      "roomAllowlist",
      "inviteAutoJoin",
      "e2ee",
      "persistence",
    ],
    credentialModes: [
      {
        label: "Access token",
        vars: [
          urlEnv("MATRIX_BASE_URL", "Matrix homeserver base URL."),
          secretEnv("MATRIX_ACCESS_TOKEN", "Matrix access token."),
        ],
      },
      {
        label: "Username and password",
        vars: [
          urlEnv("MATRIX_BASE_URL", "Matrix homeserver base URL."),
          env("MATRIX_USERNAME", "Matrix username."),
          secretEnv("MATRIX_PASSWORD", "Matrix password."),
        ],
      },
    ],
    optional: [
      env("MATRIX_USER_ID", "User ID hint."),
      env("MATRIX_DEVICE_ID", "Explicit device ID override."),
      secretEnv(
        "MATRIX_RECOVERY_KEY",
        "Enables E2EE and key-backup bootstrap."
      ),
      env("MATRIX_BOT_USERNAME", "Mention-detection username."),
      env("MATRIX_COMMAND_PREFIX", "Slash command prefix."),
      env("MATRIX_INVITE_AUTOJOIN", "Enable invite auto-join."),
      env(
        "MATRIX_INVITE_AUTOJOIN_ALLOWLIST",
        "Comma-separated Matrix user IDs allowed to invite the bot."
      ),
      env("MATRIX_SDK_LOG_LEVEL", "Matrix SDK log level."),
    ],
  },
  factoryExport: "createMatrixAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: "no",
    scheduledMessages: "no",
    cardFormat: "no",
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: "no",
    fields: "no",
    imagesInCards: "no",
    modals: "no",
    slashCommands: { status: "yes", label: "Prefix-parsed" },
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "yes",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "yes",
    ephemeralMessages: "no",
    userLookup: "yes",
    customApiEndpoint: { status: "yes", label: "baseURL" },
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "yes",
  },
  group: "vendor-official",
  name: "Beeper Matrix",
  packageName: "@beeper/chat-adapter-matrix",
  peerDeps: [],
  readme:
    "https://github.com/beeper/chat-adapter-matrix/tree/632fb141b07d7243f2a09ee12ec55854c628217d",
  slug: "matrix",
  type: "platform",
} as const satisfies CatalogAdapter;
