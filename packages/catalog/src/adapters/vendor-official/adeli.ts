import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const adeli = {
  author: "Adeli",
  description:
    "Instagram, Facebook, and WhatsApp DMs, and Instagram and TikTok comments, through one Adeli API key. Users connect their accounts in the Adeli dashboard, so the bot needs no Meta app, App Review, or TikTok developer access.",
  env: {
    config: ["userName", "webhookToleranceSeconds", "fetch", "logger"],
    notes:
      "apiKey and webhookSecret also accept a function instead of a string. The adapter calls apiKey before every API request and webhookSecret on every webhook, and never caches the result.",
    optional: [
      env(
        "ADELI_PROFILE_ID",
        "Adeli profile id. Only needed when the API key can reach more than one profile."
      ),
      urlEnv(
        "ADELI_BASE_URL",
        "Adeli API origin. Defaults to https://app.tryadeli.com."
      ),
    ],
    required: [
      secretEnv(
        "ADELI_API_KEY",
        "Adeli API key (rk_live_…), from API keys in the Adeli dashboard."
      ),
      secretEnv(
        "ADELI_WEBHOOK_SECRET",
        "Signing secret of the Adeli webhook that delivers to the bot (whsec_…)."
      ),
    ],
  },
  factoryExport: "createAdeliAdapter",
  features: {
    postMessage: "yes",
    deleteMessage: { status: "partial", label: "Own comments" },
    streaming: { status: "partial", label: "Buffered" },
    cardFormat: { status: "partial", label: "Plain-text fallback" },
    buttons: { status: "partial", label: "Instagram DMs, max 3" },
    linkButtons: { status: "partial", label: "Instagram DMs" },
    mentions: "yes",
    directMessages: "yes",
    customApiEndpoint: { status: "yes", label: "baseURL" },
    fetchMessages: "yes",
    fetchThreadInfo: "yes",
  },
  group: "vendor-official",
  name: "Adeli",
  packageName: "@adeli/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/kingscrosslabs/adeli-chat-sdk-adapter/tree/v1.0.0",
  slug: "adeli",
  type: "platform",
} as const satisfies CatalogAdapter;
