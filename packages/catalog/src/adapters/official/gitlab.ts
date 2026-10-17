import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const gitlab = {
  description:
    "Build bots that respond to merge request and issue comment threads on GitLab.com or GitLab Self-Managed.",
  env: {
    config: ["webhookVerifier"],
    credentialModes: [
      {
        label: "Webhook signing token",
        vars: [
          secretEnv(
            "GITLAB_WEBHOOK_SIGNING_TOKEN",
            "Webhook signing token (whsec_...) for HMAC signature verification. GitLab 19.0 and later."
          ),
        ],
      },
      {
        label: "Webhook secret token",
        vars: [
          secretEnv(
            "GITLAB_WEBHOOK_SECRET",
            "Webhook secret token, compared against the X-Gitlab-Token header."
          ),
        ],
      },
    ],
    optional: [
      env(
        "GITLAB_BOT_USERNAME",
        "Bot username for mention detection. Defaults to the token user's username."
      ),
      env(
        "GITLAB_BOT_USER_ID",
        "Numeric bot user ID for self-message detection. Defaults to the token user's ID; recommended on serverless to prevent reply loops."
      ),
      urlEnv(
        "GITLAB_API_URL",
        "GitLab REST API base URL for Self-Managed or Dedicated instances (default https://gitlab.com/api/v4)."
      ),
    ],
    required: [
      secretEnv(
        "GITLAB_TOKEN",
        "Personal, project, or group access token with the api scope."
      ),
    ],
  },
  factoryExport: "createGitLabAdapter",
  features: {
    postMessage: "yes",
    messageReplies: "yes",
    editMessage: "yes",
    deleteMessage: "yes",
    fileUploads: "yes",
    streaming: { status: "partial", label: "Buffered" },
    scheduledMessages: "no",
    cardFormat: { status: "yes", label: "GLFM Markdown" },
    buttons: "no",
    linkButtons: "no",
    selectMenus: "no",
    tables: { status: "yes", label: "GLFM" },
    fields: "yes",
    imagesInCards: "yes",
    modals: "no",
    slashCommands: "no",
    mentions: "yes",
    addReactions: "yes",
    removeReactions: "yes",
    typingIndicator: "no",
    messageUpdatedEvents: "no",
    messageDeletedEvents: "no",
    directMessages: "no",
    ephemeralMessages: "no",
    userLookup: "yes",
    parentSubject: "yes",
    nativeClient: { status: "partial", label: "REST helper" },
    customApiEndpoint: "yes",
    fetchMessages: "yes",
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
    fetchChannelMessages: "no",
    listThreads: "yes",
    fetchChannelInfo: "yes",
    postChannelMessage: "no",
  },
  group: "official",
  icon: "gitlab",
  name: "GitLab",
  packageName: "@chat-adapter/gitlab",
  peerDeps: [],
  readme: "https://github.com/vercel/chat/tree/main/packages/adapter-gitlab",
  slug: "gitlab",
  type: "platform",
} as const satisfies CatalogAdapter;
