import type {
  GeistdocsAgentReadinessConfig,
  GeistdocsGithubConfig,
} from "@vercel/geistdocs/config";
import { LogoChatSdk } from "@vercel/geistdocs/assets/logos/logo-chat-sdk";

export const Logo = () => <LogoChatSdk height={22} />;

export const github: GeistdocsGithubConfig = {
  branch: "main",
  editPath: "apps/docs/content/docs/{path}",
  owner: "vercel",
  repo: "chat",
};

export const nav = [
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "Adapters",
    href: "/adapters",
  },
  {
    label: "Resources",
    href: "/resources",
  },
  {
    label: "API",
    href: "/docs/api",
  },
  {
    label: "GitHub",
    href: `https://github.com/${github.owner}/${github.repo}/`,
  },
];

export const suggestions = [
  "What platforms does Chat SDK support?",
  "How do I set up a Slack bot with Next.js?",
  "How do I send cards and interactive messages?",
  "How do I stream AI responses in real-time?",
];

export const title = "Chat SDK Documentation";

export const prompt =
  "You are a helpful assistant specializing in answering questions about Chat SDK, a unified SDK for building chat bots across Slack, Microsoft Teams, Google Chat, Discord, and more.";

export const agent: GeistdocsAgentReadinessConfig = {
  product: {
    name: "Chat SDK",
    description:
      "A unified TypeScript SDK for building chat bots and agents across Slack, Microsoft Teams, Google Chat, Discord, Telegram, WhatsApp, and more — with type-safe handlers, JSX cards, and AI streaming.",
    category: "Chat bot SDK",
    audience: ["developers building chat bots and agents", "Vercel users"],
    useCases: [
      "Build a bot once and run it on every major chat platform",
      "Send rich interactive cards with JSX",
      "Stream AI responses into chat threads in real time",
    ],
  },
  instructions: [
    "See /adapters for the catalog of official, vendor-official, and community platform and state adapters; each adapter page is available as Markdown with a .md extension.",
    "Use /sitemap.md to identify the most relevant documentation pages before answering broad questions.",
    "Use /llms.txt for an index of every documentation page, or /llms-full.txt for the complete documentation corpus as Markdown context.",
    "Fetch individual documentation pages with a .md or .mdx extension for focused page-level context.",
    "Do not assume API, authentication, OpenAPI, or MCP support unless it is listed in this file.",
  ],
  links: [
    {
      label: "Chat SDK source",
      href: `https://github.com/${github.owner}/${github.repo}`,
      description: "Source repository for Chat SDK and its adapters",
    },
    {
      label: "Chat SDK agent skill",
      href: "https://chat-sdk.dev/AGENTS.md",
      description:
        "Agent skill with instructions for building Chat SDK bots",
    },
  ],
};

export const translations = {
  en: {
    displayName: "English",
  },
};

export const basePath: string | undefined = undefined;

/**
 * Unique identifier for this site, used in markdown request tracking analytics.
 * Each site using geistdocs should set this to a unique value (e.g. "ai-sdk-docs", "next-docs").
 */
export const siteId: string | undefined = "chat-sdk";
