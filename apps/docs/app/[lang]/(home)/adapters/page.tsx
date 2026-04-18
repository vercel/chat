import type { Metadata } from "next";
import Link from "next/link";
import adapters from "@/adapters.json";
import { AdaptersGrid } from "./components/adapters-grid";

export const metadata: Metadata = {
  title: "Adapters",
  description:
    "Browse official and community adapters for Chat SDK. Connect your bot to Slack, Teams, Discord, and more.",
  twitter: {
    card: "summary_large_image",
  },
};

const messengerLinks = [
  { name: "iMessage", slug: "imessage" },
  { name: "WhatsApp", slug: "whatsapp" },
  { name: "Telegram", slug: "telegram" },
  { name: "Slack", slug: "slack" },
  { name: "Discord", slug: "discord" },
  { name: "Teams", slug: "teams" },
  { name: "Matrix", slug: "matrix" },
  { name: "Instagram", slug: "instagram" },
  { name: "Facebook", slug: "facebook" },
  { name: "X/Twitter", slug: "twitter" },
  { name: "GitHub", slug: "github" },
  { name: "Linear", slug: "linear" },
  { name: "Email", slug: "email" },
  { name: "Webex", slug: "webex" },
  { name: "Google Chat", slug: "google-chat" },
  { name: "Zalo", slug: "zalo" },
  { name: "Mattermost", slug: "mattermost" },
];

const AdaptersPage = () => (
  <div className="container mx-auto max-w-5xl">
    <section className="mt-(--fd-nav-height) space-y-4 px-4 pt-16 pb-8 sm:pt-24">
      <h1 className="text-balance font-semibold text-[40px] leading-[1.1] tracking-tight sm:text-5xl">
        Adapters
      </h1>
      <p className="max-w-2xl text-lg text-muted-foreground leading-relaxed">
        Browse official and community-built adapters to connect your bot to any
        platform.
      </p>
    </section>

    <section className="px-4 pb-10">
      <h2 className="mb-4 font-semibold text-lg tracking-tight">
        Browse by messenger
      </h2>
      <div className="flex flex-wrap gap-2">
        {messengerLinks.map((messenger) => (
          <Link
            className="rounded-full border bg-card px-4 py-1.5 text-sm transition-colors hover:bg-accent"
            href={`/adapters/for/${messenger.slug}`}
            key={messenger.slug}
          >
            {messenger.name}
          </Link>
        ))}
      </div>
    </section>

    <div className="grid gap-10 px-4 pb-16">
      <AdaptersGrid adapters={adapters} />
    </div>
  </div>
);

export default AdaptersPage;
