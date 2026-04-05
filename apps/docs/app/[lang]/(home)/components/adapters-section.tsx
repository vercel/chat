import Link from "next/link";
import type { ReactNode } from "react";

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
];

interface AdaptersSectionProps {
  description: ReactNode;
  title: string;
}

export const AdaptersSection = ({
  title,
  description,
}: AdaptersSectionProps) => (
  <div className="grid gap-8 px-4 py-8 sm:px-12 sm:py-12">
    <div className="grid gap-2">
      <h2 className="font-semibold text-xl tracking-tight sm:text-2xl">
        {title}
      </h2>
      <p className="max-w-2xl text-muted-foreground">{description}</p>
    </div>

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
  </div>
);
