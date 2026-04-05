import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import {
  discord,
  gchat,
  github,
  linear,
  memory,
  postgres,
  redis,
  slack,
  teams,
  telegram,
  whatsapp,
} from "@/lib/logos";

interface Adapter {
  name: string;
  icon: (props: ComponentProps<"svg">) => React.JSX.Element;
  href: string;
  badge?: string;
}

const platformAdapters: Adapter[] = [
  { name: "Slack", icon: slack, href: "/adapters/slack" },
  { name: "Teams", icon: teams, href: "/adapters/teams" },
  { name: "Google Chat", icon: gchat, href: "/adapters/google-chat" },
  { name: "Discord", icon: discord, href: "/adapters/discord" },
  { name: "GitHub", icon: github, href: "/adapters/github" },
  { name: "Linear", icon: linear, href: "/adapters/linear" },
  { name: "Telegram", icon: telegram, href: "/adapters/telegram" },
  { name: "WhatsApp", icon: whatsapp, href: "/adapters/whatsapp" },
];

const stateAdapters: Adapter[] = [
  { name: "Redis", icon: redis, href: "/adapters/redis" },
  { name: "PostgreSQL", icon: postgres, href: "/adapters/postgres" },
  { name: "Memory", icon: memory, href: "/adapters/memory" },
];

const communityAdapters = [
  "Beeper Matrix",
  "Photon iMessage",
  "Webex",
  "Resend Email",
  "Zernio",
  "Liveblocks",
];

const AdapterChip = ({ adapter }: { adapter: Adapter }) => (
  <Link
    className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
    href={adapter.href}
  >
    <adapter.icon className="size-4" />
    <span>{adapter.name}</span>
    {adapter.badge ? (
      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        {adapter.badge}
      </span>
    ) : null}
  </Link>
);

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

    <div className="grid gap-6">
      <div className="grid gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Platforms</h3>
        <div className="flex flex-wrap gap-2">
          {platformAdapters.map((adapter) => (
            <AdapterChip adapter={adapter} key={adapter.name} />
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">State</h3>
        <div className="flex flex-wrap gap-2">
          {stateAdapters.map((adapter) => (
            <AdapterChip adapter={adapter} key={adapter.name} />
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">
          Community
        </h3>
        <div className="flex flex-wrap gap-2">
          {communityAdapters.map((name) => (
            <span
              className="rounded-full border bg-card px-3 py-1.5 text-sm"
              key={name}
            >
              {name}
            </span>
          ))}
          <Link
            className="rounded-full border border-dashed px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-solid hover:bg-accent hover:text-foreground"
            href="/adapters"
          >
            View all →
          </Link>
        </div>
      </div>
    </div>
  </div>
);
