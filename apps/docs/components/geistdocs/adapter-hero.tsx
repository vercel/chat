import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const GithubIcon = github;

interface AdapterHeroProps {
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
          <Button asChild size="sm" variant="outline">
            <a href={sourceUrl} rel="noopener noreferrer" target="_blank">
              <GithubIcon aria-hidden="true" className="size-4" />
              View source
              <ArrowUpRight aria-hidden="true" className="size-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </Button>
        </div>
      ) : null}
    </header>
  );
};
