import type { Metadata } from "next";
import communityAdapters from "@/marketplace.json";
import { MarketplaceGrid } from "./components/marketplace-grid";

export const metadata: Metadata = {
  title: "Marketplace",
  description:
    "Browse official and community adapters for Chat SDK. Connect your bot to Slack, Teams, Discord, and more.",
};

const vercelAdapters = [
  {
    name: "Slack",
    description:
      "Build bots for Slack workspaces with full support for threads, reactions, and interactive messages.",
    href: "/docs/adapters/slack",
    packageName: "@chat-adapter/slack",
    icon: "slack",
    beta: true,
  },
  {
    name: "Microsoft Teams",
    description:
      "Deploy bots to Microsoft Teams with adaptive cards, mentions, and conversation threading.",
    href: "/docs/adapters/teams",
    packageName: "@chat-adapter/teams",
    icon: "teams",
    beta: true,
  },
  {
    name: "Google Chat",
    description:
      "Integrate with Google Chat spaces for team collaboration and automated workflows.",
    href: "/docs/adapters/google-chat",
    packageName: "@chat-adapter/gchat",
    icon: "google-chat",
    beta: true,
  },
  {
    name: "Discord",
    description:
      "Create Discord bots with slash commands, threads, and rich embeds.",
    href: "/docs/adapters/discord",
    packageName: "@chat-adapter/discord",
    icon: "discord",
    beta: true,
  },
  {
    name: "GitHub",
    description:
      "Build bots that respond to pull request and issue comment threads.",
    href: "/docs/adapters/github",
    packageName: "@chat-adapter/github",
    icon: "github",
    beta: true,
  },
  {
    name: "Linear",
    description:
      "Automate Linear issue comment threads with bot responses and workflows.",
    href: "/docs/adapters/linear",
    packageName: "@chat-adapter/linear",
    icon: "linear",
    beta: true,
  },
  {
    name: "Telegram",
    description:
      "Connect to Telegram with support for groups, channels, and inline keyboards.",
    href: "/docs/adapters/telegram",
    packageName: "@chat-adapter/telegram",
    icon: "telegram",
    beta: true,
  },
];

const MarketplacePage = () => (
  <div className="container mx-auto max-w-5xl">
    <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
      <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
        Marketplace
      </h1>
      <p className="max-w-2xl text-muted-foreground text-lg leading-relaxed">
        Browse official and community-built adapters to connect your bot to any
        platform.
      </p>
    </section>
    <div className="grid gap-10 px-4 pb-16">
      <MarketplaceGrid
        vercel={vercelAdapters}
        community={communityAdapters}
      />
    </div>
  </div>
);

export default MarketplacePage;
