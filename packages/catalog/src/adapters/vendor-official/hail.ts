import { env, secretEnv, urlEnv } from "../../env";
import type { CatalogAdapter } from "../../types";

export const hail = {
  author: "Hail",
  description:
    "Connect Chat SDK to SMS through Hail, the platform for AI-agent phone numbers, email, and voice. This adapter supports signed SMS webhooks, replies, rotating credentials, and state-backed conversation history.",
  env: {
    config: ["userName", "fetch"],
    notes:
      "apiKey and webhookSecret accept credential resolver functions. recipientConsent accepts a boolean or a per-recipient resolver. Sending requires explicit consent.",
    optional: [
      urlEnv(
        "HAIL_API_URL",
        "API origin without /v1. Defaults to https://api.hail.so."
      ),
    ],
    required: [
      secretEnv(
        "HAIL_API_KEY",
        "Hail API key from https://hail.so/console/keys."
      ),
      secretEnv(
        "HAIL_WEBHOOK_SECRET",
        "Signing secret returned when creating the Hail webhook subscription."
      ),
      env(
        "HAIL_FROM_NUMBER",
        "Hail-owned, SMS-capable phone number in E.164 format."
      ),
      env(
        "HAIL_RECIPIENT_CONSENT",
        "Set true only when you attest to required consent for every recipient this bot contacts."
      ),
    ],
  },
  factoryExport: "createHailAdapter",
  features: {
    postMessage: "yes",
    mentions: {
      status: "partial",
      label: "Every inbound SMS is a direct message",
    },
    directMessages: "yes",
    customApiEndpoint: { status: "yes", label: "apiUrl" },
    fetchMessages: {
      status: "partial",
      label: "Chat SDK state-backed history; no API backfill",
    },
    fetchSingleMessage: "yes",
    fetchThreadInfo: "yes",
  },
  group: "vendor-official",
  name: "Hail",
  packageName: "@hail-hq/chat-sdk-adapter",
  peerDeps: [],
  readme:
    "https://github.com/hail-hq/chat-sdk-adapter/tree/1e9099ea7881cd5fc31731ea05a0ebff9f6db562",
  slug: "hail",
  type: "platform",
} as const satisfies CatalogAdapter;
