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
  twilio,
  web,
  whatsapp,
  x,
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
  web,
  linear,
  telegram,
  redis,
  ioredis,
  postgres,
  memory,
  whatsapp,
  twilio,
  messenger,
  x,
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

export const AdapterHero = ({ logo, name, tagline }: AdapterHeroProps) => {
  const Icon = logo ? ICON_MAP[logo] : undefined;

  return (
    <header className="not-prose mb-10 flex flex-col gap-4 border-b pb-8">
      <div className="flex items-center gap-4">
        {Icon ? (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border bg-card">
            <Icon className="size-8" />
          </span>
        ) : null}
        <h1 className="min-w-0 flex-1 font-semibold text-[34px] leading-[1.1] tracking-tight">
          {name}
        </h1>
      </div>
      <p className="max-w-3xl text-balance text-[17px] text-muted-foreground leading-[1.6]">
        {tagline}
      </p>
    </header>
  );
};
