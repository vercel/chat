import { IconBell } from "@vercel/geistdocs/assets/icons/icon-bell";
import { IconMessage } from "@vercel/geistdocs/assets/icons/icon-message";
import { IconShieldCheck } from "@vercel/geistdocs/assets/icons/icon-shield-check";
import { LogoIconMicrosoftTeamsSvg as teams } from "@vercel/geistdocs/assets/logos/logo-icon-microsoft-teams-svg";
import Link from "next/link";
import type { ComponentProps } from "react";
import { github, gitlab, instagram, linear, notion, x } from "@/lib/logos";
import {
  discord,
  gchat,
  gmail,
  messenger,
  slack,
  telegram,
  twilio,
  twitch,
  whatsapp,
} from "@/lib/logos-mono";
import { cn } from "@/lib/utils";
import { sectionHeading } from "./styles";

const platforms: {
  icon: (props: Pick<ComponentProps<"svg">, "className">) => React.JSX.Element;
  name: string;
  slug: string;
}[] = [
  { icon: slack, name: "Slack", slug: "slack" },
  { icon: teams, name: "Teams", slug: "teams" },
  { icon: gchat, name: "Google Chat", slug: "gchat" },
  { icon: gmail, name: "Gmail", slug: "gmail" },
  { icon: discord, name: "Discord", slug: "discord" },
  { icon: whatsapp, name: "WhatsApp", slug: "whatsapp" },
  { icon: twilio, name: "Twilio", slug: "twilio" },
  { icon: messenger, name: "Messenger", slug: "messenger" },
  { icon: instagram, name: "Instagram", slug: "instagram" },
  { icon: x, name: "X", slug: "x" },
  { icon: twitch, name: "Twitch", slug: "twitch" },
  { icon: github, name: "GitHub", slug: "github" },
  { icon: gitlab, name: "GitLab", slug: "gitlab" },
  { icon: linear, name: "Linear", slug: "linear" },
  { icon: notion, name: "Notion", slug: "notion" },
  { icon: telegram, name: "Telegram", slug: "telegram" },
];

const features = [
  {
    title: "Multi-platform support",
    description:
      "Ship to every chat platform from one codebase, without per-platform rewrites.",
    Icon: IconMessage,
  },
  {
    title: "Event-driven by design",
    description:
      "React to mentions, reactions, and replies with handlers scoped to each thread.",
    Icon: IconBell,
  },
  {
    title: "Type-safe by default",
    description:
      "Strict types for adapters, handlers, and JSX cards, checked at build time.",
    Icon: IconShieldCheck,
  },
] as const;

export const SupportedPlatforms = () => (
  <>
    <section
      aria-labelledby="home-platforms"
      className="grid grid-cols-1 items-center gap-y-4 py-12 md:py-20 lg:grid-cols-12 lg:gap-x-12"
    >
      <h2
        className={cn(sectionHeading, "text-balance lg:col-span-4")}
        id="home-platforms"
      >
        The platform agnostic chat toolkit
      </h2>
      <p className="max-w-md text-pretty text-copy-18 text-gray-900 lg:col-span-4 lg:row-start-2">
        The open-source chat toolkit designed to help developers build chat bots
        that run on Slack, Teams, Google Chat, Discord, WhatsApp, and more.
      </p>
      <ul className="mt-6 grid list-none grid-cols-[repeat(4,auto)] justify-between gap-y-8 sm:grid-cols-[repeat(8,auto)] lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:mt-0">
        {platforms.map((platform) => (
          <li key={platform.slug}>
            <Link
              aria-label={platform.name}
              className="flex size-12 items-center justify-center rounded-md outline-none transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-700"
              href={`/adapters/official/${platform.slug}`}
              prefetch={true}
            >
              <platform.icon className="size-8 sm:size-12" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
    <section aria-label="Chat SDK features" className="py-12 md:py-20">
      <ul className="grid list-none gap-10 md:grid-cols-2 md:gap-x-8 lg:grid-cols-3">
        {features.map(({ title, description, Icon }) => (
          <li className="flex flex-col gap-3" key={title}>
            <h3 className="flex items-center gap-2 font-medium text-copy-16 text-gray-900">
              <Icon aria-hidden="true" size={16} />
              {title}
            </h3>
            <p className="max-w-sm text-balance text-copy-18 text-gray-900">
              {description}
            </p>
          </li>
        ))}
      </ul>
    </section>
  </>
);
