import { VerifiedIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  discord,
  gchat,
  github,
  ioredis,
  linear,
  memory,
  messenger,
  postgres,
  redis,
  slack,
  teams,
  telegram,
  web,
  whatsapp,
} from "@/lib/logos";

const ICON_MAP: Record<
  string,
  (props: React.ComponentProps<"svg">) => React.ReactNode
> = {
  slack,
  teams,
  "google-chat": gchat,
  discord,
  github,
  web,
  linear,
  telegram,
  redis,
  ioredis,
  postgres,
  memory,
  whatsapp,
  messenger,
};

interface AdapterHeroProps {
  beta?: boolean;
  community?: boolean;
  logo?: string;
  name: string;
  packageName?: string;
  tagline: string;
  vendorOfficial?: boolean;
}

export const AdapterHero = ({
  beta,
  community,
  logo,
  name,
  packageName,
  tagline,
  vendorOfficial,
}: AdapterHeroProps) => {
  const Icon = logo ? ICON_MAP[logo] : undefined;
  const showBadges = beta || community || vendorOfficial;

  return (
    <header className="not-prose mb-10 flex flex-col gap-5">
      <div className="flex items-start gap-4">
        {Icon ? (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-card">
            <Icon className="size-8" />
          </span>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="font-semibold text-4xl leading-none tracking-tight">
            {name}
          </h1>
          {packageName ? (
            <code className="font-mono text-muted-foreground text-sm">
              {packageName}
            </code>
          ) : null}
        </div>
        {showBadges ? (
          <div className="flex shrink-0 items-center gap-2">
            {beta ? <Badge variant="secondary">Beta</Badge> : null}
            {vendorOfficial ? (
              <Badge className="gap-1" variant="secondary">
                <VerifiedIcon className="size-3.5 text-primary" />
                Vendor official
              </Badge>
            ) : null}
            {community && !vendorOfficial ? (
              <Badge variant="secondary">Community</Badge>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="max-w-3xl text-balance text-lg text-muted-foreground leading-relaxed">
        {tagline}
      </p>
    </header>
  );
};
