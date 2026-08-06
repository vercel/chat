import Link from "next/link";
import type { ComponentProps } from "react";
import {
  discord,
  gchat,
  github,
  instagram,
  linear,
  messenger,
  notion,
  slack,
  teams,
  telegram,
  twilio,
  whatsapp,
  x,
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
  { icon: instagram, name: "Instagram", slug: "instagram" },
  { icon: x, name: "X", slug: "x" },
  { icon: github, name: "GitHub", slug: "github" },
  { icon: linear, name: "Linear", slug: "linear" },
  { icon: notion, name: "Notion", slug: "notion" },
  { icon: telegram, name: "Telegram", slug: "telegram" },
];

const features = [
  {
    title: "Multi-platform support",
    description:
      "Ship to every chat platform from one codebase, without per-platform rewrites.",
  },
  {
    title: "Event-driven by design",
    description:
      "React to mentions, reactions, and replies with handlers scoped to each thread.",
  },
  {
    title: "Type-safe by default",
    description:
      "Strict types for adapters, handlers, and JSX cards, checked at build time.",
  },
] as const;

export const SupportedPlatforms = () => (
  <>
    <section className="flex flex-col items-center gap-8 py-20 text-center">
      <h3 className="text-heading-32 md:text-heading-40">
        The Platform-Agnostic Chat Toolkit
      </h3>
      <p className="mx-auto max-w-3xl text-copy-16 text-gray-900 md:text-copy-18 lg:text-copy-20">
        The open-source chat toolkit designed to help developers build chat bots
        that run on Slack, Teams, Google Chat, Discord, WhatsApp, and more.
      </p>
      <div className="mx-auto mt-2 flex max-w-64 flex-wrap items-center justify-center gap-3 sm:max-w-none sm:gap-6">
        {platforms.map((platform) => (
          <Link
            aria-label={platform.name}
            className="flex size-12 items-center justify-center"
            href={`/adapters/official/${platform.slug}`}
            key={platform.slug}
          >
            <platform.icon className="size-9" />
          </Link>
        ))}
      </div>
    </section>
    <ul className="grid list-none grid-cols-12 gap-x-8 gap-y-10 py-10 lg:gap-x-12 lg:py-12">
      {features.map((feature) => (
        <li
          className="col-span-12 flex flex-col gap-3 sm:col-span-6 lg:col-span-4"
          key={feature.title}
        >
          <span className="flex items-center gap-3 text-gray-1000 text-heading-20">
            {feature.title}
          </span>
          <span className="text-balance text-copy-16 text-gray-900 sm:max-w-sm">
            {feature.description}
          </span>
        </li>
      ))}
    </ul>
  </>
);
