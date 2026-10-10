import { ArrowUpRight } from "lucide-react";
import {
  discord,
  gchat,
  github,
  gmail,
  ioredis,
  instagram,
  linear,
  memory,
  messenger,
  notion,
  postgres,
  redis,
  slack,
  teams,
  telegram,
  twilio,
  twitch,
  web,
  whatsapp,
  x,
  xchat,
} from "@/lib/logos";

const ICON_MAP: Record<
  string,
  (props: React.ComponentProps<"svg">) => React.ReactNode
> = {
  slack,
  teams,
  gchat,
  discord,
  github,
  gmail,
  instagram,
  web,
  linear,
  notion,
  telegram,
  redis,
  ioredis,
  postgres,
  memory,
  whatsapp,
  twilio,
  messenger,
  twitch,
  x,
  xchat,
};

interface AdapterHeroProps {
  beta?: boolean;
  community?: boolean;
  logo?: string;
  name: string;
  packageName?: string;
  sourceUrl?: string;
  tagline: string;
  vendorOfficial?: boolean;
}

export const AdapterHero = ({
  logo,
  name,
  sourceUrl,
  tagline,
}: AdapterHeroProps) => {
  const Icon = logo ? ICON_MAP[logo] : undefined;
  const GithubIcon = github;

  return (
    <header className="not-prose mb-10 flex flex-col gap-4 border-b pb-8">
      <div className="flex items-center gap-4">
        {Icon ? (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-card">
            <Icon className="size-8" />
          </span>
        ) : null}
        <h1 className="min-w-0 flex-1 text-heading-32">{name}</h1>
      </div>
      <p className="max-w-3xl text-balance text-[17px] text-muted-foreground leading-[1.6]">
        {tagline}
      </p>
      {sourceUrl ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 py-5 text-sm font-medium shadow-xs transition-all hover:bg-accent hover:text-accent-foreground"
            href={sourceUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon className="size-4" />
            Source code
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      ) : null}
    </header>
  );
};
