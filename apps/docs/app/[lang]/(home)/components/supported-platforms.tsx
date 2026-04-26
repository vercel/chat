import Link from "next/link";
import type { ComponentProps } from "react";
import {
  discord,
  gchat,
  github,
  linear,
  slack,
  teams,
  telegram,
  whatsapp,
} from "@/lib/logos";
import { cn } from "@/lib/utils";

const platforms: {
  icon: (props: ComponentProps<"svg">) => React.JSX.Element;
  name: string;
  slug: string;
}[] = [
  { icon: slack, name: "Slack", slug: "slack" },
  { icon: teams, name: "Teams", slug: "teams" },
  { icon: gchat, name: "Google Chat", slug: "google-chat" },
  { icon: discord, name: "Discord", slug: "discord" },
  { icon: whatsapp, name: "WhatsApp", slug: "whatsapp" },
  { icon: github, name: "GitHub", slug: "github" },
  { icon: linear, name: "Linear", slug: "linear" },
  { icon: telegram, name: "Telegram", slug: "telegram" },
];

const features = [
  {
    title: "Multi-platform support.",
    description: "Ship to every chat platform from one codebase.",
  },
  {
    title: "Event-driven by design.",
    description: "React to mentions, reactions, and replies.",
  },
  {
    title: "Type-safe by default.",
    description: "Strict types for adapters, handlers, and JSX cards.",
  },
];

export const SupportedPlatforms = () => (
  <div style={{ fontFamily: "var(--font-sans)" }}>
    <div className="flex flex-col items-center gap-8 px-4 py-20 text-center">
      <h2 className="text-balance font-semibold text-[32px] leading-[1.1] tracking-tight md:text-[40px]">
        The Platform-Agnostic Chat Toolkit
      </h2>
      <p className="max-w-3xl text-balance text-[18px] text-muted-foreground leading-[1.4] md:text-[20px]">
        The open-source chat toolkit designed to help developers build chat bots
        that run on Slack, Teams, Google Chat, Discord, WhatsApp, and more.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
        {platforms.map((platform) => (
          <Link
            aria-label={platform.name}
            className="flex size-12 items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent"
            href={`/adapters/${platform.slug}`}
            key={platform.slug}
          >
            <platform.icon className="size-6" />
          </Link>
        ))}
      </div>
    </div>
    <div className="grid border-t sm:grid-cols-3">
      {features.map((feature, i) => (
        <div
          className={cn(
            "px-6 py-8 sm:px-10 sm:py-10",
            i > 0 && "border-t sm:border-t-0 sm:border-l"
          )}
          key={feature.title}
        >
          <p className="font-semibold text-[16px] leading-snug tracking-tight sm:text-[20px]">
            {feature.title}
          </p>
          <p className="text-[16px] text-muted-foreground leading-snug tracking-tight sm:text-[20px]">
            {feature.description}
          </p>
        </div>
      ))}
    </div>
  </div>
);
