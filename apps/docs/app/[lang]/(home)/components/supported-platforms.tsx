import Link from "next/link";
import type { ComponentProps } from "react";
import {
  discord,
  gchat,
  github,
  linear,
  messenger,
  slack,
  teams,
  telegram,
  twilio,
  whatsapp,
} from "@/lib/logos";

const platforms: {
  icon: (props: ComponentProps<"svg">) => React.JSX.Element;
  name: string;
  slug: string;
}[] = [
  { icon: slack, name: "Slack", slug: "slack" },
  { icon: teams, name: "Teams", slug: "teams" },
  { icon: gchat, name: "Google Chat", slug: "gchat" },
  { icon: discord, name: "Discord", slug: "discord" },
  { icon: whatsapp, name: "WhatsApp", slug: "whatsapp" },
  { icon: twilio, name: "Twilio", slug: "twilio" },
  { icon: messenger, name: "Messenger", slug: "messenger" },
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
] as const;

export const SupportedPlatforms = () => (
  <>
    <section
      className="flex flex-col items-center gap-8 px-4 py-20 text-center"
      data-home-grid
    >
      <h3 className="text-heading-32 md:text-heading-40">
        The Platform-Agnostic Chat Toolkit
      </h3>
      <p className="mx-auto max-w-3xl px-4 text-copy-16 text-gray-900 md:text-copy-18 lg:text-copy-20">
        The open-source chat toolkit designed to help developers build chat bots
        that run on Slack, Teams, Google Chat, Discord, WhatsApp, and more.
      </p>
      <div className="mx-auto mt-2 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
        {platforms.map((platform) => (
          <Link
            aria-label={platform.name}
            className="flex size-12 items-center justify-center rounded-md border bg-background transition-colors hover:bg-accent"
            href={`/adapters/official/${platform.slug}`}
            key={platform.slug}
          >
            <platform.icon className="size-6" />
          </Link>
        ))}
      </div>
    </section>
    <div className="home-grid home-grid-features" data-home-grid>
      {features.map((feature) => (
        <div className="home-grid-cell" key={feature.title}>
          <span className="block text-heading-16 sm:text-heading-20">
            {feature.title}
          </span>
          <span className="block font-medium! text-gray-900 text-heading-16 sm:text-heading-20">
            {feature.description}
          </span>
        </div>
      ))}
    </div>
  </>
);
