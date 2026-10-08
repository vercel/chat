import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const github = {
  beta: true,
  description:
    "Build bots that respond to pull request and issue comment threads.",
  env: {
    credentialModes: [
      {
        label: "Personal access token",
        vars: [secretEnv("GITHUB_TOKEN", "Personal access token.")],
      },
      {
        label: "GitHub App",
        vars: [
          env("GITHUB_APP_ID", "GitHub App ID."),
          secretEnv("GITHUB_PRIVATE_KEY", "GitHub App private key."),
        ],
      },
    ],
    optional: [
      env(
        "GITHUB_INSTALLATION_ID",
        "Installation ID for single-installation app deployments."
      ),
      env("GITHUB_BOT_USERNAME", "Bot username for mention detection."),
      env(
        "GITHUB_BOT_USER_ID",
        "Numeric bot user ID for self-message detection; recommended on serverless and with Vercel Connect to prevent reply loops."
      ),
      urlEnv("GITHUB_API_URL", "Override the GitHub API base URL."),
    ],
    required: [secretEnv("GITHUB_WEBHOOK_SECRET", "Webhook signing secret.")],
  },
  factoryExport: "createGitHubAdapter",
  features: {
    postMessage: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "no",
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "GFM Markdown" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "yes", label: "GFM" },
    fields: "yes",
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: { status: "partial" },
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "no",
    ephemeralMessages: "no",
    userLookup: "yes",
    parentSubject: "yes",
    nativeClient: "yes",
    customApiEndpoint: "yes",
    fetchMessages: "yes",
    fetchSingleMessage: "no",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "yes",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "no",
  },
  group: "official",
  icon: "github",
  name: "GitHub",
  packageName: "@chat-adapter/github",
  peerDeps: ["@octokit/auth-app", "@octokit/rest"],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-github",
  slug: "github",
  type: "platform",
} as const satisfies CatalogAdapter;
